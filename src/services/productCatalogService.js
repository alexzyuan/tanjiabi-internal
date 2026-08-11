import path from "node:path";

import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import {
  fetchLingxingListingsBySidMskus,
  fetchLingxingProductRecords,
} from "./lingxingCatalogLookupService.js";
import {
  findListingSharedCatalogMatches,
  readListingSharedCatalogRecords,
} from "./listingSharedCatalogService.js";
import {
  catalogProductToRepositoryRows,
  normalizeCatalogListing,
  normalizeCatalogProduct,
} from "./productCatalogNormalization.js";
import {
  ProductCatalogConflictError,
  ProductCatalogInputError,
  normalizeCatalogKey,
  normalizeProductCatalogScope,
} from "./productCatalogIdentity.js";
import { migrateLegacyProductCatalog } from "./productCatalogLegacyMigrationService.js";
import { createProductCatalogRepository } from "./productCatalogRepository.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";

const LISTING_BATCH_SIZE = 50;
const PRODUCT_BATCH_SIZE = 80;
const LIVE_LISTING_SOURCE = "lingxing-listing";
const LIVE_PRODUCT_SOURCE = "lingxing-product";

let defaultRepository = null;
let migrationPromises = new WeakMap();
const refreshInFlight = new Map();
let requestSequence = 0;

export class ProductCatalogUpstreamError extends Error {
  constructor(message, { statusCode = 502, details = null, cause } = {}) {
    super(message, { cause });
    this.name = "ProductCatalogUpstreamError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export { ProductCatalogInputError, ProductCatalogConflictError };

function nowMs(options = {}) {
  const value = typeof options.now === "function" ? options.now() : options.now;
  const resolved = value === undefined ? Date.now() : Number(value);
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new ProductCatalogInputError("商品目录时间无效。");
  }
  return resolved;
}

function elapsedMs(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

function createRequestId(prefix = "catalog") {
  requestSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function requestIdFrom(options = {}) {
  const value = String(options.requestId || "").trim();
  return value || createRequestId();
}

function writeLog(logger, level, details) {
  const method = logger?.[level];
  if (typeof method !== "function") return;
  const safe = {
    requestId: details.requestId,
    feature: details.feature,
    operation: details.operation,
    status: details.status,
    scopeCount: details.scopeCount,
    listingCount: details.listingCount,
    productCount: details.productCount,
    elapsedMs: details.elapsedMs,
  };
  Object.keys(safe).forEach((key) => safe[key] === undefined && delete safe[key]);
  method.call(logger, "[product-catalog-service]", safe);
}

function repositoryFor(options = {}) {
  if (options.repository) return options.repository;
  if (defaultRepository) return defaultRepository;
  const databasePath = options.databasePath
    || process.env.PRODUCT_CATALOG_DATABASE_PATH
    || path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite");
  defaultRepository = createProductCatalogRepository({
    databasePath,
    logger: options.logger || console,
    now: options.now || Date.now,
  });
  return defaultRepository;
}

function sellerSid(seller) {
  const sid = Number(seller?.sid ?? seller?.seller_id_local ?? seller?.store_id ?? seller?.id);
  return Number.isInteger(sid) && sid > 0 ? sid : null;
}

function sellerName(seller) {
  return String(
    seller?.name
      ?? seller?.storeName
      ?? seller?.store_name
      ?? seller?.seller_name
      ?? seller?.shop_name
      ?? "",
  ).trim();
}

function sellerCountry(seller) {
  return String(
    seller?.country
      ?? seller?.countryName
      ?? seller?.country_name
      ?? seller?.marketplace
      ?? seller?.region
      ?? "",
  ).trim();
}

async function resolveScopeSellers(scope, options, adapter, requestId) {
  let directory = options.sellers || options.sellerDirectory;
  if (!directory) {
    const getDirectory = options.getSellerDirectory || options.getDirectory || getSellerDirectory;
    try {
      directory = await getDirectory({
        adapter,
        logger: options.logger || console,
        forceRefresh: options.forceSellerRefresh === true,
      });
    } catch (error) {
      throw new ProductCatalogUpstreamError("运行时店铺目录读取失败。", {
        statusCode: 502,
        details: { requestId },
        cause: error,
      });
    }
  }
  const sellers = Array.isArray(directory) ? directory : directory?.sellers;
  const bySid = new Map();
  (Array.isArray(sellers) ? sellers : []).forEach((seller) => {
    const sid = sellerSid(seller);
    if (!sid) return;
    bySid.set(sid, {
      sid,
      name: sellerName(seller),
      country: sellerCountry(seller),
    });
  });
  const unknown = [...new Set(scope
    .map((item) => item.sid)
    .filter((sid) => !bySid.has(sid)))];
  if (unknown.length) {
    throw new ProductCatalogInputError(
      `SID ${unknown.join(", ")} 不在运行时店铺目录。`,
      { details: { requestId, unknownSidCount: unknown.length } },
    );
  }
  return bySid;
}

function normalizeScope(items) {
  return normalizeProductCatalogScope(items, { maxItems: 500 });
}

function scopeKey(scope) {
  return scope.map((item) => item.key).sort().join(",");
}

function timestampCandidate(value, milliseconds = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return milliseconds || number >= 100000000000 ? number : number * 1000;
}

function sourceUpdatedAtMs(record, fallback) {
  const keys = [
    "sourceUpdatedAtMs",
    "source_updated_at_ms",
    "updatedAtMs",
    "updated_at_ms",
    "updatedAt",
    "updated_at",
    "updateTime",
    "update_time",
    "modifiedAt",
    "modified_at",
  ];
  for (const key of keys) {
    const value = timestampCandidate(record?.[key], /(?:Ms|_ms)$/.test(key));
    if (value !== null) return value;
  }
  return fallback;
}

function decorateListing(listing, scopeItem, seller, sourceUpdatedAt) {
  return {
    ...listing,
    sid: scopeItem.sid,
    msku: scopeItem.msku,
    mskuKey: scopeItem.mskuKey,
    storeName: seller?.name || "",
    country: seller?.country || "",
    sourceUpdatedAtMs: sourceUpdatedAt,
  };
}

function listingHasInternalSku(listing) {
  return Boolean(String(listing?.internalSku || "").trim());
}

function listingKey(listing) {
  const sid = Number(listing?.sid || 0);
  const mskuKey = normalizeCatalogKey(listing?.mskuKey || listing?.msku);
  return sid > 0 && mskuKey ? `${sid}:${mskuKey}` : "";
}

function wrapUpstream(error, message, requestId) {
  if (error instanceof ProductCatalogUpstreamError) {
    if (!error.details?.requestId) {
      error.details = { ...(error.details || {}), requestId };
    }
    return error;
  }
  return new ProductCatalogUpstreamError(message, {
    statusCode: 502,
    details: { requestId },
    cause: error,
  });
}

function unresolvedError(kind, count, requestId) {
  return new ProductCatalogUpstreamError(
    `${kind} 无法解析，仍有 ${count} 个商品缺少必要资料。`,
    { statusCode: 422, details: { requestId, unresolvedCount: count } },
  );
}

async function ensureMigrated(repository, sellers, options, requestId) {
  if (options.skipMigration === true) return { skipped: true, listingCount: 0, productCount: 0 };
  const existing = migrationPromises.get(repository);
  if (existing) return existing;
  const migrate = options.ensureMigrated
    || options.migrateLegacyProductCatalog
    || migrateLegacyProductCatalog;
  const migrationOptions = options.migrationOptions && typeof options.migrationOptions === "object"
    ? options.migrationOptions
    : {};
  const promise = Promise.resolve().then(() => migrate({
    ...migrationOptions,
    repository,
    sellers: [...sellers.values()],
    adapter: options.adapter,
    logger: options.logger || console,
    now: options.now || Date.now,
    sharedDir: options.sharedDir,
    supplierDir: options.supplierDir,
    requireSellerCache: options.requireSellerCache,
  }));
  migrationPromises.set(repository, promise);
  promise.catch(() => {
    if (migrationPromises.get(repository) === promise) migrationPromises.delete(repository);
  });
  try {
    return await promise;
  } catch (error) {
    throw wrapUpstream(error, "旧商品目录迁移失败。", requestId);
  }
}

async function buildContext(scope, options, requestId) {
  const repository = repositoryFor(options);
  const adapter = options.adapter || getLingxingAdapter(options.lingxingConfig);
  const sellers = await resolveScopeSellers(scope, options, adapter, requestId);
  return {
    repository,
    adapter,
    sellers,
    options,
    requestId,
    now: nowMs(options),
  };
}

async function fetchAllListings(scope, context, stats) {
  const rowsByKey = new Map();
  const bySid = new Map();
  scope.forEach((item) => {
    if (!bySid.has(item.sid)) bySid.set(item.sid, []);
    bySid.get(item.sid).push(item);
  });
  const lookup = context.options.fetchListingsBySidMskus || fetchLingxingListingsBySidMskus;
  for (const [sid, items] of bySid.entries()) {
    const mskus = items.map((item) => item.msku);
    let records;
    try {
      records = await lookup(context.adapter, sid, mskus, {
        batchSize: LISTING_BATCH_SIZE,
        strict: true,
        sidVariants: context.options.sidVariants,
        ...(context.options.listingLookupOptions || {}),
      });
    } catch (error) {
      throw wrapUpstream(error, "ERP Listing 查询失败。", context.requestId);
    }
    for (const record of Array.isArray(records) ? records : []) {
      const normalized = normalizeCatalogListing(record, { fallbackSid: sid });
      if (!normalized || Number(normalized.sid) !== Number(sid)) continue;
      const mskuKey = normalizeCatalogKey(normalized.msku);
      const scopeItem = items.find((item) => item.mskuKey === mskuKey);
      if (!scopeItem) continue;
      const key = scopeItem.key;
      const decorated = decorateListing(
        normalized,
        scopeItem,
        context.sellers.get(scopeItem.sid),
        sourceUpdatedAtMs(record, context.now),
      );
      rowsByKey.set(key, decorated);
    }
  }
  stats.listingFetchedCount = rowsByKey.size;
  return rowsByKey;
}

async function fillMissingInternalSkusFromSharedXlsx(scope, listingByKey, context) {
  const unresolved = scope.filter((item) => {
    const listing = listingByKey.get(item.key);
    return listing && !listingHasInternalSku(listing);
  });
  if (!unresolved.length) return listingByKey;
  let records;
  try {
    records = Array.isArray(context.options.listingSharedCatalogRecords)
      ? context.options.listingSharedCatalogRecords
      : await (
        context.options.readListingSharedCatalog
          || context.options.readListingSharedCatalogRecords
          || readListingSharedCatalogRecords
      )();
  } catch (error) {
    throw wrapUpstream(error, "Listing 共享目录读取失败。", context.requestId);
  }
  const matcher = context.options.findListingSharedCatalogMatches || findListingSharedCatalogMatches;
  for (const item of unresolved) {
    const listing = listingByKey.get(item.key);
    // The API Listing already proves the canonical SID+MSKU identity.  Do not
    // require the workbook's historical store/country spelling to equal the
    // runtime seller name; those display aliases are deliberately discarded.
    const candidates = matcher([item], records);
    const candidateList = Array.isArray(candidates) ? candidates : [];
    const candidate = candidateList.find((value) => {
      const candidateKey = listingKey(value);
      if (candidateKey) return candidateKey === item.key;
      return false;
    }) || (candidateList.length === 1 && normalizeCatalogKey(candidateList[0]?.msku) === item.mskuKey
      ? candidateList[0]
      : null);
    if (!candidate || !listing) continue;
    listingByKey.set(item.key, decorateListing({
      ...listing,
      ...candidate,
      sid: item.sid,
      msku: item.msku,
      mskuKey: item.mskuKey,
      storeName: context.sellers.get(item.sid)?.name || "",
      country: context.sellers.get(item.sid)?.country || "",
      sourceUpdatedAtMs: listing.sourceUpdatedAtMs || context.now,
    }, item, context.sellers.get(item.sid), listing.sourceUpdatedAtMs || context.now));
  }
  return listingByKey;
}

function assertCompleteListings(scope, listingByKey, requestId) {
  const missing = scope.filter((item) => !listingHasInternalSku(listingByKey.get(item.key)));
  if (missing.length) throw unresolvedError("ERP Listing", missing.length, requestId);
}

function uniqueText(values) {
  const seen = new Set();
  return values.map((value) => String(value ?? "").trim()).filter((value) => {
    const key = normalizeCatalogKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchProductBatch(context, params, fallback, stats) {
  const lookup = context.options.fetchProductRecords || fetchLingxingProductRecords;
  try {
    return await lookup(context.adapter, params, fallback, {
      strict: true,
      ...(context.options.productLookupOptions || {}),
    });
  } catch (error) {
    throw wrapUpstream(error, "ERP 产品管理查询失败。", context.requestId);
  } finally {
    stats.productLookupBatchCount += 1;
  }
}

async function fetchAllProducts(scope, listingByKey, context, stats) {
  const listings = scope.map((item) => listingByKey.get(item.key));
  const skuValues = uniqueText(listings.map((listing) => listing.internalSku));
  const records = [];
  for (let index = 0; index < skuValues.length; index += PRODUCT_BATCH_SIZE) {
    const batch = skuValues.slice(index, index + PRODUCT_BATCH_SIZE);
    records.push(...await fetchProductBatch(context, { skus: batch }, { sku_list: batch }, stats));
  }
  const byIdentifier = new Map();
  const addNormalizedProducts = (nextRecords) => {
    for (const record of Array.isArray(nextRecords) ? nextRecords : []) {
      const product = normalizeCatalogProduct(record);
      if (!product) continue;
      [product.internalSku, product.productId, product.skuIdentifier]
        .map(normalizeCatalogKey)
        .filter(Boolean)
        .forEach((key) => {
          if (!byIdentifier.has(key)) byIdentifier.set(key, product);
        });
    }
  };
  addNormalizedProducts(records);
  const productsByKey = new Map();
  const unresolvedListings = () => listings.filter((listing) => {
    const internalSkuKey = normalizeCatalogKey(listing.internalSku);
    if (productsByKey.has(internalSkuKey)) return false;
    const product = [listing.internalSku, listing.productId, listing.skuIdentifier]
      .map(normalizeCatalogKey)
      .filter(Boolean)
      .map((key) => byIdentifier.get(key))
      .find(Boolean);
    if (product) productsByKey.set(internalSkuKey, product);
    return !productsByKey.has(internalSkuKey);
  });
  let unresolved = unresolvedListings();
  // Product IDs and sku identifiers are fallback lookups.  Once the ordinary
  // internal-SKU query resolves every requested product, do not issue
  // redundant upstream calls for aliases that happened to be present on the
  // Listing response.
  const skuIdentifierValues = uniqueText(unresolved.map((listing) => listing.skuIdentifier));
  for (let index = 0; index < skuIdentifierValues.length; index += PRODUCT_BATCH_SIZE) {
    const batch = skuIdentifierValues.slice(index, index + PRODUCT_BATCH_SIZE);
    const nextRecords = await fetchProductBatch(context, { sku_identifiers: batch }, { sku_identifier_list: batch }, stats);
    addNormalizedProducts(nextRecords);
  }
  unresolved = unresolvedListings();
  const productIdValues = uniqueText(unresolved.map((listing) => listing.productId));
  for (let index = 0; index < productIdValues.length; index += PRODUCT_BATCH_SIZE) {
    const batch = productIdValues.slice(index, index + PRODUCT_BATCH_SIZE);
    const nextRecords = await fetchProductBatch(context, { product_ids: batch }, { product_id_list: batch }, stats);
    addNormalizedProducts(nextRecords);
  }
  unresolvedListings();
  stats.productFetchedCount = productsByKey.size;
  return productsByKey;
}

function assertCompleteProducts(scope, listingByKey, productsByKey, requestId) {
  const missing = scope.filter((item) => {
    const listing = listingByKey.get(item.key);
    return !productsByKey.has(normalizeCatalogKey(listing?.internalSku));
  });
  if (missing.length) throw unresolvedError("ERP 产品管理", missing.length, requestId);
}

function buildRepositoryBatch(scope, listingByKey, productsByKey, context) {
  const products = new Map();
  const listings = new Map();
  const aliases = new Map();
  for (const item of scope) {
    const listing = listingByKey.get(item.key);
    const product = productsByKey.get(normalizeCatalogKey(listing.internalSku));
    const listingSourceUpdatedAtMs = sourceUpdatedAtMs(listing, context.now);
    const productSourceUpdatedAtMs = sourceUpdatedAtMs(product, listingSourceUpdatedAtMs);
    const rows = catalogProductToRepositoryRows({
      product,
      listing,
      source: LIVE_PRODUCT_SOURCE,
      sourceUpdatedAtMs: productSourceUpdatedAtMs,
      refreshedAtMs: context.now,
    });
    rows.products.forEach((row) => products.set(row.internalSkuKey, row));
    rows.listings.forEach((row) => listings.set(`${row.sid}:${row.mskuKey}`, {
      ...row,
      source: LIVE_LISTING_SOURCE,
      sourceUpdatedAtMs: listingSourceUpdatedAtMs,
      refreshedAtMs: context.now,
    }));
    rows.aliases.forEach((row) => aliases.set(
      `${row.aliasType}:${row.aliasKey}:${row.internalSkuKey}`,
      row,
    ));
  }
  return {
    products: [...products.values()],
    aliases: [...aliases.values()],
    listings: [...listings.values()],
  };
}

async function loadAndCommitScope(scope, context) {
  const startedAtMs = Date.now();
  const stats = {
    listingFetchedCount: 0,
    productFetchedCount: 0,
    productLookupBatchCount: 0,
  };
  const listingByKey = await fetchAllListings(scope, context, stats);
  await fillMissingInternalSkusFromSharedXlsx(scope, listingByKey, context);
  assertCompleteListings(scope, listingByKey, context.requestId);
  const productsByKey = await fetchAllProducts(scope, listingByKey, context, stats);
  assertCompleteProducts(scope, listingByKey, productsByKey, context.requestId);
  const batch = buildRepositoryBatch(scope, listingByKey, productsByKey, context);
  let write;
  try {
    write = context.repository.upsertCatalog({
      ...batch,
      operation: context.operation || "catalog-refresh",
      requestId: context.requestId,
    });
  } catch (error) {
    if (error instanceof ProductCatalogConflictError || error instanceof ProductCatalogInputError) throw error;
    throw new ProductCatalogUpstreamError("商品目录数据库写入失败。", {
      statusCode: 503,
      details: { requestId: context.requestId },
      cause: error,
    });
  }
  return {
    revision: write.revision,
    transactionDurationMs: elapsedMs(startedAtMs),
    listingFetchedCount: stats.listingFetchedCount,
    productFetchedCount: stats.productFetchedCount,
  };
}

async function runScopeSingleFlight(scope, context, feature, operation) {
  const key = `${feature}:${scopeKey(scope)}`;
  const existing = refreshInFlight.get(key);
  if (existing) {
    const result = await existing;
    return {
      ...result,
      joinedInFlight: true,
    };
  }
  const promise = (async () => {
    context.operation = operation;
    return loadAndCommitScope(scope, context);
  })();
  refreshInFlight.set(key, promise);
  try {
    const result = await promise;
    return { ...result, joinedInFlight: false };
  } finally {
    if (refreshInFlight.get(key) === promise) refreshInFlight.delete(key);
  }
}

function decorateRecord(row, scopeItem, seller) {
  const listing = row?.listing ? {
    ...row.listing,
    sid: scopeItem.sid,
    msku: scopeItem.msku,
    mskuKey: scopeItem.mskuKey,
    storeName: seller?.name || "",
    country: seller?.country || "",
  } : null;
  const product = row?.product ? { ...row.product } : null;
  return {
    ...(product || {}),
    ...(listing || {}),
    sid: scopeItem.sid,
    msku: scopeItem.msku,
    mskuKey: scopeItem.mskuKey,
    storeName: seller?.name || "",
    country: seller?.country || "",
    internalSku: product?.internalSku || listing?.internalSku || "",
    internalSkuKey: product?.internalSkuKey || listing?.internalSkuKey || null,
    product,
    listing,
  };
}

function recordsForScope(scope, repository, sellers) {
  const rows = repository.readScope(scope);
  const byKey = new Map(rows.map((row) => [listingKey(row.listing), row]));
  return scope.map((item) => decorateRecord(byKey.get(item.key), item, sellers.get(item.sid)));
}

function latestRefreshedAt(records) {
  const values = records.flatMap((record) => [record.listing?.refreshedAtMs, record.product?.refreshedAtMs])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return "";
  return new Date(Math.max(...values)).toISOString();
}

function ensureRowsComplete(scope, repository) {
  const rows = repository.readScope(scope);
  const complete = new Set(rows
    .filter((row) => row?.listing && row?.product)
    .map((row) => listingKey(row.listing)));
  return scope.filter((item) => !complete.has(item.key));
}

export async function getProductCatalogForRows(rows, options = {}) {
  const startedAtMs = Date.now();
  const requestId = requestIdFrom(options);
  const scope = normalizeScope(rows);
  let context;
  try {
    context = await buildContext(scope, options, requestId);
  } catch (error) {
    writeLog(options.logger || console, "error", {
      requestId,
      feature: options.feature || "catalog-lookup",
      operation: "lookup",
      status: "error",
      scopeCount: scope.length,
      elapsedMs: elapsedMs(startedAtMs),
    });
    throw error;
  }
  let migration;
  try {
    migration = await ensureMigrated(context.repository, context.sellers, options, requestId);
  } catch (error) {
    writeLog(options.logger || console, "error", {
      requestId,
      feature: options.feature || "catalog-lookup",
      operation: "lookup",
      status: "error",
      scopeCount: scope.length,
      elapsedMs: elapsedMs(startedAtMs),
    });
    throw error;
  }
  const missing = ensureRowsComplete(scope, context.repository);
  const meta = {
    requestId,
    revision: context.repository.getRevision(),
    dbHitCount: scope.length - missing.length,
    legacyMigratedCount: Number(migration?.listingCount || 0),
    listingFetchedCount: 0,
    productFetchedCount: 0,
    missingCount: missing.length,
    conflictCount: Number(migration?.conflictCount || 0),
    source: missing.length ? "lingxing" : "sqlite",
  };
  if (missing.length) {
    if (options.allowFetchMissing === false) {
      const error = unresolvedError("商品目录", missing.length, requestId);
      writeLog(options.logger || console, "error", {
        requestId,
        feature: options.feature || "catalog-lookup",
        operation: "lookup",
        status: "error",
        scopeCount: scope.length,
        elapsedMs: elapsedMs(startedAtMs),
      });
      throw error;
    }
    let load;
    try {
      load = await runScopeSingleFlight(
        missing,
        { ...context },
        options.feature || "catalog-lookup",
        "initial-fill",
      );
    } catch (error) {
      writeLog(options.logger || console, "error", {
        requestId,
        feature: options.feature || "catalog-lookup",
        operation: "lookup",
        status: "error",
        scopeCount: scope.length,
        elapsedMs: elapsedMs(startedAtMs),
      });
      throw error;
    }
    meta.revision = load.revision;
    meta.listingFetchedCount = load.listingFetchedCount;
    meta.productFetchedCount = load.productFetchedCount;
  }
  const records = recordsForScope(scope, context.repository, context.sellers);
  meta.cacheUpdatedAt = latestRefreshedAt(records);
  meta.elapsedMs = elapsedMs(startedAtMs);
  writeLog(options.logger || console, "info", {
    ...meta,
    feature: options.feature || "catalog-lookup",
    operation: "lookup",
    status: "success",
    scopeCount: scope.length,
    listingCount: meta.listingFetchedCount,
    productCount: meta.productFetchedCount,
  });
  return { records, meta };
}

export async function refreshProductCatalogScope(input = {}, options = {}) {
  const startedAtMs = Date.now();
  const requestId = requestIdFrom(options);
  const feature = String(input?.feature || options.feature || "catalog").trim() || "catalog";
  const scope = normalizeScope(input?.items);
  let context;
  try {
    context = await buildContext(scope, options, requestId);
  } catch (error) {
    writeLog(options.logger || console, "error", {
      requestId,
      feature,
      operation: "manual-refresh",
      status: "error",
      scopeCount: scope.length,
      elapsedMs: elapsedMs(startedAtMs),
    });
    throw error;
  }
  const key = `${feature}:${scopeKey(scope)}`;
  const existing = refreshInFlight.get(key);
  if (existing) {
    try {
      const joined = await existing;
      const records = recordsForScope(scope, context.repository, context.sellers);
      const meta = {
        requestId: joined.requestId || requestId,
        revision: joined.revision,
        refreshRequestedCount: scope.length,
        refreshCommittedCount: scope.length,
        joinedInFlight: true,
        transactionDurationMs: joined.transactionDurationMs,
        elapsedMs: elapsedMs(startedAtMs),
      };
      return { ok: true, records, meta };
    } catch (error) {
      throw error;
    }
  }
  const ownerPromise = (async () => {
    let status = "success";
    try {
      await ensureMigrated(context.repository, context.sellers, options, requestId);
      const load = await loadAndCommitScope(scope, {
        ...context,
        operation: "manual-refresh",
      });
      const records = recordsForScope(scope, context.repository, context.sellers);
      return {
        requestId,
        revision: load.revision,
        records,
        refreshRequestedCount: scope.length,
        refreshCommittedCount: scope.length,
        joinedInFlight: false,
        transactionDurationMs: load.transactionDurationMs,
        listingFetchedCount: load.listingFetchedCount,
        productFetchedCount: load.productFetchedCount,
      };
    } catch (error) {
      status = "error";
      throw error;
    } finally {
      writeLog(options.logger || console, "info", {
        requestId,
        feature,
        operation: "manual-refresh",
        status,
        scopeCount: scope.length,
        elapsedMs: elapsedMs(startedAtMs),
      });
    }
  })();
  refreshInFlight.set(key, ownerPromise);
  try {
    const result = await ownerPromise;
    return {
      ok: true,
      records: result.records,
      meta: {
        requestId: result.requestId,
        revision: result.revision,
        refreshRequestedCount: result.refreshRequestedCount,
        refreshCommittedCount: result.refreshCommittedCount,
        joinedInFlight: false,
        transactionDurationMs: result.transactionDurationMs,
        listingFetchedCount: result.listingFetchedCount,
        productFetchedCount: result.productFetchedCount,
        elapsedMs: elapsedMs(startedAtMs),
      },
    };
  } finally {
    if (refreshInFlight.get(key) === ownerPromise) refreshInFlight.delete(key);
  }
}

export function getProductCatalogRevision(options = {}) {
  return repositoryFor(options).getRevision();
}

export function getProductCatalogHealth(options = {}) {
  try {
    return repositoryFor(options).getHealth();
  } catch (error) {
    const code = error?.code || error?.name || "PRODUCT_CATALOG_HEALTH_ERROR";
    return {
      ok: false,
      status: "degraded",
      schemaVersion: null,
      quickCheck: "unavailable",
      error: String(code).slice(0, 120),
    };
  }
}

export async function closeProductCatalogRepositoryForTests() {
  const repository = defaultRepository;
  defaultRepository = null;
  migrationPromises = new WeakMap();
  refreshInFlight.clear();
  if (repository && typeof repository.close === "function") repository.close();
}

import path from "node:path";

import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import {
  ProductCatalogConflictError,
  ProductCatalogInputError,
  normalizeCatalogKey,
  normalizeProductCatalogScope,
} from "./productCatalogIdentity.js";
import { migrateLegacyProductCatalog } from "./productCatalogLegacyMigrationService.js";
import { createProductCatalogRepository } from "./productCatalogRepository.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { loadAndCommitScope } from "./productCatalogLiveLoader.js";

let defaultRepository = null;
let migrationPromises = new WeakMap();
let dependencyTokens = new WeakMap();
const refreshInFlight = new Map();
let requestSequence = 0;
let dependencyTokenSequence = 0;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const REQUEST_ID_SENSITIVE_PATTERN = /(token|secret|password|payload|raw|body)/i;
const SAFE_ERROR_NAMES = new Set([
  "Error",
  "ProductCatalogUpstreamError",
  "ProductCatalogInputError",
  "ProductCatalogConflictError",
]);
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_ERROR_CODE_SENSITIVE_PATTERN = /(token|secret|password|payload|raw|body)/i;

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
  if (!Number.isFinite(resolved) || resolved <= 0) throw new ProductCatalogInputError("商品目录时间无效。");
  return resolved;
}

function elapsedMs(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

function requestIdFrom(options = {}) {
  let supplied = "";
  try {
    supplied = String(options?.requestId || "").trim();
  } catch {
    supplied = "";
  }
  if (REQUEST_ID_PATTERN.test(supplied) && !REQUEST_ID_SENSITIVE_PATTERN.test(supplied)) return supplied;
  requestSequence += 1;
  return `catalog-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function createRequestContext(options, feature, operation) {
  return {
    options,
    feature,
    operation,
    requestId: requestIdFrom(options),
    startedAtMs: Date.now(),
    scopeCount: 0,
    migrationCompleted: false,
  };
}

function normalizedStatusCode(error) {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

function safeErrorName(error) {
  const name = String(error?.name || "Error");
  return SAFE_ERROR_NAMES.has(name) ? name : "Error";
}

function safeErrorCode(error) {
  const code = String(error?.code ?? "");
  return SAFE_ERROR_CODE_PATTERN.test(code) && !SAFE_ERROR_CODE_SENSITIVE_PATTERN.test(code) ? code : null;
}

function safeErrorMessage(error) {
  if (error instanceof ProductCatalogConflictError) return "商品目录冲突。";
  if (error instanceof ProductCatalogInputError) return "商品目录输入无效。";
  if (error instanceof ProductCatalogUpstreamError) {
    const knownMessages = new Set([
      "ERP Listing 查询失败。",
      "Listing 共享目录读取失败。",
      "ERP 产品管理查询失败。",
      "商品目录数据库写入失败。",
      "运行时店铺目录读取失败。",
      "旧商品目录迁移失败。",
      "商品目录数据库不可用。",
      "商品目录上游失败。",
    ]);
    const message = String(error.message || "");
    if (knownMessages.has(message)) return message;
    return "商品目录上游失败。";
  }
  return "商品目录操作失败。";
}

function writeLog(logger, level, context, status, error = null, extra = {}) {
  const method = logger?.[level];
  if (typeof method !== "function") return;
  const details = {
    requestId: context.requestId,
    feature: context.feature,
    operation: context.operation,
    status,
    scopeCount: context.scopeCount,
    elapsedMs: elapsedMs(context.startedAtMs),
    ...extra,
  };
  if (error) {
    details.statusCode = normalizedStatusCode(error);
    details.errorName = safeErrorName(error);
    details.errorCode = safeErrorCode(error);
    details.errorMessage = safeErrorMessage(error);
  }
  method.call(logger, "[product-catalog-service]", details);
}

function attachError(error, context, extra = {}) {
  if (!error || typeof error !== "object") {
    error = new ProductCatalogUpstreamError(String(error || "商品目录操作失败。"));
  }
  const prior = error.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? error.details
    : {};
  error.statusCode = normalizedStatusCode(error);
  error.message = safeErrorMessage(error);
  error.details = {
    ...prior,
    ...(context.migrationCompleted !== undefined && prior.migrationCompleted === undefined
      ? { migrationCompleted: context.migrationCompleted }
      : {}),
    ...(context.catalogRevisionBeforeRefresh !== undefined && prior.catalogRevisionBeforeRefresh === undefined
      ? { catalogRevisionBeforeRefresh: context.catalogRevisionBeforeRefresh }
      : {}),
    ...extra,
    requestId: context.requestId,
  };
  return error;
}

function wrapUpstream(error, message, context, operation) {
  if (error instanceof ProductCatalogUpstreamError
    || error instanceof ProductCatalogInputError
    || error instanceof ProductCatalogConflictError) {
    return attachError(error, context, { operation: error.details?.operation || operation });
  }
  return attachError(new ProductCatalogUpstreamError(message, {
    statusCode: 502,
    details: { operation },
    cause: error,
  }), context);
}

function unresolvedError(kind, count, context) {
  return attachError(new ProductCatalogUpstreamError(
    `${kind} 无法解析，仍有 ${count} 个商品缺少必要资料。`,
    { statusCode: 422, details: { operation: "resolution", unresolvedCount: count } },
  ), context);
}

function databaseError(error, message, context, operation) {
  return attachError(new ProductCatalogUpstreamError(message, {
    statusCode: 503,
    details: { operation },
    cause: error,
  }), context);
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
  return String(seller?.name ?? seller?.storeName ?? seller?.store_name
    ?? seller?.seller_name ?? seller?.shop_name ?? "").trim();
}

function sellerCountry(seller) {
  return String(seller?.country ?? seller?.countryName ?? seller?.country_name
    ?? seller?.marketplace ?? seller?.region ?? "").trim();
}

async function resolveScopeSellers(scope, context, adapter) {
  const options = context.options;
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
      throw wrapUpstream(error, "运行时店铺目录读取失败。", context, "seller-directory");
    }
  }
  const sellers = Array.isArray(directory) ? directory : directory?.sellers;
  const bySid = new Map();
  (Array.isArray(sellers) ? sellers : []).forEach((seller) => {
    const sid = sellerSid(seller);
    if (!sid) return;
    bySid.set(sid, { sid, name: sellerName(seller), country: sellerCountry(seller) });
  });
  const unknown = [...new Set(scope.map((item) => item.sid).filter((sid) => !bySid.has(sid)))];
  if (unknown.length) {
    throw attachError(new ProductCatalogInputError(
      `SID ${unknown.join(", ")} 不在运行时店铺目录。`,
      { details: { operation: "seller-directory", unknownSidCount: unknown.length } },
    ), context);
  }
  return bySid;
}

function normalizeScope(items, context) {
  try {
    return normalizeProductCatalogScope(items, { maxItems: 500 });
  } catch (error) {
    throw attachError(error, context, { operation: "scope-normalization" });
  }
}

function scopeKey(scope) {
  return scope.map((item) => item.key).sort().join(",");
}

function identityToken(value) {
  if (value === null || value === undefined) return "none";
  if (typeof value !== "object" && typeof value !== "function") return String(value);
  let token = dependencyTokens.get(value);
  if (!token) {
    dependencyTokenSequence += 1;
    token = `dep-${dependencyTokenSequence}`;
    dependencyTokens.set(value, token);
  }
  return token;
}

function flightKey(scope, context) {
  const options = context.options;
  const dependencies = [
    context.repository,
    context.adapter,
    options.sellers || options.sellerDirectory || options.getSellerDirectory || options.getDirectory || getSellerDirectory,
    options.ensureMigrated || options.migrateLegacyProductCatalog || migrateLegacyProductCatalog,
    options.fetchListingsBySidMskus || "default-listing-lookup",
    options.fetchProductRecords || "default-product-lookup",
    options.readListingSharedCatalog || options.readListingSharedCatalogRecords || "default-shared-xlsx-reader",
    options.findListingSharedCatalogMatches || "default-shared-xlsx-matcher",
    options.migrationOptions || "default-migration-options",
    options.listingSharedCatalogRecords || "default-shared-xlsx-records",
    options.listingLookupOptions || "default-listing-options",
    options.productLookupOptions || "default-product-options",
  ].map(identityToken).join("|");
  return `${context.feature}:${scopeKey(scope)}:${dependencies}`;
}

async function ensureMigrated(repository, sellers, context) {
  if (context.options.skipMigration === true) return { skipped: true, listingCount: 0, productCount: 0 };
  const existing = migrationPromises.get(repository);
  if (existing) return existing;
  const migrate = context.options.ensureMigrated
    || context.options.migrateLegacyProductCatalog
    || migrateLegacyProductCatalog;
  const migrationOptions = context.options.migrationOptions && typeof context.options.migrationOptions === "object"
    ? context.options.migrationOptions
    : {};
  const promise = Promise.resolve().then(() => migrate({
    ...migrationOptions,
    repository,
    sellers: [...sellers.values()],
    adapter: context.adapter,
    logger: context.options.logger || console,
    now: context.options.now || Date.now,
    sharedDir: context.options.sharedDir,
    supplierDir: context.options.supplierDir,
    requireSellerCache: context.options.requireSellerCache,
  }));
  migrationPromises.set(repository, promise);
  promise.catch(() => {
    if (migrationPromises.get(repository) === promise) migrationPromises.delete(repository);
  });
  try {
    return await promise;
  } catch (error) {
    throw wrapUpstream(error, "旧商品目录迁移失败。", context, "legacy-migration");
  }
}

async function buildContext(scope, context) {
  let repository;
  try {
    repository = repositoryFor(context.options);
  } catch (error) {
    throw databaseError(error, "商品目录数据库不可用。", context, "repository-bootstrap");
  }
  const adapter = context.options.adapter || getLingxingAdapter(context.options.lingxingConfig);
  const sellers = await resolveScopeSellers(scope, context, adapter);
  const built = {
    ...context,
    repository,
    adapter,
    sellers,
    now: nowMs(context.options),
    elapsedMs,
  };
  // Loader callbacks must observe mutable refresh state (migrationCompleted,
  // catalogRevisionBeforeRefresh) updated after the bootstrap phase. Closing
  // over the original request context would preserve stale defaults in error
  // details and logs.
  built.wrapUpstream = (error, message, _requestId, operation) => wrapUpstream(error, message, built, operation);
  built.unresolvedError = (kind, count) => unresolvedError(kind, count, built);
  built.attachError = (error, extra) => attachError(error, built, extra);
  built.databaseError = (error, message, operation) => databaseError(error, message, built, operation);
  return built;
}

function listingKey(listing) {
  const sid = Number(listing?.sid || 0);
  const mskuKey = normalizeCatalogKey(listing?.mskuKey || listing?.msku);
  return sid > 0 && mskuKey ? `${sid}:${mskuKey}` : "";
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
  if (listing && product) {
    if (listing.productId === undefined) listing.productId = product.productId || "";
    if (listing.skuIdentifier === undefined) listing.skuIdentifier = product.skuIdentifier || "";
  }
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
  return values.length ? new Date(Math.max(...values)).toISOString() : "";
}

function ensureRowsComplete(scope, repository) {
  const rows = repository.readScope(scope);
  const complete = new Set(rows.filter((row) => row?.listing && row?.product).map((row) => listingKey(row.listing)));
  return scope.filter((item) => !complete.has(item.key));
}

async function runScopeSingleFlight(scope, context, operation) {
  const key = flightKey(scope, context);
  const existing = refreshInFlight.get(key);
  if (existing) return { ...(await existing), joinedInFlight: true };
  const promise = (async () => {
    const loadContext = { ...context, operation };
    return loadAndCommitScope(scope, loadContext);
  })();
  refreshInFlight.set(key, promise);
  try {
    return { ...(await promise), joinedInFlight: false };
  } finally {
    if (refreshInFlight.get(key) === promise) refreshInFlight.delete(key);
  }
}

export async function getProductCatalogForRows(rows, options = {}) {
  const context = createRequestContext(options, options.feature || "catalog-lookup", "lookup");
  let scope;
  try {
    scope = normalizeScope(rows, context);
    context.scopeCount = scope.length;
    const built = await buildContext(scope, context);
    const migration = await ensureMigrated(built.repository, built.sellers, built);
    const missing = ensureRowsComplete(scope, built.repository);
    const meta = {
      requestId: context.requestId,
      revision: built.repository.getRevision(),
      dbHitCount: scope.length - missing.length,
      legacyMigratedCount: Number(migration?.listingCount || 0),
      listingFetchedCount: 0,
      listingSharedXlsxCount: 0,
      sharedListingItems: 0,
      productFetchedCount: 0,
      listingBatchCount: 0,
      listingRequestCount: 0,
      productLookupBatchCount: 0,
      productInfoRequestCount: 0,
      productFallbackRequestCount: 0,
      joinedInFlight: false,
      transactionDurationMs: 0,
      missingCount: missing.length,
      conflictCount: Number(migration?.conflictCount || 0),
      source: missing.length ? "lingxing" : "sqlite",
    };
    if (missing.length) {
      if (options.allowFetchMissing === false) throw unresolvedError("商品目录", missing.length, built);
      const load = await runScopeSingleFlight(missing, built, "initial-fill");
      meta.revision = load.revision;
      meta.listingFetchedCount = load.listingFetchedCount;
      meta.listingSharedXlsxCount = load.listingSharedXlsxCount;
      meta.sharedListingItems = load.listingSharedXlsxCount;
      meta.productFetchedCount = load.productFetchedCount;
      meta.listingBatchCount = load.listingBatchCount;
      meta.listingRequestCount = load.listingRequestCount;
      meta.productLookupBatchCount = load.productLookupBatchCount;
      meta.productInfoRequestCount = load.productInfoRequestCount;
      meta.productFallbackRequestCount = load.productFallbackRequestCount;
      meta.joinedInFlight = load.joinedInFlight;
      meta.transactionDurationMs = load.transactionDurationMs;
    }
    const records = recordsForScope(scope, built.repository, built.sellers);
    meta.cacheUpdatedAt = latestRefreshedAt(records);
    meta.elapsedMs = elapsedMs(context.startedAtMs);
    writeLog(options.logger || console, "info", context, "success", null, {
      listingCount: meta.listingFetchedCount,
      productCount: meta.productFetchedCount,
    });
    return { records, meta };
  } catch (error) {
    const attached = attachError(error, context);
    writeLog(options.logger || console, "error", context, "error", attached);
    throw attached;
  }
}

export async function refreshProductCatalogScope(input = {}, options = {}) {
  const feature = String(input?.feature || options.feature || "catalog").trim() || "catalog";
  const context = createRequestContext(options, feature, "manual-refresh");
  let scope;
  let built;
  try {
    scope = normalizeScope(input?.items, context);
    context.scopeCount = scope.length;
    built = await buildContext(scope, context);
    const key = flightKey(scope, built);
    const existing = refreshInFlight.get(key);
    if (existing) {
      const joined = await existing;
      const records = recordsForScope(scope, built.repository, built.sellers);
      writeLog(options.logger || console, "info", context, "success", null, {
        refreshRequestedCount: scope.length,
        refreshCommittedCount: scope.length,
        joinedInFlight: true,
        listingSharedXlsxCount: joined.listingSharedXlsxCount,
      });
      return {
        ok: true,
        records,
        meta: {
          requestId: joined.requestId || context.requestId,
          revision: joined.revision,
          refreshRequestedCount: scope.length,
          refreshCommittedCount: scope.length,
          joinedInFlight: true,
          transactionDurationMs: joined.transactionDurationMs,
          listingFetchedCount: joined.listingFetchedCount,
          productFetchedCount: joined.productFetchedCount,
          listingBatchCount: joined.listingBatchCount,
          listingRequestCount: joined.listingRequestCount,
          productLookupBatchCount: joined.productLookupBatchCount,
          productInfoRequestCount: joined.productInfoRequestCount,
          productFallbackRequestCount: joined.productFallbackRequestCount,
          listingSharedXlsxCount: joined.listingSharedXlsxCount,
          sharedListingItems: joined.listingSharedXlsxCount,
          migrationCompleted: true,
          catalogRevisionBeforeRefresh: joined.catalogRevisionBeforeRefresh,
          elapsedMs: elapsedMs(context.startedAtMs),
        },
      };
    }
    const ownerPromise = (async () => {
      try {
        await ensureMigrated(built.repository, built.sellers, built);
        built.migrationCompleted = true;
        built.catalogRevisionBeforeRefresh = built.repository.getRevision();
        const load = await loadAndCommitScope(scope, { ...built, operation: "manual-refresh" });
        const records = recordsForScope(scope, built.repository, built.sellers);
        return {
          requestId: context.requestId,
          revision: load.revision,
          records,
          refreshRequestedCount: scope.length,
          refreshCommittedCount: scope.length,
          joinedInFlight: false,
          transactionDurationMs: load.transactionDurationMs,
          listingFetchedCount: load.listingFetchedCount,
          productFetchedCount: load.productFetchedCount,
          listingBatchCount: load.listingBatchCount,
          listingRequestCount: load.listingRequestCount,
          productLookupBatchCount: load.productLookupBatchCount,
          productInfoRequestCount: load.productInfoRequestCount,
          productFallbackRequestCount: load.productFallbackRequestCount,
          listingSharedXlsxCount: load.listingSharedXlsxCount,
          catalogRevisionBeforeRefresh: built.catalogRevisionBeforeRefresh,
          migrationCompleted: true,
        };
      } catch (error) {
        throw attachError(error, built);
      }
    })();
    refreshInFlight.set(key, ownerPromise);
    try {
      const result = await ownerPromise;
      writeLog(options.logger || console, "info", context, "success", null, {
        refreshRequestedCount: result.refreshRequestedCount,
        refreshCommittedCount: result.refreshCommittedCount,
        joinedInFlight: false,
        listingSharedXlsxCount: result.listingSharedXlsxCount,
      });
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
          listingBatchCount: result.listingBatchCount,
          listingRequestCount: result.listingRequestCount,
          productLookupBatchCount: result.productLookupBatchCount,
          productInfoRequestCount: result.productInfoRequestCount,
          productFallbackRequestCount: result.productFallbackRequestCount,
          listingSharedXlsxCount: result.listingSharedXlsxCount,
          sharedListingItems: result.listingSharedXlsxCount,
          migrationCompleted: result.migrationCompleted,
          catalogRevisionBeforeRefresh: result.catalogRevisionBeforeRefresh,
          elapsedMs: elapsedMs(context.startedAtMs),
        },
      };
    } finally {
      if (refreshInFlight.get(key) === ownerPromise) refreshInFlight.delete(key);
    }
  } catch (error) {
    const attached = attachError(error, built || context);
    writeLog(options.logger || console, "error", context, "error", attached);
    throw attached;
  }
}

export function getProductCatalogRevision(options = {}) {
  const context = createRequestContext(options, options.feature || "catalog", "revision");
  try {
    const revision = repositoryFor(options).getRevision();
    writeLog(options.logger || console, "info", context, "success", null, { revision });
    return revision;
  } catch (error) {
    const attached = attachError(error, context);
    writeLog(options.logger || console, "error", context, "error", attached);
    throw attached;
  }
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
  dependencyTokens = new WeakMap();
  dependencyTokenSequence = 0;
  refreshInFlight.clear();
  if (repository && typeof repository.close === "function") repository.close();
}

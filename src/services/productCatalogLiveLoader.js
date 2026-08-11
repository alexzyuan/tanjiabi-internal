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
} from "./productCatalogIdentity.js";

export const LISTING_BATCH_SIZE = 50;
export const PRODUCT_BATCH_SIZE = 80;
export const LIVE_LISTING_SOURCE = "lingxing-listing";
export const SHARED_LISTING_XLSX_SOURCE = "listing-shared-xlsx";
export const LIVE_PRODUCT_SOURCE = "lingxing-product";

function elapsedMs(startedAtMs) {
  return typeof startedAtMs === "number"
    ? Math.max(0, Date.now() - startedAtMs)
    : 0;
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

function decorateListing(listing, scopeItem, seller, sourceUpdatedAt, source = LIVE_LISTING_SOURCE) {
  return {
    ...listing,
    sid: scopeItem.sid,
    msku: scopeItem.msku,
    mskuKey: scopeItem.mskuKey,
    storeName: seller?.name || "",
    country: seller?.country || "",
    source,
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

async function fetchAllListings(scope, context, stats) {
  const rowsByKey = new Map();
  const bySid = new Map();
  scope.forEach((item) => {
    if (!bySid.has(item.sid)) bySid.set(item.sid, []);
    bySid.get(item.sid).push(item);
  });
  const lookup = context.options.fetchListingsBySidMskus || fetchLingxingListingsBySidMskus;
  const lookupMetrics = {
    increment(name, value = 1) {
      if (name === "lingxingListingRequests") stats.listingRequestCount += Number(value) || 0;
    },
  };
  for (const [sid, items] of bySid.entries()) {
    const mskus = items.map((item) => item.msku);
    stats.listingBatchCount += Math.ceil(mskus.length / LISTING_BATCH_SIZE);
    let records;
    try {
      records = await lookup(context.adapter, sid, mskus, {
        batchSize: LISTING_BATCH_SIZE,
        strict: true,
        sidVariants: context.options.sidVariants,
        ...(context.options.listingLookupOptions || {}),
        metrics: lookupMetrics,
      });
    } catch (error) {
      throw context.wrapUpstream(error, "ERP Listing 查询失败。", context.requestId, "listing-fetch");
    }
    for (const record of Array.isArray(records) ? records : []) {
      const normalized = normalizeCatalogListing(record, { fallbackSid: sid });
      if (!normalized || Number(normalized.sid) !== Number(sid)) continue;
      const mskuKey = normalizeCatalogKey(normalized.msku);
      const scopeItem = items.find((item) => item.mskuKey === mskuKey);
      if (!scopeItem) continue;
      const decorated = decorateListing(
        normalized,
        scopeItem,
        context.sellers.get(scopeItem.sid),
        sourceUpdatedAtMs(record, context.now),
      );
      rowsByKey.set(scopeItem.key, decorated);
    }
  }
  stats.listingFetchedCount = rowsByKey.size;
  return rowsByKey;
}

async function fillMissingInternalSkusFromSharedXlsx(scope, listingByKey, context, stats) {
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
    throw context.wrapUpstream(error, "Listing 共享目录读取失败。", context.requestId, "listing-shared-xlsx-read");
  }
  const matcher = context.options.findListingSharedCatalogMatches || findListingSharedCatalogMatches;
  for (const item of unresolved) {
    const listing = listingByKey.get(item.key);
    // SID+MSKU has already been proven by the live Listing response.  Do not
    // compare historical workbook display aliases with canonical seller names.
    const candidates = matcher([item], records);
    const candidateList = Array.isArray(candidates) ? candidates : [];
    const candidate = candidateList.find((value) => listingKey(value) === item.key)
      || (candidateList.length === 1 && normalizeCatalogKey(candidateList[0]?.msku) === item.mskuKey
        ? candidateList[0]
        : null);
    if (!candidate || !listing || !listingHasInternalSku(candidate)) continue;

    // The workbook is only an internal-SKU supplement. Preserve every API
    // Listing field (ASIN/product ID/identifier/etc.); copy local_sku only
    // when the normalization proved its ERP-local provenance.
    const supplemented = {
      ...listing,
      internalSku: candidate.internalSku,
      sku: candidate.internalSku,
      internalSkuSourceField: candidate.internalSkuSourceField === "local_sku"
        ? "local_sku"
        : listing.internalSkuSourceField,
      source: SHARED_LISTING_XLSX_SOURCE,
    };
    if (candidate.listingSkuSourceField === "local_sku" && candidate.listingSku) {
      supplemented.listingSku = candidate.listingSku;
      supplemented.listingSkuSourceField = "local_sku";
    }
    listingByKey.set(item.key, decorateListing(
      supplemented,
      item,
      context.sellers.get(item.sid),
      listing.sourceUpdatedAtMs || context.now,
      SHARED_LISTING_XLSX_SOURCE,
    ));
    stats.listingSharedXlsxCount += 1;
  }
  return listingByKey;
}

function assertCompleteListings(scope, listingByKey, context) {
  const missing = scope.filter((item) => !listingHasInternalSku(listingByKey.get(item.key)));
  if (missing.length) throw context.unresolvedError("ERP Listing", missing.length, context.requestId);
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
      metrics: {
        increment(name, value = 1) {
          if (name === "lingxingProductInfoRequests") stats.productInfoRequestCount += Number(value) || 0;
          if (name === "lingxingProductFallbackRequests") stats.productFallbackRequestCount += Number(value) || 0;
        },
      },
    });
  } catch (error) {
    throw context.wrapUpstream(error, "ERP 产品管理查询失败。", context.requestId, "product-fetch");
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

function assertCompleteProducts(scope, listingByKey, productsByKey, context) {
  const missing = scope.filter((item) => {
    const listing = listingByKey.get(item.key);
    return !productsByKey.has(normalizeCatalogKey(listing?.internalSku));
  });
  if (missing.length) throw context.unresolvedError("ERP 产品管理", missing.length, context.requestId);
}

function buildRepositoryBatch(scope, listingByKey, productsByKey, context) {
  const products = new Map();
  const listings = new Map();
  const aliases = new Map();
  for (const item of scope) {
    const listing = listingByKey.get(item.key);
    const product = productsByKey.get(normalizeCatalogKey(listing.internalSku));
    const effectiveProduct = {
      ...product,
      // Product management is authoritative when it supplies these aliases;
      // the live Listing values remain a safe fallback when that response
      // omitted them.  XLSX never gets an opportunity to overwrite either.
      productId: product?.productId || listing.productId || "",
      skuIdentifier: product?.skuIdentifier || listing.skuIdentifier || "",
    };
    const listingSourceUpdatedAtMs = sourceUpdatedAtMs(listing, context.now);
    const productSourceUpdatedAtMs = sourceUpdatedAtMs(product, listingSourceUpdatedAtMs);
    const rows = catalogProductToRepositoryRows({
      product: effectiveProduct,
      listing,
      source: LIVE_PRODUCT_SOURCE,
      sourceUpdatedAtMs: productSourceUpdatedAtMs,
      refreshedAtMs: context.now,
    });
    rows.products.forEach((row) => products.set(row.internalSkuKey, row));
    rows.listings.forEach((row) => listings.set(`${row.sid}:${row.mskuKey}`, {
      ...row,
      source: listing.source || LIVE_LISTING_SOURCE,
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

export async function loadAndCommitScope(scope, context) {
  const startedAtMs = Date.now();
  const stats = {
    listingFetchedCount: 0,
    listingSharedXlsxCount: 0,
    productFetchedCount: 0,
    listingBatchCount: 0,
    listingRequestCount: 0,
    productLookupBatchCount: 0,
    productInfoRequestCount: 0,
    productFallbackRequestCount: 0,
  };
  const listingByKey = await fetchAllListings(scope, context, stats);
  await fillMissingInternalSkusFromSharedXlsx(scope, listingByKey, context, stats);
  assertCompleteListings(scope, listingByKey, context);
  const productsByKey = await fetchAllProducts(scope, listingByKey, context, stats);
  assertCompleteProducts(scope, listingByKey, productsByKey, context);
  const batch = buildRepositoryBatch(scope, listingByKey, productsByKey, context);
  let write;
  try {
    write = context.repository.upsertCatalog({
      ...batch,
      operation: context.operation || "catalog-refresh",
      requestId: context.requestId,
    });
  } catch (error) {
    if (error instanceof ProductCatalogConflictError || error instanceof ProductCatalogInputError) {
      throw context.attachError(error, { operation: "catalog-commit" });
    }
    throw context.databaseError(error, "商品目录数据库写入失败。", "catalog-commit");
  }
  return {
    revision: write.revision,
    transactionDurationMs: elapsedMs(startedAtMs),
    listingFetchedCount: stats.listingFetchedCount,
    listingSharedXlsxCount: stats.listingSharedXlsxCount,
    productFetchedCount: stats.productFetchedCount,
    listingBatchCount: stats.listingBatchCount,
    listingRequestCount: stats.listingRequestCount,
    productLookupBatchCount: stats.productLookupBatchCount,
    productInfoRequestCount: stats.productInfoRequestCount,
    productFallbackRequestCount: stats.productFallbackRequestCount,
  };
}

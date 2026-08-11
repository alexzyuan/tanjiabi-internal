import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { createPerformanceMetrics } from "../utils/performanceMetrics.js";
import {
  getProductCatalogForRows,
  getProductCatalogRevision,
  refreshProductCatalogScope,
} from "./productCatalogService.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import {
  catalogProductToRepositoryRows,
  hasReadableValue,
  mergeCatalogProduct,
  normalizeCatalogListing,
  normalizeCatalogProduct,
} from "./productCatalogNormalization.js";
import {
  findListingSharedCatalogMatches,
  readListingSharedCatalogRecords,
} from "./listingSharedCatalogService.js";

export {
  catalogProductToRepositoryRows,
  mergeCatalogProduct,
  normalizeCatalogListing,
  normalizeCatalogProduct,
} from "./productCatalogNormalization.js";
export {
  findListingSharedCatalogMatches,
  readListingSharedCatalogRecords,
} from "./listingSharedCatalogService.js";

function uniqueText(values = []) {
  const seen = new Set();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function productCatalogKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function listingMskuCatalogKey(sid, msku) {
  const key = productCatalogKey(msku);
  return key ? `sid:${Number(sid) || 0}:msku:${key}` : "";
}

export function listingStoreMskuCatalogKey(storeName, msku) {
  const storeKey = productCatalogKey(storeName);
  const mskuKey = productCatalogKey(msku);
  return storeKey && mskuKey ? `store:${storeKey}:msku:${mskuKey}` : "";
}

export function listingCountryMskuCatalogKey(country, msku) {
  const countryKey = productCatalogKey(country);
  const mskuKey = productCatalogKey(msku);
  return countryKey && mskuKey ? `country:${countryKey}:msku:${mskuKey}` : "";
}

function putProductCatalog(map, product, extraKeys = []) {
  if (!product) return;
  [
    product.sku,
    product.internalSku,
    product.skuIdentifier,
    product.productId,
    product.msku,
    product.sid && product.msku ? listingMskuCatalogKey(product.sid, product.msku) : "",
    product.storeName && product.msku ? listingStoreMskuCatalogKey(product.storeName, product.msku) : "",
    product.country && product.msku ? listingCountryMskuCatalogKey(product.country, product.msku) : "",
    ...extraKeys,
  ].filter(Boolean).forEach((key) => {
    const normalizedKey = productCatalogKey(key);
    if (!normalizedKey) return;
    map.set(normalizedKey, mergeCatalogProduct(map.get(normalizedKey), product));
  });
}

export function productCatalogMapToRecords(map) {
  const records = [];
  const seen = new Set();
  map.forEach((product, key) => {
    const identity = [
      key,
      product.sku,
      product.internalSku,
      product.skuIdentifier,
      product.productId,
      product.msku,
      product.sid,
      product.storeName,
      product.country,
      product.productName,
      product.imageUrl,
      product.supplier,
      product.purchasePrice,
      product.model,
      product.brand,
      product.material,
      product.purpose,
      product.customsCode,
      product.isBattery,
      product.unit,
      product.declaredValue,
      product.asin,
    ].join("|");
    if (seen.has(identity)) return;
    seen.add(identity);
    records.push({ key, product });
  });
  return records;
}

export function productCatalogRecordsToMap(records = []) {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((item) => {
    if (!item?.key || !item.product) return;
    map.set(String(item.key), item.product);
  });
  return map;
}

function normalizeSharedListingRecord(record = {}, fallbackSid = 0) {
  return normalizeCatalogListing(record, { fallbackSid });
}

function normalizeSharedProductRecord(record = {}) {
  return normalizeCatalogProduct(record);
}

export function buildSharedProductCatalogMap({
  sourceRows = [],
  listingRecords = [],
  productRecords = [],
  catalogRecords = null,
} = {}) {
  if (Array.isArray(catalogRecords)) return buildCanonicalProductCatalogMap(catalogRecords, sourceRows);
  const map = new Map();
  sourceRows.forEach((row) => {
    const sid = Number(row.sid || 0);
    const product = {
      sid,
      msku: String(row.msku || "").trim(),
      sku: String(row.sku || "").trim(),
      internalSku: String(row.internalSku || "").trim(),
      storeName: String(row.storeName || "").trim(),
      country: String(row.country || "").trim(),
      productName: String(row.productName || "").trim(),
      imageUrl: String(row.imageUrl || "").trim(),
      asin: String(row.asin || "").trim(),
    };
    putProductCatalog(map, product, sid && product.msku ? [listingMskuCatalogKey(sid, product.msku)] : []);
  });

  listingRecords.map((record) => normalizeSharedListingRecord(record)).filter(Boolean).forEach((listing) => {
    putProductCatalog(map, listing, [
      listingMskuCatalogKey(listing.sid, listing.msku),
      listingStoreMskuCatalogKey(listing.storeName, listing.msku),
      listingCountryMskuCatalogKey(listing.country, listing.msku),
    ]);
  });

  productRecords.map(normalizeSharedProductRecord).filter(Boolean).forEach((product) => {
    const keys = [product.internalSku, product.skuIdentifier, product.productId].map(productCatalogKey).filter(Boolean);
    const linkedProducts = keys.map((key) => map.get(key)).filter(Boolean);
    putProductCatalog(map, product);
    linkedProducts.forEach((linked) => {
      const merged = mergeCatalogProduct(linked, product);
      putProductCatalog(map, { ...merged, msku: linked.msku, sid: linked.sid, storeName: linked.storeName, country: linked.country }, [
        linked.sid && linked.msku ? listingMskuCatalogKey(linked.sid, linked.msku) : "",
        linked.storeName && linked.msku ? listingStoreMskuCatalogKey(linked.storeName, linked.msku) : "",
        linked.country && linked.msku ? listingCountryMskuCatalogKey(linked.country, linked.msku) : "",
      ]);
    });
  });
  return map;
}

export async function getSharedSellers({
  adapter = getLingxingAdapter(),
  forceRefresh = false,
  readCache,
  saveCache,
  logger,
  nowText,
} = {}) {
  const options = { adapter, forceRefresh };
  if (readCache) options.readCache = readCache;
  if (saveCache) options.saveCache = saveCache;
  if (logger) options.logger = logger;
  if (nowText) options.nowText = nowText;
  const { sellers, meta } = await getSellerDirectory(options);
  return {
    sellers,
    updatedAt: meta.updatedAt,
    cacheHit: meta.cacheHit,
    source: meta.source,
  };
}

export async function getCurrentFbaInventoryByMsku() {
  const { getSalesForecastFbaInventoryByMsku } = await import("./salesForecastService.js");
  const result = await getSalesForecastFbaInventoryByMsku();
  return {
    ...result,
    source: "sales-forecast-cache",
  };
}

function canonicalRecordProduct(record = {}) {
  const product = record?.product && typeof record.product === "object" ? record.product : {};
  const listing = record?.listing && typeof record.listing === "object" ? record.listing : {};
  const merged = mergeCatalogProduct({}, product);
  const withListing = mergeCatalogProduct(merged, listing);
  const withRecord = mergeCatalogProduct(withListing, record);
  const internalSku = String(
    withRecord.internalSku
      || product.internalSku
      || listing.internalSku
      || record.internalSku
      || "",
  ).trim();
  const msku = String(record.msku || listing.msku || "").trim();
  const sid = Number(record.sid || listing.sid || 0);
  const productId = String(
    withRecord.productId
      || product.productId
      || listing.productId
      || record.productId
      || "",
  ).trim();
  const skuIdentifier = String(
    withRecord.skuIdentifier
      || product.skuIdentifier
      || listing.skuIdentifier
      || record.skuIdentifier
      || "",
  ).trim();
  const next = {
    ...withRecord,
    sid,
    msku,
    mskuKey: String(record.mskuKey || listing.mskuKey || msku).trim().toLowerCase(),
    internalSku,
    internalSkuKey: internalSku ? productCatalogKey(internalSku) : "",
    sku: String(withRecord.sku || internalSku).trim(),
    listingSku: String(withRecord.listingSku || listing.listingSku || "").trim(),
    productId,
    skuIdentifier,
    asin: String(withRecord.asin || listing.asin || product.asin || "").trim(),
    storeName: String(record.storeName || listing.storeName || "").trim(),
    country: String(record.country || listing.country || "").trim(),
    countryCode: String(record.countryCode || listing.countryCode || "").trim(),
    displayName: String(record.displayName || listing.displayName || "").trim(),
    internalSkuSourceField: String(record.internalSkuSourceField || listing.internalSkuSourceField || "").trim(),
    listingSkuSourceField: String(record.listingSkuSourceField || listing.listingSkuSourceField || "").trim(),
  };
  return next;
}

function addRequestLocalCatalogAlias(map, key, product) {
  const normalizedKey = productCatalogKey(key);
  if (!normalizedKey || !product) return;
  // Aliases are request-local compatibility lookups.  The first canonical
  // product wins when two listings share an internal SKU; SID+MSKU remains the
  // authoritative listing identity for each row.
  if (!map.has(normalizedKey)) map.set(normalizedKey, product);
}

function buildCanonicalProductCatalogMap(records = [], sourceRows = []) {
  const map = new Map();
  const recordsByIdentity = new Map();
  const products = [];

  for (const record of Array.isArray(records) ? records : []) {
    const product = canonicalRecordProduct(record);
    if (!product.msku || !product.sid) continue;
    const identity = listingMskuCatalogKey(product.sid, product.msku);
    if (identity) recordsByIdentity.set(identity, product);
    products.push(product);
  }

  for (const product of products) {
    const aliases = [
      product.internalSku,
      product.sku,
      product.productId,
      product.skuIdentifier,
      // MSKU alone is retained only as a compatibility alias.  It never acts
      // as the canonical persisted identity and never replaces a prior alias.
      product.msku,
      listingMskuCatalogKey(product.sid, product.msku),
      listingStoreMskuCatalogKey(product.storeName, product.msku),
      listingCountryMskuCatalogKey(product.country, product.msku),
    ];
    aliases.forEach((key) => addRequestLocalCatalogAlias(map, key, product));
  }

  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const identity = listingMskuCatalogKey(row?.sid, row?.msku);
    const product = recordsByIdentity.get(identity);
    if (!product) continue;
    [
      row?.sku,
      row?.internalSku,
      row?.productId,
      row?.skuIdentifier,
      row?.msku,
      listingStoreMskuCatalogKey(row?.storeName, row?.msku),
      listingCountryMskuCatalogKey(row?.country, row?.msku),
      identity,
    ].forEach((key) => addRequestLocalCatalogAlias(map, key, product));
  }
  return map;
}

function buildSharedCatalogPerformance(meta, {
  sourceRows = 0,
  mapSize = 0,
  recordCount = 0,
  cacheHit = false,
} = {}) {
  const metrics = createPerformanceMetrics("shared-product-catalog");
  const productFetchedCount = Number(meta?.productFetchedCount || 0);
  // Task 5 exposes product record counts on normal lookup.  Manual-refresh
  // metadata intentionally keeps its public shape smaller, but a successful
  // refresh necessarily executed at least one product batch before commit.
  const productLookupCount = productFetchedCount > 0
    ? productFetchedCount
    : Number(meta?.refreshRequestedCount || 0) > 0
      ? 1
      : 0;
  metrics.increment("sourceRows", sourceRows);
  metrics.increment("cacheHit", cacheHit ? 1 : 0);
  metrics.increment("outputRecords", mapSize);
  metrics.increment("canonicalRecords", Number(recordCount || 0));
  metrics.increment("catalogRevision", Number(meta?.revision || 0));
  metrics.increment("listingFetchedCount", Number(meta?.listingFetchedCount || 0));
  metrics.increment("productFetchedCount", productFetchedCount);
  metrics.increment("listingSharedXlsxCount", Number(meta?.listingSharedXlsxCount || 0));
  metrics.increment("missingCount", Number(meta?.missingCount || 0));
  metrics.increment("lingxingListingRequests", Number(meta?.listingFetchedCount || 0));
  metrics.increment("lingxingProductInfoRequests", productLookupCount);
  metrics.increment("joinedInFlight", Number(meta?.joinedInFlight || 0));
  return metrics.summary();
}

function canonicalRecordsUpdatedAt(records = []) {
  const refreshedAtMs = (Array.isArray(records) ? records : [])
    .flatMap((record) => [
      record?.listing?.refreshedAtMs,
      record?.product?.refreshedAtMs,
      record?.refreshedAtMs,
    ])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return refreshedAtMs.length ? new Date(Math.max(...refreshedAtMs)).toISOString() : "";
}

export async function getSharedProductCatalogMap(adapter = getLingxingAdapter(), rows = [], {
  forceRefresh = false,
  strict = false,
  ...options
} = {}) {
  const serviceOptions = { ...options, adapter, strict, feature: options.feature || "shared-data" };
  if (!Array.isArray(rows)) {
    // Let Task 5 attach the typed validation error and request context instead
    // of silently treating malformed input as an empty compatibility scope.
    if (forceRefresh) {
      await refreshProductCatalogScope({ feature: serviceOptions.feature, items: rows }, serviceOptions);
    } else {
      await getProductCatalogForRows(rows, serviceOptions);
    }
    throw new Error("商品目录服务返回了无效输入。");
  }
  const sourceRows = rows;
  if (!sourceRows.length) {
    const revision = getProductCatalogRevision(serviceOptions);
    const performance = buildSharedCatalogPerformance({ revision, source: "sqlite" }, {
      sourceRows: 0,
      mapSize: 0,
      recordCount: 0,
      cacheHit: true,
    });
    return {
      map: new Map(),
      cacheHit: true,
      updatedAt: "",
      status: "共享商品目录无数据",
      revision,
      meta: { revision, source: "sqlite", missingCount: 0 },
      performance,
    };
  }
  const lookup = forceRefresh
    ? await refreshProductCatalogScope({ feature: serviceOptions.feature, items: sourceRows }, serviceOptions)
    : await getProductCatalogForRows(sourceRows, serviceOptions);
  const records = Array.isArray(lookup.records) ? lookup.records : [];
  const map = buildCanonicalProductCatalogMap(records, sourceRows);
  const meta = lookup.meta || {};
  const cacheHit = !forceRefresh
    && meta.source === "sqlite"
    && Number(meta.listingFetchedCount || 0) === 0
    && Number(meta.productFetchedCount || 0) === 0;
  const performance = buildSharedCatalogPerformance(meta, {
    sourceRows: sourceRows.length,
    mapSize: map.size,
    recordCount: records.length,
    cacheHit,
  });
  const updatedAt = String(meta.cacheUpdatedAt || canonicalRecordsUpdatedAt(records) || "").trim();
  const status = cacheHit
    ? `复用共享商品目录 ${records.length} 个索引`
    : `刷新共享商品目录 ${records.length} 个索引`;
  console.info("[shared-product-catalog] performance", {
    revision: Number(meta.revision || 0),
    cacheHit,
    sourceRows: sourceRows.length,
    outputRecords: map.size,
    listingFetchedCount: Number(meta.listingFetchedCount || 0),
    productFetchedCount: Number(meta.productFetchedCount || 0),
  });
  return {
    map,
    cacheHit,
    updatedAt,
    status,
    revision: Number(meta.revision || 0),
    meta,
    performance,
  };
}

function sameCode(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function catalogLookupKeys(row = {}) {
  const mskus = String(row.msku || "").split("/").map((item) => item.trim()).filter(Boolean);
  return uniqueText([
    row.storeName && mskus[0] ? listingStoreMskuCatalogKey(row.storeName, mskus[0]) : "",
    row.country && mskus[0] ? listingCountryMskuCatalogKey(row.country, mskus[0]) : "",
    row.sid && mskus[0] ? listingMskuCatalogKey(row.sid, mskus[0]) : "",
    ...mskus,
    row.sku,
  ]).map(productCatalogKey);
}

const productCatalogFillFields = [
  "imageUrl",
  "productName",
  "supplier",
  "purchasePrice",
  "internalSku",
  "brand",
  "material",
  "purpose",
  "customsCode",
  "isBattery",
  "unit",
  "declaredValue",
  "asin",
];

function catalogFieldHasValue(product = {}, field) {
  if (field === "purchasePrice" || field === "declaredValue") return Number(product[field] || 0) > 0;
  return hasReadableValue(product[field]);
}

function findMergedCatalogProduct(row = {}, catalogMap = new Map()) {
  const matches = catalogLookupKeys(row)
    .map((key) => ({ key, product: catalogMap.get(key) }))
    .filter((item) => item.product);
  if (!matches.length) return { product: null, matches: [], shadowedFields: [] };
  const product = matches.reduce((merged, item) => mergeCatalogProduct(merged, item.product), {});
  const first = matches[0].product;
  const shadowedFields = matches.length > 1
    ? productCatalogFillFields.filter((field) => !catalogFieldHasValue(first, field) && catalogFieldHasValue(product, field))
    : [];
  return { product, matches, shadowedFields };
}

export function applySharedProductCatalogToRows(rows = [], catalogMap = new Map()) {
  if (!catalogMap.size) return rows;
  let shadowedRowCount = 0;
  const shadowSamples = [];
  const enrichedRows = rows.map((row) => {
    const { product, matches, shadowedFields } = findMergedCatalogProduct(row, catalogMap);
    if (!product) return row;
    if (shadowedFields.length) {
      shadowedRowCount += 1;
      if (shadowSamples.length < 5) shadowSamples.push({
        sid: row.sid || "",
        storeName: row.storeName || "",
        country: row.country || "",
        msku: row.msku || "",
        sku: row.sku || "",
        matchedKeys: matches.map((item) => item.key),
        filledFields: shadowedFields,
      });
    }
    const next = { ...row };
    if (!next.imageUrl && product.imageUrl) next.imageUrl = product.imageUrl;
    if ((!next.productName || sameCode(next.productName, next.sku) || sameCode(next.productName, next.msku)) && product.productName) {
      next.productName = product.productName;
    }
    if (!next.supplier && product.supplier) next.supplier = product.supplier;
    if (!next.purchasePrice && product.purchasePrice) next.purchasePrice = product.purchasePrice;
    if (!next.internalSku && product.internalSku) next.internalSku = product.internalSku;
    if (!next.brand && product.brand) next.brand = product.brand;
    if (!next.model && product.model) next.model = product.model;
    if (!next.material && product.material) next.material = product.material;
    if (!next.purpose && product.purpose) next.purpose = product.purpose;
    if (!next.customsCode && product.customsCode) next.customsCode = product.customsCode;
    if (!next.isBattery && product.isBattery) next.isBattery = product.isBattery;
    if (!next.unit && product.unit) next.unit = product.unit;
    if (!next.declaredValue && product.declaredValue) next.declaredValue = product.declaredValue;
    if (!next.asin && product.asin) next.asin = product.asin;
    return next;
  });
  if (shadowedRowCount) {
    console.info("[shared-product-catalog] 合并多个商品目录索引，避免不完整索引遮挡字段", {
      rowCount: rows.length,
      shadowedRowCount,
      samples: shadowSamples,
    });
  }
  return enrichedRows;
}

import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { createPerformanceMetrics } from "../utils/performanceMetrics.js";
import {
  fetchLingxingListingsBySidMskus,
  fetchLingxingProductRecords,
} from "./lingxingCatalogLookupService.js";
import {
  readSharedProductCatalogCache,
  saveSharedProductCatalogCache,
} from "../utils/cacheStore.js";
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

const PRODUCT_CATALOG_CACHE_VERSION = "shared-product-catalog-v3";
const PRODUCT_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LISTING_BATCH_SIZE = 50;
const PRODUCT_BATCH_SIZE = 80;
const sharedProductCatalogRefreshes = new Map();

function uniqueText(values = []) {
  const seen = new Set();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function normalizeRecordList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  const data = payload?.data || payload || {};
  const records = data.records || data.list || data.rows || data.data || data.items || data.result || data;
  return Array.isArray(records) ? records : [];
}

function totalCountOf(payload, recordsLength = 0) {
  const data = payload?.data || payload || {};
  return Number(data.total ?? data.count ?? data.totalCount ?? payload?.total ?? recordsLength) || recordsLength;
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

export function buildSharedProductCatalogMap({ sourceRows = [], listingRecords = [], productRecords = [] } = {}) {
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

function stableProductCatalogCacheKey(rows = []) {
  const identities = uniqueText(rows.flatMap((row) => [
    Number(row.sid || 0) && row.msku ? listingMskuCatalogKey(row.sid, row.msku) : "",
    row.storeName && row.msku ? listingStoreMskuCatalogKey(row.storeName, row.msku) : "",
    row.country && row.msku ? listingCountryMskuCatalogKey(row.country, row.msku) : "",
    row.msku,
    row.sku,
  ]));
  return JSON.stringify({
    source: "shared-product-catalog",
    version: PRODUCT_CATALOG_CACHE_VERSION,
    identities: identities.sort(),
  });
}

function listingItemHasInternalSkuForRow(row = {}, item = {}) {
  if (!item?.internalSku) return false;
  const rowMskus = String(row.msku || "").split("/").map((value) => productCatalogKey(value)).filter(Boolean);
  if (!rowMskus.includes(productCatalogKey(item.msku))) return false;
  if (row.sid && item.sid && Number(row.sid) !== Number(item.sid)) return false;
  if (row.storeName && item.storeName && productCatalogKey(row.storeName) !== productCatalogKey(item.storeName)) return false;
  if (row.country && item.country && productCatalogKey(row.country) !== productCatalogKey(item.country)) return false;
  return true;
}

async function fetchListingSharedCatalogItems(rows = [], apiListingItems = [], {
  listingSharedCatalogRecords = null,
  readListingSharedCatalog = readListingSharedCatalogRecords,
  strict = false,
} = {}) {
  const missingRows = rows.filter((row) => !apiListingItems.some((item) => listingItemHasInternalSkuForRow(row, item)));
  if (!missingRows.length) return [];
  let sourceRecords = [];
  try {
    sourceRecords = Array.isArray(listingSharedCatalogRecords)
      ? listingSharedCatalogRecords
      : await readListingSharedCatalog();
  } catch (error) {
    console.error("[shared-product-catalog] Listing 共享目录读取失败", {
      rowCount: rows.length,
      missingRowCount: missingRows.length,
      error: error.message,
    });
    if (strict) throw new Error(`Listing 共享目录读取失败：${error.message}`);
    return [];
  }
  const matched = missingRows.flatMap((row) => findListingSharedCatalogMatches([row], sourceRecords).map((listing) => ({
    ...listing,
    sid: listing.sid || Number(row.sid || 0),
    storeName: listing.storeName || row.storeName || "",
    country: listing.country || row.country || "",
  })));
  if (matched.length) {
    console.info("[shared-product-catalog] Listing 共享目录补充内部 SKU", {
      requestedRows: rows.length,
      missingRows: missingRows.length,
      matchedRows: matched.length,
    });
  }
  return matched;
}

async function fetchListingItems(adapter, rows = [], { strict = false, metrics = null } = {}) {
  const rowsBySid = new Map();
  rows.forEach((row) => {
    const sid = Number(row.sid || 0);
    const mskus = String(row.msku || "").split("/").map((item) => item.trim()).filter(Boolean);
    if (!sid || !mskus.length) return;
    if (!rowsBySid.has(sid)) rowsBySid.set(sid, []);
    rowsBySid.get(sid).push(...mskus);
  });

  const items = [];
  for (const [sid, mskus] of rowsBySid.entries()) {
    const records = await fetchLingxingListingsBySidMskus(adapter, sid, mskus, { batchSize: LISTING_BATCH_SIZE, strict, metrics });
    records.map((record) => normalizeSharedListingRecord(record, sid)).filter(Boolean).forEach((item) => items.push(item));
  }
  return items;
}

async function safeFetchProductRecords(adapter, params, fallbackParams = null, { strict = false, metrics = null } = {}) {
  return fetchLingxingProductRecords(adapter, params, fallbackParams, { strict, metrics });
}

async function fetchProductRecords(adapter, rows = [], listingItems = [], { strict = false, metrics = null } = {}) {
  const lookupValues = uniqueText([...rows, ...listingItems].flatMap((row) => [row.internalSku, row.sku, row.msku]));
  const skuIdentifiers = uniqueText(listingItems.flatMap((row) => [row.skuIdentifier, row.internalSku, row.sku, row.msku]));
  const productIds = uniqueText(listingItems.map((row) => row.productId));
  const records = [];

  for (const batch of chunkArray(lookupValues, PRODUCT_BATCH_SIZE)) {
    records.push(...await safeFetchProductRecords(adapter, { skus: batch }, { sku_list: batch }, { strict, metrics }));
  }
  for (const batch of chunkArray(skuIdentifiers, PRODUCT_BATCH_SIZE)) {
    records.push(...await safeFetchProductRecords(adapter, { sku_identifiers: batch }, { sku_identifier_list: batch }, { strict, metrics }));
  }
  for (const batch of chunkArray(productIds, PRODUCT_BATCH_SIZE)) {
    records.push(...await safeFetchProductRecords(adapter, { product_ids: batch }, { product_id_list: batch }, { strict, metrics }));
  }
  return records;
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

export async function getSharedProductCatalogMap(adapter = getLingxingAdapter(), rows = [], {
  forceRefresh = false,
  ttlMs = PRODUCT_CATALOG_TTL_MS,
  strict = false,
  listingSharedCatalogRecords = null,
  readListingSharedCatalog = readListingSharedCatalogRecords,
  readProductCatalogCache = readSharedProductCatalogCache,
  saveProductCatalogCache = saveSharedProductCatalogCache,
} = {}) {
  const metrics = createPerformanceMetrics("shared-product-catalog");
  metrics.increment("sourceRows", rows.length);
  const cacheKey = stableProductCatalogCacheKey(rows);
  if (!forceRefresh) {
    const cached = await metrics.measure("readCache", () => readProductCatalogCache(cacheKey, ttlMs));
    if (cached?.data?.records) {
      metrics.increment("cacheHit");
      metrics.increment("outputRecords", cached.data.records.length);
      const performance = metrics.summary();
      console.info("[shared-product-catalog] performance", performance);
      return {
        map: productCatalogRecordsToMap(cached.data.records),
        cacheHit: true,
        updatedAt: cached.updatedAt || "",
        status: `复用共享商品目录 ${cached.data.records.length} 个索引`,
        performance,
      };
    }
  }
  metrics.increment("cacheHit", 0);

  const refreshKey = JSON.stringify({ cacheKey, strict });
  const inFlight = sharedProductCatalogRefreshes.get(refreshKey);
  if (inFlight) {
    metrics.increment("joinedInFlight");
    const joined = await metrics.measure("joinInFlight", () => inFlight);
    metrics.increment("outputRecords", joined.map?.size || 0);
    const performance = metrics.summary();
    console.info("[shared-product-catalog] performance", performance);
    return { ...joined, performance };
  }

  const refresh = (async () => {
    const apiListingItems = await metrics.measure("listingLookup", () => fetchListingItems(adapter, rows, { strict, metrics }));
    metrics.increment("apiListingItems", apiListingItems.length);
    const sharedListingItems = await metrics.measure("sharedCatalogLookup", () => fetchListingSharedCatalogItems(rows, apiListingItems, {
      listingSharedCatalogRecords,
      readListingSharedCatalog,
      strict,
    }));
    metrics.increment("sharedListingItems", sharedListingItems.length);
    const listingItems = [...apiListingItems, ...sharedListingItems];
    const productRecords = await metrics.measure("productLookup", () => fetchProductRecords(adapter, rows, listingItems, { strict, metrics }));
    metrics.increment("productRecords", productRecords.length);
    const map = await metrics.measure("buildCatalog", async () => buildSharedProductCatalogMap({ sourceRows: rows, listingRecords: listingItems, productRecords }));
    const records = productCatalogMapToRecords(map);
    metrics.increment("outputRecords", records.length);
    await metrics.measure("writeCache", () => saveProductCatalogCache(cacheKey, { records }));
    const performance = metrics.summary();
    console.info("[shared-product-catalog] performance", performance);
    return {
      map,
      cacheHit: false,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      status: `刷新共享商品目录 ${records.length} 个索引`,
      performance,
    };
  })();
  sharedProductCatalogRefreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    if (sharedProductCatalogRefreshes.get(refreshKey) === refresh) {
      sharedProductCatalogRefreshes.delete(refreshKey);
    }
  }
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

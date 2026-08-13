import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaAddressProfile } from "../data/fbaAddressBook.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { getFbaBoxTemplate, hasCompleteBoxSpec } from "./fbaBoxTemplateService.js";
import { normalizeCatalogListing } from "./productCatalogNormalization.js";
import { getSharedProductCatalogMap } from "./sharedDataService.js";
import { fetchLingxingListingRecords, lingxingSidVariants } from "./lingxingCatalogLookupService.js";

const mskuCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVERY_CACHE_FIELDS = [
  "asin",
  "country",
  "displayName",
  "msku",
  "shopName",
  "sid",
  "title",
];
const PRODUCT_RESULT_FIELDS = [
  "internalSku",
  "internalSkuKey",
  "localSku",
  "sku",
  "skuIdentifier",
  "productId",
  "listingSku",
  "productName",
  "imageUrl",
  "supplier",
  "purchasePrice",
  "model",
  "brand",
  "material",
  "purpose",
  "customsCode",
  "isBattery",
  "unit",
  "declaredValue",
  "packQuantity",
  "boxSpec",
  "asin",
];
function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeRuntimeShop(seller = {}) {
  const sid = Number(seller.sid ?? seller.seller_id_local ?? seller.store_id ?? seller.storeId ?? seller.id);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const name = normalizeText(
    seller.name
      ?? seller.seller_name
      ?? seller.sellerName
      ?? seller.shop_name
      ?? seller.shopName
      ?? seller.store_name
      ?? seller.storeName
      ?? seller.displayName,
  );
  if (!name) return null;
  return {
    ...seller,
    sid,
    name,
    displayName: normalizeText(seller.displayName || seller.display_name) || name,
    country: normalizeText(seller.country || seller.countryName || seller.country_name),
    countryCode: normalizeText(seller.countryCode || seller.country_code || seller.marketplaceCode).toUpperCase(),
  };
}

async function resolveRuntimeShops({ sids = [], adapter, getDirectory = getSellerDirectory } = {}) {
  const directoryResult = await getDirectory({ adapter });
  if (!directoryResult || !Array.isArray(directoryResult.sellers)) {
    throw new Error("领星店铺目录返回无效 sellers 列表。");
  }

  const shopsBySid = new Map();
  directoryResult.sellers.forEach((seller) => {
    const normalized = normalizeRuntimeShop(seller);
    if (normalized) shopsBySid.set(normalized.sid, normalized);
  });
  if (!shopsBySid.size) throw new Error("领星店铺目录无可用店铺。");

  const requestedSids = Array.isArray(sids)
    ? sids.map(Number).filter((sid) => Number.isFinite(sid) && sid > 0)
    : [];
  if (!requestedSids.length) return [...shopsBySid.values()];

  const missingSids = [...new Set(requestedSids)].filter((sid) => !shopsBySid.has(sid));
  if (missingSids.length) {
    throw new Error(`店铺 SID ${missingSids.join(", ")} 不在运行时领星店铺目录中。`);
  }
  return [...new Set(requestedSids)].map((sid) => shopsBySid.get(sid));
}

function normalizeMskuDiscoveryRecord(record, shop) {
  const listing = normalizeCatalogListing(record, { fallbackSid: shop.sid });
  if (!listing) return null;

  return {
    msku: listing.msku,
    asin: listing.asin,
    title: listing.productName,
    sid: shop.sid,
    shopName: shop.name,
    displayName: shop.displayName,
    country: shop.country,
  };
}

function normalizeListingCatalogRecord(record, shop) {
  const listing = normalizeCatalogListing(record, { fallbackSid: shop.sid });
  if (!listing) return null;
  return {
    sid: shop.sid,
    seller_sku: listing.msku,
    // Preserve local_sku provenance. Generic `sku` remains an internal-SKU
    // fallback, but must not be rewritten as local_sku or become a listing_sku
    // alias downstream.
    local_sku: listing.listingSku,
    sku: listing.listingSku ? "" : listing.internalSku,
    sku_identifier: listing.skuIdentifier,
    product_id: listing.productId,
    asin: listing.asin,
    title: listing.productName,
  };
}

async function applyBoxTemplates(items, { getBoxTemplate = getFbaBoxTemplate } = {}) {
  return Promise.all(items.map(async (item) => {
    const template = await getBoxTemplate({ sid: item.sid, msku: item.msku });
    if (template && hasCompleteBoxSpec({ dimensions: template.dimensions, weight: template.weight })) {
      return {
        ...item,
        boxDimensions: template.dimensions,
        boxWeight: template.weight,
        boxSource: "template",
      };
    }
    if (hasCompleteBoxSpec(item.boxSpec || {})) {
      return {
        ...item,
        boxDimensions: item.boxSpec.dimensions,
        boxWeight: item.boxSpec.weight,
        boxSource: "erp",
      };
    }
    return {
      ...item,
      boxDimensions: null,
      boxWeight: null,
      boxSource: "missing",
    };
  }));
}

function normalizeMskuText(value) {
  return String(value || "").trim().toLowerCase();
}

function filterMskus(items, keyword, matchMode) {
  const value = String(keyword || "").trim().toLowerCase();
  if (!value) return items;

  return items.filter((item) => {
    const fields = [item.msku, item.asin, item.sku, item.title, item.shopName, item.displayName].map((field) => String(field || "").toLowerCase());
    if (matchMode === "exact") return fields.some((field) => field === value);
    return fields.some((field) => field.includes(value));
  });
}

function emptyDiagnostics() {
  return {
    message: "",
    unpairedListings: [],
    errors: [],
  };
}

function safeFbaErrorMessage(error) {
  if (error?.name === "ProductCatalogInputError") return "商品目录输入无效。";
  if (error?.name === "ProductCatalogConflictError") return "商品目录冲突。";
  if (error?.name === "ProductCatalogUpstreamError" && Number(error?.statusCode) === 422) {
    return "商品目录未解析必要资料。";
  }
  return "领星 Listing 查询失败。";
}

function diagnosticMessage(unpairedListings = []) {
  if (!unpairedListings.length) return "";
  const samples = unpairedListings
    .slice(0, 3)
    .map((item) => `${item.msku}（${item.displayName || item.shopName}）`)
    .join("、");
  return `领星 Listing 中存在 ${samples}，但未配对 ERP 产品资料。请先在领星把 Listing 关联到产品管理，并维护装箱数量、外箱规格和外箱重量后再刷新 MSKU。`;
}

async function diagnoseUnpairedListings(adapter, shops, keyword, matchMode) {
  const diagnostics = emptyDiagnostics();
  const value = normalizeText(keyword);
  if (!value) return diagnostics;

  for (const shop of shops) {
    const baseParams = {
      is_delete: 0,
      search_field: "seller_sku",
      search_value: [value],
      exact_search: matchMode === "exact" ? 1 : 0,
      sid: shop.sid,
    };
    try {
      const records = await fetchLingxingListingRecords(adapter, baseParams);
      const matches = filterMskus(
        uniqueMskus(records.map((record) => normalizeMskuDiscoveryRecord(record, shop)).filter(Boolean)),
        value,
        matchMode,
      );
      diagnostics.unpairedListings.push(...matches.map((item) => ({
        sid: item.sid,
        shopName: item.shopName,
        displayName: item.displayName,
        country: item.country,
        msku: item.msku,
        asin: item.asin,
        sku: "",
        title: item.title,
        reason: "listing_not_paired_to_erp_product",
      })));
    } catch (error) {
      diagnostics.errors.push(`${shop.name}: ${safeFbaErrorMessage(error)}`);
    }
  }

  diagnostics.unpairedListings = uniqueMskus(diagnostics.unpairedListings);
  diagnostics.message = diagnosticMessage(diagnostics.unpairedListings);
  return diagnostics;
}

function uniqueMskus(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sid}:${normalizeKey(item.msku)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discoveryCacheItem(item) {
  return DISCOVERY_CACHE_FIELDS.reduce((result, field) => {
    result[field] = item?.[field] ?? (field === "sid" ? 0 : "");
    return result;
  }, {});
}

function cloneDiscoveryItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => discoveryCacheItem(item));
}

function rebaseDiscoveryItems(items, shop) {
  return cloneDiscoveryItems(items).map((item) => ({
    ...item,
    sid: shop.sid,
    shopName: shop.name,
    displayName: shop.displayName,
    country: shop.country,
  }));
}

function catalogMapKeys(item = {}) {
  const msku = normalizeKey(item.msku);
  const sid = Number(item.sid || 0);
  const storeName = normalizeKey(item.shopName || item.storeName);
  const country = normalizeKey(item.country);
  return [
    sid && msku ? `sid:${sid}:msku:${msku}` : "",
    !sid && storeName && msku ? `store:${storeName}:msku:${msku}` : "",
    !sid && country && msku ? `country:${country}:msku:${msku}` : "",
    !sid ? msku : "",
    !sid ? normalizeKey(item.sku) : "",
  ].filter(Boolean);
}

function findCatalogProduct(item, catalogMap = new Map()) {
  for (const key of catalogMapKeys(item)) {
    const product = catalogMap.get(key);
    if (product) return product;
  }
  return null;
}

function isPlainCatalogObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyCatalogString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCanonicalCatalogValue(discovery, product) {
  if (!isPlainCatalogObject(product)) return false;
  if (!Number.isInteger(discovery?.sid) || discovery.sid <= 0) return false;
  if (!Number.isInteger(product.sid) || product.sid <= 0 || product.sid !== discovery.sid) return false;
  if (!isNonEmptyCatalogString(discovery?.msku) || !isNonEmptyCatalogString(product.msku)) return false;
  if (normalizeKey(product.msku) !== normalizeKey(discovery.msku)) return false;
  return isNonEmptyCatalogString(product.internalSku) || isNonEmptyCatalogString(product.localSku);
}

function mergeCatalogItem(discovery, product) {
  if (!product) return { ...discovery };
  const canonical = PRODUCT_RESULT_FIELDS.reduce((result, field) => {
    if (Object.hasOwn(product, field)) result[field] = product[field];
    return result;
  }, {});
  const internalSku = [canonical.internalSku, canonical.localSku]
    .find((value) => isNonEmptyCatalogString(value))
    ?.trim() || "";
  const sku = isNonEmptyCatalogString(canonical.sku) ? canonical.sku.trim() : internalSku;
  return {
    ...discovery,
    ...canonical,
    sid: discovery.sid,
    msku: discovery.msku,
    shopName: discovery.shopName,
    displayName: discovery.displayName,
    country: discovery.country,
    asin: discovery.asin || canonical.asin || "",
    title: discovery.title || canonical.productName || "",
    productName: canonical.productName || discovery.title || "",
    internalSku,
    sku,
    erpSku: internalSku,
    packQuantity: Object.hasOwn(canonical, "packQuantity") ? canonical.packQuantity : null,
    boxSpec: canonical.boxSpec || null,
  };
}

async function hydrateMskuDiscovery(adapter, shop, discoveryItems, listingRecords, {
  repository = null,
  getDirectory = getSellerDirectory,
  getSharedCatalog = getSharedProductCatalogMap,
  getBoxTemplate = getFbaBoxTemplate,
  sharedCatalogOptions = {},
} = {}) {
  const sourceItems = Array.isArray(discoveryItems) ? discoveryItems : [];
  if (!sourceItems.length) return [];
  const listingByKey = new Map(
    (Array.isArray(listingRecords) ? listingRecords : [])
      .map((record) => normalizeListingCatalogRecord(record, shop))
      .filter(Boolean)
      .map((record) => [`${shop.sid}:${normalizeKey(record.seller_sku)}`, record]),
  );
  const catalogOptions = {
    ...sharedCatalogOptions,
    strict: true,
    requireFbaBoxSpec: true,
    feature: "fba-catalog",
    sellers: [shop],
    getDirectory,
    ...(repository ? { repository } : {}),
  };
  if (listingByKey.size) {
    catalogOptions.fetchListingsBySidMskus = async (_adapter, sid, mskus) => mskus
      .map((msku) => listingByKey.get(`${sid}:${normalizeKey(msku)}`))
      .filter(Boolean);
  }
  const hydrated = [];
  for (let index = 0; index < sourceItems.length; index += 500) {
    const chunk = sourceItems.slice(index, index + 500);
    const catalogResult = await getSharedCatalog(adapter, chunk, catalogOptions);
    const catalogMap = catalogResult?.map;
    if (!(catalogMap instanceof Map)) throw new Error("共享商品目录返回无效索引。");
    const missing = chunk.filter((item) => !isValidCanonicalCatalogValue(item, findCatalogProduct(item, catalogMap)));
    if (missing.length) {
      throw new Error("FBA 商品目录记录身份或内部 SKU 无效。");
    }
    hydrated.push(...chunk.map((item) => mergeCatalogItem(item, findCatalogProduct(item, catalogMap))));
  }
  return applyBoxTemplates(hydrated, { getBoxTemplate });
}

async function fetchMskusForShop(adapter, shop, {
  force = false,
  exactMsku = "",
  now = Date.now,
  repository = null,
  getDirectory = getSellerDirectory,
  getSharedCatalog = getSharedProductCatalogMap,
  getBoxTemplate = getFbaBoxTemplate,
  sharedCatalogOptions = {},
} = {}) {
  const cacheKey = exactMsku ? `${shop.sid}:msku:${normalizeKey(exactMsku)}` : String(shop.sid);
  const cached = mskuCache.get(cacheKey);
  const nowMs = typeof now === "function" ? now() : Number(now);
  if (!force && cached && nowMs - cached.updatedAt < CACHE_TTL_MS) {
    const discoveryItems = rebaseDiscoveryItems(cached.items, shop);
    return hydrateMskuDiscovery(adapter, shop, discoveryItems, [], {
      repository,
      getDirectory,
      getSharedCatalog,
      getBoxTemplate,
      sharedCatalogOptions,
    });
  }

  const baseParams = {
    is_pair: 1,
    is_delete: 0,
  };
  if (exactMsku) {
    baseParams.search_field = "seller_sku";
    baseParams.search_value = [exactMsku];
    baseParams.exact_search = 1;
  }
  const variants = lingxingSidVariants(shop.sid);

  let lastPayload = null;
  let lastError = null;
  let items = [];
  let listingRecords = [];
  for (const variant of variants) {
    try {
      const records = await fetchLingxingListingRecords(adapter, { ...baseParams, ...variant });
      lastPayload = { code: 0, data: records };
      listingRecords = records;
      items = uniqueMskus(records.map((record) => normalizeMskuDiscoveryRecord(record, shop)).filter(Boolean));
      if (items.length || lastPayload?.code === 0 || lastPayload?.code === "0") break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && !lastPayload) throw lastError;

  const hydratedItems = await hydrateMskuDiscovery(adapter, shop, items, listingRecords, {
    repository,
    getDirectory,
    getSharedCatalog,
    getBoxTemplate,
    sharedCatalogOptions,
  });

  mskuCache.set(cacheKey, { updatedAt: nowMs, items: cloneDiscoveryItems(items) });
  return hydratedItems;
}

export const fbaCatalogTestUtils = {
  clearCache() {
    mskuCache.clear();
  },
  inspectCacheFields() {
    const fields = new Set();
    mskuCache.forEach((entry) => {
      (Array.isArray(entry?.items) ? entry.items : []).forEach((item) => {
        Object.keys(item || {}).forEach((field) => fields.add(field));
      });
    });
    return [...fields].sort();
  },
  getDiscoveryCacheSnapshot() {
    return [...mskuCache.entries()].map(([key, entry]) => ({
      key,
      updatedAt: entry.updatedAt,
      items: cloneDiscoveryItems(entry.items),
    }));
  },
};

export async function getFbaShopOptions({ getDirectory = getSellerDirectory, logger = console } = {}) {
  const directoryResult = await getDirectory();
  if (!directoryResult || !Array.isArray(directoryResult.sellers)) {
    throw new Error("店铺目录返回无效 sellers 列表。");
  }

  const { sellers, meta = {} } = directoryResult;
  const shops = [];
  const unmappedShops = [];

  sellers.forEach((seller) => {
    const addressProfile = getFbaAddressProfile(seller.name);
    if (addressProfile) {
      shops.push({
        sid: seller.sid,
        name: seller.name,
        country: seller.country,
        countryCode: seller.countryCode || "",
        displayName: seller.displayName || seller.name,
        sellerId: seller.sellerId || seller.seller_id || "",
        marketplaceId: seller.marketplaceId || seller.marketplace_id || "",
        mid: seller.mid || "",
        status: seller.status,
        addressProfile,
      });
      return;
    }
    const redactedSeller = {
      sid: seller.sid,
      name: seller.name,
      country: seller.country,
    };
    unmappedShops.push(redactedSeller);
    logger?.warn?.("[fba-shop-directory]", {
      sid: redactedSeller.sid,
      name: redactedSeller.name,
      country: redactedSeller.country,
      reason: "unmapped-address-profile",
    });
  });

  return {
    shops,
    unmappedShops,
    ...(meta && typeof meta === "object" ? meta : {}),
  };
}

export async function searchFbaMskus({
  sids = [],
  q = "",
  matchMode = "fuzzy",
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  productCatalogRepository = null,
  repository = null,
  getSharedCatalog = getSharedProductCatalogMap,
  getBoxTemplate = getFbaBoxTemplate,
  sharedCatalogOptions = {},
  now = Date.now,
} = {}) {
  const shops = await resolveRuntimeShops({ sids, adapter, getDirectory });
  const settled = await Promise.allSettled(shops.map((shop) => fetchMskusForShop(adapter, shop, {
    repository: productCatalogRepository || repository,
    getDirectory,
    getSharedCatalog,
    getBoxTemplate,
    sharedCatalogOptions,
    now,
  })));
  const errors = settled
    .map((result, index) => (result.status === "rejected" ? `${shops[index].name}: ${safeFbaErrorMessage(result.reason)}` : ""))
    .filter(Boolean);
  const items = uniqueMskus(settled.flatMap((result) => (result.status === "fulfilled" ? result.value : [])));
  const filteredItems = filterMskus(items, q, matchMode).slice(0, 200);
  const diagnostics = filteredItems.length || !normalizeText(q)
    ? emptyDiagnostics()
    : await diagnoseUnpairedListings(adapter, shops, q, matchMode);
  return {
    ok: errors.length === 0,
    errors,
    count: items.length,
    items: filteredItems,
    diagnostics,
  };
}

export async function resolveFbaMskuFromErp({
  sid,
  msku,
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  productCatalogRepository = null,
  repository = null,
  getSharedCatalog = getSharedProductCatalogMap,
  getBoxTemplate = getFbaBoxTemplate,
  sharedCatalogOptions = {},
  now = Date.now,
} = {}) {
  const normalizedSid = Number(sid);
  const normalizedMsku = normalizeMskuText(msku);
  if (!normalizedSid) throw new Error("请选择有效店铺。");
  if (!normalizedMsku) throw new Error("MSKU 不能为空。");

  const [shop] = await resolveRuntimeShops({ sids: [normalizedSid], adapter, getDirectory });
  const items = await fetchMskusForShop(adapter, shop, {
    force: true,
    exactMsku: msku,
    repository: productCatalogRepository || repository,
    getDirectory,
    getSharedCatalog,
    getBoxTemplate,
    sharedCatalogOptions,
    now,
  });
  const matched = items.find((item) => normalizeMskuText(item.msku) === normalizedMsku);
  if (!matched) {
    throw new Error(`MSKU ${msku} 未在领星 ERP 店铺 ${shop.name} 中匹配到，请检查店铺和 MSKU。`);
  }
  if (!Number(matched.packQuantity || 0)) {
    throw new Error(`MSKU ${matched.msku} 在领星 ERP 未返回装箱数量，请先维护产品管理装箱数量。`);
  }

  return matched;
}

export async function assertFbaMskuPackMatchesErp({
  sid,
  msku,
  packQuantity,
  boxCount,
  quantity,
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  productCatalogRepository = null,
  repository = null,
  getSharedCatalog = getSharedProductCatalogMap,
  getBoxTemplate = getFbaBoxTemplate,
  sharedCatalogOptions = {},
  now = Date.now,
} = {}) {
  const erpItem = await resolveFbaMskuFromErp({
    sid,
    msku,
    adapter,
    getDirectory,
    productCatalogRepository: productCatalogRepository || repository,
    getSharedCatalog,
    getBoxTemplate,
    sharedCatalogOptions,
    now,
  });
  const erpPackQuantity = Number(erpItem.packQuantity || 0);
  const providedPackQuantity = Number(packQuantity || 0);

  const normalizedBoxCount = Number(boxCount || 0);
  const expectedQuantity = normalizedBoxCount > 0 ? normalizedBoxCount * erpPackQuantity : Number(quantity || 0);
  if (
    normalizedBoxCount > 0
    && Number(quantity || 0) > 0
    && Number(quantity || 0) !== expectedQuantity
    && providedPackQuantity === erpPackQuantity
  ) {
    throw new Error(`发货数量与箱数不一致：应为 ${normalizedBoxCount} × ${erpPackQuantity} = ${expectedQuantity}。`);
  }

  return {
    erpItem,
    packQuantity: erpPackQuantity,
    quantity: expectedQuantity,
    boxDimensions: erpItem.boxDimensions || null,
    boxWeight: erpItem.boxWeight || null,
    boxSource: erpItem.boxSource || "missing",
  };
}

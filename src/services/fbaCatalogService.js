import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaAddressProfile } from "../data/fbaAddressBook.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { getFbaBoxTemplate, hasCompleteBoxSpec } from "./fbaBoxTemplateService.js";
import {
  fetchLingxingListingRecords,
  fetchLingxingProductRecords,
  lingxingSidVariants,
} from "./lingxingCatalogLookupService.js";

const mskuCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const PRODUCT_INFO_BATCH_SIZE = 100;

function normalizeRecordList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  const data = payload?.data || payload || {};
  const records = data.records || data.list || data.rows || data.data || [];
  return Array.isArray(records) ? records : [];
}

function walkObject(value, visit, depth = 0) {
  if (!value || depth > 3) return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkObject(item, visit, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => {
    visit(key, child);
    walkObject(child, visit, depth + 1);
  });
}

function readFirst(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  let found = "";
  walkObject(record, (key, value) => {
    if (found) return;
    if (!normalizedKeys.has(String(key).toLowerCase())) return;
    if (value !== undefined && value !== null && String(value).trim()) found = String(value).trim();
  });
  if (found) return found;
  return "";
}

function readNumber(record, keys) {
  const value = readFirst(record, keys);
  const number = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueText(values) {
  const seen = new Set();
  return values.map(normalizeText).filter((value) => {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function readPackQuantity(record) {
  return readNumber(record, [
    "cg_box_pcs",
    "packQuantity",
    "pack_quantity",
    "packingQuantity",
    "packing_quantity",
    "boxQuantity",
    "box_quantity",
    "box_qty",
    "cartonQuantity",
    "carton_quantity",
    "carton_qty",
    "casePack",
    "case_pack",
    "packageQuantity",
    "package_quantity",
    "perBoxQty",
    "per_box_qty",
    "qtyPerBox",
    "qty_per_box",
    "fbaCartonQty",
    "fba_carton_qty",
    "装箱数量",
    "每箱数量",
    "单箱数量",
    "整箱数量",
    "箱规",
  ]);
}

function readOuterBoxSpec(record) {
  const dimensions = {
    length: readNumber(record, ["cg_box_length", "outer_box_length", "outerBoxLength", "外箱长", "外箱长度", "外箱规格长"]),
    width: readNumber(record, ["cg_box_width", "outer_box_width", "outerBoxWidth", "外箱宽", "外箱宽度", "外箱规格宽"]),
    height: readNumber(record, ["cg_box_height", "outer_box_height", "outerBoxHeight", "外箱高", "外箱高度", "外箱规格高"]),
    unitOfMeasurement: readFirst(record, ["cg_box_length_unit", "box_length_unit", "length_unit", "lengthUnit", "dimension_unit", "dimensionUnit", "unitOfMeasurement", "尺寸单位"]) || "CM",
  };
  const weight = {
    value: readNumber(record, ["cg_box_weight", "outer_box_weight", "outerBoxWeight", "外箱实重", "外箱重量", "外箱重"]),
    unit: readFirst(record, ["cg_box_weight_unit", "box_weight_unit", "weight_unit", "weightUnit", "重量单位"]) || "KG",
  };
  const boxSpec = { dimensions, weight };
  return hasCompleteBoxSpec(boxSpec) ? boxSpec : null;
}

function normalizeMskuRecord(record, shop) {
  const msku = readFirst(record, ["msku", "m_sku", "seller_sku", "sellerSku", "sellerSkuStr", "local_sku", "fnsku", "sku", "item_sku"]);
  if (!msku) return null;

  return {
    msku,
    asin: readFirst(record, ["asin", "ASIN"]),
    sku: readFirst(record, ["sku", "localSku", "local_sku", "product_sku"]),
    skuIdentifier: readFirst(record, ["sku_identifier", "skuIdentifier", "local_sku_identifier", "localSkuIdentifier"]),
    productId: readFirst(record, ["product_id", "productId", "local_product_id", "localProductId"]),
    title: readFirst(record, ["title", "item_name", "itemName", "product_name", "productName", "product_title", "name"]),
    packQuantity: readPackQuantity(record),
    boxSpec: null,
    sid: shop.sid,
    shopName: shop.name,
    displayName: shop.displayName,
    country: shop.country,
  };
}

function normalizeProductRecord(record) {
  const sku = readFirst(record, ["sku", "local_sku", "product_sku", "sku_identifier"]);
  if (!sku) return null;
  return {
    sku,
    skuIdentifier: readFirst(record, ["sku_identifier", "skuIdentifier"]),
    productName: readFirst(record, ["product_name", "productName", "local_name", "name"]),
    packQuantity: readPackQuantity(record),
    boxSpec: readOuterBoxSpec(record),
    raw: record,
  };
}

function mergeProductRecords(target, records) {
  records.map(normalizeProductRecord).filter(Boolean).forEach((product) => {
    target.set(normalizeKey(product.sku), product);
    if (product.skuIdentifier) target.set(normalizeKey(product.skuIdentifier), product);
  });
}

async function safeFetchProductInfo(adapter, params, fallbackParams = null) {
  return fetchLingxingProductRecords(adapter, params, fallbackParams, { strict: true });
}

async function fetchProductInfoMap(adapter, items) {
  const sourceItems = Array.isArray(items) ? items : [];
  const skus = uniqueText(sourceItems.flatMap((item) => [item.sku, item.msku]));
  const skuIdentifiers = uniqueText(sourceItems.flatMap((item) => [item.skuIdentifier, item.sku, item.msku]));
  const productIds = uniqueText(sourceItems.map((item) => item.productId));
  const productMap = new Map();
  if (!skus.length && !skuIdentifiers.length && !productIds.length) return productMap;

  for (const batch of chunkArray(skus, PRODUCT_INFO_BATCH_SIZE)) {
    const records = await safeFetchProductInfo(adapter, { skus: batch }, { sku_list: batch });
    mergeProductRecords(productMap, records);
  }
  for (const batch of chunkArray(skuIdentifiers, PRODUCT_INFO_BATCH_SIZE)) {
    const records = await safeFetchProductInfo(adapter, { sku_identifiers: batch }, { sku_identifier_list: batch });
    mergeProductRecords(productMap, records);
  }
  for (const batch of chunkArray(productIds, PRODUCT_INFO_BATCH_SIZE)) {
    const records = await safeFetchProductInfo(adapter, { productIds: batch });
    mergeProductRecords(productMap, records);
  }

  return productMap;
}

function mergeProductInfo(items, productMap) {
  return items.map((item) => {
    const product = productMap.get(normalizeKey(item.sku))
      || productMap.get(normalizeKey(item.skuIdentifier))
      || productMap.get(normalizeKey(item.msku));
    if (!product) return item;
    return {
      ...item,
      productName: product.productName || item.title || "",
      title: item.title || product.productName || "",
      packQuantity: product.packQuantity || item.packQuantity || 0,
      boxSpec: product.boxSpec || item.boxSpec || null,
      erpSku: product.sku,
    };
  });
}

async function applyBoxTemplates(items) {
  return Promise.all(items.map(async (item) => {
    if (hasCompleteBoxSpec(item.boxSpec)) {
      return {
        ...item,
        boxDimensions: item.boxSpec.dimensions,
        boxWeight: item.boxSpec.weight,
        boxSource: "erp",
      };
    }
    const template = await getFbaBoxTemplate({ sid: item.sid, msku: item.msku });
    if (template && hasCompleteBoxSpec({ dimensions: template.dimensions, weight: template.weight })) {
      return {
        ...item,
        boxDimensions: template.dimensions,
        boxWeight: template.weight,
        boxSource: "template",
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
        uniqueMskus(records.map((record) => normalizeMskuRecord(record, shop)).filter(Boolean)),
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
        sku: item.sku,
        title: item.title,
        reason: "listing_not_paired_to_erp_product",
      })));
    } catch (error) {
      diagnostics.errors.push(`${shop.name}: ${error.message}`);
    }
  }

  diagnostics.unpairedListings = uniqueMskus(diagnostics.unpairedListings);
  diagnostics.message = diagnosticMessage(diagnostics.unpairedListings);
  return diagnostics;
}

function uniqueMskus(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sid}:${item.msku}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchMskusForShop(adapter, shop, { force = false, exactMsku = "" } = {}) {
  const cacheKey = exactMsku ? `${shop.sid}:msku:${normalizeKey(exactMsku)}` : String(shop.sid);
  const cached = mskuCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return cached.items;

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
  for (const variant of variants) {
    try {
      const records = await fetchLingxingListingRecords(adapter, { ...baseParams, ...variant });
      lastPayload = { code: 0, data: records };
      items = uniqueMskus(records.map((record) => normalizeMskuRecord(record, shop)).filter(Boolean));
      if (items.length || lastPayload?.code === 0 || lastPayload?.code === "0") break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && !lastPayload) throw lastError;

  const productMap = await fetchProductInfoMap(adapter, items);
  items = mergeProductInfo(items, productMap);
  items = await applyBoxTemplates(items);

  mskuCache.set(cacheKey, { updatedAt: Date.now(), items });
  return items;
}

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
} = {}) {
  const shops = await resolveRuntimeShops({ sids, adapter, getDirectory });
  const settled = await Promise.allSettled(shops.map((shop) => fetchMskusForShop(adapter, shop)));
  const errors = settled
    .map((result, index) => (result.status === "rejected" ? `${shops[index].name}: ${result.reason.message}` : ""))
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
} = {}) {
  const normalizedSid = Number(sid);
  const normalizedMsku = normalizeMskuText(msku);
  if (!normalizedSid) throw new Error("请选择有效店铺。");
  if (!normalizedMsku) throw new Error("MSKU 不能为空。");

  const [shop] = await resolveRuntimeShops({ sids: [normalizedSid], adapter, getDirectory });
  const items = await fetchMskusForShop(adapter, shop, { force: true, exactMsku: msku });
  const matched = items.find((item) => normalizeMskuText(item.msku) === normalizedMsku);
  if (!matched) {
    throw new Error(`MSKU ${msku} 未在领星 ERP 店铺 ${shop.name} 中匹配到，请检查店铺和 MSKU。`);
  }
  if (!Number(matched.packQuantity || 0)) {
    throw new Error(`MSKU ${matched.msku} 在领星 ERP 未返回装箱数量，请先维护产品管理装箱数量。`);
  }

  return (await applyBoxTemplates([matched]))[0];
}

export async function assertFbaMskuPackMatchesErp({
  sid,
  msku,
  packQuantity,
  boxCount,
  quantity,
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
} = {}) {
  const erpItem = await resolveFbaMskuFromErp({ sid, msku, adapter, getDirectory });
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

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { createPerformanceMetrics } from "../utils/performanceMetrics.js";
import {
  fetchLingxingListingsBySidMskus,
  fetchLingxingProductRecords,
} from "./lingxingCatalogLookupService.js";
import {
  readLingxingSellersCache,
  readSharedProductCatalogCache,
  saveLingxingSellersCache,
  saveSharedProductCatalogCache,
} from "../utils/cacheStore.js";

const PRODUCT_CATALOG_CACHE_VERSION = "shared-product-catalog-v3";
const PRODUCT_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LISTING_BATCH_SIZE = 50;
const PRODUCT_BATCH_SIZE = 80;
const LISTING_SHARED_CATALOG_DIR = path.join(process.cwd(), "data-cache", "listing-shared-catalog");
const sharedProductCatalogRefreshes = new Map();

const productSupplierKeys = [
  "supplier_name",
  "supplierName",
  "supplier",
  "supplier_title",
  "supplierTitle",
  "supplierInfo",
  "supplier_info",
  "provider_name",
  "providerName",
  "factory_name",
  "factoryName",
  "vendor_name",
  "vendorName",
  "purchase_supplier_name",
  "purchaseSupplierName",
  "供应商",
  "工厂名称",
];

const productPriceKeys = [
  "purchase_price",
  "purchasePrice",
  "purchase_cost",
  "purchaseCost",
  "cg_price",
  "unit_cg_price",
  "unit_purchase_cost",
  "product_purchase_cost",
  "local_purchase_cost",
  "cost_price",
  "costPrice",
  "price",
  "采购价",
  "采购价格",
];

const productModelKeys = [
  "attribute",
  "model",
  "model_name",
  "modelName",
  "product_model",
  "productModel",
  "style",
  "specification",
  "specificationName",
  "型号",
];

const productBrandKeys = [
  "brand",
  "brand_name",
  "brandName",
  "brand_title",
  "brandTitle",
  "product_brand",
  "productBrand",
  "品牌",
];

const productMaterialKeys = [
  "material",
  "material_name",
  "materialName",
  "product_material",
  "productMaterial",
  "cg_product_material",
  "cgProductMaterial",
  "customs_clearance_material",
  "customsClearanceMaterial",
  "customs_clearance_en_material",
  "customsClearanceEnMaterial",
  "declaration_material",
  "declarationMaterial",
  "材质",
  "申报材质",
];

const productPurposeKeys = [
  "purpose",
  "usage",
  "use",
  "product_use",
  "productUse",
  "customs_clearance_usage",
  "customsClearanceUsage",
  "customs_clearance_en_usage",
  "customsClearanceEnUsage",
  "declaration_purpose",
  "declarationPurpose",
  "用途",
  "申报用途",
];

const productCustomsCodeKeys = [
  "customs_code",
  "customsCode",
  "clearance_code",
  "clearanceCode",
  "bg_export_hs_code",
  "bgExportHsCode",
  "bg_import_hs_code",
  "bgImportHsCode",
  "customs_declaration_hs_code",
  "customsDeclarationHsCode",
  "customs_clearance_hs_code",
  "customsClearanceHsCode",
  "hs_code",
  "hsCode",
  "hscode",
  "tariff_code",
  "tariffCode",
  "海关编码",
  "清关编码",
  "出口报关编码",
  "中国报关编码",
];

const productBatteryKeys = [
  "is_battery",
  "isBattery",
  "battery",
  "battery_type",
  "batteryType",
  "has_battery",
  "hasBattery",
  "带电",
  "是否带电",
  "是否含电池",
];

const productUnitKeys = [
  "unit",
  "unit_name",
  "unitName",
  "declare_unit",
  "declareUnit",
  "customs_declaration_unit",
  "customsDeclarationUnit",
  "declaration_unit",
  "declarationUnit",
  "单位",
  "申报单位",
];

const productDeclaredValueKeys = [
  "declared_value",
  "declaredValue",
  "declare_unit_price",
  "declareUnitPrice",
  "declaration_price",
  "declarationPrice",
  "bg_customs_import_price",
  "bgCustomsImportPrice",
  "customs_import_price",
  "customsImportPrice",
  "customs_clearance_price",
  "customsClearancePrice",
  "申报单价",
  "申报价格",
];

function hasReadableValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.some((item) => hasReadableValue(item));
  if (typeof value === "object") return false;
  return String(value).trim() !== "";
}

function walkObject(value, visit, depth = 0) {
  if (!value || depth > 4) return;
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

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (hasReadableValue(value)) return value;
  }
  const normalizedKeys = new Set(keys.map((key) => String(key).toLowerCase()));
  let found = "";
  walkObject(item, (key, value) => {
    if (found || !normalizedKeys.has(String(key).toLowerCase()) || !hasReadableValue(value)) return;
    found = value;
  });
  return found || "";
}

function readBatteryDeclaration(record = {}) {
  const explicit = readFirst(record, productBatteryKeys);
  if (explicit) return explicit;
  const specialAttrs = Array.isArray(record.special_attr)
    ? record.special_attr
    : Array.isArray(record.specialAttr)
      ? record.specialAttr
      : [];
  return specialAttrs.map((value) => String(value).trim()).includes("1") ? "是" : "";
}

function readArrayText(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && String(item).trim() !== "").map(String).join(" / ");
  if (typeof value === "string") {
    const text = value.trim();
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
      try {
        return readArrayText(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  return value === undefined || value === null ? "" : String(value);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/¥/g, "").replace(/￥/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

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

function findImageUrl(source, depth = 0) {
  if (!source || depth > 4) return "";
  if (typeof source === "string") {
    const text = source.trim();
    if (!text) return "";
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
      try {
        return findImageUrl(JSON.parse(text), depth + 1);
      } catch {
        return /^https?:\/\//i.test(text) ? text : "";
      }
    }
    return /^https?:\/\//i.test(text) ? text : "";
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof source !== "object") return "";
  const preferredKeys = [
    "image_url",
    "imageUrl",
    "small_image_url",
    "smallImageUrl",
    "main_image",
    "mainImage",
    "main_image_url",
    "mainImageUrl",
    "large_image_url",
    "largeImageUrl",
    "medium_image_url",
    "mediumImageUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "pic_url",
    "picUrl",
    "picture_url",
    "pictureUrl",
    "product_image",
    "productImage",
    "img",
    "image",
    "images",
    "image_list",
    "imageList",
    "pic",
    "picture",
    "photo",
    ...(depth > 0 ? ["url", "src", "href", "thumbnail"] : []),
  ];
  for (const key of preferredKeys) {
    const found = findImageUrl(source[key], depth + 1);
    if (found) return found;
  }
  return "";
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

function mergeProductCatalogInfo(existing = {}, incoming = {}) {
  return {
    ...existing,
    ...incoming,
    sku: incoming.sku || existing.sku || "",
    internalSku: incoming.internalSku || existing.internalSku || "",
    skuIdentifier: incoming.skuIdentifier || existing.skuIdentifier || "",
    productId: incoming.productId || existing.productId || "",
    msku: incoming.msku || existing.msku || "",
    sid: incoming.sid || existing.sid || 0,
    storeName: incoming.storeName || existing.storeName || "",
    country: incoming.country || existing.country || "",
    productName: incoming.productName || existing.productName || "",
    imageUrl: incoming.imageUrl || existing.imageUrl || "",
    supplier: incoming.supplier || existing.supplier || "",
    purchasePrice: incoming.purchasePrice || existing.purchasePrice || 0,
    model: incoming.model || existing.model || "",
    brand: incoming.brand || existing.brand || "",
    material: incoming.material || existing.material || "",
    purpose: incoming.purpose || existing.purpose || "",
    customsCode: incoming.customsCode || existing.customsCode || "",
    isBattery: incoming.isBattery || existing.isBattery || "",
    unit: incoming.unit || existing.unit || "",
    declaredValue: incoming.declaredValue || existing.declaredValue || 0,
    asin: incoming.asin || existing.asin || "",
    raw: incoming.raw || existing.raw || null,
  };
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
    map.set(normalizedKey, mergeProductCatalogInfo(map.get(normalizedKey), product));
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
  const msku = readArrayText(readFirst(record, ["msku", "m_sku", "seller_sku", "sellerSku", "sellerSkuStr", "local_sku", "item_sku", "fnsku"])).trim();
  if (!msku) return null;
  return {
    sid: toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"])) || Number(fallbackSid || 0),
    msku,
    storeName: readFirst(record, ["storeName", "store_name", "seller", "seller_name", "shop_name", "店铺"]),
    country: readFirst(record, ["country", "countryName", "country_name", "marketplace", "国家"]),
    sku: readFirst(record, ["sku", "local_sku", "localSku", "product_sku", "sku_identifier", "skuIdentifier"]),
    internalSku: readFirst(record, ["local_sku", "localSku", "sku", "product_sku", "sku_identifier", "skuIdentifier"]),
    skuIdentifier: readFirst(record, ["sku_identifier", "skuIdentifier", "local_sku_identifier", "localSkuIdentifier"]),
    productId: readFirst(record, ["product_id", "productId", "local_product_id", "localProductId"]),
    productName: readArrayText(readFirst(record, ["local_name", "localName", "product_name", "productName", "item_name", "itemName", "title", "product_title", "name"])),
    imageUrl: findImageUrl(record),
    supplier: readFirst(record, productSupplierKeys),
    purchasePrice: toNumber(readFirst(record, productPriceKeys)),
    model: readFirst(record, productModelKeys),
    brand: readFirst(record, productBrandKeys),
    material: readFirst(record, productMaterialKeys),
    purpose: readFirst(record, productPurposeKeys),
    customsCode: readFirst(record, productCustomsCodeKeys),
    isBattery: readBatteryDeclaration(record),
    unit: readFirst(record, productUnitKeys),
    declaredValue: toNumber(readFirst(record, productDeclaredValueKeys)),
    asin: readFirst(record, ["asin", "ASIN"]),
    raw: record,
  };
}

function normalizeListingSharedCatalogRecord(record = {}) {
  const msku = readArrayText(readFirst(record, ["MSKU", "msku", "m_sku", "seller_sku", "sellerSku", "sellerSkuStr"])).trim();
  const internalSku = readArrayText(readFirst(record, ["SKU", "sku", "local_sku", "localSku", "product_sku", "商品SKU"])).trim();
  if (!msku || !internalSku) return null;
  return {
    sid: toNumber(readFirst(record, ["sid", "SID", "seller_id", "sellerId", "store_id", "storeId"])),
    msku,
    sku: internalSku,
    internalSku,
    storeName: readFirst(record, ["店铺", "storeName", "store_name", "seller", "seller_name", "shop_name"]),
    country: readFirst(record, ["国家", "country", "countryName", "country_name", "marketplace"]),
    productName: readArrayText(readFirst(record, ["品名", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "title", "标题"])),
    asin: readFirst(record, ["ASIN", "asin"]),
    raw: record,
  };
}

function normalizeSharedProductRecord(record = {}) {
  const sku = String(readFirst(record, ["sku", "local_sku", "localSku", "product_sku", "sku_identifier", "skuIdentifier"]) || "").trim();
  return {
    sku,
    internalSku: sku,
    skuIdentifier: readFirst(record, ["sku_identifier", "skuIdentifier", "local_sku_identifier", "localSkuIdentifier"]),
    productId: readFirst(record, ["product_id", "productId", "local_product_id", "localProductId"]),
    productName: readFirst(record, ["product_name", "productName", "local_name", "localName", "name", "item_name", "itemName"]),
    imageUrl: findImageUrl(record),
    supplier: readFirst(record, productSupplierKeys),
    purchasePrice: toNumber(readFirst(record, productPriceKeys)),
    model: readFirst(record, productModelKeys),
    brand: readFirst(record, productBrandKeys),
    material: readFirst(record, productMaterialKeys),
    purpose: readFirst(record, productPurposeKeys),
    customsCode: readFirst(record, productCustomsCodeKeys),
    isBattery: readBatteryDeclaration(record),
    unit: readFirst(record, productUnitKeys),
    declaredValue: toNumber(readFirst(record, productDeclaredValueKeys)),
    asin: readFirst(record, ["asin", "ASIN"]),
    raw: record,
  };
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
      raw: null,
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

  productRecords.map(normalizeSharedProductRecord).forEach((product) => {
    const keys = [product.sku, product.skuIdentifier, product.productId].map(productCatalogKey).filter(Boolean);
    const linkedProducts = keys.map((key) => map.get(key)).filter(Boolean);
    putProductCatalog(map, product);
    linkedProducts.forEach((linked) => {
      const merged = mergeProductCatalogInfo(linked, product);
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

async function listingSharedCatalogFilePaths() {
  const configured = String(process.env.LISTING_SHARED_CATALOG_FILE || "").trim();
  if (configured) return [configured];
  try {
    const names = await readdir(LISTING_SHARED_CATALOG_DIR);
    const paths = [];
    for (const name of names) {
      if (!/\.xlsx$/i.test(name) || name.startsWith("._")) continue;
      const filePath = path.join(LISTING_SHARED_CATALOG_DIR, name);
      const info = await stat(filePath);
      if (info.isFile()) paths.push(filePath);
    }
    return paths.sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readListingSharedCatalogRecords({ files = null } = {}) {
  const filePaths = Array.isArray(files) ? files : await listingSharedCatalogFilePaths();
  if (!filePaths.length) return [];
  const module = await import("xlsx");
  const XLSX = module.default || module;
  const records = [];
  for (const filePath of filePaths) {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    workbook.SheetNames.forEach((sheetName) => {
      records.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }));
    });
  }
  return records;
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

function listingSharedCatalogMatchesRow(row = {}, listing = {}) {
  const rowMskus = String(row.msku || "").split("/").map((value) => productCatalogKey(value)).filter(Boolean);
  if (!rowMskus.includes(productCatalogKey(listing.msku))) return false;
  if (row.storeName && listing.storeName) return productCatalogKey(row.storeName) === productCatalogKey(listing.storeName);
  if (row.country && listing.country) return productCatalogKey(row.country) === productCatalogKey(listing.country);
  if (row.sid && listing.sid) return Number(row.sid) === Number(listing.sid);
  return true;
}

async function fetchListingSharedCatalogItems(rows = [], apiListingItems = [], {
  listingSharedCatalogRecords = null,
  readListingSharedCatalog = readListingSharedCatalogRecords,
  strict = false,
} = {}) {
  const missingRows = rows.filter((row) => !apiListingItems.some((item) => listingItemHasInternalSkuForRow(row, item)));
  if (!missingRows.length) return [];
  let rawRecords = [];
  try {
    rawRecords = Array.isArray(listingSharedCatalogRecords)
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
  const listings = rawRecords.map(normalizeListingSharedCatalogRecord).filter(Boolean);
  const matched = [];
  missingRows.forEach((row) => {
    listings
      .filter((listing) => listingSharedCatalogMatchesRow(row, listing))
      .forEach((listing) => matched.push({
        ...listing,
        sid: listing.sid || Number(row.sid || 0),
        storeName: listing.storeName || row.storeName || "",
        country: listing.country || row.country || "",
      }));
  });
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
  readCache = readLingxingSellersCache,
  saveCache = saveLingxingSellersCache,
} = {}) {
  if (!forceRefresh) {
    const cached = await readCache();
    const sellers = filterCoreSellers(cached?.sellers || []);
    if (sellers.length) {
      return {
        sellers,
        updatedAt: cached?.updatedAt || "",
        cacheHit: true,
        source: "lingxing-sellers-cache",
      };
    }
  }

  const payload = await adapter.fetchSellers();
  const sellers = filterCoreSellers(payload?.data || []);
  if (sellers.length) await saveCache(sellers);
  return {
    sellers,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    cacheHit: false,
    source: "lingxing-api",
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
  const product = matches.reduce((merged, item) => mergeProductCatalogInfo(merged, item.product), {});
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

import { normalizeCatalogKey } from "./productCatalogIdentity.js";

// These arrays are the compatibility boundary for upstream Lingxing records. Keep
// them explicit: a new upstream field must be deliberately mapped before it can
// enter the shared catalog.
export const SID_KEYS = [
  "sid",
  "SID",
  "seller_id",
  "sellerId",
  "store_id",
  "storeId",
];

export const LISTING_MSKU_KEYS = [
  "msku",
  "MSKU",
  "m_sku",
  "seller_sku",
  "sellerSku",
  "sellerSkuStr",
  "item_sku",
  "fnsku",
  // Some historical Listing responses expose the Amazon SKU as `sku`. Keep it
  // as the final fallback, after the explicit MSKU/seller_sku fields. The ERP
  // `local_sku` field is deliberately absent because it is never an MSKU.
  "sku",
];

export const LISTING_INTERNAL_SKU_KEYS = [
  "local_sku",
  "localSku",
  "sku",
  "product_sku",
  "productSku",
  "sku_identifier",
  "skuIdentifier",
  "商品SKU",
];

export const PRODUCT_SKU_KEYS = [
  "sku",
  "local_sku",
  "localSku",
  "product_sku",
  "productSku",
  "sku_identifier",
  "skuIdentifier",
];

export const PRODUCT_ID_KEYS = [
  "product_id",
  "productId",
  "local_product_id",
  "localProductId",
];

export const SKU_IDENTIFIER_KEYS = [
  "sku_identifier",
  "skuIdentifier",
  "local_sku_identifier",
  "localSkuIdentifier",
];

export const PRODUCT_NAME_KEYS = [
  "local_name",
  "localName",
  "product_name",
  "productName",
  "item_name",
  "itemName",
  "title",
  "product_title",
  "productTitle",
  "name",
  "品名",
  "标题",
];

export const SUPPLIER_KEYS = [
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

export const PRICE_KEYS = [
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

export const MODEL_KEYS = [
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

export const BRAND_KEYS = [
  "brand",
  "brand_name",
  "brandName",
  "brand_title",
  "brandTitle",
  "product_brand",
  "productBrand",
  "品牌",
];

export const MATERIAL_KEYS = [
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

export const PURPOSE_KEYS = [
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

export const CUSTOMS_CODE_KEYS = [
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

export const BATTERY_KEYS = [
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

export const UNIT_KEYS = [
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

export const DECLARED_VALUE_KEYS = [
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

const IMAGE_KEYS = [
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
];

const PRODUCT_FIELD_NAMES = [
  "internalSku",
  "sku",
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
  "productId",
  "skuIdentifier",
  "asin",
];

const LISTING_FIELD_NAMES = [
  "sid",
  "msku",
  "mskuKey",
  "internalSku",
  "internalSkuSourceField",
  "internalSkuKey",
  "listingSku",
  "listingSkuSourceField",
  "asin",
  "storeName",
  "country",
  "countryCode",
  "displayName",
  "sku",
  "skuIdentifier",
  "productId",
  "productName",
  "imageUrl",
];

const NUMERIC_PRODUCT_FIELDS = new Set(["sid", "purchasePrice", "declaredValue", "packQuantity"]);
const TEXT_FIELDS = new Set([
  "internalSku",
  "sku",
  "productName",
  "imageUrl",
  "supplier",
  "model",
  "brand",
  "material",
  "purpose",
  "customsCode",
  "isBattery",
  "unit",
  "productId",
  "skuIdentifier",
  "msku",
  "mskuKey",
  "internalSkuKey",
  "listingSku",
  "asin",
  "internalSkuSourceField",
  "listingSkuSourceField",
  "storeName",
  "country",
  "countryCode",
  "displayName",
  "sku",
]);

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

function readFirstWithKey(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (hasReadableValue(value)) return { value, sourceField: key };
  }
  const normalizedKeys = new Set(keys.map((key) => String(key).toLowerCase()));
  let found = null;
  walkObject(item, (key, value) => {
    if (found || !normalizedKeys.has(String(key).toLowerCase()) || !hasReadableValue(value)) return;
    found = { value, sourceField: key };
  });
  return found || { value: "", sourceField: "" };
}

/** Read an Amazon Listing MSKU using the canonical field precedence. */
export function readCatalogListingMsku(record = {}) {
  return textValue(readFirst(record, LISTING_MSKU_KEYS));
}

function readArrayText(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined && item !== null && String(item).trim() !== "")
      .map(String)
      .join(" / ");
  }
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
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value)
    .replace(/,/g, "")
    .replace(/¥/g, "")
    .replace(/￥/g, "")
    .replace(/%/g, ""));
  return Number.isFinite(number) ? number : null;
}

function readNumber(record, keys) {
  return toNumber(readFirst(record, keys));
}

function readBatteryValue(record = {}) {
  const explicit = readFirst(record, BATTERY_KEYS);
  if (explicit) return readArrayText(explicit);
  const specialAttrs = Array.isArray(record.special_attr)
    ? record.special_attr
    : Array.isArray(record.specialAttr)
      ? record.specialAttr
      : [];
  const codes = specialAttrs.map((value) => String(value).trim()).filter(Boolean);
  if (codes.includes("1")) return "是";
  if (codes.includes("8")) return "否";
  if (codes.length) {
    console.warn("[product-catalog-normalization] 未识别产品带电属性码", {
      sku: readFirst(record, PRODUCT_SKU_KEYS),
      productId: readFirst(record, PRODUCT_ID_KEYS),
      specialAttrs: codes,
    });
  }
  return "";
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
  const preferredKeys = [...IMAGE_KEYS, ...(depth > 0 ? ["url", "src", "href", "thumbnail"] : [])];
  for (const key of preferredKeys) {
    const found = findImageUrl(source[key], depth + 1);
    if (found) return found;
  }
  return "";
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
    unitOfMeasurement: readArrayText(readFirst(record, ["cg_box_length_unit", "box_length_unit", "length_unit", "lengthUnit", "dimension_unit", "dimensionUnit", "unitOfMeasurement", "尺寸单位"])) || "CM",
  };
  const weight = {
    value: readNumber(record, ["cg_box_weight", "outer_box_weight", "outerBoxWeight", "外箱实重", "外箱重量", "外箱重"]),
    unit: readArrayText(readFirst(record, ["cg_box_weight_unit", "box_weight_unit", "weight_unit", "weightUnit", "重量单位"])) || "KG",
  };
  const hasBoxValue = [
    dimensions.length,
    dimensions.width,
    dimensions.height,
    weight.value,
  ].some((value) => value !== null);
  return hasBoxValue ? { dimensions, weight } : null;
}

function textValue(value) {
  if (value === undefined || value === null) return "";
  return readArrayText(value).trim();
}

function numberValue(value) {
  return value === undefined || value === null || value === "" ? null : toNumber(value);
}

function normalizeListingContext(record, listing, internalSkuSourceField) {
  const product = normalizeCatalogProduct(record);
  const localSkuSource = ["local_sku", "localsku"].includes(String(internalSkuSourceField || "").toLowerCase());
  const context = {
    storeName: textValue(readFirst(record, ["storeName", "store_name", "seller", "seller_name", "shop_name", "店铺"])),
    country: textValue(readFirst(record, ["country", "countryName", "country_name", "marketplace", "国家"])),
    countryCode: textValue(readFirst(record, ["country_code", "countryCode", "marketplaceCode", "marketplace_code", "region"])),
    displayName: textValue(readFirst(record, ["displayName", "display_name", "shopDisplayName", "shop_display_name"])),
    sku: listing.internalSku,
    internalSkuSourceField: textValue(internalSkuSourceField),
    listingSkuSourceField: localSkuSource ? "local_sku" : "",
    skuIdentifier: textValue(readFirst(record, SKU_IDENTIFIER_KEYS)),
    productId: textValue(readFirst(record, PRODUCT_ID_KEYS)),
    imageUrl: product?.imageUrl || "",
    supplier: product?.supplier || "",
    purchasePrice: product?.purchasePrice ?? null,
    model: product?.model || "",
    brand: product?.brand || "",
    material: product?.material || "",
    purpose: product?.purpose || "",
    customsCode: product?.customsCode || "",
    isBattery: product?.isBattery || "",
    unit: product?.unit || "",
    declaredValue: product?.declaredValue ?? null,
    packQuantity: product?.packQuantity ?? null,
    boxSpec: product?.boxSpec || null,
  };
  return { ...listing, ...context };
}

/**
 * Normalize an upstream Listing into the canonical identity fields. local_sku
 * is deliberately copied to listingSku; seller_sku/MSKU is never copied there.
 */
export function normalizeCatalogListing(record = {}, { fallbackSid = 0 } = {}) {
  const msku = readCatalogListingMsku(record);
  if (!msku) return null;
  const internalSkuEntry = hasReadableValue(record.internalSku)
    ? {
      value: record.internalSku,
      sourceField: textValue(record.internalSkuSourceField)
        || (textValue(record.listingSkuSourceField) === "local_sku" ? "local_sku" : "internalSku"),
    }
    : readFirstWithKey(record, LISTING_INTERNAL_SKU_KEYS);
  const internalSku = textValue(internalSkuEntry.value);
  const localSkuSource = ["local_sku", "localsku"].includes(String(internalSkuEntry.sourceField || "").toLowerCase());
  const listing = {
    sid: toNumber(readFirst(record, SID_KEYS)) || Number(fallbackSid) || 0,
    msku,
    internalSku,
    listingSku: localSkuSource ? textValue(record.listingSku) || internalSku : "",
    asin: textValue(readFirst(record, ["asin", "ASIN"])),
    productName: textValue(readFirst(record, PRODUCT_NAME_KEYS)),
  };
  return normalizeListingContext(record, listing, internalSkuEntry.sourceField);
}

/** Normalize an upstream product into an explicit, raw-free whitelist. */
export function normalizeCatalogProduct(record = {}) {
  const internalSku = textValue(readFirst(record, PRODUCT_SKU_KEYS));
  if (!internalSku) return null;
  return {
    internalSku,
    sku: internalSku,
    productName: textValue(readFirst(record, PRODUCT_NAME_KEYS)),
    imageUrl: findImageUrl(record),
    supplier: textValue(readFirst(record, SUPPLIER_KEYS)),
    purchasePrice: numberValue(readFirst(record, PRICE_KEYS)),
    model: textValue(readFirst(record, MODEL_KEYS)),
    brand: textValue(readFirst(record, BRAND_KEYS)),
    material: textValue(readFirst(record, MATERIAL_KEYS)),
    purpose: textValue(readFirst(record, PURPOSE_KEYS)),
    customsCode: textValue(readFirst(record, CUSTOMS_CODE_KEYS)),
    isBattery: readBatteryValue(record),
    unit: textValue(readFirst(record, UNIT_KEYS)),
    declaredValue: numberValue(readFirst(record, DECLARED_VALUE_KEYS)),
    packQuantity: readPackQuantity(record),
    boxSpec: readOuterBoxSpec(record),
    productId: readFirst(record, PRODUCT_ID_KEYS),
    skuIdentifier: readFirst(record, SKU_IDENTIFIER_KEYS),
    asin: textValue(readFirst(record, ["asin", "ASIN"])),
  };
}

function hasProductValue(value, field) {
  if (NUMERIC_PRODUCT_FIELDS.has(field)) return value !== null && value !== undefined && Number.isFinite(Number(value));
  if (field === "boxSpec") return value !== null && value !== undefined;
  return hasReadableValue(value);
}

function cloneBoxSpec(boxSpec) {
  if (!boxSpec || typeof boxSpec !== "object") return boxSpec || null;
  const dimensions = boxSpec.dimensions && typeof boxSpec.dimensions === "object" ? boxSpec.dimensions : {};
  const weight = boxSpec.weight && typeof boxSpec.weight === "object" ? boxSpec.weight : {};
  return {
    dimensions: {
      length: dimensions.length ?? null,
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      unitOfMeasurement: dimensions.unitOfMeasurement ?? null,
    },
    weight: {
      value: weight.value ?? null,
      unit: weight.unit ?? null,
    },
  };
}

/** Merge two normalized records without spreading arbitrary upstream fields. */
export function mergeCatalogProduct(existing = {}, incoming = {}) {
  const merged = {};
  for (const field of [...PRODUCT_FIELD_NAMES, ...LISTING_FIELD_NAMES]) {
    if (Object.hasOwn(merged, field)) continue;
    const next = incoming?.[field];
    const previous = existing?.[field];
    if (field === "boxSpec") {
      merged[field] = hasProductValue(next, field) ? cloneBoxSpec(next) : cloneBoxSpec(previous);
    } else if (NUMERIC_PRODUCT_FIELDS.has(field)) {
      merged[field] = hasProductValue(next, field) ? Number(next)
        : hasProductValue(previous, field) ? Number(previous)
          : null;
    } else if (TEXT_FIELDS.has(field)) {
      merged[field] = hasProductValue(next, field) ? textValue(next)
        : hasProductValue(previous, field) ? textValue(previous)
          : "";
    }
  }
  return merged;
}

function asTimestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function repositoryProductRow(product, options) {
  if (!product?.internalSku) return null;
  const source = textValue(options.source) || "product-catalog-normalization";
  const sourceUpdatedAtMs = asTimestamp(options.sourceUpdatedAtMs);
  const refreshedAtMs = asTimestamp(options.refreshedAtMs, sourceUpdatedAtMs);
  const internalSku = textValue(product.internalSku);
  return {
    internalSkuKey: normalizeCatalogKey(internalSku),
    internalSku,
    productName: textValue(product.productName),
    imageUrl: textValue(product.imageUrl),
    supplier: textValue(product.supplier),
    purchasePrice: numberValue(product.purchasePrice),
    model: textValue(product.model),
    brand: textValue(product.brand),
    material: textValue(product.material),
    purpose: textValue(product.purpose),
    customsCode: textValue(product.customsCode),
    isBattery: textValue(product.isBattery),
    unit: textValue(product.unit),
    declaredValue: numberValue(product.declaredValue),
    packQuantity: numberValue(product.packQuantity),
    boxSpec: cloneBoxSpec(product.boxSpec),
    productId: textValue(product.productId),
    skuIdentifier: textValue(product.skuIdentifier),
    source,
    sourceUpdatedAtMs,
    refreshedAtMs,
  };
}

function repositoryListingRow(listing, options, internalSku) {
  if (!listing?.sid || !listing?.msku) return null;
  const source = textValue(options.source) || "product-catalog-normalization";
  const sourceUpdatedAtMs = asTimestamp(options.sourceUpdatedAtMs);
  const refreshedAtMs = asTimestamp(options.refreshedAtMs, sourceUpdatedAtMs);
  const msku = textValue(listing.msku);
  const listingInternalSku = textValue(listing.internalSku || internalSku);
  return {
    sid: Number(listing.sid),
    mskuKey: normalizeCatalogKey(msku),
    msku,
    internalSkuKey: listingInternalSku ? normalizeCatalogKey(listingInternalSku) : null,
    internalSku: listingInternalSku,
    listingSku: textValue(listing.listingSku),
    asin: textValue(listing.asin),
    storeName: textValue(listing.storeName),
    country: textValue(listing.country),
    source,
    sourceUpdatedAtMs,
    refreshedAtMs,
  };
}

function buildAliases(product, listing, options, internalSkuKey) {
  const source = textValue(options.source) || "product-catalog-normalization";
  const updatedAtMs = asTimestamp(options.refreshedAtMs, asTimestamp(options.sourceUpdatedAtMs));
  const aliases = [];
  const addAlias = (aliasType, value, extra = {}) => {
    const aliasValue = textValue(value);
    const aliasKey = normalizeCatalogKey(aliasValue);
    if (!aliasValue || !aliasKey || !internalSkuKey) return;
    aliases.push({ aliasType, aliasKey, aliasValue, internalSkuKey, source, updatedAtMs, ...extra });
  };
  addAlias("product_id", product?.productId);
  addAlias("sku_identifier", product?.skuIdentifier);
  // This field is always the ERP Listing local_sku value. Never derive it from
  // seller_sku/MSKU, because seller_sku is scoped to a Listing, not a product.
  const listingSku = textValue(listing?.listingSku);
  const listingInternalSku = textValue(listing?.internalSku);
  if (listingSku && listingInternalSku && normalizeCatalogKey(listingSku) === normalizeCatalogKey(listingInternalSku)) {
    addAlias("listing_sku", listingSku, { sourceField: "local_sku" });
  }
  return aliases;
}

/**
 * Convert normalized product/listing data into the repository's whitelisted row
 * shape. Both array keys and singular non-enumerable conveniences are exposed
 * so callers can pass the result directly to upsertCatalog or inspect one row.
 */
export function catalogProductToRepositoryRows(input = {}, listingOrOptions = {}, optionsArg = {}) {
  const isRecord = input && typeof input === "object" && !Array.isArray(input);
  const product = isRecord && Object.hasOwn(input, "product") ? input.product : input;
  const secondLooksListing = listingOrOptions && typeof listingOrOptions === "object"
    && (Object.hasOwn(listingOrOptions, "msku") || Object.hasOwn(listingOrOptions, "listingSku"));
  const listing = isRecord && Object.hasOwn(input, "listing") ? input.listing
    : (isRecord && Object.hasOwn(input, "listingRecord") ? input.listingRecord : null);
  const resolvedListing = listing || ((!isRecord || !Object.hasOwn(input, "product")) && secondLooksListing ? listingOrOptions : null);
  const options = isRecord && (Object.hasOwn(input, "source") || Object.hasOwn(input, "sourceUpdatedAtMs") || Object.hasOwn(input, "refreshedAtMs"))
    ? input
    : listingOrOptions && Object.hasOwn(listingOrOptions, "source") && !secondLooksListing ? listingOrOptions : optionsArg;
  const productRow = repositoryProductRow(product, options || {});
  const listingRow = repositoryListingRow(resolvedListing, options || {}, productRow?.internalSku);
  const aliases = buildAliases(product, resolvedListing, options || {}, productRow?.internalSkuKey || "");
  const result = {
    products: productRow ? [productRow] : [],
    aliases,
    listings: listingRow ? [listingRow] : [],
  };
  Object.defineProperties(result, {
    product: { enumerable: false, value: productRow },
    listing: { enumerable: false, value: listingRow },
  });
  return result;
}

export { hasReadableValue, findImageUrl, readArrayText, readFirst, readPackQuantity, readOuterBoxSpec };

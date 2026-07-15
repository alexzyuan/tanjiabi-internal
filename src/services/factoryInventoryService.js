import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import {
  applySharedProductCatalogToRows,
  getCurrentFbaInventoryByMsku,
  getSharedSellers,
  getSharedProductCatalogMap,
} from "./sharedDataService.js";
import {
  readFactoryInventoryCache,
  saveFactoryInventoryCache,
} from "../utils/cacheStore.js";
import { readJsonFileWithRecovery } from "../utils/jsonFile.js";

const FACTORY_INVENTORY_CACHE_VERSION = "factory-inventory-v4-row-manual-key";
const FACTORY_INVENTORY_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_START_DATE = "2026-03-01";
const PURCHASE_ORDER_PAGE_SIZE = 500;
const FACTORY_INVENTORY_SHIPPED_FILE = path.join(process.cwd(), "data-cache", "factory-inventory-shipped-quantities.json");
let shippedQuantityWriteQueue = Promise.resolve();
const factoryInventoryBuildPromises = new Map();

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function readDeepFirst(item, keys, maxDepth = 4) {
  const direct = readFirst(item, keys);
  if (direct !== "") return direct;
  const normalized = new Set(keys.map((key) => String(key).toLowerCase()));
  let found = "";
  const visit = (value, depth = 0) => {
    if (found || !value || depth > maxDepth) return;
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (!found && normalized.has(String(key).toLowerCase()) && child !== undefined && child !== null && String(child).trim() !== "") {
        found = child;
      }
      visit(child, depth + 1);
    });
  };
  visit(item);
  return found;
}

function readArray(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (Array.isArray(value)) return value;
  }
  let found = [];
  const normalized = new Set(keys.map((key) => String(key).toLowerCase()));
  const visit = (value, depth = 0) => {
    if (found.length || !value || depth > 3) return;
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (!found.length && normalized.has(String(key).toLowerCase()) && Array.isArray(child)) {
        found = child;
        return;
      }
      visit(child, depth + 1);
    });
  };
  visit(item);
  return found;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/¥/g, "").replace(/￥/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function dateOnly(value) {
  const text = String(value || "").trim().replace(/\//g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeMsku(value) {
  return String(value || "").trim();
}

function mskuKey(value) {
  return normalizeMsku(value).toLowerCase();
}

function displayMskus(values = []) {
  return [...new Set(values.map(normalizeMsku).filter(Boolean))].join(" / ");
}

function legacyFactoryInventoryManualKey({ purchaseOrderNo = "", sku = "", msku = "" } = {}) {
  return [purchaseOrderNo, sku, msku].map((value) => String(value || "").trim()).join("|");
}

function factoryInventoryManualKey({
  purchaseOrderNo = "",
  lineId = "",
  sid = "",
  sku = "",
  msku = "",
  storeName = "",
  country = "",
  itemIndex = "",
} = {}) {
  const linePart = lineId ? `line:${lineId}` : `idx:${itemIndex}`;
  const storePart = sid ? `sid:${sid}` : `store:${storeName || country}`;
  return [purchaseOrderNo, linePart, storePart, sku, msku].map((value) => String(value || "").trim()).join("|");
}

export function isFactoryInventoryRowManualKey(value = "") {
  const key = String(value || "");
  return key.includes("|line:") || key.includes("|idx:");
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

function imageUrlFrom(item) {
  const direct = readDeepFirst(item, [
    "image_url",
    "imageUrl",
    "small_image_url",
    "smallImageUrl",
    "main_image",
    "mainImage",
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
  ]);
  return findImageUrl(direct) || findImageUrl(item);
}

function readPurchaseOrderNo(order) {
  return String(readDeepFirst(order, [
    "purchase_order_no",
    "purchaseOrderNo",
    "purchase_order_sn",
    "purchaseOrderSn",
    "purchase_no",
    "purchaseNo",
    "order_sn",
    "orderSn",
    "custom_order_sn",
    "customOrderSn",
    "order_no",
    "orderNo",
    "po_no",
    "poNo",
    "bill_no",
    "billNo",
    "code",
    "sn",
    "id",
  ]) || "").trim();
}

function readFactoryName(order, item = {}) {
  return String(readDeepFirst(item, [
    "supplier_name",
    "supplierName",
    "factory_name",
    "factoryName",
    "provider_name",
    "providerName",
    "vendor_name",
    "vendorName",
  ]) || readDeepFirst(order, [
    "supplier_name",
    "supplierName",
    "factory_name",
    "factoryName",
    "provider_name",
    "providerName",
    "vendor_name",
    "vendorName",
    "supplier",
    "factory",
  ]) || "").trim();
}

function readOrderCreatedAt(order) {
  return String(readDeepFirst(order, [
    "create_time",
    "createTime",
    "created_at",
    "createdAt",
    "order_time",
    "orderTime",
    "purchase_time",
    "purchaseTime",
    "bill_date",
    "billDate",
  ]) || "").trim();
}

function purchaseOrderStatusText(order) {
  return String(readDeepFirst(order, [
    "status_text",
    "statusText",
    "status_name",
    "statusName",
    "state_text",
    "stateText",
    "status_desc",
    "statusDesc",
    "order_status_text",
    "orderStatusText",
    "purchase_status_text",
    "purchaseStatusText",
  ]) || "").trim();
}

function isInvalidPurchaseOrder(order) {
  const statusText = purchaseOrderStatusText(order).toLowerCase();
  if (/作废|已废弃|废弃|取消|已取消|删除|已删除|无效|invalid|void|cancel|canceled|cancelled|deleted/i.test(statusText)) return true;
  const status = String(readDeepFirst(order, [
    "status",
    "order_status",
    "orderStatus",
    "purchase_status",
    "purchaseStatus",
  ]) || "").trim();
  const invalidFlags = [
    readDeepFirst(order, ["is_invalid", "isInvalid"]),
    readDeepFirst(order, ["is_void", "isVoid"]),
    readDeepFirst(order, ["is_cancel", "isCancel", "is_canceled", "isCanceled"]),
    readDeepFirst(order, ["is_delete", "isDelete", "delete_status", "deleteStatus"]),
  ];
  return status === "124" || invalidFlags.some((value) => ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase()));
}

function isValidPurchaseOrder(order) {
  return !isInvalidPurchaseOrder(order);
}

function readWarehouseName(order, item = {}) {
  return String(readDeepFirst(item, [
    "ware_house_name",
    "wareHouseName",
    "warehouse_name",
    "warehouseName",
  ]) || readDeepFirst(order, [
    "ware_house_name",
    "wareHouseName",
    "warehouse_name",
    "warehouseName",
    "ware_house_bak_name",
    "wareHouseBakName",
  ]) || "").trim();
}

function readPurchaserName(order) {
  return String(readDeepFirst(order, [
    "opt_realname",
    "optRealname",
    "purchaser_name",
    "purchaserName",
    "buyer_name",
    "buyerName",
    "principal_name",
    "principalName",
  ]) || "").trim();
}

function readSid(item = {}, order = {}) {
  return toNumber(readDeepFirst(item, [
    "sid",
    "seller_id",
    "sellerId",
    "store_id",
    "storeId",
  ]) || readDeepFirst(order, [
    "sid",
    "seller_id",
    "sellerId",
    "store_id",
    "storeId",
  ]));
}

function readLineId(item = {}) {
  return String(readDeepFirst(item, [
    "id",
    "detail_id",
    "detailId",
    "purchase_detail_id",
    "purchaseDetailId",
    "purchase_order_detail_id",
    "purchaseOrderDetailId",
    "plan_sn",
    "planSn",
    "relation_purchase_plan",
    "relationPurchasePlan",
    "product_id",
    "productId",
  ]) || "").trim();
}

function sellerName(seller = {}) {
  return String(readDeepFirst(seller, [
    "name",
    "displayName",
    "seller_name",
    "sellerName",
    "shop_name",
    "shopName",
    "store_name",
    "storeName",
    "account_name",
    "accountName",
  ]) || "").trim();
}

function sellerCountry(seller = {}) {
  return String(readDeepFirst(seller, [
    "country",
    "countryName",
    "country_name",
    "marketplace",
    "marketplaceName",
    "country_code",
    "countryCode",
    "region",
  ]) || "").trim();
}

function readDetailRows(order) {
  const rows = readArray(order, [
    "detail",
    "details",
    "items",
    "item_list",
    "itemList",
    "products",
    "product_list",
    "productList",
    "goods",
    "goods_list",
    "goodsList",
    "sku_list",
    "skuList",
  ]);
  return rows.length ? rows : [order];
}

function readStoreName(item, order, sellersBySid = new Map()) {
  const direct = String(readDeepFirst(item, [
    "store_name",
    "storeName",
    "seller_name",
    "sellerName",
    "shop_name",
    "shopName",
    "sid_name",
    "sidName",
  ]) || readDeepFirst(order, [
    "store_name",
    "storeName",
    "seller_name",
    "sellerName",
    "shop_name",
    "shopName",
  ]) || "").trim();
  if (direct) return direct;
  const seller = sellersBySid.get(readSid(item, order));
  return sellerName(seller);
}

function readCountryName(item, order, sellersBySid = new Map()) {
  const direct = String(readDeepFirst(item, [
    "country",
    "country_name",
    "countryName",
    "site_name",
    "siteName",
    "marketplace",
    "marketplaceName",
  ]) || readDeepFirst(order, [
    "country",
    "country_name",
    "countryName",
    "site_name",
    "siteName",
    "marketplace",
    "marketplaceName",
  ]) || "").trim();
  if (direct) return direct;
  const seller = sellersBySid.get(readSid(item, order));
  return sellerCountry(seller);
}

function readMsku(item, order) {
  return normalizeMsku(readDeepFirst(item, [
    "msku",
    "m_sku",
    "seller_sku",
    "sellerSku",
    "fnsku",
  ]) || readDeepFirst(order, [
    "msku",
    "m_sku",
    "seller_sku",
    "sellerSku",
  ]));
}

function extractMskuValuesFromValue(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item && typeof item === "object") {
        return extractMskuValuesFromValue(readDeepFirst(item, [
          "msku",
          "m_sku",
          "seller_sku",
          "sellerSku",
          "fnsku",
          "name",
          "value",
        ]));
      }
      return extractMskuValuesFromValue(item);
    });
  }
  if (typeof value === "object") {
    return extractMskuValuesFromValue(readDeepFirst(value, [
      "msku",
      "m_sku",
      "seller_sku",
      "sellerSku",
      "fnsku",
      "name",
      "value",
    ]));
  }
  const text = String(value || "").trim();
  if (!text) return [];
  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try {
      return extractMskuValuesFromValue(JSON.parse(text));
    } catch {
      return [text];
    }
  }
  return [text];
}

function extractMskuValues(item, order) {
  const direct = [
    item?.msku,
    item?.m_sku,
    item?.seller_sku,
    item?.sellerSku,
    order?.msku,
    order?.m_sku,
    order?.seller_sku,
    order?.sellerSku,
  ].flatMap(extractMskuValuesFromValue);
  const fallback = direct.length ? "" : readMsku(item, order);
  return [...new Set([...direct, fallback].map(normalizeMsku).filter((value) => value && value !== "[object Object]"))];
}

function summarizeFbaForMskus(mskuValues = [], fbaByMsku = new Map()) {
  const fba = {
    imageUrl: "",
    fbaAvailable: 0,
    fbaTransfer: 0,
    fbaInbound: 0,
    fbaTotalStock: 0,
    matchedStores: 0,
  };
  mskuValues.forEach((msku) => {
    const row = fbaByMsku.get(mskuKey(msku)) || {};
    if (!fba.imageUrl && row.imageUrl) fba.imageUrl = row.imageUrl;
    fba.fbaAvailable += Number(row.fbaAvailable || 0);
    fba.fbaTransfer += Number(row.fbaTransfer || 0);
    fba.fbaInbound += Number(row.fbaInbound || 0);
    fba.fbaTotalStock += Number(row.fbaTotalStock || 0);
    fba.matchedStores += Number(row.matchedStores || 0);
  });
  return fba;
}

function readSku(item, order, msku) {
  return String(readDeepFirst(item, [
    "sku",
    "local_sku",
    "localSku",
    "product_sku",
    "productSku",
    "goods_sku",
    "goodsSku",
    "merchant_sku",
    "merchantSku",
  ]) || readDeepFirst(order, [
    "sku",
    "local_sku",
    "localSku",
    "product_sku",
    "productSku",
  ]) || msku || "").trim();
}

function readProductName(item, order, sku) {
  return String(readDeepFirst(item, [
    "product_name",
    "productName",
    "goods_name",
    "goodsName",
    "sku_name",
    "skuName",
    "item_name",
    "itemName",
    "local_name",
    "localName",
    "name",
    "title",
    "品名",
    "产品名称",
    "商品名称",
  ]) || readDeepFirst(order, [
    "product_name",
    "productName",
    "goods_name",
    "goodsName",
    "sku_name",
    "skuName",
    "item_name",
    "itemName",
    "local_name",
    "localName",
    "name",
    "title",
    "品名",
    "产品名称",
    "商品名称",
  ]) || sku || "").trim();
}

function readPurchaseQuantity(item, order) {
  return toNumber(readDeepFirst(item, [
    "purchase_quantity",
    "purchaseQuantity",
    "purchase_qty",
    "purchaseQty",
    "quantity_real",
    "quantityReal",
    "quantity_total",
    "quantityTotal",
    "quantity_plan",
    "quantityPlan",
    "quantity",
    "qty",
    "num",
    "order_quantity",
    "orderQuantity",
  ]) || readDeepFirst(order, ["purchase_quantity", "purchaseQuantity", "purchase_qty", "purchaseQty"]));
}

function readPurchaseAmount(item, order) {
  return toNumber(readDeepFirst(item, [
    "purchase_amount",
    "purchaseAmount",
    "amount",
    "total_amount",
    "totalAmount",
    "money",
    "total_price",
    "totalPrice",
    "tax_amount",
    "taxAmount",
  ]) || readDeepFirst(order, ["purchase_amount", "purchaseAmount", "amount", "total_amount", "totalAmount"]));
}

function readUnitPrice(item, order) {
  const explicit = toNumber(readDeepFirst(item, [
    "price",
    "unit_price",
    "unitPrice",
    "purchase_price",
    "purchasePrice",
    "reference_price",
    "referencePrice",
  ]));
  if (explicit) return explicit;
  const amount = readPurchaseAmount(item, order);
  const quantity = readPurchaseQuantity(item, order);
  return quantity ? Number((amount / quantity).toFixed(4)) : 0;
}

function readShippedQuantity(item, order) {
  return toNumber(readDeepFirst(item, [
    "shipped_quantity",
    "shippedQuantity",
    "shipped_qty",
    "shippedQty",
    "sent_quantity",
    "sentQuantity",
    "sent_qty",
    "sentQty",
    "delivered_quantity",
    "deliveredQuantity",
    "delivery_quantity",
    "deliveryQuantity",
    "arrival_quantity",
    "arrivalQuantity",
    "received_quantity",
    "receivedQuantity",
    "inbound_quantity",
    "inboundQuantity",
    "stock_in_quantity",
    "stockInQuantity",
  ]) || readDeepFirst(order, [
    "shipped_quantity",
    "shippedQuantity",
    "sent_quantity",
    "sentQuantity",
    "delivered_quantity",
    "deliveredQuantity",
    "received_quantity",
    "receivedQuantity",
  ]));
}

function readEntryQuantity(item, order) {
  return toNumber(readDeepFirst(item, [
    "quantity_entry",
    "quantityEntry",
    "arrival_quantity",
    "arrivalQuantity",
    "received_quantity",
    "receivedQuantity",
  ]) || readDeepFirst(order, ["quantity_entry", "quantityEntry"]));
}

function readReceiveQuantity(item, order, purchaseQuantity, entryQuantity) {
  const explicit = readDeepFirst(item, [
    "quantity_receive",
    "quantityReceive",
    "waiting_quantity",
    "waitingQuantity",
    "pending_quantity",
    "pendingQuantity",
  ]) || readDeepFirst(order, ["quantity_receive", "quantityReceive"]);
  if (explicit !== "") return toNumber(explicit);
  return Math.max(0, Number(purchaseQuantity || 0) - Number(entryQuantity || 0));
}

function readExpectedArrivalTime(item, order) {
  return String(readDeepFirst(item, [
    "expect_arrive_time",
    "expectArriveTime",
    "expected_arrival_time",
    "expectedArrivalTime",
    "arrival_time",
    "arrivalTime",
  ]) || readDeepFirst(order, [
    "expect_arrive_time",
    "expectArriveTime",
    "expected_arrival_time",
    "expectedArrivalTime",
  ]) || "").trim();
}

function readProductRemark(item, order) {
  return String(readDeepFirst(item, [
    "remark",
    "note",
    "product_remark",
    "productRemark",
    "attribute",
    "model",
  ]) || readDeepFirst(order, ["remark", "note"]) || "").trim();
}

export function aggregateFbaInventoryByMsku(records = []) {
  const result = new Map();
  records.forEach((record) => {
    const msku = readMsku(record, record);
    const key = mskuKey(msku);
    if (!key) return;
    const current = result.get(key) || {
      msku,
      imageUrl: "",
      fbaAvailable: 0,
      fbaTransfer: 0,
      fbaInbound: 0,
      fbaTotalStock: 0,
      matchedStores: 0,
    };
    if (!current.imageUrl) current.imageUrl = imageUrlFrom(record);
    const available = toNumber(readDeepFirst(record, [
      "afn_fulfillable_quantity",
      "available_total",
      "amazon_quantity_available",
      "fba_available_quantity",
      "available_quantity",
      "fbaAvailable",
    ]));
    const transfer = toNumber(readDeepFirst(record, [
      "reserved_fc_transfers",
      "amazon_quantity_waiting",
      "transfer_quantity",
      "fba_transfer",
      "fbaTransfer",
    ]));
    const inbound = toNumber(readDeepFirst(record, [
      "amazon_quantity_shipping",
      "afn_inbound_shipped_quantity",
      "inbound_quantity",
      "inboundQuantity",
      "fba_inbound",
      "fbaInbound",
    ]));
    current.fbaAvailable += available;
    current.fbaTransfer += transfer;
    current.fbaInbound += inbound;
    current.fbaTotalStock += available + transfer + inbound;
    current.matchedStores += 1;
    result.set(key, current);
  });
  return result;
}

export function aggregateSalesForecastFbaByMsku(rows = []) {
  const result = new Map();
  rows.forEach((row) => {
    const msku = String(row.msku || "").trim();
    const key = mskuKey(msku);
    if (!key) return;
    const current = result.get(key) || {
      msku,
      imageUrl: "",
      fbaAvailable: 0,
      fbaTransfer: 0,
      fbaInbound: 0,
      fbaTotalStock: 0,
      matchedStores: 0,
    };
    if (!current.imageUrl && row.imageUrl) current.imageUrl = row.imageUrl;
    current.fbaAvailable += Number(row.fbaAvailable || 0);
    current.fbaTransfer += Number(row.fbaTransfer || 0);
    current.fbaInbound += Number(row.fbaInbound || 0);
    current.fbaTotalStock += Number(row.fbaAvailable || 0) + Number(row.fbaTransfer || 0) + Number(row.fbaInbound || 0);
    current.matchedStores += 1;
    result.set(key, current);
  });
  return result;
}

export function applyManualShippedQuantities(rows = [], manualRows = {}) {
  const legacyCounts = new Map();
  rows.forEach((row) => {
    const key = row.legacyManualKey || legacyFactoryInventoryManualKey(row);
    if (!key) return;
    legacyCounts.set(key, (legacyCounts.get(key) || 0) + 1);
  });
  return rows.map((row) => {
    const legacyKey = row.legacyManualKey || legacyFactoryInventoryManualKey(row);
    const manual = manualRows[row.manualKey] || (legacyCounts.get(legacyKey) === 1 ? manualRows[legacyKey] : null) || null;
    const erpShippedQuantity = Number(row.erpShippedQuantity ?? 0);
    const shippedQuantity = manual ? Math.max(0, Number(manual.shippedQuantity || 0)) : 0;
    return {
      ...row,
      erpShippedQuantity,
      shippedQuantity,
      shippedQuantitySource: manual ? "manual" : "blank",
      shippedQuantityUpdatedAt: manual?.updatedAt || "",
      shippedQuantityUpdatedBy: manual?.updatedBy || "",
      legacyManualKey: row.legacyManualKey || legacyKey,
      factoryRemainingQuantity: Math.max(0, Number(row.purchaseQuantity || 0) - shippedQuantity),
    };
  });
}

export function normalizePurchaseOrderRows(orders = [], fbaByMsku = new Map(), { startDate = DEFAULT_START_DATE, sellersBySid = new Map() } = {}) {
  const start = dateOnly(startDate) || DEFAULT_START_DATE;
  const rows = [];
  orders.forEach((order, orderIndex) => {
    if (!isValidPurchaseOrder(order)) return;
    const orderDateTime = readOrderCreatedAt(order);
    const orderDate = dateOnly(orderDateTime);
    if (start && orderDate && orderDate < start) return;
    const purchaseOrderNo = readPurchaseOrderNo(order);
    readDetailRows(order).forEach((item, itemIndex) => {
      const mskuValues = extractMskuValues(item, order);
      const msku = displayMskus(mskuValues);
      const sku = readSku(item, order, msku);
      const productName = readProductName(item, order, sku || msku);
      const purchaseQuantity = readPurchaseQuantity(item, order);
      const purchaseAmount = readPurchaseAmount(item, order);
      const erpShippedQuantity = readShippedQuantity(item, order);
      const entryQuantity = readEntryQuantity(item, order);
      const fba = summarizeFbaForMskus(mskuValues, fbaByMsku);
      const sid = readSid(item, order);
      const storeName = readStoreName(item, order, sellersBySid);
      const country = readCountryName(item, order, sellersBySid);
      const lineId = readLineId(item);
      const legacyManualKey = legacyFactoryInventoryManualKey({ purchaseOrderNo, sku, msku });
      const manualKey = factoryInventoryManualKey({ purchaseOrderNo, lineId, sid, storeName, country, sku, msku, itemIndex });
      rows.push({
        id: `${purchaseOrderNo || orderIndex}-${sku || msku || itemIndex}-${itemIndex}`,
        manualKey,
        legacyManualKey,
        purchaseOrderNo,
        factoryName: readFactoryName(order, item),
        warehouseName: readWarehouseName(order, item),
        purchaserName: readPurchaserName(order),
        productName,
        sku,
        msku,
        sid,
        storeName,
        country,
        unitPrice: readUnitPrice(item, order),
        imageUrl: imageUrlFrom(item) || imageUrlFrom(order) || fba.imageUrl || "",
        orderTime: orderDateTime,
        orderDate,
        expectedArrivalTime: readExpectedArrivalTime(item, order),
        productRemark: readProductRemark(item, order),
        purchaseQuantity,
        purchaseAmount,
        orderTotalAmount: toNumber(readDeepFirst(order, ["total_price", "totalPrice", "amount_total", "amountTotal", "payment"])),
        orderQuantity: toNumber(readDeepFirst(order, ["quantity_total", "quantityTotal", "quantity_real", "quantityReal"])),
        entryQuantity,
        receiveQuantity: readReceiveQuantity(item, order, purchaseQuantity, entryQuantity),
        erpShippedQuantity,
        shippedQuantity: 0,
        shippedQuantitySource: "blank",
        shippedQuantityUpdatedAt: "",
        shippedQuantityUpdatedBy: "",
        factoryRemainingQuantity: purchaseQuantity,
        fbaAvailable: Number(fba.fbaAvailable || 0),
        fbaTransfer: Number(fba.fbaTransfer || 0),
        fbaInbound: Number(fba.fbaInbound || 0),
        fbaTotalStock: Number(fba.fbaTotalStock || 0),
        fbaMatchedStores: Number(fba.matchedStores || 0),
      });
    });
  });
  return rows.sort((a, b) => String(b.orderTime || "").localeCompare(String(a.orderTime || ""), "zh-CN"));
}

async function readShippedQuantityStore() {
  const parsed = await readJsonFileWithRecovery(FACTORY_INVENTORY_SHIPPED_FILE, { fallback: {} });
  const rows = parsed?.rows && typeof parsed.rows === "object" ? parsed.rows : {};
  return {
    updatedAt: parsed?.updatedAt || "",
    rows,
  };
}

async function writeShippedQuantityStore(store) {
  await mkdir(path.dirname(FACTORY_INVENTORY_SHIPPED_FILE), { recursive: true });
  const payload = {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    rows: store.rows || {},
  };
  const tempFile = `${FACTORY_INVENTORY_SHIPPED_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, FACTORY_INVENTORY_SHIPPED_FILE);
  return payload;
}

export async function saveFactoryInventoryShippedQuantity({ manualKey = "", shippedQuantity = 0, updatedBy = "" } = {}) {
  const key = String(manualKey || "").trim();
  if (!key) throw new Error("缺少工厂库存行标识");
  if (!isFactoryInventoryRowManualKey(key)) {
    throw new Error("页面数据已更新，请刷新工厂库存页面后再保存已发数量。");
  }
  const quantity = Math.max(0, toNumber(shippedQuantity));
  const run = shippedQuantityWriteQueue.then(async () => {
    const store = await readShippedQuantityStore();
    store.rows[key] = {
      shippedQuantity: quantity,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      updatedBy: String(updatedBy || "").trim(),
    };
    const saved = await writeShippedQuantityStore(store);
    return { ok: true, manualKey: key, row: saved.rows[key], updatedAt: saved.updatedAt };
  });
  shippedQuantityWriteQueue = run.catch(() => {});
  return run;
}

function summarizeRows(rows) {
  const mskuSet = new Set(rows.map((row) => mskuKey(row.msku)).filter(Boolean));
  const factorySet = new Set(rows.map((row) => row.factoryName).filter(Boolean));
  return {
    orderLineCount: rows.length,
    factoryCount: factorySet.size,
    mskuCount: mskuSet.size,
    purchaseQuantity: rows.reduce((total, row) => total + Number(row.purchaseQuantity || 0), 0),
    purchaseAmount: Number(rows.reduce((total, row) => total + Number(row.purchaseAmount || 0), 0).toFixed(2)),
    shippedQuantity: rows.reduce((total, row) => total + Number(row.shippedQuantity || 0), 0),
    factoryRemainingQuantity: rows.reduce((total, row) => total + Number(row.factoryRemainingQuantity || 0), 0),
    fbaAvailable: rows.reduce((total, row) => total + Number(row.fbaAvailable || 0), 0),
    fbaTransfer: rows.reduce((total, row) => total + Number(row.fbaTransfer || 0), 0),
    fbaInbound: rows.reduce((total, row) => total + Number(row.fbaInbound || 0), 0),
    fbaTotalStock: rows.reduce((total, row) => total + Number(row.fbaTotalStock || 0), 0),
  };
}

function filterRows(rows, { keyword = "", factory = "", onlyRemaining = false } = {}) {
  const kw = String(keyword || "").trim().toLowerCase();
  const factoryText = String(factory || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (onlyRemaining && Number(row.factoryRemainingQuantity || 0) <= 0) return false;
    if (factoryText && !String(row.factoryName || "").toLowerCase().includes(factoryText)) return false;
    if (!kw) return true;
    return [
      row.purchaseOrderNo,
      row.factoryName,
      row.productName,
      row.sku,
      row.msku,
    ].some((value) => String(value || "").toLowerCase().includes(kw));
  });
}

function cacheKey({ startDate, endDate }) {
  return JSON.stringify({
    source: "factory-inventory",
    version: FACTORY_INVENTORY_CACHE_VERSION,
    startDate: dateOnly(startDate) || DEFAULT_START_DATE,
    endDate: dateOnly(endDate) || "",
  });
}

async function fetchAllPurchaseOrders(adapter, { startDate, endDate } = {}) {
  const rows = [];
  const actualEndDate = dateOnly(endDate) || todayDate();
  for (let offset = 0; offset < 20000; offset += PURCHASE_ORDER_PAGE_SIZE) {
    const payload = await adapter.fetchPurchaseOrders({
      offset,
      length: PURCHASE_ORDER_PAGE_SIZE,
      start_date: startDate,
      end_date: actualEndDate,
      search_field_time: "create_time",
    });
    const records = adapter.normalizeRecordList(payload);
    rows.push(...records);
    const total = Number(payload?.data?.total || payload?.total || payload?.data?.count || 0);
    if (!records.length || records.length < PURCHASE_ORDER_PAGE_SIZE || (total && rows.length >= total)) break;
  }
  return rows;
}

async function buildDashboard(adapter, params) {
  const startDate = dateOnly(params.startDate) || DEFAULT_START_DATE;
  const endDate = dateOnly(params.endDate);
  const [purchaseOrders, fbaResult, sellersResult] = await Promise.all([
    fetchAllPurchaseOrders(adapter, { startDate, endDate }),
    getCurrentFbaInventoryByMsku(),
    getSharedSellers({ adapter }),
  ]);
  const fbaByMsku = fbaResult.map || new Map();
  const sellersBySid = new Map((sellersResult.sellers || []).map((seller) => [Number(seller.sid || seller.seller_id || seller.sellerId), seller]).filter(([sid]) => sid));
  const invalidPurchaseOrderCount = purchaseOrders.filter(isInvalidPurchaseOrder).length;
  const normalizedRows = normalizePurchaseOrderRows(purchaseOrders, fbaByMsku, { startDate, sellersBySid });
  const productCatalogResult = await getSharedProductCatalogMap(adapter, normalizedRows);
  const allRows = applySharedProductCatalogToRows(normalizedRows, productCatalogResult.map);
  const imageCount = allRows.filter((row) => row.imageUrl).length;
  return {
    rows: allRows,
    summary: summarizeRows(allRows),
    options: {
      factories: [...new Set(allRows.map((row) => row.factoryName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    },
    meta: {
      source: "领星 ERP purchaseOrder 采购单",
      startDate,
      endDate,
      syncStatus: `采购单 ${purchaseOrders.length} 条，过滤作废/无效 ${invalidPurchaseOrderCount} 条；店铺 ${sellersBySid.size} 个；图片 ${imageCount}/${allRows.length}；${fbaResult.status || `复用销售预估 FBA 库存 ${fbaByMsku.size} 个 MSKU`}；${productCatalogResult.status || ""}`,
      cacheTtlMinutes: Math.round(FACTORY_INVENTORY_TTL_MS / 60000),
      fbaSource: fbaResult.source || "sales-forecast-cache",
      fbaUpdatedAt: fbaResult.updatedAt || "",
      productCatalogUpdatedAt: productCatalogResult.updatedAt || "",
      productCatalogCacheHit: Boolean(productCatalogResult.cacheHit),
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    },
  };
}

async function buildAndCacheDashboardOnce(key, adapter, { startDate, endDate }) {
  const existing = factoryInventoryBuildPromises.get(key);
  if (existing) {
    console.info("[factory-inventory] join in-flight refresh", { startDate, endDate });
    return existing;
  }

  const startedAt = Date.now();
  const run = (async () => {
    console.info("[factory-inventory] refresh started", { startDate, endDate });
    const data = await buildDashboard(adapter, { startDate, endDate });
    await saveFactoryInventoryCache(key, data);
    console.info("[factory-inventory] refresh finished", {
      startDate,
      endDate,
      rows: data.rows?.length || 0,
      durationMs: Date.now() - startedAt,
    });
    return data;
  })();

  factoryInventoryBuildPromises.set(key, run);
  try {
    return await run;
  } finally {
    if (factoryInventoryBuildPromises.get(key) === run) {
      factoryInventoryBuildPromises.delete(key);
    }
  }
}

export async function getFactoryInventoryDashboard(params = {}) {
  const startDate = dateOnly(params.startDate) || DEFAULT_START_DATE;
  const endDate = dateOnly(params.endDate);
  const key = cacheKey({ startDate, endDate });
  let data = null;
  if (!params.forceRefresh) {
    const cached = await readFactoryInventoryCache(key, FACTORY_INVENTORY_TTL_MS);
    data = cached?.data || null;
  }

  if (!data) {
    const adapter = params.adapter || getLingxingAdapter();
    try {
      data = await buildAndCacheDashboardOnce(key, adapter, { startDate, endDate });
    } catch (error) {
      console.error("[factory-inventory] refresh failed", {
        startDate,
        endDate,
        cacheKey: key,
        error: error.message,
      });
      throw error;
    }
  }

  const shippedStore = await readShippedQuantityStore();
  const rowsWithManualShipped = applyManualShippedQuantities(data.rows || [], shippedStore.rows || {});
  const rows = filterRows(rowsWithManualShipped, params);
  return {
    ...data,
    rows,
    summary: summarizeRows(rows),
    meta: {
      ...(data.meta || {}),
      filteredCount: rows.length,
      startDate,
      endDate,
      shippedQuantityUpdatedAt: shippedStore.updatedAt || "",
    },
  };
}

export async function warmFactoryInventoryCache(params = {}) {
  const startDate = dateOnly(params.startDate) || DEFAULT_START_DATE;
  const endDate = dateOnly(params.endDate) || todayDate();
  const startedAt = Date.now();
  const data = await getFactoryInventoryDashboard({
    ...params,
    startDate,
    endDate,
    forceRefresh: true,
  });
  return {
    ok: true,
    startDate,
    endDate,
    rows: data.rows?.length || 0,
    updatedAt: data.meta?.updatedAt || "",
    durationMs: Date.now() - startedAt,
  };
}

export const factoryInventoryTestUtils = {
  aggregateFbaInventoryByMsku,
  aggregateSalesForecastFbaByMsku,
  applyManualShippedQuantities,
  isFactoryInventoryRowManualKey,
  normalizePurchaseOrderRows,
};

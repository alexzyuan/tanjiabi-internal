import { getConfig } from "../config/index.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { supplierTaxRates } from "../data/supplierTaxRates.js";
import { getSharedProductCatalogMap, getSharedSellers } from "./sharedDataService.js";
import {
  readSupplierBoardCache,
  saveSupplierBoardCache,
} from "../utils/cacheStore.js";

const SALES_PAGE_SIZE = 1000;
const SALES_STAT_SID_BATCH_SIZE = 20;
const SALES_STAT_MAX_RANGE_DAYS = 90;
const SALES_STAT_REQUEST_DELAY_MS = 1300;
const SALES_STAT_RETRY_DELAYS_MS = [1800, 3500, 6500, 10000];
const SUPPLIER_BOARD_ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const SUPPLIER_BOARD_CACHE_VERSION = "supplier-board-v6-ordinary-purchase-cost";
let salesStatRequestQueue = Promise.resolve();
let lastSalesStatRequestAt = 0;

const dimensionMap = {
  month: { label: "按月", apiValue: "2" },
  year: { label: "按年", apiValue: "1" },
};

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorText(error) {
  return [
    error?.message,
    error?.details?.message,
    error?.details?.msg,
    error?.details?.error,
    JSON.stringify(error?.details || {}),
  ].filter(Boolean).join(" ").toLowerCase();
}

function isSalesStatRateLimitError(error) {
  const text = errorText(error);
  return text.includes("too frequently")
    || text.includes("request later")
    || text.includes("请求频繁")
    || text.includes("频率")
    || text.includes("限流");
}

async function runQueuedSalesStatRequest(call) {
  const run = async () => {
    const elapsed = Date.now() - lastSalesStatRequestAt;
    const waitMs = Math.max(0, SALES_STAT_REQUEST_DELAY_MS - elapsed);
    if (waitMs > 0) await sleep(waitMs);
    lastSalesStatRequestAt = Date.now();
    return call();
  };
  const task = salesStatRequestQueue.then(run, run);
  salesStatRequestQueue = task.catch(() => {});
  return task;
}

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
  if (found) return found;
  return "";
}

function readArrayText(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && String(item).trim() !== "").map(String).join(" / ");
  if (typeof value === "string") {
    const text = value.trim();
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
      try {
        const parsed = JSON.parse(text);
        return readArrayText(parsed);
      } catch {
        return text;
      }
    }
    return text;
  }
  return value === undefined || value === null ? "" : String(value);
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

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueText(values) {
  const seen = new Set();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）【】\\[\\]·.,，。-]/g, "")
    .replace(/有限责任公司|股份有限公司|有限公司|科技|玩具|实业|贸易|商贸|工厂|厂/g, "");
}

function includesKeyword(value, keyword) {
  if (!keyword) return true;
  return String(value || "").toLowerCase().includes(String(keyword).trim().toLowerCase());
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth(period, offset) {
  const date = new Date(Date.UTC(period.year, period.month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function readPeriod(value, dimension, boundary = "start") {
  const fallback = currentYearMonth();
  const text = String(value || "").trim().replace(/\//g, "-");
  const match = text.match(/^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?$/);
  const year = match ? Number(match[1]) : fallback.year;
  const month = dimension === "year" ? (boundary === "end" ? 12 : 1) : Number(match?.[2] || fallback.month);
  return {
    year: Number.isFinite(year) ? year : fallback.year,
    month: Math.min(12, Math.max(1, Number.isFinite(month) ? month : fallback.month)),
  };
}

function endOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatApiDate(period, boundary = "start") {
  const day = boundary === "end" ? endOfMonth(period.year, period.month) : 1;
  return `${period.year}-${pad2(period.month)}-${pad2(day)}`;
}

function parseApiDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateObject(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function splitDateRange(startDate, endDate, maxDays = SALES_STAT_MAX_RANGE_DAYS) {
  const start = parseApiDate(startDate);
  const end = parseApiDate(endDate);
  if (!start || !end || start > end) return [{ startDate, endDate }];
  const chunks = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(addDays(cursor, maxDays - 1).getTime(), end.getTime()));
    chunks.push({ startDate: formatDateObject(cursor), endDate: formatDateObject(chunkEnd) });
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

function formatPeriod(period, dimension) {
  return dimension === "year" ? String(period.year) : `${period.year}-${pad2(period.month)}`;
}

function normalizeDateFilters(filters = {}) {
  const dimension = dimensionMap[filters.dimension] ? filters.dimension : "month";
  const fallback = currentYearMonth();
  const defaultStart = dimension === "year" ? fallback : shiftMonth(fallback, -2);
  const defaultEnd = dimension === "year" ? fallback : fallback;
  let startPeriod = filters.startDate ? readPeriod(filters.startDate, dimension, "start") : defaultStart;
  let endPeriod = filters.endDate ? readPeriod(filters.endDate, dimension, "end") : defaultEnd;
  if (formatApiDate(startPeriod, "start") > formatApiDate(endPeriod, "end")) {
    [startPeriod, endPeriod] = [endPeriod, startPeriod];
  }
  return {
    dimension,
    startDate: formatApiDate(startPeriod, "start"),
    endDate: formatApiDate(endPeriod, "end"),
    startPeriod: formatPeriod(startPeriod, dimension),
    endPeriod: formatPeriod(endPeriod, dimension),
  };
}

function sellerName(seller) {
  return readFirst(seller, ["displayName", "name", "seller_name", "shop_name", "store_name", "account_name"]);
}

function sellerCountry(seller) {
  return readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName", "country_code", "countryCode"]);
}

function isActiveSeller(seller) {
  const status = seller?.status;
  if (status === undefined || status === null || status === "") return true;
  if (Number(status) === 1) return true;
  return ["active", "enabled", "正常", "启用"].includes(String(status).trim().toLowerCase());
}

function normalizeSalesRow(record, sellersBySid) {
  const sid = toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
  const seller = sellersBySid.get(sid) || {};
  const storeName = sellerName(seller) || readArrayText(readFirst(record, ["store_name", "storeName", "seller_name", "sellerName", "shop_name", "shopName"]));
  const country = sellerCountry(seller) || readArrayText(readFirst(record, ["site_name", "siteName", "country", "country_name", "countryName", "marketplace", "marketplaceName"]));
  const msku = readArrayText(readFirst(record, ["msku", "m_sku", "seller_sku", "sellerSku", "sellerSkuStr", "fnsku"])).trim();
  const sku = readArrayText(readFirst(record, ["sku", "local_sku", "localSku", "product_sku", "sku_identifier", "skuIdentifier"])).trim();
  const salesAmount = toNumber(readFirst(record, [
    "sales_amount",
    "salesAmount",
    "total_sales_amount",
    "totalSalesAmount",
    "amount",
    "product_sales",
    "productSales",
    "salesTotal",
    "sales_total",
    "小计",
  ]));
  const quantity = toNumber(readFirst(record, ["quantity", "qty", "volume", "volumeTotal", "sales_quantity", "salesQuantity", "total_sales_quantity", "totalSalesQuantity"]));

  return {
    imageUrl: readFirst(record, ["pic_url", "picUrl", "image", "image_url", "imageUrl", "small_image_url", "smallImageUrl"]),
    sid,
    storeName,
    country,
    storeCountry: [storeName, country].filter(Boolean).join(" / "),
    msku,
    salePrice: toNumber(readFirst(record, ["sale_price", "salePrice", "price", "listing_price", "listingPrice"])),
    productName: readArrayText(readFirst(record, ["product_name", "productName", "skuAndProductName", "local_name", "localName", "item_name", "itemName", "title", "sku_name", "skuName"])),
    sku,
    model: readArrayText(readFirst(record, ["attribute", "model", "model_name", "modelName", "型号", "style", "specification", "specificationName"])),
    quantity,
    salesAmount,
    subtotal: salesAmount || quantity || toNumber(readFirst(record, ["volumeTotal"])),
    raw: record,
  };
}

function productKey(value) {
  return String(value || "").trim().toLowerCase();
}

function listingMskuKey(sid, msku) {
  const key = productKey(msku);
  return key ? `sid:${Number(sid) || 0}:msku:${key}` : "";
}

async function fetchProductMap(adapter, rows, { getSharedCatalog = getSharedProductCatalogMap } = {}) {
  const sharedCatalog = await getSharedCatalog(adapter, rows, { feature: "supplier-board" });
  if (!sharedCatalog?.map) throw new Error("共享商品目录未返回有效索引。");
  return sharedCatalog.map;
}

function findTaxRate(supplier) {
  const normalizedSupplier = normalizeText(supplier);
  if (!normalizedSupplier) return { factoryName: "", specialInvoiceTaxRate: null, ordinaryInvoiceTaxRate: null };
  const exact = supplierTaxRates.find((item) => {
    const factory = normalizeText(item.factoryName);
    return factory && (normalizedSupplier.includes(factory) || factory.includes(normalizedSupplier));
  });
  return exact || { factoryName: "", specialInvoiceTaxRate: null, ordinaryInvoiceTaxRate: null };
}

function mergeProductAndTax(rows, productMap) {
  return rows.map((row) => {
    const product = productMap.get(productKey(row.sku))
      || productMap.get(listingMskuKey(row.sid, row.msku))
      || productMap.get(productKey(row.msku))
      || {};
    const supplier = product.supplier || "";
    const tax = findTaxRate(supplier);
    const purchaseCostSubtotal = Number((Number(row.quantity || 0) * Number(product.purchasePrice || 0)).toFixed(2));
    const ordinaryInvoicePurchaseCost = tax.ordinaryInvoiceTaxRate === null || tax.ordinaryInvoiceTaxRate === undefined
      ? null
      : purchaseCostSubtotal;
    const ordinaryInvoiceCost = tax.ordinaryInvoiceTaxRate === null || tax.ordinaryInvoiceTaxRate === undefined
      ? null
      : Number((purchaseCostSubtotal * Number(tax.ordinaryInvoiceTaxRate || 0)).toFixed(2));
    return {
      ...row,
      productName: row.productName || product.productName || "",
      sku: row.sku || product.sku || "",
      model: row.model || product.model || "",
      supplier,
      purchasePrice: product.purchasePrice || 0,
      purchaseCostSubtotal,
      ordinaryInvoicePurchaseCost,
      taxFactoryName: tax.factoryName,
      ordinaryInvoiceTaxRate: tax.ordinaryInvoiceTaxRate,
      ordinaryInvoiceCost,
      specialInvoiceTaxRate: tax.specialInvoiceTaxRate,
    };
  });
}

function buildRequestParams(filters, sids, resultType = "1", page = 1, length = SALES_PAGE_SIZE) {
  const dimension = dimensionMap[filters.dimension] || dimensionMap.month;
  return {
    page,
    length,
    start_date: filters.startDate,
    end_date: filters.endDate,
    result_type: resultType,
    date_unit: dimension.apiValue,
    data_type: "3",
    sids: sids.map(String),
  };
}

function salesStatEndpointCandidates(configuredEndpoint) {
  return uniqueText([
    configuredEndpoint,
    "/basicOpen/platformStatisticsV2/saleStat/pageList",
  ]);
}

async function fetchSalesStatPage(adapter, params, endpoints) {
  const failures = [];
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= SALES_STAT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const payload = await runQueuedSalesStatRequest(() => adapter.fetchSalesStat(params, endpoint));
        return { payload, endpoint };
      } catch (error) {
        const message = error.details?.message || error.details?.msg || error.message;
        if (isSalesStatRateLimitError(error) && attempt < SALES_STAT_RETRY_DELAYS_MS.length) {
          await sleep(SALES_STAT_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        failures.push(`${endpoint}: ${message}`);
        break;
      }
    }
  }
  const error = new Error(`salesStat 接口路径全部失败：${failures.join("；")}`);
  error.details = { failures };
  throw error;
}

function salesRowKey(row) {
  return [
    row.sid || "",
    row.sku || "",
    row.msku || "",
    row.productName || "",
  ].join("|").toLowerCase();
}

function mergeQuantityRows(quantityRows) {
  const rowsByKey = new Map();
  quantityRows.forEach((row) => {
    const key = salesRowKey(row);
    const existing = rowsByKey.get(key) || {};
    const quantity = Number(existing.quantity || 0) + Number(row.quantity || row.subtotal || 0);
    rowsByKey.set(key, {
      ...existing,
      ...row,
      quantity,
      salesAmount: 0,
      subtotal: quantity,
    });
  });
  return [...rowsByKey.values()];
}

async function fetchMetricRows(adapter, filters, sellersBySid, sids, resultType, endpointRef) {
  const rows = [];
  let resolvedEndpoint = endpointRef.value || "";
  const endpoints = salesStatEndpointCandidates(adapter.config.supplierSalesStatEndpoint);
  const dateChunks = splitDateRange(filters.startDate, filters.endDate);
  for (const dateChunk of dateChunks) {
    const chunkFilters = { ...filters, startDate: dateChunk.startDate, endDate: dateChunk.endDate };
    for (const sidBatch of chunkArray(sids, SALES_STAT_SID_BATCH_SIZE)) {
      let batchRowCount = 0;
      for (let page = 1; page <= 20; page += 1) {
        const pageResult = await fetchSalesStatPage(
          adapter,
          buildRequestParams(chunkFilters, sidBatch, resultType, page, SALES_PAGE_SIZE),
          resolvedEndpoint ? [resolvedEndpoint] : endpoints,
        );
        const payload = pageResult.payload;
        resolvedEndpoint = pageResult.endpoint;
        endpointRef.value = resolvedEndpoint;
        const records = normalizeRecordList(payload);
        batchRowCount += records.length;
        rows.push(...records.map((record) => normalizeSalesRow(record, sellersBySid)));
        const total = totalCountOf(payload, records.length);
        if (!records.length || batchRowCount >= total || records.length < SALES_PAGE_SIZE) break;
      }
    }
  }
  return rows;
}

async function fetchAllSalesRows(adapter, filters, sellersBySid, sids) {
  const sidList = Array.isArray(sids) ? sids.map(Number).filter(Boolean) : [];
  if (!sidList.length) throw new Error("salesStat 需要 sid，但没有取到可用店铺。");
  const quantityEndpointRef = { value: "" };
  const dateChunks = splitDateRange(filters.startDate, filters.endDate);
  const quantityRows = await fetchMetricRows(adapter, filters, sellersBySid, sidList, "1", quantityEndpointRef);
  return { rows: mergeQuantityRows(quantityRows), endpoint: quantityEndpointRef.value, dateChunkCount: dateChunks.length };
}

export async function getSalesStatMonthlyQuantityRows({ adapter, sellersBySid = new Map(), sids = [], year, months = [] } = {}) {
  const sidList = Array.isArray(sids) ? uniqueText(sids).map(Number).filter(Boolean) : [];
  const targetYear = Number(year);
  const targetMonths = uniqueText(months)
    .map(Number)
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);
  if (!adapter) throw new Error("缺少 salesStat 适配器");
  if (!sidList.length) return { rowsByMonth: new Map(), endpoint: "", rowCount: 0 };
  if (!Number.isInteger(targetYear) || !targetMonths.length) return { rowsByMonth: new Map(), endpoint: "", rowCount: 0 };

  const endpointRef = { value: "" };
  const rowsByMonth = new Map();
  let rowCount = 0;
  for (const month of targetMonths) {
    const filters = {
      dimension: "month",
      startDate: `${targetYear}-${pad2(month)}-01`,
      endDate: `${targetYear}-${pad2(month)}-${pad2(endOfMonth(targetYear, month))}`,
    };
    const rows = mergeQuantityRows(await fetchMetricRows(adapter, filters, sellersBySid, sidList, "1", endpointRef));
    rowsByMonth.set(month, rows);
    rowCount += rows.length;
  }
  return { rowsByMonth, endpoint: endpointRef.value, rowCount };
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.keyword && !includesKeyword(`${row.msku} ${row.sku} ${row.productName} ${row.model}`, filters.keyword)) return false;
    if (filters.supplier && !includesKeyword(row.supplier, filters.supplier)) return false;
    if (filters.storeName && !includesKeyword(row.storeName, filters.storeName)) return false;
    if (filters.country && !includesKeyword(row.country, filters.country)) return false;
    return true;
  });
}

function filterSellers(sellers, filters) {
  return sellers.filter((seller) => {
    if (!isActiveSeller(seller)) return false;
    if (filters.storeName && !includesKeyword(sellerName(seller), filters.storeName)) return false;
    if (filters.country && !includesKeyword(sellerCountry(seller), filters.country)) return false;
    return true;
  });
}

function summarize(rows) {
  const supplierSet = new Set(rows.map((row) => row.supplier).filter(Boolean));
  const skuSet = new Set(rows.map((row) => row.msku || row.sku).filter(Boolean));
  return {
    quantity: Number(rows.reduce((total, row) => total + Number(row.quantity || 0), 0).toFixed(2)),
    purchaseCostSubtotal: Number(rows.reduce((total, row) => total + Number(row.purchaseCostSubtotal || 0), 0).toFixed(2)),
    ordinaryInvoicePurchaseCost: Number(rows.reduce((total, row) => total + Number(row.ordinaryInvoicePurchaseCost || 0), 0).toFixed(2)),
    ordinaryInvoiceCost: Number(rows.reduce((total, row) => total + Number(row.ordinaryInvoiceCost || 0), 0).toFixed(2)),
    supplierCount: supplierSet.size,
    skuCount: skuSet.size,
  };
}

function stableSupplierBoardCacheKey(filters) {
  return JSON.stringify({
    scope: SUPPLIER_BOARD_CACHE_VERSION,
    dimension: filters.dimension,
    startDate: filters.startDate,
    endDate: filters.endDate,
    storeName: filters.storeName || "",
    country: filters.country || "",
  });
}

function isHistoricalSupplierBoardRange(filters) {
  const current = currentYearMonth();
  const currentMonthStart = `${current.year}-${pad2(current.month)}-01`;
  return String(filters.endDate || "") < currentMonthStart;
}

function supplierBoardCacheTtl(filters) {
  return isHistoricalSupplierBoardRange(filters) ? Infinity : SUPPLIER_BOARD_ACTIVE_TTL_MS;
}

function withCacheMeta(data, cached, statusPrefix = "已读取服务器缓存") {
  return {
    ...data,
    meta: {
      ...(data?.meta || {}),
      syncStatus: `${statusPrefix}${cached?.updatedAt ? ` ${cached.updatedAt}` : ""}`,
      cacheHit: true,
      cacheUpdatedAt: cached?.updatedAt || "",
    },
  };
}

function emptyPayload(filters, message) {
  return {
    meta: {
      source: "领星 ERP · salesStat 销量统计",
      syncStatus: message,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      request: filters,
    },
    summary: { quantity: 0, purchaseCostSubtotal: 0, ordinaryInvoicePurchaseCost: 0, ordinaryInvoiceCost: 0, supplierCount: 0, skuCount: 0 },
    rows: [],
    suppliers: supplierTaxRates,
  };
}

export async function getSupplierBoardDashboard(filters = {}, {
  adapter: injectedAdapter = null,
  sellers: injectedSellers = null,
  getSellers = getSharedSellers,
  getSharedCatalog = getSharedProductCatalogMap,
  readDashboardCache = readSupplierBoardCache,
  saveDashboardCache = saveSupplierBoardCache,
} = {}) {
  const dateFilters = normalizeDateFilters(filters);
  const normalizedFilters = {
    ...dateFilters,
    keyword: String(filters.keyword || "").trim(),
    supplier: String(filters.supplier || "").trim(),
    storeName: String(filters.storeName || "").trim(),
    country: String(filters.country || "").trim(),
    forceRefresh: Boolean(filters.forceRefresh),
  };
  if (normalizedFilters.startDate > normalizedFilters.endDate) {
    [normalizedFilters.startDate, normalizedFilters.endDate] = [normalizedFilters.endDate, normalizedFilters.startDate];
  }

  if (getConfig().dataProvider !== "lingxing") {
    return emptyPayload(normalizedFilters, "当前不是 lingxing 数据源，供应商看板未显示模拟数据。");
  }

  const cacheKey = stableSupplierBoardCacheKey(normalizedFilters);
  const cached = await readDashboardCache(cacheKey, supplierBoardCacheTtl(normalizedFilters));
  if (cached?.data) return withCacheMeta(cached.data, cached);

  try {
    const adapter = injectedAdapter || getLingxingAdapter();
    const sellersResult = injectedSellers
      ? { sellers: injectedSellers }
      : await getSellers({ adapter });
    const sellers = filterCoreSellers(sellersResult.sellers || []);
    const sellersBySid = new Map(sellers.map((seller) => [Number(seller.sid || seller.seller_id || seller.sellerId), seller]));
    const selectedSellers = filterSellers(sellers, normalizedFilters);
    const selectedSids = selectedSellers
      .map((seller) => Number(seller.sid || seller.seller_id || seller.sellerId))
      .filter(Boolean);
    const salesResult = await fetchAllSalesRows(adapter, normalizedFilters, sellersBySid, selectedSids);
    const salesRows = salesResult.rows;
    const productMap = await fetchProductMap(adapter, salesRows, { getSharedCatalog });
    const rows = filterRows(mergeProductAndTax(salesRows, productMap), normalizedFilters);

    const data = {
      meta: {
        source: "领星 ERP · salesStat 销量统计 + 产品管理",
        syncStatus: `salesStat ${salesRows.length} 条；路径 ${salesResult.endpoint || "-"}；店铺 ${selectedSids.length} 个；日期拆分 ${salesResult.dateChunkCount || 1} 段；产品管理匹配 ${productMap.size} 个标识；税点表 ${supplierTaxRates.length} 条`,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        request: normalizedFilters,
        cacheHit: false,
      },
      summary: summarize(rows),
      rows,
      suppliers: supplierTaxRates,
    };
    await saveDashboardCache(cacheKey, data);
    return data;
  } catch (error) {
    console.error("[supplier-board] refresh failed", {
      filters: normalizedFilters,
      cacheKey,
      error: error.message,
    });
    const data = emptyPayload(normalizedFilters, `供应商看板读取失败：${error.message}`);
    data.error = error.message;
    data.details = error.details || null;
    throw Object.assign(new Error(data.meta.syncStatus), { payload: data });
  }
}

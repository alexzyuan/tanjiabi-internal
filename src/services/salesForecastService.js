import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getInventoryProvisionDashboard } from "./inventoryProvisionService.js";
import { getSalesStatMonthlyQuantityRows } from "./supplierBoardService.js";
import { getSharedSellers } from "./sharedDataService.js";
import { getSyncState } from "./syncService.js";
import { listFilterValues, matchesAnyFilter } from "../utils/filterUtils.js";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";

const COUNTRY_OPTIONS = ["美国", "加拿大", "澳洲"];
const MONTH_DAYS_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SALES_FORECAST_REFERENCE_YEAR = 2025;
const SALES_FORECAST_MANUAL_DAILY_FILE = path.join(process.cwd(), "data-cache", "sales-forecast-manual-daily.json");
const SALES_FORECAST_MANUAL_DAILY_BACKUP_DIR = path.join(process.cwd(), "data-cache", "sales-forecast-manual-daily-backups");
const SALES_FORECAST_HIDDEN_ROWS_FILE = path.join(process.cwd(), "data-cache", "sales-forecast-hidden-rows.json");
const SALES_FORECAST_DASHBOARD_CACHE_FILE = path.join(process.cwd(), "data-cache", "sales-forecast-dashboard-cache.json");
const SALES_FORECAST_LISTING_CACHE_FILE = path.join(process.cwd(), "data-cache", "sales-forecast-listing-products.json");
const SALES_FORECAST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SALES_FORECAST_CACHE_VERSION = "sales-forecast-v2-strict-sid-fba";
const SALES_FORECAST_LISTING_CONCURRENCY = 4;
const SALES_FORECAST_ADVICE_ENDPOINT = "/erp/sc/routing/restocking/analysis/getSummaryList";
const DEFAULT_PRODUCT_ORDER = [
  "JM-GT-GR",
  "JM-GT-PINK",
  "JM-DGC-RED",
  "JM-DGC-BLUE",
  "JMUS-DCG-GREEN",
  "JM-Sharkbathbomb",
  "JM-009Bubble-Yellow",
  "JM-009Bubble-Pink",
  "JM-009Bubble",
  "JM-UFO-BLUE",
  "JM-UFO-PURPLE",
  "JM-Rocketbubble-blue",
  "JM-Rocketbubble-red",
  "JM-SKboat-grey",
  "JM-SKboat-blue",
  "JM-BURGER SODA BUBBLE",
  "JM-9006Truck",
  "JM-Cybertruck-8888",
  "JM-PQC-RD",
  "JM-NEWGT",
  "JM-Shark Dino Bubble",
  "JM-Rabbit Pack Bubble",
  "JM-Flying Water Toy",
  "MD-LEGBLUE",
  "MD-LEGPINK",
  "MD-YJ-Pink",
  "MD-YJ-Green",
  "MD-DINOBATH",
  "MD-RABBIT GUN",
  "MD-2Pack Bubble Guns",
];
const DEFAULT_PRODUCT_ORDER_MAP = new Map(DEFAULT_PRODUCT_ORDER.map((msku, index) => [msku.toLowerCase(), index]));
let manualDailyWriteQueue = Promise.resolve();
let lastManualDailyBackupAt = 0;
let salesForecastDashboardRefreshPromise = null;
let salesForecastListingRefreshPromise = null;

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function readJsonFile(file, fallback) {
  return readJson(file, fallback);
}

async function writeJsonFile(file, payload) {
  return writeJsonAtomic(file, payload);
}

function normalizeManualDailyValues(values) {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length: 12 }, (_, index) => toNumber(source[index]));
}

function canonicalManualDailyKey(rowKey) {
  const rawKey = String(rowKey || "").trim();
  if (!rawKey) return "";
  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey);
  } catch {
    decoded = rawKey;
  }
  const parts = decoded.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return encodeURIComponent([parts[0], parts.at(-1)].join("|"));
  }
  return rawKey;
}

function mergeManualDailyValues(existingValues, incomingValues, { overwrite = false } = {}) {
  const existing = normalizeManualDailyValues(existingValues);
  const incoming = normalizeManualDailyValues(incomingValues);
  let changedCount = 0;
  let skippedCount = 0;
  const values = existing.map((value, index) => {
    const nextValue = incoming[index];
    if (overwrite) {
      if (value !== nextValue) changedCount += 1;
      return nextValue;
    }
    if (value || !nextValue) {
      if (value && nextValue && value !== nextValue) skippedCount += 1;
      return value;
    }
    changedCount += 1;
    return nextValue;
  });
  return { values, changedCount, skippedCount };
}

async function readSalesForecastManualDailyStore() {
  const parsed = await readJsonFile(SALES_FORECAST_MANUAL_DAILY_FILE, {});
  const rows = parsed?.rows && typeof parsed.rows === "object" ? parsed.rows : {};
  const normalizedRows = {};
  Object.entries(rows)
    .filter(([key]) => key)
    .forEach(([key, values]) => {
      const canonicalKey = canonicalManualDailyKey(key);
      normalizedRows[canonicalKey] = mergeManualDailyValues(normalizedRows[canonicalKey], values).values;
    });
  return {
    updatedAt: parsed?.updatedAt || "",
    rows: normalizedRows,
  };
}

async function backupSalesForecastManualDailyStore() {
  const now = Date.now();
  if (now - lastManualDailyBackupAt < 5 * 60 * 1000) return;
  try {
    await mkdir(SALES_FORECAST_MANUAL_DAILY_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(SALES_FORECAST_MANUAL_DAILY_FILE, path.join(SALES_FORECAST_MANUAL_DAILY_BACKUP_DIR, `${stamp}.json`));
    lastManualDailyBackupAt = now;

    const backups = (await readdir(SALES_FORECAST_MANUAL_DAILY_BACKUP_DIR))
      .filter((file) => file.endsWith(".json"))
      .sort();
    await Promise.all(backups.slice(0, Math.max(0, backups.length - 50)).map((file) => unlink(path.join(SALES_FORECAST_MANUAL_DAILY_BACKUP_DIR, file)).catch(() => {})));
  } catch {
    // Missing first-run files or backup failures should not block user input saves.
  }
}

async function writeSalesForecastManualDailyStore(store) {
  await mkdir(path.dirname(SALES_FORECAST_MANUAL_DAILY_FILE), { recursive: true });
  await backupSalesForecastManualDailyStore();
  const payload = {
    updatedAt: nowText(),
    rows: store.rows || {},
  };
  return writeJsonFile(SALES_FORECAST_MANUAL_DAILY_FILE, payload);
}

function updateSalesForecastManualDailyStore(updater) {
  const run = manualDailyWriteQueue.then(async () => {
    const store = await readSalesForecastManualDailyStore();
    const result = await updater(store);
    const saved = await writeSalesForecastManualDailyStore(store);
    return result(saved, store);
  });
  manualDailyWriteQueue = run.catch(() => {});
  return run;
}

export async function getSalesForecastManualDaily() {
  return readSalesForecastManualDailyStore();
}

export async function saveSalesForecastManualDailyRow({ rowKey, values } = {}) {
  const key = canonicalManualDailyKey(rowKey);
  if (!key) throw new Error("缺少销售预估行标识");
  return updateSalesForecastManualDailyStore((store) => {
    store.rows[key] = normalizeManualDailyValues(values);
    return (saved) => ({ ok: true, rowKey: key, values: saved.rows[key], updatedAt: saved.updatedAt });
  });
}

export async function migrateSalesForecastManualDailyRows({ rows } = {}) {
  if (!rows || typeof rows !== "object") throw new Error("缺少待迁移的日销数据");
  return updateSalesForecastManualDailyStore((store) => {
    let changedCount = 0;
    let skippedCount = 0;

    Object.entries(rows).forEach(([rowKey, values]) => {
      const key = canonicalManualDailyKey(rowKey);
      if (!key) return;
      const merged = mergeManualDailyValues(store.rows[key], values);
      changedCount += merged.changedCount;
      skippedCount += merged.skippedCount;
      store.rows[key] = merged.values;
    });

    return (saved) => ({ ok: true, rows: saved.rows, updatedAt: saved.updatedAt, changedCount, skippedCount });
  });
}

async function readSalesForecastHiddenRowsStore() {
  const parsed = await readJsonFile(SALES_FORECAST_HIDDEN_ROWS_FILE, {});
  const rows = parsed?.rows && typeof parsed.rows === "object" ? parsed.rows : {};
  const normalizedRows = {};
  Object.entries(rows).forEach(([key, hidden]) => {
    const canonicalKey = canonicalManualDailyKey(key);
    if (canonicalKey && hidden) normalizedRows[canonicalKey] = true;
  });
  return {
    updatedAt: parsed?.updatedAt || "",
    rows: normalizedRows,
  };
}

async function writeSalesForecastHiddenRowsStore(store) {
  const payload = {
    updatedAt: nowText(),
    rows: store.rows || {},
  };
  return writeJsonFile(SALES_FORECAST_HIDDEN_ROWS_FILE, payload);
}

export async function getSalesForecastHiddenRows() {
  return readSalesForecastHiddenRowsStore();
}

export async function saveSalesForecastHiddenRow({ rowKey, hidden } = {}) {
  const key = canonicalManualDailyKey(rowKey);
  if (!key) throw new Error("缺少销售预估行标识");
  const store = await readSalesForecastHiddenRowsStore();
  if (hidden) store.rows[key] = true;
  else delete store.rows[key];
  const saved = await writeSalesForecastHiddenRowsStore(store);
  return { ok: true, rowKey: key, hidden: Boolean(saved.rows[key]), rows: saved.rows, updatedAt: saved.updatedAt };
}

function toNumber(value) {
  if (typeof value === "string") value = value.replace(/,/g, "").replace(/天|%/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function readNested(record, groups) {
  for (const [target, keys] of groups) {
    const value = readFirst(target, keys);
    if (value !== "") return value;
  }
  return "";
}

function textFromValue(value, depth = 0) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textFromValue(item, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object" && depth < 3) {
    const keys = ["品名", "产品名称", "商品名称", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "title", "name", "value", "text"];
    for (const key of keys) {
      const text = textFromValue(value[key], depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function sameCode(left, right) {
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[\s._-]+/g, "");
  return normalize(left) && normalize(left) === normalize(right);
}

function isProductNameText(value, msku) {
  const text = textFromValue(value);
  if (!text || text === "-" || text === "None") return "";
  if (sameCode(text, msku)) return "";
  return text;
}

function readFirstProductName(item, keys, msku) {
  for (const key of keys) {
    const text = isProductNameText(item?.[key], msku);
    if (text) return text;
  }
  return "";
}

function readNestedProductName(groups, msku) {
  for (const [target, keys] of groups) {
    const text = readFirstProductName(target, keys, msku);
    if (text) return text;
  }
  return "";
}

function findProductName(source, msku, depth = 0) {
  if (!source || depth > 4) return "";
  const directText = isProductNameText(source, msku);
  if (typeof source !== "object") return directText;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findProductName(item, msku, depth + 1);
      if (found) return found;
    }
    return "";
  }

  const preferredKeys = [
    "品名", "产品名称", "商品名称", "中文品名", "本地品名",
    "product_name_cn", "productNameCn", "product_title", "productTitle",
    "local_name", "localName", "item_name", "itemName", "goods_name", "goodsName",
    "sku_name", "skuName", "fnsku_name", "fnskuName", "local_sku_name", "localSkuName",
    "title", "name",
  ];
  for (const key of preferredKeys) {
    const found = findProductName(source[key], msku, depth + 1);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(source)) {
    if (/msku|seller.?sku|fnsku|asin|image|pic|img|url|country|seller|store|shop/i.test(key)) continue;
    if (!/品名|名称|商品|产品|name|title/i.test(key)) continue;
    const found = findProductName(value, msku, depth + 1);
    if (found) return found;
  }
  return "";
}

function readNumberFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return { found: true, value: toNumber(value), key };
    }
  }
  return { found: false, value: 0, key: "" };
}

function readNestedNumber(groups) {
  for (const [target, keys] of groups) {
    const result = readNumberFirst(target, keys);
    if (result.found) return result;
  }
  return { found: false, value: 0, key: "" };
}

function normalizeImageUrl(value) {
  let text = String(value || "").trim();
  if (!text || text === "None" || text === "-") return "";
  if (/^[\[{]/.test(text)) {
    try {
      const found = findImageUrl(JSON.parse(text));
      if (found) return found;
    } catch {
      // Some Lingxing fields are plain URLs, some are stringified JSON.
    }
  }
  if (/%2F|%3A/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the original value when it is not valid percent encoding.
    }
  }
  text = text.replace(/\\\//g, "/");
  if (text.startsWith("//")) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return "";
}

function findImageUrl(source, depth = 0) {
  if (!source || depth > 4) return "";
  if (typeof source === "string") return normalizeImageUrl(source);
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof source !== "object") return "";

  const preferredKeys = [
    "image_url", "imageUrl", "small_image_url", "smallImageUrl", "main_image", "mainImage",
    "main_image_url", "mainImageUrl", "large_image_url", "largeImageUrl", "medium_image_url",
    "mediumImageUrl", "thumbnail_url", "thumbnailUrl", "pic_url", "picUrl", "picture_url",
    "pictureUrl", "product_image", "productImage", "img", "image", "images", "image_list",
    "imageList", "smallImage", "small_image", "pic", "picture", "photo",
    ...(depth > 0 ? ["url", "src", "href", "thumbnail", "thumbnail_url", "thumbnailUrl"] : []),
  ];
  for (const key of preferredKeys) {
    const found = findImageUrl(source[key], depth + 1);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!/image|pic|img|picture|photo/i.test(key)) continue;
    const found = findImageUrl(value, depth + 1);
    if (found) return found;
  }
  return "";
}

function countryName(value) {
  const text = String(value || "").trim();
  if (["US", "USA", "美国"].includes(text)) return "美国";
  if (["CA", "CAN", "Canada", "加拿大"].includes(text)) return "加拿大";
  if (["AU", "AUS", "Australia", "澳大利亚", "澳洲"].includes(text)) return "澳洲";
  return text || "-";
}

function sellerCountry(seller = {}) {
  return countryName(readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName", "countryCode", "country_code", "region"]));
}

function productKey(row) {
  return `${row.sid || ""}:${String(row.msku || "").trim()}`;
}

function daysInMonthOffset(base, offset) {
  const date = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0);
  return date.getDate();
}

function formatDateValue(value) {
  if (!value || value === "不缺货" || value === "无需发货" || value === "无需采购") return value || "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 999;
}

function monthSalesForecast(monthlySales, now = new Date()) {
  const month = now.getMonth() + 1;
  const at = (index) => toNumber(monthlySales[((index - 1) % 12 + 12) % 12]);
  const plans = {
    1: [1, 2, 3, 4],
    2: [2, 3, 4],
    3: [3, 4, 5],
    4: [4, 5, 6, 7],
    5: [5, 6, 7],
    6: [6, 7, 8],
    7: [7, 8, 9, 10, 11],
    8: [8, 9, 10, 11, 12],
    9: [9, 10, 11, 12],
    10: [10, 11, 12],
    11: [11, 12, 1],
    12: [12, 1, 2, 3, 4],
  };
  return (plans[month] || []).reduce((sum, item) => sum + at(item), 0);
}

function peakSeasonSalesForecast(monthlySales, now = new Date()) {
  return Math.round(
    monthlySales
      .slice(now.getMonth(), 12)
      .reduce((sum, value) => sum + toNumber(value), 0),
  );
}

function fbaAvailableDays(totalStock, monthlyDailySales, now = new Date()) {
  const stock = toNumber(totalStock);
  if (stock <= 0) return 0;

  const monthIndex = now.getMonth();
  const daysRemaining = daysInMonthOffset(now, 0) - now.getDate();
  const currentDaily = toNumber(monthlyDailySales[monthIndex]);
  if (stock <= daysRemaining * currentDaily) return safeDivide(stock, currentDaily);

  let remaining = stock - daysRemaining * currentDaily;
  let coveredDays = daysRemaining;
  for (let offset = 1; offset <= 3; offset += 1) {
    const daily = toNumber(monthlyDailySales[(monthIndex + offset) % 12]);
    const monthDays = daysInMonthOffset(now, offset);
    if (remaining <= monthDays * daily) {
      return coveredDays + safeDivide(remaining, daily);
    }
    remaining -= monthDays * daily;
    coveredDays += monthDays;
  }
  return 999;
}

function monthlySalesFromManualDaily(values = [], now = new Date()) {
  const daily = normalizeManualDailyValues(values);
  const daysRemaining = daysInMonthOffset(now, 0) - now.getDate();
  return daily.map((value, monthIndex) => Math.round(value * (monthIndex === now.getMonth() ? daysRemaining : MONTH_DAYS_2026[monthIndex])));
}

function recalculateSalesForecastRowFromManual(row, manualRows = {}, now = new Date()) {
  const rowKey = canonicalManualDailyKey([row.sid || "", row.msku || ""].join("|"));
  const monthlyDailySales = normalizeManualDailyValues(manualRows[rowKey]);
  const monthlySales = monthlySalesFromManualDaily(monthlyDailySales, now);
  const totalStock = toNumber(row.fbaAvailable) + toNumber(row.fbaTransfer) + toNumber(row.fbaReserved) + toNumber(row.awd);
  const salesForecast = Math.round(monthSalesForecast(monthlySales, now));
  const peakSeasonForecast = peakSeasonSalesForecast(monthlySales, now);
  const availableDays = fbaAvailableDays(totalStock, monthlyDailySales, now);
  const outOfStockDate = availableDays >= 999 ? "不缺货" : formatDateValue(addDays(now, availableDays));
  const shippingDate = outOfStockDate === "不缺货" ? "无需发货" : formatDateValue(addDays(new Date(`${outOfStockDate}T00:00:00`), -45));
  const purchaseDate = shippingDate === "无需发货" ? "无需采购" : formatDateValue(addDays(new Date(`${shippingDate}T00:00:00`), -30));
  return {
    ...row,
    manualKey: rowKey,
    monthlyDailySales,
    monthlySales,
    totalStock,
    salesForecast,
    peakSeasonForecast,
    fbaAvailableDays: Number(availableDays.toFixed(1)),
    outOfStockDate,
    shippingDate,
    purchaseDate,
    replenishmentSuggestion: Math.round(salesForecast - totalStock - toNumber(row.fbaInbound)),
    daysRemainingInMonth: daysInMonthOffset(now, 0) - now.getDate(),
  };
}

function salesForecastCostKeys(row = {}) {
  const sid = String(row.sid || "").trim();
  const msku = String(row.msku || "").trim().toLowerCase();
  const storeName = String(row.storeName || "").trim().toLowerCase();
  const country = String(row.country || "").trim().toLowerCase();
  return [
    sid && msku ? `sid:${sid}|${msku}` : "",
    storeName && country && msku ? `store:${storeName}|${country}|${msku}` : "",
    msku ? `msku:${msku}` : "",
  ].filter(Boolean);
}

function buildSalesForecastCostLookup(rows = []) {
  const lookup = new Map();
  const mskuCosts = new Map();
  rows.forEach((row) => {
    const landedUnitCost = toNumber(row.unitCost || row.purchaseCost) || toNumber(row.purchaseCost) + toNumber(row.firstLegCost);
    if (!landedUnitCost) return;
    const cost = {
      purchaseCost: toNumber(row.purchaseCost),
      firstLegCost: toNumber(row.firstLegCost),
      landedUnitCost,
    };
    salesForecastCostKeys(row).forEach((key) => {
      if (key.startsWith("msku:")) {
        const existing = mskuCosts.get(key);
        if (!existing) mskuCosts.set(key, { cost, count: 1 });
        else {
          existing.count += 1;
          existing.cost = {
            purchaseCost: existing.cost.purchaseCost + cost.purchaseCost,
            firstLegCost: existing.cost.firstLegCost + cost.firstLegCost,
            landedUnitCost: existing.cost.landedUnitCost + cost.landedUnitCost,
          };
        }
        return;
      }
      if (!lookup.has(key)) lookup.set(key, cost);
    });
  });
  mskuCosts.forEach((entry, key) => {
    if (!lookup.has(key) && entry.count === 1) lookup.set(key, entry.cost);
  });
  return lookup;
}

function salesForecastCostForRow(row = {}, lookup = new Map()) {
  for (const key of salesForecastCostKeys(row)) {
    const cost = lookup.get(key);
    if (cost) return cost;
  }
  return { purchaseCost: 0, firstLegCost: 0, landedUnitCost: 0 };
}

function buildSalesForecastExportRows(rows = [], { manualRows = {}, costLookup = new Map(), now = new Date() } = {}) {
  return rows.map((sourceRow) => {
    const row = recalculateSalesForecastRowFromManual(sourceRow, manualRows, now);
    const replenishmentEstimate = Math.round(toNumber(row.peakSeasonForecast) - toNumber(row.totalStock) - toNumber(row.fbaInbound));
    const cost = salesForecastCostForRow(row, costLookup);
    return {
      ...row,
      replenishmentEstimate,
      goodsValue: Math.round(replenishmentEstimate * toNumber(cost.landedUnitCost) * 100) / 100,
    };
  });
}

function parseInboundDate(value) {
  const text = String(value || "");
  const match = text.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/);
  return match ? match[0].replaceAll("/", "-") : "";
}

function monthlyValue(sales, record, month, kind) {
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = monthNames[month - 1];
  const cn = `${month}月`;
  if (kind === "daily") {
    return toNumber(readNested(record, [
      [sales, [`sales_avg_${month}`, `${m}_daily`, `${m}Daily`, `daily_${month}`, `${cn}日销`, `month_${month}_daily_sales`]],
      [record, [`sales_avg_${month}`, `${m}_daily`, `${m}Daily`, `daily_${month}`, `${cn}日销`, `month_${month}_daily_sales`]],
    ]));
  }
  return toNumber(readNested(record, [
    [sales, [`sales_${month}`, `${m}_sales`, `${m}Sales`, `month_${month}_sales`, `${cn}销量`]],
    [record, [`sales_${month}`, `${m}_sales`, `${m}Sales`, `month_${month}_sales`, `${cn}销量`]],
  ]));
}

function normalizeAdviceRecord(record, sellerBySid, sourceIndex = 0) {
  const basic = record?.basic_info || record?.basicInfo || {};
  const productInfo = record?.product_info || record?.productInfo || record?.local_product_info || record?.localProductInfo || {};
  const quantity = record?.amazon_quantity_info || record?.amazonQuantityInfo || record?.quantity_info || {};
  const sales = record?.sales_info || record?.salesInfo || {};
  const suggest = record?.suggest_info || record?.suggestInfo || {};
  const mskuList = Array.isArray(basic.msku_fnsku_list) ? basic.msku_fnsku_list : [];
  const msku = String(readNested(record, [
    [basic, ["msku", "seller_sku", "sellerSku"]],
    [record, ["msku", "seller_sku", "sellerSku"]],
    [mskuList[0] || {}, ["msku", "seller_sku", "sellerSku"]],
  ])).trim();
  const sid = Number(readNested(record, [
    [basic, ["sid", "seller_id", "sellerId"]],
    [record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]],
  ]));
  if (!msku) return null;

  const seller = sellerBySid.get(sid) || {};
  const country = countryName(readNested(record, [
    [seller, ["country", "countryName", "country_name", "countryCode", "country_code", "marketplace"]],
    [basic, ["country", "countryName", "country_name", "countryCode", "country_code", "marketplace"]],
    [record, ["country", "countryName", "country_name", "countryCode", "country_code", "marketplace"]],
  ]));
  const fbaTransfer = toNumber(readNested(record, [
    [quantity, ["reserved_fc_transfers", "amazon_quantity_waiting", "transfer_quantity", "fbaTransfer", "fba_transfer"]],
    [record, ["reserved_fc_transfers", "amazon_quantity_waiting", "transfer_quantity", "fbaTransfer", "fba_transfer"]],
  ]));
  const reservedProcessing = readNestedNumber([
    [quantity, ["reserved_fc_processing"]],
    [record, ["reserved_fc_processing"]],
  ]);
  const reservedCustomerOrders = readNestedNumber([
    [quantity, ["reserved_customerorders", "reserved_customer_orders"]],
    [record, ["reserved_customerorders", "reserved_customer_orders"]],
  ]);
  const directFbaReserved = readNestedNumber([
    [quantity, ["afn_reserved_quantity", "reserved_quantity", "fbaReserved", "fba_reserved"]],
    [record, ["afn_reserved_quantity", "reserved_quantity", "fbaReserved", "fba_reserved"]],
  ]);
  const detailedFbaReserved = reservedProcessing.value + reservedCustomerOrders.value;
  const fbaReserved = Math.max(detailedFbaReserved, directFbaReserved.value);
  const directFbaAvailable = readNestedNumber([
    [quantity, [
      "afn_fulfillable_quantity",
      "total_fulfillable_quantity",
      "amazon_quantity_available",
      "amazonQuantityAvailable",
      "amazon_quantity_fulfillable",
      "amazonQuantityFulfillable",
      "fba_available_quantity",
      "fbaAvailableQuantity",
      "fba_available",
      "fbaAvailable",
      "available_quantity",
      "availableQuantity",
      "fulfillable_quantity",
      "fulfillableQuantity",
      "quantity_available",
      "quantityAvailable",
    ]],
    [record, [
      "afn_fulfillable_quantity",
      "total_fulfillable_quantity",
      "amazon_quantity_available",
      "amazonQuantityAvailable",
      "amazon_quantity_fulfillable",
      "amazonQuantityFulfillable",
      "fba_available_quantity",
      "fbaAvailableQuantity",
      "fba_available",
      "fbaAvailable",
      "available_quantity",
      "availableQuantity",
      "fulfillable_quantity",
      "fulfillableQuantity",
      "quantity_available",
      "quantityAvailable",
    ]],
  ]);
  const validFbaStock = readNestedNumber([
    [quantity, ["amazon_quantity_valid", "amazonQuantityValid"]],
    [record, ["amazon_quantity_valid", "amazonQuantityValid"]],
  ]);
  const fbaAvailable = directFbaAvailable.found
    ? directFbaAvailable.value
    : Math.max(0, validFbaStock.value - fbaTransfer - fbaReserved);
  const awd = toNumber(readNested(record, [
    [quantity, ["awd", "awd_quantity", "awd_available"]],
    [record, ["awd", "awd_quantity", "awd_available"]],
  ]));
  const fbaInbound = toNumber(readNested(record, [
    [quantity, ["amazon_quantity_shipping", "afn_inbound_shipped_quantity", "inboundQuantity", "inbound_quantity", "fbaInbound", "fba_inbound"]],
    [record, ["amazon_quantity_shipping", "afn_inbound_shipped_quantity", "inboundQuantity", "inbound_quantity", "fbaInbound", "fba_inbound"]],
  ]));

  const monthlyDailySales = Array(12).fill(0);
  const monthlySales = Array(12).fill(0);
  const previousYearMonthlySales = Array(12).fill(null);
  const daily3 = toNumber(readNested(record, [[sales, ["sales_avg_3", "dailyAvg3", "salesAvg3"]], [record, ["sales_avg_3", "dailyAvg3", "salesAvg3"]]]));
  const daily7 = toNumber(readNested(record, [[sales, ["sales_avg_7", "dailyAvg7", "salesAvg7"]], [record, ["sales_avg_7", "dailyAvg7", "salesAvg7"]]]));
  const daily14 = toNumber(readNested(record, [[sales, ["sales_avg_14", "dailyAvg14", "salesAvg14"]], [record, ["sales_avg_14", "dailyAvg14", "salesAvg14"]]]));
  const daily30 = toNumber(readNested(record, [[sales, ["sales_avg_30", "dailyAvg30", "salesAvg30"]], [record, ["sales_avg_30", "dailyAvg30", "salesAvg30"]]]));
  const totalStock = fbaAvailable + fbaTransfer + fbaReserved + awd;
  const now = new Date();
  const forecast = monthSalesForecast(monthlySales, now);
  const peakSeasonForecast = peakSeasonSalesForecast(monthlySales, now);
  const availableDays = fbaAvailableDays(totalStock, monthlyDailySales, now);
  const outOfStockDate = availableDays >= 999 ? "不缺货" : formatDateValue(addDays(now, availableDays));
  const shippingDate = outOfStockDate === "不缺货" ? "无需发货" : formatDateValue(addDays(new Date(`${outOfStockDate}T00:00:00`), -45));
  const purchaseDate = shippingDate === "无需发货" ? "无需采购" : formatDateValue(addDays(new Date(`${shippingDate}T00:00:00`), -30));
  const recommendedDaily = daily3 * 0.4 + daily7 * 0.3 + daily14 * 0.2 + daily30 * 0.1;
  const replenishmentSuggestion = forecast - totalStock - fbaInbound;
  const inboundDetail = readNested(record, [
    [quantity, ["amazon_quantity_shipping_detail", "fba_inbound_detail", "inbound_detail"]],
    [record, ["amazon_quantity_shipping_detail", "fba_inbound_detail", "inbound_detail", "fba_inbound_details"]],
  ]);
  const imageUrl = normalizeImageUrl(readNested(record, [
    [basic, ["image_url", "imageUrl", "small_image_url", "smallImageUrl", "main_image", "mainImage", "main_image_url", "mainImageUrl", "large_image_url", "largeImageUrl", "medium_image_url", "mediumImageUrl", "thumbnail_url", "thumbnailUrl", "pic_url", "picUrl", "picture_url", "pictureUrl", "product_image", "productImage", "image", "img", "pic"]],
    [record, ["image_url", "imageUrl", "small_image_url", "smallImageUrl", "main_image", "mainImage", "main_image_url", "mainImageUrl", "large_image_url", "largeImageUrl", "medium_image_url", "mediumImageUrl", "thumbnail_url", "thumbnailUrl", "pic_url", "picUrl", "picture_url", "pictureUrl", "product_image", "productImage", "image", "img", "pic"]],
    [mskuList[0] || {}, ["image_url", "imageUrl", "small_image_url", "smallImageUrl", "main_image", "mainImage", "main_image_url", "mainImageUrl", "large_image_url", "largeImageUrl", "medium_image_url", "mediumImageUrl", "thumbnail_url", "thumbnailUrl", "pic_url", "picUrl", "picture_url", "pictureUrl", "image", "img", "pic"]],
  ])) || findImageUrl(record);

  return {
    sourceIndex,
    sid,
    storeName: readNested(record, [
      [seller, ["name", "seller_name", "shop_name", "store_name"]],
      [basic, ["seller_name", "shop_name", "store_name"]],
      [record, ["storeName", "store_name", "seller_name", "shop_name"]],
    ]) || "-",
    country,
    productName: readNestedProductName([
      [basic, ["品名", "产品名称", "商品名称", "中文品名", "本地品名", "product_name_cn", "productNameCn", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "product_title", "productTitle", "goods_name", "goodsName", "sku_name", "skuName", "fnsku_name", "fnskuName", "local_sku_name", "localSkuName", "name", "title"]],
      [productInfo, ["品名", "产品名称", "商品名称", "中文品名", "本地品名", "product_name_cn", "productNameCn", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "product_title", "productTitle", "goods_name", "goodsName", "sku_name", "skuName", "fnsku_name", "fnskuName", "local_sku_name", "localSkuName", "name", "title"]],
      [record, ["品名", "产品名称", "商品名称", "中文品名", "本地品名", "product_name_cn", "productNameCn", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "product_title", "productTitle", "goods_name", "goodsName", "sku_name", "skuName", "fnsku_name", "fnskuName", "local_sku_name", "localSkuName", "name", "title"]],
      [mskuList[0] || {}, ["品名", "产品名称", "商品名称", "中文品名", "本地品名", "product_name_cn", "productNameCn", "local_name", "localName", "product_name", "productName", "item_name", "itemName", "product_title", "productTitle", "goods_name", "goodsName", "sku_name", "skuName", "name", "title"]],
    ], msku) || findProductName(record, msku) || msku,
    msku,
    imageUrl,
    fbaAvailable,
    fbaTransfer,
    fbaReserved,
    awd,
    fbaInbound,
    totalStock,
    salesForecast: Math.round(forecast),
    peakSeasonForecast,
    fbaAvailableDays: Number(availableDays.toFixed(1)),
    inboundArrivalDate: parseInboundDate(inboundDetail) || formatDateValue(readFirst(suggest, ["arrival_date", "expected_arrival_date", "expected_available_time"])),
    outOfStockDate,
    shippingDate,
    purchaseDate,
    recommendedDaily: Number(recommendedDaily.toFixed(2)),
    replenishmentSuggestion: Math.round(replenishmentSuggestion),
    monthlyDailySales: monthlyDailySales.map((value) => Number(value.toFixed(2))),
    monthlySales: monthlySales.map((value) => Math.round(value)),
    previousYearMonthlySales,
    daysRemainingInMonth: daysInMonthOffset(now, 0) - now.getDate(),
    recentDaily: {
      days3: Number(daily3.toFixed(2)),
      days7: Number(daily7.toFixed(2)),
      days14: Number(daily14.toFixed(2)),
      days30: Number(daily30.toFixed(2)),
    },
  };
}

function productOrderIndex(row) {
  const exact = DEFAULT_PRODUCT_ORDER_MAP.get(String(row.msku || "").toLowerCase());
  if (exact !== undefined) return exact;
  const compactMsku = String(row.msku || "").toLowerCase().replace(/\s+/g, "");
  for (const [key, index] of DEFAULT_PRODUCT_ORDER_MAP) {
    if (compactMsku === key.replace(/\s+/g, "")) return index;
  }
  return 10000 + Number(row.sourceIndex || 0);
}

function summarize(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.salesForecast += row.salesForecast || 0;
      acc.fbaInbound += row.fbaInbound || 0;
      acc.lowStockCount += row.fbaAvailableDays > 0 && row.fbaAvailableDays < 14 ? 1 : 0;
      acc.replenishmentCount += row.replenishmentSuggestion > 0 ? 1 : 0;
      return acc;
    },
    { salesForecast: 0, fbaInbound: 0, lowStockCount: 0, replenishmentCount: 0 },
  );
  return { ...totals, skuCount: rows.length };
}

function filterRows(rows, filters) {
  const countries = listFilterValues(filters.country);
  const stores = listFilterValues(filters.store);
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesAnyFilter(row.country, countries)) return false;
    if (!matchesAnyFilter(row.storeName, stores)) return false;
    if (!keyword) return true;
    return [row.storeName, row.country, row.productName, row.msku]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
}

function storeOptions(rows) {
  return [...new Set(rows.map((row) => row.storeName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => {
      const match = rows.find((row) => row.storeName === name);
      return { name, country: match?.country || "" };
    });
}

function rowListingKey(sid, msku) {
  return `${Number(sid || 0)}|${String(msku || "").trim().toLowerCase()}`;
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function previousYearSalesMonths(now = new Date()) {
  const startMonth = now.getMonth() + 1;
  return Array.from({ length: 13 - startMonth }, (_, index) => startMonth + index);
}

function salesStatRowKey(sid, msku) {
  return `${Number(sid || 0)}|${String(msku || "").trim().toLowerCase()}`;
}

function buildSalesStatQuantityLookup(rows = []) {
  const bySidAndMsku = new Map();
  const imagesBySidAndMsku = new Map();
  rows.forEach((row) => {
    const msku = String(row.msku || "").trim();
    if (!msku) return;
    const quantity = Number(row.quantity || row.subtotal || 0);
    const exactKey = salesStatRowKey(row.sid, msku);
    bySidAndMsku.set(exactKey, Number(bySidAndMsku.get(exactKey) || 0) + quantity);
    const imageUrl = normalizeImageUrl(row.imageUrl) || findImageUrl(row.raw);
    if (imageUrl && !imagesBySidAndMsku.has(exactKey)) imagesBySidAndMsku.set(exactKey, imageUrl);
  });
  return { bySidAndMsku, imagesBySidAndMsku };
}

function applyPreviousYearMonthlySales(rows, rowsByMonth = new Map()) {
  const monthLookups = new Map();
  rowsByMonth.forEach((salesRows, month) => {
    monthLookups.set(Number(month), buildSalesStatQuantityLookup(salesRows));
  });
  return rows.map((row) => {
    const previousYearMonthlySales = Array(12).fill(null);
    let imageUrl = row.imageUrl || "";
    previousYearSalesMonths().forEach((month) => {
      const lookup = monthLookups.get(month);
      const value = lookup
        ? lookup.bySidAndMsku.get(salesStatRowKey(row.sid, row.msku)) ?? 0
        : null;
      previousYearMonthlySales[month - 1] = value === null ? null : Math.round(Number(value || 0));
      if (!imageUrl && lookup) {
        imageUrl = lookup.imagesBySidAndMsku.get(salesStatRowKey(row.sid, row.msku))
          || "";
      }
    });
    return { ...row, imageUrl, previousYearMonthlySales };
  });
}

function rowsNeedPreviousYearSales(rows = []) {
  const months = previousYearSalesMonths();
  return rows.some((row) => {
    const values = Array.isArray(row.previousYearMonthlySales) ? row.previousYearMonthlySales : [];
    return months.some((month) => values[month - 1] === undefined || values[month - 1] === null);
  });
}

function rowsNeedSalesStatImageHydration(rows = []) {
  return rows.some((row) => !normalizeImageUrl(row.imageUrl));
}

async function enrichRowsWithPreviousYearSales(adapter, rows, sellersBySid = new Map(), selectedSids = []) {
  const months = previousYearSalesMonths();
  const sids = uniqueText([
    ...(Array.isArray(selectedSids) ? selectedSids : []),
    ...rows.map((row) => row.sid),
  ]).map(Number).filter(Boolean);
  if (!rows.length || !sids.length || !months.length) {
    return { rows, syncStatus: "2025同期销量未读取：缺少店铺或产品" };
  }

  const result = await getSalesStatMonthlyQuantityRows({
    adapter,
    sellersBySid,
    sids,
    year: SALES_FORECAST_REFERENCE_YEAR,
    months,
  });
  return {
    rows: applyPreviousYearMonthlySales(rows, result.rowsByMonth),
    syncStatus: `2025同期销量 salesStat ${result.rowCount || 0} 条`,
    endpoint: result.endpoint || "",
  };
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function readSalesForecastListingStore() {
  const parsed = await readJsonFile(SALES_FORECAST_LISTING_CACHE_FILE, {});
  return {
    updatedAt: parsed?.updatedAt || "",
    products: parsed?.products && typeof parsed.products === "object" ? parsed.products : {},
  };
}

async function writeSalesForecastListingStore(store) {
  return writeJsonFile(SALES_FORECAST_LISTING_CACHE_FILE, {
    updatedAt: nowText(),
    products: store.products || {},
  });
}

function applyListingProductCache(rows, products = {}) {
  return rows.map((row) => {
    const product = products[rowListingKey(row.sid, row.msku)] || {};
    return {
      ...row,
      productName: sameCode(row.productName, row.msku) && product.productName ? product.productName : row.productName,
      imageUrl: row.imageUrl || product.imageUrl || "",
    };
  });
}

async function fetchListingProductMap(adapter, rows) {
  const rowsBySid = new Map();
  rows.forEach((row) => {
    const sid = Number(row.sid || 0);
    const msku = String(row.msku || "").trim();
    if (!sid || !msku) return;
    if (!rowsBySid.has(sid)) rowsBySid.set(sid, []);
    rowsBySid.get(sid).push(msku);
  });

  const tasks = [];
  rowsBySid.forEach((mskus, sid) => {
    chunkArray(uniqueText(mskus), 10).forEach((batch) => tasks.push({ sid, batch }));
  });

  const productMap = new Map();
  await mapWithConcurrency(tasks, SALES_FORECAST_LISTING_CONCURRENCY, async ({ sid, batch }) => {
    try {
      const payload = await adapter.fetchListings({
        sid,
        is_pair: 1,
        is_delete: 0,
        search_field: "seller_sku",
        search_value: batch,
        exact_search: 1,
        offset: 0,
        length: 1000,
      });
      adapter.normalizeRecordList(payload).forEach((record) => {
        const msku = String(readFirst(record, ["seller_sku", "sellerSku", "msku"]) || "").trim();
        if (!msku) return;
        productMap.set(rowListingKey(sid, msku), {
          productName: readFirstProductName(record, ["local_name", "localName", "product_name", "productName", "item_name", "itemName", "title", "name"], msku),
          imageUrl: normalizeImageUrl(readFirst(record, [
            "small_image_url",
            "smallImageUrl",
            "image_url",
            "imageUrl",
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
            "image",
            "img",
            "pic",
          ])) || findImageUrl(record),
        });
      });
    } catch {
      // Listing enrichment is best-effort; replenishment advice remains authoritative for quantities.
    }
  });
  return productMap;
}

async function enrichRowsFromListingCache(rows) {
  const listingStore = await readSalesForecastListingStore();
  return {
    rows: applyListingProductCache(rows, listingStore.products),
    listingStore,
  };
}

function rowsMissingListingProducts(rows) {
  return rows.filter((row) => sameCode(row.productName, row.msku) || !row.imageUrl);
}

async function refreshListingProducts(adapter, rows, cacheVersion) {
  const { rows: cachedRows, listingStore } = await enrichRowsFromListingCache(rows);
  const missingRows = rowsMissingListingProducts(cachedRows);
  if (!missingRows.length) return;

  const productMap = await fetchListingProductMap(adapter, missingRows);
  productMap.forEach((product, key) => {
    const existing = listingStore.products[key] || {};
    listingStore.products[key] = {
      productName: product.productName || existing.productName || "",
      imageUrl: product.imageUrl || existing.imageUrl || "",
      updatedAt: nowText(),
    };
  });
  await writeSalesForecastListingStore(listingStore);

  const dashboardCache = await readSalesForecastDashboardCache();
  if (!dashboardCache || dashboardCache.cachedAt !== cacheVersion) return;
  await writeSalesForecastDashboardCache({
    ...dashboardCache,
    rows: applyListingProductCache(dashboardCache.rows || [], listingStore.products),
    enrichmentPending: false,
    listingUpdatedAt: nowText(),
  });
}

function startListingProductRefresh(adapter, rows, cacheVersion) {
  if (salesForecastListingRefreshPromise) return;
  salesForecastListingRefreshPromise = refreshListingProducts(adapter, rows, cacheVersion)
    .catch(() => {})
    .finally(() => {
      salesForecastListingRefreshPromise = null;
    });
}

async function fetchAdviceRows(adapter, selectedSids) {
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const payload = await adapter.fetchReplenishmentAdvice({
      sid_list: selectedSids.map(String),
      data_type: 2,
      offset,
      length: 200,
    }, SALES_FORECAST_ADVICE_ENDPOINT);
    const records = adapter.normalizeRecordList(payload);
    rows.push(...records);
    if (records.length < 200) break;
  }
  return { rows, endpoint: SALES_FORECAST_ADVICE_ENDPOINT };
}

function normalizeFbaInventoryRecord(record) {
  const sid = Number(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
  const msku = String(readFirst(record, ["seller_sku", "sellerSku", "msku", "m_sku"]) || "").trim();
  if (!sid || !msku) return null;

  const fbaAvailable = toNumber(readFirst(record, [
    "afn_fulfillable_quantity",
    "available_total",
    "amazon_quantity_available",
    "fba_available_quantity",
    "available_quantity",
  ]));
  const fbaTransfer = toNumber(readFirst(record, [
    "reserved_fc_transfers",
    "amazon_quantity_waiting",
    "transfer_quantity",
  ]));
  const detailedReserved = toNumber(readFirst(record, ["reserved_fc_processing"]))
    + toNumber(readFirst(record, ["reserved_customerorders", "reserved_customer_orders"]));
  const directReserved = toNumber(readFirst(record, [
    "afn_reserved_quantity",
    "reserved_quantity",
    "fba_reserved",
  ]));

  return {
    sid,
    msku,
    fbaAvailable,
    fbaTransfer,
    fbaReserved: Math.max(detailedReserved, directReserved),
    productName: readFirstProductName(record, ["product_name", "productName", "local_name", "item_name"], msku),
    imageUrl: normalizeImageUrl(readFirst(record, [
      "small_image_url",
      "image_url",
      "imageUrl",
      "pic_url",
      "picUrl",
    ])) || findImageUrl(record),
  };
}

function applyFbaInventoryDetails(rows, inventoryRecords = []) {
  const inventoryByRow = new Map();
  inventoryRecords
    .map(normalizeFbaInventoryRecord)
    .filter(Boolean)
    .forEach((record) => {
      inventoryByRow.set(salesStatRowKey(record.sid, record.msku), record);
    });

  let matchedCount = 0;
  const nextRows = rows.map((row) => {
    const inventory = inventoryByRow.get(salesStatRowKey(row.sid, row.msku));
    if (!inventory) return row;
    matchedCount += 1;
    const totalStock = inventory.fbaAvailable
      + inventory.fbaTransfer
      + inventory.fbaReserved
      + Number(row.awd || 0);
    return {
      ...row,
      productName: sameCode(row.productName, row.msku) && inventory.productName
        ? inventory.productName
        : row.productName,
      imageUrl: row.imageUrl || inventory.imageUrl || "",
      fbaAvailable: inventory.fbaAvailable,
      fbaTransfer: inventory.fbaTransfer,
      fbaReserved: inventory.fbaReserved,
      totalStock,
      replenishmentSuggestion: Math.round(Number(row.salesForecast || 0) - totalStock - Number(row.fbaInbound || 0)),
    };
  });
  return { rows: nextRows, matchedCount, inventoryCount: inventoryRecords.length };
}

async function enrichRowsWithFbaInventory(adapter, rows, selectedSids) {
  const inventoryRecords = await adapter.fetchAllFbaInventoryDetails(selectedSids, { maxRows: 10000 });
  return applyFbaInventoryDetails(rows, inventoryRecords);
}

function mockRows() {
  const base = [
    { storeName: "US探嘉", country: "美国", productName: "TJ001灯光船（蓝色）", msku: "JM-DGC-BLUE", fbaAvailable: 539, fbaTransfer: 453, fbaReserved: 19, awd: 0, fbaInbound: 2160, daily: [4, 4, 15, 23, 25, 40, 20, 0, 0, 0, 0, 2], recent: [20.67, 17.72, 16.58, 21.47] },
    { storeName: "CA探嘉", country: "加拿大", productName: "花朵泡泡机", msku: "CAJM-HDPPJ", fbaAvailable: 122, fbaTransfer: 18, fbaReserved: 5, awd: 0, fbaInbound: 300, daily: [3, 6, 7, 6.6, 10, 15, 6, 2, 0, 0, 0, 4], recent: [9.2, 8.6, 7.5, 6.4] },
    { storeName: "AU探嘉", country: "澳洲", productName: "飞机泡泡机", msku: "JMAU-AIRPLANEBUBBLE", fbaAvailable: 84, fbaTransfer: 0, fbaReserved: 0, awd: 0, fbaInbound: 120, daily: [1, 0, 0.1, 0, 0.2, 0.2, 0, 0, 0, 0, 0, 0], recent: [0.7, 0.4, 0.3, 0.2] },
  ];
  return base.map((item, index) => {
    const manualDaily = Array(12).fill(0);
    const monthlySales = manualDaily.map((value, monthIndex) => Math.round(value * MONTH_DAYS_2026[monthIndex]));
    const previousYearMonthlySales = item.daily.map((value, monthIndex) => Math.round(value * MONTH_DAYS_2026[monthIndex]));
    const totalStock = item.fbaAvailable + item.fbaTransfer + item.fbaReserved + item.awd;
    const salesForecast = monthSalesForecast(monthlySales);
    const peakSeasonForecast = peakSeasonSalesForecast(monthlySales);
    const fbaDays = fbaAvailableDays(totalStock, manualDaily);
    return {
      sid: index + 1,
      ...item,
      totalStock,
      salesForecast,
      peakSeasonForecast,
      fbaAvailableDays: Number(fbaDays.toFixed(1)),
      inboundArrivalDate: index === 0 ? "2026-05-25" : "无在途",
      outOfStockDate: fbaDays >= 999 ? "不缺货" : formatDateValue(addDays(new Date(), fbaDays)),
      shippingDate: fbaDays >= 999 ? "无需发货" : formatDateValue(addDays(addDays(new Date(), fbaDays), -45)),
      purchaseDate: fbaDays >= 999 ? "无需采购" : formatDateValue(addDays(addDays(new Date(), fbaDays), -75)),
      recommendedDaily: Number((item.recent[0] * 0.4 + item.recent[1] * 0.3 + item.recent[2] * 0.2 + item.recent[3] * 0.1).toFixed(2)),
      replenishmentSuggestion: Math.round(salesForecast - totalStock - item.fbaInbound),
      monthlyDailySales: manualDaily,
      monthlySales,
      previousYearMonthlySales,
      daysRemainingInMonth: daysInMonthOffset(new Date(), 0) - new Date().getDate(),
      recentDaily: { days3: item.recent[0], days7: item.recent[1], days14: item.recent[2], days30: item.recent[3] },
    };
  });
}

async function readSalesForecastDashboardCache({ strict = false } = {}) {
  const parsed = await readJsonFile(SALES_FORECAST_DASHBOARD_CACHE_FILE, null);
  if (!parsed) return null;
  const reasons = [];
  if (parsed.version !== SALES_FORECAST_CACHE_VERSION) reasons.push("version is invalid");
  if (!Array.isArray(parsed.rows)) reasons.push("rows must be an array");
  if (!Number.isFinite(Number(parsed.cachedAt))) reasons.push("cachedAt must be numeric");
  if (reasons.length) {
    if (strict) throw new Error(`销售预估缓存契约无效：${reasons.join("; ")}`);
    return null;
  }
  return parsed;
}

function salesForecastFbaKey(value) {
  return String(value || "").trim().toLowerCase();
}

function salesForecastAvailableDaysKey(sid, msku) {
  const sellerId = Number(sid);
  const normalizedMsku = salesForecastFbaKey(msku);
  return Number.isFinite(sellerId) && sellerId > 0 && normalizedMsku ? `${sellerId}|${normalizedMsku}` : "";
}

export async function getSalesForecastAvailableDaysBySellerMsku({ now = new Date() } = {}) {
  const [cache, manualDaily] = await Promise.all([
    readSalesForecastDashboardCache({ strict: true }),
    getSalesForecastManualDaily(),
  ]);
  const map = new Map();
  if (!cache?.rows?.length) {
    return {
      map,
      status: "销售预估缓存暂无可售天数数据",
      updatedAt: "",
      cacheHit: false,
    };
  }

  for (const row of cache.rows) {
    const key = salesForecastAvailableDaysKey(row?.sid, row?.msku);
    const manualKey = canonicalManualDailyKey([row?.sid || "", row?.msku || ""].join("|"));
    const manualValues = normalizeManualDailyValues(manualDaily.rows?.[manualKey]);
    if (!key || !manualValues.some((value) => value > 0)) continue;
    const days = Number(recalculateSalesForecastRowFromManual(row, manualDaily.rows, now).fbaAvailableDays);
    if (!Number.isFinite(days)) continue;
    if (map.has(key)) throw new Error(`销售预估缓存存在重复店铺 MSKU 可售天数：${key}`);
    map.set(key, days);
  }

  return {
    map,
    status: `按销售预估手动日销计算可售天数 ${map.size} 条`,
    updatedAt: cache.updatedAt || "",
    cacheHit: true,
  };
}

export async function getSalesForecastFbaInventoryByMsku() {
  const cache = await readSalesForecastDashboardCache();
  const map = new Map();
  if (!cache?.rows?.length) {
    return {
      map,
      status: "销售预估缓存暂无 FBA 库存数据",
      updatedAt: "",
      cacheHit: false,
    };
  }

  cache.rows.forEach((row) => {
    const msku = String(row.msku || "").trim();
    const key = salesForecastFbaKey(msku);
    if (!key) return;
    const current = map.get(key) || {
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
    map.set(key, current);
  });

  return {
    map,
    status: `复用销售预估 FBA 库存 ${map.size} 个 MSKU`,
    updatedAt: cache.updatedAt || "",
    cacheHit: true,
  };
}

async function writeSalesForecastDashboardCache(cache) {
  return writeJsonFile(SALES_FORECAST_DASHBOARD_CACHE_FILE, cache);
}

function isSalesForecastDashboardCacheFresh(cache) {
  return Boolean(cache && Date.now() - Number(cache.cachedAt || 0) < SALES_FORECAST_CACHE_TTL_MS);
}

async function refreshSalesForecastDashboardCache() {
  const adapter = getLingxingAdapter();
  const sellersResult = await getSharedSellers({ adapter });
  const sellerList = filterCoreSellers(sellersResult.sellers || []);
  const activeSellers = sellerList.filter((seller) => !seller.status || seller.status === 1);
  const sellerBySid = new Map(
    activeSellers
      .map((seller) => [Number(seller.sid), seller])
      .filter(([sid]) => Number.isFinite(sid) && sid > 0),
  );
  const selectedSids = [...sellerBySid.keys()];
  if (!selectedSids.length) throw new Error("没有匹配到可用店铺");

  const result = await fetchAdviceRows(adapter, selectedSids);
  const normalizedRows = result.rows
    .map((record, index) => normalizeAdviceRecord(record, sellerBySid, index))
    .filter(Boolean)
    .filter((row) => COUNTRY_OPTIONS.includes(row.country))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "zh-CN") || a.country.localeCompare(b.country, "zh-CN") || productOrderIndex(a) - productOrderIndex(b) || a.msku.localeCompare(b.msku, "zh-CN"));
  const { rows: listingRows } = await enrichRowsFromListingCache(normalizedRows);
  let rows = listingRows;
  const fbaInventoryResult = await enrichRowsWithFbaInventory(adapter, rows, selectedSids);
  rows = fbaInventoryResult.rows;
  const fbaInventorySyncStatus = `FBA库存精确匹配 ${fbaInventoryResult.matchedCount}/${fbaInventoryResult.inventoryCount} 条`;
  const previousYearResult = await enrichRowsWithPreviousYearSales(adapter, rows, sellerBySid, selectedSids);
  rows = previousYearResult.rows;
  const previousYearSyncStatus = previousYearResult.syncStatus || "";
  const previousYearEndpoint = previousYearResult.endpoint || "";
  const cachedAt = Date.now();
  const cache = {
    version: SALES_FORECAST_CACHE_VERSION,
    cachedAt,
    updatedAt: nowText(),
    endpoint: result.endpoint,
    previousYearSalesEndpoint: previousYearEndpoint,
    previousYearSyncStatus,
    fbaInventorySyncStatus,
    salesStatImagesHydratedAt: previousYearEndpoint ? nowText() : "",
    adviceCount: result.rows.length,
    sellerCount: selectedSids.length,
    rows,
    enrichmentPending: rowsMissingListingProducts(rows).length > 0,
  };
  await writeSalesForecastDashboardCache(cache);
  if (cache.enrichmentPending) startListingProductRefresh(adapter, normalizedRows, cachedAt);
  return cache;
}

function runSalesForecastDashboardRefresh() {
  if (!salesForecastDashboardRefreshPromise) {
    salesForecastDashboardRefreshPromise = refreshSalesForecastDashboardCache()
      .finally(() => {
        salesForecastDashboardRefreshPromise = null;
      });
  }
  return salesForecastDashboardRefreshPromise;
}

async function ensureCachedPreviousYearSales(cache) {
  if (!cache || !Array.isArray(cache.rows)) return cache;
  const needsPreviousYearSales = rowsNeedPreviousYearSales(cache.rows);
  const needsSalesStatImages = rowsNeedSalesStatImageHydration(cache.rows) && !cache.salesStatImagesHydratedAt;
  if (!needsPreviousYearSales && !needsSalesStatImages) return cache;
  const adapter = getLingxingAdapter();
  let previousYearSyncStatus = "";
  let previousYearEndpoint = "";
  try {
    const previousYearResult = await enrichRowsWithPreviousYearSales(adapter, cache.rows, new Map(), cache.rows.map((row) => row.sid));
    previousYearSyncStatus = previousYearResult.syncStatus || "";
    previousYearEndpoint = previousYearResult.endpoint || "";
    const nextCache = {
      ...cache,
      rows: previousYearResult.rows,
      previousYearSalesEndpoint: previousYearEndpoint,
      previousYearSyncStatus,
      previousYearUpdatedAt: nowText(),
      salesStatImagesHydratedAt: nowText(),
    };
    await writeSalesForecastDashboardCache(nextCache);
    return nextCache;
  } catch (error) {
    console.error("[sales-forecast] previous year sales hydration failed", {
      cacheUpdatedAt: cache.updatedAt || "",
      cacheAgeMs: cache.cachedAt ? Date.now() - Number(cache.cachedAt) : null,
      error: error.message,
    });
    throw new Error(`销售预估同期销量补齐失败：${error.message}`);
  }
}

function buildSalesForecastDashboardResponse(cache, filters, manualDaily, hiddenRows, { cacheHit = true } = {}) {
  const countries = listFilterValues(filters.country);
  const rows = filterRows(cache.rows || [], filters);
  const availableStores = storeOptions((cache.rows || []).filter((row) => !countries.length || countries.includes(row.country)));
  const cacheExpiresAt = new Date(Number(cache.cachedAt || Date.now()) + SALES_FORECAST_CACHE_TTL_MS)
    .toLocaleString("zh-CN", { hour12: false });
  const cacheLabel = cacheHit ? "12小时缓存" : "实时更新";
  const enrichmentLabel = cache.enrichmentPending ? "；品名和图片后台补齐中" : "";
  const previousYearLabel = cache.previousYearSyncStatus ? `；${cache.previousYearSyncStatus}` : "";
  const fbaInventoryLabel = cache.fbaInventorySyncStatus ? `；${cache.fbaInventorySyncStatus}` : "";
  return {
    ok: true,
    meta: {
      source: "领星 ERP · 补货建议",
      endpoint: cache.endpoint || SALES_FORECAST_ADVICE_ENDPOINT,
      syncStatus: `${cacheLabel}；补货建议 ${cache.adviceCount || cache.rows?.length || 0} 条；店铺 ${cache.sellerCount || 0} 个${fbaInventoryLabel}${enrichmentLabel}${previousYearLabel}`,
      updatedAt: cache.updatedAt || nowText(),
      cacheHit,
      cacheExpiresAt,
      enrichmentPending: Boolean(cache.enrichmentPending),
      countries: COUNTRY_OPTIONS,
      stores: availableStores,
    },
    summary: summarize(rows),
    manualDaily: manualDaily.rows,
    manualDailyUpdatedAt: manualDaily.updatedAt,
    hiddenRows: hiddenRows.rows,
    hiddenRowsUpdatedAt: hiddenRows.updatedAt,
    rows,
  };
}

export async function getSalesForecastDashboard(filters = {}) {
  const [manualDaily, hiddenRows] = await Promise.all([
    getSalesForecastManualDaily(),
    getSalesForecastHiddenRows(),
  ]);
  const syncState = getSyncState();
  if (syncState.provider !== "lingxing") {
    const allRows = mockRows();
    const rows = filterRows(allRows, filters);
    return {
      ok: true,
      meta: {
        source: "本地示例 · 销售与备货.xlsx",
        syncStatus: "未连接领星 ERP，展示表格结构示例",
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        countries: COUNTRY_OPTIONS,
        stores: storeOptions(allRows),
      },
      summary: summarize(rows),
      manualDaily: manualDaily.rows,
      manualDailyUpdatedAt: manualDaily.updatedAt,
      hiddenRows: hiddenRows.rows,
      hiddenRowsUpdatedAt: hiddenRows.updatedAt,
      rows,
    };
  }

  const cached = await readSalesForecastDashboardCache();
  if (!filters.force && isSalesForecastDashboardCacheFresh(cached)) {
    const hydrated = await ensureCachedPreviousYearSales(cached);
    return buildSalesForecastDashboardResponse(hydrated, filters, manualDaily, hiddenRows, { cacheHit: true });
  }

  try {
    const refreshed = await runSalesForecastDashboardRefresh();
    return buildSalesForecastDashboardResponse(refreshed, filters, manualDaily, hiddenRows, { cacheHit: false });
  } catch (error) {
    console.error("[sales-forecast] refresh failed", {
      force: Boolean(filters.force),
      cacheUpdatedAt: cached?.updatedAt || "",
      cacheAgeMs: cached?.cachedAt ? Date.now() - Number(cached.cachedAt) : null,
      error: error.message,
    });
    throw new Error(`销售预估刷新失败，未使用过期缓存：${error.message}`);
  }
}

function salesForecastExportFileName() {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `销售预估全量-${stamp}.xlsx`;
}

function setSheetWidths(sheet, widths) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
}

function buildSalesForecastExportColumns(now = new Date()) {
  const monthIndex = now.getMonth();
  return [
    { key: "imageUrl", label: "图片", width: 44 },
    { key: "storeName", label: "店铺", width: 18 },
    { key: "country", label: "国家", width: 10 },
    { key: "productName", label: "产品名称", width: 36 },
    { key: "msku", label: "msku", width: 26 },
    { key: "fbaAvailable", label: "FBA可售", width: 12 },
    { key: "fbaTransfer", label: "FBA转库", width: 12 },
    { key: "fbaReserved", label: "FBA预留", width: 12 },
    { key: "awd", label: "AWD", width: 10 },
    { key: "fbaInbound", label: "FBA在途", width: 12 },
    { key: "totalStock", label: "总库存", width: 12 },
    { key: "salesForecast", label: "销量预测", width: 12 },
    { key: "peakSeasonForecast", label: "旺季预测", width: 12 },
    { key: "fbaAvailableDays", label: "FBA可售天数", width: 14 },
    { key: "inboundArrivalDate", label: "在途送达时间", width: 16 },
    { key: "outOfStockDate", label: "断货日期", width: 14 },
    { key: "shippingDate", label: "发货日期", width: 14 },
    { key: "purchaseDate", label: "采购日期", width: 14 },
    { key: "recommendedDaily", label: "日销建议", width: 12 },
    { key: "replenishmentSuggestion", label: "补货建议", width: 12 },
    ...Array.from({ length: 12 - monthIndex }, (_, offset) => {
      const index = monthIndex + offset;
      return [
        { key: `monthDaily${index}`, label: `${index + 1}月日销`, type: "monthDaily", monthIndex: index, width: 12 },
        { key: `monthSales${index}`, label: `${index + 1}月销量`, type: "monthSales", monthIndex: index, width: 12 },
      ];
    }).flat(),
    { key: "daysRemainingInMonth", label: "本月剩余天数", width: 14 },
    { key: "days3", label: "3天日均", type: "recentDaily", width: 12 },
    { key: "days7", label: "7天日均", type: "recentDaily", width: 12 },
    { key: "days14", label: "14天日均", type: "recentDaily", width: 12 },
    { key: "days30", label: "30天日均", type: "recentDaily", width: 12 },
    { key: "replenishmentEstimate", label: "补货预计", width: 12 },
    { key: "goodsValue", label: "货值统计", width: 14 },
  ];
}

function salesForecastExportValue(row = {}, column = {}) {
  if (column.type === "monthDaily") return row.monthlyDailySales?.[column.monthIndex] ?? 0;
  if (column.type === "monthSales") return row.monthlySales?.[column.monthIndex] ?? 0;
  if (column.type === "recentDaily") return row.recentDaily?.[column.key] ?? 0;
  return row[column.key] ?? "";
}

function buildSalesForecastExportScope(filters = {}) {
  const force = filters.force === true || filters.force === "1";
  return {
    dashboardFilters: force ? { force: true } : {},
    provisionFilters: { costMode: "landed" },
    ignoredFilters: {
      country: filters.country || "",
      store: filters.store || "",
      keyword: filters.keyword || "",
    },
  };
}

export async function exportSalesForecastEstimateXlsx(filters = {}) {
  const exportScope = buildSalesForecastExportScope(filters);
  const exportNow = new Date();
  const [data, provisionData] = await Promise.all([
    getSalesForecastDashboard(exportScope.dashboardFilters),
    getInventoryProvisionDashboard(exportScope.provisionFilters),
  ]);
  const costLookup = buildSalesForecastCostLookup(provisionData.detailRows || []);
  const exportRows = buildSalesForecastExportRows(data.rows || [], {
    manualRows: data.manualDaily || {},
    costLookup,
    now: exportNow,
  });
  const columns = buildSalesForecastExportColumns(exportNow);
  console.info("[sales-forecast-export] full export", {
    rowCount: exportRows.length,
    columnCount: columns.length,
    ignoredFilters: exportScope.ignoredFilters,
    force: Boolean(exportScope.dashboardFilters.force),
  });

  const module = await import("xlsx");
  const XLSX = module.default || module;
  const workbook = XLSX.utils.book_new();
  const headers = columns.map((column) => column.label);
  const rows = exportRows.map((row) => columns.map((column) => salesForecastExportValue(row, column)));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const lastColumn = XLSX.utils.encode_col(Math.max(0, headers.length - 1));
  sheet["!autofilter"] = { ref: `A1:${lastColumn}${Math.max(1, rows.length + 1)}` };
  setSheetWidths(sheet, columns.map((column) => column.width || 12));
  XLSX.utils.book_append_sheet(workbook, sheet, "销售预估全量");

  const metaRows = [
    ["导出范围", "销售预估数据表全量行、全量数据列导出，不受页面国家、店铺、关键词筛选影响"],
    ["导出列数", String(columns.length)],
    ["销售预估数据源", data.meta?.source || ""],
    ["销售预估同步状态", data.meta?.syncStatus || ""],
    ["成本取值", provisionData.meta?.costModeLabel || "采购成本 + 单位头程费用"],
    ["库存计提数据源", provisionData.meta?.source || ""],
    ["计算口径", "补货预计 = 旺季预测 - 总库存 - FBA在途；货值统计 = 补货预计 × (单位采购成本 + 单位头程费用)"],
    ["导出时间", nowText()],
  ];
  const metaSheet = XLSX.utils.aoa_to_sheet([["项目", "内容"], ...metaRows]);
  setSheetWidths(metaSheet, [18, 110]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "导出说明");

  return {
    filename: salesForecastExportFileName(),
    buffer: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }),
    rowCount: rows.length,
  };
}

export const salesForecastTestUtils = {
  normalizeAdviceRecord,
  applyPreviousYearMonthlySales,
  applyFbaInventoryDetails,
  buildSalesForecastCostLookup,
  buildSalesForecastExportColumns,
  buildSalesForecastExportRows,
  buildSalesForecastExportScope,
};

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/index.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { readLingxingSellersCache } from "../utils/cacheStore.js";
import { formatDate, getPacificTodayDate } from "../utils/pacificDate.js";
import { listFilterValues, matchesAnyFilter } from "../utils/filterUtils.js";

const historyFile = path.join(process.cwd(), "data-cache", "platform-cashflow-history.json");
const MAX_HISTORY = 120;
const CAPTURE_WEEKDAYS = new Set([2, 5]); // Tuesday, Friday

const currencySymbols = {
  CNY: "¥",
  USD: "$",
  CAD: "CA$",
  AUD: "A$",
  MXN: "Mex$",
  BRL: "R$",
};

const countryNames = {
  US: "美国",
  CA: "加拿大",
  AU: "澳洲",
  MX: "墨西哥",
  BR: "巴西",
};

let schedulerTimer = null;
let schedulerRunning = false;

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function dateText(date = new Date()) {
  return formatDate(date);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateText(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : dateText(date);
}

function addDaysToDateText(value, days) {
  const normalized = normalizeDateText(value);
  if (!normalized) return "";
  const parsed = parseDate(normalized);
  return parsed ? dateText(addDays(parsed, days)) : "";
}

function defaultRange() {
  const end = getPacificTodayDate();
  return {
    startDate: dateText(addDays(end, -29)),
    endDate: dateText(end),
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function firstValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function storeNameOf(record, sellerMap) {
  const sid = Number(record.sid || record.sellerId || record.seller_id || 0);
  const seller = sellerMap.get(sid) || {};
  return firstValue(record, ["storeName", "store_name", "sellerName", "seller_name"])
    || firstValue(seller, ["name", "seller_name", "shop_name", "store_name"])
    || String(sid || "-");
}

function countryOf(record, sellerMap) {
  const sid = Number(record.sid || 0);
  const seller = sellerMap.get(sid) || {};
  const code = String(firstValue(record, ["countryCode", "country_code"]) || firstValue(seller, ["countryCode", "country_code"])).toUpperCase();
  return firstValue(record, ["country", "countryName", "country_name"])
    || firstValue(seller, ["country", "countryName", "country_name"])
    || countryNames[code]
    || code
    || "";
}

function statusText(status) {
  const value = String(status || "");
  if (value === "Open") return "待结算";
  if (value === "Pending") return "结算中";
  if (value === "Closed") return "已结算";
  return value || "-";
}

function normalizeSettlementRecord(record, sellerMap, currencyMode = "CNY") {
  const transfer = record.transfer || {};
  const sale = record.sale || {};
  const refund = record.refund || {};
  const pay = record.pay || {};
  const currencyCode = currencyMode === "ORIGINAL"
    ? String(record.originalTotalCurrencyCode || record.currencyCode || "")
    : String(record.convertedTotalCurrencyCode || record.originalTotalCurrencyCode || "CNY");
  const symbol = record.convertCurrencyIcon || record.originCurrencyIcon || currencySymbols[currencyCode] || currencyCode || "¥";
  const standardAmount = currencyMode === "ORIGINAL"
    ? toNumber(transfer.originalTotalCurrencyAmount ?? record.originalTotalCurrencyAmount)
    : toNumber(transfer.convertedTotalCurrencyAmount ?? record.convertedTotalCurrencyAmount ?? record.originalTotalCurrencyAmount);
  const pendingAmount = currencyMode === "ORIGINAL"
    ? toNumber(record.originalTotalCurrencyAmount ?? transfer.originalTotalCurrencyAmount)
    : toNumber(record.convertedTotalCurrencyAmount ?? record.originalTotalCurrencyAmount ?? transfer.convertedTotalCurrencyAmount);
  const settlementStart = normalizeDateText(record.financialEventGroupStartLocale || record.financialEventGroupStart || "");
  const settlementEnd = normalizeDateText(record.financialEventGroupEndLocale || record.financialEventGroupEnd || "");
  const transferDate = normalizeDateText(record.fundTransferDateLocale || record.fundTransferDate || "");

  return {
    id: record.id || "",
    sid: Number(record.sid || 0),
    storeName: storeNameOf(record, sellerMap),
    country: countryOf(record, sellerMap),
    status: statusText(record.processingStatus),
    rawStatus: record.processingStatus || "",
    transferStatus: record.fundTransferStatus || "",
    currencyCode,
    symbol,
    pendingAmount: round(pendingAmount),
    delayedAmount: round(Math.abs(toNumber(transfer.currentReserveAmount ?? transfer.previousReserveAmount ?? 0))),
    standardAmount: round(standardAmount),
    income: round(sale.sale),
    refund: round(refund.refund),
    expense: round(pay.pay),
    settlementStart,
    settlementEnd,
    transferDate,
    estimatedTransferDate: addDaysToDateText(settlementStart, 14) || transferDate,
  };
}

async function readHistory() {
  try {
    const content = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

async function writeHistory(snapshots) {
  await mkdir(path.dirname(historyFile), { recursive: true });
  await writeFile(historyFile, JSON.stringify({ snapshots: snapshots.slice(-MAX_HISTORY) }, null, 2), "utf8");
}

async function getSellerList(adapter) {
  try {
    const payload = await adapter.fetchSellers();
    return filterCoreSellers(payload.data || []);
  } catch {
    const cached = await readLingxingSellersCache();
    return filterCoreSellers(cached.sellers || []);
  }
}

async function fetchAllSettlementRows(filters = {}) {
  const adapter = getLingxingAdapter();
  const sellers = await getSellerList(adapter);
  const activeSellers = sellers.filter((seller) => !seller.status || seller.status === 1);
  const sidList = uniqueNumbers(activeSellers.map((seller) => seller.sid));
  const sellerMap = new Map(activeSellers.map((seller) => [Number(seller.sid), seller]).filter(([sid]) => sid));
  const fallbackRange = defaultRange();
  const selectedDateType = String(filters.dateType || "0") === "estimatedTransferDate" ? "estimatedTransferDate" : "0";
  const requestedEndDate = normalizeDateText(filters.endDate || fallbackRange.endDate);
  const requestedStartDate = normalizeDateText(filters.startDate || fallbackRange.startDate);
  const queryStartDate = selectedDateType === "estimatedTransferDate"
    ? addDaysToDateText(requestedStartDate, -14) || requestedStartDate
    : requestedStartDate;
  const queryEndDate = selectedDateType === "estimatedTransferDate"
    ? addDaysToDateText(requestedEndDate, -14) || requestedEndDate
    : requestedEndDate;
  const endDateObject = parseDate(queryEndDate) || new Date();
  const maxStartDate = dateText(addDays(endDateObject, -89));
  const queryRange = {
    startDate: queryStartDate < maxStartDate ? maxStartDate : queryStartDate,
    endDate: queryEndDate,
  };
  const range = {
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  };
  const currencyMode = filters.currencyCode && filters.currencyCode !== "ORIGINAL" ? filters.currencyCode : "ORIGINAL";
  const requestBase = {
    dateType: "0",
    startDate: queryRange.startDate,
    endDate: queryRange.endDate,
    sids: sidList,
  };
  if (currencyMode !== "ORIGINAL") requestBase.currencyCode = currencyMode;

  const records = [];
  let total = 0;
  for (let offset = 0; offset < 1000; offset += 200) {
    const payload = await adapter.fetchSettlementSummary({ ...requestBase, offset, length: 200 });
    const list = adapter.normalizeRecordList(payload);
    total = Number(payload?.data?.total || list.length || total);
    records.push(...list);
    if (!list.length || records.length >= total || list.length < 200) break;
  }

  const optionRows = records
    .map((record) => normalizeSettlementRecord(record, sellerMap, currencyMode))
    .filter((row) => {
      if (selectedDateType !== "estimatedTransferDate") return true;
      const date = row.estimatedTransferDate || row.transferDate || "";
      return date >= range.startDate && date <= range.endDate;
    });
  const countryFilter = listFilterValues(filters.country);
  const storeFilter = listFilterValues(filters.storeName);
  const statusFilter = String(filters.status || "Open").trim();
  const rows = optionRows
    .filter((row) => matchesAnyFilter(row.country, countryFilter))
    .filter((row) => matchesAnyFilter(row.storeName, storeFilter))
    .filter((row) => !statusFilter || row.rawStatus === statusFilter || row.status === statusFilter);

  return { rows, optionRows, sellers: activeSellers, range, queryRange, currencyMode, rawCount: records.length, dateType: selectedDateType };
}

function aggregateRows(rows) {
  return rows.reduce((acc, row) => {
    acc.pendingAmount += row.pendingAmount;
    acc.delayedAmount += row.delayedAmount;
    acc.standardAmount += row.standardAmount;
    acc.income += row.income;
    acc.refund += row.refund;
    acc.expense += row.expense;
    return acc;
  }, {
    pendingAmount: 0,
    delayedAmount: 0,
    standardAmount: 0,
    income: 0,
    refund: 0,
    expense: 0,
  });
}

function groupByStore(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.storeName}|${row.currencyCode}`;
    const current = map.get(key) || {
      storeName: row.storeName,
      country: row.country,
      status: row.status,
      currencyCode: row.currencyCode,
      symbol: row.symbol,
      pendingAmount: 0,
      delayedAmount: 0,
      standardAmount: 0,
      income: 0,
      refund: 0,
      expense: 0,
      settlementStart: "",
      settlementEnd: "",
      transferDate: "",
      estimatedTransferDate: "",
      recordCount: 0,
    };
    current.pendingAmount += row.pendingAmount;
    current.delayedAmount += row.delayedAmount;
    current.standardAmount += row.standardAmount;
    current.income += row.income;
    current.refund += row.refund;
    current.expense += row.expense;
    current.recordCount += 1;
    current.settlementStart = earliestDateText(current.settlementStart, row.settlementStart);
    current.settlementEnd = row.settlementEnd || current.settlementEnd;
    current.transferDate = row.transferDate || current.transferDate;
    current.estimatedTransferDate = current.settlementStart ? addDaysToDateText(current.settlementStart, 14) : current.transferDate;
    map.set(key, current);
  });

  return [...map.values()]
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])))
    .sort((a, b) => Math.abs(b.pendingAmount) - Math.abs(a.pendingAmount));
}

function countryStoreFilters(rows = []) {
  return {
    countryOptions: [...new Set(rows.map((row) => row.country).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
      .map((name) => ({ name })),
    storeOptions: [...new Set(rows.map((row) => row.storeName).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
      .map((name) => {
        const match = rows.find((row) => row.storeName === name);
        return { name, country: match?.country || "" };
      }),
  };
}

function earliestDateText(current, candidate) {
  const currentText = normalizeDateText(current);
  const candidateText = normalizeDateText(candidate);
  if (!candidateText) return currentText;
  if (!currentText) return candidateText;
  return candidateText < currentText ? candidateText : currentText;
}

function historyTrend(snapshots) {
  return snapshots.slice(-16).map((snapshot) => ({
    date: snapshot.captureDate || "",
    pendingAmount: snapshot.kpis?.pendingAmount || 0,
    income: snapshot.kpis?.income || 0,
    expense: Math.abs(snapshot.kpis?.expense || 0),
    recordCount: snapshot.recordCount || 0,
  }));
}

function mockCashflowDashboard(filters = {}) {
  const range = defaultRange();
  const allRows = [
    { storeName: "xiamentanjia-US", country: "美国", status: "待结算", currencyCode: "CNY", symbol: "¥", pendingAmount: 24860, delayedAmount: 3210, standardAmount: 36080, income: 28420, refund: -1280, expense: -9320, settlementStart: range.startDate, transferDate: range.endDate, estimatedTransferDate: addDaysToDateText(range.startDate, 14) },
    { storeName: "xiamentanjia-CA", country: "加拿大", status: "待结算", currencyCode: "CNY", symbol: "¥", pendingAmount: 18640, delayedAmount: 2540, standardAmount: 29100, income: 23600, refund: -980, expense: -6940, settlementStart: range.startDate, transferDate: range.endDate, estimatedTransferDate: addDaysToDateText(range.startDate, 14) },
    { storeName: "tandanbo-US", country: "美国", status: "结算中", currencyCode: "CNY", symbol: "¥", pendingAmount: 5400, delayedAmount: 900, standardAmount: 8200, income: 6900, refund: -260, expense: -2150, settlementStart: range.startDate, transferDate: range.endDate, estimatedTransferDate: addDaysToDateText(range.startDate, 14) },
  ];
  const countryFilter = listFilterValues(filters.country);
  const storeFilter = listFilterValues(filters.storeName);
  const statusFilter = String(filters.status || "").trim();
  const rows = allRows
    .filter((row) => matchesAnyFilter(row.country, countryFilter))
    .filter((row) => matchesAnyFilter(row.storeName, storeFilter))
    .filter((row) => !statusFilter || row.status === statusText(statusFilter) || row.status === statusFilter);
  const kpis = aggregateRows(rows);
  const trend = [4, 3, 2, 1, 0].reverse().map((offset) => {
    const date = dateText(addDays(new Date(), -offset * 3));
    return { date, pendingAmount: 36000 + offset * 4200, income: 26000 + offset * 2600, expense: 9200 + offset * 900, recordCount: rows.length };
  });
  return {
    meta: {
      source: "模拟数据",
      syncStatus: "本地预览数据，部署后读取领星财务结算汇总",
      updatedAt: nowText(),
      periodText: `${range.startDate} 至 ${range.endDate}`,
      nextCaptureText: nextCaptureText(),
      currencyMode: "CNY",
      symbol: "¥",
    },
    kpis,
    storeCount: rows.length,
    recordCount: rows.length,
    filters: countryStoreFilters(allRows),
    storeRows: rows,
    history: [],
    trend,
  };
}

function nextCaptureText(baseDate = new Date()) {
  for (let add = 0; add <= 7; add += 1) {
    const candidate = addDays(baseDate, add);
    if (CAPTURE_WEEKDAYS.has(candidate.getDay())) {
      const label = candidate.getDay() === 2 ? "周二" : "周五";
      return `${dateText(candidate)} ${label}`;
    }
  }
  return "";
}

export async function getPlatformCashflowDashboard(filters = {}) {
  if (getConfig().dataProvider !== "lingxing") return mockCashflowDashboard(filters);

  const { rows, optionRows, sellers, range, queryRange, currencyMode, rawCount, dateType } = await fetchAllSettlementRows(filters);
  const storeRows = groupByStore(rows);
  const kpis = aggregateRows(rows);
  const history = await readHistory();
  const symbol = currencyMode === "ORIGINAL" ? "" : currencySymbols[currencyMode] || currencyMode;
  const dateTypeText = dateType === "estimatedTransferDate" ? "预计转账日" : "结算开始日";

  return {
    meta: {
      source: "领星财务 · 结算汇总",
      syncStatus: `已读取结算汇总 ${rawCount} 条，汇总店铺 ${storeRows.length} 个`,
      updatedAt: nowText(),
      periodText: `${range.startDate} 至 ${range.endDate}`,
      queryPeriodText: `${queryRange.startDate} 至 ${queryRange.endDate}`,
      dateType,
      dateTypeText,
      nextCaptureText: nextCaptureText(),
      currencyMode,
      symbol,
    },
    kpis: Object.fromEntries(Object.entries(kpis).map(([key, value]) => [key, round(value)])),
    storeCount: sellers.length,
    recordCount: rows.length,
    filters: countryStoreFilters(optionRows),
    storeRows,
    history: history.slice(-12).reverse(),
    trend: historyTrend(history),
  };
}

export async function runPlatformCashflowCapture(filters = {}) {
  if (getConfig().dataProvider !== "lingxing") {
    return { ok: true, message: "模拟环境已跳过真实留存", snapshot: mockCashflowDashboard(filters) };
  }

  const data = await getPlatformCashflowDashboard(filters);
  const snapshots = await readHistory();
  const captureDate = dateText();
  const snapshot = {
    id: `${captureDate}-${Date.now()}`,
    captureDate,
    capturedAt: nowText(),
    periodText: data.meta.periodText,
    currencyMode: data.meta.currencyMode,
    symbol: data.meta.symbol,
    kpis: data.kpis,
    recordCount: data.recordCount,
    storeRows: data.storeRows,
  };
  snapshots.push(snapshot);
  await writeHistory(snapshots);
  return { ok: true, message: "平台回款快照已留存", snapshot };
}

async function runScheduledCaptureIfNeeded() {
  if (getConfig().dataProvider !== "lingxing" || schedulerRunning) return;
  const today = getPacificTodayDate();
  if (!CAPTURE_WEEKDAYS.has(today.getDay())) return;

  schedulerRunning = true;
  try {
    const snapshots = await readHistory();
    if (snapshots.some((snapshot) => snapshot.captureDate === dateText(today))) return;
    await runPlatformCashflowCapture();
  } catch (error) {
    console.error("Platform cashflow scheduled capture failed:", error);
  } finally {
    schedulerRunning = false;
  }
}

export function startPlatformCashflowScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  runScheduledCaptureIfNeeded();
  schedulerTimer = setInterval(runScheduledCaptureIfNeeded, 60 * 60 * 1000);
}

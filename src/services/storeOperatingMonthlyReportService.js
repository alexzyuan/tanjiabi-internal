import { randomUUID } from "node:crypto";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getBudgetTargetContext as readBudgetTargetContext } from "./budgetTargetService.js";
import {
  buildStoreOperatingReportRows,
  mapStoreOperatingBudgetRowScope,
  mapStoreOperatingBudgetMetrics,
  mapStoreOperatingOrderProfitBudgetScope,
  mapStoreOperatingSellerScope,
  normalizeStoreOperatingCountryKey,
  readStoreOperatingBudgetCurrencyCode,
} from "./storeOperatingMonthlyReportMapper.js";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function uniqueText(values, label) {
  if (!Array.isArray(values)) throw reportInputError(`${label}必须是数组`);
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function reportInputError(message) {
  const error = new Error(message);
  error.name = "StoreOperatingMonthlyReportInputError";
  error.statusCode = 400;
  return error;
}

function monthIndex(month) {
  const [, year, monthNumber] = month.match(MONTH_PATTERN) || [];
  if (!year) return null;
  return Number(year) * 12 + Number(monthNumber) - 1;
}

function listInclusiveMonths(startMonth, endMonth) {
  const start = monthIndex(startMonth);
  const end = monthIndex(endMonth);
  if (start === null || end === null || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const index = start + offset;
    const year = Math.floor(index / 12);
    return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

function monthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function filterSellers(sellers, filters) {
  const stores = new Set(filters.stores);
  const countries = new Set(filters.countries.map(normalizeStoreOperatingCountryKey));
  return sellers.filter((seller) =>
    (!stores.size || stores.has(seller.name))
    && (!countries.size || countries.has(seller.country)),
  );
}

function generatedAt(now) {
  const value = typeof now === "function" ? now() : new Date();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function budgetScopeKey({ month, storeName, country }) {
  return [month, storeName, country].join("\u0000");
}

function buildLingxingRateMap(records) {
  const ratesByScope = new Map();
  records.forEach((record) => {
    const key = budgetScopeKey(mapStoreOperatingOrderProfitBudgetScope(record));
    if (!ratesByScope.has(key)) ratesByScope.set(key, new Set());
    const rate = Number(record.exchangeRate);
    if (Number.isFinite(rate) && rate > 0) ratesByScope.get(key).add(rate);
  });
  return new Map([...ratesByScope].map(([key, rates]) => [
    key,
    rates.size === 1 ? [...rates][0] : null,
  ]));
}

function hasBudgetMetrics(row) {
  return Object.keys(mapStoreOperatingBudgetMetrics(row)).length > 0;
}

function sumBudgetRows(rows, transform = (value) => value) {
  const mappedRows = rows.map((row) => mapStoreOperatingBudgetMetrics(row));
  const metricKeys = ["net-sales", "ad-spend", "refunds", "sales-profit"];
  return Object.fromEntries(metricKeys.flatMap((metric) => {
    const values = mappedRows.map((mapped, index) => {
      if (!Object.hasOwn(mapped, metric)) return null;
      return transform(mapped[metric], rows[index], metric);
    });
    if (!values.length || values.some((value) => value === null)) return [];
    return [[metric, values.reduce((sum, value) => sum + value, 0)]];
  }));
}

function buildCnyBudget(rows, records) {
  const rateByScope = buildLingxingRateMap(records);
  const missingRows = new Set();
  const budgetByMetric = sumBudgetRows(rows, (value, row) => {
    const rate = rateByScope.get(budgetScopeKey(mapStoreOperatingBudgetRowScope(row)));
    if (!rate) {
      if (hasBudgetMetrics(row)) missingRows.add(row);
      return null;
    }
    return value * rate;
  });
  return { budgetByMetric, missingExchangeRateCount: missingRows.size };
}

function originalBudgetByCurrency(rows, currencyCodes) {
  return new Map(currencyCodes.map((currencyCode) => {
    if (!currencyCode) return [currencyCode, {}];
    return [currencyCode, sumBudgetRows(rows.filter((row) => {
      const budgetCurrencyCode = readStoreOperatingBudgetCurrencyCode(row);
      return Boolean(budgetCurrencyCode) && budgetCurrencyCode === currencyCode;
    }))];
  }));
}

function budgetState({ matched, budgetRows, budgetByGroups, missingExchangeRateCount, currencyMode }) {
  if (!matched || !budgetRows.length) return "unconfigured";
  const configuredMetricCount = budgetByGroups.reduce(
    (count, budgetByMetric) => count + Object.keys(budgetByMetric).length,
    0,
  );
  if (missingExchangeRateCount > 0) return "partial";
  if (currencyMode === "ORIGINAL") {
    const unassignedCount = budgetRows.filter((row) => !readStoreOperatingBudgetCurrencyCode(row)).length;
    if (!configuredMetricCount) return "unavailable";
    const unmatchedGroupCount = budgetByGroups.filter((budgetByMetric) => !Object.keys(budgetByMetric).length).length;
    if (unassignedCount > 0 || unmatchedGroupCount > 0) return "partial";
  }
  return configuredMetricCount ? "configured" : "unavailable";
}

function buildEmptyResult(normalizedFilters, now) {
  return {
    ok: true,
    meta: {
      currencyMode: "ORIGINAL",
      currencyCodes: [],
      recordCount: 0,
      budgetMatchCount: 0,
      unavailableMetrics: [],
      missingExchangeRateCount: 0,
      generatedAt: generatedAt(now),
    },
    filters: normalizedFilters,
    rows: [],
    groups: [],
    budgetStatus: {
      state: "unconfigured",
      matched: false,
      matchCount: 0,
    },
  };
}

function writeLog(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[store-operating-monthly-report]", details);
}

function requireBudgetRows(budget) {
  if (!budget || typeof budget !== "object" || Array.isArray(budget) || !Array.isArray(budget.rows)) {
    throw new Error("预算上下文 rows 必须是数组");
  }
  return budget;
}

export function normalizeStoreOperatingMonthlyReportFilters({
  startMonth,
  endMonth,
  stores = [],
  countries = [],
} = {}) {
  if (!MONTH_PATTERN.test(startMonth || "") || !MONTH_PATTERN.test(endMonth || "")) {
    throw reportInputError("请选择开始月份和结束月份");
  }
  const months = listInclusiveMonths(startMonth, endMonth);
  if (!months.length) throw reportInputError("结束月份不能早于开始月份");
  if (months.length > 12) throw reportInputError("统计范围最多 12 个月");
  return {
    startMonth,
    endMonth,
    months,
    stores: uniqueText(stores, "stores"),
    countries: uniqueText(countries, "countries"),
  };
}

export async function getStoreOperatingMonthlyReport(filters, {
  adapter = getLingxingAdapter(),
  getBudgetTargetContext = readBudgetTargetContext,
  now,
  logger = console,
} = {}) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let normalizedFilters;
  try {
    normalizedFilters = normalizeStoreOperatingMonthlyReportFilters(filters);
    const sellerPayload = await adapter.fetchSellers();
    const sellers = filterSellers(adapter.normalizeRecordList(sellerPayload).map(mapStoreOperatingSellerScope), normalizedFilters);
    if (!sellers.length) {
      const empty = buildEmptyResult(normalizedFilters, now);
      writeLog(logger, "info", {
        requestId,
        range: `${normalizedFilters.startMonth}/${normalizedFilters.endMonth}`,
        storeFilterCount: normalizedFilters.stores.length,
        countryFilterCount: normalizedFilters.countries.length,
        effectiveCountryCount: 0,
        currencyMode: empty.meta.currencyMode,
        recordCount: 0,
        budgetMatchCount: 0,
        unavailableMetrics: [],
        missingExchangeRateCount: 0,
        elapsedMs: Date.now() - startedAt,
      });
      return empty;
    }
    const effectiveCountries = [...new Set(sellers.map((seller) => seller.country).filter(Boolean))];
    const currencyMode = effectiveCountries.length > 1 ? "CNY" : "ORIGINAL";
    const recordsByMonth = await Promise.all(normalizedFilters.months.map(async (month) => {
      const { startDate, endDate } = monthBounds(month);
      const payload = await adapter.fetchMskuOrderProfit({
        startDate,
        endDate,
        sids: sellers.map((seller) => seller.sid),
        currencyCode: currencyMode === "CNY" ? "CNY" : "ORIGINAL",
      });
      return adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(payload), sellers, endDate);
    }));
    const records = recordsByMonth.flat();
    const budget = await getBudgetTargetContext({
      months: normalizedFilters.months,
      storeNames: sellers.map((seller) => seller.name),
      countries: effectiveCountries,
    });
    const budgetRows = requireBudgetRows(budget).rows;
    const groupedRecords = currencyMode === "CNY"
      ? new Map([["CNY", records]])
      : new Map([...new Set(records.map((record) => String(record.currencyCode ?? "").trim()))]
        .sort((a, b) => a.localeCompare(b))
        .map((currencyCode) => [currencyCode, records.filter((record) => String(record.currencyCode ?? "").trim() === currencyCode)]));
    const currencyCodes = [...groupedRecords.keys()];
    const cnyBudget = currencyMode === "CNY"
      ? buildCnyBudget(budgetRows, records)
      : { budgetByMetric: {}, missingExchangeRateCount: 0 };
    const originalBudgets = currencyMode === "ORIGINAL"
      ? originalBudgetByCurrency(budgetRows, currencyCodes)
      : new Map();
    const budgetByGroups = currencyCodes.map((currencyCode) => currencyMode === "CNY"
      ? cnyBudget.budgetByMetric
      : originalBudgets.get(currencyCode) || {});
    const groups = [...groupedRecords].map(([currencyCode, groupRecords], index) => {
      const mapped = buildStoreOperatingReportRows({
        records: groupRecords,
        budgetByMetric: budgetByGroups[index],
        currencyCode,
      });
      return {
        currencyCode,
        currencyAvailable: Boolean(currencyCode),
        recordCount: groupRecords.length,
        rows: mapped.rows,
        unavailableMetrics: mapped.unavailableMetrics,
      };
    });
    const rows = currencyMode === "CNY" || groups.length === 1 ? groups[0]?.rows || [] : [];
    const unavailableMetrics = [...new Set(groups.flatMap((group) => group.unavailableMetrics))];
    const state = budgetState({
      matched: Boolean(budget?.matched),
      budgetRows,
      budgetByGroups,
      missingExchangeRateCount: cnyBudget.missingExchangeRateCount,
      currencyMode,
    });
    const result = {
      ok: true,
      meta: {
        currencyMode,
        currencyCodes,
        recordCount: records.length,
        budgetMatchCount: budgetRows.length,
        unavailableMetrics,
        missingExchangeRateCount: cnyBudget.missingExchangeRateCount,
        generatedAt: generatedAt(now),
      },
      filters: normalizedFilters,
      rows,
      groups,
      budgetStatus: {
        state,
        matched: Boolean(budget?.matched),
        matchCount: budgetRows.length,
      },
    };
    writeLog(logger, "info", {
      requestId,
      range: `${normalizedFilters.startMonth}/${normalizedFilters.endMonth}`,
      storeFilterCount: normalizedFilters.stores.length,
      countryFilterCount: normalizedFilters.countries.length,
      effectiveCountryCount: effectiveCountries.length,
      currencyMode,
      recordCount: records.length,
      budgetMatchCount: budgetRows.length,
      unavailableMetrics,
      missingExchangeRateCount: cnyBudget.missingExchangeRateCount,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    writeLog(logger, "error", {
      requestId,
      range: normalizedFilters ? `${normalizedFilters.startMonth}/${normalizedFilters.endMonth}` : "invalid",
      errorName: error?.name || "Error",
      errorMessage: error?.message || String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function requireStoreOperatingMonthlyReportExportResult(report) {
  if (!report || typeof report !== "object" || Array.isArray(report) || !Array.isArray(report.groups)) {
    throw new Error("店铺经营月报导出数据缺少 groups 数组");
  }
  if (!report.filters || typeof report.filters !== "object" || Array.isArray(report.filters)) {
    throw new Error("店铺经营月报导出数据缺少 filters 对象");
  }
  if (!MONTH_PATTERN.test(report.filters.startMonth || "") || !MONTH_PATTERN.test(report.filters.endMonth || "")) {
    throw new Error("店铺经营月报导出数据缺少有效月份范围");
  }
  return report;
}

function exportCell(value) {
  return value === null || value === undefined ? "—" : value;
}

function storeOperatingMonthlyReportExportRows(report) {
  return report.groups.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group) || typeof group.currencyCode !== "string" || !Array.isArray(group.rows)) {
      throw new Error("店铺经营月报导出分组缺少 rows 数组");
    }
    return group.rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || typeof row.category !== "string" || typeof row.name !== "string"
        || typeof row.available !== "boolean") {
        throw new Error("店铺经营月报导出行缺少必要字段");
      }
      return [
        group.currencyCode,
        row.category,
        row.name,
        exportCell(row.actual),
        exportCell(row.budget),
        exportCell(row.share),
        exportCell(row.achievement),
        row.available ? "是" : "否",
      ];
    });
  });
}

export async function exportStoreOperatingMonthlyReportXlsx(filters = {}, {
  getStoreOperatingMonthlyReport: loadReport = getStoreOperatingMonthlyReport,
} = {}) {
  const report = requireStoreOperatingMonthlyReportExportResult(await loadReport(filters));
  const module = await import("xlsx");
  const XLSX = module.default || module;
  const workbook = XLSX.utils.book_new();
  const headers = ["币种", "分类", "科目", "实际值", "预算值", "占比", "达成率", "数据可用"];
  const rows = storeOperatingMonthlyReportExportRows(report);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const lastColumn = XLSX.utils.encode_col(headers.length - 1);
  sheet["!autofilter"] = { ref: `A1:${lastColumn}${Math.max(1, rows.length + 1)}` };
  sheet["!cols"] = [10, 18, 24, 16, 16, 12, 12, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "店铺经营月报");
  const metadataRows = [
    ["项目", "值"],
    ["开始月份", report.filters.startMonth],
    ["结束月份", report.filters.endMonth],
    ["店铺范围", report.filters.stores?.length ? report.filters.stores.join("、") : "全部店铺"],
    ["国家范围", report.filters.countries?.length ? report.filters.countries.join("、") : "全部国家"],
    ["币种模式", report.meta?.currencyMode === "CNY" ? "人民币汇总" : "原币分币种"],
    ["币种", Array.isArray(report.meta?.currencyCodes) ? report.meta.currencyCodes.join("、") : ""],
    ["生成时间", report.meta?.generatedAt || ""],
    ["预算状态", report.budgetStatus?.state || "unconfigured"],
    ["预算匹配数", report.budgetStatus?.matchCount ?? 0],
  ];
  const metadataSheet = XLSX.utils.aoa_to_sheet(metadataRows);
  metadataSheet["!cols"] = [{ wch: 16 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, metadataSheet, "报表说明");

  return {
    filename: `店铺经营月报-${report.filters.startMonth}至${report.filters.endMonth}.xlsx`,
    buffer: XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }),
    rowCount: rows.length,
  };
}

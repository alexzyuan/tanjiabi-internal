import { randomUUID } from "node:crypto";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getBudgetTargetContext as readBudgetTargetContext } from "./budgetTargetService.js";
import {
  buildStoreOperatingReportRows,
  mapStoreOperatingBudgetRowScope,
  mapStoreOperatingBudgetMetrics,
  mapStoreOperatingOrderProfitBudgetScope,
  mapStoreOperatingSellerScope,
  mergeStoreOperatingCustomFeeRecords,
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

function monthDayCount(month) {
  const [, year, monthNumber] = month.match(MONTH_PATTERN) || [];
  return year ? new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate() : 0;
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

function filterBudgetRowsForScope(rows, scope) {
  const storeNames = new Set(scope.storeNames);
  const countries = new Set(scope.countries);
  return rows.filter((row) => {
    const storeName = String(row?.storeName || row?.store_name || "").trim();
    const country = normalizeStoreOperatingCountryKey(row?.site || row?.country || row?.countryName || "");
    return storeNames.has(storeName) && (!country || countries.has(country));
  });
}

function buildReportScopes(sellers, normalizedFilters) {
  if (normalizedFilters.stores.length) {
    return sellers.map((seller) => ({
      storeName: seller.name,
      storeNames: [seller.name],
      sellers: [seller],
      countries: seller.country ? [seller.country] : [],
    }));
  }
  return [{
    storeName: "全部店铺",
    storeNames: sellers.map((seller) => seller.name),
    sellers,
    countries: [...new Set(sellers.map((seller) => seller.country).filter(Boolean))],
  }];
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
      currencyMode: normalizedFilters.currencyCode,
      currencyCodes: [],
      recordCount: 0,
      budgetMatchCount: 0,
      source: "/bd/profit/report/open/report/seller/list",
      customFeeSource: "/bd/fee/management/open/feeManagement/otherFee/list",
      customFeeRecordCount: 0,
      unmappedCustomFeeCount: 0,
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
  currencyCode = "CNY",
} = {}) {
  if (!MONTH_PATTERN.test(startMonth || "") || !MONTH_PATTERN.test(endMonth || "")) {
    throw reportInputError("请选择开始月份和结束月份");
  }
  const months = listInclusiveMonths(startMonth, endMonth);
  if (!months.length) throw reportInputError("结束月份不能早于开始月份");
  if (months.length > 12) throw reportInputError("统计范围最多 12 个月");
  const normalizedCurrencyCode = String(currencyCode || "CNY").trim().toUpperCase();
  if (!["CNY", "ORIGINAL"].includes(normalizedCurrencyCode)) {
    throw reportInputError("币种必须是 CNY 或 ORIGINAL");
  }
  return {
    startMonth,
    endMonth,
    months,
    stores: uniqueText(stores, "stores"),
    countries: uniqueText(countries, "countries"),
    currencyCode: normalizedCurrencyCode,
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
    const currencyMode = normalizedFilters.currencyCode;
    if (currencyMode === "ORIGINAL" && effectiveCountries.length > 1) {
      throw reportInputError("跨国家只能使用人民币，请将币种切换为 CNY");
    }
    const reportScopes = buildReportScopes(sellers, normalizedFilters);
    const recordsByMonthResults = [];
    for (const month of normalizedFilters.months) {
      const { startDate, endDate } = monthBounds(month);
      const request = {
        // 店铺利润月度接口只接受 yyyy-MM；不要把月筛选展开成日范围。
        startDate: month,
        endDate: month,
        monthlyQuery: true,
        summaryEnabled: true,
        sids: sellers.map((seller) => seller.sid),
        currencyCode: currencyMode === "CNY" ? "CNY" : "ORIGINAL",
      };
      const sellerResult = typeof adapter.fetchSellerProfitReportCached === "function"
        ? await adapter.fetchSellerProfitReportCached({ ...request, sellerList: sellers, reportDate: month })
        : await adapter.fetchSellerProfitReport(request);
      const sellerRecords = sellerResult?.records || adapter.normalizeRecordList(sellerResult);
      const normalizedSellerRecords = typeof adapter.normalizeSellerProfitRecords === "function"
        ? adapter.normalizeSellerProfitRecords(sellerRecords, sellers, month)
        : sellerRecords.map((record) => {
          const seller = sellers.find((candidate) => Number(candidate.sid) === Number(record.sid || record.seller_id || record.sellerId));
          return {
            ...record,
            sid: Number(record.sid || record.seller_id || record.sellerId || seller?.sid || 0),
            storeName: record.storeName || record.store_name || seller?.name || "",
            country: record.country || record.country_name || seller?.country || "",
            currencyCode: record.currencyCode || record.currency_code || "",
            reportDate: record.reportDate || month,
          };
        });
      const feePayload = await adapter.fetchOtherFeeList({
        date_type: "date",
        start_date: startDate,
        end_date: endDate,
        sids: sellers.map((seller) => seller.sid),
        dimensions: [3],
        currency_code: currencyMode === "CNY" ? "CNY" : "ORIGINAL",
      });
      const feeRecords = adapter.normalizeRecordList(feePayload);
      const mergedFees = mergeStoreOperatingCustomFeeRecords(normalizedSellerRecords, feeRecords, sellers);
      const result = {
        month,
        records: mergedFees.records,
        customFeeRecordCount: feeRecords.length,
        unmappedCustomFeeRecords: mergedFees.unmapped,
        cacheState: sellerResult?.cacheState || "unsupported",
        cacheUpdatedAt: sellerResult?.cacheUpdatedAt || "",
      };
      recordsByMonthResults.push(result);
    }
    const recordsByMonth = recordsByMonthResults.map((result) => result.records);
    const cacheStates = Object.fromEntries(recordsByMonthResults.map((result) => [result.month, result.cacheState]));
    const records = recordsByMonth.flat();
    const customFeeRecordCount = recordsByMonthResults.reduce((sum, result) => sum + result.customFeeRecordCount, 0);
    const unmappedCustomFeeRecords = recordsByMonthResults.flatMap((result) => result.unmappedCustomFeeRecords || []);
    const budget = await getBudgetTargetContext({
      months: normalizedFilters.months,
      storeNames: sellers.map((seller) => seller.name),
      countries: effectiveCountries,
    });
    const budgetRows = requireBudgetRows(budget).rows;
    const groups = [];
    let missingExchangeRateCount = 0;
    reportScopes.forEach((scope) => {
      const scopeSidSet = new Set(scope.sellers.map((seller) => Number(seller.sid)));
      const scopeRecords = records.filter((record) => scopeSidSet.has(Number(record.sid)));
      const scopeBudgetRows = filterBudgetRowsForScope(budgetRows, scope);
      const groupedRecords = currencyMode === "CNY"
        ? new Map([["CNY", scopeRecords]])
        : new Map([...new Set(scopeRecords.map((record) => String(record.currencyCode ?? "").trim()))]
          .sort((a, b) => a.localeCompare(b))
          .map((currencyCode) => [currencyCode, scopeRecords.filter((record) => String(record.currencyCode ?? "").trim() === currencyCode)]));
      if (!groupedRecords.size) groupedRecords.set("", []);
      const currencyCodes = [...groupedRecords.keys()];
      const cnyBudget = currencyMode === "CNY"
        ? buildCnyBudget(scopeBudgetRows, scopeRecords)
        : { budgetByMetric: {}, missingExchangeRateCount: 0 };
      missingExchangeRateCount += cnyBudget.missingExchangeRateCount;
      const originalBudgets = currencyMode === "ORIGINAL"
        ? originalBudgetByCurrency(scopeBudgetRows, currencyCodes)
        : new Map();
      [...groupedRecords].forEach(([currencyCode, groupRecords]) => {
        const budgetByMetric = currencyMode === "CNY"
          ? cnyBudget.budgetByMetric
          : originalBudgets.get(currencyCode) || {};
        const mapped = buildStoreOperatingReportRows({
          records: groupRecords,
          budgetByMetric,
          currencyCode,
          storeName: scope.storeName,
          country: scope.countries.length === 1 ? scope.countries[0] : "全部国家",
          periodDays: normalizedFilters.months.reduce((sum, month) => sum + monthDayCount(month), 0),
        });
        groups.push({
          storeName: scope.storeName,
          storeScope: scope.storeNames,
          currencyCode,
          currencyAvailable: Boolean(currencyCode),
          recordCount: groupRecords.length,
          rows: mapped.rows,
          unavailableMetrics: mapped.unavailableMetrics,
          unavailableMetricDetails: mapped.unavailableMetricDetails,
        });
      });
    });
    const currencyCodes = [...new Set(groups.map((group) => group.currencyCode))];
    const rows = currencyMode === "CNY" || groups.length === 1 ? groups[0]?.rows || [] : [];
    const unavailableMetrics = [...new Set(groups.flatMap((group) => group.unavailableMetrics))];
    const unavailableMetricDetails = [...new Map(
      groups.flatMap((group) => group.unavailableMetricDetails || []).map((detail) => [detail.key, detail]),
    ).values()];
    const state = budgetState({
      matched: Boolean(budget?.matched),
      budgetRows,
      budgetByGroups: groups.map((group) => group.rows.reduce((acc, row) => {
        if (row.key === "net-sales" && row.budget !== null) acc["net-sales"] = row.budget;
        if (row.key === "ad-spend" && row.budget !== null) acc["ad-spend"] = row.budget;
        if (row.key === "refunds" && row.budget !== null) acc.refunds = row.budget;
        if ((row.key === "sales-profit" || row.key === "profit") && row.budget !== null) acc["sales-profit"] = row.budget;
        return acc;
      }, {})),
      missingExchangeRateCount,
      currencyMode,
    });
    const result = {
      ok: true,
      meta: {
        currencyMode,
        source: "/bd/profit/report/open/report/seller/list",
        customFeeSource: "/bd/fee/management/open/feeManagement/otherFee/list",
        currencyCodes,
        recordCount: records.length,
        customFeeRecordCount,
        unmappedCustomFeeCount: unmappedCustomFeeRecords.length,
        unmappedCustomFeeRecords,
        budgetMatchCount: budgetRows.length,
        unavailableMetrics,
        unavailableMetricNames: unavailableMetricDetails.map((detail) => detail.name),
        unavailableMetricDetails,
        missingExchangeRateCount,
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
      groupCount: groups.length,
      budgetMatchCount: budgetRows.length,
      unavailableMetrics,
      unavailableMetricDetails,
      missingExchangeRateCount,
      cacheStates,
      customFeeRecordCount,
      unmappedCustomFeeCount: unmappedCustomFeeRecords.length,
      unmappedCustomFeeRecords,
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

function exportGroupLabel(group) {
  const storeName = String(group.storeName || "全部店铺").trim() || "全部店铺";
  const currency = group.currencyAvailable === false ? "币种不可用" : String(group.currencyCode || "币种不可用").trim();
  return `${storeName} · ${currency}`;
}

function storeOperatingMonthlyReportExportLayout(report) {
  const groups = report.groups.map((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group) || typeof group.currencyCode !== "string" || !Array.isArray(group.rows)) {
      throw new Error("店铺经营月报导出分组缺少 rows 数组");
    }
    const rowMap = new Map(group.rows.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || typeof row.category !== "string" || typeof row.name !== "string"
        || typeof row.available !== "boolean") {
        throw new Error("店铺经营月报导出行缺少必要字段");
      }
      const key = String(row.key || `${row.category}\u0000${row.name}\u0000${index}`);
      return [key, row];
    }));
    return { ...group, rowMap, label: exportGroupLabel(group) };
  });
  const baseRows = groups[0]?.rows || [];
  const rows = baseRows.map((baseRow, index) => {
    const key = String(baseRow.key || `${baseRow.category}\u0000${baseRow.name}\u0000${index}`);
    return [
      baseRow.category,
      baseRow.name,
      ...groups.flatMap((group) => {
        const row = group.rowMap.get(key);
        return [
          exportCell(row?.actual),
          exportCell(row?.share),
          exportCell(row?.budget),
          exportCell(row?.achievement),
        ];
      }),
    ];
  });
  const headerTop = ["上级", "名称", ...groups.flatMap((group) => [group.label, "", "", ""] )];
  const headerBottom = ["", "", ...groups.flatMap(() => ["实际完成值", "占比", "预算值", "达成率"] )];
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
    ...groups.map((_group, index) => ({
      s: { r: 0, c: 2 + index * 4 },
      e: { r: 0, c: 5 + index * 4 },
    })),
  ];
  return {
    groups,
    headers: [headerTop, headerBottom],
    rows,
    merges,
  };
}

export async function exportStoreOperatingMonthlyReportXlsx(filters = {}, {
  getStoreOperatingMonthlyReport: loadReport = getStoreOperatingMonthlyReport,
} = {}) {
  const report = requireStoreOperatingMonthlyReportExportResult(await loadReport(filters));
  const module = await import("xlsx");
  const XLSX = module.default || module;
  const workbook = XLSX.utils.book_new();
  const layout = storeOperatingMonthlyReportExportLayout(report);
  const rows = layout.rows;
  const columnCount = layout.headers[0].length;
  const lastColumn = XLSX.utils.encode_col(columnCount - 1);
  const sheet = XLSX.utils.aoa_to_sheet([...layout.headers, ...rows]);
  sheet["!merges"] = layout.merges;
  sheet["!autofilter"] = { ref: `A2:${lastColumn}${Math.max(2, rows.length + 2)}` };
  sheet["!cols"] = [
    { wch: 18 },
    { wch: 24 },
    ...layout.groups.flatMap(() => [16, 12, 16, 12].map((wch) => ({ wch }))),
  ];
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
    ["缺少汇率条数", report.meta?.missingExchangeRateCount ?? 0],
    ["不可用科目", Array.isArray(report.meta?.unavailableMetricNames)
      ? report.meta.unavailableMetricNames.join("、")
      : (Array.isArray(report.meta?.unavailableMetrics) ? report.meta.unavailableMetrics.join("、") : "")],
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

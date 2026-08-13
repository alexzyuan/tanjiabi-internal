import { mockDashboard } from "../data/mockDashboard.js";
import { getConfig } from "../config/index.js";
import { getSyncState } from "./syncService.js";
import {
  readMskuDetailCache,
  saveMskuDetailCache,
} from "../utils/cacheStore.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { buildBudgetMskuDetailRows, mapLingxingToSalesDashboard, SALES_WEEKLY_MAPPER_VERSION } from "./lingxingDashboardMapper.js";
import { getDefaultWeekRange } from "../utils/dateRange.js";
import { validateSalesWeeklySourceCache } from "./salesWeeklySourceCache.js";
import { getBudgetTargetContext } from "./budgetTargetService.js";
import {
  fetchListingOwnerRows,
  listingOwnerRowsFromRecords,
  ownerLookupRowsFromBudgetTargets,
  ownerLookupRowsFromRecords,
} from "./listingOwnerService.js";
import { getSharedSellers } from "./sharedDataService.js";
import { getSalesForecastAvailableDaysBySellerMsku } from "./salesForecastService.js";
import { normalizeSalesFactsScope, addSalesFactsDateDays, SalesFactsInputError } from "./salesFactsIdentity.js";
import { getSalesFacts } from "./salesFactsQueryService.js";
import { getOrBuildSalesDerived } from "./salesDerivedCacheService.js";

function nowMs() { return Date.now(); }

function normalizedCurrencyCode(filters = {}) {
  return String(filters.currencyCode || "CNY").trim().toUpperCase() || "CNY";
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

export { validateSalesWeeklySourceCache };

export function validateSalesWeeklyDashboardCache(dashboard) {
  const detailRows = dashboard?.detailRows;
  if (!Array.isArray(detailRows)) return { ok: false, reasons: ["detailRows must be an array"] };
  const missingRefundRate30d = detailRows.filter(
    (row) => !row || !Object.prototype.hasOwnProperty.call(row, "refundRate30d"),
  ).length;
  if (missingRefundRate30d > 0) {
    return { ok: false, reasons: [`${missingRefundRate30d} detail rows are missing refundRate30d`] };
  }
  const missingFbaAvailableDays = detailRows.filter(
    (row) => !row || !Object.prototype.hasOwnProperty.call(row, "fbaAvailableDays"),
  ).length;
  if (missingFbaAvailableDays > 0) {
    return { ok: false, reasons: [`${missingFbaAvailableDays} detail rows are missing fbaAvailableDays`] };
  }
  return { ok: true, reasons: [] };
}

function salesReviewAvailableDaysKey(sid, msku) {
  const sellerId = Number(sid);
  const normalizedMsku = String(msku || "").trim().toLowerCase();
  return Number.isFinite(sellerId) && sellerId > 0 && normalizedMsku ? `${sellerId}|${normalizedMsku}` : "";
}

export async function enrichSalesReviewAvailableDays(dashboard, {
  getAvailableDays = getSalesForecastAvailableDaysBySellerMsku,
} = {}) {
  const detailRows = dashboard?.detailRows;
  if (!Array.isArray(detailRows)) throw new Error("销售复盘明细缺少 detailRows 数组，无法补齐可售天数");

  let availableDaysIndex;
  try {
    availableDaysIndex = await getAvailableDays();
  } catch (error) {
    console.error("[sales-review-available-days] cache read failed", {
      detailRowCount: detailRows.length,
      error: error.message,
    });
    throw error;
  }

  let matchedCount = 0;
  const nextDetailRows = detailRows.map((row) => {
    const key = salesReviewAvailableDaysKey(row?.sid, row?.msku);
    const value = key ? availableDaysIndex.map.get(key) : undefined;
    if (value !== undefined) matchedCount += 1;
    return {
      ...row,
      fbaAvailableDays: value ?? null,
    };
  });

  return {
    ...dashboard,
    detailRows: nextDetailRows,
    meta: {
      ...(dashboard.meta || {}),
      availableDays: {
        source: "sales-forecast-cache",
        updatedAt: availableDaysIndex.updatedAt,
        matchedCount,
        missingCount: nextDetailRows.length - matchedCount,
        cacheHit: availableDaysIndex.cacheHit,
      },
    },
  };
}

function salesListingOwnerLookupRows(records = [], budgetTargets = {}, sellers = []) {
  return [
    ...ownerLookupRowsFromRecords(records),
    ...ownerLookupRowsFromBudgetTargets(budgetTargets, sellers),
  ];
}

async function fetchSalesListingOwnerRows(adapter, records = [], budgetTargets = {}, sellers = []) {
  const directOwnerRows = listingOwnerRowsFromRecords(records);
  const lookupRows = salesListingOwnerLookupRows(records, budgetTargets, sellers);
  try {
    const fetchedOwnerRows = await fetchListingOwnerRows(adapter, lookupRows);
    return [...directOwnerRows, ...fetchedOwnerRows];
  } catch (error) {
    console.error("[sales-weekly] listing owner lookup failed", {
      recordCount: records.length,
      directOwnerRecordCount: directOwnerRows.length,
      lookupRowCount: lookupRows.length,
      error: error.message,
    });
    return directOwnerRows;
  }
}

function activeSeller(seller = {}) {
  if (seller.status === undefined || seller.status === null || seller.status === "") return true;
  if (Number(seller.status) === 1) return true;
  return ["active", "enabled", "正常", "启用"].includes(String(seller.status).trim().toLocaleLowerCase("en-US"));
}

function salesFactsSellerId(seller = {}) {
  return Number(seller.sid || seller.seller_id || seller.sellerId || seller.id);
}

async function resolveWeeklySellerDirectory(salesFacts = {}) {
  if (Array.isArray(salesFacts.sellerDirectory)) return salesFacts.sellerDirectory;
  if (typeof salesFacts.getSellerDirectory === "function") {
    const value = await salesFacts.getSellerDirectory();
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.sellers)) return value.sellers;
  }
  const result = await getSharedSellers({ adapter: getLingxingAdapter() });
  if (Array.isArray(result?.sellers)) return result.sellers;
  throw new SalesFactsInputError("销售周报缺少可信 seller directory。", { code: "SALES_FACTS_WEEKLY_SELLER_DIRECTORY_INVALID" });
}

function subtractSalesFactsDays(value, days) {
  return addSalesFactsDateDays(value, -days);
}

function weeklyScopes(filters, sellers, now) {
  const defaultRange = getDefaultWeekRange(getConfig().dashboard);
  const startDate = filters.startDate || defaultRange.startDate;
  const endDate = filters.endDate || defaultRange.endDate;
  const sids = Array.isArray(filters.sids) && filters.sids.length
    ? uniqueNumbers(filters.sids)
    : sellers.filter(activeSeller).map(salesFactsSellerId).filter((sid) => Number.isInteger(sid) && sid > 0);
  const currencyMode = normalizedCurrencyCode(filters);
  const requested = normalizeSalesFactsScope({ startDate, endDate, sids, currencyMode, sellerDirectory: sellers, now: new Date(now()) });
  const recentStartDate = subtractSalesFactsDays(requested.endDate, 29);
  const factsStartDate = recentStartDate < requested.startDate ? recentStartDate : requested.startDate;
  const facts = normalizeSalesFactsScope({ startDate: factsStartDate, endDate: requested.endDate, sids: requested.sids, currencyMode, sellerDirectory: sellers, now: new Date(now()) });
  return { requested, facts, recentStartDate };
}

function mapSalesFactToDashboardRecord(fact, sellerBySid) {
  const sid = Number(fact.sid);
  const seller = sellerBySid.get(sid) || {};
  const storeName = seller.displayName || seller.name || seller.storeName || String(sid);
  const country = seller.country || seller.countryCode || "";
  const countryCode = seller.countryCode || seller.country || "";
  return {
    ...(fact.metrics || {}),
    factDate: fact.factDate,
    reportDate: fact.factDate,
    date: fact.factDate,
    sid,
    msku: fact.msku,
    mskuKey: fact.mskuKey,
    storeName,
    country,
    countryCode,
    currencyCode: fact.actualCurrencyCode || fact.currencyMode,
    listingOwner: fact.listingOwner || "",
    listingOwnerStatus: fact.listingOwnerStatus || "historical-unknown",
  };
}

function ownerRowsFromFactRecords(records = []) {
  const seen = new Set();
  return records.map((record) => ({
    sid: Number(record.sid),
    msku: record.msku,
    country: record.country,
    countryCode: record.countryCode,
    storeName: record.storeName,
    listingOwner: record.listingOwner || "-",
  })).filter((row) => {
    const key = `${row.sid}|${String(row.msku).toLowerCase()}|${row.listingOwner}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDateWithin(value, startDate, endDate) {
  return String(value) >= startDate && String(value) <= endDate;
}

export { SALES_WEEKLY_MAPPER_VERSION };

export async function getSalesWeeklyDashboard(filters = {}, options = {}) {
  const salesFacts = options.salesFacts || {};
  const now = typeof salesFacts.now === "function" ? salesFacts.now : Date.now;
  const sellers = await resolveWeeklySellerDirectory(salesFacts);
  const { requested, facts: factsScope, recentStartDate } = weeklyScopes(filters, sellers, now);
  const requestId = salesFacts.requestId || options.requestId || "sales-weekly";
  const getFacts = salesFacts.getSalesFacts || getSalesFacts;
  const getDerived = salesFacts.getOrBuildSalesDerived || getOrBuildSalesDerived;
  const factsResult = await getFacts(factsScope, {
    repository: salesFacts.repository,
    sellerDirectory: sellers,
    getSellerDirectory: salesFacts.getSellerDirectory,
    refreshOrderProfitScope: salesFacts.refreshOrderProfitScope,
    forceRefresh: salesFacts.forceRefresh === true,
    requestId,
    now,
    logger: salesFacts.logger || console,
  });
  const sellerBySid = new Map(sellers.map((seller) => [salesFactsSellerId(seller), seller]));
  const derivedResult = await getDerived({
    scope: factsScope,
    mapperVersion: salesFacts.mapperVersion || SALES_WEEKLY_MAPPER_VERSION,
    repository: salesFacts.repository,
    requestId,
    now,
    logger: salesFacts.logger || console,
    build: async () => {
      const rows = (factsResult.records || []).map((fact) => mapSalesFactToDashboardRecord(fact, sellerBySid));
      return {
        rows,
        recent30: rows.filter((row) => isDateWithin(row.factDate, recentStartDate, requested.endDate)),
        startDate: requested.startDate,
        endDate: requested.endDate,
        currencyMode: requested.currencyMode,
      };
    },
  });
  const payload = derivedResult?.payload;
  if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.recent30)) {
    throw new SalesFactsInputError("销售周报派生缓存 payload 无效。", { code: "SALES_FACTS_WEEKLY_DERIVED_PAYLOAD_INVALID" });
  }
  const budgetTargetReader = options.getBudgetTargetContext || getBudgetTargetContext;
  const budgetTargets = await budgetTargetReader({ startDate: requested.startDate, endDate: requested.endDate });
  const selectedRows = payload.rows.filter((row) => isDateWithin(row.factDate, requested.startDate, requested.endDate));
  const listingOwnerRows = ownerRowsFromFactRecords(selectedRows);
  const dashboard = mapLingxingToSalesDashboard({
    sellers,
    orderProfitRecords: selectedRows,
    recent30OrderProfitRecords: payload.recent30,
    dailyProfitRecords: selectedRows,
    inventoryRecords: [],
    listingOwnerRows,
    filters: {
      ...filters,
      startDate: requested.startDate,
      endDate: requested.endDate,
      currencyCode: requested.currencyMode,
    },
    range: { startDate: requested.startDate, endDate: requested.endDate },
    currencyCode: requested.currencyMode,
    raw: {
      cacheState: factsResult.meta?.cacheState || "hit",
      cacheUpdatedAt: factsResult.meta?.updatedAt || "",
      recent30: {
        startDate: recentStartDate,
        endDate: requested.endDate,
        cacheState: factsResult.meta?.cacheState || "hit",
        cacheUpdatedAt: factsResult.meta?.updatedAt || "",
        recordCount: payload.recent30.length,
      },
    },
    budgetTargets,
  });
  const enriched = await enrichSalesReviewAvailableDays(dashboard, {
    getAvailableDays: salesFacts.getAvailableDays || options.getAvailableDays || getSalesForecastAvailableDaysBySellerMsku,
  });
  const factsMeta = factsResult.meta || {};
  const derivedMeta = derivedResult.meta || {};
  return {
    ...enriched,
    cacheHit: factsMeta.cacheState === "hit" && derivedMeta.cacheState === "hit",
    meta: {
      ...(enriched.meta || {}),
      source: "sales-facts-sqlite",
      cacheState: factsMeta.cacheState || "hit",
      derivedCacheState: derivedMeta.cacheState || "hit",
      updatedAt: factsMeta.updatedAt || derivedMeta.updatedAt || null,
      ageSeconds: Number.isFinite(Number(factsMeta.ageSeconds)) ? Number(factsMeta.ageSeconds) : null,
      revision: factsMeta.revision ?? derivedMeta.revision ?? null,
      ownerRevision: factsMeta.ownerRevision ?? derivedMeta.ownerRevision ?? null,
      mapperVersion: derivedMeta.mapperVersion || salesFacts.mapperVersion || SALES_WEEKLY_MAPPER_VERSION,
      requestId: factsMeta.requestId || derivedMeta.requestId || requestId,
      rangeKey: factsScope.rangeKey,
      startDate: requested.startDate,
      endDate: requested.endDate,
      currencyMode: requested.currencyMode,
      scopeCount: { dates: requested.dates.length, sids: requested.sids.length },
      factsScopeCount: { dates: factsScope.dates.length, sids: factsScope.sids.length },
      recordCount: selectedRows.length,
      syncStatus: `销售事实 ${selectedRows.length} 条，负责人已按销售日期关联`,
    },
  };
}

function stableMskuDetailCacheKey(filters) {
  return JSON.stringify({
    version: "budget-msku-v7-available-days",
    startDate: filters.startDate || "",
    endDate: filters.endDate || "",
    listingOwner: filters.listingOwner || filters.owner || "",
    currencyCode: filters.currencyCode || "CNY",
    sids: Array.isArray(filters.sids) ? uniqueNumbers(filters.sids).sort((a, b) => a - b) : [],
  });
}

export async function getMskuDetailDashboard(filters = {}) {
  const syncState = getSyncState();
  if (syncState.provider !== "lingxing") {
    return {
      ok: true,
      source: "模拟数据",
      cacheHit: false,
      recordCount: 0,
      detailRows: [],
      updatedAt: mockDashboard.meta.updatedAt,
    };
  }

  const cacheKey = stableMskuDetailCacheKey(filters);
  const cached = await readMskuDetailCache(cacheKey);
  if (cached?.data) {
    return {
      ...cached.data,
      cacheHit: true,
      updatedAt: cached.updatedAt || cached.data.updatedAt,
    };
  }

  const adapter = getLingxingAdapter();
  const sellersResult = await getSharedSellers({ adapter });
  const sellerList = filterCoreSellers(sellersResult.sellers || []);
  const defaultRange = getDefaultWeekRange(getConfig().dashboard);
  const range = {
    startDate: filters.startDate || defaultRange.startDate,
    endDate: filters.endDate || defaultRange.endDate,
  };
  const selectedSids = Array.isArray(filters.sids) && filters.sids.length
    ? uniqueNumbers(filters.sids)
    : uniqueNumbers(sellerList.filter((seller) => !seller.status || seller.status === 1).map((seller) => seller.sid));

  const orderProfit = await adapter.fetchMskuOrderProfit({
    startDate: range.startDate,
    endDate: range.endDate,
    sids: selectedSids,
    currencyCode: filters.currencyCode || "CNY",
  });
  const selectedSidSet = new Set(selectedSids);
  const records = adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(orderProfit), sellerList).filter((record) => {
    if (!selectedSids.length) return true;
    const sid = Number(record.sid || record.seller_id || record.sellerId || record.store_id || record.storeId);
    return sid ? selectedSidSet.has(sid) : true;
  });
  let inventoryRecords = [];
  let inventoryWarning = "";
  try {
    inventoryRecords = await adapter.fetchAllFbaInventoryDetails(selectedSids);
  } catch (error) {
    inventoryWarning = error.message;
  }
  const budgetTargets = await getBudgetTargetContext(range);
  const listingOwnerRows = await fetchSalesListingOwnerRows(adapter, records, budgetTargets, sellerList);

  const data = await enrichSalesReviewAvailableDays({
    ok: true,
    source: inventoryWarning ? "领星 ERP · 订单利润 MSKU，FBA库存读取失败" : "领星 ERP · 订单利润 MSKU + FBA库存",
    cacheHit: false,
    recordCount: records.length,
    detailRows: buildBudgetMskuDetailRows(records, budgetTargets, inventoryRecords, sellerList, listingOwnerRows, filters),
    inventoryRecordCount: inventoryRecords.length,
    listingOwnerRecordCount: listingOwnerRows.length,
    inventoryWarning,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  });
  await saveMskuDetailCache(cacheKey, data);
  return data;
}

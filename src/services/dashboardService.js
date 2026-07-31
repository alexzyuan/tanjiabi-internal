import { mockDashboard } from "../data/mockDashboard.js";
import { getConfig } from "../config/index.js";
import { getSyncState } from "./syncService.js";
import {
  readMskuDetailCache,
  readSalesDashboardCache,
  readSalesWeeklySourceCache,
  saveMskuDetailCache,
  saveSalesDashboardCache,
  saveSalesWeeklySourceCache,
} from "../utils/cacheStore.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { buildBudgetMskuDetailRows, mapLingxingToSalesDashboard } from "./lingxingDashboardMapper.js";
import { getDefaultWeekRange } from "../utils/dateRange.js";
import { getBudgetTargetContext } from "./budgetTargetService.js";
import {
  fetchListingOwnerRows,
  listingOwnerRowsFromRecords,
  ownerLookupRowsFromBudgetTargets,
  ownerLookupRowsFromRecords,
} from "./listingOwnerService.js";
import { getSharedSellers } from "./sharedDataService.js";

function hasLiveFilters(filters) {
  return Boolean(filters.startDate || filters.endDate || filters.sids?.length);
}

const salesWeeklySourceRefreshes = new Map();

function nowMs() {
  return Date.now();
}

function logSalesWeeklyTiming(stage, startedAt, extra = {}) {
  console.info("[sales-weekly]", {
    stage,
    durationMs: nowMs() - startedAt,
    ...extra,
  });
}

function normalizedCurrencyCode(filters = {}) {
  return String(filters.currencyCode || "CNY").trim().toUpperCase() || "CNY";
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function salesWeeklySourceScope(filters = {}) {
  const defaultRange = getDefaultWeekRange(getConfig().dashboard);
  const startDate = filters.startDate || defaultRange.startDate;
  const endDate = filters.endDate || defaultRange.endDate;
  const sids = Array.isArray(filters.sids) ? uniqueNumbers(filters.sids).sort((a, b) => a - b) : [];
  return {
    version: "sales-weekly-source-v1",
    startDate,
    endDate,
    currencyCode: normalizedCurrencyCode(filters),
    sids,
  };
}

function salesWeeklySourceCacheKey(filters = {}) {
  return JSON.stringify(salesWeeklySourceScope(filters));
}

function sourceFiltersFromCacheScope(scope = {}) {
  return {
    startDate: scope.startDate || "",
    endDate: scope.endDate || "",
    currencyCode: scope.currencyCode || "CNY",
    sids: Array.isArray(scope.sids) ? scope.sids : [],
  };
}

function matchesDefaultSalesWeeklyRange(filters = {}) {
  const defaultRange = getDefaultWeekRange(getConfig().dashboard);
  const startDate = filters.startDate || defaultRange.startDate;
  const endDate = filters.endDate || defaultRange.endDate;
  return startDate === defaultRange.startDate && endDate === defaultRange.endDate;
}

function canUseDefaultSalesDashboardCache(filters = {}) {
  const listingOwner = String(filters.listingOwner || filters.owner || "").trim();
  const hasSelectedSids = Array.isArray(filters.sids) && filters.sids.length > 0;
  return matchesDefaultSalesWeeklyRange(filters)
    && !listingOwner
    && !hasSelectedSids
    && normalizedCurrencyCode(filters) === "CNY";
}

function dashboardFiltersFromSource(source = {}, filters = {}) {
  return {
    ...sourceFiltersFromCacheScope(source.cacheScope || salesWeeklySourceScope(filters)),
    listingOwner: String(filters.listingOwner || filters.owner || "").trim(),
    owner: String(filters.owner || filters.listingOwner || "").trim(),
  };
}

function mapSalesWeeklySourceToDashboard(source = {}, filters = {}) {
  const nextFilters = dashboardFiltersFromSource(source, filters);
  return mapLingxingToSalesDashboard({
    sellers: source.sellers || [],
    sellerProfitRecords: source.sellerProfitRecords || [],
    orderProfitRecords: source.orderProfitRecords || [],
    dailyProfitRecords: source.dailyProfitRecords || [],
    inventoryRecords: source.inventoryRecords || [],
    listingOwnerRows: source.listingOwnerRows || [],
    filters: nextFilters,
    range: source.range || {
      startDate: nextFilters.startDate,
      endDate: nextFilters.endDate,
    },
    currencyCode: source.currencyCode || nextFilters.currencyCode || "CNY",
    raw: {
      ...(source.raw || {}),
      cacheState: source.raw?.cacheState || "hit",
      cacheUpdatedAt: source.cacheUpdatedAt || source.updatedAt || "",
    },
    budgetTargets: source.budgetTargets || {},
  });
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

async function fetchSalesWeeklySource(filters = {}) {
  const adapter = getLingxingAdapter();
  const data = await adapter.fetchSalesWeeklyData(filters);
  const budgetTargets = await getBudgetTargetContext(data.range);
  const listingOwnerRows = await fetchSalesListingOwnerRows(
    adapter,
    data.orderProfitRecords || data.sellerProfitRecords || [],
    budgetTargets,
    data.sellers || [],
  );
  return {
    cacheScope: salesWeeklySourceScope(filters),
    sellers: data.sellers || [],
    sellerProfitRecords: data.sellerProfitRecords || [],
    orderProfitRecords: data.orderProfitRecords || [],
    dailyProfitRecords: data.dailyProfitRecords || [],
    inventoryRecords: data.inventoryRecords || [],
    listingOwnerRows,
    budgetTargets,
    range: data.range,
    currencyCode: data.currencyCode || normalizedCurrencyCode(filters),
    raw: data.raw || {},
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
}

function refreshSalesWeeklySourceCacheInBackground(filters = {}) {
  const cacheKey = salesWeeklySourceCacheKey(filters);
  if (salesWeeklySourceRefreshes.has(cacheKey)) return;
  const startedAt = nowMs();
  const promise = fetchSalesWeeklySource(filters)
    .then(async (source) => {
      await saveSalesWeeklySourceCache(cacheKey, source);
      logSalesWeeklyTiming("background-refresh-success", startedAt, {
        cacheKey,
        sourceUpdatedAt: source.updatedAt || "",
      });
    })
    .catch((error) => {
      console.error("[sales-weekly] background refresh failed", {
        durationMs: nowMs() - startedAt,
        filters: {
          startDate: filters.startDate || "",
          endDate: filters.endDate || "",
          currencyCode: filters.currencyCode || "CNY",
          sids: Array.isArray(filters.sids) ? filters.sids : [],
        },
        error: error.message,
      });
    })
    .finally(() => {
      salesWeeklySourceRefreshes.delete(cacheKey);
    });
  salesWeeklySourceRefreshes.set(cacheKey, promise);
}

function emptyLingxingDashboard(syncState, syncStatus = "领星数据尚未成功返回，请先检查同步中心错误信息。") {
  return {
    ...mockDashboard,
    meta: {
      ...mockDashboard.meta,
      source: "领星 ERP",
      syncStatus,
      updatedAt: syncState.lastSuccessAt || "-",
    },
    insights: [
      ["数据未就绪", "未显示模拟经营数据", "请先确认同步中心显示为 lingxing，并查看最近错误信息。"],
      ["需要处理", "检查服务器配置", "确认 /opt/tanjia-bi/.env 中 DATA_PROVIDER=lingxing，且 PM2 从项目目录启动。"],
      ["下一步", "手动同步一次", "同步成功后看板会恢复真实领星订单利润口径。"],
    ],
    kpis: [
      { title: "时间进度", value: "未连接", left: "等待真实数据", right: "请检查同步中心", progress: 0, tone: "orange" },
      { title: "总销售收入达成率", value: "-", left: "目标：-", right: "实际：-", progress: 0, tone: "orange" },
      { title: "广告销售占比", value: "-", left: "广告销售：-", right: "销售额：-", progress: 0, tone: "orange" },
      { title: "店铺利润达成率", value: "-", left: "目标：-", right: "实际：-", progress: 0, tone: "orange" },
      { title: "广告费率达成率", value: "-", left: "目标费率：-", right: "实际费率：-", progress: 0, tone: "orange" },
    ],
    siteRows: [["暂无真实数据", "-", 0, 0, "0.0%", 0, 0, "0.0%", 0, 0, "0.00%", "0.00%"]],
    miniMetrics: [
      ["销售额", "-", "等待领星返回", ""],
      ["订单退款", "-", "等待领星返回", ""],
      ["广告花费", "-", "等待领星返回", ""],
      ["退货率", "-", "等待领星返回", ""],
      ["ACOS", "-", "等待领星返回", ""],
      ["销售毛利", "-", "等待领星返回", ""],
    ],
    summary: [
      ["销售毛利", "-"],
      ["销售毛利率", "-"],
      ["公司净利", "-"],
      ["公司净利率", "-"],
      ["销售额", "-"],
      ["广告花费", "-"],
      ["广告销售额", "-"],
      ["ACOS", "-"],
      ["退款率", "-"],
    ],
    trend: [],
    adTrend: [],
    acosTrend: [],
    returnTrend: [],
    trendLabels: [],
    dailyRows: [],
    storeData: [],
    profitData: [],
    detailRows: [],
  };
}

function normalizeCachedDashboard(cachedDashboard, syncState, syncStatus) {
  const empty = emptyLingxingDashboard(syncState, syncStatus);
  const cachedMeta = cachedDashboard?.meta || {};

  return {
    ...empty,
    ...cachedDashboard,
    meta: {
      ...empty.meta,
      ...cachedMeta,
      source: "领星 ERP",
      syncStatus,
      updatedAt: syncState.lastSuccessAt || cachedMeta.updatedAt || empty.meta.updatedAt,
    },
    insights: Array.isArray(cachedDashboard?.insights) ? cachedDashboard.insights : empty.insights,
    kpis: Array.isArray(cachedDashboard?.kpis) ? cachedDashboard.kpis : empty.kpis,
    siteRows: Array.isArray(cachedDashboard?.siteRows) ? cachedDashboard.siteRows : empty.siteRows,
    miniMetrics: Array.isArray(cachedDashboard?.miniMetrics) ? cachedDashboard.miniMetrics : empty.miniMetrics,
    summary: Array.isArray(cachedDashboard?.summary) ? cachedDashboard.summary : empty.summary,
    trend: Array.isArray(cachedDashboard?.trend) ? cachedDashboard.trend : empty.trend,
    adTrend: Array.isArray(cachedDashboard?.adTrend) ? cachedDashboard.adTrend : empty.adTrend,
    acosTrend: Array.isArray(cachedDashboard?.acosTrend) ? cachedDashboard.acosTrend : empty.acosTrend,
    returnTrend: Array.isArray(cachedDashboard?.returnTrend) ? cachedDashboard.returnTrend : empty.returnTrend,
    trendLabels: Array.isArray(cachedDashboard?.trendLabels) ? cachedDashboard.trendLabels : empty.trendLabels,
    dailyRows: Array.isArray(cachedDashboard?.dailyRows) ? cachedDashboard.dailyRows : empty.dailyRows,
    storeData: Array.isArray(cachedDashboard?.storeData) ? cachedDashboard.storeData : empty.storeData,
    profitData: Array.isArray(cachedDashboard?.profitData) ? cachedDashboard.profitData : empty.profitData,
    detailRows: Array.isArray(cachedDashboard?.detailRows) ? cachedDashboard.detailRows : empty.detailRows,
  };
}

export async function getSalesWeeklyDashboard(filters = {}) {
  const startedAt = nowMs();
  const syncState = getSyncState();
  const sourceCacheKey = salesWeeklySourceCacheKey(filters);
  const defaultCacheEligible = canUseDefaultSalesDashboardCache(filters);
  let cachedSource = null;
  let cachedDashboard = null;

  try {
    cachedSource = await readSalesWeeklySourceCache(sourceCacheKey);
  } catch (error) {
    console.error("[sales-weekly] source cache read failed", {
      cacheKey: sourceCacheKey,
      error: error.message,
    });
  }

  if (syncState.provider === "lingxing" && cachedSource?.data) {
    const dashboard = mapSalesWeeklySourceToDashboard(cachedSource.data, filters);
    if (defaultCacheEligible) refreshSalesWeeklySourceCacheInBackground(filters);
    logSalesWeeklyTiming("cache-hit-source", startedAt, {
      cacheKey: sourceCacheKey,
      updatedAt: cachedSource.updatedAt || cachedSource.data.updatedAt || "",
    });
    return {
      ...dashboard,
      cacheHit: true,
    };
  }

  try {
    cachedDashboard = await readSalesDashboardCache();
  } catch (error) {
    console.error("[sales-weekly] legacy cache read failed", {
      error: error.message,
    });
  }

  if (syncState.provider === "lingxing" && cachedDashboard && defaultCacheEligible) {
    refreshSalesWeeklySourceCacheInBackground(filters);
    logSalesWeeklyTiming("cache-hit-default", startedAt, {
      updatedAt: cachedDashboard.meta?.updatedAt || "",
      requestedRange: {
        startDate: filters.startDate || "",
        endDate: filters.endDate || "",
      },
    });
    return normalizeCachedDashboard(
      cachedDashboard,
      syncState,
      cachedDashboard.meta?.syncStatus || syncState.lastStatus || "已显示最近同步缓存，后台刷新实时数据",
    );
  }

  if (syncState.provider === "lingxing" && hasLiveFilters(filters)) {
    try {
      const source = await fetchSalesWeeklySource(filters);
      await saveSalesWeeklySourceCache(sourceCacheKey, source);
      if (defaultCacheEligible) {
        await saveSalesDashboardCache(mapSalesWeeklySourceToDashboard(source, {}));
      }
      const dashboard = mapSalesWeeklySourceToDashboard(source, filters);
      logSalesWeeklyTiming("live-success", startedAt, {
        defaultCacheEligible,
        cacheKey: sourceCacheKey,
        recordStatus: dashboard?.meta?.syncStatus || "",
      });
      return {
        ...dashboard,
        cacheHit: false,
      };
    } catch (error) {
      if (cachedDashboard) {
        logSalesWeeklyTiming("live-failed-cache-fallback", startedAt, {
          defaultCacheEligible,
          cacheKey: sourceCacheKey,
          error: error.message,
        });
        return normalizeCachedDashboard(
          cachedDashboard,
          syncState,
          `已显示最近同步缓存；实时接口暂不可用：${error.message}`,
        );
      }
      logSalesWeeklyTiming("live-failed-empty", startedAt, {
        defaultCacheEligible,
        cacheKey: sourceCacheKey,
        error: error.message,
      });
      return emptyLingxingDashboard(syncState, `销售看板实时接口失败：${error.message}`);
    }
  }

  if (syncState.provider === "lingxing" && cachedDashboard) {
    logSalesWeeklyTiming("cache-hit", startedAt, {
      updatedAt: cachedDashboard.meta?.updatedAt || "",
    });
    return normalizeCachedDashboard(
      cachedDashboard,
      syncState,
      cachedDashboard.meta?.syncStatus || syncState.lastStatus || "已显示最近同步缓存",
    );
  }

  const fallback = {
    ...mockDashboard,
    meta: {
      ...mockDashboard.meta,
      source: syncState.provider === "lingxing" ? "领星 ERP" : "模拟数据",
      syncStatus: syncState.lastStatus,
      updatedAt: syncState.lastSuccessAt || mockDashboard.meta.updatedAt,
    },
  };

  if (syncState.provider === "lingxing") {
    logSalesWeeklyTiming("empty-lingxing", startedAt);
    return emptyLingxingDashboard(syncState);
  }

  logSalesWeeklyTiming("mock-fallback", startedAt);
  return fallback;
}

function stableMskuDetailCacheKey(filters) {
  return JSON.stringify({
    version: "budget-msku-v6-au-actual-rows",
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

  const data = {
    ok: true,
    source: inventoryWarning ? "领星 ERP · 订单利润 MSKU，FBA库存读取失败" : "领星 ERP · 订单利润 MSKU + FBA库存",
    cacheHit: false,
    recordCount: records.length,
    detailRows: buildBudgetMskuDetailRows(records, budgetTargets, inventoryRecords, sellerList, listingOwnerRows, filters),
    inventoryRecordCount: inventoryRecords.length,
    listingOwnerRecordCount: listingOwnerRows.length,
    inventoryWarning,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  await saveMskuDetailCache(cacheKey, data);
  return data;
}

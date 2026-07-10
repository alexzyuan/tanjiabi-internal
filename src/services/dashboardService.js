import { mockDashboard } from "../data/mockDashboard.js";
import { getConfig } from "../config/index.js";
import { getSyncState } from "./syncService.js";
import { readMskuDetailCache, readSalesDashboardCache, saveMskuDetailCache } from "../utils/cacheStore.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { buildBudgetMskuDetailRows, mapLingxingToSalesDashboard } from "./lingxingDashboardMapper.js";
import { getDefaultWeekRange } from "../utils/dateRange.js";
import { getBudgetTargetContext } from "./budgetTargetService.js";
import { fetchListingOwnerRows, ownerLookupRowsFromRecords } from "./listingOwnerService.js";
import { getSharedSellers } from "./sharedDataService.js";

function hasLiveFilters(filters) {
  return Boolean(filters.startDate || filters.endDate || filters.sids?.length);
}

async function fetchSalesListingOwnerRows(adapter, records = []) {
  try {
    return await fetchListingOwnerRows(adapter, ownerLookupRowsFromRecords(records));
  } catch {
    return [];
  }
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
  const syncState = getSyncState();
  const cachedDashboard = await readSalesDashboardCache();

  if (syncState.provider === "lingxing" && hasLiveFilters(filters)) {
    const adapter = getLingxingAdapter();
    try {
      const data = await adapter.fetchSalesWeeklyData(filters);
      const budgetTargets = await getBudgetTargetContext(data.range);
      const listingOwnerRows = await fetchSalesListingOwnerRows(adapter, data.orderProfitRecords || data.sellerProfitRecords || []);
      return mapLingxingToSalesDashboard({ ...data, budgetTargets, listingOwnerRows, filters });
    } catch (error) {
      if (cachedDashboard) {
        return normalizeCachedDashboard(
          cachedDashboard,
          syncState,
          `已显示最近同步缓存；实时接口暂不可用：${error.message}`,
        );
      }
      return emptyLingxingDashboard(syncState, `销售看板实时接口失败：${error.message}`);
    }
  }

  if (syncState.provider === "lingxing" && cachedDashboard) {
    return normalizeCachedDashboard(
      cachedDashboard,
      syncState,
      syncState.lastStatus || cachedDashboard.meta?.syncStatus || "已显示最近同步缓存",
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
    return emptyLingxingDashboard(syncState);
  }

  return fallback;
}

function stableMskuDetailCacheKey(filters) {
  return JSON.stringify({
    version: "budget-msku-v6-au-actual-rows",
    startDate: filters.startDate || "",
    endDate: filters.endDate || "",
    listingOwner: filters.listingOwner || filters.owner || "",
    currencyCode: filters.currencyCode || "ORIGINAL",
    sids: Array.isArray(filters.sids) ? uniqueNumbers(filters.sids).sort((a, b) => a - b) : [],
  });
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
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
    currencyCode: filters.currencyCode || "ORIGINAL",
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
  const listingOwnerRows = await fetchSalesListingOwnerRows(adapter, records);

  const data = {
    ok: true,
    source: inventoryWarning ? "领星 ERP · 订单利润 MSKU，FBA库存读取失败" : "领星 ERP · 订单利润 MSKU + FBA库存",
    cacheHit: false,
    recordCount: records.length,
    detailRows: buildBudgetMskuDetailRows(records, await getBudgetTargetContext(range), inventoryRecords, sellerList, listingOwnerRows, filters),
    inventoryRecordCount: inventoryRecords.length,
    listingOwnerRecordCount: listingOwnerRows.length,
    inventoryWarning,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  await saveMskuDetailCache(cacheKey, data);
  return data;
}

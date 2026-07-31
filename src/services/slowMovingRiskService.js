import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getConfig } from "../config/index.js";
import { loadFbaInventoryDetailRows } from "./inventoryProvisionService.js";

export const RISK_PARAMETERS = Object.freeze({
  annualCapitalCostRate: 0.12,
  clearanceUnitPriceOriginal: 9.9,
  liquidationUnitPriceOriginal: 1,
  adShareThreshold: 0.15,
  reportRetentionMonths: 6,
});

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function shanghaiDateText(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function completedWeeklyRange(now = new Date()) {
  const today = shanghaiDateText(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const daysSinceSunday = weekday === 0 ? 7 : weekday;
  const endDate = addDays(today, -daysSinceSunday);
  return {
    startDate: addDays(endDate, -29),
    endDate,
    reportKey: endDate,
  };
}

export function classifyRisk({
  agedQuantity = 0,
  age181PlusQuantity = 0,
  historicalDaysOfSupply = 0,
  cashConversionRate = 0,
  recent30GrossProfit = 0,
} = {}) {
  if (toNumber(agedQuantity) > 0
    && (toNumber(age181PlusQuantity) > 0 || toNumber(historicalDaysOfSupply) > 180)
    && toNumber(cashConversionRate) < 0.1
    && toNumber(recent30GrossProfit) <= 0) return "强制处置";
  if (toNumber(agedQuantity) > 0 && toNumber(historicalDaysOfSupply) > 120 && toNumber(cashConversionRate) < 0.15) return "高风险";
  if (toNumber(agedQuantity) > 0 && toNumber(historicalDaysOfSupply) > 90 && toNumber(cashConversionRate) < 0.2) return "关注";
  return "正常";
}

function resolveRecommendation({ riskLevel, adWaste, age181PlusQuantity }) {
  if (riskLevel === "强制处置" && adWaste) {
    return { recommendation: "停止广告并清仓", recommendationReason: "近30天毛利为负，广告占比达到15%且库存已满足强制处置门槛" };
  }
  if (riskLevel === "强制处置" && toNumber(age181PlusQuantity) > 0) {
    return { recommendation: "申请清算并停止补货", recommendationReason: "181天以上库龄库存已进入强制处置范围" };
  }
  if (riskLevel === "强制处置") {
    return { recommendation: "移除 FBA 并停止补货", recommendationReason: "供货天数超过180天、动销低且近30天毛利非正" };
  }
  if (riskLevel === "高风险" && adWaste) {
    return { recommendation: "停止广告并降价清仓", recommendationReason: "库存周转低于高风险门槛，广告继续投入会扩大现金占用" };
  }
  if (riskLevel === "高风险") {
    return { recommendation: "降价清仓并停止补货", recommendationReason: "供货天数与动销均已触及高风险门槛" };
  }
  if (riskLevel === "关注") {
    return { recommendation: "停止补货，持续观察", recommendationReason: "90天以上库龄库存周转偏慢" };
  }
  return { recommendation: "继续观察", recommendationReason: "未触及滞销处置门槛" };
}

export function buildSlowMovingRiskRow(source = {}, parameters = RISK_PARAMETERS) {
  const age91To180Quantity = toNumber(source.age91To180Quantity);
  const age181PlusQuantity = toNumber(source.age181PlusQuantity);
  const agedQuantity = round(age91To180Quantity + age181PlusQuantity);
  const age91To180Amount = toNumber(source.age91To180Amount);
  const age181PlusAmount = toNumber(source.age181PlusAmount);
  const inventoryAmount = toNumber(source.inventoryAmount);
  const agedInventoryAmount = round(age91To180Amount + age181PlusAmount || (inventoryAmount && source.availableQuantity ? inventoryAmount * agedQuantity / toNumber(source.availableQuantity) : 0));
  const availableQuantity = toNumber(source.availableQuantity);
  const recent30SalesQuantity = toNumber(source.recent30SalesQuantity);
  const recent30SalesAmount = toNumber(source.recent30SalesAmount);
  const recent30GrossProfit = toNumber(source.recent30GrossProfit);
  const recent30AdSpend = toNumber(source.recent30AdSpend);
  const recent30AdSales = toNumber(source.recent30AdSales);
  const estimatedStorageCostNextMonth = toNumber(source.estimatedStorageCostNextMonth);
  const cashConversionRate = recent30SalesQuantity + availableQuantity > 0
    ? round(recent30SalesQuantity / (recent30SalesQuantity + availableQuantity))
    : null;
  const averageGrossProfit = recent30SalesQuantity > 0
    ? round(recent30GrossProfit / recent30SalesQuantity)
    : null;
  const adShare = recent30SalesAmount > 0 ? round(recent30AdSpend / recent30SalesAmount) : null;
  const acos = recent30AdSales > 0 ? round(recent30AdSpend / recent30AdSales) : null;
  const adWaste = recent30GrossProfit < 0 && recent30AdSpend > 0
    && (recent30SalesAmount === 0 || adShare >= parameters.adShareThreshold);
  const capitalCostThreeMonths = round(agedInventoryAmount * parameters.annualCapitalCostRate / 4);
  const cashRiskAmount = round(
    agedInventoryAmount
    + estimatedStorageCostNextMonth * 3
    + capitalCostThreeMonths
    + Math.max(0, -recent30GrossProfit),
  );
  const riskLevel = classifyRisk({
    agedQuantity,
    age181PlusQuantity,
    historicalDaysOfSupply: source.historicalDaysOfSupply,
    cashConversionRate: cashConversionRate ?? 0,
    recent30GrossProfit,
  });
  const recommendation = resolveRecommendation({ riskLevel, adWaste, age181PlusQuantity });

  return {
    ...source,
    age91To180Quantity,
    age181PlusQuantity,
    agedQuantity,
    inventoryAmount,
    agedInventoryAmount,
    availableQuantity,
    recent30SalesQuantity,
    recent30SalesAmount,
    recent30GrossProfit,
    recent30AdSpend,
    recent30AdSales,
    estimatedStorageCostNextMonth,
    cashConversionRate,
    averageGrossProfit,
    adShare,
    acos,
    adWaste,
    capitalCostThreeMonths,
    cashRiskAmount,
    riskLevel,
    ...recommendation,
    clearanceRecoveryOriginal: round(agedQuantity * parameters.clearanceUnitPriceOriginal, 2),
    liquidationRecoveryOriginal: round(agedQuantity * parameters.liquidationUnitPriceOriginal, 2),
    removalFeeStatus: "unavailable",
    removalFeeReason: "缺少尺寸/重量，无法计算",
    removalFeeOriginal: null,
  };
}

function riskKey({ sid = 0, msku = "" } = {}) {
  return `${toNumber(sid)}|${String(msku || "").trim().toLowerCase()}`;
}

function ageAmount(row) {
  return toNumber(row.ageBucketAmount) || round(toNumber(row.quantity) * toNumber(row.unitCost));
}

function groupInventoryRows(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = riskKey(row);
    if (!key || !String(row.msku || "").trim()) return;
    if (!groups.has(key)) {
      groups.set(key, {
        sid: toNumber(row.sid),
        storeName: row.storeName || "",
        country: row.country || "",
        countryCode: row.countryCode || "",
        listingOwner: row.listingOwner || "",
        msku: row.msku || "",
        fnsku: row.fnsku || "",
        productName: row.skuName || "",
        currencyCode: row.currencyCode || "",
        availableQuantity: 0,
        inventoryAmount: 0,
        age91To180Quantity: 0,
        age91To180Amount: 0,
        age181PlusQuantity: 0,
        age181PlusAmount: 0,
        historicalDaysOfSupply: 0,
        estimatedStorageCostNextMonth: 0,
      });
    }
    const target = groups.get(key);
    const quantity = toNumber(row.quantity);
    const amount = ageAmount(row);
    const totalInventory = toNumber(row.totalInventory);
    target.availableQuantity = Math.max(target.availableQuantity, totalInventory || quantity);
    target.inventoryAmount = Math.max(target.inventoryAmount, toNumber(row.inventoryAmount), round((totalInventory || quantity) * toNumber(row.unitCost)));
    target.historicalDaysOfSupply = Math.max(target.historicalDaysOfSupply, toNumber(row.historicalDaysOfSupply));
    target.estimatedStorageCostNextMonth = round(target.estimatedStorageCostNextMonth + toNumber(row.estimatedStorageCostAllocation));
    if (toNumber(row.ageDays) >= 91 && toNumber(row.ageDays) <= 180) {
      target.age91To180Quantity = round(target.age91To180Quantity + quantity);
      target.age91To180Amount = round(target.age91To180Amount + amount);
    }
    if (toNumber(row.ageDays) >= 181) {
      target.age181PlusQuantity = round(target.age181PlusQuantity + quantity);
      target.age181PlusAmount = round(target.age181PlusAmount + amount);
    }
  });
  return groups;
}

function groupProfitRows(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = riskKey(row);
    if (!key || !String(row.msku || "").trim()) return;
    if (!groups.has(key)) {
      groups.set(key, {
        recent30SalesQuantity: 0,
        recent30SalesAmount: 0,
        recent30GrossProfit: 0,
        recent30AdSpend: 0,
        recent30AdSales: 0,
      });
    }
    const target = groups.get(key);
    target.recent30SalesQuantity = round(target.recent30SalesQuantity + toNumber(row.totalSalesQuantity ?? row.volume));
    target.recent30SalesAmount = round(target.recent30SalesAmount + toNumber(row.totalSalesAmount ?? row.amount));
    target.recent30GrossProfit = round(target.recent30GrossProfit + toNumber(row.grossProfit ?? row.gross_profit));
    target.recent30AdSpend = round(target.recent30AdSpend + toNumber(row.totalAdsCost ?? row.spend));
    target.recent30AdSales = round(target.recent30AdSales + toNumber(row.totalAdsSales ?? row.ad_sales_amount));
  });
  return groups;
}

export function summarizeSlowMovingRiskRows(rows = []) {
  const riskRows = rows.filter((row) => row.riskLevel === "强制处置" || row.riskLevel === "高风险");
  return {
    highRiskSkuCount: riskRows.length,
    agedInventoryQuantity: round(riskRows.reduce((total, row) => total + toNumber(row.agedQuantity), 0)),
    agedInventoryAmount: round(riskRows.reduce((total, row) => total + toNumber(row.agedInventoryAmount), 0), 2),
    recent30GrossProfit: round(riskRows.reduce((total, row) => total + toNumber(row.recent30GrossProfit), 0), 2),
  };
}

export function filterSlowMovingRiskRows(rows = [], filters = {}) {
  const selected = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const countries = selected(filters.country);
  const stores = selected(filters.storeName);
  const owners = selected(filters.listingOwner);
  const levels = selected(filters.riskLevel);
  return rows.filter((row) => (!countries.length || countries.includes(row.country))
    && (!stores.length || stores.includes(row.storeName))
    && (!owners.length || owners.includes(row.listingOwner))
    && (!levels.length || levels.includes(row.riskLevel)));
}

export function buildSlowMovingRiskDashboard({
  inventoryRows = [],
  profitRows = [],
  dateRange,
  filters = {},
  parameters = RISK_PARAMETERS,
  generatedAt = new Date().toISOString(),
  dataSources = {},
} = {}) {
  if (!dateRange?.startDate || !dateRange?.endDate || !dateRange?.reportKey) {
    throw new Error("buildSlowMovingRiskDashboard requires a complete dateRange.");
  }
  const inventoryByKey = groupInventoryRows(inventoryRows);
  const profitByKey = groupProfitRows(profitRows);
  const allRows = [...inventoryByKey.entries()]
    .map(([key, inventory]) => buildSlowMovingRiskRow({ ...inventory, ...(profitByKey.get(key) || {}) }, parameters))
    .sort((left, right) => right.cashRiskAmount - left.cashRiskAmount || String(left.msku).localeCompare(String(right.msku), "zh-CN"));
  const rows = filterSlowMovingRiskRows(allRows, filters);
  return {
    dateRange,
    parameters,
    kpis: summarizeSlowMovingRiskRows(rows),
    rows,
    filters: {
      countryOptions: [...new Set(allRows.map((row) => row.country).filter(Boolean))].sort().map((name) => ({ name })),
      storeOptions: [...new Set(allRows.map((row) => row.storeName).filter(Boolean))].sort().map((name) => ({ name })),
      ownerOptions: [...new Set(allRows.map((row) => row.listingOwner).filter(Boolean))].sort().map((name) => ({ name })),
    },
    meta: { generatedAt, dataSources },
  };
}

function sourceError(source, error) {
  if (error?.source) throw error;
  error.source = source;
  throw error;
}

export function createSlowMovingRiskService({
  loadInventoryRows,
  fetchOrderProfit,
  normalizeRecordList = (payload) => payload,
  normalizeOrderProfit = (records) => records,
  now = () => new Date(),
} = {}) {
  if (typeof loadInventoryRows !== "function") throw new Error("createSlowMovingRiskService requires loadInventoryRows.");
  if (typeof fetchOrderProfit !== "function") throw new Error("createSlowMovingRiskService requires fetchOrderProfit.");

  async function getDashboard({ dateRange = completedWeeklyRange(now()), filters = {}, parameters = RISK_PARAMETERS } = {}) {
    let inventory;
    try {
      inventory = await loadInventoryRows();
    } catch (error) {
      sourceError("inventory", error);
    }
    let payload;
    try {
      payload = await fetchOrderProfit({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        sids: (inventory.sellers || []).map((seller) => seller.sid),
        currencyCode: "ORIGINAL",
      });
    } catch (error) {
      sourceError("orderProfit", error);
    }
    let profitRows;
    try {
      profitRows = normalizeOrderProfit(normalizeRecordList(payload), inventory.sellers || []);
    } catch (error) {
      sourceError("orderProfit", error);
    }
    return buildSlowMovingRiskDashboard({
      inventoryRows: inventory.rows || [],
      profitRows,
      dateRange,
      filters,
      parameters,
      generatedAt: now().toISOString(),
      dataSources: {
        inventory: { status: "success", rowCount: (inventory.rows || []).length },
        orderProfit: { status: "success", rowCount: profitRows.length },
      },
    });
  }

  return { getDashboard };
}

export async function getSlowMovingRiskDashboard(filters = {}, dependencies = {}) {
  const now = dependencies.now;
  const currentTime = typeof now === "function" ? now() : new Date();
  if (!Object.keys(dependencies).length && getConfig().dataProvider !== "lingxing") {
    return buildSlowMovingRiskDashboard({
      inventoryRows: [],
      profitRows: [],
      dateRange: filters.dateRange || completedWeeklyRange(currentTime),
      filters: filters.filters || {},
      parameters: filters.parameters || RISK_PARAMETERS,
      generatedAt: currentTime.toISOString(),
      dataSources: {
        inventory: { status: "mock", rowCount: 0 },
        orderProfit: { status: "mock", rowCount: 0 },
      },
    });
  }
  const adapter = dependencies.adapter || getLingxingAdapter();
  const loadInventoryRows = dependencies.loadInventoryRows || (() => loadFbaInventoryDetailRows({ adapter }));
  const service = createSlowMovingRiskService({
    loadInventoryRows,
    fetchOrderProfit: (request) => adapter.fetchMskuOrderProfit(request),
    normalizeRecordList: (payload) => adapter.normalizeRecordList(payload),
    normalizeOrderProfit: (records, sellers) => adapter.normalizeMskuOrderProfitRecords(records, sellers),
    now,
  });
  return service.getDashboard(filters);
}

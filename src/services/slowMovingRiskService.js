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
    clearanceRecoveryOriginal: round(agedQuantity * parameters.clearanceUnitPriceOriginal, 2),
    liquidationRecoveryOriginal: round(agedQuantity * parameters.liquidationUnitPriceOriginal, 2),
    removalFeeStatus: "unavailable",
    removalFeeReason: "缺少尺寸/重量，无法计算",
    removalFeeOriginal: null,
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  RISK_PARAMETERS,
  buildSlowMovingRiskRow,
  classifyRisk,
  completedWeeklyRange,
} from "../src/services/slowMovingRiskService.js";

test("buildSlowMovingRiskRow marks a slow negative-margin SKU with high ad share as mandatory disposal", () => {
  const row = buildSlowMovingRiskRow({
    sid: 11500,
    storeName: "tandanbo-US",
    country: "US",
    msku: "MD-DINOBATH",
    availableQuantity: 646,
    inventoryAmount: 14728.8,
    age91To180Quantity: 623,
    age91To180Amount: 14204.4,
    age181PlusQuantity: 0,
    historicalDaysOfSupply: 240,
    estimatedStorageCostNextMonth: 93.17,
    recent30SalesQuantity: 59,
    recent30SalesAmount: 7229.16,
    recent30GrossProfit: -4709.9,
    recent30AdSpend: 1680.25,
    recent30AdSales: 3308.26,
    currencyCode: "USD",
  }, RISK_PARAMETERS);

  assert.equal(row.riskLevel, "强制处置");
  assert.equal(row.cashConversionRate, 0.0837);
  assert.equal(row.averageGrossProfit, -79.8288);
  assert.equal(row.adWaste, true);
  assert.equal(row.clearanceRecoveryOriginal, 6167.7);
  assert.equal(row.liquidationRecoveryOriginal, 623);
  assert.equal(row.removalFeeStatus, "unavailable");
});

test("completedWeeklyRange uses the previous Sunday and exactly 30 calendar days", () => {
  assert.deepEqual(completedWeeklyRange(new Date("2026-08-04T01:00:00.000Z")), {
    startDate: "2026-07-04",
    endDate: "2026-08-02",
    reportKey: "2026-08-02",
  });
});

test("classifyRisk preserves the confirmed three threshold levels", () => {
  assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 1, historicalDaysOfSupply: 181, cashConversionRate: 0.09, recent30GrossProfit: 0 }), "强制处置");
  assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 0, historicalDaysOfSupply: 121, cashConversionRate: 0.149, recent30GrossProfit: 1 }), "高风险");
  assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 0, historicalDaysOfSupply: 91, cashConversionRate: 0.199, recent30GrossProfit: 1 }), "关注");
  assert.equal(classifyRisk({ agedQuantity: 0, historicalDaysOfSupply: 200, cashConversionRate: 0.01, recent30GrossProfit: -1 }), "正常");
});

test("buildSlowMovingRiskRow flags advertising spend with zero sales and leaves average profit unavailable", () => {
  const row = buildSlowMovingRiskRow({
    availableQuantity: 7,
    recent30SalesQuantity: 0,
    recent30SalesAmount: 0,
    recent30AdSpend: 8,
    recent30GrossProfit: -2,
  });

  assert.equal(row.adWaste, true);
  assert.equal(row.averageGrossProfit, null);
  assert.equal(row.adShare, null);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  RISK_PARAMETERS,
  buildSlowMovingRiskRow,
  classifyRisk,
  completedWeeklyRange,
  createSlowMovingRiskService,
  getSlowMovingRiskDashboard,
} from "../src/services/slowMovingRiskService.js";
import { withEnv } from "./helpers/env.js";

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
  assert.equal(row.recommendation, "停止广告并清仓");
  assert.match(row.recommendationReason, /广告占比/);
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

test("buildSlowMovingRiskRow does not flag advertising waste below the 15 percent ad-share threshold", () => {
  const row = buildSlowMovingRiskRow({
    availableQuantity: 8,
    recent30SalesQuantity: 1,
    recent30SalesAmount: 100,
    recent30AdSpend: 14.99,
    recent30GrossProfit: -2,
  });

  assert.equal(row.adShare, 0.1499);
  assert.equal(row.adWaste, false);
});

test("getDashboard aggregates FBA age buckets and order-profit advertising fields", async () => {
  const service = createSlowMovingRiskService({
    loadInventoryRows: async () => ({
      rows: [{
        sid: 11500,
        storeName: "tandanbo-US",
        country: "US",
        msku: "MD-DINOBATH",
        quantity: 623,
        ageDays: 120,
        totalInventory: 646,
        unitCost: 22.8,
        historicalDaysOfSupply: 150,
        estimatedStorageCostAllocation: 93.17,
      }],
      sellers: [{ sid: 11500, name: "tandanbo-US", country: "US" }],
    }),
    fetchOrderProfit: async () => [{
      sid: 11500,
      msku: "MD-DINOBATH",
      volume: 59,
      amount: 7229.16,
      gross_profit: -4709.9,
      spend: 1680.25,
      ad_sales_amount: 3308.26,
    }],
    normalizeRecordList: (records) => records,
    normalizeOrderProfit: (records) => records,
  });

  const dashboard = await service.getDashboard({
    dateRange: { startDate: "2026-07-04", endDate: "2026-08-02", reportKey: "2026-08-02" },
  });

  assert.equal(dashboard.rows.length, 1);
  assert.equal(dashboard.rows[0].riskLevel, "高风险");
  assert.equal(dashboard.rows[0].recent30AdSpend, 1680.25);
  assert.equal(dashboard.rows[0].age91To180Quantity, 623);
  assert.equal(dashboard.meta.dataSources.inventory.status, "success");
  assert.equal(dashboard.meta.dataSources.orderProfit.status, "success");
});

test("getDashboard requests CNY profit data and filters by store original currency", async () => {
  let orderProfitRequest = null;
  const service = createSlowMovingRiskService({
    loadInventoryRows: async () => ({
      rows: [
        { sid: 1, storeName: "tandanbo-US", country: "美国", currencyCode: "USD", msku: "US-SKU", quantity: 10, ageDays: 120, totalInventory: 10, unitCost: 10, historicalDaysOfSupply: 130 },
        { sid: 2, storeName: "tandanbo-CA", country: "加拿大", currencyCode: "CAD", msku: "CA-SKU", quantity: 10, ageDays: 120, totalInventory: 10, unitCost: 10, historicalDaysOfSupply: 130 },
      ],
      sellers: [{ sid: 1 }, { sid: 2 }],
    }),
    fetchOrderProfit: async (request) => {
      orderProfitRequest = request;
      return [];
    },
    normalizeRecordList: (records) => records,
    normalizeOrderProfit: (records) => records,
  });

  const dashboard = await service.getDashboard({
    dateRange: { startDate: "2026-07-04", endDate: "2026-08-02", reportKey: "2026-08-02" },
    filters: { currencyCode: "USD" },
  });

  assert.equal(orderProfitRequest.currencyCode, "CNY");
  assert.deepEqual(dashboard.rows.map((row) => row.msku), ["US-SKU"]);
  assert.deepEqual(dashboard.filters.currencyOptions, [{ name: "CAD" }, { name: "USD" }]);
});

test("getSlowMovingRiskDashboard composes adapter defaults through explicit dependencies", async () => {
  const dashboard = await getSlowMovingRiskDashboard({
    dateRange: { startDate: "2026-07-04", endDate: "2026-08-02", reportKey: "2026-08-02" },
  }, {
    loadInventoryRows: async () => ({ rows: [], sellers: [{ sid: 11500 }] }),
    adapter: {
      fetchMskuOrderProfit: async () => [],
      normalizeRecordList: (records) => records,
      normalizeMskuOrderProfitRecords: (records) => records,
    },
  });

  assert.deepEqual(dashboard.rows, []);
  assert.equal(dashboard.meta.dataSources.inventory.rowCount, 0);
});

test("getSlowMovingRiskDashboard keeps the local mock BI page observable without calling Lingxing", async () => {
  await withEnv({ DATA_PROVIDER: "mock" }, async () => {
    const dashboard = await getSlowMovingRiskDashboard({
      dateRange: { startDate: "2026-07-04", endDate: "2026-08-02", reportKey: "2026-08-02" },
    });

    assert.deepEqual(dashboard.rows, []);
    assert.equal(dashboard.meta.dataSources.inventory.status, "mock");
    assert.equal(dashboard.meta.dataSources.orderProfit.status, "mock");
  });
});

test("getDashboard identifies the failed core source instead of returning a partial dashboard", async () => {
  const service = createSlowMovingRiskService({
    loadInventoryRows: async () => {
      throw new Error("inventory timeout");
    },
    fetchOrderProfit: async () => [],
  });

  await assert.rejects(
    () => service.getDashboard(),
    (error) => error.source === "inventory" && error.message === "inventory timeout",
  );
});

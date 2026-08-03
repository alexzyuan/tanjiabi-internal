import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoreOperatingReportRows,
  mapStoreOperatingBudgetMetrics,
} from "../src/services/storeOperatingMonthlyReportMapper.js";

test("budget target fields map only to the four confirmed report metrics", () => {
  assert.deepEqual(mapStoreOperatingBudgetMetrics({
    salesTarget: 100,
    adBudget: 10,
    refundTarget: 4,
    profitTarget: 20,
    purchaseCost: 30,
  }), {
    "net-sales": 100,
    "ad-spend": 10,
    refunds: 4,
    "sales-profit": 20,
  });
  assert.deepEqual(mapStoreOperatingBudgetMetrics({ salesTarget: null }), {});
});

test("missing order-profit fields stay unavailable rather than becoming zero", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, netSalesAmount: 90, totalSalesRefunds: 10, grossProfit: 20 }],
    budgetByMetric: { "net-sales": 120, "ad-spend": 18, refunds: 12, "sales-profit": 24 },
    currencyCode: "USD",
  });
  const advertising = result.rows.find((row) => row.key === "ad-spend");
  const netSales = result.rows.find((row) => row.key === "net-sales");

  assert.equal(advertising.actual, null);
  assert.equal(advertising.budget, 18);
  assert.equal(advertising.achievement, null);
  assert.equal(netSales.actual, 90);
  assert.equal(netSales.share, 1);
  assert.ok(result.unavailableMetrics.includes("ad-spend"));
});

test("only the four configured budget metrics receive a budget", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, netSalesAmount: 80, totalAdsCost: 8, totalSalesRefunds: 4, grossProfit: 16 }],
    budgetByMetric: { "net-sales": 120, "ad-spend": 20, refunds: 6, "sales-profit": 24 },
    currencyCode: "CNY",
  });

  assert.equal(result.rows.find((row) => row.key === "net-sales").achievement, 80 / 120);
  assert.equal(result.rows.find((row) => row.key === "ad-spend").budget, 20);
  assert.equal(result.rows.find((row) => row.key === "platform-fee").budget, null);
});

test("explicit zero values remain available while a zero budget has no achievement", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 0, netSalesAmount: 0, promotionDiscount: 0, totalSalesRefunds: 0, purchaseCost: 0, firstLegCost: 0, storageFee: 0, totalAdsCost: 0, platformFee: 0, fbaDeliveryFee: 0, grossProfit: 0 }],
    budgetByMetric: { "net-sales": 0, "ad-spend": 0, refunds: 0, "sales-profit": 0 },
    currencyCode: "USD",
  });
  const netSales = result.rows.find((row) => row.key === "net-sales");

  assert.equal(netSales.actual, 0);
  assert.equal(netSales.available, true);
  assert.equal(netSales.budget, 0);
  assert.equal(netSales.share, null);
  assert.equal(netSales.achievement, null);
  assert.deepEqual(result.unavailableMetrics, []);
});

test("an empty order-profit result does not manufacture zero actuals", () => {
  const result = buildStoreOperatingReportRows({
    records: [],
    budgetByMetric: { "net-sales": 120 },
    currencyCode: "USD",
  });

  assert.equal(result.rows.find((row) => row.key === "net-sales").actual, null);
  assert.ok(result.unavailableMetrics.includes("net-sales"));
});

test("whitespace, boolean, and non-numeric order-profit values are rejected instead of becoming zero", () => {
  for (const value of [" ", false, "not-a-number"]) {
    assert.throws(
      () => buildStoreOperatingReportRows({
        records: [{ totalAdsCost: value }],
        budgetByMetric: {},
        currencyCode: "USD",
      }),
      /订单利润字段 totalAdsCost 必须是有限数字/,
    );
  }
});

test("rows retain the confirmed category hierarchy and derived rows require every child", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, promotionDiscount: 5, totalSalesRefunds: 10, netSalesAmount: 85, purchaseCost: 30, firstLegCost: 8, storageFee: 2, totalAdsCost: 4, platformFee: 6, fbaDeliveryFee: 7, grossProfit: 28 }],
    budgetByMetric: {},
    currencyCode: "CNY",
  });
  const overview = result.rows.find((row) => row.key === "overview");
  const revenue = result.rows.find((row) => row.key === "revenue");
  const netSales = result.rows.find((row) => row.key === "net-sales");
  const salesCost = result.rows.find((row) => row.key === "sales-cost");
  const grossProfit = result.rows.find((row) => row.key === "gross-profit");

  assert.deepEqual({ category: overview.category, name: overview.name, level: overview.level }, { category: "总概", name: "总概", level: 0 });
  assert.deepEqual({ category: revenue.category, name: revenue.name, level: revenue.level }, { category: "销售收入", name: "销售收入", level: 1 });
  assert.equal(netSales.level, 2);
  assert.equal(netSales.category, "销售收入");
  assert.equal(salesCost.actual, 30);
  assert.equal(grossProfit.actual, 55);
  assert.equal(grossProfit.available, true);
  assert.deepEqual(grossProfit.children, ["revenue", "sales-cost"]);
});

test("gross profit is unavailable when a required hierarchy dependency is unavailable", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ netSalesAmount: 85 }],
    budgetByMetric: {},
    currencyCode: "CNY",
  });
  const grossProfit = result.rows.find((row) => row.key === "gross-profit");

  assert.equal(grossProfit.actual, null);
  assert.equal(grossProfit.available, false);
  assert.deepEqual(grossProfit.children, ["revenue", "sales-cost"]);
});

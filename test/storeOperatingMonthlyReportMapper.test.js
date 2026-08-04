import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoreOperatingReportRows,
  mapStoreOperatingBudgetRowScope,
  mapStoreOperatingBudgetMetrics,
  mapStoreOperatingOrderProfitBudgetScope,
  mapStoreOperatingSellerScope,
  readStoreOperatingBudgetCurrencyCode,
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

test("scope aliases are translated by the mapper boundary", () => {
  assert.deepEqual(mapStoreOperatingSellerScope({
    seller_id: 7,
    seller_name: "Store-US",
    marketplaceName: "美国",
  }), {
    sid: 7,
    name: "Store-US",
    country: "美国",
  });
  assert.deepEqual(mapStoreOperatingOrderProfitBudgetScope({
    report_date: "2026-07-31",
    store_name: "Store-US",
    country_name: "美国",
  }), {
    month: "2026-07",
    storeName: "Store-US",
    country: "美国",
  });
  assert.deepEqual(mapStoreOperatingBudgetRowScope({
    budgetMonth: "2026-07",
    store_name: "Store-US",
    site: "美国站",
  }), {
    month: "2026-07",
    storeName: "Store-US",
    country: "美国",
  });
  assert.equal(readStoreOperatingBudgetCurrencyCode({ currency_code: "USD" }), "USD");
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
  assert.equal(netSales.share, 0.9);
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
    records: [{ totalSalesAmount: 0, netSalesAmount: 0, promotionDiscount: 0, totalSalesRefunds: 0, totalSalesQuantity: 0, returnQuantity: 0, purchaseCost: 0, firstLegCost: 0, storageFee: 0, totalAdsCost: 0, platformFee: 0, fbaDeliveryFee: 0, operationsCost: 0, managementCost: 0, laborCost: 0, assetImpairment: 0, nonOperatingIncome: 0, nonOperatingExpense: 0 }],
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
    records: [{ totalSalesAmount: 100, promotionDiscount: 5, totalSalesRefunds: 10, netSalesAmount: 85, totalSalesQuantity: 100, returnQuantity: 0, purchaseCost: 30, firstLegCost: 8, storageFee: 2, totalAdsCost: 4, platformFee: 6, fbaDeliveryFee: 7 }],
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
  assert.deepEqual(grossProfit.children, []);
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
  assert.deepEqual(grossProfit.children, []);
});

test("signed Lingxing expenses become positive magnitudes while profit keeps its sign", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      promotionDiscount: -8,
      totalSalesRefunds: -5,
      totalSalesQuantity: 100,
      returnQuantity: 0,
      netSalesAmount: 87,
      purchaseCost: -30,
      firstLegCost: -3,
      storageFee: -2,
      totalAdsCost: -10,
      platformFee: -12,
      fbaDeliveryFee: -4,
      operationsCost: -1,
      managementCost: -1,
      laborCost: -1,
      assetImpairment: -1,
      nonOperatingIncome: 0,
      nonOperatingExpense: -1,
    }],
    currencyCode: "USD",
  });

  assert.equal(result.rows.find((row) => row.key === "sales-discount").actual, 8);
  assert.equal(result.rows.find((row) => row.key === "refunds").actual, 5);
  assert.equal(result.rows.find((row) => row.key === "purchase-cost").actual, 30);
  assert.equal(result.rows.find((row) => row.key === "ad-spend").actual, 10);
  assert.equal(result.rows.find((row) => row.key === "sales-profit").actual, 21);
});

test("profit chain uses sales income as the percentage base and derives return cost and two profit stages", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      promotionDiscount: -5,
      totalSalesRefunds: -10,
      totalSalesQuantity: 100,
      returnQuantity: 10,
      purchaseCost: -30,
      firstLegCost: -8,
      storageFee: -2,
      totalAdsCost: -4,
      platformFee: -6,
      fbaDeliveryFee: -7,
      operationsCost: -1,
      managementCost: -2,
      laborCost: -3,
      assetImpairment: -1,
      nonOperatingIncome: 2,
      nonOperatingExpense: -1,
    }],
    currencyCode: "USD",
  });
  const row = (key) => result.rows.find((item) => item.key === key);

  assert.equal(row("sales-income").actual, 100);
  assert.equal(row("sales-income").share, 1);
  assert.equal(row("sales-discount").share, 0.05);
  assert.equal(row("refunds").share, 0.1);
  assert.equal(row("net-sales").actual, 85);
  assert.equal(row("net-sales").share, 0.85);
  assert.equal(row("return-cost").actual, 3);
  assert.equal(row("net-sales-cost").actual, 27);
  assert.equal(row("gross-profit").actual, 58);
  assert.equal(row("platform-sales-profit").actual, 31);
  assert.equal(row("sales-profit").actual, 25);
  assert.deepEqual(row("sales-profit-category").children, ["sales-profit"]);
  const categoryKeys = result.rows.filter((item) => item.level === 1).map((item) => item.key);
  assert.ok(categoryKeys.indexOf("platform-profit-category") < categoryKeys.indexOf("operations"));
});

test("direct return-cost fields keep expense magnitudes positive", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, promotionDiscount: 0, totalSalesRefunds: 0, purchaseCost: -30, returnCost: -3 }],
    currencyCode: "USD",
  });

  assert.equal(result.rows.find((row) => row.key === "return-cost").actual, 3);
  assert.equal(result.rows.find((row) => row.key === "net-sales-cost").actual, 27);
});

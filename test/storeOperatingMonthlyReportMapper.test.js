import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoreOperatingReportRows,
  mapStoreOperatingBudgetRowScope,
  mapStoreOperatingBudgetMetrics,
  mapStoreOperatingOrderProfitBudgetScope,
  mapStoreOperatingSellerScope,
  mergeStoreOperatingCustomFeeRecords,
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
    records: [{ totalSalesAmount: 0, netSalesAmount: 0, promotionDiscount: 0, totalSalesRefunds: 0, totalSalesQuantity: 0, returnQuantity: 0, fbaReturnsUnsaleableQuantity: 0, cgUnitPrice: 0, cgTransportUnitCosts: 0, purchaseCost: 0, firstLegCost: 0, storageFee: 0, totalAdsCost: 0, platformFee: 0, fbaDeliveryFee: 0, operationsCost: 0, managementCost: 0, laborCost: 0, assetImpairment: 0, nonOperatingIncome: 0, nonOperatingExpense: 0 }],
    budgetByMetric: { "net-sales": 0, "ad-spend": 0, refunds: 0, "sales-profit": 0 },
    currencyCode: "USD",
  });
  const netSales = result.rows.find((row) => row.key === "net-sales");

  assert.equal(netSales.actual, 0);
  assert.equal(netSales.available, true);
  assert.equal(netSales.budget, 0);
  assert.equal(netSales.share, null);
  assert.equal(netSales.achievement, null);
  assert.ok(result.unavailableMetrics.includes("other-income"));
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
    records: [{ totalSalesAmount: 100, promotionDiscount: 5, totalSalesRefunds: 10, netSalesAmount: 85, totalSalesQuantity: 100, returnQuantity: 0, fbaReturnsUnsaleableQuantity: 0, cgUnitPrice: 0, cgTransportUnitCosts: 0, purchaseCost: 30, firstLegCost: 8, storageFee: 2, totalAdsCost: 4, platformFee: 6, fbaDeliveryFee: 7 }],
    budgetByMetric: {},
    currencyCode: "CNY",
  });
  const overview = result.rows.find((row) => row.key === "overview");
  const revenue = result.rows.find((row) => row.key === "platform-income");
  const netSales = result.rows.find((row) => row.key === "net-sales");
  const salesCost = result.rows.find((row) => row.key === "product-cost-expense");
  const grossProfit = result.rows.find((row) => row.key === "gross-profit");

  assert.deepEqual({ category: overview.category, name: overview.name, level: overview.level }, { category: "总概", name: "总概", level: 0 });
  assert.deepEqual({ category: revenue.category, name: revenue.name, level: revenue.level }, { category: "平台收入", name: "平台收入", level: 1 });
  assert.equal(netSales.level, 2);
  assert.equal(netSales.category, "平台收入");
  assert.equal(salesCost.actual, 38);
  assert.equal(grossProfit.actual, 55);
  assert.equal(grossProfit.available, true);
  assert.deepEqual(grossProfit.children, []);
});

test("monthly report exposes the five Lingxing-aligned top-level projects", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      promotionDiscount: -5,
      totalSalesRefunds: -10,
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
    budgetByMetric: {},
    currencyCode: "CNY",
  });

  const levelOne = result.rows.filter((row) => row.level === 1);
  assert.deepEqual(levelOne.filter((row) => row.key !== "basic-info").map((row) => row.name), [
    "平台收入",
    "平台支出",
    "商品成本支出",
    "自定义费用",
    "利润",
  ]);
  const childrenByName = Object.fromEntries(levelOne.map((row) => [row.name, row.children]));
  assert.deepEqual(childrenByName["平台收入"], ["sales-volume", "average-daily-sales", "multi-channel-sales-volume", "ads-sales-amount", "ads-volume", "sales-income", "net-sales", "buyer-shipping-fee", "sales-discount", "refunds", "return-volume", "refund-volume", "fba-inventory-compensation", "other-income"]);
  assert.deepEqual(childrenByName["平台支出"], ["platform-fee", "fba-delivery-fee", "other-order-fee", "storage-fee", "ad-fee", "ad-spend", "fba-international-shipping-fee", "inbound-placement-fee", "adjustment-fee", "other-platform-fee"]);
  assert.deepEqual(childrenByName["商品成本支出"], ["purchase-cost", "first-leg-cost", "other-product-cost"]);
  assert.deepEqual(childrenByName["自定义费用"], ["offsite-ad-spend", "office-expense", "office-rent", "certification-testing-fee", "office-supplies", "store-insurance-fee", "software-fee", "product-appearance-design-fee", "product-graphic-design-fee", "service-provider-fee", "office-courier-fee", "office-utility-fee", "credit-card-ad-fee", "office-telecom-fee", "sample-fee", "test-order-commission", "travel-expense", "employee-welfare-fee"]);
  assert.deepEqual(childrenByName["利润"], ["gross-profit", "gross-rate", "net-gross-rate"]);
  assert.equal(levelOne.some((row) => row.key === "basic-info"), false);
});

test("category subtotals use sales amount and available expense details", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      purchaseCost: -30,
      firstLegCost: -8,
      platformFee: -6,
      fbaDeliveryFee: -7,
      storageFee: -2,
      totalAdsCost: -4,
    }],
    currencyCode: "CNY",
  });
  const row = (key) => result.rows.find((item) => item.key === key);

  assert.equal(row("platform-income").actual, 100);
  assert.equal(row("platform-income").share, 1);
  assert.equal(row("platform-expense").actual, 19);
  assert.equal(row("product-cost-expense").actual, 38);
  assert.equal(row("custom-expense").actual, null);
  assert.equal(row("profit").actual, null);
});

test("direct OrderProfit profit fields populate profit subtotals", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, grossProfit: 58, profit: 25 }],
    currencyCode: "CNY",
  });
  const row = (key) => result.rows.find((item) => item.key === key);

  assert.equal(row("gross-profit").actual, 58);
  assert.equal(row("profit").actual, 25);
});

test("OrderProfit net gross margin is aggregated by sales amount", () => {
  const result = buildStoreOperatingReportRows({
    records: [
      { totalSalesAmount: 100, net_gross_margin: 0.1 },
      { totalSalesAmount: 900, net_gross_margin: 0.2 },
    ],
    currencyCode: "CNY",
  });

  assert.equal(result.rows.find((row) => row.key === "net-gross-rate").actual, 0.19);
});

test("monthly report uses the exact Lingxing subject and detail order from the approved field list", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      storeName: "Store-US",
      country: "美国",
      amount: 100,
      volume: 20,
    }],
    budgetByMetric: {},
    currencyCode: "CNY",
    storeName: "Store-US",
    country: "美国",
    periodDays: 10,
  });
  const rowNames = result.rows.map((row) => row.name);

  assert.deepEqual(rowNames, [
    "总概",
    "平台收入",
    "销量",
    "平均日销",
    "多渠道销量",
    "广告销售额",
    "广告销量",
    "销售额",
    "净销售额",
    "买家运费",
    "促销折扣",
    "退款金额",
    "退货量",
    "退款量",
    "FBA库存赔偿",
    "其它收入",
    "平台支出",
    "平台费",
    "FBA发货费",
    "其他订单费用",
    "仓储费",
    "广告费",
    "推广费",
    "FBA国际物流运费",
    "入库配置费",
    "调整费",
    "平台其它费",
    "商品成本支出",
    "采购成本",
    "头程成本",
    "其它成本",
    "自定义费用",
    "站外推广费",
    "办公费用",
    "办公费用-租金",
    "认证检测费",
    "办公用品",
    "店铺保险费",
    "软件费用",
    "产品外观设计费",
    "产品平面设计费",
    "服务商费用",
    "办公费用-快递费",
    "办公费用-水电费",
    "信用卡广告费",
    "办公费用-店铺通讯费",
    "样品费",
    "送测佣金（刷单）",
    "差旅费",
    "员工福利费",
    "利润",
    "毛利润",
    "毛利率",
    "净毛利率",
  ]);
  assert.equal(result.rows.some((row) => row.key === "store-country"), false);
});

test("monthly report maps the OrderProfit income fields returned by Lingxing", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      amount: 100,
      shipping_cost: "12.5",
      inventory_credit: "7.25",
      total_other_granted: "3.75",
    }],
    currencyCode: "CNY",
  });
  const row = (key) => result.rows.find((item) => item.key === key);

  assert.equal(row("buyer-shipping-fee").actual, 12.5);
  assert.equal(row("fba-inventory-compensation").actual, 7.25);
  assert.equal(row("other-income").actual, 3.75);
  assert.equal(row("buyer-shipping-fee").available, true);
  assert.equal(row("fba-inventory-compensation").available, true);
  assert.equal(row("other-income").available, true);
});

test("unavailable metrics expose their missing OrderProfit source fields", () => {
  const result = buildStoreOperatingReportRows({ records: [{ amount: 100, volume: 10 }] });
  const detail = result.unavailableMetricDetails.find((item) => item.key === "ad-fee");

  assert.deepEqual(detail, {
    key: "ad-fee",
    name: "广告费",
    category: "platform-expense",
    reason: "订单利润 API 未返回对应字段",
    fields: ["totalAdsCost", "total_ads_cost"],
  });
});

test("store-profit official fields populate the platform expense rows", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      totalAdsCost: -10,
      promotionFee: -2,
      sharedFbaIntegerernationalInboundFee: -3,
      sharedFbaInboundConvenienceFee: -4,
      adjustments: -5,
      totalPlatformOtherFee: -6,
      purchaseCost: -20,
      firstLegCost: -8,
      storageFee: -1,
      platformFee: -7,
      fbaDeliveryFee: -9,
      grossProfit: 60,
      profit: 20,
    }],
    currencyCode: "CNY",
  });
  const row = (key) => result.rows.find((item) => item.key === key);

  assert.equal(row("ad-fee").actual, 10);
  assert.equal(row("ad-spend").actual, 2);
  assert.equal(row("fba-international-shipping-fee").actual, 3);
  assert.equal(row("inbound-placement-fee").actual, 4);
  assert.equal(row("adjustment-fee").actual, 5);
  assert.equal(row("other-platform-fee").actual, 6);
});

test("custom fee records populate mapped store-level custom expense rows and expose unknown types", () => {
  const result = mergeStoreOperatingCustomFeeRecords(
    [{ sid: 7, storeName: "Store-US", country: "美国" }],
    [
      { sid: 7, other_fee_type: "软件费用", fee: -12 },
      { sid: 7, other_fee_type: "未配置科目", fee: -5 },
    ],
    [{ sid: 7, name: "Store-US", country: "美国" }],
  );

  assert.equal(result.records[0].softwareFee, -12);
  assert.deepEqual(result.unmapped, [{ sid: 7, storeName: "", type: "未配置科目", reason: "未识别费用类型" }]);
});

test("custom fee detail rows map each allocated store amount instead of the top-level total", () => {
  const result = mergeStoreOperatingCustomFeeRecords(
    [
      { sid: 17305, storeName: "tanjia-eu-UK", country: "英国" },
      { sid: 17307, storeName: "tanjia-eu-DE", country: "德国" },
    ],
    [{
      fee: -1684.23,
      other_fee_type: "信用卡广告费",
      currency_code: "CNY",
      details: [
        {
          fee: -115.46,
          dimension_value: "17305",
          store_infos: [{ id: 17305, name: "tanjia-eu-UK" }],
        },
        {
          fee: -1568.77,
          store_infos: [{ id: 17307, name: "tanjia-eu-DE" }],
        },
      ],
    }],
    [
      { sid: 17305, name: "tanjia-eu-UK", country: "英国" },
      { sid: 17307, name: "tanjia-eu-DE", country: "德国" },
    ],
  );

  assert.equal(result.records.find((record) => record.sid === 17305).creditCardAdFee, -115.46);
  assert.equal(result.records.find((record) => record.sid === 17307).creditCardAdFee, -1568.77);
  assert.deepEqual(result.applied.map(({ sid, amount }) => ({ sid, amount })), [
    { sid: 17305, amount: -115.46 },
    { sid: 17307, amount: -1568.77 },
  ]);
  assert.deepEqual(result.unmapped, []);
});

test("custom fee type-name aliases map every approved expense subject", () => {
  const subjects = [
    ["办公费用", "office-expense"],
    ["办公费用-租金", "office-rent"],
    ["认证检测费", "certification-testing-fee"],
    ["办公用品", "office-supplies"],
    ["软件费用", "software-fee"],
    ["产品外观设计费", "product-appearance-design-fee"],
    ["产品平面设计费", "product-graphic-design-fee"],
    ["服务商费用", "service-provider-fee"],
    ["办公费用-快递费", "office-courier-fee"],
    ["办公费用-水电费", "office-utility-fee"],
    ["信用卡广告费", "credit-card-ad-fee"],
    ["办公费用-店铺通讯费", "office-telecom-fee"],
    ["样品费", "sample-fee"],
    ["送测佣金（刷单）", "test-order-commission"],
    ["差旅费", "travel-expense"],
    ["员工福利费", "employee-welfare-fee"],
    ["店铺保险费", "store-insurance-fee"],
  ];
  const result = mergeStoreOperatingCustomFeeRecords(
    [{ sid: 7, storeName: "Store-US", country: "美国" }],
    subjects.map(([type]) => ({ sid: 7, fee_type_name: type, fee: -1 })),
    [{ sid: 7, name: "Store-US", country: "美国" }],
  );

  assert.deepEqual(result.unmapped, []);
  const mapped = buildStoreOperatingReportRows({ records: result.records, currencyCode: "CNY" });
  for (const [, key] of subjects) assert.equal(mapped.rows.find((row) => row.key === key).actual, 1);
});

test("custom fees with a valid sid never fall back to another store with the same name", () => {
  const result = mergeStoreOperatingCustomFeeRecords(
    [{ sid: 1, storeName: "Shared Store", country: "美国" }],
    [{ sid: 2, storeName: "Shared Store", other_fee_type: "软件费用", fee: -12 }],
    [{ sid: 2, name: "Shared Store", country: "加拿大" }],
  );

  assert.equal(result.records.find((record) => record.sid === 1).softwareFee, undefined);
  assert.deepEqual(result.records.find((record) => record.sid === 2), {
    sid: 2,
    storeName: "Shared Store",
    country: "加拿大",
    currencyCode: "",
    softwareFee: -12,
  });
  assert.deepEqual(result.unmapped, []);
});

test("seller profit custom order fee principal and commission are combined as offsite promotion expense", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, customOrderFeePrincipal: -8, customOrderFeeCommission: -2 }],
    currencyCode: "CNY",
  });
  assert.equal(result.rows.find((row) => row.key === "offsite-ad-spend").actual, 10);
});

test("sparse store-level custom fee fields are summed across order-profit rows", () => {
  const result = buildStoreOperatingReportRows({
    records: [
      { sid: 1, totalSalesAmount: 100 },
      { sid: 2, totalSalesAmount: 100, creditCardAdFee: -10 },
    ],
    currencyCode: "CNY",
  });

  assert.equal(result.rows.find((row) => row.key === "credit-card-ad-fee").actual, 10);
  assert.equal(result.rows.find((row) => row.key === "custom-expense").actual, 10);
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
      fbaReturnsUnsaleableQuantity: 0,
      cgUnitPrice: 0,
      cgTransportUnitCosts: 0,
      netSalesAmount: 87,
      purchaseCost: -30,
      firstLegCost: -3,
      storageFee: -2,
      totalAdsCost: -10,
      promotionFee: 0,
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
  assert.equal(result.rows.find((row) => row.key === "ad-fee").actual, 10);
  assert.equal(result.rows.find((row) => row.key === "profit").actual, 21);
});

test("profit chain uses sales income as the percentage base and derives return cost and two profit stages", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      promotionDiscount: -5,
      totalSalesRefunds: -10,
      totalSalesQuantity: 100,
      returnQuantity: 10,
      fbaReturnsUnsaleableQuantity: 1,
      cgUnitPrice: -3,
      cgTransportUnitCosts: 0,
      purchaseCost: -30,
      firstLegCost: -8,
      storageFee: -2,
      totalAdsCost: -4,
      promotionFee: 0,
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
  assert.equal(row("profit").actual, 25);
  assert.equal(row("gross-rate").actual, 58 / 100);
  assert.equal(row("net-gross-rate").actual, 25 / 100);
  assert.equal(row("gross-profit").actual, 58);
  assert.deepEqual(row("profit").children, ["gross-profit", "gross-rate", "net-gross-rate"]);
  const categoryKeys = result.rows.filter((item) => item.level === 1).map((item) => item.key);
  assert.deepEqual(categoryKeys, ["platform-income", "platform-expense", "product-cost-expense", "custom-expense", "profit"]);
});

test("direct return-cost fields keep expense magnitudes positive", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, promotionDiscount: 0, totalSalesRefunds: 0, purchaseCost: -30, firstLegCost: 0, returnCost: -3 }],
    currencyCode: "USD",
  });

  assert.equal(result.rows.find((row) => row.key === "product-cost-expense").actual, 27);
});

test("不可售退货成本使用利润报表的不可售退货量、采购单价和单位头程成本", () => {
  const result = buildStoreOperatingReportRows({
    records: [{
      totalSalesAmount: 100,
      promotionDiscount: 0,
      totalSalesRefunds: 0,
      purchaseCost: -30,
      firstLegCost: 0,
      fbaReturnsUnsaleableQuantity: 5,
      cgUnitPrice: -5.6,
      cgTransportUnitCosts: -1,
    }],
    budgetByMetric: {},
    currencyCode: "USD",
  });

  assert.equal(result.rows.find((row) => row.key === "product-cost-expense").actual, -3);
});

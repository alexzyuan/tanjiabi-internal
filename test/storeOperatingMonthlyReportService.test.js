import assert from "node:assert/strict";
import test from "node:test";
import {
  getStoreOperatingMonthlyReport as getStoreOperatingMonthlyReportWithLogging,
  normalizeStoreOperatingMonthlyReportFilters,
} from "../src/services/storeOperatingMonthlyReportService.js";

const silentLogger = { info() {}, error() {} };

function getStoreOperatingMonthlyReport(filters, dependencies = {}) {
  return getStoreOperatingMonthlyReportWithLogging(filters, { logger: silentLogger, ...dependencies });
}

function fakeAdapter({ sellers, recordsForCall, calls = [] }) {
  return {
    async fetchSellers() {
      return { data: sellers };
    },
    normalizeRecordList(payload) {
      return Array.isArray(payload) ? payload : payload.data || [];
    },
    async fetchMskuOrderProfit(request) {
      calls.push(request);
      return recordsForCall(request);
    },
    normalizeMskuOrderProfitRecords(records, sellerList, reportDate) {
      const sellerBySid = new Map(sellerList.map((seller) => [Number(seller.sid), seller]));
      return records.map((record) => {
        const seller = sellerBySid.get(Number(record.sid)) || {};
        return {
          ...record,
          storeName: record.storeName || seller.name || "",
          country: record.country || seller.country || "",
          reportDate,
        };
      });
    },
  };
}

test("service rejects a 13-month range without changing either boundary", () => {
  const input = { startMonth: "2025-01", endMonth: "2026-01" };

  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters(input),
    /最多 12 个月/,
  );
  assert.deepEqual(input, { startMonth: "2025-01", endMonth: "2026-01" });
});

test("service sums each requested month and uses CNY for multiple effective countries", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    calls,
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 40, currencyCode: "CNY" },
      { sid: 2, netSalesAmount: 50, currencyCode: "CNY" },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-06", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }),
      now: () => new Date("2026-08-03T08:00:00.000Z"),
    },
  );

  assert.equal(value.meta.currencyMode, "CNY");
  assert.deepEqual(calls.map((call) => call.currencyCode), ["CNY", "CNY"]);
  assert.deepEqual(calls.map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: "2026-06-01", endDate: "2026-06-30" },
    { startDate: "2026-07-01", endDate: "2026-07-31" },
  ]);
  assert.equal(value.rows.find((row) => row.key === "net-sales").actual, 180);
  assert.equal(value.meta.generatedAt, "2026-08-03T08:00:00.000Z");
});

test("single-country result separates original API currencies", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "USD" },
      { sid: 1, netSalesAmount: 30, currencyCode: "CAD" },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", countries: ["美国"] },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }),
    },
  );

  assert.equal(value.meta.currencyMode, "ORIGINAL");
  assert.deepEqual(value.groups.map((group) => group.currencyCode), ["CAD", "USD"]);
  assert.deepEqual(value.groups.map((group) => group.rows.find((row) => row.key === "net-sales").actual), [30, 90]);
});

test("service accepts one and twelve months but rejects missing, invalid, and reversed ranges", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    calls,
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });
  const budget = async () => ({ rows: [], totals: {}, matched: false });

  const oneMonth = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-02", endMonth: "2026-02" },
    { adapter, getBudgetTargetContext: budget },
  );
  assert.deepEqual(oneMonth.filters.months, ["2026-02"]);
  assert.deepEqual(calls[0], {
    startDate: "2026-02-01",
    endDate: "2026-02-28",
    sids: [1],
    currencyCode: "ORIGINAL",
  });

  calls.length = 0;
  const twelveMonths = await getStoreOperatingMonthlyReport(
    { startMonth: "2025-08", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: budget },
  );
  assert.equal(twelveMonths.filters.months.length, 12);
  assert.equal(calls.length, 12);
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2026-13", endMonth: "2026-13" }),
    /请选择开始月份和结束月份/,
  );
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2026-08", endMonth: "2026-07" }),
    /结束月份不能早于开始月份/,
  );
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "", endMonth: "2026-07" }),
    /请选择开始月份和结束月份/,
  );
});

test("empty store and country filters use every seller and pass the effective scope to budgets", async () => {
  const calls = [];
  let budgetScope;
  const adapter = fakeAdapter({
    calls,
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [],
  });

  await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", stores: [], countries: [] },
    {
      adapter,
      getBudgetTargetContext: async (scope) => {
        budgetScope = scope;
        return { rows: [], totals: {}, matched: false };
      },
    },
  );

  assert.deepEqual(calls[0].sids, [1, 2]);
  assert.deepEqual(budgetScope, {
    months: ["2026-07"],
    storeNames: ["Store-US", "Store-CA"],
    countries: ["美国", "加拿大"],
  });
});

test("country filter aliases select canonical seller countries without rewriting visible filters", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    calls,
    sellers: [
      { sid: 1, name: "Store-AU", country: "澳大利亚" },
      { sid: 2, name: "Store-US", country: "美国站" },
    ],
    recordsForCall: () => [],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", countries: ["澳大利亚", "美国站"] },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  assert.deepEqual(calls[0].sids, [1, 2]);
  assert.deepEqual(value.filters.countries, ["澳大利亚", "美国站"]);
  assert.equal(value.meta.currencyMode, "CNY");
});

test("store and country filters intersect, and an empty effective scope never calls an unscoped API", async () => {
  const calls = [];
  let budgetCalls = 0;
  const adapter = fakeAdapter({
    calls,
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [],
  });

  const value = await getStoreOperatingMonthlyReport(
    {
      startMonth: "2026-07",
      endMonth: "2026-07",
      stores: ["Store-US"],
      countries: ["加拿大"],
    },
    {
      adapter,
      getBudgetTargetContext: async () => {
        budgetCalls += 1;
        return { rows: [], totals: {}, matched: false };
      },
    },
  );

  assert.equal(calls.length, 0);
  assert.equal(budgetCalls, 0);
  assert.equal(value.meta.recordCount, 0);
  assert.deepEqual(value.rows, []);
  assert.deepEqual(value.groups, []);
  assert.equal(value.budgetStatus.state, "unconfigured");
});

test("a blank original API currency remains an explicit unavailable group", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 10, currencyCode: "" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].currencyCode, "");
  assert.equal(value.groups[0].currencyAvailable, false);
  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").actual, 10);
});

test("original mode never assigns a budget row to an inferred currency", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 90, currencyCode: "USD" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [{ month: "2026-07", storeName: "Store-US", site: "美国", salesTarget: 100 }],
        matched: true,
      }),
    },
  );

  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").budget, null);
  assert.equal(value.meta.missingExchangeRateCount, 0);
  assert.equal(value.budgetStatus.state, "unavailable");
});

test("original mode uses only an explicitly declared budget currency", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "USD" },
      { sid: 1, netSalesAmount: 20, currencyCode: "CAD" },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [{ month: "2026-07", storeName: "Store-US", site: "美国", currencyCode: "USD", salesTarget: 100 }],
        matched: true,
      }),
    },
  );

  assert.equal(value.groups.find((group) => group.currencyCode === "USD").rows.find((row) => row.key === "net-sales").budget, 100);
  assert.equal(value.groups.find((group) => group.currencyCode === "CAD").rows.find((row) => row.key === "net-sales").budget, null);
  assert.equal(value.budgetStatus.state, "partial");
});

test("a blank original API currency never receives a blank-currency budget", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 90, currencyCode: "" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [{ month: "2026-07", storeName: "Store-US", site: "美国", currencyCode: "", salesTarget: 100 }],
        matched: true,
      }),
    },
  );

  assert.equal(value.groups[0].currencyCode, "");
  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").budget, null);
  assert.equal(value.budgetStatus.state, "unavailable");
});

test("service rejects a budget dependency result without an array of rows", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });

  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07" },
      { adapter, getBudgetTargetContext: async () => ({ matched: false }) },
    ),
    /预算上下文 rows 必须是数组/,
  );
});

test("CNY mode converts each budget row only with its matching Lingxing month-store-country rate", async () => {
  const adapter = fakeAdapter({
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: ({ startDate }) => startDate === "2026-06-01"
      ? [
        { sid: 1, netSalesAmount: 70, currencyCode: "USD", exchangeRate: 7 },
        { sid: 2, netSalesAmount: 50, currencyCode: "CAD", exchangeRate: 5 },
      ]
      : [
        { sid: 1, netSalesAmount: 77, currencyCode: "USD", exchangeRate: 7 },
        { sid: 2, netSalesAmount: 60, currencyCode: "CAD", exchangeRate: 5 },
      ],
  });
  const budgetRows = [
    { month: "2026-06", storeName: "Store-US", site: "美国", salesTarget: 10, adBudget: 1, refundTarget: 0.5, profitTarget: 2 },
    { month: "2026-06", storeName: "Store-CA", site: "加拿大", salesTarget: 10, adBudget: 1, refundTarget: 0.5, profitTarget: 2 },
    { month: "2026-07", storeName: "Store-US", site: "美国", salesTarget: 11, adBudget: 1.1, refundTarget: 0.5, profitTarget: 2.2 },
    { month: "2026-07", storeName: "Store-CA", site: "加拿大", salesTarget: 12, adBudget: 1.2, refundTarget: 0.5, profitTarget: 2.4 },
  ];

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-06", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: budgetRows, matched: true }),
    },
  );

  assert.equal(value.rows.find((row) => row.key === "net-sales").budget, 257);
  assert.ok(Math.abs(value.rows.find((row) => row.key === "ad-spend").budget - 25.7) < Number.EPSILON * 20);
  assert.equal(value.meta.missingExchangeRateCount, 0);
  assert.equal(value.budgetStatus.state, "configured");
});

test("a missing Lingxing rate makes CNY budgets unavailable without a partial or synthetic sum", async () => {
  const adapter = fakeAdapter({
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 70, currencyCode: "USD", exchangeRate: 7 },
      { sid: 2, netSalesAmount: 50, currencyCode: "CAD", exchangeRate: "", cnyAmount: 50 },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [
          { month: "2026-07", storeName: "Store-US", site: "美国", salesTarget: 10 },
          { month: "2026-07", storeName: "Store-CA", site: "加拿大", salesTarget: 10 },
        ],
        matched: true,
      }),
    },
  );

  assert.equal(value.rows.find((row) => row.key === "net-sales").budget, null);
  assert.equal(value.meta.missingExchangeRateCount, 1);
  assert.equal(value.budgetStatus.state, "partial");
});

test("unconfigured budgets and zero denominators remain explicit", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 0, currencyCode: "USD" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }) },
  );
  const netSales = value.rows.find((row) => row.key === "net-sales");

  assert.equal(netSales.actual, 0);
  assert.equal(netSales.budget, null);
  assert.equal(netSales.share, null);
  assert.equal(netSales.achievement, null);
  assert.equal(value.budgetStatus.state, "unconfigured");
});

test("order-profit and budget failures propagate instead of becoming empty results", async () => {
  const orderError = new Error("订单利润上游失败");
  const budgetError = new Error("预算读取失败");
  const failingOrderAdapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => { throw orderError; },
  });
  const passingAdapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });

  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07" },
      { adapter: failingOrderAdapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
    ),
    (error) => error === orderError,
  );
  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07" },
      { adapter: passingAdapter, getBudgetTargetContext: async () => { throw budgetError; } },
    ),
    (error) => error === budgetError,
  );
});

test("service logs trace metadata without order or budget payloads", async () => {
  const entries = [];
  const logger = {
    info(label, details) { entries.push({ level: "info", label, details }); },
    error(label, details) { entries.push({ level: "error", label, details }); },
  };
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 10, currencyCode: "USD", secretOrderValue: "do-not-log" }],
  });

  await getStoreOperatingMonthlyReportWithLogging(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [{ month: "2026-07", storeName: "Store-US", salesTarget: 10, secretBudgetValue: "do-not-log" }],
        matched: true,
      }),
      logger,
    },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "info");
  assert.match(entries[0].details.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(entries[0].details.range, "2026-07/2026-07");
  assert.equal(entries[0].details.currencyMode, "ORIGINAL");
  assert.equal(entries[0].details.recordCount, 1);
  assert.equal(entries[0].details.budgetMatchCount, 1);
  assert.equal(typeof entries[0].details.elapsedMs, "number");
  assert.doesNotMatch(JSON.stringify(entries), /do-not-log/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  exportStoreOperatingMonthlyReportXlsx,
  getStoreOperatingMonthlyReport as getStoreOperatingMonthlyReportWithLogging,
  normalizeStoreOperatingMonthlyReportFilters,
} from "../src/services/storeOperatingMonthlyReportService.js";

const silentLogger = { info() {}, error() {} };

function getStoreOperatingMonthlyReport(filters, dependencies = {}) {
  const adapter = dependencies.adapter;
  const { logger = silentLogger, ...restDependencies } = dependencies;
  const salesFacts = restDependencies.salesFacts || (adapter ? {
    async refreshMonthlyReportScope(scope) {
      const sellerPayload = await adapter.fetchSellers();
      const sellerList = adapter.normalizeRecordList(sellerPayload);
      const months = [...new Set(scope.dates.map((date) => date.slice(0, 7)))];
      const facts = [];
      const customFees = [];
      let cacheState = "hit";
      for (const month of months) {
        const startDate = scope.dates.find((date) => date.startsWith(month)) || `${month}-01`;
        const endDate = scope.dates.filter((date) => date.startsWith(month)).at(-1) || `${month}-28`;
        const request = {
          startDate,
          endDate,
          sids: scope.sids,
          currencyCode: scope.currencyMode,
        };
        const orderResult = typeof adapter.fetchMskuOrderProfitCached === "function"
          ? await adapter.fetchMskuOrderProfitCached({ ...request, sellerList, reportDate: month })
          : await adapter.fetchMskuOrderProfit(request);
        cacheState = orderResult?.cacheState || cacheState;
        const orderRows = orderResult?.records || adapter.normalizeRecordList(orderResult);
        const normalizedRows = typeof adapter.normalizeMskuOrderProfitRecords === "function"
          ? adapter.normalizeMskuOrderProfitRecords(orderRows, sellerList, month)
          : orderRows;
        normalizedRows.forEach((row) => {
          const sid = Number(row.sid || row.seller_id || row.sellerId || row.store_id || row.storeId);
          const seller = sellerList.find((item) => Number(item.sid) === sid) || {};
          const msku = String(row.msku || row.MSKU || row.seller_sku || `test-${sid}`).trim();
          facts.push({
            ...row,
            factDate: row.factDate || startDate,
            sid,
            msku,
            mskuKey: String(row.mskuKey || msku).toLowerCase(),
            currencyMode: scope.currencyMode,
            actualCurrencyCode: row.actualCurrencyCode || row.currencyCode || (scope.currencyMode === "CNY" ? "CNY" : ""),
            storeName: row.storeName || seller.name || "",
            country: row.country || seller.country || "",
          });
        });
        if (typeof adapter.fetchSellerProfitReport === "function"
          && typeof adapter.normalizeSellerProfitOtherFeeRecords === "function") {
          const feePayload = await adapter.fetchSellerProfitReport({
            startDate: month,
            endDate: month,
            sids: scope.sids,
            currencyCode: scope.currencyMode,
            monthlyQuery: true,
            summaryEnabled: true,
          });
          const feeRows = adapter.normalizeSellerProfitOtherFeeRecords(adapter.normalizeRecordList(feePayload), sellerList, month);
          feeRows.forEach((row) => customFees.push({
            naturalMonth: month,
            sid: Number(row.sid),
            feeTypeId: String(row.other_fee_type_id || row.feeTypeId || ""),
            feeName: String(row.other_fee_type || row.feeName || ""),
            feeAmount: row.feeAmount ?? row.fee,
            currencyMode: scope.currencyMode,
            actualCurrencyCode: row.actualCurrencyCode || row.currencyCode || (scope.currencyMode === "CNY" ? "CNY" : ""),
          }));
        }
      }
      return {
        facts,
        customFees,
        meta: { source: "sales-facts-sqlite", cacheState, updatedAt: "2026-08-13T00:00:00.000Z" },
      };
    },
  } : undefined);
  return getStoreOperatingMonthlyReportWithLogging(filters, { ...restDependencies, logger, salesFacts });
}

function fakeAdapter({ sellers, recordsForCall, feeRecordsForCall = () => [], calls = [] }) {
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
    async fetchSellerProfitReport(request) {
      calls.push({ ...request, source: "seller-profit" });
      return recordsForCall(request);
    },
    normalizeSellerProfitOtherFeeRecords(records, sellerList, reportDate) {
      return records.flatMap((record) => (Array.isArray(record.otherFeeStr) ? record.otherFeeStr.map((fee) => ({
        sid: record.sid,
        storeName: record.storeName || sellerList.find((seller) => Number(seller.sid) === Number(record.sid))?.name || "",
        country: record.country || sellerList.find((seller) => Number(seller.sid) === Number(record.sid))?.country || "",
        currencyCode: record.currencyCode || "",
        reportDate,
        other_fee_type: fee.otherFeeName,
        other_fee_type_id: fee.otherFeeTypeId,
        fee: fee.feeAllocation,
      })) : []));
    },
    async fetchOtherFeeList(request) {
      return { data: feeRecordsForCall(request) };
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

test("monthly report keeps OrderProfit as its primary source and reads custom fees from seller profit otherFeeStr", async () => {
  const calls = [];
  let shadowCalls = 0;
  const adapter = fakeAdapter({
    calls,
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, totalSalesAmount: 100, currencyCode: "CNY" }],
  });
  adapter.fetchSellerProfitReport = async (request) => {
    calls.push({ ...request, source: "seller-profit" });
    return { data: [{
      sid: 1,
      storeName: "Store-US",
      country: "美国",
      currencyCode: "CNY",
      otherFeeStr: [{ otherFeeName: "软件费用", otherFeeTypeId: 2, feeAllocation: -8 }],
    }] };
  };
  adapter.fetchMskuOrderProfitCached = async () => {
    calls.push({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      sids: [1],
      currencyCode: "CNY",
      source: "order-profit",
    });
    return { records: [{ sid: 1, totalSalesAmount: 100, currencyCode: "CNY" }] };
  };

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }),
      salesFactsShadow: {
        enabled: true,
        readNewFacts: async () => { shadowCalls += 1; throw new Error("shadow facts unavailable"); },
        logger: silentLogger,
      },
    },
  );

  assert.equal(calls.filter((call) => call.source === "order-profit").length, 1);
  assert.equal(calls.filter((call) => call.source === "seller-profit").length, 1);
  assert.equal(value.meta.source, "sales-facts-sqlite");
  assert.equal(value.rows.find((row) => row.key === "software-fee").actual, 8);
  assert.equal(shadowCalls, 0);
});

test("monthly report sends exact partial-month boundaries for a date range", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    calls,
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });

  await getStoreOperatingMonthlyReport(
    { startDate: "2026-08-01", endDate: "2026-08-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  const orderProfitCall = calls.find((call) => call.source !== "seller-profit");
  const sellerProfitCall = calls.find((call) => call.source === "seller-profit");
  assert.equal(orderProfitCall.startDate, "2026-08-01");
  assert.equal(orderProfitCall.endDate, "2026-08-07");
  assert.equal(sellerProfitCall.startDate, "2026-08");
  assert.equal(sellerProfitCall.endDate, "2026-08");
});

test("monthly report splits a cross-month date range at natural month boundaries", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    calls,
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });

  await getStoreOperatingMonthlyReport(
    { startDate: "2026-07-20", endDate: "2026-08-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  const orderProfitCalls = calls.filter((call) => call.source !== "seller-profit");
  const sellerProfitCalls = calls.filter((call) => call.source === "seller-profit");
  assert.deepEqual(orderProfitCalls.map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: "2026-07-20", endDate: "2026-07-31" },
    { startDate: "2026-08-01", endDate: "2026-08-07" },
  ]);
  assert.deepEqual(sellerProfitCalls.map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: "2026-07", endDate: "2026-07" },
    { startDate: "2026-08", endDate: "2026-08" },
  ]);
});

test("monthly report applies seller profit otherFeeStr allocations to the matching subject row", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 7, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });
  adapter.fetchSellerProfitReport = async () => ({ data: [{
    sid: 7,
    storeName: "Store-US",
    country: "美国",
    currencyCode: "CNY",
    otherFeeStr: [{ otherFeeName: "店铺保险费", otherFeeTypeId: 1, feeAllocation: -125.9 }],
  }] });
  adapter.fetchMskuOrderProfitCached = async () => ({
    records: [{ sid: 7, totalSalesAmount: 100, currencyCode: "CNY" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }) },
  );

  const insuranceRow = value.rows.find((row) => row.key === "store-insurance-fee");
  assert.equal(insuranceRow.actual, 125.9);
  assert.equal(value.meta.customFeeRecordCount, 1);
  assert.equal(value.meta.unmappedCustomFeeCount, 0);
});

test("service rejects a 13-month range without changing either boundary", () => {
  const input = { startMonth: "2025-01", endMonth: "2026-01" };

  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters(input),
    /最多 12 个月/,
  );
  assert.deepEqual(input, { startMonth: "2025-01", endMonth: "2026-01" });
});

test("service rejects a future end date instead of requesting projected monthly profit", () => {
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      today: new Date("2026-08-07T08:00:00.000Z"),
    }),
    /结束日期不能晚于今天/,
  );
});

test("monthly report defaults to CNY and accepts ORIGINAL as the explicit original-currency mode", () => {
  assert.equal(normalizeStoreOperatingMonthlyReportFilters({
    startMonth: "2026-07",
    endMonth: "2026-07",
  }).currencyCode, "CNY");
  assert.equal(normalizeStoreOperatingMonthlyReportFilters({
    startMonth: "2026-07",
    endMonth: "2026-07",
    currencyCode: "original",
  }).currencyCode, "ORIGINAL");
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({
      startMonth: "2026-07",
      endMonth: "2026-07",
      currencyCode: "USD",
    }),
    /币种必须是 CNY 或 ORIGINAL/,
  );
});

test("filter validation errors carry HTTP 400 while dependency failures remain unclassified for 502 routes", async () => {
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2026-13", endMonth: "2026-13" }),
    (error) => error.statusCode === 400 && error.name === "StoreOperatingMonthlyReportInputError",
  );
  const dependencyError = new Error("Lingxing unavailable");
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => { throw dependencyError; },
  });
  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07" },
      { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
    ),
    (error) => error === dependencyError && error.statusCode === undefined,
  );
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
  const orderProfitCalls = calls.filter((call) => call.source !== "seller-profit");
  assert.deepEqual(orderProfitCalls.map((call) => call.currencyCode), ["CNY", "CNY"]);
  assert.deepEqual(orderProfitCalls.map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: "2026-06-01", endDate: "2026-06-30" },
    { startDate: "2026-07-01", endDate: "2026-07-31" },
  ]);
  assert.equal(value.rows.find((row) => row.key === "net-sales").actual, 180);
  assert.equal(value.meta.generatedAt, "2026-08-03T08:00:00.000Z");
});

test("monthly report prefers the shared cached OrderProfit adapter method", async () => {
  const calls = [];
  let rawCalls = 0;
  const adapter = fakeAdapter({
    calls,
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => {
      rawCalls += 1;
      return [];
    },
  });
  adapter.fetchMskuOrderProfitCached = async (request) => {
    calls.push(request);
    return {
      records: [{ sid: 1, netSalesAmount: 25, currencyCode: "CNY", reportDate: request.endDate }],
      cacheState: "hit",
      cacheUpdatedAt: "2026-08-04 10:00:00",
    };
  };

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }) },
  );

  assert.equal(rawCalls, 1);
  const [orderProfitCall] = calls.filter((call) => call.source !== "seller-profit");
  assert.equal(orderProfitCall.currencyCode, "CNY");
  assert.equal(orderProfitCall.startDate, "2026-07-01");
  assert.equal(orderProfitCall.endDate, "2026-07-31");
  assert.equal(value.meta.recordCount, 1);
});

test("single-country result uses CNY by default instead of silently switching to original currencies", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "CNY" },
      { sid: 1, netSalesAmount: 30, currencyCode: "CNY" },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", countries: ["美国"] },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }),
    },
  );

  assert.equal(value.meta.currencyMode, "CNY");
  assert.deepEqual(value.groups.map((group) => group.currencyCode), ["CNY"]);
  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").actual, 120);
});

test("single-country ORIGINAL filter preserves separate API currencies", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "USD" },
      { sid: 1, netSalesAmount: 30, currencyCode: "CAD" },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", countries: ["美国"], currencyCode: "ORIGINAL" },
    {
      adapter,
      getBudgetTargetContext: async () => ({ rows: [], totals: {}, matched: false }),
    },
  );

  assert.equal(value.meta.currencyMode, "ORIGINAL");
  assert.deepEqual(value.groups.map((group) => group.currencyCode), ["CAD", "USD"]);
  assert.deepEqual(value.groups.map((group) => group.rows.find((row) => row.key === "net-sales").actual), [30, 90]);
});

test("ORIGINAL currency mode rejects multiple effective countries instead of hiding a conversion", async () => {
  const adapter = fakeAdapter({
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [],
  });

  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL" },
      { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
    ),
    /跨国家只能使用人民币/,
  );
});

test("selected stores create separate report groups with store-scoped budgets", async () => {
  const adapter = fakeAdapter({
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "CNY", exchangeRate: 7 },
      { sid: 2, netSalesAmount: 50, currencyCode: "CNY", exchangeRate: 5 },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", stores: ["Store-US", "Store-CA"] },
    {
      adapter,
      getBudgetTargetContext: async () => ({
        rows: [
          { month: "2026-07", storeName: "Store-US", site: "美国", salesTarget: 10 },
          { month: "2026-07", storeName: "Store-CA", site: "加拿大", salesTarget: 20 },
        ],
        matched: true,
      }),
    },
  );

  assert.deepEqual(value.groups.map((group) => group.storeName), ["Store-US", "Store-CA"]);
  assert.deepEqual(value.groups.map((group) => group.currencyCode), ["CNY", "CNY"]);
  assert.deepEqual(value.groups.map((group) => group.rows.find((row) => row.key === "net-sales").actual), [90, 50]);
  assert.deepEqual(value.groups.map((group) => group.rows.find((row) => row.key === "net-sales").budget), [70, 100]);
});

test("without a store filter the report uses one all-store total group", async () => {
  const adapter = fakeAdapter({
    sellers: [
      { sid: 1, name: "Store-US", country: "美国" },
      { sid: 2, name: "Store-CA", country: "加拿大" },
    ],
    recordsForCall: () => [
      { sid: 1, netSalesAmount: 90, currencyCode: "CNY", exchangeRate: 7 },
      { sid: 2, netSalesAmount: 50, currencyCode: "CNY", exchangeRate: 5 },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].storeName, "全部店铺");
  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").actual, 140);
});

test("all-store header scope remains visible when a single-country query has no records", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [],
  });
  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", countries: ["美国"] },
    { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
  );

  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].storeName, "全部店铺");
  assert.equal(value.groups[0].currencyAvailable, true);
  assert.equal(value.groups[0].rows.find((row) => row.key === "net-sales").actual, null);
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
    { startMonth: "2026-02", endMonth: "2026-02", currencyCode: "CNY" },
    { adapter, getBudgetTargetContext: budget },
  );
  assert.deepEqual(oneMonth.filters.months, ["2026-02"]);
  assert.deepEqual(calls[0], {
    startDate: "2026-02-01",
    endDate: "2026-02-28",
    sids: [1],
    currencyCode: "CNY",
  });

  calls.length = 0;
  const twelveMonths = await getStoreOperatingMonthlyReport(
    { startMonth: "2025-08", endMonth: "2026-07" },
    { adapter, getBudgetTargetContext: budget },
  );
  assert.equal(twelveMonths.filters.months.length, 12);
  assert.equal(calls.filter((call) => call.source !== "seller-profit").length, 12);
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2026-13", endMonth: "2026-13" }),
    /请选择开始日期和结束日期/,
  );
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2026-08", endMonth: "2026-07" }),
    /结束日期不能早于开始日期/,
  );
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "", endMonth: "2026-07" }),
    /请选择开始日期和结束日期/,
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

test("a blank original API currency fails the canonical facts contract", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 10, currencyCode: "" }],
  });

  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL" },
      { adapter, getBudgetTargetContext: async () => ({ rows: [], matched: false }) },
    ),
    /实际币种(?:与请求范围不一致|缺失)/,
  );
});

test("original mode never assigns a budget row to an inferred currency", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 90, currencyCode: "USD" }],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL" },
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
    { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL" },
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

test("a blank original API currency is rejected before budget mapping", async () => {
  const adapter = fakeAdapter({
    sellers: [{ sid: 1, name: "Store-US", country: "美国" }],
    recordsForCall: () => [{ sid: 1, netSalesAmount: 90, currencyCode: "" }],
  });

  await assert.rejects(
    () => getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL" },
      {
        adapter,
        getBudgetTargetContext: async () => ({
          rows: [{ month: "2026-07", storeName: "Store-US", site: "美国", currencyCode: "", salesTarget: 100 }],
          matched: true,
        }),
      },
    ),
    /实际币种(?:与请求范围不一致|缺失)/,
  );
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
        { sid: 1, netSalesAmount: 70, currencyCode: "CNY", exchangeRate: 7 },
        { sid: 2, netSalesAmount: 50, currencyCode: "CNY", exchangeRate: 5 },
      ]
      : [
        { sid: 1, netSalesAmount: 77, currencyCode: "CNY", exchangeRate: 7 },
        { sid: 2, netSalesAmount: 60, currencyCode: "CNY", exchangeRate: 5 },
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
      { sid: 1, netSalesAmount: 70, currencyCode: "CNY", exchangeRate: 7 },
      { sid: 2, netSalesAmount: 50, currencyCode: "CNY", exchangeRate: "", cnyAmount: 50 },
    ],
  });

  const value = await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "CNY" },
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
    recordsForCall: () => [{ sid: 1, netSalesAmount: 0, currencyCode: "CNY" }],
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
    recordsForCall: () => [{ sid: 1, netSalesAmount: 10, currencyCode: "CNY", secretOrderValue: "do-not-log" }],
  });

  await getStoreOperatingMonthlyReport(
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
  assert.equal(entries[0].details.currencyMode, "CNY");
  assert.equal(entries[0].details.recordCount, 1);
  assert.equal(entries[0].details.budgetMatchCount, 1);
  assert.equal(typeof entries[0].details.elapsedMs, "number");
  assert.doesNotMatch(JSON.stringify(entries), /do-not-log/);
});

test("monthly report export builds its workbook from the same report result and filters", async () => {
  const filters = {
    startDate: "2026-06-01",
    endDate: "2026-07-31",
    stores: ["Store-US"],
    countries: ["美国"],
  };
  let receivedFilters;
  const result = await exportStoreOperatingMonthlyReportXlsx(filters, {
    getStoreOperatingMonthlyReport: async (value) => {
      receivedFilters = value;
      return {
        filters: { ...value, months: ["2026-06", "2026-07"] },
        meta: { currencyMode: "ORIGINAL", currencyCodes: ["USD"], generatedAt: "2026-08-03T08:00:00.000Z", missingExchangeRateCount: 1, unavailableMetrics: ["ad-spend"] },
        budgetStatus: { state: "configured", matchCount: 2 },
        groups: [{
          storeName: "Store-US",
          currencyAvailable: true,
          currencyCode: "USD",
          rows: [{
            key: "net-sales",
            category: "销售收入",
            name: "销售收入净额",
            actual: 90,
            budget: 120,
            share: 1,
            achievement: 0.75,
            available: true,
          }],
        }],
      };
    },
  });

  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default || xlsxModule;
  const workbook = XLSX.read(result.buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["店铺经营月报"], { header: 1 });

  assert.deepEqual(receivedFilters, filters);
  assert.equal(result.filename, "店铺经营月报-2026-06-01至2026-07-31.xlsx");
  assert.deepEqual(rows[0], ["上级", "名称", "Store-US · USD", "", "", ""]);
  assert.deepEqual(rows[1], ["", "", "实际完成值", "占比", "预算值", "达成率"]);
  assert.deepEqual(rows[2], ["销售收入", "销售收入净额", 90, 1, 120, 0.75]);
  const metadata = XLSX.utils.sheet_to_json(workbook.Sheets["报表说明"], { header: 1 });
  assert.deepEqual(metadata.slice(1), [
    ["开始日期", "2026-06-01"],
    ["结束日期", "2026-07-31"],
    ["店铺范围", "Store-US"],
    ["国家范围", "美国"],
    ["币种模式", "原币分币种"],
    ["币种", "USD"],
    ["生成时间", "2026-08-03T08:00:00.000Z"],
    ["预算状态", "configured"],
    ["预算匹配数", 2],
    ["缺少汇率条数", 1],
    ["不可用科目", "ad-spend"],
  ]);
});

test("monthly report export rejects malformed source rows instead of writing a misleading workbook", async () => {
  await assert.rejects(
    () => exportStoreOperatingMonthlyReportXlsx(
      { startDate: "2026-06-01", endDate: "2026-07-31" },
      {
        getStoreOperatingMonthlyReport: async () => ({
          filters: { startDate: "2026-06-01", endDate: "2026-07-31" },
          groups: [{ currencyCode: "USD", rows: [{}] }],
        }),
      },
    ),
    /导出行缺少/,
  );
});

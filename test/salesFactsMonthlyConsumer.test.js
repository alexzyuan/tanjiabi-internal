import assert from "node:assert/strict";
import test from "node:test";

import {
  getStoreOperatingMonthlyReport,
} from "../src/services/storeOperatingMonthlyReportService.js";
import { STORE_OPERATING_MONTHLY_MAPPER_VERSION } from "../src/services/storeOperatingMonthlyReportMapper.js";

const silentLogger = { info() {}, error() {} };

const sellers = [
  { sid: 1, name: "Store-US", country: "美国", countryCode: "US", status: 1 },
  { sid: 2, name: "Store-CA", country: "加拿大", countryCode: "CA", status: 1 },
];

function metricFact({ factDate, sid = 1, amount = 100, currencyMode = "CNY", actualCurrencyCode = "CNY", msku = "SKU-1" } = {}) {
  return {
    factDate,
    sid,
    msku,
    mskuKey: msku.toLowerCase(),
    currencyMode,
    actualCurrencyCode,
    sourceUpdatedAtMs: 1,
    refreshedAtMs: 100,
    refreshBatchId: "batch-1",
    metrics: {
      totalSalesQuantity: 1n,
      totalSalesAmount: BigInt(amount) * 10000n,
      netSalesAmount: BigInt(amount) * 10000n,
      grossProfit: BigInt(amount) * 10000n,
    },
  };
}

function fakeAdapter(calls) {
  return {
    async fetchSellers() {
      return { data: sellers };
    },
    normalizeRecordList(payload) {
      return Array.isArray(payload) ? payload : payload?.data || [];
    },
    async fetchMskuOrderProfitCached() {
      calls.push("legacy-order-profit");
      throw new Error("legacy OrderProfit consumer call");
    },
    async fetchSellerProfitReport() {
      calls.push("legacy-custom-fee");
      throw new Error("legacy custom-fee consumer call");
    },
  };
}

function dependencies({ result, calls, refreshError } = {}) {
  return {
    adapter: fakeAdapter(calls),
    logger: silentLogger,
    getBudgetTargetContext: async () => ({ rows: [], matched: false }),
    salesFacts: {
      sellerDirectory: sellers,
      refreshMonthlyReportScope: async (scope, options) => {
        calls.push({ scope, options });
        if (refreshError) throw refreshError;
        return result;
      },
    },
  };
}

test("monthly consumer reads multi-month daily facts and monthly custom fees without legacy adapters", async () => {
  const calls = [];
  const result = {
    facts: [
      metricFact({ factDate: "2026-07-01", amount: 100 }),
      metricFact({ factDate: "2026-08-01", amount: 50 }),
    ],
    customFees: [
      {
        naturalMonth: "2026-07", sid: 1, feeTypeId: "software", feeName: "软件费用",
        feeAmount: -80000n, actualCurrencyCode: "CNY", currencyMode: "CNY",
      },
      {
        naturalMonth: "2026-07", sid: 1, feeTypeId: "unknown", feeName: "未识别费用",
        feeAmount: -10000n, actualCurrencyCode: "CNY", currencyMode: "CNY",
      },
    ],
    meta: { source: "sales-facts-sqlite", cacheState: "hit", updatedAt: "2026-08-13T00:00:00.000Z" },
  };

  const report = await getStoreOperatingMonthlyReport(
    { startDate: "2026-07-01", endDate: "2026-08-07", stores: ["Store-US"] },
    dependencies({ result, calls }),
  );

  assert.equal(calls.filter((item) => item && item.scope).length, 1);
  assert.deepEqual(calls[0].scope.dates.slice(0, 2), ["2026-07-01", "2026-07-02"]);
  assert.equal(calls[0].scope.dates.at(-1), "2026-08-07");
  assert.equal(calls[0].scope.currencyMode, "CNY");
  assert.equal(report.meta.source, "sales-facts-sqlite");
  assert.equal(report.meta.customFeeSource, "sales-facts-sqlite.custom_fee_monthly");
  assert.equal(report.meta.unmappedCustomFeeCount, 1);
  assert.equal(report.rows.find((row) => row.key === "software-fee").actual, 8);
  assert.equal(report.rows.find((row) => row.key === "sales-income").actual, 150);
  assert.equal(calls.includes("legacy-order-profit"), false);
  assert.equal(calls.includes("legacy-custom-fee"), false);
});

test("monthly consumer passes a single-country ORIGINAL scope to atomic refresh", async () => {
  const calls = [];
  const result = {
    facts: [metricFact({ factDate: "2026-07-01", sid: 1, amount: 20, currencyMode: "ORIGINAL", actualCurrencyCode: "USD" })],
    customFees: [],
    meta: { source: "sales-facts-sqlite", cacheState: "frozen", updatedAt: "2026-08-13T00:00:00.000Z" },
  };

  await getStoreOperatingMonthlyReport(
    { startMonth: "2026-07", endMonth: "2026-07", currencyCode: "ORIGINAL", stores: ["Store-US"] },
    dependencies({ result, calls }),
  );

  assert.equal(calls[0].scope.currencyMode, "ORIGINAL");
  assert.deepEqual(calls[0].scope.sids, [1]);
});

test("monthly consumer propagates atomic refresh failure and performs no legacy fallback", async () => {
  const calls = [];
  await assert.rejects(
    getStoreOperatingMonthlyReport(
      { startMonth: "2026-07", endMonth: "2026-07", stores: ["Store-US"] },
      dependencies({ calls, refreshError: new Error("upstream unavailable") }),
    ),
    /upstream unavailable/,
  );
  assert.deepEqual(calls, [{ scope: calls[0]?.scope, options: calls[0]?.options }].filter(Boolean));
  assert.equal(calls.some((item) => item === "legacy-order-profit" || item === "legacy-custom-fee"), false);
});

test("monthly mapper version is explicit and stable", () => {
  assert.equal(STORE_OPERATING_MONTHLY_MAPPER_VERSION, "store-operating-facts-v1");
});

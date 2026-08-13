import assert from "node:assert/strict";
import test from "node:test";

import {
  compareMonthlyAndDailyFacts,
  normalizeOrderProfitRows,
} from "../src/services/salesFactsOrderProfitValidator.js";

const sellers = [{ sid: 8708, countryCode: "US", status: 1 }];

function row(overrides = {}) {
  return {
    sid: 8708,
    seller_sku: "MSKU-A",
    report_date: "2026-07-01",
    currency_code: "CNY",
    amount: "10.0000",
    volume: 1,
    ...overrides,
  };
}

test("rejects monthly rows whose date exists only through requested-range fallback", () => {
  assert.throws(
    () => normalizeOrderProfitRows([{ sid: 8708, seller_sku: "MSKU-A", amount: 10 }], {
      requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      currencyMode: "CNY",
      sellers,
      allowRequestedDateFallback: false,
    }),
    (error) => error.code === "SALES_FACTS_DATE_MISSING",
  );
});

test("normalizes only real in-range dates and canonical identities", () => {
  const [fact] = normalizeOrderProfitRows([row()], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
    currencyMode: "CNY",
    sellers,
  });
  assert.equal(fact.factDate, "2026-07-01");
  assert.equal(fact.sid, 8708);
  assert.equal(fact.mskuKey, "msku-a");
  assert.equal(fact.metrics.totalSalesAmount, 100000n);
  assert.equal("raw" in fact, false);

  assert.throws(
    () => normalizeOrderProfitRows([row({ report_date: "2026-08-01" })], {
      requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      currencyMode: "CNY",
      sellers,
    }),
    (error) => error.code === "SALES_FACTS_DATE_OUT_OF_RANGE",
  );
});

test("normalizes SID and MSKU from the real OrderProfit row shape", () => {
  const [fact] = normalizeOrderProfitRows([row({
    sid: undefined,
    seller_sku: undefined,
    sids: ["8708"],
    price_list: [{ seller_sku: "MSKU-NESTED" }],
  })], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-01" },
    currencyMode: "CNY",
    sellers,
  });

  assert.equal(fact.sid, 8708);
  assert.equal(fact.msku, "MSKU-NESTED");
  assert.equal(fact.mskuKey, "msku-nested");
  assert.equal("sids" in fact, false);
  assert.equal("price_list" in fact, false);
});

test("approves monthly mode only when every daily metric reconciles", () => {
  const monthlyRows = normalizeOrderProfitRows([
    row(),
    row({ report_date: "2026-07-02", amount: "20.0000", volume: 2 }),
  ], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
    currencyMode: "CNY",
    sellers,
  });
  const dailyRows = normalizeOrderProfitRows([
    row(),
    row({ report_date: "2026-07-02", amount: "20.0000", volume: 2 }),
  ], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
    currencyMode: "CNY",
    sellers,
  });
  const report = compareMonthlyAndDailyFacts({ monthlyRows, dailyRows });
  assert.equal(report.approvedFetchMode, "monthly");
  assert.equal(report.metricMismatchCount, 0);
  assert.equal(report.identityMismatchCount, 0);
});

test("recommends daily and reports only hashed identities when values differ", () => {
  const monthlyRows = normalizeOrderProfitRows([row()], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" }, currencyMode: "CNY", sellers,
  });
  const dailyRows = normalizeOrderProfitRows([row({ amount: "9.9998" })], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" }, currencyMode: "CNY", sellers,
  });
  const report = compareMonthlyAndDailyFacts({ monthlyRows, dailyRows });
  assert.equal(report.approvedFetchMode, "daily");
  assert.equal(report.metricMismatchCount, 1);
  assert.deepEqual(Object.keys(report.mismatches[0]).sort(), ["identityHashPrefix", "metricName", "storedUnitDelta"]);
  assert.doesNotMatch(JSON.stringify(report), /MSKU-A/);
});

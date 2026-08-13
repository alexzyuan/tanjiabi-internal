import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSalesFactsShadow,
  isSalesFactsShadowEnabled,
  runSalesFactsShadowRead,
} from "../src/services/salesFactsShadowService.js";

function row(overrides = {}) {
  return {
    factDate: "2026-08-01",
    sid: 8708,
    msku: "MSKU-SECRET",
    mskuKey: "msku-secret",
    currencyMode: "CNY",
    metrics: {
      totalSalesQuantity: 2,
      totalSalesAmount: 10.5,
      totalSalesRefunds: 1.25,
      grossProfit: 3.5,
    },
    ...overrides,
  };
}

test("shadow flag is explicit and disabled by default", () => {
  assert.equal(isSalesFactsShadowEnabled({}), false);
  assert.equal(isSalesFactsShadowEnabled({ SALES_FACTS_SHADOW_READ: "0" }), false);
  assert.equal(isSalesFactsShadowEnabled({ SALES_FACTS_SHADOW_READ: "1" }), true);
  assert.equal(isSalesFactsShadowEnabled({ SALES_FACTS_SHADOW_READ: "true" }), false);
});

test("compares canonical totals and emits redacted mismatch samples with fixed-point deltas", () => {
  const logs = [];
  const result = compareSalesFactsShadow({
    legacyRecords: [row()],
    newFacts: [row({ metrics: { ...row().metrics, totalSalesAmount: 10.75 } })],
    requestId: "shadow-compare",
    logger: { info: (...args) => logs.push(args), warn() {}, error() {} },
  });
  assert.equal(result.comparedIdentityCount, 1);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.missingInNewCount, 0);
  assert.equal(result.missingInLegacyCount, 0);
  assert.equal(result.mismatchMetrics.totalSalesAmount, "2500");
  assert.equal(result.mismatchMetrics.totalSalesQuantity, "0");
  assert.equal(logs.length, 1);
  const details = logs[0][1];
  assert.equal(details.requestId, "shadow-compare");
  assert.equal(details.mismatchCount, 1);
  assert.equal(details.samples[0].sid, 8708);
  assert.equal(details.samples[0].mskuHash.length, 12);
  assert.equal("msku" in details.samples[0], false);
  assert.equal("ownerName" in details.samples[0], false);
  assert.equal("values" in details.samples[0], false);
});

test("shadow read is non-authoritative, disabled reads nothing, and failures never replace legacy result", async () => {
  const legacyResult = { summary: [["销售额", "10.50"]] };
  let reads = 0;
  const disabled = await runSalesFactsShadowRead({
    enabled: false,
    legacyResult,
    legacyRecords: [row()],
    readNewFacts: async () => { reads += 1; return [row()]; },
  });
  assert.strictEqual(disabled, legacyResult);
  assert.equal(reads, 0);

  const logs = [];
  const failed = await runSalesFactsShadowRead({
    enabled: true,
    legacyResult,
    legacyRecords: [row()],
    readNewFacts: async () => { reads += 1; throw new Error("new facts unavailable"); },
    requestId: "shadow-failure",
    logger: { info() {}, warn() {}, error: (...args) => logs.push(args) },
  });
  assert.strictEqual(failed, legacyResult);
  assert.equal(reads, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].requestId, "shadow-failure");
  assert.equal(logs[0][1].errorName, "Error");
  assert.equal("message" in logs[0][1], false);
});

test("shadow comparator never uses legacy rows to repair new facts", async () => {
  const legacyResult = { records: [row()] };
  let compared;
  const result = await runSalesFactsShadowRead({
    enabled: true,
    legacyResult,
    legacyRecords: [row()],
    readNewFacts: async () => [row({ metrics: { totalSalesQuantity: 0 } })],
    compare: (input) => {
      compared = input;
      return { mismatchCount: 1 };
    },
  });
  assert.strictEqual(result, legacyResult);
  assert.equal(compared.legacyRecords[0].metrics.totalSalesQuantity, 2);
  assert.equal(compared.newFacts[0].metrics.totalSalesQuantity, 0);
});

test("shadow fixed-point deltas preserve values beyond Number safe integer range", () => {
  const result = compareSalesFactsShadow({
    legacyRecords: [row({ metrics: { totalSalesAmount: "900719925474099.3000" } })],
    newFacts: [row({ metrics: { totalSalesAmount: "900719925474100.3000" } })],
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.mismatchMetrics.totalSalesAmount, "10000");
});

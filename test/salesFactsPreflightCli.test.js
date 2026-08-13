import assert from "node:assert/strict";
import test from "node:test";

import { runSalesFactsOwnerAuditCli } from "../scripts/audit-sales-facts-preflight.js";
import { runSalesFactsOrderProfitPreflightCli } from "../scripts/audit-sales-facts-preflight.js";

test("owner audit CLI force-loads runtime sellers without writing seller cache", async () => {
  const directoryCalls = [];
  const outputs = [];
  const report = await runSalesFactsOwnerAuditCli({
    adapter: { fetchListings: async () => ({ data: { total: 0, list: [] } }) },
    getDirectory: async (options) => {
      directoryCalls.push(options);
      await options.saveCache([{ sid: 8708 }]);
      return { sellers: [{ sid: 8708, status: 1 }] };
    },
    auditOwners: async ({ sellers, requestId }) => ({
      requestId,
      sellerCount: sellers.length,
      sidCount: sellers.length,
      rowCount: 0,
      pageCount: 1,
      counts: {
        assigned: 0,
        unassigned: 0,
        multiple: 0,
        malformed: 0,
        failedSidCount: 0,
        paginationIncomplete: 0,
      },
      anomalies: [],
      failedSids: [],
    }),
    requestId: "owners-cli-success",
    writeOutput: (text) => outputs.push(text),
  });

  assert.equal(directoryCalls.length, 1);
  assert.equal(directoryCalls[0].forceRefresh, true);
  assert.equal(typeof directoryCalls[0].saveCache, "function");
  assert.equal(report.exitCode, 0);
  assert.equal(outputs.length, 1);
  assert.deepEqual(JSON.parse(outputs[0]), report);
});

test("owner audit CLI returns nonzero for anomalies and never prints owner values or raw payloads", async () => {
  const outputs = [];
  const report = await runSalesFactsOwnerAuditCli({
    adapter: {},
    getDirectory: async () => ({ sellers: [{ sid: 8708, status: 1 }] }),
    auditOwners: async ({ requestId }) => ({
      requestId,
      sellerCount: 1,
      sidCount: 1,
      rowCount: 1,
      pageCount: 1,
      counts: {
        assigned: 0,
        unassigned: 0,
        multiple: 1,
        malformed: 0,
        failedSidCount: 0,
        paginationIncomplete: 0,
      },
      anomalies: [{
        code: "LISTING_MULTIPLE_OWNERS",
        sid: 8708,
        msku: "MSKU-A",
        ownerCount: 2,
        identityHashPrefixes: ["123456789abc", "abcdef123456"],
      }],
      failedSids: [],
    }),
    requestId: "owners-cli-failure",
    writeOutput: (text) => outputs.push(text),
  });

  assert.equal(report.exitCode, 1);
  const text = outputs.join("\n");
  assert.match(text, /123456789abc/);
  assert.doesNotMatch(text, /owner name|owner id|token|signature|raw/i);
});

test("owner audit CLI reports a controlled failure without echoing the upstream message", async () => {
  const outputs = [];
  const report = await runSalesFactsOwnerAuditCli({
    adapter: {},
    getDirectory: async () => {
      throw new Error("token=secret raw payload");
    },
    requestId: "owners-cli-error",
    writeOutput: (text) => outputs.push(text),
  });

  assert.equal(report.exitCode, 1);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "SELLER_DIRECTORY_FAILED");
  assert.doesNotMatch(outputs.join("\n"), /secret|payload|token=/i);
});

test("OrderProfit preflight compares one monthly request with serial daily requests without writes", async () => {
  const calls = [];
  const outputs = [];
  const report = await runSalesFactsOrderProfitPreflightCli({
    env: {
      SALES_FACTS_PREFLIGHT_START_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_END_DATE: "2026-07-02",
      SALES_FACTS_PREFLIGHT_SIDS: "8708",
      SALES_FACTS_PREFLIGHT_CURRENCY_MODE: "CNY",
    },
    getDirectory: async () => ({ sellers: [{ sid: 8708, countryCode: "US", status: 1 }] }),
    adapter: {},
    loadRange: async ({ startDate, endDate }) => {
      calls.push([startDate, endDate]);
      const dates = startDate === endDate ? [startDate] : ["2026-07-01", "2026-07-02"];
      return dates.map((factDate) => ({ sid: 8708, seller_sku: "A", report_date: factDate, currency_code: "CNY", amount: 10, volume: 1 }));
    },
    writeOutput: (text) => outputs.push(text),
  });
  assert.deepEqual(calls, [
    ["2026-07-01", "2026-07-02"],
    ["2026-07-01", "2026-07-01"],
    ["2026-07-02", "2026-07-02"],
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.approvedFetchMode, "monthly");
  assert.equal(outputs.length, 1);
});

test("OrderProfit preflight approves daily for a complete mismatch and emits no business values", async () => {
  const outputs = [];
  const report = await runSalesFactsOrderProfitPreflightCli({
    env: {
      SALES_FACTS_PREFLIGHT_START_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_END_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_SIDS: "8708",
      SALES_FACTS_PREFLIGHT_CURRENCY_MODE: "CNY",
    },
    getDirectory: async () => ({ sellers: [{ sid: 8708, countryCode: "US", status: 1 }] }),
    adapter: {},
    loadRange: async ({ requestKind }) => [{
      sid: 8708, seller_sku: "SECRET-MSKU", report_date: "2026-07-01", currency_code: "CNY",
      amount: requestKind === "monthly" ? 10 : 9,
    }],
    writeOutput: (text) => outputs.push(text),
  });
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.approvedFetchMode, "daily");
  assert.doesNotMatch(outputs.join("\n"), /SECRET-MSKU|"amount"|token|raw/i);
});

test("OrderProfit preflight exposes a controlled validation code without upstream text", async () => {
  const outputs = [];
  const report = await runSalesFactsOrderProfitPreflightCli({
    env: {
      SALES_FACTS_PREFLIGHT_START_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_END_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_SIDS: "8708",
      SALES_FACTS_PREFLIGHT_CURRENCY_MODE: "CNY",
    },
    getDirectory: async () => ({ sellers: [{ sid: 8708, countryCode: "US", status: 1 }] }),
    adapter: {},
    loadRange: async () => {
      const error = new Error("token=secret raw payload");
      error.name = "SalesFactsContractError";
      error.code = "SALES_FACTS_DATE_MISSING";
      error.statusCode = 422;
      throw error;
    },
    writeOutput: (text) => outputs.push(text),
  });

  assert.deepEqual(report.error, {
    operation: "order-profit-fetch",
    errorName: "SalesFactsContractError",
    code: "SALES_FACTS_DATE_MISSING",
    statusCode: 422,
  });
  assert.doesNotMatch(outputs.join("\n"), /secret|payload|token=/i);
});

test("OrderProfit preflight approves daily when monthly rows lack dates but every serial day is valid", async () => {
  const calls = [];
  const outputs = [];
  const report = await runSalesFactsOrderProfitPreflightCli({
    env: {
      SALES_FACTS_PREFLIGHT_START_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_END_DATE: "2026-07-02",
      SALES_FACTS_PREFLIGHT_SIDS: "8708",
      SALES_FACTS_PREFLIGHT_CURRENCY_MODE: "CNY",
    },
    getDirectory: async () => ({ sellers: [{ sid: 8708, countryCode: "US", status: 1 }] }),
    adapter: {},
    loadRange: async ({ startDate, endDate, requestKind }) => {
      calls.push([requestKind, startDate, endDate]);
      if (requestKind === "monthly") {
        return [{ sid: 8708, seller_sku: "A", currency_code: "CNY", amount: 20, volume: 2 }];
      }
      return [{ sid: 8708, seller_sku: "A", currency_code: "CNY", amount: 10, volume: 1 }];
    },
    writeOutput: (text) => outputs.push(text),
  });

  assert.deepEqual(calls, [
    ["monthly", "2026-07-01", "2026-07-02"],
    ["daily", "2026-07-01", "2026-07-01"],
    ["daily", "2026-07-02", "2026-07-02"],
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.approvedFetchMode, "daily");
  assert.equal(report.dailyValidationComplete, true);
  assert.equal(report.monthlyValidationCode, "SALES_FACTS_DATE_MISSING");
  assert.equal(report.dailyRowCount, 2);
  assert.equal(outputs.length, 1);
});

test("OrderProfit preflight rejects daily approval when any requested day is invalid", async () => {
  const outputs = [];
  const report = await runSalesFactsOrderProfitPreflightCli({
    env: {
      SALES_FACTS_PREFLIGHT_START_DATE: "2026-07-01",
      SALES_FACTS_PREFLIGHT_END_DATE: "2026-07-02",
      SALES_FACTS_PREFLIGHT_SIDS: "8708",
      SALES_FACTS_PREFLIGHT_CURRENCY_MODE: "CNY",
    },
    getDirectory: async () => ({ sellers: [{ sid: 8708, countryCode: "US", status: 1 }] }),
    adapter: {},
    loadRange: async ({ startDate, requestKind }) => {
      if (requestKind === "monthly") return [];
      if (startDate === "2026-07-02") return [{ sid: 9999, seller_sku: "A", amount: 1 }];
      return [{ sid: 8708, seller_sku: "A", amount: 1 }];
    },
    writeOutput: (text) => outputs.push(text),
  });

  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.error.code, "SALES_FACTS_UNKNOWN_SID");
  assert.equal(report.error.operation, "order-profit-daily-validation");
  assert.doesNotMatch(outputs.join("\n"), /9999|seller_sku|amount/);
});

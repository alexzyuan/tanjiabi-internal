import assert from "node:assert/strict";
import test from "node:test";

import { runSalesFactsOwnerAuditCli } from "../scripts/audit-sales-facts-preflight.js";

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

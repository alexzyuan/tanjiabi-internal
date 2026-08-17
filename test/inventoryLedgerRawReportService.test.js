import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryLedgerTargetMonths, runInventoryLedgerRawRebuild } from "../src/services/inventoryLedgerRawReportService.js";

const seller = {
  sid: 8708,
  seller_id: "A-SELLER",
  name: "xiamentanjia-US",
  country: "美国",
  countryCode: "US",
  marketplaceId: "ATVPD",
};

function reportBytes(month) {
  return Buffer.from(`event-date\tmsku\tevent-type\tquantity\tfulfillment-center\tdisposition\treference-id\treason\n${month}-01\tMSKU-1\tBeginningBalance\t2\tONT8\tSELLABLE\topening\topening\n`);
}

function makeStore() {
  const manifests = new Map();
  const reports = new Map();
  const commits = [];
  const key = (month, scopeKey) => `${month}|${scopeKey}`;
  return {
    manifests,
    reports,
    commits,
    async readManifest(month, scopeKey) { return manifests.get(key(month, scopeKey)) || null; },
    async saveReport({ month, scopeKey, extension, bytes, manifest }) {
      reports.set(key(month, scopeKey), bytes);
      const value = { ...manifest, month, scopeKey, extension, byteCount: bytes.length, status: "success" };
      manifests.set(key(month, scopeKey), value);
      return value;
    },
    async readReport({ month, scopeKey }) { return reports.get(key(month, scopeKey)) || null; },
    async commitInventoryProvisionHistoryBatch(value) { commits.push(value); return { committedMonths: value.targetMonths }; },
  };
}

function createAdapter({ statuses = ["IN_QUEUE", "IN_PROGRESS", "DONE"], omitDoneUrl = false } = {}) {
  const calls = { create: [], query: [], renew: [], download: [] };
  let statusIndex = 0;
  return {
    calls,
    async createReportExportTask(params) { calls.create.push(params); return { data: { task_id: `task-${calls.create.length}` } }; },
    async queryReportExportTask(params) {
      calls.query.push(params);
      const progress_status = statuses[Math.min(statusIndex++, statuses.length - 1)];
      return { data: {
        progress_status,
        report_document_id: "doc-1",
        compression_algorithm: "NONE",
        url: progress_status === "DONE" && !omitDoneUrl ? "https://download.test/report" : "",
      } };
    },
    async renewReportExportTask(params) { calls.renew.push(params); return { data: { url: "https://download.test/renewed" } }; },
    async downloadReportDocument(url) { calls.download.push(url); return reportBytes("2025-10"); },
  };
}

function serviceOptions({ adapter = createAdapter(), store = makeStore(), force = false } = {}) {
  return {
    adapter,
    store,
    force,
    now: new Date("2025-11-10T02:00:00+08:00"),
    startMonth: "2025-10",
    getSellers: async () => ({ sellers: [seller] }),
    sleep: async () => {},
    pollIntervalMs: 0,
    maxPollAttempts: 4,
    readHistoryCache: async () => null,
    logger: { info() {}, error() {} },
  };
}

test("target months start at 2025-10 and stop at the previous Shanghai month", () => {
  assert.deepEqual(buildInventoryLedgerTargetMonths({ now: new Date("2026-08-17T10:00:00+08:00") }), [
    "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
});

test("raw rebuild polls, archives, parses, and atomically commits complete scope", async () => {
  const adapter = createAdapter();
  const store = makeStore();
  const result = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));

  assert.equal(adapter.calls.create.length, 1);
  assert.equal(adapter.calls.create[0].report_type, "GET_LEDGER_DETAIL_VIEW_DATA");
  assert.equal(adapter.calls.create[0].data_start_time, "2025-10-01T00:00:00Z");
  assert.equal(adapter.calls.create[0].data_end_time, "2025-10-31T23:59:59Z");
  assert.deepEqual(adapter.calls.create[0].marketplace_ids, ["ATVPD"]);
  assert.equal(adapter.calls.create[0].region, "na");
  assert.equal(adapter.calls.query.length, 3);
  assert.equal(adapter.calls.download.length, 1);
  assert.equal(store.commits.length, 1);
  assert.deepEqual(result.committedMonths, ["2025-10"]);
  assert.equal(result.parsedRowCount, 1);
});

test("raw rebuild renews a finished report URL once when task query omits it", async () => {
  const adapter = createAdapter({ statuses: ["DONE"], omitDoneUrl: true });
  const store = makeStore();
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.renew.length, 1);
  assert.deepEqual(adapter.calls.download, ["https://download.test/renewed"]);
});

test("raw rebuild reuses successful manifests and only force requests reports again", async () => {
  const adapter = createAdapter({ statuses: ["DONE"] });
  const store = makeStore();
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  const reused = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.create.length, 1);
  assert.equal(reused.reportCount, 1);

  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store, force: true }));
  assert.equal(adapter.calls.create.length, 2);
});

test("raw rebuild does not commit when report task fails or parser input is invalid", async () => {
  const adapter = createAdapter({ statuses: ["FATAL"] });
  const store = makeStore();
  await assert.rejects(
    () => runInventoryLedgerRawRebuild(serviceOptions({ adapter, store })),
    /导出失败/u,
  );
  assert.equal(store.commits.length, 0);
});

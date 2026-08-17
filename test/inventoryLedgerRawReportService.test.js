import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildInventoryLedgerTargetMonths, runInventoryLedgerRawRebuild } from "../src/services/inventoryLedgerRawReportService.js";

const seller = { sid: 8708, seller_id: "A-SELLER", name: "xiamentanjia-US", country: "美国", countryCode: "US", marketplaceId: "ATVPD" };

function makeStore() {
  const manifests = new Map();
  const reports = new Map();
  const commits = [];
  const key = (month, scopeKey) => `${month}|${scopeKey}`;
  return {
    manifests, reports, commits, verifyCalls: [],
    async readManifest(month, scopeKey) { return manifests.get(key(month, scopeKey)) || null; },
    async saveReport({ month, scopeKey, extension, bytes, manifest }) {
      reports.set(key(month, scopeKey), bytes);
      const value = {
        ...manifest, month, scopeKey, extension, byteCount: bytes.length, status: "success",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      manifests.set(key(month, scopeKey), value);
      return value;
    },
    async readReport({ month, scopeKey }) { return reports.get(key(month, scopeKey)) || null; },
    async verifyReport({ month, scopeKey, expectedSha256 }) {
      this.verifyCalls.push({ month, scopeKey, expectedSha256 });
      const bytes = reports.get(key(month, scopeKey));
      if (!bytes) throw new Error("test report missing");
      assert.equal(expectedSha256, createHash("sha256").update(bytes).digest("hex"));
      return { bytes, byteCount: bytes.length, sha256: expectedSha256 };
    },
    async commitInventoryProvisionHistoryBatch(value) { commits.push(value); return { committedMonths: value.targetMonths }; },
  };
}

function reportBytes(month) {
  const quantity = month === "2025-10" ? -1 : 1;
  const eventType = quantity < 0 ? "CustomerShipments" : "Receipts";
  return Buffer.from(
    `event-date\tmsku\tevent-type\tquantity\tfulfillment-center\tdisposition\treference-id\treason\ttitle\n${month}-01\tMSKU-1\t${eventType}\t${quantity}\tONT8\tSELLABLE\tref-1\t\tToy truck\n`,
    "utf8",
  );
}

function createExportReportAdapter({ statuses = ["DONE"], omitDoneUrl = false } = {}) {
  const calls = { create: [], query: [], renew: [], download: [], snapshots: [], detailApi: [] };
  const taskMonths = new Map();
  const statusIndexes = new Map();
  return {
    calls,
    async fetchAllInventoryLedgerDetails(params) {
      calls.detailApi.push(params);
      throw new Error("formal raw rebuild must not call the detail API");
    },
    async createReportExportTask(params) {
      calls.create.push(params);
      const taskId = `task-${calls.create.length}`;
      taskMonths.set(taskId, params.data_start_time.slice(0, 7));
      return { data: { task_id: taskId } };
    },
    async queryReportExportTask(params) {
      calls.query.push(params);
      const index = statusIndexes.get(params.task_id) || 0;
      statusIndexes.set(params.task_id, index + 1);
      const progress_status = statuses[Math.min(index, statuses.length - 1)];
      return { data: {
        progress_status,
        report_document_id: `document-${params.task_id}`,
        compression_algorithm: "NONE",
        url: progress_status === "DONE" && !omitDoneUrl ? `https://download.test/${params.task_id}` : "",
      } };
    },
    async renewReportExportTask(params) {
      calls.renew.push(params);
      return { data: { url: `https://download.test/${params.report_document_id.replace("document-", "")}` } };
    },
    async downloadReportDocument(url) {
      calls.download.push(url);
      const taskId = url.split("/").at(-1);
      return reportBytes(taskMonths.get(taskId));
    },
    async fetchAllFbaInventoryHistory(params) {
      calls.snapshots.push(params);
      return [{
        msku: "MSKU-1",
        seller_id: "A-SELLER",
        sid: 8708,
        country_code: "US",
        child_data: [{ disposition: "sellable", end_count: 5 }],
      }];
    },
  };
}

function serviceOptions({ adapter = createExportReportAdapter(), store = makeStore(), force = false } = {}) {
  return {
    adapter, store, force,
    now: new Date("2025-11-10T02:00:00+08:00"), startMonth: "2025-10", ledgerSeedMonth: "2024-10",
    getSellers: async () => ({ sellers: [seller] }), readHistoryCache: async () => null, logger: { info() {}, error() {} },
    sleep: async () => {}, pollIntervalMs: 0, maxPollAttempts: 4,
  };
}

test("target months start at 2025-10 and stop at the previous Shanghai month", () => {
  assert.deepEqual(buildInventoryLedgerTargetMonths({ now: new Date("2026-08-17T10:00:00+08:00") }), [
    "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
});

test("raw rebuild exports, downloads, archives, parses original reports, and atomically commits", async () => {
  const adapter = createExportReportAdapter({ statuses: ["IN_QUEUE", "IN_PROGRESS", "DONE"] });
  const store = makeStore();
  const result = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.create.length, 13);
  assert.deepEqual(adapter.calls.create.map(({ report_type, seller_id, marketplace_ids, region }) => ({ report_type, seller_id, marketplace_ids, region })), Array(13).fill({
    report_type: "GET_LEDGER_DETAIL_VIEW_DATA", seller_id: "A-SELLER", marketplace_ids: ["ATVPD"], region: "na",
  }));
  assert.equal(adapter.calls.query.length, 39);
  assert.equal(adapter.calls.download.length, 13);
  assert.equal(adapter.calls.detailApi.length, 0);
  assert.deepEqual(adapter.calls.snapshots, [{ start_date: "2024-09", end_date: "2024-09", seller_id: ["A-SELLER"] }]);
  assert.equal(result.reportCount, 14);
  assert.equal(result.parsedRowCount, 14);
  assert.equal(store.commits.length, 1);
  assert.deepEqual(result.committedMonths, ["2025-10"]);
  assert.equal(store.manifests.get("2024-10|A-SELLER|na|ATVPD").source, "lingxing-exported-inventory-ledger-report");
  assert.equal(store.manifests.get("2024-10|A-SELLER|na|ATVPD").extension, "tsv");
  assert.equal(store.manifests.get("2024-09|A-SELLER|na|ATVPD|opening-snapshot").source, "lingxing-fba-monthly-inventory-snapshot");
});

test("raw rebuild reuses only exported-report manifests and refreshes old JSON API manifests", async () => {
  const adapter = createExportReportAdapter();
  const store = makeStore();
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  const reused = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.create.length, 13);
  assert.equal(reused.reusedReportCount, 14);
  assert.equal(store.verifyCalls.length, 13);
  store.manifests.get("2024-10|A-SELLER|na|ATVPD").source = "lingxing-inventory-ledger-detail-api";
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.create.length, 14);
  assert.equal(store.manifests.get("2024-10|A-SELLER|na|ATVPD").source, "lingxing-exported-inventory-ledger-report");
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store, force: true }));
  assert.equal(adapter.calls.create.length, 27);
});

test("raw rebuild renews a completed report URL by report document ID", async () => {
  const adapter = createExportReportAdapter({ omitDoneUrl: true });
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter }));
  assert.equal(adapter.calls.renew.length, 13);
  assert.deepEqual(adapter.calls.renew[0], { seller_id: "A-SELLER", report_document_id: "document-task-1", region: "na" });
});

test("raw rebuild rejects UNKNOWN report task with safe stage, month, seller, and task context without committing", async () => {
  const adapter = createExportReportAdapter({ statuses: ["UNKNOWN"] });
  const store = makeStore();
  await assert.rejects(async () => {
    await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  }, (error) => {
    assert.equal(error.stage, "poll");
    assert.equal(error.month, "2024-10");
    assert.equal(error.sellerId, "A-SELLER");
    assert.equal(error.taskId, "task-1");
    assert.match(error.message, /UNKNOWN/u);
    assert.match(error.message, /A-SELLER/u);
    assert.match(error.message, /task-1/u);
    assert.doesNotMatch(error.message, /https?:\/\//u);
    return true;
  });
  assert.equal(store.commits.length, 0);
});

test("raw rebuild dry run validates exported reports without archiving or replacing history", async () => {
  const adapter = createExportReportAdapter();
  const store = makeStore();
  const result = await runInventoryLedgerRawRebuild({ ...serviceOptions({ adapter, store }), dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(store.manifests.size, 0);
  assert.equal(store.commits.length, 0);
});

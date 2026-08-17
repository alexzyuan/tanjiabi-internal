import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryLedgerTargetMonths, runInventoryLedgerRawRebuild } from "../src/services/inventoryLedgerRawReportService.js";

const seller = { sid: 8708, seller_id: "A-SELLER", name: "xiamentanjia-US", country: "美国", countryCode: "US", marketplaceId: "ATVPD" };

function makeStore() {
  const manifests = new Map();
  const reports = new Map();
  const commits = [];
  const key = (month, scopeKey) => `${month}|${scopeKey}`;
  return {
    manifests, reports, commits,
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

function officialRecord({ date, eventType, quantity }) {
  return {
    date, msku: "MSKU-1", eventType, eventTypeDesc: eventType === "04" ? "Receipts" : "Shipments", quantity,
    fulfillmentCenter: "ONT8", disposition: "01", referenceId: "ref-1", reason: "", title: "Toy truck",
  };
}

function createOfficialLedgerAdapter({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async fetchAllInventoryLedgerDetails(params) {
      calls.push(params);
      if (fail) throw new Error("official ledger unavailable");
      if (params.startDate === "2024-10-01") return [officialRecord({ date: "2024-10-01", eventType: "04", quantity: 5 })];
      if (params.startDate === "2025-10-01") return [officialRecord({ date: "2025-10-02", eventType: "01", quantity: -1 })];
      return [];
    },
    async fetchAllFbaInventoryHistory(params) {
      calls.push(params);
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

function serviceOptions({ adapter = createOfficialLedgerAdapter(), store = makeStore(), force = false } = {}) {
  return {
    adapter, store, force,
    now: new Date("2025-11-10T02:00:00+08:00"), startMonth: "2025-10", ledgerSeedMonth: "2024-10",
    getSellers: async () => ({ sellers: [seller] }), readHistoryCache: async () => null, logger: { info() {}, error() {} },
  };
}

test("target months start at 2025-10 and stop at the previous Shanghai month", () => {
  assert.deepEqual(buildInventoryLedgerTargetMonths({ now: new Date("2026-08-17T10:00:00+08:00") }), [
    "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
});

test("raw rebuild fetches official detail API seed and target months, archives JSON, and atomically commits", async () => {
  const adapter = createOfficialLedgerAdapter();
  const store = makeStore();
  const result = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  const ledgerCalls = adapter.calls.filter(({ startDate }) => startDate);
  const snapshotCalls = adapter.calls.filter(({ start_date }) => start_date);
  assert.equal(ledgerCalls.length, 13);
  assert.deepEqual(ledgerCalls.map(({ startDate, endDate, sellerIds, disposition }) => ({ startDate, endDate, sellerIds, disposition })), [
    ["2024-10", "31"], ["2024-11", "30"], ["2024-12", "31"], ["2025-01", "31"], ["2025-02", "28"], ["2025-03", "31"], ["2025-04", "30"], ["2025-05", "31"], ["2025-06", "30"], ["2025-07", "31"], ["2025-08", "31"], ["2025-09", "30"], ["2025-10", "31"],
  ].map(([month, day]) => ({ startDate: `${month}-01`, endDate: `${month}-${day}`, sellerIds: ["A-SELLER"], disposition: "01" })));
  assert.deepEqual(ledgerCalls.map(({ locations }) => locations), Array(13).fill(["US"]));
  assert.deepEqual(snapshotCalls, [{ start_date: "2024-09", end_date: "2024-09", seller_id: ["A-SELLER"] }]);
  assert.equal(result.reportCount, 14);
  assert.equal(result.parsedRowCount, 3);
  assert.equal(store.commits.length, 1);
  assert.deepEqual(result.committedMonths, ["2025-10"]);
  assert.equal(store.manifests.get("2024-10|A-SELLER|na|ATVPD").source, "lingxing-inventory-ledger-detail-api");
  assert.equal(store.manifests.get("2024-09|A-SELLER|na|ATVPD|opening-snapshot").source, "lingxing-fba-monthly-inventory-snapshot");
});

test("raw rebuild reuses validated official-detail manifests unless force is requested", async () => {
  const adapter = createOfficialLedgerAdapter();
  const store = makeStore();
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  const reused = await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store }));
  assert.equal(adapter.calls.length, 14);
  assert.equal(reused.reusedReportCount, 14);
  await runInventoryLedgerRawRebuild(serviceOptions({ adapter, store, force: true }));
  assert.equal(adapter.calls.length, 28);
});

test("raw rebuild does not commit when official detail API retrieval fails", async () => {
  const adapter = createOfficialLedgerAdapter({ fail: true });
  const store = makeStore();
  await assert.rejects(() => runInventoryLedgerRawRebuild(serviceOptions({ adapter, store })), /official ledger unavailable/u);
  assert.equal(store.commits.length, 0);
});

test("raw rebuild dry run validates official records without archiving or replacing history", async () => {
  const adapter = createOfficialLedgerAdapter();
  const store = makeStore();
  const result = await runInventoryLedgerRawRebuild({ ...serviceOptions({ adapter, store }), dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(store.manifests.size, 0);
  assert.equal(store.commits.length, 0);
});

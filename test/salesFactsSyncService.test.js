import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeSalesFactsScope } from "../src/services/salesFactsIdentity.js";
import { createSalesFactsRepository } from "../src/services/salesFactsRepository.js";
import {
  classifyCoveragePartition,
  createSalesFactsSyncService,
} from "../src/services/salesFactsSyncService.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-13T08:00:00Z");
const sellers = [{ sid: 8708, countryCode: "US", status: 1 }];

function scopeFor(startDate, endDate = startDate, sids = [8708]) {
  return normalizeSalesFactsScope({
    startDate,
    endDate,
    sids,
    currencyMode: "CNY",
    sellerDirectory: sellers,
    now: new Date(NOW),
  });
}

function fact(factDate, overrides = {}) {
  return {
    factDate,
    sid: 8708,
    msku: "MSKU-A",
    mskuKey: "msku-a",
    currencyMode: "CNY",
    actualCurrencyCode: "CNY",
    metrics: { totalSalesAmount: 0n },
    sourceUpdatedAtMs: NOW - HOUR,
    ...overrides,
  };
}

function coverage(factDate, refreshedAtMs, overrides = {}) {
  return {
    factDate,
    sid: 8708,
    currencyMode: "CNY",
    sourceUpdatedAtMs: refreshedAtMs,
    refreshedAtMs,
    rowCount: 1,
    pageCount: 1,
    ...overrides,
  };
}

function upstreamResult(scope, { empty = false } = {}) {
  return {
    facts: empty ? [] : scope.dates.map((date) => fact(date)),
    coverage: scope.dates.flatMap((date) => scope.sids.map((sid) => coverage(date, NOW, {
      sid,
      rowCount: empty ? 0 : 1,
      sourceUpdatedAtMs: NOW,
    }))),
    meta: { source: "lingxing-order-profit", fetchMode: "daily", pageCount: scope.dates.length },
  };
}

async function fixture(t, { upstream = null, logger = null } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-facts-sync-test-"));
  const repository = createSalesFactsRepository({
    databasePath: path.join(directory, "sales-facts-v1.sqlite"),
    now: () => NOW,
    logger: { info() {}, error() {} },
  });
  t.after(() => {
    repository.close();
    return rm(directory, { recursive: true, force: true });
  });
  const service = createSalesFactsSyncService({
    repository,
    upstream: upstream || {},
    now: () => NOW,
    logger: logger || { info() {}, warn() {}, error() {} },
  });
  return { repository, service };
}

function seed(repository, scope, { refreshedAtMs = NOW, empty = false } = {}) {
  repository.replaceOrderProfitScope({
    scope,
    facts: empty ? [] : scope.dates.map((date) => fact(date)),
    coverage: scope.dates.flatMap((date) => scope.sids.map((sid) => coverage(date, refreshedAtMs, {
      sid,
      rowCount: empty ? 0 : 1,
    }))),
    refreshedAtMs,
    refreshBatchId: `seed-${refreshedAtMs}`,
  });
}

test("classifies current 12h, previous 24h, and older frozen coverage boundaries", () => {
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-08", refreshedAtMs: NOW - 12 * HOUR, now: NOW }), "fresh");
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-08", refreshedAtMs: NOW - 12 * HOUR - 1, now: NOW }), "stale");
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-07", refreshedAtMs: NOW - 24 * HOUR, now: NOW }), "fresh");
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-07", refreshedAtMs: NOW - 24 * HOUR - 1, now: NOW }), "stale");
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-06", refreshedAtMs: NOW - 999 * HOUR, now: NOW }), "frozen");
  assert.equal(classifyCoveragePartition({ naturalMonth: "2026-06", refreshedAtMs: null, now: NOW }), "missing");
});

test("fresh and frozen coverage return SQLite state without upstream calls", async (t) => {
  let calls = 0;
  const { repository, service } = await fixture(t, {
    upstream: { async loadOrderProfitRange() { calls += 1; } },
  });
  seed(repository, scopeFor("2026-08-01"), { refreshedAtMs: NOW - HOUR });
  seed(repository, scopeFor("2026-06-01"), { refreshedAtMs: NOW - 100 * HOUR });

  const fresh = await service.refreshOrderProfitScope(scopeFor("2026-08-01"));
  const frozen = await service.refreshOrderProfitScope(scopeFor("2026-06-01"));

  assert.equal(calls, 0);
  assert.equal(fresh.meta.cacheState, "hit");
  assert.equal(frozen.meta.cacheState, "frozen");
  assert.equal(fresh.facts.length, 1);
  assert.equal(frozen.facts.length, 1);
});

test("missing frozen coverage requires force and never auto-fetches", async (t) => {
  let calls = 0;
  const oldScope = scopeFor("2026-06-01");
  const { service } = await fixture(t, {
    upstream: {
      async loadOrderProfitRange(input) {
        calls += 1;
        return upstreamResult({ ...oldScope, dates: [input.startDate] }, { empty: true });
      },
    },
  });

  await assert.rejects(
    service.refreshOrderProfitScope(oldScope),
    (error) => error.code === "SALES_FACTS_FROZEN_COVERAGE_MISSING" && error.statusCode === 422,
  );
  assert.equal(calls, 0);

  const forced = await service.refreshOrderProfitScope(oldScope, { force: true, requestId: "force-old" });
  assert.equal(calls, 1);
  assert.equal(forced.meta.cacheState, "refreshed");
  assert.equal(forced.coverage[0].rowCount, 0);
});

test("mixed range fetches all stale partitions first and commits them once while preserving fresh and frozen", async (t) => {
  const events = [];
  const scope = scopeFor("2026-06-30", "2026-08-02");
  const { repository, service } = await fixture(t, {
    upstream: {
      async loadOrderProfitRange(input) {
        events.push(`network:${input.startDate}:${input.endDate}`);
        const part = scopeFor(input.startDate, input.endDate);
        return upstreamResult(part);
      },
    },
  });
  seed(repository, scopeFor("2026-06-30"), { refreshedAtMs: NOW - 100 * HOUR });
  seed(repository, scopeFor("2026-07-01", "2026-07-31"), { refreshedAtMs: NOW - 25 * HOUR });
  seed(repository, scopeFor("2026-08-01"), { refreshedAtMs: NOW - HOUR });
  seed(repository, scopeFor("2026-08-02"), { refreshedAtMs: NOW - 13 * HOUR });
  const beforeRevision = repository.getRevisions().salesFactsRevision;

  const result = await service.refreshOrderProfitScope(scope);

  assert.deepEqual(events, ["network:2026-07-01:2026-07-31", "network:2026-08-02:2026-08-02"]);
  assert.equal(repository.getRevisions().salesFactsRevision, beforeRevision + 1);
  assert.equal(repository.readCoverage(scope).length, 34);
  assert.equal(result.meta.refreshedPartitionCount, 32);
  assert.equal(result.meta.cacheState, "refreshed");
  const coverageByDate = new Map(repository.readCoverage(scope).map((row) => [row.factDate, row]));
  assert.equal(coverageByDate.get("2026-08-01").refreshedAtMs, NOW - HOUR);
  assert.equal(coverageByDate.get("2026-06-30").refreshedAtMs, NOW - 100 * HOUR);
  assert.equal(coverageByDate.get("2026-08-02").refreshedAtMs, NOW);
  assert.equal(coverageByDate.get("2026-08-01").refreshBatchId, `seed-${NOW - HOUR}`);
  assert.equal(coverageByDate.get("2026-06-30").refreshBatchId, `seed-${NOW - 100 * HOUR}`);
  assert.match(coverageByDate.get("2026-08-02").refreshBatchId, /^sales-facts-order-profit-/u);
});

test("force refresh replaces the entire exact scope including frozen partitions", async (t) => {
  const calls = [];
  const scope = scopeFor("2026-06-30", "2026-08-01");
  const { repository, service } = await fixture(t, {
    upstream: {
      async loadOrderProfitRange(input) {
        calls.push([input.startDate, input.endDate]);
        return upstreamResult(scopeFor(input.startDate, input.endDate), { empty: true });
      },
    },
  });
  seed(repository, scope);

  const result = await service.refreshOrderProfitScope(scope, { force: true });

  assert.deepEqual(calls, [["2026-06-30", "2026-08-01"]]);
  assert.equal(repository.readFacts(scope).length, 0);
  assert.equal(repository.readCoverage(scope).length, 33);
  assert.ok(repository.readCoverage(scope).every(({ rowCount }) => rowCount === 0));
  assert.equal(result.meta.refreshedPartitionCount, 33);
});

test("monthly refresh fetches OrderProfit and custom fees before one atomic commit", async (t) => {
  const events = [];
  const scope = scopeFor("2026-08-01", "2026-08-02");
  const upstream = {
    async loadOrderProfitRange(input) {
      events.push("order-network");
      return upstreamResult(scopeFor(input.startDate, input.endDate));
    },
    async loadCustomFeesByMonth({ naturalMonths }) {
      events.push("fee-network");
      return {
        rows: [{
          naturalMonth: naturalMonths[0], sid: 8708, feeTypeId: "rent", feeName: "办公费用-租金",
          feeAmount: -10000n, currencyMode: "CNY", actualCurrencyCode: "CNY", recognized: true,
          sourceUpdatedAtMs: NOW,
        }],
        coverage: [{ naturalMonth: naturalMonths[0], sid: 8708, currencyMode: "CNY", rowCount: 1 }],
        meta: { source: "lingxing-seller-profit-other-fee" },
      };
    },
  };
  const { repository, service } = await fixture(t, { upstream });
  const original = repository.replaceMonthlyReportScope;
  repository.replaceMonthlyReportScope = (input) => {
    events.push("transaction");
    return original(input);
  };

  const result = await service.refreshMonthlyReportScope(scope, { force: true });

  assert.deepEqual(events, ["order-network", "fee-network", "transaction"]);
  assert.equal(repository.getRevisions().salesFactsRevision, 1);
  assert.equal(repository.readFacts(scope).length, 2);
  assert.equal(repository.readCustomFees(scope).length, 1);
  assert.equal(result.customFeeCoverage[0].refreshedAtMs, NOW);
  assert.equal(result.customFeeCoverage[0].revision, 1);
  assert.equal(result.meta.cacheState, "refreshed");
});

test("monthly refresh does not start a transaction when either upstream source fails", async (t) => {
  const scope = scopeFor("2026-08-01");
  const { repository, service } = await fixture(t, {
    upstream: {
      async loadOrderProfitRange(input) { return upstreamResult(scopeFor(input.startDate, input.endDate)); },
      async loadCustomFeesByMonth() { throw new Error("fee unavailable"); },
    },
  });
  seed(repository, scope);
  const before = repository.debugSnapshotForTest();
  let transactions = 0;
  const original = repository.replaceMonthlyReportScope;
  repository.replaceMonthlyReportScope = (input) => { transactions += 1; return original(input); };

  await assert.rejects(service.refreshMonthlyReportScope(scope, { force: true }));

  assert.equal(transactions, 0);
  assert.deepEqual(repository.debugSnapshotForTest(), before);
});

test("same exact operation and range joins one in-flight refresh while different ranges remain independent", async (t) => {
  const pending = new Map();
  let calls = 0;
  const { service } = await fixture(t, {
    upstream: {
      loadOrderProfitRange(input) {
        calls += 1;
        return new Promise((resolve) => pending.set(input.startDate, () => resolve(upstreamResult(scopeFor(input.startDate, input.endDate)))));
      },
    },
  });
  const firstScope = scopeFor("2026-08-01");
  const secondScope = scopeFor("2026-08-02");
  const first = service.refreshOrderProfitScope(firstScope);
  const joined = service.refreshOrderProfitScope(firstScope);
  const independent = service.refreshOrderProfitScope(secondScope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  pending.get("2026-08-01")();
  pending.get("2026-08-02")();
  const [owner, joiner] = await Promise.all([first, joined, independent]).then((rows) => rows.slice(0, 2));
  assert.equal(owner.meta.singleFlight, "owner");
  assert.equal(joiner.meta.singleFlight, "joiner");
});

test("failed in-flight refresh is cleared and stale data is never returned", async (t) => {
  let calls = 0;
  const scope = scopeFor("2026-08-01");
  const { repository, service } = await fixture(t, {
    upstream: {
      async loadOrderProfitRange() {
        calls += 1;
        if (calls === 1) throw new Error("temporary upstream failure");
        return upstreamResult(scope);
      },
    },
  });
  seed(repository, scope, { refreshedAtMs: NOW - 13 * HOUR });

  await assert.rejects(service.refreshOrderProfitScope(scope), /temporary upstream failure/u);
  assert.equal(repository.readCoverage(scope)[0].refreshedAtMs, NOW - 13 * HOUR);
  const retried = await service.refreshOrderProfitScope(scope);
  assert.equal(calls, 2);
  assert.equal(retried.meta.cacheState, "refreshed");
});

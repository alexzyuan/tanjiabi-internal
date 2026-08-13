import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSalesFactsScope } from "../src/services/salesFactsIdentity.js";
import { getSalesFacts } from "../src/services/salesFactsQueryService.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const sellers = [
  { sid: 8708, countryCode: "US", status: 1 },
  { sid: 8709, countryCode: "CA", status: 1 },
];

function scopeInput(startDate, endDate = startDate, currencyMode = "CNY", sids = [8708]) {
  return { startDate, endDate, currencyMode, sids };
}

function scopeFor(startDate, endDate = startDate, currencyMode = "CNY", sids = [8708]) {
  return normalizeSalesFactsScope({
    ...scopeInput(startDate, endDate, currencyMode, sids),
    sellerDirectory: sellers,
    now: NOW,
  });
}

function fact(overrides = {}) {
  return {
    factDate: "2026-08-01",
    sid: 8708,
    msku: "MSKU-A",
    mskuKey: "msku-a",
    currencyMode: "CNY",
    actualCurrencyCode: "CNY",
    metrics: { totalSalesAmount: 105000n, totalSalesQuantity: 20000n },
    sourceUpdatedAtMs: NOW - 3_600_000,
    refreshedAtMs: NOW - 3_600_000,
    refreshBatchId: "seed",
    ...overrides,
  };
}

function coverage(overrides = {}) {
  return {
    factDate: "2026-08-01",
    sid: 8708,
    currencyMode: "CNY",
    sourceUpdatedAtMs: NOW - 3_600_000,
    refreshedAtMs: NOW - 3_600_000,
    rowCount: 1,
    pageCount: 1,
    refreshBatchId: "seed",
    revision: 7,
    ...overrides,
  };
}

function assignedOwner(overrides = {}) {
  return {
    sid: 8708,
    msku: "MSKU-A",
    mskuKey: "msku-a",
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    ownerIdentity: "id:101",
    ownerPersonId: "101",
    ownerNameSnapshot: "Alice",
    identitySource: "lingxing-person-id",
    status: "assigned",
    updatedAtMs: NOW,
    ...overrides,
  };
}

function fakeRepository({ facts = [], coverageRows = [], owners = [], revisions = {} } = {}) {
  const state = {
    facts: structuredClone(facts),
    coverage: structuredClone(coverageRows),
    owners: structuredClone(owners),
    revisions: { salesFactsRevision: 7, ownerRevision: 3, ...revisions },
    reads: [],
  };
  return {
    state,
    readFacts(scope) {
      state.reads.push({ operation: "facts", scope });
      return state.facts.filter((row) => scope.dates.includes(row.factDate)
        && scope.sids.includes(row.sid)
        && row.currencyMode === scope.currencyMode);
    },
    readCoverage(scope) {
      state.reads.push({ operation: "coverage", scope });
      return state.coverage.filter((row) => scope.dates.includes(row.factDate)
        && scope.sids.includes(row.sid)
        && row.currencyMode === scope.currencyMode);
    },
    readOwnerPeriods(scope) {
      state.reads.push({ operation: "owners", scope });
      return state.owners.filter((row) => scope.sids.includes(row.sid));
    },
    getRevisions() {
      state.reads.push({ operation: "revisions" });
      return { ...state.revisions };
    },
  };
}

function queryOptions(repository, overrides = {}) {
  return {
    repository,
    getSellerDirectory: async () => sellers,
    refreshOrderProfitScope: async () => {
      throw new Error("refresh was not expected");
    },
    requestId: "query-1",
    now: NOW,
    logger: { info() {}, error() {} },
    ...overrides,
  };
}

test("fresh SQLite coverage reads without upstream refresh and returns safe decoded metadata", async () => {
  const repository = fakeRepository({
    facts: [fact()],
    coverageRows: [coverage()],
    owners: [assignedOwner()],
  });
  let refreshCalls = 0;
  const result = await getSalesFacts(scopeInput("2026-08-01"), queryOptions(repository, {
    refreshOrderProfitScope: async () => { refreshCalls += 1; },
    requestId: "query-fresh",
  }));

  assert.equal(refreshCalls, 0);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].metrics, { totalSalesAmount: 10.5, totalSalesQuantity: 2 });
  assert.equal(result.records[0].listingOwner, "Alice");
  assert.equal(result.records[0].listingOwnerStatus, "assigned");
  assert.equal(result.records[0].listingOwnerIdentity, "id:101");
  assert.equal(result.meta.source, "sales-facts-sqlite");
  assert.equal(result.meta.cacheState, "hit");
  assert.equal(result.meta.updatedAt, new Date(NOW - 3_600_000).toISOString());
  assert.equal(result.meta.ageSeconds, 3600);
  assert.equal(result.meta.revision, 7);
  assert.equal(result.meta.ownerRevision, 3);
  assert.equal(result.meta.requestId, "query-fresh");
  assert.deepEqual(result.meta.scopeCount, { dates: 1, sids: 1 });
  assert.equal(typeof result.meta.timings.queryMs, "number");
  assert.equal("raw" in result.records[0], false);
  assert.equal("databasePath" in result.meta, false);
  assert.equal("stack" in result.meta, false);
});

test("stale current coverage refreshes synchronously and does not return stale facts", async () => {
  const repository = fakeRepository({
    facts: [fact({ metrics: { totalSalesAmount: 10000n } })],
    coverageRows: [coverage({ refreshedAtMs: NOW - 13 * 3_600_000 })],
    owners: [assignedOwner()],
  });
  const refreshScopes = [];
  const result = await getSalesFacts(scopeInput("2026-08-01"), queryOptions(repository, {
    refreshOrderProfitScope: async (scope) => {
      refreshScopes.push(scope);
      repository.state.facts = [fact({ metrics: { totalSalesAmount: 250000n }, refreshedAtMs: NOW })];
      repository.state.coverage = [coverage({ refreshedAtMs: NOW, refreshBatchId: "refresh" })];
      return { meta: { cacheState: "refreshed" } };
    },
  }));

  assert.equal(refreshScopes.length, 1);
  assert.equal(refreshScopes[0].rangeKey, "2026-08-01|2026-08-01|8708|CNY");
  assert.equal(result.records[0].metrics.totalSalesAmount, 25);
  assert.equal(result.meta.cacheState, "refreshed");
});

test("refresh errors propagate instead of returning expired SQLite facts", async () => {
  const repository = fakeRepository({
    facts: [fact()],
    coverageRows: [coverage({ refreshedAtMs: NOW - 13 * 3_600_000 })],
  });
  const upstreamError = new Error("upstream unavailable");
  await assert.rejects(
    getSalesFacts(scopeInput("2026-08-01"), queryOptions(repository, {
      refreshOrderProfitScope: async () => { throw upstreamError; },
    })),
    (error) => error === upstreamError,
  );
});

test("older covered history is frozen and missing frozen coverage requires force refresh", async () => {
  const frozenRepository = fakeRepository({
    facts: [fact({ factDate: "2026-06-01" })],
    coverageRows: [coverage({ factDate: "2026-06-01", refreshedAtMs: NOW - 100 * 24 * 3_600_000 })],
  });
  let frozenRefreshCalls = 0;
  const frozen = await getSalesFacts(scopeInput("2026-06-01"), queryOptions(frozenRepository, {
    refreshOrderProfitScope: async () => { frozenRefreshCalls += 1; },
  }));
  assert.equal(frozenRefreshCalls, 0);
  assert.equal(frozen.meta.cacheState, "frozen");

  const missingRepository = fakeRepository();
  let forceCalls = 0;
  await assert.rejects(
    getSalesFacts(scopeInput("2026-06-01"), queryOptions(missingRepository, {
      refreshOrderProfitScope: async () => { forceCalls += 1; },
    })),
    (error) => error.code === "SALES_FACTS_FROZEN_COVERAGE_MISSING" && error.statusCode === 422,
  );
  assert.equal(forceCalls, 0);

  const forcedRepository = fakeRepository();
  const forced = await getSalesFacts(scopeInput("2026-06-01"), queryOptions(forcedRepository, {
    forceRefresh: true,
    refreshOrderProfitScope: async (scope) => {
      forceCalls += 1;
      assert.equal(scope.rangeKey, "2026-06-01|2026-06-01|8708|CNY");
      forcedRepository.state.facts = [fact({ factDate: "2026-06-01", refreshedAtMs: NOW })];
      forcedRepository.state.coverage = [coverage({ factDate: "2026-06-01", refreshedAtMs: NOW })];
      return { meta: { cacheState: "refreshed" } };
    },
  }));
  assert.equal(forceCalls, 1);
  assert.equal(forced.meta.cacheState, "refreshed");
});

test("owner joins use fact date, preserve historical unknown, and filter after the join", async () => {
  const repository = fakeRepository({
    facts: [
      fact({ factDate: "2026-08-01", msku: "MSKU-A", mskuKey: "msku-a" }),
      fact({ factDate: "2026-08-02", msku: "MSKU-B", mskuKey: "msku-b" }),
      fact({ factDate: "2026-06-01", msku: "MSKU-C", mskuKey: "msku-c" }),
    ],
    coverageRows: [
      coverage({ factDate: "2026-08-01" }),
      coverage({ factDate: "2026-08-02" }),
      coverage({ factDate: "2026-06-01", refreshedAtMs: NOW - 100 * 24 * 3_600_000 }),
    ],
    owners: [
      assignedOwner({ msku: "MSKU-A", mskuKey: "msku-a", effectiveTo: "2026-08-01" }),
      assignedOwner({ msku: "MSKU-A", mskuKey: "msku-a", effectiveFrom: "2026-08-02", ownerIdentity: "id:102", ownerPersonId: "102", ownerNameSnapshot: "Bob" }),
      assignedOwner({ msku: "MSKU-B", mskuKey: "msku-b", effectiveFrom: "2026-08-01", ownerIdentity: "id:102", ownerPersonId: "102", ownerNameSnapshot: "Bob" }),
      assignedOwner({ msku: "MSKU-C", mskuKey: "msku-c", effectiveFrom: "0001-01-01", effectiveTo: "2026-05-31", ownerIdentity: null, ownerPersonId: null, ownerNameSnapshot: null, status: "historical-unknown", identitySource: "cutover-historical-unknown" }),
    ],
  });
  const seenScopes = [];
  const result = await getSalesFacts(scopeInput("2026-08-01", "2026-08-02"), queryOptions(repository, {
    listingOwner: "Bob",
    refreshOrderProfitScope: async (scope, options) => {
      seenScopes.push({ scope, options });
    },
  }));
  assert.deepEqual(result.records.map((row) => [row.factDate, row.listingOwner]), [["2026-08-02", "Bob"]]);
  assert.equal(seenScopes.length, 0);

  const historical = await getSalesFacts(scopeInput("2026-06-01"), queryOptions(repository));
  assert.equal(historical.records[0].listingOwnerStatus, "historical-unknown");
  assert.equal(historical.records[0].listingOwner, null);
});

test("CNY and ORIGINAL reads stay isolated and owner filters never enter the base scope key", async () => {
  const cnyRepository = fakeRepository({
    facts: [fact()],
    coverageRows: [coverage()],
  });
  const cny = await getSalesFacts(scopeInput("2026-08-01", "2026-08-01", "CNY"), queryOptions(cnyRepository));
  assert.equal(cny.records.length, 1);
  assert.equal(cnyRepository.state.reads.find((entry) => entry.operation === "facts").scope.currencyMode, "CNY");

  const originalRepository = fakeRepository({
    facts: [fact({ currencyMode: "ORIGINAL", actualCurrencyCode: "USD" })],
    coverageRows: [coverage({ currencyMode: "ORIGINAL" })],
  });
  const original = await getSalesFacts(scopeInput("2026-08-01", "2026-08-01", "ORIGINAL"), queryOptions(originalRepository, {
    requestId: "original-query",
  }));
  assert.equal(original.records.length, 1);
  assert.equal(original.records[0].actualCurrencyCode, "USD");
  assert.equal(original.meta.currencyMode, "ORIGINAL");
  assert.equal(originalRepository.state.reads.find((entry) => entry.operation === "facts").scope.rangeKey, "2026-08-01|2026-08-01|8708|ORIGINAL");
});

test("revalidates a pre-shaped scope instead of trusting forged SID, currency, or range key", async () => {
  const repository = fakeRepository();
  const forged = {
    ...scopeFor("2026-08-01"),
    sids: [9999],
    sellerDirectory: [{ sid: 9999, countryCode: "US", status: 1 }],
    currencyMode: "ORIGINAL",
    rangeKey: "forged-range-key",
  };
  await assert.rejects(
    getSalesFacts(forged, queryOptions(repository)),
    (error) => error.code === "SALES_FACTS_UNKNOWN_SID",
  );
});

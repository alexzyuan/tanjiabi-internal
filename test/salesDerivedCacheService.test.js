import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSalesFactsScope } from "../src/services/salesFactsIdentity.js";
import { getOrBuildSalesDerived } from "../src/services/salesDerivedCacheService.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const TTL_MS = 12 * 60 * 60 * 1000;
const sellers = [{ sid: 8708, countryCode: "US", status: 1 }];

function scopeFor(startDate = "2026-08-01", endDate = startDate, listingOwner = "") {
  return {
    ...normalizeSalesFactsScope({
      startDate,
      endDate,
      sids: [8708],
      currencyMode: "CNY",
      sellerDirectory: sellers,
      now: NOW,
    }),
    listingOwner,
  };
}

function safePayload(amount = 12.5) {
  return { rows: [{ sid: 8708, amount }], summary: { count: 1 } };
}

function fakeRepository({ revisions = {}, cached = null } = {}) {
  const state = {
    revisions: { salesFactsRevision: 4, ownerRevision: 2, ...revisions },
    cache: cached,
    reads: [],
    writes: [],
  };
  return {
    state,
    readDerivedCache(cacheKey) {
      state.reads.push({ operation: "read", cacheKey });
      if (!state.cache || state.cache.cacheKey !== cacheKey) return null;
      return structuredClone(state.cache);
    },
    writeDerivedCache(input) {
      state.writes.push(structuredClone(input));
      state.cache = structuredClone({
        cacheKey: input.cacheKey,
        payload: input.payload,
        salesFactsRevision: input.salesFactsRevision,
        ownerRevision: input.ownerRevision,
        mapperVersion: input.mapperVersion,
        generatedAtMs: input.generatedAtMs,
        expiresAtMs: input.expiresAtMs,
      });
      return { written: true };
    },
    getRevisions() {
      state.reads.push({ operation: "revisions" });
      return { ...state.revisions };
    },
  };
}

function options(repository, overrides = {}) {
  return {
    repository,
    scope: scopeFor(),
    mapperVersion: "sales-weekly-facts-v1",
    build: async () => safePayload(),
    now: NOW,
    requestId: "derived-1",
    logger: { info() {}, error() {} },
    ...overrides,
  };
}

test("returns a fresh 12-hour derived cache hit without rebuilding", async () => {
  const repository = fakeRepository({
    cached: {
      cacheKey: scopeFor().rangeKey,
      payload: safePayload(9.5),
      salesFactsRevision: 4,
      ownerRevision: 2,
      mapperVersion: "sales-weekly-facts-v1",
      generatedAtMs: NOW - 60_000,
      expiresAtMs: NOW + TTL_MS,
    },
  });
  let buildCalls = 0;
  const result = await getOrBuildSalesDerived(options(repository, {
    build: async () => { buildCalls += 1; return safePayload(99); },
  }));

  assert.equal(buildCalls, 0);
  assert.deepEqual(result.payload, safePayload(9.5));
  assert.equal(result.meta.source, "sales-derived-cache");
  assert.equal(result.meta.cacheState, "hit");
  assert.equal(result.meta.ageSeconds, 60);
  assert.equal(result.meta.revision, 4);
  assert.equal(result.meta.ownerRevision, 2);
  assert.equal(result.meta.mapperVersion, "sales-weekly-facts-v1");
  assert.equal(result.meta.requestId, "derived-1");
  assert.deepEqual(result.meta.scopeCount, { dates: 1, sids: 1 });
  assert.equal("listingOwner" in result.meta, false);
});

test("expired cache recomputes without invoking an upstream refresh", async () => {
  const repository = fakeRepository({
    cached: {
      cacheKey: scopeFor().rangeKey,
      payload: safePayload(1),
      salesFactsRevision: 4,
      ownerRevision: 2,
      mapperVersion: "sales-weekly-facts-v1",
      generatedAtMs: NOW - TTL_MS,
      expiresAtMs: NOW,
    },
  });
  let buildCalls = 0;
  const result = await getOrBuildSalesDerived(options(repository, {
    build: async ({ scope }) => {
      buildCalls += 1;
      assert.equal(scope.rangeKey, "2026-08-01|2026-08-01|8708|CNY");
      return safePayload(2);
    },
  }));
  assert.equal(buildCalls, 1);
  assert.equal(repository.state.writes.length, 1);
  assert.equal(result.payload.rows[0].amount, 2);
  assert.equal(result.meta.cacheState, "refreshed");
});

test("sales facts, owner, and mapper revisions each invalidate the cache", async () => {
  for (const change of [
    { salesFactsRevision: 5 },
    { ownerRevision: 3 },
  ]) {
    const repository = fakeRepository({
      revisions: change,
      cached: {
        cacheKey: scopeFor().rangeKey,
        payload: safePayload(1),
        salesFactsRevision: 4,
        ownerRevision: 2,
        mapperVersion: "sales-weekly-facts-v1",
        generatedAtMs: NOW - 60_000,
        expiresAtMs: NOW + TTL_MS,
      },
    });
    let builds = 0;
    const result = await getOrBuildSalesDerived(options(repository, {
      build: async () => { builds += 1; return safePayload(3); },
    }));
    assert.equal(builds, 1);
    assert.equal(result.meta.cacheState, "refreshed");
  }

  const repository = fakeRepository({
    cached: {
      cacheKey: scopeFor().rangeKey,
      payload: safePayload(1),
      salesFactsRevision: 4,
      ownerRevision: 2,
      mapperVersion: "sales-weekly-facts-v0",
      generatedAtMs: NOW - 60_000,
      expiresAtMs: NOW + TTL_MS,
    },
  });
  let builds = 0;
  await getOrBuildSalesDerived(options(repository, {
    build: async () => { builds += 1; return safePayload(4); },
  }));
  assert.equal(builds, 1);
});

test("rejects BigInt, functions, custom prototypes, and unregistered keys before writing", async () => {
  const badPayloads = [
    { rows: [{ sid: 8708, amount: 1n }] },
    { rows: [{ sid: 8708, calculate: () => 1 }] },
    Object.assign(Object.create({ inherited: true }), { rows: [] }),
    { rows: [], token: "secret" },
  ];
  for (const payload of badPayloads) {
    const repository = fakeRepository();
    await assert.rejects(
      getOrBuildSalesDerived(options(repository, { build: async () => payload })),
      (error) => error.code === "SALES_FACTS_DERIVED_PAYLOAD_INVALID",
    );
    assert.equal(repository.state.writes.length, 0);
  }
});

test("rejects a malformed persisted payload instead of rebuilding over it", async () => {
  const repository = fakeRepository({
    cached: {
      cacheKey: scopeFor().rangeKey,
      payload: { rows: [], token: "persisted-secret" },
      salesFactsRevision: 4,
      ownerRevision: 2,
      mapperVersion: "sales-weekly-facts-v1",
      generatedAtMs: NOW - 60_000,
      expiresAtMs: NOW + TTL_MS,
    },
  });
  let builds = 0;
  await assert.rejects(
    getOrBuildSalesDerived(options(repository, { build: async () => { builds += 1; return safePayload(); } })),
    (error) => error.code === "SALES_FACTS_DERIVED_PAYLOAD_INVALID",
  );
  assert.equal(builds, 0);
  assert.equal(repository.state.writes.length, 0);
});

test("same exact scope and mapper version single-flights while owner filters stay out of the key", async () => {
  const repository = fakeRepository();
  let buildCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = getOrBuildSalesDerived(options(repository, {
    scope: scopeFor("2026-08-01", "2026-08-02", "Alice"),
    build: async () => {
      buildCalls += 1;
      await gate;
      return safePayload(5);
    },
    requestId: "owner-a",
  }));
  const second = getOrBuildSalesDerived(options(repository, {
    scope: scopeFor("2026-08-01", "2026-08-02", "Bob"),
    build: async () => {
      buildCalls += 1;
      return safePayload(6);
    },
    requestId: "owner-b",
  }));
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(buildCalls, 1);
  assert.deepEqual(left.payload, right.payload);
  assert.equal(left.meta.singleFlight, "owner");
  assert.equal(right.meta.singleFlight, "joiner");
  assert.equal(repository.state.writes.length, 1);
  assert.equal(repository.state.writes[0].cacheKey, "2026-08-01|2026-08-02|8708|CNY");
});

test("different exact scope keys build independently and a failed build clears in-flight", async () => {
  const repository = fakeRepository();
  let builds = 0;
  const [first, second] = await Promise.all([
    getOrBuildSalesDerived(options(repository, {
      scope: scopeFor("2026-08-01"),
      build: async () => { builds += 1; return safePayload(1); },
    })),
    getOrBuildSalesDerived(options(repository, {
      scope: scopeFor("2026-08-02"),
      build: async () => { builds += 1; return safePayload(2); },
    })),
  ]);
  assert.equal(builds, 2);
  assert.equal(first.payload.rows[0].amount, 1);
  assert.equal(second.payload.rows[0].amount, 2);

  let failures = 0;
  await assert.rejects(getOrBuildSalesDerived(options(repository, {
    scope: scopeFor("2026-08-03"),
    build: async () => { failures += 1; throw new Error("build failed"); },
  })));
  const retry = await getOrBuildSalesDerived(options(repository, {
    scope: scopeFor("2026-08-03"),
    build: async () => { failures += 1; return safePayload(3); },
  }));
  assert.equal(failures, 2);
  assert.equal(retry.payload.rows[0].amount, 3);
});

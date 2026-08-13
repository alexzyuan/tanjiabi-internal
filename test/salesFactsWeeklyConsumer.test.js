import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getSalesWeeklyDashboard, SALES_WEEKLY_MAPPER_VERSION } from "../src/services/dashboardService.js";

const sellers = [
  { sid: 1, name: "探嘉美国", country: "US", countryCode: "US", status: 1 },
];

function fact({ msku, owner, sales, quantity, refund }) {
  return {
    factDate: "2026-07-01",
    sid: 1,
    msku,
    mskuKey: msku.toLowerCase(),
    currencyMode: "CNY",
    actualCurrencyCode: "CNY",
    listingOwner: owner,
    listingOwnerStatus: "assigned",
    listingOwnerIdentity: `name:${owner.toLowerCase()}`,
    listingOwnerPersonId: null,
    listingOwnerIdentitySource: "name-fallback",
    metrics: {
      totalSalesAmount: sales,
      totalSalesQuantity: quantity,
      grossProfit: sales / 10,
      totalAdsCost: sales / 20,
      totalAdsSales: sales / 5,
      totalSalesRefunds: refund,
    },
  };
}

function createOptions({ mapperVersion = SALES_WEEKLY_MAPPER_VERSION, getSalesFacts, getOrBuildSalesDerived, facts = [] } = {}) {
  return {
    salesFacts: {
      sellerDirectory: sellers,
      getSalesFacts,
      getOrBuildSalesDerived,
      mapperVersion,
      facts,
      getAvailableDays: async () => ({ map: new Map(), updatedAt: null, cacheHit: true }),
    },
    getBudgetTargetContext: async () => ({ rows: [], totals: {} }),
  };
}

test("sales weekly facts are read once per request and owner filters reuse one derived range", async () => {
  const records = [fact({ msku: "MSKU-A", owner: "Alice", sales: 100, quantity: 2, refund: 2 }), fact({ msku: "MSKU-B", owner: "Bob", sales: 200, quantity: 4, refund: 4 })];
  const factsCalls = [];
  const derivedCalls = [];
  const derivedCache = new Map();
  const options = createOptions({
    facts: records,
    getSalesFacts: async (scope, queryOptions) => {
      factsCalls.push({ scope, listingOwner: queryOptions.listingOwner });
      return {
        records,
        meta: {
          source: "sales-facts-sqlite",
          cacheState: "hit",
          updatedAt: "2026-07-01T00:00:00.000Z",
          ageSeconds: 10,
          revision: 7,
          ownerRevision: 3,
          requestId: queryOptions.requestId,
          scopeCount: { dates: scope.dates.length, sids: scope.sids.length },
        },
      };
    },
    getOrBuildSalesDerived: async ({ scope, mapperVersion, build }) => {
      const key = `${scope.rangeKey}|${mapperVersion}`;
      derivedCalls.push(key);
      if (!derivedCache.has(key)) derivedCache.set(key, await build({ scope }));
      return {
        payload: derivedCache.get(key),
        meta: {
          source: "sales-derived-cache",
          cacheState: derivedCalls.filter((item) => item === key).length === 1 ? "refreshed" : "hit",
          updatedAt: "2026-07-01T00:00:00.000Z",
          ageSeconds: 10,
          revision: 7,
          ownerRevision: 3,
          mapperVersion,
          requestId: "weekly-test",
          rangeKey: scope.rangeKey,
          scopeCount: { dates: scope.dates.length, sids: scope.sids.length },
        },
      };
    },
  });

  const alice = await getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-07", currencyCode: "CNY", sids: [1], listingOwner: "Alice" }, options);
  const bob = await getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-07", currencyCode: "CNY", sids: [1], listingOwner: "Bob" }, options);

  assert.equal(factsCalls.length, 2);
  assert.deepEqual(factsCalls.map((call) => call.listingOwner), [undefined, undefined]);
  assert.equal(new Set(derivedCalls).size, 1);
  assert.equal(alice.summary.find((item) => item[0] === "销售额")?.[1], "100");
  assert.equal(bob.summary.find((item) => item[0] === "销售额")?.[1], "200");
  assert.equal(alice.meta.source, "sales-facts-sqlite");
  assert.equal(alice.meta.rangeKey, bob.meta.rangeKey);
  assert.equal(alice.meta.ownerRevision, 3);
});

test("sales weekly mapper version invalidates the derived cache without changing the facts range", async () => {
  const factsCalls = [];
  const derivedKeys = [];
  const options = createOptions({
    facts: [fact({ msku: "MSKU-A", owner: "Alice", sales: 100, quantity: 2, refund: 2 })],
    getSalesFacts: async (scope, queryOptions) => {
      factsCalls.push(scope.rangeKey);
      return {
        records: [fact({ msku: "MSKU-A", owner: "Alice", sales: 100, quantity: 2, refund: 2 })],
        meta: { source: "sales-facts-sqlite", cacheState: "hit", updatedAt: "2026-07-01T00:00:00.000Z", ageSeconds: 0, revision: 1, ownerRevision: 1, requestId: queryOptions.requestId, scopeCount: { dates: scope.dates.length, sids: scope.sids.length } },
      };
    },
    getOrBuildSalesDerived: async ({ scope, mapperVersion, build }) => {
      derivedKeys.push(`${scope.rangeKey}|${mapperVersion}`);
      return { payload: await build({ scope }), meta: { source: "sales-derived-cache", cacheState: "refreshed", updatedAt: "2026-07-01T00:00:00.000Z", ageSeconds: 0, revision: 1, ownerRevision: 1, mapperVersion, requestId: "weekly-test", rangeKey: scope.rangeKey, scopeCount: { dates: scope.dates.length, sids: scope.sids.length } } };
    },
  });

  await getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-07", currencyCode: "CNY", sids: [1] }, options);
  await getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-07", currencyCode: "CNY", sids: [1] }, { ...options, salesFacts: { ...options.salesFacts, mapperVersion: "sales-weekly-facts-v2" } });

  assert.equal(factsCalls.length, 2);
  assert.equal(derivedKeys[0].split("|").slice(0, -1).join("|"), derivedKeys[1].split("|").slice(0, -1).join("|"));
  assert.deepEqual(derivedKeys.map((key) => key.split("|").at(-1)), [SALES_WEEKLY_MAPPER_VERSION, "sales-weekly-facts-v2"]);
});

test("sales weekly facts failure propagates instead of returning a legacy dashboard", async () => {
  const error = new Error("facts unavailable");
  await assert.rejects(
    getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-07", currencyCode: "CNY", sids: [1] }, createOptions({
      getSalesFacts: async () => { throw error; },
      getOrBuildSalesDerived: async () => { throw new Error("derived should not run"); },
    })),
    (actual) => actual === error,
  );
});

test("sales weekly runtime service has no legacy JSON cache ownership", async () => {
  const source = await readFile(new URL("../src/services/dashboardService.js", import.meta.url), "utf8");
  for (const symbol of ["readSalesDashboardCache", "readSalesWeeklySourceCache", "saveSalesDashboardCache", "saveSalesWeeklySourceCache"]) {
    assert.equal(source.includes(symbol), false, `${symbol} must not be used by the runtime consumer`);
  }
});

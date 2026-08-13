import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

function salesWeeklySourceCacheKey() {
  return JSON.stringify({
    version: "sales-weekly-source-v3",
    startDate: "2026-07-01",
    endDate: "2026-07-23",
    currencyCode: "ORIGINAL",
    sids: [],
  });
}

async function withTempLingxingProvider(run) {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-weekly-source-cache-"));
  const previousProvider = process.env.DATA_PROVIDER;
  const previousAppKey = process.env.LINGXING_APP_KEY;
  const previousAppSecret = process.env.LINGXING_APP_SECRET;
  try {
    process.env.DATA_PROVIDER = "lingxing";
    delete process.env.LINGXING_APP_KEY;
    delete process.env.LINGXING_APP_SECRET;
    process.chdir(tempRoot);
    await run(projectRoot);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
    if (previousAppKey === undefined) delete process.env.LINGXING_APP_KEY;
    else process.env.LINGXING_APP_KEY = previousAppKey;
    if (previousAppSecret === undefined) delete process.env.LINGXING_APP_SECRET;
    else process.env.LINGXING_APP_SECRET = previousAppSecret;
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("sales weekly ignores the legacy source cache and requires the sales facts dependency", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await cacheStore.saveSalesWeeklySourceCache(salesWeeklySourceCacheKey(), { orderProfitRecords: [{ totalSalesAmount: 999 }] });
    const { getSalesWeeklyDashboard } = await importFresh(projectRoot, "src/services/dashboardService.js");
    const error = new Error("facts unavailable");
    await assert.rejects(
      getSalesWeeklyDashboard({ startDate: "2026-07-01", endDate: "2026-07-23", currencyCode: "CNY", sids: [1] }, {
        salesFacts: {
          sellerDirectory: [{ sid: 1, name: "探嘉美国", countryCode: "US", status: 1 }],
          getSalesFacts: async () => { throw error; },
        },
      }),
      (actual) => actual === error,
    );
  });
});

test("sales review available days matches the sales forecast cache by exact seller and MSKU", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-dashboard-cache.json"), JSON.stringify({
      version: "sales-forecast-v2-strict-sid-fba",
      cachedAt: Date.now(),
      updatedAt: "2026/8/11 10:00:00",
      rows: [
        { sid: 101, msku: "MSKU-SHARED", fbaAvailableDays: 28.5 },
        { sid: 102, msku: "msku-shared", fbaAvailableDays: 73 },
      ],
    }), "utf8");
    const { enrichSalesReviewAvailableDays } = await importFresh(projectRoot, "src/services/dashboardService.js");

    const dashboard = await enrichSalesReviewAvailableDays({
      detailRows: [
        { sid: 101, msku: "MSKU-SHARED" },
        { sid: 102, msku: "MSKU-SHARED" },
        { sid: 103, msku: "MSKU-SHARED" },
      ],
      meta: { source: "领星 ERP" },
    }, {
      getAvailableDays: async () => ({
        map: new Map([
          ["101|msku-shared", 28.5],
          ["102|msku-shared", 73],
        ]),
        updatedAt: "2026/8/11 10:00:00",
        cacheHit: true,
      }),
    });

    assert.deepEqual(dashboard.detailRows.map((row) => row.fbaAvailableDays), [28.5, 73, null]);
    assert.deepEqual(dashboard.meta.availableDays, {
      source: "sales-forecast-cache",
      updatedAt: "2026/8/11 10:00:00",
      matchedCount: 2,
      missingCount: 1,
      cacheHit: true,
    });
  });
});

test("sales weekly dashboard fails instead of falling back to a legacy dashboard when live OrderProfit loading fails", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await cacheStore.saveSalesDashboardCache({
      meta: { source: "领星 ERP", updatedAt: "2026-08-09 10:00:00" },
      detailRows: [{ msku: "LEGACY-MSKU", refundRate: 5 }],
    });
    const { getSalesWeeklyDashboard } = await importFresh(projectRoot, "src/services/dashboardService.js");

    await assert.rejects(
      getSalesWeeklyDashboard({
        startDate: "2026-08-01",
        endDate: "2026-08-09",
        currencyCode: "CNY",
      }),
      /LINGXING_BASE_URL/,
    );
  });
});

test("sales weekly source cache contract rejects entries without the 30-day refund data", async () => {
  const projectRoot = process.cwd();
  const { validateSalesWeeklySourceCache } = await importFresh(projectRoot, "src/services/dashboardService.js");

  const result = validateSalesWeeklySourceCache({
    cacheScope: JSON.parse(salesWeeklySourceCacheKey()),
    orderProfitRecords: [],
    raw: {},
  }, JSON.parse(salesWeeklySourceCacheKey()));

  assert.deepEqual(result, {
    ok: false,
    reasons: [
      "recent30OrderProfitRecords must be an array",
      "raw.recent30 metadata is required",
    ],
  });
});

test("sales weekly dashboard cache contract rejects detail rows without available days", async () => {
  const projectRoot = process.cwd();
  const { validateSalesWeeklyDashboardCache } = await importFresh(projectRoot, "src/services/dashboardService.js");

  const result = validateSalesWeeklyDashboardCache({
    detailRows: [{ msku: "MSKU-1", refundRate30d: 3 }],
  });

  assert.deepEqual(result, {
    ok: false,
    reasons: ["1 detail rows are missing fbaAvailableDays"],
  });
});

test("sales weekly source cache contract rejects a 30-day range that does not end on the selected end date", async () => {
  const projectRoot = process.cwd();
  const { validateSalesWeeklySourceCache } = await importFresh(projectRoot, "src/services/dashboardService.js");
  const scope = JSON.parse(salesWeeklySourceCacheKey());

  const result = validateSalesWeeklySourceCache({
    cacheScope: scope,
    recent30OrderProfitRecords: [],
    raw: {
      recent30: {
        startDate: "2026-06-24",
        endDate: "2026-07-22",
        recordCount: 0,
      },
    },
  }, scope);

  assert.deepEqual(result, {
    ok: false,
    reasons: ["raw.recent30 date range does not match the requested end date"],
  });
});

test("sales weekly source cache migrates a valid v2 snapshot to the current contract", async () => {
  const projectRoot = process.cwd();
  const { migrateSalesWeeklySourceCache } = await importFresh(projectRoot, "src/services/salesWeeklySourceCache.js");
  const expectedScope = JSON.parse(salesWeeklySourceCacheKey());
  const source = {
    cacheScope: { ...expectedScope, version: "sales-weekly-source-v2" },
    recent30OrderProfitRecords: [{ msku: "MSKU-1", totalSalesAmount: 100, totalSalesRefunds: 3 }],
    raw: {
      recent30: {
        startDate: "2026-06-24",
        endDate: "2026-07-23",
        recordCount: 1,
      },
    },
  };

  const result = migrateSalesWeeklySourceCache(source, expectedScope);

  assert.equal(result.migratedFrom, "sales-weekly-source-v2");
  assert.equal(result.data.cacheScope.version, "sales-weekly-source-v3");
  assert.deepEqual(result.data.recent30OrderProfitRecords, source.recent30OrderProfitRecords);
});

test("sales weekly source cache does not migrate an invalid v2 snapshot", async () => {
  const projectRoot = process.cwd();
  const { migrateSalesWeeklySourceCache } = await importFresh(projectRoot, "src/services/salesWeeklySourceCache.js");
  const expectedScope = JSON.parse(salesWeeklySourceCacheKey());

  assert.equal(migrateSalesWeeklySourceCache({
    cacheScope: { ...expectedScope, version: "sales-weekly-source-v2" },
    recent30OrderProfitRecords: [],
    raw: { recent30: { startDate: "2026-06-23", endDate: "2026-07-23", recordCount: 0 } },
  }, expectedScope), null);
});

test("sales weekly dashboard cache contract rejects legacy rows without 30-day refund values", async () => {
  const projectRoot = process.cwd();
  const { validateSalesWeeklyDashboardCache } = await importFresh(projectRoot, "src/services/dashboardService.js");

  assert.deepEqual(validateSalesWeeklyDashboardCache({
    detailRows: [{ msku: "MSKU-1", refundRate: 4 }, { msku: "MSKU-2", refundRate30d: null }],
  }), {
    ok: false,
    reasons: ["1 detail rows are missing refundRate30d"],
  });
  assert.deepEqual(validateSalesWeeklyDashboardCache({ detailRows: [{ refundRate30d: null, fbaAvailableDays: null }] }), {
    ok: true,
    reasons: [],
  });
});

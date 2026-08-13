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

test("sales weekly source cache reuses the same base data across different listing owners", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    const cacheKey = salesWeeklySourceCacheKey();
    const source = {
      cacheScope: {
        version: "sales-weekly-source-v3",
        startDate: "2026-07-01",
        endDate: "2026-07-23",
        currencyCode: "ORIGINAL",
        sids: [],
      },
      sellers: [
        { sid: 1, name: "探嘉澳洲", country: "AU" },
        { sid: 2, name: "坦蛋伯澳洲", country: "AU" },
      ],
      sellerProfitRecords: [],
      orderProfitRecords: [
        {
          sid: 1,
          country: "AU",
          countryCode: "AU",
          storeName: "探嘉澳洲",
          msku: "MSKU-1",
          totalSalesAmount: 100,
          totalSalesQuantity: 2,
          grossProfit: 10,
          totalAdsCost: 5,
          totalAdsSales: 20,
          totalSalesRefunds: 2,
        },
        {
          sid: 2,
          country: "AU",
          countryCode: "AU",
          storeName: "坦蛋伯澳洲",
          msku: "MSKU-2",
          totalSalesAmount: 200,
          totalSalesQuantity: 4,
          grossProfit: 20,
          totalAdsCost: 10,
          totalAdsSales: 40,
          totalSalesRefunds: 4,
        },
      ],
      recent30OrderProfitRecords: [
        {
          sid: 1,
          country: "AU",
          countryCode: "AU",
          storeName: "探嘉澳洲",
          msku: "MSKU-1",
          totalSalesAmount: 400,
          totalSalesRefunds: 12,
        },
        {
          sid: 2,
          country: "AU",
          countryCode: "AU",
          storeName: "坦蛋伯澳洲",
          msku: "MSKU-2",
          totalSalesAmount: 500,
          totalSalesRefunds: 25,
        },
      ],
      dailyProfitRecords: [],
      inventoryRecords: [],
      listingOwnerRows: [
        { sid: 1, country: "AU", countryCode: "AU", msku: "MSKU-1", listingOwner: "林芃" },
        { sid: 2, country: "AU", countryCode: "AU", msku: "MSKU-2", listingOwner: "熊丹轩" },
      ],
      budgetTargets: { rows: [], totals: {} },
      range: { startDate: "2026-07-01", endDate: "2026-07-23" },
      currencyCode: "ORIGINAL",
      raw: {
        recent30: {
          startDate: "2026-06-24",
          endDate: "2026-07-23",
          cacheState: "hit",
          cacheUpdatedAt: "2026-07-23 10:00:00",
          recordCount: 2,
        },
      },
      updatedAt: "2026-07-23 10:00:00",
    };

    await cacheStore.saveSalesWeeklySourceCache(cacheKey, source);
    const { getSalesWeeklyDashboard } = await importFresh(projectRoot, "src/services/dashboardService.js");

    const linPeng = await getSalesWeeklyDashboard({
      startDate: "2026-07-01",
      endDate: "2026-07-23",
      currencyCode: "ORIGINAL",
      listingOwner: "林芃",
    });
    const shadowedLinPeng = await getSalesWeeklyDashboard({
      startDate: "2026-07-01",
      endDate: "2026-07-23",
      currencyCode: "ORIGINAL",
      listingOwner: "林芃",
    }, {
      salesFactsShadow: {
        enabled: true,
        readNewFacts: async () => { throw new Error("shadow facts unavailable"); },
        logger: { info() {}, error() {} },
      },
    });
    const xiong = await getSalesWeeklyDashboard({
      startDate: "2026-07-01",
      endDate: "2026-07-23",
      currencyCode: "ORIGINAL",
      listingOwner: "熊丹轩",
    });

    const salesLinPeng = linPeng.summary.find((item) => item[0] === "销售额")?.[1];
    const salesXiong = xiong.summary.find((item) => item[0] === "销售额")?.[1];

    assert.equal(linPeng.cacheHit, true);
    assert.equal(xiong.cacheHit, true);
    assert.equal(salesLinPeng, "100");
    assert.equal(salesXiong, "200");
    assert.equal(linPeng.detailRows[0].refundRate30d, 3);
    assert.deepEqual(shadowedLinPeng, linPeng);
    assert.equal(xiong.detailRows[0].refundRate30d, 5);
    assert.deepEqual(linPeng.meta.recent30, {
      startDate: "2026-06-24",
      endDate: "2026-07-23",
      cacheState: "hit",
      cacheUpdatedAt: "2026-07-23 10:00:00",
      recordCount: 2,
    });
    assert.match(linPeng.meta.syncStatus, /1\s*条/);
    assert.match(xiong.meta.syncStatus, /1\s*条/);
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

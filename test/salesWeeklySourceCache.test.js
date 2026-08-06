import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

function salesWeeklySourceCacheKey() {
  return JSON.stringify({
    version: "sales-weekly-source-v1",
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
        version: "sales-weekly-source-v1",
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
      dailyProfitRecords: [],
      inventoryRecords: [],
      listingOwnerRows: [
        { sid: 1, country: "AU", countryCode: "AU", msku: "MSKU-1", listingOwner: "林芃" },
        { sid: 2, country: "AU", countryCode: "AU", msku: "MSKU-2", listingOwner: "熊丹轩" },
      ],
      budgetTargets: { rows: [], totals: {} },
      range: { startDate: "2026-07-01", endDate: "2026-07-23" },
      currencyCode: "ORIGINAL",
      raw: {},
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
    assert.match(linPeng.meta.syncStatus, /1\s*条/);
    assert.match(xiong.meta.syncStatus, /1\s*条/);
  });
});

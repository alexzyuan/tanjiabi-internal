import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function importFresh(projectRoot, relativePath) {
  const url = pathToFileURL(path.join(projectRoot, relativePath));
  url.searchParams.set("testRun", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function orderProfitCacheKey({ startDate, endDate, sids, currencyCode = "ORIGINAL" }) {
  return JSON.stringify({
    source: "basicOpen/finance/mreport/OrderProfit",
    startDate,
    endDate,
    currencyCode,
    sids: sids.map(Number).filter(Boolean).sort((a, b) => a - b),
  });
}

test("LingxingAdapter fails fast instead of serving stale order profit cache", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lingxing-order-profit-"));
  try {
    process.chdir(tempRoot);
    const { saveOrderProfitCache } = await importFresh(projectRoot, "src/utils/cacheStore.js");
    const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
    const cacheKey = orderProfitCacheKey({
      startDate: "2026-07-01",
      endDate: "2026-07-14",
      sids: [8708],
    });
    await saveOrderProfitCache(cacheKey, {
      orderProfitRecords: [{ sid: 8708, msku: "JM-DGC-BLUE", totalSalesAmount: 999 }],
    });

    const cacheDir = path.join(tempRoot, "data-cache", "order-profit");
    const [cacheFileName] = await readdir(cacheDir);
    const cacheFile = path.join(cacheDir, cacheFileName);
    const cached = JSON.parse(await readFile(cacheFile, "utf8"));
    cached.updatedAtMs = Date.now() - 60 * 60 * 1000;
    await writeFile(cacheFile, JSON.stringify(cached, null, 2), "utf8");

    const adapter = new LingxingAdapter({
      baseUrl: "https://openapi.test/",
      appKey: "1234567890abcdef",
      appSecret: "secret",
    });
    adapter.fetchSellers = async () => ({
      data: [{ sid: 8708, name: "JOI MEW-US", country: "美国", status: 1 }],
    });
    adapter.fetchMskuOrderProfit = async () => {
      throw new Error("OrderProfit unavailable");
    };
    adapter.fetchAllFbaInventoryDetails = async () => [];

    await assert.rejects(
      adapter.fetchSalesWeeklyData({
        startDate: "2026-07-01",
        endDate: "2026-07-14",
        sids: [8708],
        currencyCode: "ORIGINAL",
      }),
      /OrderProfit unavailable/,
    );
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

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

test("LingxingAdapter defaults sales weekly order profit currency to CNY", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lingxing-order-profit-cny-"));
  try {
    process.chdir(tempRoot);
    const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
    const adapter = new LingxingAdapter({
      baseUrl: "https://openapi.test/",
      appKey: "1234567890abcdef",
      appSecret: "secret",
    });
    let orderProfitRequest = null;
    adapter.fetchSellers = async () => ({
      data: [{ sid: 8708, name: "JOI MEW-US", country: "美国", status: 1 }],
    });
    adapter.fetchMskuOrderProfit = async (request) => {
      orderProfitRequest = request;
      return { data: { records: [] } };
    };
    adapter.fetchAllFbaInventoryDetails = async () => [];

    const data = await adapter.fetchSalesWeeklyData({
      startDate: "2026-07-01",
      endDate: "2026-07-14",
      sids: [8708],
    });

    assert.equal(orderProfitRequest.currencyCode, "CNY");
    assert.equal(data.currencyCode, "CNY");
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("shared order profit cache returns a normalized hit without calling Lingxing", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lingxing-order-profit-shared-hit-"));
  try {
    process.chdir(tempRoot);
    const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
    const adapter = new LingxingAdapter({ baseUrl: "https://openapi.test/", appKey: "1234567890abcdef", appSecret: "secret" });
    let calls = 0;
    adapter.fetchMskuOrderProfit = async () => {
      calls += 1;
      return { data: { records: [{ sid: 8708, amount: 12, net_amount: 10 }] } };
    };
    const first = await adapter.fetchMskuOrderProfitCached({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      sids: [8708],
      currencyCode: "CNY",
      sellerList: [{ sid: 8708, name: "JOI MEW-US", country: "美国" }],
      reportDate: "2026-08-31",
    });
    const second = await adapter.fetchMskuOrderProfitCached({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      sids: [8708],
      currencyCode: "CNY",
      sellerList: [{ sid: 8708, name: "JOI MEW-US", country: "美国" }],
      reportDate: "2026-08-31",
    });
    assert.equal(calls, 1);
    assert.equal(first.cacheState, "miss");
    assert.equal(second.cacheState, "hit");
    assert.equal(second.records[0].storeName, "JOI MEW-US");
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("shared order profit cache deduplicates concurrent misses", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lingxing-order-profit-shared-inflight-"));
  try {
    process.chdir(tempRoot);
    const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
    const adapter = new LingxingAdapter({ baseUrl: "https://openapi.test/", appKey: "1234567890abcdef", appSecret: "secret" });
    let calls = 0;
    adapter.fetchMskuOrderProfit = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { data: { records: [{ sid: 8708, amount: 12 }] } };
    };
    const request = {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      sids: [8708],
      currencyCode: "CNY",
      sellerList: [{ sid: 8708, name: "JOI MEW-US", country: "美国" }],
      reportDate: "2026-09-30",
    };
    const results = await Promise.all([
      adapter.fetchMskuOrderProfitCached(request),
      adapter.fetchMskuOrderProfitCached(request),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(results.map((result) => result.cacheState).sort(), ["inflight", "miss"]);
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

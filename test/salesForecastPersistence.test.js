import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function importSalesForecastService(projectRoot) {
  const serviceUrl = pathToFileURL(path.join(projectRoot, "src/services/salesForecastService.js"));
  serviceUrl.searchParams.set("testRun", `${Date.now()}-${Math.random()}`);
  return import(serviceUrl.href);
}

test("sales forecast dashboard fails fast instead of serving stale cache when refresh fails", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-cache-"));
  const previousEnv = {
    DATA_PROVIDER: process.env.DATA_PROVIDER,
    LINGXING_APP_KEY: process.env.LINGXING_APP_KEY,
    LINGXING_APP_SECRET: process.env.LINGXING_APP_SECRET,
    LINGXING_ACCESS_TOKEN: process.env.LINGXING_ACCESS_TOKEN,
    LINGXING_REFRESH_TOKEN: process.env.LINGXING_REFRESH_TOKEN,
  };
  try {
    process.env.DATA_PROVIDER = "lingxing";
    delete process.env.LINGXING_APP_KEY;
    delete process.env.LINGXING_APP_SECRET;
    delete process.env.LINGXING_ACCESS_TOKEN;
    delete process.env.LINGXING_REFRESH_TOKEN;
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-dashboard-cache.json"), JSON.stringify({
      version: "sales-forecast-v2-strict-sid-fba",
      cachedAt: Date.now() - 13 * 60 * 60 * 1000,
      updatedAt: "2026/7/14 09:00:00",
      endpoint: "/erp/sc/routing/restocking/analysis/getSummaryList",
      adviceCount: 1,
      sellerCount: 1,
      rows: [{ sid: 8708, country: "美国", storeName: "xiamentanjia-US", msku: "JM-DGC-BLUE" }],
    }), "utf8");

    const { getSalesForecastDashboard } = await importSalesForecastService(projectRoot);

    await assert.rejects(
      getSalesForecastDashboard(),
      /销售预估刷新失败，未使用过期缓存/,
    );
  } finally {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sales forecast manual daily store fails fast on corrupted JSON", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-store-"));
  try {
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-manual-daily.json"), "{broken", "utf8");

    const { getSalesForecastManualDaily } = await importSalesForecastService(projectRoot);

    await assert.rejects(
      getSalesForecastManualDaily(),
      /JSON parse failed|Unexpected token/,
    );
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sales forecast available-days index recalculates exact seller and MSKU rows from manual daily sales", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-available-days-"));
  try {
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-dashboard-cache.json"), JSON.stringify({
      version: "sales-forecast-v2-strict-sid-fba",
      cachedAt: Date.now(),
      updatedAt: "2026/8/11 10:00:00",
      rows: [
        { sid: 101, msku: "MSKU-SHARED", fbaAvailable: 20, fbaAvailableDays: 999 },
        { sid: 102, msku: "msku-shared", fbaAvailable: 30, fbaAvailableDays: 999 },
        { sid: 103, msku: "OVER-HORIZON", fbaAvailable: 1000, fbaAvailableDays: 999 },
      ],
    }), "utf8");
    await writeFile(path.join("data-cache", "sales-forecast-manual-daily.json"), JSON.stringify({
      updatedAt: "2026/8/11 10:05:00",
      rows: {
        "101%7CMSKU-SHARED": [0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10],
        "103%7COVER-HORIZON": [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      },
    }), "utf8");

    const { getSalesForecastAvailableDaysBySellerMsku } = await importSalesForecastService(projectRoot);
    const result = await getSalesForecastAvailableDaysBySellerMsku({ now: new Date("2026-08-11T12:00:00") });

    assert.equal(result.map.get("101|msku-shared"), 2);
    assert.equal(result.map.has("102|msku-shared"), false);
    assert.equal(result.map.get("103|over-horizon"), 999);
    assert.equal(result.map.size, 2);
    assert.equal(result.cacheHit, true);
    assert.equal(result.updatedAt, "2026/8/11 10:00:00");
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sales forecast available-days index reports an empty cache without inventing a zero", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-available-days-empty-"));
  try {
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });

    const { getSalesForecastAvailableDaysBySellerMsku } = await importSalesForecastService(projectRoot);
    const result = await getSalesForecastAvailableDaysBySellerMsku();

    assert.equal(result.map.size, 0);
    assert.equal(result.cacheHit, false);
    assert.match(result.status, /暂无可售天数数据/);
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sales forecast available-days index surfaces corrupted cache reads", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-available-days-corrupt-"));
  try {
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-dashboard-cache.json"), "{broken", "utf8");

    const { getSalesForecastAvailableDaysBySellerMsku } = await importSalesForecastService(projectRoot);
    await assert.rejects(getSalesForecastAvailableDaysBySellerMsku(), /JSON parse failed|Unexpected token/);
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

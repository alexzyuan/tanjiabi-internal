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

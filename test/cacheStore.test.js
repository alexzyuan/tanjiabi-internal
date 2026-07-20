import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function withCacheStore(fn) {
  const originalCacheDir = process.env.TANJIA_BI_CACHE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-cache-store-"));
  const cacheDir = path.join(dir, "data-cache");
  const restoreCacheDir = () => {
    if (originalCacheDir === undefined) {
      delete process.env.TANJIA_BI_CACHE_DIR;
    } else {
      process.env.TANJIA_BI_CACHE_DIR = originalCacheDir;
    }
  };
  try {
    process.env.TANJIA_BI_CACHE_DIR = cacheDir;
    const module = await import(`../src/utils/cacheStore.js?case=${Date.now()}-${Math.random()}`);
    restoreCacheDir();
    await fn(module, cacheDir);
  } finally {
    restoreCacheDir();
    await rm(dir, { recursive: true, force: true });
  }
}

test("cacheStore reads missing files through explicit fallbacks", async () => {
  await withCacheStore(async (cacheStore) => {
    assert.equal(await cacheStore.readSalesDashboardCache(), null);
    assert.deepEqual(await cacheStore.readLingxingSellersCache(), { updatedAt: null, sellers: [] });
    assert.equal(await cacheStore.readMskuDetailCache("missing"), null);
  });
});

test("cacheStore surfaces corrupted JSON instead of silently falling back", async () => {
  await withCacheStore(async (cacheStore, cacheDir) => {
    await mkdir(path.join(cacheDir, "msku-detail"), { recursive: true });
    await writeFile(path.join(cacheDir, "sales-weekly-dashboard.json"), "{broken", "utf8");
    await writeFile(path.join(cacheDir, "lingxing-sellers.json"), "{broken", "utf8");

    await cacheStore.saveMskuDetailCache("bad-json", { rows: [1] });
    const mskuFiles = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(cacheDir, "msku-detail")));
    await writeFile(path.join(cacheDir, "msku-detail", mskuFiles[0]), "{broken", "utf8");

    await assert.rejects(() => cacheStore.readSalesDashboardCache(), { code: "JSON_PARSE_FAILED" });
    await assert.rejects(() => cacheStore.readLingxingSellersCache(), { code: "JSON_PARSE_FAILED" });
    await assert.rejects(() => cacheStore.readMskuDetailCache("bad-json"), { code: "JSON_PARSE_FAILED" });
  });
});

test("cacheStore writes valid newline-terminated JSON through cache helpers", async () => {
  await withCacheStore(async (cacheStore, cacheDir) => {
    await cacheStore.saveSalesDashboardCache({ rows: [{ sku: "A" }] });
    await cacheStore.saveLingxingSellersCache([{ sid: "100", name: "US" }]);

    const dashboardRaw = await readFile(path.join(cacheDir, "sales-weekly-dashboard.json"), "utf8");
    const sellersRaw = await readFile(path.join(cacheDir, "lingxing-sellers.json"), "utf8");

    assert.equal(dashboardRaw.endsWith("\n"), true);
    assert.equal(sellersRaw.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(dashboardRaw), { rows: [{ sku: "A" }] });
    assert.deepEqual((await cacheStore.readLingxingSellersCache()).sellers, [{ sid: "100", name: "US" }]);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

function supplierBoardCacheKey() {
  return JSON.stringify({
    scope: "supplier-board-v6-ordinary-purchase-cost",
    dimension: "month",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    storeName: "",
    country: "",
  });
}

async function writeExpiredSupplierBoardCache(cacheStore) {
  await cacheStore.saveSupplierBoardCache(supplierBoardCacheKey(), {
    meta: { syncStatus: "old supplier cache" },
    rows: [{ supplier: "STALE", msku: "JM-DGC-BLUE", quantity: 99 }],
    summary: { quantity: 99 },
    suppliers: [],
  });
  const cacheDir = path.join(process.cwd(), "data-cache", "supplier-board");
  const [cacheFileName] = await readdir(cacheDir);
  const cacheFile = path.join(cacheDir, cacheFileName);
  const cached = JSON.parse(await readFile(cacheFile, "utf8"));
  cached.updatedAtMs = Date.now() - 7 * 60 * 60 * 1000;
  await writeFile(cacheFile, JSON.stringify(cached, null, 2), "utf8");
}

async function writeFreshSupplierBoardCache(cacheStore) {
  await cacheStore.saveSupplierBoardCache(supplierBoardCacheKey(), {
    meta: { syncStatus: "fresh supplier cache" },
    rows: [{ supplier: "FRESH", msku: "JM-DGC-BLUE", quantity: 99 }],
    summary: { quantity: 99 },
    suppliers: [],
  });
}

async function withTempLingxingProvider(run) {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "supplier-board-cache-"));
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

test("supplier board fails fast instead of quickly serving expired cache", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await writeExpiredSupplierBoardCache(cacheStore);
    const { getSupplierBoardDashboard } = await importFresh(projectRoot, "src/services/supplierBoardService.js");

    await assert.rejects(
      getSupplierBoardDashboard({
        dimension: "month",
        startDate: "2026-07",
        endDate: "2026-07",
      }),
      /Lingxing adapter is missing/,
    );
  });
});

test("supplier board force refresh fails fast instead of serving expired cache after errors", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await writeExpiredSupplierBoardCache(cacheStore);
    const { getSupplierBoardDashboard } = await importFresh(projectRoot, "src/services/supplierBoardService.js");

    await assert.rejects(
      getSupplierBoardDashboard({
        dimension: "month",
        startDate: "2026-07",
        endDate: "2026-07",
        forceRefresh: true,
      }),
      /Lingxing adapter is missing/,
    );
  });
});

test("supplier board force refresh bypasses fresh cache", async () => {
  await withTempLingxingProvider(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await writeFreshSupplierBoardCache(cacheStore);
    const { getSupplierBoardDashboard } = await importFresh(projectRoot, "src/services/supplierBoardService.js");

    await assert.rejects(
      getSupplierBoardDashboard({
        dimension: "month",
        startDate: "2026-07",
        endDate: "2026-07",
        forceRefresh: true,
      }),
      /Lingxing adapter is missing/,
    );
  });
});

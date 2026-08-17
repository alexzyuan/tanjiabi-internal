import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

async function withTempProject(run) {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cache-store-"));
  try {
    process.chdir(tempRoot);
    await run(projectRoot, tempRoot);
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("cache store preserves missing-file fallbacks", async () => {
  await withTempProject(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");

    assert.equal(await cacheStore.readLegacySalesWeeklyForReconciliation(), null);
    assert.equal(await cacheStore.readLegacySalesWeeklyForReconciliation(JSON.stringify({ version: "sales-weekly-source-v1", startDate: "2026-07-01", endDate: "2026-07-23", currencyCode: "ORIGINAL", sids: [] })), null);
    assert.equal(await cacheStore.readLegacyOrderProfitForReconciliation("missing-order-profit"), null);
    assert.deepEqual(await cacheStore.readLingxingSellersCache(), { updatedAt: null, sellers: [] });
  });
});

test("cache store fails fast on corrupted JSON instead of hiding it as a cache miss", async () => {
  await withTempProject(async (projectRoot, tempRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await mkdir(path.join(tempRoot, "data-cache"), { recursive: true });
    await writeFile(path.join(tempRoot, "data-cache", "sales-weekly-dashboard.json"), "{bad json", "utf8");

    await assert.rejects(
      cacheStore.readLegacySalesWeeklyForReconciliation(),
      (error) => error?.code === "JSON_PARSE_FAILED" && /sales-weekly-dashboard\.json/.test(error.filePath),
    );
  });
});

test("cache store writes and reads keyed sales weekly source cache", async () => {
  await withTempProject(async (projectRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    const cacheKey = JSON.stringify({
      version: "sales-weekly-source-v1",
      startDate: "2026-07-01",
      endDate: "2026-07-23",
      currencyCode: "ORIGINAL",
      sids: [],
    });

    const cacheDir = path.join("data-cache", "sales-weekly-source");
    await mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${crypto.createHash("sha1").update(cacheKey).digest("hex")}.json`);
    await writeFile(cacheFile, JSON.stringify({
      updatedAt: "2026-08-13 10:00:00",
      updatedAtMs: Date.now(),
      data: { rows: [{ id: 1 }] },
    }), "utf8");
    const cached = await cacheStore.readLegacySalesWeeklyForReconciliation(cacheKey);

    assert.deepEqual(cached?.data, { rows: [{ id: 1 }] });
  });
});

test("inventory provision history backup preserves current monthly cache", async () => {
  await withTempProject(async (projectRoot) => {
    const store = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await store.saveInventoryProvisionHistoryCache("2026-07", { rows: [{ msku: "JM-9006Truck", quantity: 27 }] });

    const backup = await store.backupInventoryProvisionHistoryCache("2026-07", { operationId: "refresh-1" });

    assert.equal(backup.created, true);
    assert.equal(backup.month, "2026-07");
    assert.equal(backup.operationId, "refresh-1");
    assert.deepEqual(backup.cached.data.rows, [{ msku: "JM-9006Truck", quantity: 27 }]);
    assert.deepEqual((await store.readInventoryProvisionHistoryCache("2026-07")).data.rows, [{ msku: "JM-9006Truck", quantity: 27 }]);
  });
});

test("cache store writes through the shared json store boundary", async () => {
  const source = await readFile(new URL("../src/utils/cacheStore.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\breadFile\(/);
  assert.doesNotMatch(source, /\bwriteFile\(/);
  assert.match(source, /writeJsonAtomic/);
  assert.match(source, /readJsonWithRecovery/);
});

test("cache store only treats missing snapshot directories as empty", async () => {
  await withTempProject(async (projectRoot, tempRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");

    assert.deepEqual(await cacheStore.listInventoryProvisionSnapshots(), []);

    await mkdir(path.join(tempRoot, "data-cache"), { recursive: true });
    await writeFile(path.join(tempRoot, "data-cache", "inventory-provision"), "not a directory", "utf8");

    await assert.rejects(
      cacheStore.listInventoryProvisionSnapshots(),
      (error) => error?.code === "ENOTDIR",
    );
  });
});

test("cache cleanup does not hide filesystem errors after atomic writes", async () => {
  await withTempProject(async (projectRoot, tempRoot) => {
    const cacheStore = await importFresh(projectRoot, "src/utils/cacheStore.js");
    const cacheDir = path.join(tempRoot, "data-cache", "supplier-board");
    await mkdir(cacheDir, { recursive: true });
    await symlink(path.join(tempRoot, "missing-cache-file.json"), path.join(cacheDir, "broken.json"));

    await assert.rejects(
      cacheStore.saveSupplierBoardCache("new-cache-key", { rows: [] }),
      (error) => error?.code === "ENOENT" && /broken\.json/.test(error.path),
    );
  });
});

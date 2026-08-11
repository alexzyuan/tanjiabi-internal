import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const packageDeployPath = new URL("../scripts/package-deploy.js", import.meta.url);
const deployPath = new URL("../deploy.sh", import.meta.url);

test("SQLite smoke opens, writes, reads, rolls back, and removes a temporary database", async () => {
  const { runProductCatalogSqliteSmoke } = await import("../scripts/product-catalog-sqlite-smoke.js");
  const directory = await mkdtemp(path.join(tmpdir(), "product-catalog-deploy-test-"));
  try {
    const result = await runProductCatalogSqliteSmoke({ directory });
    assert.deepEqual(result, { ok: true, journalMode: "wal", transactionRollbackVerified: true });
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deploy package explicitly contains both catalog scripts", async () => {
  const source = await readFile(packageDeployPath, "utf8");
  assert.match(source, /scripts\/product-catalog-sqlite-smoke\.js/);
  assert.match(source, /scripts\/migrate-product-catalog\.js/);
});

test("deploy runs npm ci, SQLite smoke, migration, then PM2 restart in order", async () => {
  const source = await readFile(deployPath, "utf8");
  const installIndex = source.indexOf("npm ci");
  const smokeIndex = source.indexOf("node scripts/product-catalog-sqlite-smoke.js");
  const migrateIndex = source.indexOf("node scripts/migrate-product-catalog.js");
  const restartIndex = source.indexOf("pm2 start");
  assert.ok(installIndex >= 0 && installIndex < smokeIndex);
  assert.ok(smokeIndex < migrateIndex);
  assert.ok(migrateIndex < restartIndex);
});

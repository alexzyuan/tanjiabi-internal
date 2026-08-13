import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const packageDeployPath = new URL("../scripts/package-deploy.js", import.meta.url);
const deployPath = new URL("../deploy.sh", import.meta.url);

function fakeSmokeDatabase() {
  return {
    open: true,
    pragma(name) {
      if (name === "journal_mode") return "wal";
      return undefined;
    },
    exec() {},
    prepare(sql) {
      return {
        run() {},
        get() {
          return sql.includes("SELECT value") ? { value: "committed" } : { count: 0 };
        },
      };
    },
    transaction(callback) {
      return () => callback();
    },
    close() {
      this.open = false;
    },
  };
}

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

test("SQLite smoke preserves operation failure and attempts every artifact plus owned-directory cleanup", async () => {
  const calls = [];
  const fsOps = {
    mkdtemp: async () => "/tmp/product-catalog-operation-failure",
    mkdir: async () => {},
    rm: async (target, options) => { calls.push({ target, options }); },
  };
  const { runProductCatalogSqliteSmoke } = await import("../scripts/product-catalog-sqlite-smoke.js");

  await assert.rejects(
    runProductCatalogSqliteSmoke({
      fsOps,
      databaseFactory: () => { throw new Error("operation failed"); },
    }),
    (error) => error.message === "operation failed",
  );

  assert.deepEqual(calls.map(({ target }) => target), [
    "/tmp/product-catalog-operation-failure/smoke.sqlite",
    "/tmp/product-catalog-operation-failure/smoke.sqlite-wal",
    "/tmp/product-catalog-operation-failure/smoke.sqlite-shm",
    "/tmp/product-catalog-operation-failure",
  ]);
  assert.equal(calls.at(-1)?.options?.recursive, true);
});

test("SQLite smoke attempts all cleanup artifacts and exposes partial cleanup failure", async () => {
  const calls = [];
  const fsOps = {
    mkdtemp: async () => "/tmp/product-catalog-cleanup-failure",
    mkdir: async () => {},
    rm: (target, options) => {
      calls.push({ target, options });
      if (target.endsWith("smoke.sqlite-wal")) throw new Error("wal cleanup failed");
    },
  };
  const { runProductCatalogSqliteSmoke } = await import("../scripts/product-catalog-sqlite-smoke.js");

  await assert.rejects(
    runProductCatalogSqliteSmoke({ fsOps, databaseFactory: () => fakeSmokeDatabase() }),
    (error) => {
      assert.match(error.message, /cleanup/i);
      assert.ok(error.errors?.some((cause) => cause?.message === "wal cleanup failed"));
      return true;
    },
  );

  assert.deepEqual(calls.map(({ target }) => target), [
    "/tmp/product-catalog-cleanup-failure/smoke.sqlite",
    "/tmp/product-catalog-cleanup-failure/smoke.sqlite-wal",
    "/tmp/product-catalog-cleanup-failure/smoke.sqlite-shm",
    "/tmp/product-catalog-cleanup-failure",
  ]);
});

test("SQLite smoke keeps operation details when cleanup also fails", async () => {
  const fsOps = {
    mkdtemp: async () => "/tmp/product-catalog-combined-failure",
    mkdir: async () => {},
    rm: async (target) => {
      if (target.endsWith("smoke.sqlite-wal")) throw new Error("wal cleanup failed");
    },
  };
  const { runProductCatalogSqliteSmoke } = await import("../scripts/product-catalog-sqlite-smoke.js");

  await assert.rejects(
    runProductCatalogSqliteSmoke({
      fsOps,
      databaseFactory: () => { throw new Error("operation failed"); },
    }),
    (error) => {
      assert.match(error.message, /operation failed/);
      assert.equal(error.cause?.message, "operation failed");
      assert.ok(error.cleanupError instanceof AggregateError);
      assert.ok(error.cleanupError.errors.some((cause) => cause?.message === "wal cleanup failed"));
      return true;
    },
  );
});

test("SQLite smoke cleans an owned directory when setup fails after creation", async () => {
  const calls = [];
  const fsOps = {
    mkdtemp: async () => "/tmp/product-catalog-setup-failure",
    mkdir: async () => { throw new Error("setup failed"); },
    rm: async (target, options) => { calls.push({ target, options }); },
  };
  const { runProductCatalogSqliteSmoke } = await import("../scripts/product-catalog-sqlite-smoke.js");

  await assert.rejects(
    runProductCatalogSqliteSmoke({ fsOps, databaseFactory: () => fakeSmokeDatabase() }),
    (error) => error.message === "setup failed",
  );
  assert.deepEqual(calls, [
    { target: "/tmp/product-catalog-setup-failure/smoke.sqlite", options: { force: true } },
    { target: "/tmp/product-catalog-setup-failure/smoke.sqlite-wal", options: { force: true } },
    { target: "/tmp/product-catalog-setup-failure/smoke.sqlite-shm", options: { force: true } },
    { target: "/tmp/product-catalog-setup-failure", options: { recursive: true, force: true } },
  ]);
});

test("deploy package explicitly contains both catalog scripts", async () => {
  const source = await readFile(packageDeployPath, "utf8");
  assert.match(source, /scripts\/product-catalog-sqlite-smoke\.js/);
  assert.match(source, /scripts\/migrate-product-catalog\.js/);
  assert.match(source, /scripts\/retire-product-catalog-legacy-cache\.js/);
});

test("deploy manifests advertise the SQLite product catalog capability", async () => {
  const source = await readFile(packageDeployPath, "utf8");
  assert.match(source, /capabilities:\s*\[[\s\S]*["']product-catalog-sqlite-v1["'][\s\S]*["']sales-facts-sqlite-v1["']/);
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

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";

async function createRepositoryFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const repository = createProductCatalogRepository({ databasePath, ...options });
  const inspector = new Database(databasePath, { readonly: true });
  const tableNames = inspector.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map(({ name }) => name);
  inspector.close();
  t.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { repository, tableNames };
}

async function createCorruptedRepositoryDatabase(t, mutate) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-corrupt-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const repository = createProductCatalogRepository({ databasePath, now: () => 1720000000000 });
  repository.close();
  const database = new Database(databasePath);
  mutate(database);
  database.close();
  t.after(() => rm(directory, { recursive: true, force: true }));
  return databasePath;
}

test("creates the v1 schema with required pragmas and tables", async (t) => {
  const fixture = await createRepositoryFixture(t);
  assert.deepEqual(fixture.repository.getSchemaInfo(), {
    version: 1,
    journalMode: "wal",
    foreignKeys: 1,
    busyTimeout: 5000,
    synchronous: 2,
  });
  assert.deepEqual(fixture.tableNames, [
    "catalog_metadata", "listing_identity", "product_alias", "product_master", "schema_migrations",
  ]);
});

test("initializes catalog_revision metadata to zero", async (t) => {
  const fixture = await createRepositoryFixture(t, { now: () => 1720000000000 });
  const inspector = new Database(fixture.repository.databasePath, { readonly: true });
  assert.deepEqual(inspector.prepare(
    "SELECT key, value, updated_at_ms FROM catalog_metadata WHERE key = 'catalog_revision'",
  ).get(), {
    key: "catalog_revision",
    value: "0",
    updated_at_ms: 1720000000000,
  });
  inspector.close();
});

test("logs a redacted bootstrap failure and rethrows checksum mismatches", async (t) => {
  const databasePath = await createCorruptedRepositoryDatabase(t, (database) => {
    database.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
  });
  const calls = [];
  const logger = { error: (...args) => calls.push(args) };

  assert.throws(() => createProductCatalogRepository({ databasePath, logger }), /checksum/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[product-catalog-repository]");
  assert.deepEqual(calls[0][1], {
    operation: "bootstrap",
    errorName: "Error",
    errorMessage: "商品目录数据库 schema checksum 与当前实现不一致。",
  });
  const reopened = new Database(databasePath);
  reopened.close();
});

test("logs a redacted bootstrap failure and rethrows unknown higher schema versions", async (t) => {
  const databasePath = await createCorruptedRepositoryDatabase(t, (database) => {
    database.prepare(
      "INSERT INTO schema_migrations (version, name, checksum, applied_at_ms) VALUES (2, 'future', 'future', 1720000000000)",
    ).run();
  });
  const calls = [];
  const logger = { error: (...args) => calls.push(args) };

  assert.throws(() => createProductCatalogRepository({ databasePath, logger }), /更高 schema 版本 2/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[product-catalog-repository]");
  assert.deepEqual(calls[0][1], {
    operation: "bootstrap",
    errorName: "Error",
    errorMessage: "商品目录数据库包含未知的更高 schema 版本 2。",
  });
  const reopened = new Database(databasePath);
  reopened.close();
});

test("rejects a bootstrap when SQLite cannot enable the required WAL pragma", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-pragma-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const seed = createProductCatalogRepository({ databasePath });
  seed.close();
  await chmod(databasePath, 0o444);
  const calls = [];
  t.after(async () => {
    await chmod(databasePath, 0o644);
    await rm(directory, { recursive: true, force: true });
  });

  assert.throws(
    () => createProductCatalogRepository({ databasePath, logger: { error: (...args) => calls.push(args) } }),
    /readonly|wal/i,
  );
  assert.equal(calls.length, 1);
  const reopened = new Database(databasePath, { readonly: true });
  reopened.close();
});

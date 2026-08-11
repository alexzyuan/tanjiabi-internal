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

function seedProduct(repository, internalSku, productId) {
  const internalSkuKey = internalSku.trim().toLowerCase();
  repository.upsertCatalog({
    operation: "test-seed",
    requestId: "test-seed",
    products: [{
      internalSkuKey,
      internalSku,
      productName: "测试商品",
      source: "test",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [{
      aliasType: "product_id",
      aliasKey: String(productId).trim().toLowerCase(),
      aliasValue: String(productId),
      internalSkuKey,
      source: "test",
      updatedAtMs: 1720000000000,
    }],
    listings: [],
  });
}

function conflictingBatch(internalSku, productId) {
  const internalSkuKey = internalSku.trim().toLowerCase();
  return {
    operation: "test-conflict",
    requestId: "test-conflict",
    products: [{
      internalSkuKey,
      internalSku,
      productName: "冲突商品",
      source: "test",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [{
      aliasType: "product_id",
      aliasKey: String(productId).trim().toLowerCase(),
      aliasValue: String(productId),
      internalSkuKey,
      source: "test",
      updatedAtMs: 1720000000000,
    }],
    listings: [],
  };
}

function batchWithNullableNumbers() {
  return {
    operation: "test-nullability",
    requestId: "test-nullability",
    products: [{
      internalSkuKey: "tj001",
      internalSku: "TJ001",
      productName: "数值边界",
      purchasePrice: 0,
      declaredValue: null,
      packQuantity: 0,
      boxSpec: null,
      raw: { token: "must-not-persist" },
      source: "test",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [],
    listings: [],
  };
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

test("atomically upserts product, aliases, listing and increments revision", async (t) => {
  const { repository } = await createRepositoryFixture(t, { now: () => 1720000000000 });
  const result = repository.upsertCatalog({
    operation: "manual-refresh", requestId: "req-1",
    products: [{ internalSkuKey: "tj001", internalSku: "TJ001", productName: "灯光船", purchasePrice: 38, source: "lingxing-product", sourceUpdatedAtMs: 1720000000000, refreshedAtMs: 1720000000000 }],
    aliases: [{ aliasType: "product_id", aliasKey: "101", aliasValue: "101", internalSkuKey: "tj001", source: "lingxing-product", updatedAtMs: 1720000000000 }],
    listings: [{ sid: 8708, mskuKey: "jm-dgc-blue", msku: "JM-DGC-BLUE", internalSkuKey: "tj001", internalSku: "TJ001", storeName: "xiamentanjia-US", country: "美国", source: "lingxing-listing", sourceUpdatedAtMs: 1720000000000, refreshedAtMs: 1720000000000 }],
  });
  assert.equal(result.revision, 1);
  const rows = repository.readScope([{ sid: 8708, mskuKey: "jm-dgc-blue" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product.purchasePrice, 38);
  assert.equal(rows[0].listing.storeName, "xiamentanjia-US");
  assert.equal(repository.getRevision(), 1);
});

test("alias conflict rolls back every row and leaves revision unchanged", async (t) => {
  const { repository } = await createRepositoryFixture(t);
  seedProduct(repository, "TJ001", "101");
  assert.throws(() => repository.upsertCatalog(conflictingBatch("TJ002", "101")), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.name, "ProductCatalogConflictError");
    assert.equal(typeof error.details, "object");
    assert.doesNotMatch(JSON.stringify(error.details), /TJ001|TJ002|101/);
    return true;
  });
  assert.equal(repository.readProductsByInternalSkuKeys(["tj002"]).length, 0);
  assert.equal(repository.getRevision(), 1);
});

test("keeps NULL distinct from a real numeric zero and stores no raw payload", async (t) => {
  const { repository } = await createRepositoryFixture(t);
  repository.upsertCatalog(batchWithNullableNumbers());
  const [row] = repository.readProductsByInternalSkuKeys(["tj001"]);
  assert.equal(row.purchasePrice, 0);
  assert.equal(row.declaredValue, null);
  assert.equal(row.packQuantity, 0);
  assert.equal(Object.hasOwn(row, "raw"), false);
});

test("metadata-only writes preserve revision while each catalog batch increments once", async (t) => {
  const { repository } = await createRepositoryFixture(t, { now: () => 1720000000000 });
  assert.equal(repository.upsertCatalog({
    operation: "legacy-manifest",
    requestId: "legacy-1",
    metadata: { legacy_manifest_hash: "abc", legacy_migrated_at_ms: 1720000000000 },
  }).revision, 0);
  assert.equal(repository.getRevision(), 0);
  assert.equal(repository.getMetadata("legacy_manifest_hash"), "abc");

  const batch = {
    operation: "manual-refresh",
    requestId: "req-2",
    products: [{ internalSkuKey: "tj001", internalSku: "TJ001", source: "test", sourceUpdatedAtMs: 1720000000000, refreshedAtMs: 1720000000000 }],
    aliases: [],
    listings: [],
  };
  assert.equal(repository.upsertCatalog(batch).revision, 1);
  assert.equal(repository.upsertCatalog(batch).revision, 2);
  assert.equal(repository.getRevision(), 2);
});

test("reports health diagnostics without exposing row payloads", async (t) => {
  const { repository } = await createRepositoryFixture(t);
  repository.upsertCatalog({
    operation: "health-seed",
    requestId: "health-seed",
    products: [{ internalSkuKey: "tj001", internalSku: "TJ001", source: "test", sourceUpdatedAtMs: 1720000000000, refreshedAtMs: 1720000000000 }],
    aliases: [],
    listings: [{ sid: 8708, mskuKey: "A", msku: "A", source: "test", sourceUpdatedAtMs: 1720000000000, refreshedAtMs: 1720000000000 }],
  });
  const health = repository.getHealth();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.quickCheck, "ok");
  assert.equal(health.revision, 1);
  assert.equal(health.listingCount, 1);
  assert.equal(health.productCount, 1);
  assert.equal(typeof health.databaseBytes, "number");
  assert.equal(typeof health.walBytes, "number");
  assert.equal(health.legacyMigratedAt, null);
  assert.equal(Object.hasOwn(health, "raw"), false);
});

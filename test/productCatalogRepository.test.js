import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

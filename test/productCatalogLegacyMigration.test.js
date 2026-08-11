import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import {
  buildLegacyProductCatalogManifest,
  migrateLegacyProductCatalog,
} from "../src/services/productCatalogLegacyMigrationService.js";

function legacyRecord(overrides = {}) {
  const record = {
    sid: 8708,
    msku: "MSKU-A",
    local_sku: "TJ001",
    sku: "TJ001",
    productName: "测试商品",
    purchasePrice: 35,
    supplier: "旧工厂",
    ...overrides,
  };
  if (Object.hasOwn(overrides, "msku") && !Object.hasOwn(overrides, "local_sku")) {
    record.local_sku = String(overrides.msku);
    record.sku = record.local_sku;
  }
  return record;
}

async function createLegacyMigrationFixture(t, { sellerSids = [8708], mutateManifestOnEveryRead = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-legacy-migration-"));
  const sharedDir = path.join(directory, "shared-product-catalog");
  const supplierDir = path.join(directory, "supplier-board-product-map");
  await mkdir(sharedDir, { recursive: true });
  await mkdir(supplierDir, { recursive: true });
  const repository = createProductCatalogRepository({
    databasePath: path.join(directory, "product-catalog-v1.sqlite"),
    now: () => 1720000000000,
  });
  const sellers = sellerSids.map((sid) => ({ sid, name: "xiamentanjia-US", country: "美国" }));
  let manifestReads = 0;

  async function writeLegacy(directoryPath, name, updatedAtMs, records) {
    const list = Array.isArray(records) ? records : [records];
    const payload = {
      updatedAtMs,
      data: { records: list.map((record) => ({ product: record })) },
    };
    const filePath = path.join(directoryPath, name);
    await writeFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    await utimes(filePath, updatedAtMs / 1000, updatedAtMs / 1000);
    return filePath;
  }

  const options = {
    repository,
    sellers,
    sharedDir,
    supplierDir,
    now: () => 1720000001000,
    logger: { info() {}, warn() {}, error() {} },
  };
  if (mutateManifestOnEveryRead) {
    options.buildManifest = async (manifestOptions) => {
      if (manifestReads > 0) {
        const filePath = path.join(sharedDir, "unstable.json");
        await appendFile(filePath, " ", "utf8");
      }
      manifestReads += 1;
      return buildLegacyProductCatalogManifest(manifestOptions);
    };
    await writeLegacy(sharedDir, "unstable.json", 1000, legacyRecord());
  }

  const fixture = {
    directory,
    sharedDir,
    supplierDir,
    repository,
    sellers,
    scope: [{ sid: 8708, msku: "MSKU-A" }],
    options,
    legacyRecord,
    writeShared: (name, updatedAtMs, records) => writeLegacy(sharedDir, name, updatedAtMs, records),
    writeSupplier: (name, updatedAtMs, records) => writeLegacy(supplierDir, name, updatedAtMs, records),
    writeRawShared: async (name, content) => writeFile(path.join(sharedDir, name), content, "utf8"),
    readListing: (msku) => repository.readScope([{ sid: 8708, msku }])[0]?.listing || null,
    readProduct: (msku) => repository.readScope([{ sid: 8708, msku }])[0]?.product || null,
  };
  t.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  return fixture;
}

test("folds row-set JSON by SID+MSKU/internal SKU and chooses newest non-empty fields", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("older.json", 1000, legacyRecord({ storeName: "探嘉美国", purchasePrice: 35, supplier: "旧工厂" }));
  await fixture.writeShared("newer.json", 2000, legacyRecord({ storeName: "xiamentanjia-US", purchasePrice: 38, supplier: "新工厂" }));
  const result = await migrateLegacyProductCatalog(fixture.options);
  assert.equal(result.listingCount, 1);
  assert.equal(result.productCount, 1);
  assert.equal(result.conflictCount, 2);
  const [row] = fixture.repository.readScope(fixture.scope);
  assert.equal(row.listing.storeName, "xiamentanjia-US");
  assert.equal(row.product.purchasePrice, 38);
  assert.equal(row.listing.sourceUpdatedAtMs, 2000);
  assert.equal(row.product.refreshedAtMs, 1720000001000);
});

test("uses supplier-board legacy files only to fill identities absent from shared catalog", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("shared.json", 1000, legacyRecord({ msku: "A", purchasePrice: 35 }));
  await fixture.writeSupplier("supplier.json", 2000, [
    legacyRecord({ msku: "A", purchasePrice: 99 }),
    legacyRecord({ msku: "B", purchasePrice: 40 }),
  ]);
  await migrateLegacyProductCatalog(fixture.options);
  assert.equal(fixture.readProduct("A").purchasePrice, 35);
  assert.equal(fixture.readProduct("B").purchasePrice, 40);
});

test("unchanged manifest skips import while a new rollback-era JSON changes the hash", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("one.json", 1000, legacyRecord({ msku: "A" }));
  const first = await migrateLegacyProductCatalog(fixture.options);
  const unchanged = await migrateLegacyProductCatalog(fixture.options);
  await fixture.writeShared("rollback-era.json", 2000, legacyRecord({ msku: "B" }));
  const changed = await migrateLegacyProductCatalog(fixture.options);
  assert.equal(first.skipped, false);
  assert.equal(unchanged.skipped, true);
  assert.notEqual(changed.manifestHash, first.manifestHash);
  assert.equal(fixture.readListing("B").msku, "B");
});

test("corrupt JSON fails without updating migration metadata", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeRawShared("broken.json", "{not-json");
  await assert.rejects(migrateLegacyProductCatalog(fixture.options), /broken\.json/);
  assert.equal(fixture.repository.getMetadata("legacy_manifest_hash"), null);
});

test("unknown seller SID fails without updating migration metadata", async (t) => {
  const fixture = await createLegacyMigrationFixture(t, { sellerSids: [8708] });
  await fixture.writeShared("unknown-sid.json", 1000, legacyRecord({ sid: 9999, msku: "A" }));
  await assert.rejects(migrateLegacyProductCatalog(fixture.options), /9999/);
  assert.equal(fixture.repository.getMetadata("legacy_manifest_hash"), null);
});

test("an unstable manifest fails after three scans without writing rows or metadata", async (t) => {
  const fixture = await createLegacyMigrationFixture(t, { mutateManifestOnEveryRead: true });
  await assert.rejects(migrateLegacyProductCatalog(fixture.options), /连续 3 次扫描均发生变化/);
  assert.equal(fixture.repository.getRevision(), 0);
  assert.equal(fixture.repository.getMetadata("legacy_manifest_hash"), null);
});

import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

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

function runCli(cwd, scriptPath, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
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
  assert.equal(row.listing.source, "legacy-json");
  assert.equal(row.product.source, "legacy-json");
  const database = new Database(fixture.repository.databasePath, { readonly: true });
  assert.deepEqual(database.prepare("SELECT DISTINCT source FROM product_alias").all(), [{ source: "legacy-json" }]);
  database.close();
  assert.equal(result.conflictSamples.length, 2);
  for (const sample of result.conflictSamples) {
    assert.deepEqual(Object.keys(sample).sort(), [
      "candidateCount",
      "field",
      "identity",
      "selectedSourceUpdatedAtMs",
    ]);
    assert.equal(sample.candidateCount, 2);
    assert.equal(sample.selectedSourceUpdatedAtMs, 2000);
    assert.equal(Object.hasOwn(sample, "fileName"), false);
    assert.equal(Object.hasOwn(sample, "value"), false);
    assert.doesNotMatch(JSON.stringify(sample), /raw|token/i);
  }
});

test("migrates legacy shared map product-only records without inventing a Listing", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeRawShared("product-only.json", JSON.stringify({
    updatedAtMs: 1000,
    data: {
      records: [{
        key: "TJ-PRODUCT-ONLY",
        product: {
          sku: "TJ-PRODUCT-ONLY",
          productName: "历史产品",
          purchasePrice: 12,
          raw: { token: "must-not-persist" },
        },
      }],
    },
  }));

  const result = await migrateLegacyProductCatalog(fixture.options);

  assert.equal(result.productCount, 1);
  assert.equal(result.listingCount, 0);
  const [product] = fixture.repository.readProductsByInternalSkuKeys(["TJ-PRODUCT-ONLY"]);
  assert.equal(product.internalSku, "TJ-PRODUCT-ONLY");
  assert.equal(product.productName, "历史产品");
  assert.equal(Object.hasOwn(product, "raw"), false);
});

test("same-timestamp rows choose the same canonical value regardless of array order", async (t) => {
  async function snapshot(records) {
    const fixture = await createLegacyMigrationFixture(t);
    await fixture.writeShared("tie.json", 1000, records);
    const result = await migrateLegacyProductCatalog(fixture.options);
    const database = new Database(fixture.repository.databasePath, { readonly: true });
    const product = database.prepare("SELECT supplier, data_hash FROM product_master").get();
    database.close();
    return {
      supplier: product.supplier,
      dataHash: product.data_hash,
      conflictSamples: result.conflictSamples,
    };
  }
  const leftToRight = await snapshot([
    legacyRecord({ supplier: "AAAA" }),
    legacyRecord({ supplier: "ZZZZ" }),
  ]);
  const rightToLeft = await snapshot([
    legacyRecord({ supplier: "ZZZZ" }),
    legacyRecord({ supplier: "AAAA" }),
  ]);
  assert.deepEqual(rightToLeft, leftToRight);
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
  assert.equal(unchanged.fileCount, 1);
  assert.notEqual(changed.manifestHash, first.manifestHash);
  assert.equal(fixture.readListing("B").msku, "B");
});

test("manifest changes never overwrite live-owned rows while importing a new legacy identity", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("catalog.json", 1000, legacyRecord({
    msku: "A",
    local_sku: "TJ001",
    supplier: "旧工厂",
    purchasePrice: 35,
  }));
  await migrateLegacyProductCatalog(fixture.options);

  fixture.repository.upsertCatalog({
    operation: "manual-refresh",
    requestId: "live-refresh-1",
    products: [{
      internalSkuKey: "tj001",
      internalSku: "TJ001",
      productName: "实时商品",
      supplier: "实时工厂",
      purchasePrice: 88,
      productId: "live-product-id",
      source: "lingxing-product",
      sourceUpdatedAtMs: 3000,
      refreshedAtMs: 3000,
    }],
    aliases: [{
      aliasType: "product_id",
      aliasKey: "live-product-id",
      aliasValue: "live-product-id",
      internalSkuKey: "tj001",
      source: "lingxing-product",
      updatedAtMs: 3000,
    }],
    listings: [{
      sid: 8708,
      msku: "A",
      mskuKey: "a",
      internalSkuKey: "tj001",
      internalSku: "TJ001",
      listingSku: "TJ001",
      asin: "LIVE-ASIN",
      storeName: "runtime-live-store",
      country: "美国",
      source: "lingxing-listing",
      sourceUpdatedAtMs: 3000,
      refreshedAtMs: 3000,
    }],
  });

  await fixture.writeShared("catalog.json", 4000, legacyRecord({
    msku: "A",
    local_sku: "TJ001",
    supplier: "旧工厂再次变更",
    purchasePrice: 1,
  }));
  await fixture.writeShared("new-identity.json", 4000, legacyRecord({
    msku: "B",
    local_sku: "TJ002",
    supplier: "新旧工厂",
    purchasePrice: 42,
  }));

  const result = await migrateLegacyProductCatalog(fixture.options);
  assert.equal(result.skipped, false);
  assert.equal(result.liveOwnedSkipCount, 3);
  assert.equal(fixture.readProduct("A").supplier, "实时工厂");
  assert.equal(fixture.readProduct("A").purchasePrice, 88);
  assert.equal(fixture.readProduct("A").source, "lingxing-product");
  assert.equal(fixture.readProduct("A").sourceUpdatedAtMs, 3000);
  assert.equal(fixture.readListing("A").storeName, "runtime-live-store");
  assert.equal(fixture.readListing("A").source, "lingxing-listing");
  const inspector = new Database(fixture.repository.databasePath, { readonly: true });
  assert.equal(inspector.prepare(
    "SELECT source FROM product_alias WHERE alias_type = 'product_id' AND alias_key = 'live-product-id'",
  ).get()?.source, "lingxing-product");
  inspector.close();
  assert.equal(fixture.readProduct("B").supplier, "新旧工厂");
  assert.equal(fixture.readProduct("B").source, "legacy-json");
});

test("migration success logs the normalized request ID", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("request-id.json", 1000, legacyRecord({ msku: "REQUEST-ID" }));
  const entries = [];
  await migrateLegacyProductCatalog({
    ...fixture.options,
    requestId: "migration-request-1",
    logger: { info: (...args) => entries.push(args) },
  });
  assert.equal(entries[0]?.[1]?.requestId, "migration-request-1");
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

test("rejects unknown envelopes and non-empty records without a recognized identity", async (t) => {
  const cases = [
    { name: "null.json", payload: null },
    { name: "unknown-object.json", payload: { token: "fixture-token" } },
    { name: "unknown-records-envelope.json", payload: { records: [] } },
    { name: "null-data.json", payload: { data: null } },
    { name: "invalid-record.json", payload: { data: { records: [{ raw: "fixture-token" }] } } },
  ];
  for (const item of cases) {
    const fixture = await createLegacyMigrationFixture(t);
    await fixture.writeRawShared(item.name, JSON.stringify(item.payload));
    await assert.rejects(migrateLegacyProductCatalog(fixture.options), /schema|envelope|record|identity/i);
    assert.equal(fixture.repository.getRevision(), 0);
    assert.equal(fixture.repository.getMetadata("legacy_manifest_hash"), null);
  }
});

test("rejects maxScanAttempts outside the inclusive 1..3 contract before scanning", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("one.json", 1000, legacyRecord());
  let manifestCalls = 0;
  fixture.options.buildManifest = async (options) => {
    manifestCalls += 1;
    return buildLegacyProductCatalogManifest(options);
  };
  await assert.rejects(
    migrateLegacyProductCatalog({ ...fixture.options, maxScanAttempts: 4 }),
    /maxScanAttempts|扫描次数|1.*3/,
  );
  assert.equal(manifestCalls, 0);
  assert.equal(fixture.repository.getRevision(), 0);
  assert.equal(fixture.repository.getMetadata("legacy_manifest_hash"), null);
});

test("CLI fails on corrupt legacy JSON without echoing payload contents", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-cli-"));
  const sharedDir = path.join(directory, "data-cache", "shared-product-catalog");
  const supplierDir = path.join(directory, "data-cache", "supplier-board-product-map");
  await mkdir(sharedDir, { recursive: true });
  await mkdir(supplierDir, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sellersFile = path.join(directory, "data-cache", "lingxing-sellers.json");
  await mkdir(path.dirname(sellersFile), { recursive: true });
  await writeFile(sellersFile, JSON.stringify({ sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }] }), "utf8");
  const broken = "{not-json, fixture-token, raw}";
  await writeFile(path.join(sharedDir, "broken.json"), broken, "utf8");
  const before = await readFile(path.join(sharedDir, "broken.json"), "utf8");
  const scriptPath = path.resolve("scripts/migrate-product-catalog.js");
  const result = await runCli(directory, scriptPath, {
    ...process.env,
    PRODUCT_CATALOG_DATABASE_PATH: path.join(directory, "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /broken\.json/);
  assert.match(result.stderr, /product-catalog-migration|failed/i);
  assert.doesNotMatch(result.stderr, /fixture-token|raw/i);
  assert.equal(await readFile(path.join(sharedDir, "broken.json"), "utf8"), before);
});

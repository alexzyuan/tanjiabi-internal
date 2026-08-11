# Product Catalog SQLite Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-stage `product-catalog-v1.sqlite` cache so all product-catalog consumers share canonical `SID + MSKU` and internal-SKU records, legacy JSON migrates deterministically, and a user can atomically refresh only the current page scope.

**Architecture:** Add a small identity module, SQLite schema/repository, legacy migration service, and product-catalog orchestration service. Keep `getSharedProductCatalogMap()` as a compatibility facade that constructs request-local alias maps from normalized database rows; converge supplier/FBA consumers behind it, expose one authenticated refresh route, and use a monotonic catalog revision to rehydrate supplier-board product fields without refetching salesStat.

**Tech Stack:** Node.js `>=22.19.0 <25`, ES modules, `better-sqlite3@13.0.3`, SQLite WAL, native HTML/CSS/JavaScript, Node test runner.

## Global Constraints

- Execute from an isolated worktree created with `superpowers:using-git-worktrees`, based on branch `codex/product-catalog-sqlite-cache`; do not implement on `main` or the old seller-identity branch.
- The only database implemented by this plan is `data-cache/product-catalog/product-catalog-v1.sqlite`; `sales-facts.sqlite` and `inventory-snapshots.sqlite` require later approved specs.
- Canonical Listing identity is `(sid, trim(msku).toLowerCase())`; a bare MSKU, store name, country, request date range, or filter scope is never a persistent identity.
- Canonical product identity is `trim(internalSku).toLowerCase()`; `sku_identifier`, `product_id`, and ERP Listing `local_sku` are aliases. Amazon `seller_sku`/MSKU is never a global alias.
- Existing records never auto-refresh by age. Only identities missing from both SQLite and the migrated legacy catalog may be fetched on a normal lookup.
- Manual refresh accepts 1–500 unique `SID + MSKU` identities, validates every SID against the runtime seller directory, fetches the complete scope before opening a write transaction, and commits all or nothing.
- Runtime seller name and country always come from `getSellerDirectory`; legacy display aliases cannot create or rename a runtime store.
- Do not persist full Lingxing `raw` records, credentials, tokens, signatures, or unbounded upstream responses. Logs use request IDs and redacted identity/count/error metadata only.
- SQLite pragmas are fixed: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL`; never wait for network I/O inside a transaction.
- `server.js` remains composition only; external calls remain in adapters/catalog lookup services; no feature state machine moves into `app.js`.
- Reuse existing Spectrum semantic button classes. Do not edit generated `styles.css`; no new CSS is expected for the supplier-board product refresh button.
- Keep legacy product JSON read-only during the observation period. This plan must not delete production cache files.
- Every implementation task follows RED → GREEN → REFACTOR, runs its targeted tests, and ends in a focused commit.

## File and Interface Map

### New backend files

- `src/services/productCatalogIdentity.js`: canonical key/scope normalization and typed HTTP errors.
- `src/services/productCatalogSchema.js`: schema version/checksum and SQLite DDL application.
- `src/services/productCatalogRepository.js`: prepared statements, reads, atomic upserts, metadata revision, health, and close.
- `src/services/productCatalogNormalization.js`: Listing/product field normalization shared by the compatibility facade, migration, and FBA.
- `src/services/listingSharedCatalogService.js`: read/match the existing Listing shared XLSX backup without depending on `sharedDataService.js`.
- `src/services/productCatalogLegacyMigrationService.js`: stable legacy manifest scan, deterministic merge, and idempotent import.
- `src/services/productCatalogService.js`: seller validation, DB lookup, initial missing fill, manual refresh, single-flight, and metrics.
- `routes/product-catalog.js`: `POST /api/product-catalog/refresh`.
- `scripts/product-catalog-sqlite-smoke.js`: Linux/native-module and SQLite transaction smoke.
- `scripts/migrate-product-catalog.js`: deployment migration entry point.

### New tests

- `test/productCatalogIdentity.test.js`
- `test/productCatalogRepository.test.js`
- `test/productCatalogNormalization.test.js`
- `test/productCatalogLegacyMigration.test.js`
- `test/productCatalogService.test.js`
- `test/productCatalogRoutes.test.js`
- `test/productCatalogDeploy.test.js`

### Existing files modified

- `package.json`, `package-lock.json`: pin `better-sqlite3@13.0.3` and add the migration script.
- `src/services/sharedDataService.js`: compatibility facade; no new row-set JSON writes.
- `src/services/supplierBoardService.js`: remove duplicate product-map cache/API fallback and rehydrate product fields by catalog revision.
- `src/services/fbaCatalogService.js`: keep Listing discovery cache only; use the shared catalog for product/box fields.
- `src/services/fbaShipmentCandidateService.js`, `src/services/fbaFreightSheetService.js`, `src/services/factoryInventoryService.js`: verify and expose shared catalog metadata without new product sources.
- `src/utils/cacheStore.js`: expose legacy product-cache directories/read-only helpers; stop new supplier/shared product-map writes after cutover.
- `routes/index.js`, `routes/core.js`, `server.js`: route/health dependency wiring only.
- `assets/js/features/supplier-board.js`, `index.html`: independent current-filter product refresh.
- `scripts/package-deploy.js`, `scripts/deploy-integrity.js`, `deploy.sh`: package, migrate, smoke, and post-restart health guard.
- `AGENTS.md`, `README.md`, `SERVER_DEPLOYMENT.md`: living architecture and operations documentation.

### Stable interfaces produced by the plan

```js
normalizeProductCatalogScope(items, { maxItems = 500 })
// => [{ sid, msku, mskuKey, key: `${sid}:${mskuKey}` }]

createProductCatalogRepository({ databasePath, logger, now })
// => {
//   getSchemaInfo(),
//   readScope(scope), readProductsByInternalSkuKeys(keys),
//   upsertCatalog({ listings, products, aliases, operation, requestId, metadata }),
//   getRevision(), getMetadata(key), getHealth(), close()
// }

getProductCatalogForRows(rows, options)
// => { records, meta: { revision, dbHitCount, legacyMigratedCount,
//      listingFetchedCount, productFetchedCount, missingCount, conflictCount, elapsedMs } }

refreshProductCatalogScope({ feature, items }, options)
// => { ok: true, records, meta: { requestId, revision,
//      refreshRequestedCount, refreshCommittedCount, joinedInFlight,
//      transactionDurationMs, elapsedMs } }

getProductCatalogRevision(options)
// => integer

getProductCatalogHealth(options)
// => { ok, schemaVersion, quickCheck, revision, listingCount,
//      productCount, databaseBytes, walBytes, legacyMigratedAt }
```

---

### Task 1: Pin SQLite and establish canonical identity/schema bootstrap

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/services/productCatalogIdentity.js`
- Create: `src/services/productCatalogSchema.js`
- Create: `src/services/productCatalogRepository.js`
- Create: `test/productCatalogIdentity.test.js`
- Create: `test/productCatalogRepository.test.js`

**Interfaces:**
- Produces: `normalizeCatalogKey`, `normalizeProductCatalogScope`, `ProductCatalogInputError`, `ProductCatalogConflictError`, `PRODUCT_CATALOG_SCHEMA_VERSION`, `applyProductCatalogSchema`, `createProductCatalogRepository`.
- Consumes: Node filesystem/path APIs and `better-sqlite3@13.0.3`; no Lingxing or seller-directory dependency.

- [ ] **Step 1: Write failing identity and schema tests**

```js
// test/productCatalogIdentity.test.js
test("normalizes and deduplicates SID + MSKU without using store aliases", () => {
  assert.deepEqual(normalizeProductCatalogScope([
    { sid: 8708, msku: " JM-DGC-BLUE ", storeName: "探嘉美国" },
    { sid: 8708, msku: "jm-dgc-blue", storeName: "xiamentanjia-US" },
  ]), [{ sid: 8708, msku: "JM-DGC-BLUE", mskuKey: "jm-dgc-blue", key: "8708:jm-dgc-blue" }]);
});

test("rejects empty, invalid, and over-500 refresh scopes with status 400", () => {
  assert.throws(() => normalizeProductCatalogScope([]), (error) => error.statusCode === 400);
  assert.throws(() => normalizeProductCatalogScope([{ sid: 0, msku: "A" }]), /SID/);
  assert.throws(() => normalizeProductCatalogScope(
    Array.from({ length: 501 }, (_, index) => ({ sid: 8708, msku: `M-${index}` })),
  ), /500/);
});
```

```js
// test/productCatalogRepository.test.js
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
```

- [ ] **Step 2: Run the tests to confirm RED**

Run: `node --test test/productCatalogIdentity.test.js test/productCatalogRepository.test.js`

Expected: FAIL because the identity/schema/repository modules and `better-sqlite3` dependency do not exist.

- [ ] **Step 3: Install the exact dependency and implement identity normalization**

Run: `npm install --save-exact better-sqlite3@13.0.3`

```js
// src/services/productCatalogIdentity.js
export class ProductCatalogInputError extends Error {
  constructor(message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "ProductCatalogInputError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ProductCatalogConflictError extends ProductCatalogInputError {
  constructor(message, details = null) {
    super(message, { statusCode: 409, details });
    this.name = "ProductCatalogConflictError";
  }
}

export function normalizeCatalogKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeProductCatalogScope(items, { maxItems = 500 } = {}) {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sid = Number(item?.sid || 0);
    const msku = String(item?.msku || "").trim();
    const mskuKey = normalizeCatalogKey(msku);
    if (!Number.isInteger(sid) || sid <= 0) throw new ProductCatalogInputError("商品目录范围包含无效 SID。");
    if (!mskuKey) throw new ProductCatalogInputError(`SID ${sid} 缺少有效 MSKU。`);
    const key = `${sid}:${mskuKey}`;
    if (!byKey.has(key)) byKey.set(key, { sid, msku, mskuKey, key });
  }
  const scope = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
  if (!scope.length) throw new ProductCatalogInputError("请选择至少一个商品后再刷新商品资料。");
  if (scope.length > maxItems) throw new ProductCatalogInputError(`单次最多刷新 ${maxItems} 个商品。`);
  return scope;
}
```

- [ ] **Step 4: Implement schema v1 and repository bootstrap**

```js
// src/services/productCatalogSchema.js
export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;
export const PRODUCT_CATALOG_SCHEMA_NAME = "product-catalog-v1";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL, applied_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_metadata (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS product_master (
  internal_sku_key TEXT PRIMARY KEY, internal_sku TEXT NOT NULL,
  product_name TEXT, image_url TEXT, supplier TEXT, purchase_price REAL,
  model TEXT, brand TEXT, material TEXT, purpose TEXT, customs_code TEXT,
  is_battery TEXT, unit TEXT, declared_value REAL, pack_quantity REAL,
  box_length REAL, box_width REAL, box_height REAL, box_dimension_unit TEXT,
  box_weight REAL, box_weight_unit TEXT, product_id TEXT, sku_identifier TEXT,
  source TEXT NOT NULL, source_updated_at_ms INTEGER NOT NULL,
  refreshed_at_ms INTEGER NOT NULL, data_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_identity (
  sid INTEGER NOT NULL CHECK (sid > 0), msku_key TEXT NOT NULL, msku TEXT NOT NULL,
  internal_sku_key TEXT, internal_sku TEXT, listing_sku TEXT, asin TEXT,
  store_name TEXT, country TEXT, source TEXT NOT NULL,
  source_updated_at_ms INTEGER NOT NULL, refreshed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (sid, msku_key)
);
CREATE INDEX IF NOT EXISTS listing_identity_internal_sku_idx
  ON listing_identity (internal_sku_key);
CREATE TABLE IF NOT EXISTS product_alias (
  alias_type TEXT NOT NULL CHECK (alias_type IN ('sku_identifier','product_id','listing_sku')),
  alias_key TEXT NOT NULL, alias_value TEXT NOT NULL,
  internal_sku_key TEXT NOT NULL REFERENCES product_master(internal_sku_key) ON DELETE CASCADE,
  source TEXT NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (alias_type, alias_key)
);`;
```

Implement `applyProductCatalogSchema(db, { now })` to hash `SCHEMA_SQL`, reject a changed checksum or unknown higher version, insert migration version 1, and initialize `catalog_revision=0`.

```js
// src/services/productCatalogRepository.js
export function createProductCatalogRepository({
  databasePath = path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
  logger = console,
  now = Date.now,
} = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  applyProductCatalogSchema(db, { now });
  return { databasePath, getSchemaInfo, close: () => db.close() };
}
```

- [ ] **Step 5: Run targeted tests and syntax checks**

Run: `node --test test/productCatalogIdentity.test.js test/productCatalogRepository.test.js`

Expected: PASS.

Run: `npm run check:js`

Expected: PASS.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add package.json package-lock.json src/services/productCatalogIdentity.js src/services/productCatalogSchema.js src/services/productCatalogRepository.js test/productCatalogIdentity.test.js test/productCatalogRepository.test.js
git commit -m "feat: add product catalog SQLite schema"
```

### Task 2: Implement repository reads, atomic upserts, aliases, metadata, and health

**Files:**
- Modify: `src/services/productCatalogRepository.js`
- Modify: `test/productCatalogRepository.test.js`

**Interfaces:**
- Consumes: schema and canonical keys from Task 1.
- Produces: repository methods `readScope`, `readProductsByInternalSkuKeys`, `upsertCatalog`, `getRevision`, `getMetadata`, `getHealth`, `close`.

- [ ] **Step 1: Add failing repository behavior tests**

```js
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
  assert.equal(rows[0].product.purchasePrice, 38);
  assert.equal(repository.getRevision(), 1);
});

test("alias conflict rolls back every row and leaves revision unchanged", async (t) => {
  const { repository } = await createRepositoryFixture(t);
  seedProduct(repository, "TJ001", "101");
  assert.throws(() => repository.upsertCatalog(conflictingBatch("TJ002", "101")), (error) => error.statusCode === 409);
  assert.equal(repository.readProductsByInternalSkuKeys(["tj002"]).length, 0);
  assert.equal(repository.getRevision(), 1);
});

test("keeps NULL distinct from a real numeric zero and stores no raw payload", async (t) => {
  const { repository } = await createRepositoryFixture(t);
  repository.upsertCatalog(batchWithNullableNumbers());
  const [row] = repository.readProductsByInternalSkuKeys(["tj001"]);
  assert.equal(row.purchasePrice, 0);
  assert.equal(row.declaredValue, null);
  assert.equal(Object.hasOwn(row, "raw"), false);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogRepository.test.js`

Expected: FAIL because the repository exposes only bootstrap methods.

- [ ] **Step 3: Add prepared statements and camelCase row mapping**

Implement one prepared Listing lookup reused up to 500 times, one product lookup reused for unique internal SKU keys, and explicit database-to-domain mapping:

```js
function mapProductRow(row) {
  if (!row) return null;
  return {
    internalSkuKey: row.internal_sku_key,
    internalSku: row.internal_sku,
    productName: row.product_name || "",
    purchasePrice: row.purchase_price,
    declaredValue: row.declared_value,
    packQuantity: row.pack_quantity,
    boxSpec: row.box_length === null ? null : {
      dimensions: { length: row.box_length, width: row.box_width, height: row.box_height, unitOfMeasurement: row.box_dimension_unit },
      weight: { value: row.box_weight, unit: row.box_weight_unit },
    },
    source: row.source,
    sourceUpdatedAtMs: row.source_updated_at_ms,
    refreshedAtMs: row.refreshed_at_ms,
  };
}
```

- [ ] **Step 4: Implement one transaction for validation, upserts, metadata, and revision**

Before any mutation, query each alias key; if an existing row points to another internal SKU, throw `ProductCatalogConflictError` with `statusCode=409` and redacted details. Compute `data_hash` from the normalized whitelisted product fields.

```js
const writeCatalog = db.transaction(({ products, aliases, listings, metadata = {} }) => {
  assertAliasesDoNotConflict(aliases);
  products.forEach((product) => upsertProduct.run(toProductParams(product)));
  aliases.forEach((alias) => upsertAlias.run(toAliasParams(alias)));
  listings.forEach((listing) => upsertListing.run(toListingParams(listing)));
  const hasCatalogRows = products.length > 0 || aliases.length > 0 || listings.length > 0;
  const currentRevision = Number(readMetadataValue("catalog_revision") || 0);
  const revision = hasCatalogRows ? currentRevision + 1 : currentRevision;
  if (hasCatalogRows) writeMetadata.run("catalog_revision", String(revision), now());
  Object.entries(metadata).forEach(([key, value]) => writeMetadata.run(key, String(value), now()));
  return revision;
});
```

Add a test proving a metadata-only legacy manifest update leaves `catalog_revision` unchanged; a successful batch with any Listing/product/alias rows increments it exactly once, even when values are identical to the previous write.

Implement `getHealth()` with `PRAGMA quick_check`, schema version, revision, table counts, main/WAL file sizes, and legacy migration time. Catch errors only to log operation/code/message, then rethrow.

- [ ] **Step 5: Run repository tests**

Run: `node --test test/productCatalogRepository.test.js`

Expected: PASS, including rollback and revision assertions.

- [ ] **Step 6: Commit repository behavior**

```bash
git add src/services/productCatalogRepository.js test/productCatalogRepository.test.js
git commit -m "feat: persist canonical product catalog records"
```

### Task 3: Extract shared normalization and Listing XLSX backup ownership

**Files:**
- Create: `src/services/productCatalogNormalization.js`
- Create: `src/services/listingSharedCatalogService.js`
- Modify: `src/services/sharedDataService.js`
- Create: `test/productCatalogNormalization.test.js`
- Modify: `test/sharedDataService.test.js`

**Interfaces:**
- Consumes: existing field alias arrays and battery/box normalization behavior from `sharedDataService.js` and `fbaCatalogService.js`.
- Produces: `normalizeCatalogListing`, `normalizeCatalogProduct`, `mergeCatalogProduct`, `catalogProductToRepositoryRows`, `readListingSharedCatalogRecords`, `findListingSharedCatalogMatches`.

- [ ] **Step 1: Write failing normalization compatibility tests**

```js
test("normalizes declaration and FBA packaging fields into the canonical product", () => {
  const product = normalizeCatalogProduct({
    sku: "TJ033", product_name: "双支蜘蛛船", supplier_name: "汕头工厂",
    purchase_price: "38", special_attr: ["1"], bg_export_hs_code: "9503008390",
    cg_box_pcs: "6", cg_box_length: "40", cg_box_width: "30", cg_box_height: "20",
    cg_box_weight: "8", cg_box_length_unit: "CM", cg_box_weight_unit: "KG",
  });
  assert.equal(product.internalSku, "TJ033");
  assert.equal(product.isBattery, "是");
  assert.equal(product.packQuantity, 6);
  assert.deepEqual(product.boxSpec.dimensions, { length: 40, width: 30, height: 20, unitOfMeasurement: "CM" });
});

test("does not expose raw upstream records", () => {
  assert.equal(Object.hasOwn(normalizeCatalogProduct({ sku: "TJ001", token: "secret" }), "raw"), false);
});
```

Add a shared-data compatibility assertion that all existing `buildSharedProductCatalogMap` field tests still pass after extraction.

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js`

Expected: FAIL because the focused normalization and XLSX modules do not exist.

- [ ] **Step 3: Move field translation into the focused normalization module**

Move the existing supplier, price, model, brand, material, purpose, customs, battery, unit, declared-value, image, and nested-record readers out of `sharedDataService.js`. Add FBA packaging aliases currently owned by `fbaCatalogService.js`.

```js
export function normalizeCatalogListing(record = {}, { fallbackSid = 0 } = {}) {
  const msku = readArrayText(readFirst(record, LISTING_MSKU_KEYS)).trim();
  if (!msku) return null;
  const internalSku = readArrayText(readFirst(record, LISTING_INTERNAL_SKU_KEYS)).trim();
  return { sid: toNumber(readFirst(record, SID_KEYS)) || Number(fallbackSid), msku, internalSku, listingSku: internalSku, asin: readFirst(record, ["asin", "ASIN"]), productName: readArrayText(readFirst(record, PRODUCT_NAME_KEYS)) };
}

export function normalizeCatalogProduct(record = {}) {
  const internalSku = String(readFirst(record, PRODUCT_SKU_KEYS) || "").trim();
  if (!internalSku) return null;
  return {
    internalSku,
    productName: readFirst(record, PRODUCT_NAME_KEYS),
    imageUrl: findImageUrl(record),
    supplier: readFirst(record, SUPPLIER_KEYS),
    purchasePrice: nullableNumber(readFirst(record, PRICE_KEYS)),
    model: readFirst(record, MODEL_KEYS),
    brand: readFirst(record, BRAND_KEYS),
    material: readFirst(record, MATERIAL_KEYS),
    purpose: readFirst(record, PURPOSE_KEYS),
    customsCode: readFirst(record, CUSTOMS_CODE_KEYS),
    isBattery: readBatteryValue(record),
    unit: readFirst(record, UNIT_KEYS),
    declaredValue: nullableNumber(readFirst(record, DECLARED_VALUE_KEYS)),
    packQuantity: readPackQuantity(record),
    boxSpec: readOuterBoxSpec(record),
    productId: readFirst(record, PRODUCT_ID_KEYS),
    skuIdentifier: readFirst(record, SKU_IDENTIFIER_KEYS),
  };
}
```

- [ ] **Step 4: Move Listing shared XLSX loading/matching out of `sharedDataService.js`**

```js
export async function readListingSharedCatalogRecords({
  directory = path.join(process.cwd(), "data-cache", "listing-shared-catalog"),
  files = null,
} = {}) {
  const sourceFiles = files || await listXlsxFiles(directory);
  const records = [];
  for (const filePath of sourceFiles) {
    const workbook = XLSX.readFile(filePath);
    for (const sheetName of workbook.SheetNames) {
      records.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }));
    }
  }
  return records;
}

export function findListingSharedCatalogMatches(scope, records) {
  const bySidMsku = new Map();
  for (const record of records) {
    const listing = normalizeCatalogListing(record);
    if (!listing?.sid || !listing?.msku) continue;
    bySidMsku.set(`${listing.sid}:${normalizeCatalogKey(listing.msku)}`, listing);
  }
  return scope.map((item) => bySidMsku.get(item.key)).filter(Boolean);
}
```

`sharedDataService.js` imports and re-exports these functions so existing callers/tests keep working; it no longer owns XLSX path discovery.

- [ ] **Step 5: Run compatibility tests**

Run: `node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js test/fbaCatalogService.test.js`

Expected: PASS with unchanged declaration/battery behavior and new packaging coverage.

- [ ] **Step 6: Commit normalization extraction**

```bash
git add src/services/productCatalogNormalization.js src/services/listingSharedCatalogService.js src/services/sharedDataService.js test/productCatalogNormalization.test.js test/sharedDataService.test.js
git commit -m "refactor: centralize product catalog normalization"
```

### Task 4: Build deterministic legacy JSON migration and CLI

**Files:**
- Create: `src/services/productCatalogLegacyMigrationService.js`
- Create: `scripts/migrate-product-catalog.js`
- Modify: `src/utils/cacheStore.js`
- Create: `test/productCatalogLegacyMigration.test.js`

**Interfaces:**
- Consumes: repository, canonical seller cache, normalization functions, legacy directories.
- Produces: `buildLegacyProductCatalogManifest`, `migrateLegacyProductCatalog`, CLI exit contract.

- [ ] **Step 1: Write failing migration tests with conflicting legacy fixtures**

```js
test("folds row-set JSON by SID+MSKU/internal SKU and chooses newest non-empty fields", async (t) => {
  const fixture = await createLegacyMigrationFixture(t);
  await fixture.writeShared("older.json", 1000, legacyRecord({ storeName: "探嘉美国", purchasePrice: 35, supplier: "旧工厂" }));
  await fixture.writeShared("newer.json", 2000, legacyRecord({ storeName: "xiamentanjia-US", purchasePrice: 38, supplier: "新工厂" }));
  const result = await migrateLegacyProductCatalog(fixture.options);
  assert.equal(result.listingCount, 1);
  assert.equal(result.productCount, 1);
  assert.equal(result.conflictCount, 2);
  assert.equal(fixture.repository.readScope(fixture.scope)[0].listing.storeName, "xiamentanjia-US");
  assert.equal(fixture.repository.readScope(fixture.scope)[0].product.purchasePrice, 38);
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
```

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogLegacyMigration.test.js`

Expected: FAIL because the migration service/CLI do not exist.

- [ ] **Step 3: Expose read-only legacy paths and implement stable manifest hashing**

```js
// src/utils/cacheStore.js
export function getLegacyProductCatalogDirectories() {
  return { sharedProductCatalogDir, supplierBoardProductDir };
}
```

```js
export async function buildLegacyProductCatalogManifest({ sharedDir, supplierDir }) {
  async function list(directory, source) {
    let names;
    try {
      names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      const fileStat = await stat(filePath);
      return { source, name, filePath, size: fileStat.size, mtimeMs: Math.trunc(fileStat.mtimeMs) };
    }));
  }
  const files = [
    ...await list(sharedDir, "shared-product-catalog"),
    ...await list(supplierDir, "supplier-board-product-map"),
  ].sort((left, right) => `${left.source}:${left.name}`.localeCompare(`${right.source}:${right.name}`));
  const entries = files.map(({ source, name, size, mtimeMs }) => ({ source, name, size, mtimeMs }));
  const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { hash, entries, files };
}
```

`readAndMergeStableManifest` must compare a fresh manifest after every full read with the starting hash; on mismatch it discards the in-memory merge and restarts, up to three complete scans. It reads each JSON with its file `updatedAtMs`/mtime, ignores `product.raw`, and records only redacted conflict samples. The repository transaction begins only after a stable scan.

- [ ] **Step 4: Implement deterministic merge and one atomic repository import**

```js
export async function migrateLegacyProductCatalog({ repository, sellers, sharedDir, supplierDir, logger = console, maxScanAttempts = 3 }) {
  const sellerBySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]));
  const currentManifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
  if (repository.getMetadata("legacy_manifest_hash") === currentManifest.hash) return skippedResult(currentManifest);
  const merged = await readAndMergeStableManifest({ currentManifest, sellerBySid, maxScanAttempts });
  const write = repository.upsertCatalog({
    ...merged.records,
    operation: "legacy-migration",
    requestId: `legacy:${currentManifest.hash.slice(0, 12)}`,
    metadata: { legacy_manifest_hash: currentManifest.hash, legacy_migrated_at_ms: Date.now() },
  });
  return { ...merged.metrics, revision: write.revision, manifestHash: currentManifest.hash };
}
```

- [ ] **Step 5: Add the CLI without allowing seller API fallback**

`scripts/migrate-product-catalog.js` reads `readLingxingSellersCache()`, normalizes with `normalizeSellerRecords`, and fails if legacy records exist but the seller cache is empty or lacks a referenced SID. It creates the repository, runs migration, logs counts/hash/duration, closes in `finally`, and sets `process.exitCode=1` on failure. It never constructs a Lingxing adapter.

At runtime, `productCatalogService` memoizes one successful lazy migration check per process. Deployment always executes the CLI, so rollback-era legacy files are detected by the manifest hash before restart without scanning 91+ JSON files on every request.

- [ ] **Step 6: Run migration tests and a no-cache CLI smoke**

Run: `node --test test/productCatalogLegacyMigration.test.js test/cacheStore.test.js`

Expected: PASS.

Run:

```bash
repo_root="$(pwd)"
task_tmp_dir="$(mktemp -d)"
(cd "$task_tmp_dir" && node "$repo_root/scripts/migrate-product-catalog.js")
task_status=$?
test -n "$task_tmp_dir" && test "$task_tmp_dir" != "/" && rm -rf -- "$task_tmp_dir"
exit "$task_status"
```

Expected: PASS, creates only an empty temporary product-catalog database and reports zero legacy files.

- [ ] **Step 7: Commit migration**

```bash
git add src/services/productCatalogLegacyMigrationService.js scripts/migrate-product-catalog.js src/utils/cacheStore.js test/productCatalogLegacyMigration.test.js test/cacheStore.test.js
git commit -m "feat: migrate legacy product catalog caches"
```

### Task 5: Implement catalog lookup, initial fill, manual refresh, and single-flight

**Files:**
- Create: `src/services/productCatalogService.js`
- Create: `test/productCatalogService.test.js`

**Interfaces:**
- Consumes: repository, seller directory, migration, Listing/product lookup, XLSX backup, normalization.
- Produces: `getProductCatalogForRows`, `refreshProductCatalogScope`, `getProductCatalogRevision`, `getProductCatalogHealth`, `closeProductCatalogRepositoryForTests`.

- [ ] **Step 1: Write failing service tests for all source transitions**

```js
test("complete SQLite hit performs zero Lingxing requests regardless of record age", async () => {
  const fixture = await createCatalogServiceFixture({ seeded: true, sourceUpdatedAtMs: 1 });
  const result = await getProductCatalogForRows(fixture.rows, fixture.options);
  assert.equal(fixture.listingCalls, 0);
  assert.equal(fixture.productCalls, 0);
  assert.equal(result.meta.dbHitCount, 1);
});

test("normal lookup fetches only identities missing after legacy migration", async () => {
  const fixture = await createCatalogServiceFixture({ seededMskus: ["A"], requestedMskus: ["A", "B"] });
  const result = await getProductCatalogForRows(fixture.rows, fixture.options);
  assert.deepEqual(fixture.requestedListingMskus, ["B"]);
  assert.equal(result.meta.listingFetchedCount, 1);
});

test("manual refresh validates runtime SID before upstream calls", async () => {
  const fixture = await createCatalogServiceFixture({ runtimeSids: [8708] });
  await assert.rejects(refreshProductCatalogScope({ feature: "supplier-board", items: [{ sid: 9999, msku: "A" }] }, fixture.options), (error) => error.statusCode === 400);
  assert.equal(fixture.listingCalls, 0);
});

test("manual refresh failure leaves old rows and revision unchanged", async () => {
  const fixture = await createCatalogServiceFixture({ seeded: true, failProducts: true });
  const before = fixture.repository.getRevision();
  await assert.rejects(refreshProductCatalogScope(fixture.refreshRequest, fixture.options), /产品管理/);
  assert.equal(fixture.repository.getRevision(), before);
  assert.equal(fixture.repository.readScope(fixture.scope)[0].product.purchasePrice, 35);
});

test("same sorted refresh scope joins in-flight and commits once", async () => {
  const gate = createDeferred();
  const fixture = await createCatalogServiceFixture({ listingGate: gate });
  const first = refreshProductCatalogScope({ feature: "supplier-board", items: fixture.scope }, fixture.options);
  await fixture.waitForListingCalls(1);
  const second = refreshProductCatalogScope({ feature: "supplier-board", items: [...fixture.scope].reverse() }, fixture.options);
  gate.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(fixture.listingCalls, 1);
  assert.equal(fixture.productCalls, 1);
  assert.equal(fixture.repository.getRevision(), 1);
  assert.deepEqual([firstResult.meta.joinedInFlight, secondResult.meta.joinedInFlight].sort(), [false, true]);
});

test("live explicit empty optional fields clear old values instead of merging stale values", async () => {
  const fixture = await createCatalogServiceFixture({ seededSupplier: "旧工厂", liveSupplier: "" });
  await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(fixture.repository.readProductsByInternalSkuKeys([fixture.internalSkuKey])[0].supplier, "");
});

test("unresolved Listing returns 422 before product fetch and does not log raw input", async () => {
  const fixture = await createCatalogServiceFixture({ listingRecords: [], captureLogs: true });
  await assert.rejects(refreshProductCatalogScope(fixture.refreshRequest, fixture.options), (error) => error.statusCode === 422 && Boolean(error.details?.requestId));
  assert.equal(fixture.productCalls, 0);
  assert.doesNotMatch(fixture.logText(), /token|raw-secret/);
});

test("missing product returns 422 and alias conflict returns 409 without committing", async () => {
  const missing = await createCatalogServiceFixture({ productRecords: [] });
  await assert.rejects(refreshProductCatalogScope(missing.refreshRequest, missing.options), (error) => error.statusCode === 422);
  assert.equal(missing.repository.getRevision(), 0);

  const conflict = await createCatalogServiceFixture({ aliasConflict: true });
  await assert.rejects(refreshProductCatalogScope(conflict.refreshRequest, conflict.options), (error) => error.statusCode === 409);
  assert.equal(conflict.repository.getRevision(), conflict.seedRevision);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogService.test.js`

Expected: FAIL because `productCatalogService.js` does not exist.

- [ ] **Step 3: Implement service errors, seller validation, repository lookup, and metrics**

```js
export class ProductCatalogUpstreamError extends Error {
  constructor(message, { statusCode = 502, details = null, cause } = {}) {
    super(message, { cause }); this.name = "ProductCatalogUpstreamError"; this.statusCode = statusCode; this.details = details;
  }
}

async function resolveScopeSellers(scope, getDirectory, adapter) {
  const { sellers } = await getDirectory({ adapter });
  const bySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]));
  const unknown = scope.filter((item) => !bySid.has(item.sid)).map((item) => item.sid);
  if (unknown.length) throw new ProductCatalogInputError(`SID ${[...new Set(unknown)].join(", ")} 不在运行时店铺目录。`);
  return bySid;
}
```

`getProductCatalogForRows` calls `ensureMigrated` once, reads scope, and fetches only missing identities when `allowFetchMissing !== false`. Existing rows are never classified stale by age.

Create the default repository lazily on first use and keep one process-local instance. `closeProductCatalogRepositoryForTests()` must close and clear that singleton and the lazy-migration promise so test databases never leak across cases.

- [ ] **Step 4: Implement live scope loading outside the write transaction**

Group scope by SID and call `fetchLingxingListingsBySidMskus(..., { strict: true })` in batches of 50. Normalize/filter exact `SID + MSKU`; fill only missing internal SKU mappings from `findListingSharedCatalogMatches`. If any requested identity remains unresolved, throw status 422 before product calls.

Collect unique internal SKU/product ID/SKU identifier values and call `fetchLingxingProductRecords(..., { strict: true })` in batches of 80. Every internal SKU must resolve to a product record. Convert records to repository listings/products/aliases, then call one `upsertCatalog`.

```js
async function loadAndCommitScope(scope, context) {
  const listings = await fetchAllListings(scope, context);
  const resolvedListings = await fillMissingInternalSkusFromSharedXlsx(scope, listings, context);
  assertCompleteListingScope(scope, resolvedListings);
  const products = await fetchAllProducts(resolvedListings, context);
  assertCompleteProductScope(resolvedListings, products);
  return context.repository.upsertCatalog(buildRepositoryBatch(resolvedListings, products, context));
}
```

- [ ] **Step 5: Implement exact-scope refresh single-flight and safe logging**

Use `feature + sorted scope keys` as the in-flight key. Log request ID, feature, counts, operation, status, and elapsed time. Never log input objects or upstream payloads. Delete the promise in `finally` after both success and failure.

- [ ] **Step 6: Run service and upstream lookup tests**

Run: `node --test test/productCatalogService.test.js test/lingxingCatalogLookupService.test.js test/sellerDirectoryService.test.js`

Expected: PASS.

- [ ] **Step 7: Commit orchestration**

```bash
git add src/services/productCatalogService.js test/productCatalogService.test.js
git commit -m "feat: orchestrate shared product catalog refresh"
```

### Task 6: Replace row-set JSON persistence behind the compatibility facade

**Files:**
- Modify: `src/services/sharedDataService.js`
- Modify: `src/utils/cacheStore.js`
- Modify: `test/sharedDataService.test.js`
- Modify: `test/fbaShipmentCandidateService.test.js`
- Modify: `test/fbaFreightSheetService.test.js`
- Create: `test/productCatalogConsumerReuse.test.js`

**Interfaces:**
- Consumes: `getProductCatalogForRows` and `refreshProductCatalogScope` from Task 5.
- Produces: unchanged `getSharedProductCatalogMap(adapter, rows, options)` response shape plus `revision`/canonical metrics; no row-set cache writes.

- [ ] **Step 1: Rewrite facade tests to prove persistence-level reuse across different row sets**

```js
test("different request row sets reuse the same SID+MSKU database record", async () => {
  const fixture = await createFacadeFixture();
  await getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "A" }], fixture.options);
  await getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "A" }, { sid: 8708, msku: "B" }], fixture.options);
  assert.deepEqual(fixture.requestedListingMskus, [["A"], ["B"]]);
  assert.equal(fixture.legacySaveCalls, 0);
});

test("forceRefresh maps to atomic refresh of exactly the supplied scope", async () => {
  const fixture = await createFacadeFixture({ seededMskus: ["A", "B"] });
  await getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "A" }], { ...fixture.options, forceRefresh: true });
  assert.deepEqual(fixture.requestedListingMskus, [["A"]]);
  assert.equal(fixture.repository.readListing(8708, "B").refreshedAtMs, fixture.seededAtMs);
});

test("allowFetchMissing false never contacts Lingxing and fails strict missing rows", async () => {
  const fixture = await createFacadeFixture({ seededMskus: ["A"] });
  await assert.rejects(
    getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "B" }], { ...fixture.options, allowFetchMissing: false, strict: true }),
    (error) => error.statusCode === 422,
  );
  assert.equal(fixture.listingCalls, 0);
  assert.equal(fixture.productCalls, 0);
});
```

Extend candidate/freight/factory tests so the same seeded repository satisfies all consumers with zero Listing/product calls.

- [ ] **Step 2: Run RED**

Run: `node --test test/sharedDataService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/productCatalogConsumerReuse.test.js`

Expected: FAIL because the facade still hashes/writes each row set.

- [ ] **Step 3: Replace `getSharedProductCatalogMap` internals while preserving request-local lookup keys**

```js
export async function getSharedProductCatalogMap(adapter = getLingxingAdapter(), rows = [], options = {}) {
  const result = options.forceRefresh
    ? await refreshProductCatalogScope({ feature: options.feature || "shared-data", items: rows }, { ...options, adapter })
    : await getProductCatalogForRows(rows, { ...options, adapter });
  const map = buildSharedProductCatalogMap({ sourceRows: rows, catalogRecords: result.records });
  return {
    map,
    cacheHit: result.meta.listingFetchedCount === 0 && result.meta.productFetchedCount === 0,
    updatedAt: result.meta.cacheUpdatedAt || "",
    revision: result.meta.revision,
    status: catalogStatusText(result.meta),
    performance: catalogPerformanceShape(result.meta),
  };
}
```

Adapt `buildSharedProductCatalogMap` so normalized catalog records can create the existing SKU, internal SKU, product ID, SID+MSKU, store+MSKU, and country+MSKU in-memory aliases. The latter two remain compatibility aliases only and are never persisted.

- [ ] **Step 4: Stop new shared/supplier product-map writes**

Remove `saveSharedProductCatalogCache` and `saveSupplierBoardProductMapCache` from runtime call paths. Keep read-only legacy directory helpers for Task 4. Mark old read/write exports deprecated only if tests or rollback tooling still import them; do not delete old files.

- [ ] **Step 5: Run facade and consumer tests**

Run: `node --test test/sharedDataService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/productCatalogConsumerReuse.test.js`

Expected: PASS; assertions show only missing canonical identities call upstream.

- [ ] **Step 6: Commit facade cutover**

```bash
git add src/services/sharedDataService.js src/utils/cacheStore.js test/sharedDataService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/productCatalogConsumerReuse.test.js
git commit -m "refactor: reuse SQLite product catalog across services"
```

### Task 7: Converge supplier-board product data and revision-aware rehydration

**Files:**
- Modify: `src/services/supplierBoardService.js`
- Modify: `test/supplierBoardFailFast.test.js`
- Create: `test/supplierBoardProductCatalog.test.js`

**Interfaces:**
- Consumes: shared catalog facade and `getProductCatalogRevision`.
- Produces: supplier dashboard caches tagged with `meta.productCatalogRevision`; cache hits rehydrate product-owned fields when revision changes without calling salesStat.

- [ ] **Step 1: Write failing supplier-board reuse and revision tests**

```js
test("supplier board no longer reads or writes its duplicate product map", async () => {
  const fixture = createSupplierBoardFixture();
  await fixture.getDashboard();
  assert.equal(fixture.readSupplierProductMapCalls, 0);
  assert.equal(fixture.saveSupplierProductMapCalls, 0);
  assert.equal(fixture.sharedCatalogCalls, 1);
});

test("catalog revision change rehydrates cached product fields without salesStat", async () => {
  const fixture = createSupplierBoardFixture({ cachedRevision: 1, currentRevision: 2, cachedPurchasePrice: 35, catalogPurchasePrice: 38 });
  const result = await fixture.getDashboard();
  assert.equal(fixture.salesStatCalls, 0);
  assert.equal(result.rows[0].purchasePrice, 38);
  assert.equal(result.rows[0].purchaseCostSubtotal, result.rows[0].quantity * 38);
  assert.equal(result.meta.productCatalogRevision, 2);
});

test("forceRefresh bypasses a fresh dashboard cache but does not force product catalog refresh", async () => {
  const fixture = createSupplierBoardFixture({ hasFreshDashboardCache: true, forceRefresh: true });
  await fixture.getDashboard();
  assert.equal(fixture.dashboardCacheReadCalls, 0);
  assert.equal(fixture.salesStatCalls, 1);
  assert.equal(fixture.sharedCatalogCalls, 1);
  assert.equal(fixture.sharedCatalogOptions[0].forceRefresh, undefined);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/supplierBoardProductCatalog.test.js test/supplierBoardFailFast.test.js`

Expected: FAIL because supplier-board still owns duplicate product cache/API logic and returns cache before checking `forceRefresh`.

- [ ] **Step 3: Remove supplier-local product lookup/cache code**

Delete `PRODUCT_BATCH_SIZE`, `LISTING_BATCH_SIZE`, `SUPPLIER_PRODUCT_CACHE_VERSION`, local Listing/product normalizers/fetchers, `stableSupplierBoardProductCacheKey`, and supplier product-map cache imports. Replace `fetchProductMap` with the shared facade in strict mode:

```js
async function fetchProductCatalog(adapter, rows, options = {}) {
  return getSharedProductCatalogMap(adapter, rows, {
    strict: true,
    allowFetchMissing: options.allowFetchMissing !== false,
    feature: "supplier-board",
  });
}
```

- [ ] **Step 4: Make dashboard force refresh and catalog revision semantics explicit**

Only read the dashboard cache when `!normalizedFilters.forceRefresh`. Store `productCatalogRevision` when building live data.

On a cache hit, compare `getProductCatalogRevision()`. If equal, return normally. If different, call the shared facade with cached rows and `allowFetchMissing:false`, replace product-owned fields (`imageUrl`, `productName`, `sku/internalSku`, `model`, `supplier`, `purchasePrice`) from catalog values, recompute tax/costs/summary, update the cached dashboard and revision, and return without calling salesStat.

If any cached dashboard row cannot be resolved in strict no-fetch mode, propagate the catalog error and log `operation=supplier-cache-rehydrate`, cached revision, current revision, and row count. Never return the stale dashboard as a fallback.

```js
function mergeProductAndTax(rows, productMap, { replaceProductFields = false } = {}) {
  return rows.map((row) => {
    const product = findProduct(row, productMap);
    const supplier = replaceProductFields ? (product.supplier || "") : (product.supplier || row.supplier || "");
    const purchasePrice = replaceProductFields ? product.purchasePrice : (product.purchasePrice ?? row.purchasePrice);
    return buildSupplierRow({ row, product, supplier, purchasePrice, replaceProductFields });
  });
}
```

- [ ] **Step 5: Run supplier tests**

Run: `node --test test/supplierBoardProductCatalog.test.js test/supplierBoardFailFast.test.js test/supplierBoardFeature.test.js`

Expected: PASS, including the existing force-refresh fail-fast test.

- [ ] **Step 6: Commit supplier convergence**

```bash
git add src/services/supplierBoardService.js test/supplierBoardProductCatalog.test.js test/supplierBoardFailFast.test.js
git commit -m "refactor: share supplier product catalog data"
```

### Task 8: Converge FBA catalog product and packaging fields

**Files:**
- Modify: `src/services/fbaCatalogService.js`
- Modify: `test/fbaCatalogService.test.js`
- Modify: `test/fbaShipmentCandidateService.test.js`
- Modify: `test/fbaFreightSheetService.test.js`

**Interfaces:**
- Consumes: shared facade records including `packQuantity` and `boxSpec`.
- Produces: FBA Listing discovery cache containing only Listing identities; product details always rehydrate from SQLite/shared facade.

- [ ] **Step 1: Add failing FBA catalog reuse tests**

```js
test("FBA repeated search reuses canonical product info and preserves ERP box fields", async () => {
  const fixture = createFbaCatalogFixture();
  const first = await fixture.search();
  const second = await fixture.search();
  assert.equal(fixture.productApiCalls, 1);
  assert.equal(second.items[0].packQuantity, 6);
  assert.deepEqual(second.items[0].boxDimensions, { length: 40, width: 30, height: 20, unitOfMeasurement: "CM" });
});

test("FBA in-memory search cache does not store a second product master copy", async () => {
  const fixture = createFbaCatalogFixture({ seedRepository: true });
  await fixture.search();
  assert.equal(fixture.productApiCalls, 0);
  assert.deepEqual(fixture.inspectSearchCacheFields(), ["asin", "country", "displayName", "msku", "shopName", "sid", "title"]);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/fbaCatalogService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js`

Expected: FAIL because `fbaCatalogService` still independently fetches/caches product info.

- [ ] **Step 3: Restrict the FBA in-memory cache to Listing discovery**

Keep the 30-minute cache only for search/discovery results that came from `/erp/listing`: SID, MSKU, ASIN, title, shop/display/country. Remove `fetchProductInfoMap`, `mergeProductRecords`, and product-management raw data from `mskuCache`.

After each cached/live Listing result, call `getSharedProductCatalogMap(adapter, listingItems, { strict: true, feature: "fba-catalog" })`, merge canonical product and packaging fields, then apply the existing manual box-template override.

- [ ] **Step 4: Preserve unpaired diagnostics and strict logistics failures**

If Listing discovery finds a row but the catalog cannot resolve an internal SKU/product, keep the existing `unpairedListings` diagnostic. FBA logistics methods that require product fields must propagate catalog errors before payload/export generation; do not return empty pack/declaration defaults.

- [ ] **Step 5: Run FBA tests**

Run: `node --test test/fbaCatalogService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/jiufangFbaOrderService.test.js`

Expected: PASS with zero real external calls.

- [ ] **Step 6: Commit FBA convergence**

```bash
git add src/services/fbaCatalogService.js test/fbaCatalogService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js
git commit -m "refactor: share FBA product catalog records"
```

### Task 9: Add refresh route, dynamic error statuses, and health diagnostics

**Files:**
- Create: `routes/product-catalog.js`
- Modify: `routes/index.js`
- Modify: `routes/core.js`
- Modify: `server.js`
- Create: `test/productCatalogRoutes.test.js`
- Modify: `test/serverRoutesStructure.test.js`
- Modify: `test/serverSecurity.test.js`

**Interfaces:**
- Consumes: `refreshProductCatalogScope`, `getProductCatalogHealth`, `readJsonBody`, `sendJson`.
- Produces: `POST /api/product-catalog/refresh` with `auth:"session"`; `/api/health.productCatalog`.

- [ ] **Step 1: Write failing route and health tests**

```js
test("product catalog refresh route is authenticated and forwards only feature/items", async () => {
  const calls = [];
  const routes = createProductCatalogRoutes({
    readJsonBody: async () => ({ feature: "supplier-board", items: [{ sid: 8708, msku: "A" }], token: "drop" }),
    refreshProductCatalogScope: async (input) => { calls.push(input); return { ok: true, records: [], meta: { requestId: "req-1" } }; },
    sendJson: (_res, status, body) => ({ status, body }),
  });
  assert.equal(routes[0].auth, "session");
  await routes[0].handler({ req: {}, res: {} });
  assert.deepEqual(calls, [{ feature: "supplier-board", items: [{ sid: 8708, msku: "A" }] }]);
});

test("health exposes degraded product catalog without hiding the database error", async () => {
  const result = await invokeHealthRoute({
    getProductCatalogHealth: async () => ({ ok: false, schemaVersion: 1, quickCheck: "disk I/O error", error: "SQLITE_IOERR" }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.productCatalog, { ok: false, schemaVersion: 1, quickCheck: "disk I/O error", error: "SQLITE_IOERR" });
});

test("server dispatch uses ProductCatalog error.statusCode instead of route fallback", async () => {
  const response = await invokeProductCatalogRoute({
    refreshProductCatalogScope: async () => { throw new ProductCatalogUpstreamError("Listing 无法解析。", { statusCode: 422 }); },
    body: { feature: "supplier-board", items: [{ sid: 8708, msku: "A" }] },
  });
  assert.equal(response.status, 422);
  assert.match(response.body.error, /Listing 无法解析/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogRoutes.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js`

Expected: FAIL because the route and health dependency do not exist.

- [ ] **Step 3: Implement the focused route**

```js
export function createProductCatalogRoutes({ readJsonBody, sendJson, refreshProductCatalogScope } = {}) {
  return [{
    method: "POST",
    path: "/api/product-catalog/refresh",
    auth: "session",
    handler: async ({ req, res }) => {
      const body = await readJsonBody(req);
      const feature = String(body?.feature || "").trim();
      if (!["supplier-board", "factory-inventory", "fba-catalog", "fba-freight"].includes(feature)) {
        throw new ProductCatalogInputError("不支持的商品目录刷新来源。");
      }
      sendJson(res, 200, await refreshProductCatalogScope({ feature, items: body?.items }));
    },
  }];
}
```

Wire it through `routes/index.js`. Import only the two service entry points in `server.js` and pass them to `buildApiRoutes`.

- [ ] **Step 4: Add health without changing root availability semantics**

`/api/health` remains HTTP 200 and root `ok:true` so unrelated BI surfaces stay available, but adds `productCatalog` with `ok:false` and redacted error details when catalog health fails. `deploy-integrity` will later require nested `productCatalog.ok===true`.

- [ ] **Step 5: Run route/security tests**

Run: `node --test test/productCatalogRoutes.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js`

Expected: PASS; unauthenticated refresh remains blocked by the standard router auth path.

- [ ] **Step 6: Commit route/health wiring**

```bash
git add routes/product-catalog.js routes/index.js routes/core.js server.js test/productCatalogRoutes.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js
git commit -m "feat: expose product catalog refresh and health"
```

### Task 10: Add independent supplier-board current-filter product refresh UI

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/supplier-board.js`
- Modify: `app.js` (dependency wiring only)
- Modify: `test/supplierBoardFeature.test.js`
- Modify: `test/frontendStructure.test.js`

**Interfaces:**
- Consumes: `POST /api/product-catalog/refresh`, supplier feature's current client-filtered rows, ordinary `loadSupplierBoard()` revision rehydration.
- Produces: `refreshSupplierBoardProducts`, binding for `#supplier-board-product-refresh`.

- [ ] **Step 1: Write failing feature behavior and structure tests**

```js
test("supplier product refresh posts only unique current-filter SID+MSKU rows then reloads normally", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }, { sid: 8708, msku: "A" }, { sid: 8709, msku: "B" }],
    visibleRows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: true, meta: { refreshCommittedCount: 1 } }),
  });
  const result = await fixture.feature.refreshSupplierBoardProducts();
  assert.equal(result.ok, true);
  assert.equal(fixture.requests[0].url, "/api/product-catalog/refresh");
  assert.deepEqual(JSON.parse(fixture.requests[0].options.body), { feature: "supplier-board", items: [{ sid: 8708, msku: "A" }] });
  assert.deepEqual(fixture.dashboardLoads, [{ forceRefresh: false }]);
});

test("empty current filters do not call the API and show a visible error", async () => {
  const fixture = await createProductRefreshFeatureFixture({ visibleRows: [] });
  const result = await fixture.feature.refreshSupplierBoardProducts();
  assert.equal(result.ok, false);
  assert.equal(fixture.requests.length, 0);
  assert.match(fixture.statusText(), /当前筛选范围没有可刷新的/);
});

test("API failure restores button state and does not claim refreshed", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    visibleRows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: false, error: "产品管理接口失败" }, 502),
  });
  const result = await fixture.feature.refreshSupplierBoardProducts();
  assert.equal(result.ok, false);
  assert.equal(fixture.productRefreshButton.disabled, false);
  assert.equal(fixture.productRefreshButton.textContent, "刷新商品资料");
  assert.match(fixture.statusText(), /刷新失败：产品管理接口失败/);
  assert.doesNotMatch(fixture.statusText(), /已刷新/);
  assert.equal(fixture.dashboardLoads.length, 0);
});
```

Extend `frontendStructure.test.js` to assert the supplier hero has separate `#supplier-board-refresh` and `#supplier-board-product-refresh` buttons and no inline style.

- [ ] **Step 2: Run RED**

Run: `node --test test/supplierBoardFeature.test.js test/frontendStructure.test.js`

Expected: FAIL because the second button/method/binding do not exist.

- [ ] **Step 3: Add semantic markup with no CSS change**

```html
<button class="secondary-button" id="supplier-board-product-refresh" type="button">刷新商品资料</button>
<button class="primary-button" id="supplier-board-refresh" type="button">刷新看板</button>
```

Keep the existing export button. Do not edit `assets/css/*` or `styles.css` unless browser verification proves an actual reusable layout defect; if that occurs, stop and request a reviewed CSS scope rather than adding a page-only rule.

- [ ] **Step 4: Implement current-filter scope collection and refresh state**

Add `fetchImpl = globalThis.fetch`, `setButtonBusy`, and `logger = console` to the feature factory. Wire the existing shared `setButtonBusy` through `app.js`; this is composition-only. Change `loadSupplierBoard()` to return the `loadDashboardSection()` result. Use `getSupplierBoardDisplayRows().slice(0, visibleLimit)` so country/store/supplier/keyword filters and the exact currently rendered 500-row page determine refresh scope.

```js
function currentProductCatalogScope() {
  const byKey = new Map();
  getSupplierBoardDisplayRows().slice(0, visibleLimit).forEach((row) => {
    const sid = Number(row.sid || 0);
    const msku = String(row.msku || "").trim();
    if (sid && msku) byKey.set(`${sid}:${msku.toLowerCase()}`, { sid, msku });
  });
  return [...byKey.values()];
}

async function refreshSupplierBoardProducts() {
  const items = currentProductCatalogScope();
  if (!items.length) {
    setText("#supplier-board-status", "当前筛选范围没有可刷新的 SID + MSKU。", root);
    return { ok: false, reason: "empty-scope" };
  }
  const button = root?.querySelector?.("#supplier-board-product-refresh");
  const restoreButton = setButtonBusy(button, "刷新中…", "刷新商品资料");
  try {
    const response = await fetchImpl("/api/product-catalog/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "supplier-board", items }) });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw Object.assign(new Error(data.error || `API ${response.status}`), { payload: data });
    const reload = await loadSupplierBoard({ forceRefresh: false });
    if (!reload?.ok) {
      setText("#supplier-board-status", `商品资料已提交 ${data.meta.refreshCommittedCount} 个，但看板重载失败：${reload?.error?.message || "未知错误"}`, root);
      logger.error("[supplier-board] product refresh committed but reload failed", { count: data.meta.refreshCommittedCount, errorMessage: reload?.error?.message || "unknown" });
      return { ok: false, committed: true, data, error: reload?.error };
    }
    setText("#supplier-board-status", `商品资料已刷新 ${data.meta.refreshCommittedCount} 个，并已重新装配当前看板。`, root);
    return { ok: true, data };
  } catch (error) {
    setText("#supplier-board-status", `商品资料刷新失败：${error.message}`, root);
    logger.error("[supplier-board] product refresh failed", { errorMessage: error.message, status: error.response?.status || 0, itemCount: items.length });
    return { ok: false, error };
  } finally {
    restoreButton();
  }
}
```

Use existing shared button/text helpers passed from `app.js`; do not implement feature state in `app.js`.

- [ ] **Step 5: Bind and export the new method**

Bind `#supplier-board-product-refresh` before export/sort bindings and add `refreshSupplierBoardProducts` to the factory return. Update exact binding-order expectations.

- [ ] **Step 6: Run frontend unit tests**

Run: `node --test test/supplierBoardFeature.test.js test/frontendStructure.test.js`

Expected: PASS.

- [ ] **Step 7: Perform required browser verification**

Start a local server with a temporary test configuration, intercept `/api/dashboard/supplier-board` and `/api/product-catalog/refresh` with Playwright, and verify:

1. Supplier board renders without console errors.
2. Tab/Shift+Tab reaches both buttons and Enter activates “刷新商品资料”.
3. The POST body contains only filtered unique identities.
4. Loading disables only the product-refresh button and restores its text.
5. Success reloads the dashboard without `forceRefresh=1`; failure remains visible.
6. At desktop 1440×900 and narrow 390×844, hero buttons do not overlap and the document does not gain page-level horizontal overflow.

Save verification screenshots outside the repository or delete temporary harness/screenshots before commit.

- [ ] **Step 8: Commit supplier UI**

```bash
git add index.html assets/js/features/supplier-board.js app.js test/supplierBoardFeature.test.js test/frontendStructure.test.js
git commit -m "feat: refresh filtered supplier product data"
```

### Task 11: Guard Linux dependency installation, migration, packaging, and deployed health

**Files:**
- Create: `scripts/product-catalog-sqlite-smoke.js`
- Modify: `scripts/migrate-product-catalog.js`
- Modify: `scripts/package-deploy.js`
- Modify: `scripts/deploy-integrity.js`
- Modify: `deploy.sh`
- Create: `test/productCatalogDeploy.test.js`
- Modify: `test/deployGuardStructure.test.js`
- Modify: `test/deployIntegrity.test.js`

**Interfaces:**
- Consumes: repository/CLI/health from Tasks 1–9.
- Produces: fail-fast pre-restart smoke+migration and post-restart `health.productCatalog.ok` verification.

- [ ] **Step 1: Write failing deploy guard tests**

```js
test("SQLite smoke opens, writes, reads, rolls back, and removes a temporary database", async () => {
  const result = await runProductCatalogSqliteSmoke({ directory: testDirectory });
  assert.deepEqual(result, { ok: true, journalMode: "wal", transactionRollbackVerified: true });
  assert.deepEqual(await readdir(testDirectory), []);
});

test("deploy package explicitly contains both catalog scripts", async () => {
  const source = await readFile(packageDeployPath, "utf8");
  assert.match(source, /scripts\/product-catalog-sqlite-smoke\.js/);
  assert.match(source, /scripts\/migrate-product-catalog\.js/);
});

test("deploy runs npm ci, SQLite smoke, migration, then PM2 restart in order", async () => {
  const source = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const installIndex = source.indexOf("npm ci");
  const smokeIndex = source.indexOf("node scripts/product-catalog-sqlite-smoke.js");
  const migrateIndex = source.indexOf("node scripts/migrate-product-catalog.js");
  const restartIndex = source.indexOf("pm2 start");
  assert.ok(installIndex >= 0 && installIndex < smokeIndex);
  assert.ok(smokeIndex < migrateIndex);
  assert.ok(migrateIndex < restartIndex);
});

test("deploy integrity rejects missing or degraded productCatalog health", () => {
  assert.deepEqual(validateProductCatalogHealth({ ok: true }), ["/api/health 缺少 productCatalog 健康状态"]);
  assert.deepEqual(
    validateProductCatalogHealth({ ok: true, productCatalog: { ok: false, schemaVersion: 1, quickCheck: "disk I/O error", error: "SQLITE_IOERR" } }),
    ["商品目录数据库异常：schemaVersion=1 quickCheck=disk I/O error error=SQLITE_IOERR"],
  );
  assert.deepEqual(validateProductCatalogHealth({ ok: true, productCatalog: { ok: true } }), []);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js`

Expected: FAIL because smoke/package/deploy health guards are absent.

- [ ] **Step 3: Implement the temporary SQLite smoke**

```js
export async function runProductCatalogSqliteSmoke({ directory = null } = {}) {
  const ownsDirectory = !directory;
  const workingDirectory = directory || await mkdtemp(path.join(tmpdir(), "product-catalog-smoke-"));
  await mkdir(workingDirectory, { recursive: true });
  const databasePath = path.join(workingDirectory, "smoke.sqlite");
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    const tx = db.transaction(() => { db.prepare("INSERT INTO smoke(value) VALUES (?)").run("ok"); throw new Error("rollback"); });
    assert.throws(tx, /rollback/);
    if (db.prepare("SELECT COUNT(*) AS count FROM smoke").get().count !== 0) throw new Error("SQLite rollback smoke failed");
    return { ok: true, journalMode: db.pragma("journal_mode", { simple: true }), transactionRollbackVerified: true };
  } finally {
    db.close();
    await Promise.all(["smoke.sqlite", "smoke.sqlite-wal", "smoke.sqlite-shm"].map((name) => rm(path.join(workingDirectory, name), { force: true })));
    if (ownsDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }
}
```

The CLI prints a short JSON result and exits nonzero on import/native-module/database errors.

- [ ] **Step 4: Update package and deploy order**

Add both scripts to `scripts/package-deploy.js` explicit files. In `deploy.sh`, immediately after `npm ci` run:

```bash
log "检查 SQLite 原生模块和事务"
node scripts/product-catalog-sqlite-smoke.js

log "迁移共享商品目录缓存"
node scripts/migrate-product-catalog.js

log "重启 PM2 应用：$APP_NAME"
```

Do not move migration after PM2 restart. Keep `data-cache` excluded from the archive and deployment backup behavior unchanged.

- [ ] **Step 5: Require nested catalog health after restart**

Export a pure `validateProductCatalogHealth(health)` helper. In `verifyDeployedApp`, append its errors when `health.productCatalog?.ok !== true`; include only its redacted `error`, `schemaVersion`, and `quickCheck` in the message. Preserve the existing root health and authenticated sales-review smoke.

- [ ] **Step 6: Run deploy tests and package manifest test**

Run: `node --test test/productCatalogDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js`

Expected: PASS.

Do not generate the archive in this task because the documentation commit has not happened yet; Task 12 runs the real package command from a clean committed worktree. The structure test is the acceptance check here.

- [ ] **Step 7: Commit deployment guards**

```bash
git add scripts/product-catalog-sqlite-smoke.js scripts/migrate-product-catalog.js scripts/package-deploy.js scripts/deploy-integrity.js deploy.sh test/productCatalogDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js
git commit -m "build: guard product catalog SQLite deployment"
```

### Task 12: Update living documentation, refactor locally, and run the full verification gate

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `SERVER_DEPLOYMENT.md`
- Modify only if cleanup is required: files touched in Tasks 1–11

**Interfaces:**
- Consumes: all first-stage implementation outputs.
- Produces: documented source of truth and a clean, verified branch ready for code review—not automatic production deployment.

- [ ] **Step 1: Add the approved cache architecture to living docs**

Add an `AGENTS.md` section that states verbatim in operational terms:

```markdown
## BI SQLite Cache Architecture

- Lingxing remains the source of truth. SQLite files are local derived caches, split by domain.
- Stage 1 uses `data-cache/product-catalog/product-catalog-v1.sqlite` with `SID + normalized MSKU` Listing identity and normalized internal-SKU product identity.
- Existing catalog rows never refresh by age. New missing identities may be filled once; updates require an explicit current-page product refresh.
- Product refresh is all-or-nothing, validates runtime seller SID, and never persists raw upstream payloads or credentials.
- `sales-facts.sqlite` and `inventory-snapshots.sqlite` are approved later stages but require separate detailed designs before implementation.
```

Update README installation/dependency notes and `SERVER_DEPLOYMENT.md` with database path, native dependency smoke, migration order, health field, rollback behavior, and the rule that old JSON remains read-only until a separate cleanup approval.

- [ ] **Step 2: Run the local refactor checkpoint**

Inspect touched files and remove:

- duplicate field alias arrays left in supplier/FBA/shared services;
- unused row-set cache imports/constants;
- repeated request-scope normalization;
- duplicate event bindings or button state code;
- any new feature logic accidentally placed in `app.js`/`server.js`;
- comments or logs containing payload dumps.

Run: `rg -n "saveSharedProductCatalogCache|saveSupplierBoardProductMapCache|SUPPLIER_PRODUCT_CACHE_VERSION|raw:" src/services assets/js`

Expected: no runtime cache writes and no new persisted raw product record. Any remaining match must be an explicitly reviewed legacy migration/pure compatibility helper.

- [ ] **Step 3: Run targeted first-stage tests**

Run:

```bash
node --test \
  test/productCatalogIdentity.test.js \
  test/productCatalogRepository.test.js \
  test/productCatalogNormalization.test.js \
  test/productCatalogLegacyMigration.test.js \
  test/productCatalogService.test.js \
  test/productCatalogRoutes.test.js \
  test/productCatalogDeploy.test.js \
  test/sharedDataService.test.js \
  test/supplierBoardProductCatalog.test.js \
  test/supplierBoardFeature.test.js \
  test/fbaCatalogService.test.js \
  test/fbaShipmentCandidateService.test.js \
  test/fbaFreightSheetService.test.js \
  test/deployIntegrity.test.js
```

Expected: all PASS.

- [ ] **Step 4: Run repository-wide verification**

Run: `npm run check`

Expected: PASS; CSS check reports no generated-style difference.

Run: `npm test`

Expected: PASS with no real Lingxing/Jiufang calls.

Run: `git diff --check && git status --short`

Expected before the docs commit: only the three documentation files are modified; no untracked database, WAL, SHM, screenshots, deployment archive, or temporary fixtures.

- [ ] **Step 5: Commit living documentation**

```bash
git add AGENTS.md README.md SERVER_DEPLOYMENT.md
git commit -m "docs: document staged SQLite cache architecture"
```

- [ ] **Step 6: Verify the clean committed package guard**

Run:

```bash
git status --short
DEPLOY_CONFIRM_BRANCH=codex/product-catalog-sqlite-cache \
ALLOW_NON_PRODUCTION_DEPLOY=1 \
node scripts/package-deploy.js
```

Expected: clean status before packaging; package succeeds, manifest names the current branch/commit and includes the new scripts. Remove the generated archive after inspecting it so the worktree returns clean:

```bash
rm -f tanjia-bi-deploy.tar.gz
git status --short
```

Expected: clean.

- [ ] **Step 7: Request code review before merge/deployment**

Use `superpowers:requesting-code-review` against merge-base `main`. Resolve Standards and Spec findings, rerun targeted/full verification after fixes, then use `superpowers:finishing-a-development-branch`. Do not deploy to `47.107.92.14` until the reviewed branch is merged to `main` and the user explicitly authorizes production deployment.

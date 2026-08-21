import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import {
  closeProductCatalogRepositoryForTests,
  getProductCatalogForRows,
  getProductCatalogHealth,
  getProductCatalogProductNames,
  getProductCatalogRevision,
  searchProductCatalogSkus,
  ProductCatalogUpstreamError,
  refreshProductCatalogScope,
} from "../src/services/productCatalogService.js";

const NOW = 1720000000000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function liveListing(msku, {
  sid = 8708,
  internalSku = msku,
  productId = "101",
  skuIdentifier = "",
  asin = "",
  storeName = "上游别名",
  country = "上游国家",
} = {}) {
  return {
    sid,
    seller_sku: msku,
    local_sku: internalSku,
    product_id: productId,
    sku_identifier: skuIdentifier,
    asin,
    store_name: storeName,
    country,
  };
}

function liveProduct(internalSku, {
  productId = "101",
  supplier = "新工厂",
  purchasePrice = 38,
  skuIdentifier = "sku-id-101",
  packQuantity = null,
  boxSpec = null,
} = {}) {
  return {
    sku: internalSku,
    product_id: productId,
    sku_identifier: skuIdentifier,
    product_name: "实时商品",
    supplier,
    purchase_price: purchasePrice,
    ...(packQuantity !== null ? { cg_box_pcs: packQuantity } : {}),
    ...(boxSpec ? {
      cg_box_length: boxSpec.dimensions.length,
      cg_box_width: boxSpec.dimensions.width,
      cg_box_height: boxSpec.dimensions.height,
      cg_box_weight: boxSpec.weight.value,
    } : {}),
  };
}

function seed(repository, {
  sid = 8708,
  msku = "A",
  internalSku = msku,
  productId = "101",
  supplier = "旧工厂",
  purchasePrice = 35,
  sourceUpdatedAtMs = NOW,
} = {}) {
  const internalSkuKey = internalSku.toLowerCase();
  repository.upsertCatalog({
    operation: "test-seed",
    requestId: "test-seed",
    products: [{
      internalSkuKey,
      internalSku,
      productName: "旧商品",
      supplier,
      purchasePrice,
      productId,
      source: "legacy-json",
      sourceUpdatedAtMs,
      refreshedAtMs: sourceUpdatedAtMs,
    }],
    aliases: [{
      aliasType: "product_id",
      aliasKey: productId,
      aliasValue: productId,
      internalSkuKey,
      source: "legacy-json",
      updatedAtMs: sourceUpdatedAtMs,
    }],
    listings: [{
      sid,
      msku,
      mskuKey: msku.toLowerCase(),
      internalSkuKey,
      internalSku,
      listingSku: internalSku,
      storeName: "旧店铺名",
      country: "旧国家",
      source: "legacy-json",
      sourceUpdatedAtMs,
      refreshedAtMs: sourceUpdatedAtMs,
    }],
  });
}

async function createCatalogServiceFixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-service-test-"));
  const logs = [];
  const logger = {
    info(...args) { logs.push(args); },
    warn(...args) { logs.push(args); },
    error(...args) { logs.push(args); },
  };
  const repository = createProductCatalogRepository({
    databasePath: path.join(directory, "product-catalog-v1.sqlite"),
    now: () => NOW,
    logger,
  });
  const runtimeSids = options.runtimeSids || [8708];
  const scope = options.scope || [{ sid: 8708, msku: "A" }];
  const requestedMskus = options.requestedMskus || scope.map((item) => item.msku);
  const seededMskus = options.seededMskus || (options.seeded ? ["A"] : []);
  seededMskus.forEach((msku) => seed(repository, {
    msku,
    sourceUpdatedAtMs: options.sourceUpdatedAtMs ?? NOW,
    supplier: options.seededSupplier || "旧工厂",
    productId: msku === "A" ? "101" : `id-${msku}`,
  }));

  const listingRecords = options.listingRecords === undefined
    ? requestedMskus.map((msku) => liveListing(msku, {
      internalSku: msku,
      productId: msku === "A" ? "101" : `id-${msku}`,
    }))
    : options.listingRecords;
  const productRecords = options.productRecords === undefined
    ? requestedMskus.map((msku) => liveProduct(msku, {
      productId: msku === "A" ? "101" : `id-${msku}`,
      supplier: options.liveSupplier ?? "新工厂",
    }))
    : options.productRecords;
  let listingCalls = 0;
  let productCalls = 0;
  let requestedListingMskus = [];
  const listingGate = options.listingGate;
  let failProducts = Boolean(options.failProducts);
  const adapter = {
    async fetchListings(params) {
      listingCalls += 1;
      const values = Array.isArray(params.search_value) ? params.search_value : [params.search_value];
      requestedListingMskus.push(...values.filter(Boolean));
      if (listingGate && listingCalls === 1) await listingGate.promise;
      const rows = listingRecords.filter((record) => values.includes(record.seller_sku || record.msku));
      return { data: { total: rows.length, list: rows } };
    },
    async fetchLocalProductInfos(params) {
      productCalls += 1;
      if (failProducts) throw new Error("产品管理不可用");
      const values = params.skus || params.sku_identifiers || params.product_ids || [];
      const rows = productRecords.filter((record) => values.some((value) => [
        record.sku,
        record.local_sku,
        record.product_id,
        record.productId,
        record.sku_identifier,
        record.skuIdentifier,
      ].some((candidate) => String(candidate ?? "") === String(value))));
      return { data: { rows } };
    },
    async fetchLocalProducts() {
      if (failProducts) throw new Error("产品管理不可用");
      return { data: { rows: productRecords } };
    },
  };
  const sellers = runtimeSids.map((sid) => ({ sid, name: `runtime-${sid}`, country: "美国" }));
  const optionsForService = {
    repository,
    adapter,
    logger,
    now: () => NOW + 1000,
    sellers,
    getSellerDirectory: async () => ({ sellers }),
    migrateLegacyProductCatalog: async () => ({
      skipped: true,
      listingCount: 0,
      productCount: 0,
      revision: repository.getRevision(),
    }),
    listingSharedCatalogRecords: options.listingSharedCatalogRecords || [],
    sidVariants: [{ sid: 8708 }],
  };
  const fixture = {
    directory,
    repository,
    adapter,
    options: optionsForService,
    rows: requestedMskus.map((msku) => ({ sid: 8708, msku })),
    scope,
    refreshRequest: { feature: "supplier-board", items: scope },
    internalSkuKey: "a",
    get listingCalls() { return listingCalls; },
    get productCalls() { return productCalls; },
    get requestedListingMskus() { return requestedListingMskus; },
    get logEntries() { return logs; },
    logText() { return JSON.stringify(logs); },
    setFailProducts(value) { failProducts = Boolean(value); },
    async waitForListingCalls(count) {
      const deadline = Date.now() + 1000;
      while (listingCalls < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      assert.ok(listingCalls >= count, `expected ${count} Listing call(s), got ${listingCalls}`);
    },
    async cleanup() {
      await closeProductCatalogRepositoryForTests();
      repository.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return fixture;
}

test("complete SQLite hit performs zero Lingxing requests regardless of record age", async (t) => {
  const fixture = await createCatalogServiceFixture({ seeded: true, sourceUpdatedAtMs: 1 });
  t.after(fixture.cleanup);
  const result = await getProductCatalogForRows(fixture.rows, fixture.options);
  assert.equal(fixture.listingCalls, 0);
  assert.equal(fixture.productCalls, 0);
  assert.equal(result.meta.dbHitCount, 1);
  assert.equal(result.records[0].storeName, "runtime-8708");
  assert.equal(result.records[0].country, "美国");
});

test("FBA packaging completeness refreshes an existing SQLite row from Lingxing", async (t) => {
  const fixture = await createCatalogServiceFixture({
    seeded: true,
    productRecords: [liveProduct("A", {
      packQuantity: 12,
      boxSpec: {
        dimensions: { length: 54.5, width: 54.5, height: 43.5 },
        weight: { value: 18.2 },
      },
    })],
  });
  t.after(fixture.cleanup);

  const result = await getProductCatalogForRows(fixture.rows, {
    ...fixture.options,
    requireFbaBoxSpec: true,
    feature: "fba-catalog",
  });

  assert.equal(fixture.listingCalls, 1);
  assert.equal(fixture.productCalls, 1);
  assert.equal(result.records[0].product.packQuantity, 12);
  assert.deepEqual(result.records[0].product.boxSpec, {
    dimensions: { length: 54.5, width: 54.5, height: 43.5, unitOfMeasurement: "CM" },
    weight: { value: 18.2, unit: "KG" },
  });
  assert.equal(result.meta.boxSpecRefreshRequestedCount, 1);
  assert.equal(result.meta.boxSpecRefreshCommittedCount, 1);
  assert.equal(result.meta.boxSpecRefreshUnresolvedCount, 0);
});

test("normal lookup fetches only identities missing after legacy migration", async (t) => {
  const fixture = await createCatalogServiceFixture({ seededMskus: ["A"], requestedMskus: ["A", "B"] });
  t.after(fixture.cleanup);
  const result = await getProductCatalogForRows(fixture.rows, fixture.options);
  assert.deepEqual(fixture.requestedListingMskus, ["B"]);
  assert.equal(result.meta.listingFetchedCount, 1);
});

test("manual refresh validates runtime SID before upstream calls", async (t) => {
  const fixture = await createCatalogServiceFixture({ runtimeSids: [8708] });
  t.after(fixture.cleanup);
  await assert.rejects(
    refreshProductCatalogScope({ feature: "supplier-board", items: [{ sid: 9999, msku: "A" }] }, fixture.options),
    (error) => error.statusCode === 400 && Boolean(error.details?.requestId),
  );
  assert.equal(fixture.listingCalls, 0);
});

test("invalid catalog scope preserves 400 identity error and adds a redacted request ID", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  await assert.rejects(
    getProductCatalogForRows([{ sid: 0, msku: "A", token: "raw-secret" }], {
      ...fixture.options,
      requestId: "req-invalid-scope",
    }),
    (error) => error.statusCode === 400
      && error.name === "ProductCatalogInputError"
      && error.details?.requestId === "req-invalid-scope"
      && !JSON.stringify(error.details).includes("raw-secret"),
  );
});

test("manual refresh failure leaves old rows and revision unchanged", async (t) => {
  const fixture = await createCatalogServiceFixture({ seeded: true, failProducts: true });
  t.after(fixture.cleanup);
  const before = fixture.repository.getRevision();
  let failure;
  await assert.rejects(
    refreshProductCatalogScope(fixture.refreshRequest, fixture.options),
    (error) => {
      failure = error;
      return /产品管理/.test(error.message) && Boolean(error.details?.requestId);
    },
  );
  assert.equal(fixture.repository.getRevision(), before);
  assert.equal(fixture.repository.readScope(fixture.scope)[0].product.purchasePrice, 35);
  assert.equal(failure.details.migrationCompleted, true);
  assert.equal(failure.details.catalogRevisionBeforeRefresh, before);
  const errorLog = fixture.logEntries
    .filter(([prefix]) => prefix === "[product-catalog-service]")
    .map(([, details]) => details)
    .find((details) => details.status === "error");
  assert.equal(errorLog.errorName, "ProductCatalogUpstreamError");
  assert.equal(errorLog.errorCode, null);
  assert.equal(errorLog.operation, "manual-refresh");
  assert.equal(typeof errorLog.errorMessage, "string");
});

test("same sorted refresh scope joins in-flight and commits once", async (t) => {
  const gate = deferred();
  const fixture = await createCatalogServiceFixture({ listingGate: gate });
  t.after(fixture.cleanup);
  const first = refreshProductCatalogScope({ feature: "supplier-board", items: fixture.scope }, fixture.options);
  await fixture.waitForListingCalls(1);
  const second = refreshProductCatalogScope({
    feature: "supplier-board",
    items: [...fixture.scope].reverse(),
  }, fixture.options);
  gate.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(fixture.listingCalls, 1);
  assert.equal(fixture.productCalls, 1);
  assert.equal(fixture.repository.getRevision(), 1);
  assert.equal(firstResult.records[0].listing.source, "lingxing-listing");
  assert.equal(firstResult.meta.listingSharedXlsxCount, 0);
  assert.deepEqual(
    [firstResult.meta.joinedInFlight, secondResult.meta.joinedInFlight].sort(),
    [false, true],
  );
});

test("normal lookup exposes true listing/product batch metadata", async (t) => {
  const mskus = Array.from({ length: 81 }, (_, index) => `M-${index + 1}`);
  const fixture = await createCatalogServiceFixture({
    scope: mskus.map((msku) => ({ sid: 8708, msku })),
    requestedMskus: mskus,
    productRecords: mskus.map((msku) => liveProduct(msku, {
      productId: `id-${msku}`,
      skuIdentifier: `identifier-${msku}`,
    })),
  });
  t.after(fixture.cleanup);

  const result = await getProductCatalogForRows(fixture.scope, fixture.options);
  assert.equal(result.meta.listingFetchedCount, 81);
  assert.equal(result.meta.listingBatchCount, 9);
  assert.equal(result.meta.listingRequestCount, 9);
  assert.equal(result.meta.productFetchedCount, 81);
  assert.equal(result.meta.productLookupBatchCount, 2);
  assert.equal(result.meta.productInfoRequestCount, 2);
  assert.equal(result.meta.joinedInFlight, false);
  assert.equal(typeof result.meta.transactionDurationMs, "number");
  assert.equal(result.meta.transactionDurationMs >= 0, true);
});

test("catalog timings measure migration, database lookup, upstream phases, and commit separately", async (t) => {
  let clock = 1000;
  const timingNow = () => clock;
  const fixture = await createCatalogServiceFixture({
    timingNow,
    listingRecords: [liveListing("A")],
    productRecords: [liveProduct("A")],
  });
  t.after(fixture.cleanup);
  const originalListing = fixture.adapter.fetchListings;
  fixture.adapter.fetchListings = async (...args) => {
    clock += 17;
    return originalListing(...args);
  };
  const originalProducts = fixture.adapter.fetchLocalProductInfos;
  fixture.adapter.fetchLocalProductInfos = async (...args) => {
    clock += 13;
    return originalProducts(...args);
  };
  const originalUpsert = fixture.repository.upsertCatalog.bind(fixture.repository);
  const repository = {
    ...fixture.repository,
    upsertCatalog(input) {
      clock += 3;
      return originalUpsert(input);
    },
  };
  const result = await getProductCatalogForRows(fixture.rows, {
    ...fixture.options,
    repository,
    timingNow,
  });
  assert.equal(result.meta.source, "sqlite");
  assert.equal(result.meta.scopeCount, 1);
  assert.equal(typeof result.meta.requestId, "string");
  assert.deepEqual(Object.keys(result.meta.timings).sort(), [
    "dbLookupDurationMs",
    "listingFetchDurationMs",
    "migrationDurationMs",
    "productFetchDurationMs",
    "transactionDurationMs",
  ]);
  assert.equal(result.meta.timings.listingFetchDurationMs, 17);
  assert.equal(result.meta.timings.productFetchDurationMs, 13);
  assert.equal(result.meta.timings.transactionDurationMs, 3);
  assert.equal(result.meta.transactionDurationMs, 3);
  Object.values(result.meta.timings).forEach((duration) => assert.equal(duration >= 0, true));
});

test("catalog meta exposes live-owned legacy skip count", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  fixture.options.migrateLegacyProductCatalog = async () => ({
    skipped: false,
    listingCount: 1,
    productCount: 1,
    liveOwnedSkipCount: 3,
    revision: fixture.repository.getRevision(),
  });
  const result = await getProductCatalogForRows(fixture.rows, fixture.options);
  assert.equal(result.meta.liveOwnedSkipCount, 3);
});

test("normal lookup exposes joinedInFlight on the joining caller", async (t) => {
  const gate = deferred();
  const fixture = await createCatalogServiceFixture({ listingGate: gate });
  t.after(fixture.cleanup);

  const first = getProductCatalogForRows(fixture.scope, fixture.options);
  await fixture.waitForListingCalls(1);
  const second = getProductCatalogForRows(fixture.scope, fixture.options);
  gate.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(
    [firstResult.meta.joinedInFlight, secondResult.meta.joinedInFlight].sort(),
    [false, true],
  );
  assert.equal(firstResult.meta.productLookupBatchCount, 1);
  assert.equal(secondResult.meta.productLookupBatchCount, 1);
  assert.equal(typeof secondResult.meta.transactionDurationMs, "number");
});

test("same feature and scope remain isolated across repository and adapter dependencies", async (t) => {
  const gateA = deferred();
  const gateB = deferred();
  const firstFixture = await createCatalogServiceFixture({ listingGate: gateA });
  const secondFixture = await createCatalogServiceFixture({ listingGate: gateB });
  t.after(async () => {
    await firstFixture.cleanup();
    await secondFixture.cleanup();
  });
  const first = refreshProductCatalogScope(firstFixture.refreshRequest, firstFixture.options);
  await firstFixture.waitForListingCalls(1);
  const second = refreshProductCatalogScope(secondFixture.refreshRequest, secondFixture.options);
  await secondFixture.waitForListingCalls(1);
  gateA.resolve();
  gateB.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstFixture.listingCalls, 1);
  assert.equal(secondFixture.listingCalls, 1);
  assert.equal(firstFixture.repository.getRevision(), 1);
  assert.equal(secondFixture.repository.getRevision(), 1);
  assert.deepEqual(
    [firstResult.meta.joinedInFlight, secondResult.meta.joinedInFlight].sort(),
    [false, false],
  );
});

test("failed refresh removes its in-flight entry so the same scope can retry", async (t) => {
  const fixture = await createCatalogServiceFixture({ failProducts: true });
  t.after(fixture.cleanup);
  await assert.rejects(refreshProductCatalogScope(fixture.refreshRequest, fixture.options), /产品管理/);
  fixture.setFailProducts(false);
  const result = await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(result.ok, true);
  assert.equal(fixture.repository.getRevision(), 1);
  assert.equal(result.meta.joinedInFlight, false);
});

test("live explicit empty optional fields clear old values instead of merging stale values", async (t) => {
  const fixture = await createCatalogServiceFixture({ seededSupplier: "旧工厂", liveSupplier: "" });
  t.after(fixture.cleanup);
  await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(fixture.repository.readProductsByInternalSkuKeys([fixture.internalSkuKey])[0].supplier, "");
});

test("Listing shared XLSX fills only an API Listing that lacks internal SKU", async (t) => {
  const fixture = await createCatalogServiceFixture({
    listingRecords: [liveListing("A", {
      internalSku: "",
      productId: "api-product-1",
      asin: "api-asin-1",
    })],
    productRecords: [liveProduct("X", { productId: "" })],
    listingSharedCatalogRecords: [{
      sid: 8708,
      seller_sku: "A",
      local_sku: "X",
      product_id: "xlsx-product-1",
      sku_identifier: "xlsx-sku-id-1",
      asin: "xlsx-asin-1",
      store_name: "历史店铺别名",
    }],
  });
  t.after(fixture.cleanup);
  const result = await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(result.records[0].internalSku, "X");
  assert.equal(result.records[0].listing.asin, "api-asin-1");
  assert.equal(result.records[0].listing.productId, "api-product-1");
  assert.equal(result.records[0].listing.listingSku, "X");
  assert.equal(result.records[0].listing.source, "listing-shared-xlsx");
  assert.equal(result.meta.listingSharedXlsxCount, 1);
  assert.equal(fixture.repository.getRevision(), 1);
});

test("unresolved Listing returns 422 before product fetch and does not log raw input", async (t) => {
  const fixture = await createCatalogServiceFixture({ listingRecords: [], captureLogs: true });
  t.after(fixture.cleanup);
  await assert.rejects(
    refreshProductCatalogScope(fixture.refreshRequest, fixture.options),
    (error) => error.statusCode === 422 && Boolean(error.details?.requestId),
  );
  assert.equal(fixture.productCalls, 0);
  assert.doesNotMatch(fixture.logText(), /token|raw-secret/);
});

test("missing product returns 422 and alias conflict returns 409 without committing", async (t) => {
  const missing = await createCatalogServiceFixture({ productRecords: [] });
  t.after(missing.cleanup);
  await assert.rejects(
    refreshProductCatalogScope(missing.refreshRequest, missing.options),
    (error) => error.statusCode === 422,
  );
  assert.equal(missing.repository.getRevision(), 0);

  const conflict = await createCatalogServiceFixture({
    seeded: true,
    listingRecords: [liveListing("A", { internalSku: "NEW", productId: "101" })],
    productRecords: [liveProduct("NEW", { productId: "101" })],
  });
  t.after(conflict.cleanup);
  const seedRevision = conflict.repository.getRevision();
  await assert.rejects(
    refreshProductCatalogScope(conflict.refreshRequest, conflict.options),
    (error) => error.statusCode === 409
      && error.name === "ProductCatalogConflictError"
      && Boolean(error.details?.requestId)
      && Number(error.details?.conflictCount) >= 1,
  );
  assert.equal(conflict.repository.getRevision(), seedRevision);
});

test("repository read errors normalize to redacted status 503 with request-scoped error logs", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  const repository = {
    ...fixture.repository,
    readScope() {
      throw Object.assign(new Error("repository read unavailable at /tmp/private.sqlite"), {
        code: "SQLITE_IOERR",
      });
    },
  };
  await assert.rejects(
    getProductCatalogForRows(fixture.rows, {
      ...fixture.options,
      repository,
      requestId: "req-read-normalization",
    }),
    (error) => error.statusCode === 503
      && error.details?.requestId === "req-read-normalization",
  );
  const errorLog = fixture.logEntries
    .filter(([prefix]) => prefix === "[product-catalog-service]")
    .map(([, details]) => details)
    .find((details) => details.status === "error");
  assert.equal(errorLog.statusCode, 503);
  assert.equal(errorLog.requestId, "req-read-normalization");
  assert.equal(errorLog.errorName, "ProductCatalogDatabaseError");
  assert.equal(errorLog.errorCode, "SQLITE_IOERR");
  assert.equal(errorLog.errorMessage, "商品目录数据库不可用。");
  assert.doesNotMatch(JSON.stringify(errorLog), /private\.sqlite|repository read unavailable/);
});

test("revision errors normalize to redacted status 503 and are logged through the shared request context", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  const repository = {
    ...fixture.repository,
    getRevision() {
      throw Object.assign(new Error("revision unavailable"), { code: "SQLITE_BUSY" });
    },
  };
  await assert.rejects(
    Promise.resolve().then(() => getProductCatalogRevision({
      ...fixture.options,
      repository,
      requestId: "req-revision-normalization",
    })),
    (error) => error.statusCode === 503
      && error.details?.requestId === "req-revision-normalization",
  );
  const errorLog = fixture.logEntries
    .filter(([prefix]) => prefix === "[product-catalog-service]")
    .map(([, details]) => details)
    .find((details) => details.status === "error");
  assert.equal(errorLog.statusCode, 503);
  assert.equal(errorLog.requestId, "req-revision-normalization");
  assert.equal(errorLog.operation, "get-revision");
  assert.equal(errorLog.errorCode, "SQLITE_BUSY");
  assert.equal(errorLog.errorMessage, "商品目录数据库不可用。");
});

test("database migration failures normalize to 503 instead of upstream 502", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  const failure = Object.assign(new Error("database locked at /tmp/private.sqlite"), {
    code: "SQLITE_BUSY",
  });
  await assert.rejects(
    getProductCatalogForRows(fixture.rows, {
      ...fixture.options,
      requestId: "req-migration-db",
      migrateLegacyProductCatalog: async () => { throw failure; },
    }),
    (error) => error.statusCode === 503
      && error.details?.requestId === "req-migration-db"
      && error.details?.operation === "legacy-migration"
      && error.details?.code === "SQLITE_BUSY",
  );
});

test("revision repository bootstrap failures normalize to a redacted 503 operation", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-revision-bootstrap-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    Promise.resolve().then(() => getProductCatalogRevision({
      databasePath: directory,
      requestId: "revision-bootstrap-request",
    })),
    (error) => error.statusCode === 503
      && error.name === "ProductCatalogDatabaseError"
      && error.details?.operation === "repository-bootstrap"
      && error.details?.requestId === "revision-bootstrap-request"
      && (!error.details?.code || /^[A-Za-z0-9_.:-]{1,64}$/u.test(error.details.code))
      && !JSON.stringify(error.details).includes(directory),
  );
});

test("revision schema checksum failures normalize to a redacted repository bootstrap 503", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-revision-schema-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const seedRepository = createProductCatalogRepository({ databasePath, now: () => NOW });
  seedRepository.close();
  const database = new Database(databasePath);
  database.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("wrong-checksum");
  database.close();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    Promise.resolve().then(() => getProductCatalogRevision({
      databasePath,
      requestId: "revision-schema-request",
    })),
    (error) => error.statusCode === 503
      && error.name === "ProductCatalogDatabaseError"
      && error.details?.operation === "repository-bootstrap"
      && error.details?.requestId === "revision-schema-request"
      && (!error.details?.code || /^[A-Za-z0-9_.:-]{1,64}$/u.test(error.details.code))
      && !JSON.stringify(error).includes("wrong-checksum"),
  );
});

test("adapter construction errors fail closed as generic 500 instead of database 503", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  const options = { ...fixture.options };
  Object.defineProperty(options, "adapter", {
    configurable: true,
    get() {
      throw new Error("adapter construction failed");
    },
  });
  await assert.rejects(
    getProductCatalogForRows(fixture.rows, options),
    (error) => error.statusCode === 500
      && error.name === "Error"
      && error.message === "商品目录操作失败。"
      && Boolean(error.details?.requestId),
  );
});

test("malicious request IDs and upstream messages are fail-closed in error details and logs", async (t) => {
  const fixture = await createCatalogServiceFixture();
  t.after(fixture.cleanup);
  const repository = {
    ...fixture.repository,
    getRevision() {
      throw new ProductCatalogUpstreamError("token raw-secret payload body");
    },
  };
  const maliciousRequestId = "token raw-secret payload body";
  let failure;
  await assert.rejects(
    Promise.resolve().then(() => getProductCatalogRevision({
      ...fixture.options,
      repository,
      requestId: maliciousRequestId,
    })),
    (error) => {
      failure = error;
      return error.statusCode === 502
        && !String(error.details?.requestId).match(/token|raw-secret|payload|body/i)
        && !JSON.stringify(error.details).match(/token|raw-secret|payload|body/i);
    },
  );
  const errorLog = fixture.logEntries
    .filter(([prefix]) => prefix === "[product-catalog-service]")
    .map(([, details]) => details)
    .find((details) => details.status === "error");
  assert.ok(errorLog);
  assert.equal(errorLog.requestId, failure.details.requestId);
  assert.doesNotMatch(JSON.stringify(errorLog), /token|raw-secret|payload|body/i);
  assert.doesNotMatch(JSON.stringify(failure.details), /token|raw-secret|payload|body/i);
  assert.equal(errorLog.errorMessage, "商品目录上游失败。");
});

test("health accessor logs degraded database errors without raw messages", () => {
  const logs = [];
  const result = getProductCatalogHealth({
    requestId: "health-request-1",
    repository: {
      getHealth() {
        throw Object.assign(new Error("disk I/O error"), {
          code: "SQLITE_IOERR",
        });
      },
    },
    logger: { error: (...args) => logs.push(args) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "degraded");
  assert.equal(result.quickCheck, "disk I/O error");
  assert.equal(result.error, "SQLITE_IOERR");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[product-catalog-service]");
  assert.deepEqual(logs[0][1], {
    requestId: "health-request-1",
    feature: "catalog-health",
    operation: "health",
    status: "degraded",
    code: "SQLITE_IOERR",
  });
  assert.doesNotMatch(JSON.stringify(logs), /disk I\/O error|private\.sqlite/);
});

test("SKU search delegates to the reusable catalog database without upstream refresh", () => {
  const calls = [];
  const result = searchProductCatalogSkus({
    keyword: "blue",
    limit: 8,
    requestId: "certificate-sku-search-1",
    repository: {
      searchProductSkus(keyword, options) {
        calls.push({ keyword, options });
        return [{ sku: "TJ-BLUE-001", productName: "蓝色商品" }];
      },
    },
  });
  assert.deepEqual(result, [{ sku: "TJ-BLUE-001", productName: "蓝色商品" }]);
  assert.deepEqual(calls, [{ keyword: "blue", options: { limit: 8, requestId: "certificate-sku-search-1" } }]);
});

test("product-name lookup delegates exact internal SKUs to the reusable catalog database", () => {
  const calls = [];
  const result = getProductCatalogProductNames({
    skus: ["TJ001", "TJ002"],
    requestId: "certificate-product-name-1",
    repository: {
      readProductsByInternalSkuKeys(skus, options) {
        calls.push({ skus, options });
        return [
          { internalSku: "TJ001", productName: "蓝色商品" },
          { internalSku: "TJ002", productName: "红色商品" },
        ];
      },
    },
  });
  assert.deepEqual(result, [
    { sku: "TJ001", productName: "蓝色商品" },
    { sku: "TJ002", productName: "红色商品" },
  ]);
  assert.deepEqual(calls, [{ skus: ["TJ001", "TJ002"], options: { requestId: "certificate-product-name-1" } }]);
});

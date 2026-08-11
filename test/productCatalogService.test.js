import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import {
  closeProductCatalogRepositoryForTests,
  getProductCatalogForRows,
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
  storeName = "上游别名",
  country = "上游国家",
} = {}) {
  return {
    sid,
    seller_sku: msku,
    local_sku: internalSku,
    product_id: productId,
    store_name: storeName,
    country,
  };
}

function liveProduct(internalSku, {
  productId = "101",
  supplier = "新工厂",
  purchasePrice = 38,
  skuIdentifier = "sku-id-101",
} = {}) {
  return {
    sku: internalSku,
    product_id: productId,
    sku_identifier: skuIdentifier,
    product_name: "实时商品",
    supplier,
    purchase_price: purchasePrice,
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
      if (options.failProducts) throw new Error("产品管理不可用");
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
      if (options.failProducts) throw new Error("产品管理不可用");
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
    logText() { return JSON.stringify(logs); },
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
    (error) => error.statusCode === 400,
  );
  assert.equal(fixture.listingCalls, 0);
});

test("manual refresh failure leaves old rows and revision unchanged", async (t) => {
  const fixture = await createCatalogServiceFixture({ seeded: true, failProducts: true });
  t.after(fixture.cleanup);
  const before = fixture.repository.getRevision();
  await assert.rejects(
    refreshProductCatalogScope(fixture.refreshRequest, fixture.options),
    /产品管理/,
  );
  assert.equal(fixture.repository.getRevision(), before);
  assert.equal(fixture.repository.readScope(fixture.scope)[0].product.purchasePrice, 35);
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
  assert.deepEqual(
    [firstResult.meta.joinedInFlight, secondResult.meta.joinedInFlight].sort(),
    [false, true],
  );
});

test("live explicit empty optional fields clear old values instead of merging stale values", async (t) => {
  const fixture = await createCatalogServiceFixture({ seededSupplier: "旧工厂", liveSupplier: "" });
  t.after(fixture.cleanup);
  await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(fixture.repository.readProductsByInternalSkuKeys([fixture.internalSkuKey])[0].supplier, "");
});

test("Listing shared XLSX fills only an API Listing that lacks internal SKU", async (t) => {
  const fixture = await createCatalogServiceFixture({
    listingRecords: [liveListing("A", { internalSku: "" })],
    productRecords: [liveProduct("X", { productId: "x-1" })],
    listingSharedCatalogRecords: [{
      sid: 8708,
      seller_sku: "A",
      local_sku: "X",
      store_name: "历史店铺别名",
    }],
  });
  t.after(fixture.cleanup);
  const result = await refreshProductCatalogScope(fixture.refreshRequest, fixture.options);
  assert.equal(result.records[0].internalSku, "X");
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
    (error) => error.statusCode === 409,
  );
  assert.equal(conflict.repository.getRevision(), seedRevision);
});

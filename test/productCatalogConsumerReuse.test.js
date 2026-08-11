import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import { closeProductCatalogRepositoryForTests } from "../src/services/productCatalogService.js";
import {
  getSharedProductCatalogMap,
  listingMskuCatalogKey,
  productCatalogKey,
} from "../src/services/sharedDataService.js";

const NOW = 1720000000000;

function seed(repository, {
  sid = 8708,
  msku,
  internalSku = msku,
  productId = `product-${msku}`,
  storeName = "runtime-store",
  country = "美国",
  purchasePrice = 35,
} = {}) {
  const internalSkuKey = String(internalSku).toLowerCase();
  repository.upsertCatalog({
    operation: "test-seed",
    products: [{
      internalSkuKey,
      internalSku,
      productName: `商品 ${msku}`,
      imageUrl: `https://img.example.com/${String(msku).toLowerCase()}.jpg`,
      supplier: "测试工厂",
      purchasePrice,
      productId,
      skuIdentifier: `identifier-${msku}`,
      packQuantity: 0,
      declaredValue: 0,
      source: "test-seed",
      sourceUpdatedAtMs: NOW,
      refreshedAtMs: NOW,
    }],
    aliases: [
      {
        aliasType: "product_id",
        aliasKey: productId,
        aliasValue: productId,
        internalSkuKey,
        source: "test-seed",
        updatedAtMs: NOW,
      },
      {
        aliasType: "sku_identifier",
        aliasKey: `identifier-${msku}`,
        aliasValue: `identifier-${msku}`,
        internalSkuKey,
        source: "test-seed",
        updatedAtMs: NOW,
      },
    ],
    listings: [{
      sid,
      msku,
      mskuKey: String(msku).toLowerCase(),
      internalSkuKey,
      internalSku,
      listingSku: internalSku,
      asin: `ASIN-${msku}`,
      storeName,
      country,
      source: "test-seed",
      sourceUpdatedAtMs: NOW,
      refreshedAtMs: NOW,
    }],
  });
}

async function createFixture({ seededMskus = [] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-catalog-facade-test-"));
  const repository = createProductCatalogRepository({
    databasePath: path.join(directory, "product-catalog-v1.sqlite"),
    now: () => NOW,
  });
  seededMskus.forEach((msku) => seed(repository, { msku }));
  const requestedListingMskus = [];
  let listingCalls = 0;
  let productCalls = 0;
  let legacySaveCalls = 0;
  const adapter = {
    async fetchListings(params) {
      listingCalls += 1;
      const values = Array.isArray(params.search_value) ? params.search_value : [params.search_value];
      requestedListingMskus.push(values.filter(Boolean));
      return {
        data: {
          total: values.length,
          list: values.map((msku) => ({ sid: 8708, seller_sku: msku, local_sku: msku })),
        },
      };
    },
    async fetchLocalProductInfos(params) {
      productCalls += 1;
      const values = params.skus || params.sku_identifiers || params.product_ids || [];
      return {
        data: {
          rows: values.map((sku) => ({ sku, product_name: `实时 ${sku}` })),
        },
      };
    },
  };
  const options = {
    repository,
    sellers: [{ sid: 8708, name: "runtime-store", country: "美国" }],
    adapter,
    skipMigration: true,
    listingSharedCatalogRecords: [],
    readProductCatalogCache: async () => null,
    saveProductCatalogCache: async () => { legacySaveCalls += 1; },
  };
  return {
    repository,
    adapter,
    options,
    requestedListingMskus,
    get listingCalls() { return listingCalls; },
    get productCalls() { return productCalls; },
    get legacySaveCalls() { return legacySaveCalls; },
    async cleanup() {
      await closeProductCatalogRepositoryForTests();
      repository.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("different row sets reuse canonical SID+MSKU records instead of row-set JSON persistence", async (t) => {
  const fixture = await createFixture({ seededMskus: ["A"] });
  t.after(fixture.cleanup);

  await getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "A" }], fixture.options);
  await getSharedProductCatalogMap(fixture.adapter, [
    { sid: 8708, msku: "A" },
    { sid: 8708, msku: "B" },
  ], fixture.options);

  assert.deepEqual(fixture.requestedListingMskus, [["B"]]);
  assert.equal(fixture.legacySaveCalls, 0);
});

test("forceRefresh refreshes exactly the supplied scope and leaves other canonical records unchanged", async (t) => {
  const fixture = await createFixture({ seededMskus: ["A", "B"] });
  t.after(fixture.cleanup);
  const before = fixture.repository.readScope([{ sid: 8708, msku: "B" }])[0];
  await getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "A" }], {
    ...fixture.options,
    forceRefresh: true,
  });

  assert.deepEqual(fixture.requestedListingMskus, [["A"]]);
  const after = fixture.repository.readScope([{ sid: 8708, msku: "B" }])[0];
  assert.equal(after.listing.refreshedAtMs, before.listing.refreshedAtMs);
  assert.equal(after.product.refreshedAtMs, before.product.refreshedAtMs);
});

test("allowFetchMissing false never contacts Lingxing and propagates strict missing rows", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  await assert.rejects(
    getSharedProductCatalogMap(fixture.adapter, [{ sid: 8708, msku: "MISSING" }], {
      ...fixture.options,
      allowFetchMissing: false,
      strict: true,
    }),
    (error) => error.statusCode === 422,
  );
  assert.equal(fixture.listingCalls, 0);
  assert.equal(fixture.productCalls, 0);
});

test("facade builds request-local aliases from canonical records without mutating canonical rows", async (t) => {
  const fixture = await createFixture({ seededMskus: ["A"] });
  t.after(fixture.cleanup);
  const result = await getSharedProductCatalogMap(fixture.adapter, [{
    sid: 8708,
    storeName: "runtime-store",
    country: "美国",
    msku: "A",
  }], fixture.options);

  const bySidMsku = result.map.get(listingMskuCatalogKey(8708, "A"));
  assert.equal(result.map.get(productCatalogKey("A")), bySidMsku);
  assert.equal(result.map.get(productCatalogKey("product-A")), bySidMsku);
  assert.equal(result.map.get(productCatalogKey("identifier-A")), bySidMsku);
  assert.equal(bySidMsku.packQuantity, 0);
  assert.equal(bySidMsku.declaredValue, 0);
  assert.equal(Object.hasOwn(bySidMsku, "raw"), false);

  const canonical = fixture.repository.readScope([{ sid: 8708, msku: "A" }])[0];
  assert.equal(canonical.listing.storeName, "runtime-store");
  assert.equal(canonical.product.productName, "商品 A");
});

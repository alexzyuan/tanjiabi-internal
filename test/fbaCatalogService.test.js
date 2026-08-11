import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import {
  assertFbaMskuPackMatchesErp,
  fbaCatalogTestUtils,
  resolveFbaMskuFromErp,
  searchFbaMskus,
} from "../src/services/fbaCatalogService.js";

function listingPayload(rows = []) {
  return { code: 0, data: { list: rows, total: rows.length } };
}

const fbaSeller = {
  sid: 99010,
  name: "runtime-store-US",
  displayName: "Runtime US",
  country: "美国",
};

function seedFbaCatalog(repository, {
  productName = "Catalog boat v1",
  imageUrl = "https://img.example.com/v1.jpg",
  packQuantity = 6,
  boxLength = 40,
} = {}) {
  repository.upsertCatalog({
    operation: "fba-catalog-test-seed",
    products: [{
      internalSkuKey: "erp-runtime-10",
      internalSku: "ERP-RUNTIME-10",
      productName,
      imageUrl,
      packQuantity,
      boxSpec: {
        dimensions: { length: boxLength, width: 30, height: 20, unitOfMeasurement: "CM" },
        weight: { value: 8, unit: "KG" },
      },
      brand: "JOI MEW",
      material: "塑料",
      purpose: "kids toy",
      customsCode: "9503008900",
      isBattery: "否",
      unit: "套",
      source: "test-seed",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [],
    listings: [{
      sid: fbaSeller.sid,
      msku: "RUNTIME-MSKU-10",
      mskuKey: "runtime-msku-10",
      internalSkuKey: "erp-runtime-10",
      internalSku: "ERP-RUNTIME-10",
      listingSku: "ERP-RUNTIME-10",
      asin: "B0RUNTIME10",
      storeName: fbaSeller.name,
      country: fbaSeller.country,
      source: "test-seed",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
  });
}

async function createFbaCatalogFixture(t, { seeded = false, getBoxTemplate } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fba-catalog-service-test-"));
  const repository = createProductCatalogRepository({
    databasePath: path.join(directory, "product-catalog-v1.sqlite"),
    now: () => 1720000000000,
  });
  if (seeded) seedFbaCatalog(repository);
  fbaCatalogTestUtils.clearCache();
  t.after(() => {
    fbaCatalogTestUtils.clearCache();
    repository.close();
    return rm(directory, { recursive: true, force: true });
  });

  let productCalls = 0;
  let listingCalls = 0;
  const adapter = {
    async fetchListings(params) {
      listingCalls += 1;
      return listingPayload([{
        sid: fbaSeller.sid,
        seller_sku: "RUNTIME-MSKU-10",
        local_sku: "ERP-RUNTIME-10",
        asin: "B0RUNTIME10",
        title: "Runtime discovery title",
      }]);
    },
    async fetchLocalProductInfos() {
      productCalls += 1;
      return {
        data: [{
          sku: "ERP-RUNTIME-10",
          product_name: "Catalog boat live",
          image_url: "https://img.example.com/live.jpg",
          cg_box_pcs: 6,
          cg_box_length: 40,
          cg_box_width: 30,
          cg_box_height: 20,
          cg_box_weight: 8,
          brand_name: "JOI MEW",
          material: "塑料",
          purpose: "kids toy",
          customs_code: "9503008900",
          is_battery: "否",
          unit: "套",
        }],
      };
    },
  };
  const getDirectory = async () => ({ sellers: [fbaSeller] });
  const search = (options = {}) => searchFbaMskus({
    sids: [fbaSeller.sid],
    adapter,
    getDirectory,
    productCatalogRepository: repository,
    sharedCatalogOptions: { skipMigration: true },
    getBoxTemplate,
    ...options,
  });
  return {
    repository,
    adapter,
    search,
    getDirectory,
    get productCalls() { return productCalls; },
    get listingCalls() { return listingCalls; },
    inspectCacheFields: () => fbaCatalogTestUtils.inspectCacheFields(),
  };
}

test("searchFbaMskus diagnoses Listing rows that exist but are not paired to ERP product data", async () => {
  const calls = [];
  const adapter = {
    async fetchListings(params) {
      calls.push(params);
      if (params.is_pair === 1) return listingPayload([]);
      if (params.search_value?.[0] === "MD-889-382") {
        return listingPayload([{ sid: 11500, seller_sku: "MD-889-382", asin: "B0H7JGYKK3", title: "Water Table for Toddlers" }]);
      }
      return listingPayload([]);
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
    async fetchLocalProducts() {
      return { data: [] };
    },
  };

  const result = await searchFbaMskus({
    sids: [11500],
    q: "MD-889-382",
    matchMode: "exact",
    adapter,
    getDirectory: async () => ({
      sellers: [{ sid: 11500, name: "tandanbo-US", country: "美国", displayName: "坦蛋伯美国" }],
    }),
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.diagnostics.unpairedListings.length, 1);
  assert.equal(result.diagnostics.unpairedListings[0].msku, "MD-889-382");
  assert.equal(result.diagnostics.unpairedListings[0].shopName, "tandanbo-US");
  assert.match(result.diagnostics.message, /Listing.*存在/);
  assert.match(result.diagnostics.message, /未配对 ERP 产品资料/);
  assert.equal(calls.some((params) => params.is_pair === 1), true);
  assert.equal(calls.some((params) => params.is_pair === undefined), true);
});

test("searchFbaMskus resolves an omitted SID scope from the runtime seller directory", async () => {
  const calls = [];
  const adapter = {
    async fetchListings(params) {
      calls.push(params);
      return listingPayload([{
        sid: 99001,
        seller_sku: "RUNTIME-MSKU-1",
        local_sku: "RUNTIME-MSKU-1",
        asin: "B0RUNTIME01",
        title: "Runtime catalog item",
      }]);
    },
    async fetchLocalProductInfos() {
      return {
        data: [{
          sku: "RUNTIME-MSKU-1",
          cg_box_pcs: 1,
          cg_box_length: 20,
          cg_box_width: 20,
          cg_box_height: 20,
          cg_box_weight: 1,
        }],
      };
    },
    async fetchLocalProducts() {
      return { data: [] };
    },
  };

  const result = await searchFbaMskus({
    adapter,
    getDirectory: async () => ({
      sellers: [{ sid: 99001, name: "runtime-store-FR", country: "法国", displayName: "Runtime FR" }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sid, 99001);
  assert.equal(result.items[0].shopName, "runtime-store-FR");
  assert.equal(calls[0].sid, 99001);
  assert.equal(calls.some((params) => params.sid === 11500), false);
});

test("searchFbaMskus fails fast when an explicit SID is absent from the runtime directory", async () => {
  let listingCalls = 0;
  const adapter = {
    async fetchListings() {
      listingCalls += 1;
      return listingPayload([]);
    },
  };

  await assert.rejects(
    () => searchFbaMskus({
      sids: [99002],
      adapter,
      getDirectory: async () => ({ sellers: [{ sid: 99001, name: "runtime-store-FR" }] }),
    }),
    /99002.*运行时.*店铺目录/,
  );
  assert.equal(listingCalls, 0);
});

test("searchFbaMskus propagates runtime directory failures", async () => {
  const directoryError = new Error("seller directory unavailable");

  await assert.rejects(
    () => searchFbaMskus({
      adapter: {},
      getDirectory: async () => { throw directoryError; },
    }),
    (error) => error === directoryError,
  );
});

test("resolveFbaMskuFromErp uses the injected runtime directory and adapter", async () => {
  const adapter = {
    async fetchListings(params) {
      return listingPayload([{
        sid: 99003,
        seller_sku: "RUNTIME-MSKU-2",
        asin: "B0RUNTIME02",
        title: "Runtime ERP item",
        sku: "ERP-RUNTIME-2",
      }]);
    },
    async fetchLocalProductInfos() {
      return {
        data: [{
          sku: "ERP-RUNTIME-2",
          cg_box_pcs: 6,
          cg_box_length: 40,
          cg_box_width: 30,
          cg_box_height: 20,
          cg_box_weight: 8,
        }],
      };
    },
    async fetchLocalProducts() {
      return { data: [] };
    },
  };
  const getDirectory = async () => ({
    sellers: [{ sid: 99003, name: "runtime-store-DE", country: "德国" }],
  });

  const result = await resolveFbaMskuFromErp({
    sid: 99003,
    msku: "runtime-msku-2",
    adapter,
    getDirectory,
  });

  assert.equal(result.sid, 99003);
  assert.equal(result.shopName, "runtime-store-DE");
  assert.equal(result.packQuantity, 6);
  assert.equal(result.boxSource, "erp");
});

test("resolveFbaMskuFromErp fails before Listing requests for an unknown runtime SID", async () => {
  let listingCalls = 0;
  const adapter = {
    async fetchListings() {
      listingCalls += 1;
      return listingPayload([]);
    },
  };

  await assert.rejects(
    () => resolveFbaMskuFromErp({
      sid: 99004,
      msku: "RUNTIME-MSKU-4",
      adapter,
      getDirectory: async () => ({ sellers: [{ sid: 99003, name: "runtime-store-DE" }] }),
    }),
    /99004.*运行时.*店铺目录/,
  );
  assert.equal(listingCalls, 0);
});

test("assertFbaMskuPackMatchesErp forwards runtime directory dependencies", async () => {
  const adapter = {
    async fetchListings() {
      return listingPayload([{
        sid: 99005,
        seller_sku: "RUNTIME-MSKU-5",
        sku: "ERP-RUNTIME-5",
      }]);
    },
    async fetchLocalProductInfos() {
      return {
        data: [{
          sku: "ERP-RUNTIME-5",
          cg_box_pcs: 4,
          cg_box_length: 20,
          cg_box_width: 20,
          cg_box_height: 20,
          cg_box_weight: 1,
        }],
      };
    },
    async fetchLocalProducts() {
      return { data: [] };
    },
  };

  const result = await assertFbaMskuPackMatchesErp({
    sid: 99005,
    msku: "RUNTIME-MSKU-5",
    boxCount: 2,
    quantity: 8,
    adapter,
    getDirectory: async () => ({ sellers: [{ sid: 99005, name: "runtime-store-US" }] }),
  });

  assert.equal(result.packQuantity, 4);
  assert.equal(result.quantity, 8);
});

test("FBA repeats Listing discovery from a warm cache but hydrates current catalog fields", async (t) => {
  const fixture = await createFbaCatalogFixture(t);
  const first = await fixture.search();
  const second = await fixture.search();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fixture.productCalls, 1);
  assert.equal(second.items[0].packQuantity, 6);
  assert.deepEqual(second.items[0].boxDimensions, {
    length: 40,
    width: 30,
    height: 20,
    unitOfMeasurement: "CM",
  });
  assert.deepEqual(fixture.inspectCacheFields(), [
    "asin",
    "country",
    "displayName",
    "msku",
    "shopName",
    "sid",
    "title",
  ]);
});

test("FBA seeded SQLite catalog avoids product-management calls and preserves packaging", async (t) => {
  const fixture = await createFbaCatalogFixture(t, { seeded: true });
  const result = await fixture.search();

  assert.equal(result.ok, true);
  assert.equal(result.items[0].productName, "Catalog boat v1");
  assert.equal(result.items[0].packQuantity, 6);
  assert.deepEqual(result.items[0].boxDimensions, {
    length: 40,
    width: 30,
    height: 20,
    unitOfMeasurement: "CM",
  });
  assert.equal(fixture.productCalls, 0);
});

test("FBA warm Listing discovery rehydrates changed SQLite catalog fields", async (t) => {
  const fixture = await createFbaCatalogFixture(t, { seeded: true });
  const first = await fixture.search();
  seedFbaCatalog(fixture.repository, {
    productName: "Catalog boat v2",
    imageUrl: "https://img.example.com/v2.jpg",
    packQuantity: 8,
    boxLength: 55,
  });
  const second = await fixture.search();

  assert.equal(first.items[0].productName, "Catalog boat v1");
  assert.equal(second.items[0].productName, "Catalog boat v2");
  assert.equal(second.items[0].packQuantity, 8);
  assert.equal(second.items[0].boxDimensions.length, 55);
  assert.equal(fixture.productCalls, 0);
});

test("manual FBA box template overrides canonical ERP box values", async (t) => {
  const fixture = await createFbaCatalogFixture(t, {
    seeded: true,
    getBoxTemplate: async () => ({
      dimensions: { length: 99, width: 88, height: 77, unitOfMeasurement: "IN" },
      weight: { value: 12, unit: "LB" },
    }),
  });
  const result = await fixture.search();

  assert.equal(result.items[0].boxSource, "template");
  assert.deepEqual(result.items[0].boxDimensions, {
    length: 99,
    width: 88,
    height: 77,
    unitOfMeasurement: "IN",
  });
  assert.deepEqual(result.items[0].boxWeight, { value: 12, unit: "LB" });
});

test("FBA preserves canonical numeric zero/null and box units during hydration", async (t) => {
  const fixture = await createFbaCatalogFixture(t, { seeded: true });
  fixture.repository.upsertCatalog({
    operation: "fba-catalog-null-pack-test",
    products: [{
      internalSkuKey: "erp-runtime-10",
      internalSku: "ERP-RUNTIME-10",
      productName: "Catalog boat nullable pack",
      packQuantity: null,
      boxSpec: {
        dimensions: { length: 40, width: 30, height: 20, unitOfMeasurement: "IN" },
        weight: { value: 8, unit: "LB" },
      },
      source: "test-seed",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [],
    listings: [],
  });
  const result = await fixture.search();

  assert.equal(result.items[0].packQuantity, null);
  assert.equal(result.items[0].boxDimensions.unitOfMeasurement, "IN");
  assert.equal(result.items[0].boxWeight.unit, "LB");
});

test("strict FBA ERP resolution preserves an unpaired Listing diagnostic and never invents packaging", async (t) => {
  const fixture = await createFbaCatalogFixture(t);
  fixture.adapter.fetchListings = async () => listingPayload([{
    sid: fbaSeller.sid,
    seller_sku: "UNPAIRED-RUNTIME-10",
    asin: "B0UNPAIRED10",
    title: "Unpaired listing",
  }]);
  fixture.adapter.fetchLocalProductInfos = async () => {
    throw new Error("product management must not be called without Listing local_sku");
  };

  await assert.rejects(
    () => resolveFbaMskuFromErp({
      sid: fbaSeller.sid,
      msku: "UNPAIRED-RUNTIME-10",
      adapter: fixture.adapter,
      getDirectory: fixture.getDirectory,
      productCatalogRepository: fixture.repository,
      sharedCatalogOptions: { skipMigration: true },
    }),
    /商品目录|ERP Listing/,
  );
});

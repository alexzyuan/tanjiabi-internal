import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import { closeProductCatalogRepositoryForTests } from "../src/services/productCatalogService.js";
import {
  clearFbaShipmentCandidateCache,
  getFbaShipmentCandidates,
  normalizeFbaShipmentCandidateFilters,
} from "../src/services/fbaShipmentCandidateService.js";

const payload = {
  data: {
    list: [{
      sid: 8708,
      seller: "xiamentanjia-US",
      shipment_id: "FBA18QJFDCWJ",
      shipment_name: "FBA STA",
      shipment_status: "SHIPPED",
      destination_fulfillment_center_id: "TEB9",
      gmt_create: "2026-07-04 09:15",
      item_list: [{
        msku: "JM-DGC-BLUE",
        fnsku: "X004BLUE",
        sku: "TJ-DGC-BLUE",
        quantity_shipped: 18,
        quantity_in_case: 6,
      }],
    }],
  },
  total: 1,
  request_id: "shipment-request-1",
};

function makeAdapter() {
  const calls = [];
  return {
    calls,
    async fetchFbaCargoShipments(params) {
      calls.push(params);
      return payload;
    },
    async fetchListings() {
      return {
        data: {
          list: [{
            sid: 8708,
            seller_sku: "JM-DGC-BLUE",
            local_sku: "TJ-DGC-BLUE",
          }],
        },
      };
    },
    async fetchLocalProductInfos() {
      return {
        data: [{
          sku: "TJ-DGC-BLUE",
          product_name: "灯光船蓝色",
        }],
      };
    },
  };
}

function seedCatalog(repository, {
  sid = 8708,
  msku = "JM-DGC-BLUE",
  internalSku = "TJ-DGC-BLUE",
} = {}) {
  const internalSkuKey = internalSku.toLowerCase();
  repository.upsertCatalog({
    operation: "fba-candidate-test-seed",
    products: [{
      internalSkuKey,
      internalSku,
      productName: "灯光船蓝色",
      imageUrl: "https://img.example.com/blue.jpg",
      source: "test-seed",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
    aliases: [],
    listings: [{
      sid,
      msku,
      mskuKey: msku.toLowerCase(),
      internalSkuKey,
      internalSku,
      listingSku: internalSku,
      storeName: "xiamentanjia-US",
      country: "美国",
      source: "test-seed",
      sourceUpdatedAtMs: 1720000000000,
      refreshedAtMs: 1720000000000,
    }],
  });
}

test("normalizeFbaShipmentCandidateFilters keeps existing freight filter names compatible", () => {
  const filters = normalizeFbaShipmentCandidateFilters({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
    shipmentId: "FBA18QJFDCWJ",
    shipmentStatus: "SHIPPED",
  });

  assert.equal(filters.startDate, "2026-07-01");
  assert.equal(filters.endDate, "2026-07-11");
  assert.deepEqual(filters.sids, [8708]);
  assert.equal(filters.shipmentId, "FBA18QJFDCWJ");
  assert.equal(filters.shipmentStatus, "SHIPPED");
});

test("normalizeFbaShipmentCandidateFilters leaves seller scope empty until the runtime directory is resolved", () => {
  const filters = normalizeFbaShipmentCandidateFilters({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
  });

  assert.deepEqual(filters.sids, []);
});

test("getFbaShipmentCandidates rejects an explicitly selected SID outside the runtime directory", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();

  await assert.rejects(
    () => getFbaShipmentCandidates({ sid: "17307" }, {
      adapter,
      sellers: [{ sid: 8708, name: "xiamentanjia-US" }],
    }),
    /17307/,
  );
  assert.equal(adapter.calls.length, 0);
});

test("getFbaShipmentCandidates resolves an omitted SID scope from the injected runtime directory", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const directoryCalls = [];

  const result = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
  }, {
    adapter,
    getDirectory: async ({ adapter: directoryAdapter }) => {
      directoryCalls.push(directoryAdapter);
      return { sellers: [{ sid: 8708, name: "xiamentanjia-US", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }] };
    },
  });

  assert.equal(directoryCalls[0], adapter);
  assert.deepEqual(result.filters.sids, [8708]);
  assert.equal(adapter.calls[0].sid, "8708");
  assert.equal(result.rows[0].sellerId, "A1SELLERUS");
});

test("getFbaShipmentCandidates rejects an API row whose SID is absent from the runtime directory", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  adapter.fetchFbaCargoShipments = async () => ({
    ...payload,
    data: { list: [{ ...payload.data.list[0], sid: 17307 }] },
  });

  await assert.rejects(
    () => getFbaShipmentCandidates({ sid: "8708" }, {
      adapter,
      sellers: [{ sid: 8708, name: "xiamentanjia-US" }],
    }),
    /17307/,
  );
});

test("getFbaShipmentCandidates caches identical Lingxing shipment queries", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const sellers = [{
    sid: 8708,
    name: "xiamentanjia-US",
    seller_id: "A1SELLERUS",
    marketplace_id: "ATVPDKIKX0DER",
    country: "美国",
  }];

  const first = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
  }, { adapter, sellers });
  const second = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
  }, { adapter, sellers });

  assert.equal(adapter.calls.length, 1);
  assert.equal(second.cache.hit, true);
  assert.equal(first.rows[0].sellerId, "A1SELLERUS");
  assert.equal(first.rows[0].marketplaceId, "ATVPDKIKX0DER");
  assert.equal(first.rows[0].items[0].fnsku, "X004BLUE");
});

test("getFbaShipmentCandidates forceRefresh bypasses cache", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }];

  await getFbaShipmentCandidates({ startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" }, { adapter, sellers });
  await getFbaShipmentCandidates({ startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708", forceRefresh: true }, { adapter, sellers });

  assert.equal(adapter.calls.length, 2);
});

test("getFbaShipmentCandidates refreshes cached rows when the product catalog is forced", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }];
  const filters = { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" };

  await getFbaShipmentCandidates(filters, { adapter, sellers });
  const refreshed = await getFbaShipmentCandidates(filters, {
    adapter,
    sellers,
    productCatalogRequired: true,
    forceProductCatalogRefresh: true,
  });

  assert.equal(adapter.calls.length, 2);
  assert.equal(refreshed.cache.hit, false);
});

test("getFbaShipmentCandidates reuses a seeded SQLite catalog without Listing or product calls", async (t) => {
  clearFbaShipmentCandidateCache();
  const directory = await mkdtemp(path.join(os.tmpdir(), "fba-candidate-catalog-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const repository = createProductCatalogRepository({ databasePath, now: () => 1720000000000 });
  seedCatalog(repository);
  repository.close();
  const previousDatabasePath = process.env.PRODUCT_CATALOG_DATABASE_PATH;
  process.env.PRODUCT_CATALOG_DATABASE_PATH = databasePath;
  await closeProductCatalogRepositoryForTests();
  t.after(async () => {
    await closeProductCatalogRepositoryForTests();
    if (previousDatabasePath === undefined) delete process.env.PRODUCT_CATALOG_DATABASE_PATH;
    else process.env.PRODUCT_CATALOG_DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  });

  let listingCalls = 0;
  let productCalls = 0;
  const adapter = {
    async fetchFbaCargoShipments() { return payload; },
    async fetchListings() {
      listingCalls += 1;
      throw new Error("seeded catalog should avoid Listing");
    },
    async fetchLocalProductInfos() {
      productCalls += 1;
      throw new Error("seeded catalog should avoid product management");
    },
  };
  const result = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
  }, {
    adapter,
    sellers: [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
    productCatalogRequired: true,
  });

  assert.equal(result.rows[0].items[0].internalSku, "TJ-DGC-BLUE");
  assert.equal(listingCalls, 0);
  assert.equal(productCalls, 0);
});

test("getFbaShipmentCandidates passes the resolved custom runtime directory to the catalog facade", async (t) => {
  clearFbaShipmentCandidateCache();
  const directory = await mkdtemp(path.join(os.tmpdir(), "fba-candidate-custom-sid-test-"));
  const databasePath = path.join(directory, "product-catalog-v1.sqlite");
  const repository = createProductCatalogRepository({ databasePath, now: () => 1720000000000 });
  seedCatalog(repository, { sid: 99123, msku: "CUSTOM-MSKU", internalSku: "CUSTOM-SKU" });
  t.after(async () => {
    clearFbaShipmentCandidateCache();
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  let listingCalls = 0;
  let productCalls = 0;
  const adapter = {
    async fetchFbaCargoShipments() {
      return {
        data: {
          list: [{
            ...payload.data.list[0],
            sid: 99123,
            seller: "runtime-custom-store",
            item_list: [{ ...payload.data.list[0].item_list[0], msku: "CUSTOM-MSKU", sku: "CUSTOM-SKU" }],
          }],
        },
        total: 1,
      };
    },
    async fetchListings() {
      listingCalls += 1;
      throw new Error("seeded catalog should avoid Listing");
    },
    async fetchLocalProductInfos() {
      productCalls += 1;
      throw new Error("seeded catalog should avoid product management");
    },
  };
  const result = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "99123",
  }, {
    adapter,
    getDirectory: async () => ({ sellers: [
      { sid: 8708, name: "xiamentanjia-US", country: "美国" },
      { sid: 99123, name: "runtime-custom-store", country: "美国" },
    ] }),
    productCatalogRequired: true,
    productCatalogRepository: repository,
  });

  assert.equal(result.rows[0].items[0].internalSku, "CUSTOM-SKU");
  assert.equal(listingCalls, 0);
  assert.equal(productCalls, 0);
});

test("getFbaShipmentCandidates joins concurrent refreshes for the same key", async () => {
  clearFbaShipmentCandidateCache();
  let releaseShipments;
  let shipmentFetchStarted;
  const shipmentFetchStartedPromise = new Promise((resolve) => {
    shipmentFetchStarted = resolve;
  });
  const adapter = {
    calls: [],
    async fetchFbaCargoShipments(params) {
      this.calls.push(params);
      shipmentFetchStarted();
      await new Promise((resolve) => {
        releaseShipments = resolve;
      });
      return payload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };
  const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }];
  const filters = { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708", forceRefresh: true };

  const first = getFbaShipmentCandidates(filters, { adapter, sellers });
  await shipmentFetchStartedPromise;
  const second = getFbaShipmentCandidates(filters, { adapter, sellers });

  assert.equal(adapter.calls.length, 1);
  releaseShipments();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.rows.length, 1);
  assert.equal(secondResult.rows.length, 1);
  assert.equal(secondResult.cache.hit, false);
});

test("getFbaShipmentCandidates reloads stale cache when runtime seller mappings are required", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return payload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };
  const filters = { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" };

  const stale = await getFbaShipmentCandidates(filters, {
    adapter,
    getDirectory: async () => ({ sellers: [{ sid: 8708 }] }),
  });
  const mapped = await getFbaShipmentCandidates(filters, {
    adapter,
    getDirectory: async () => ({ sellers: [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }] }),
    forceProductCatalogRefresh: true,
  });

  assert.equal(stale.rows[0].sellerId, "");
  assert.equal(mapped.cache.hit, false);
  assert.equal(mapped.rows[0].sellerId, "A1SELLERUS");
  assert.equal(mapped.rows[0].marketplaceId, "ATVPDKIKX0DER");
  assert.deepEqual(events, ["fetch-shipments", "fetch-shipments"]);
});

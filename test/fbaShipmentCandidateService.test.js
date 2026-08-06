import assert from "node:assert/strict";
import test from "node:test";
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
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };
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

test("getFbaShipmentCandidates reloads stale cache when seller mappings are required", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return payload;
    },
    async fetchSellers() {
      events.push("fetch-sellers");
      return { data: [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }] };
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };
  const filters = { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" };

  const stale = await getFbaShipmentCandidates(filters, { adapter });
  const mapped = await getFbaShipmentCandidates(filters, { adapter, autoLoadSellerMappings: true });

  assert.equal(stale.rows[0].sellerId, "");
  assert.equal(mapped.cache.hit, false);
  assert.equal(mapped.rows[0].sellerId, "A1SELLERUS");
  assert.equal(mapped.rows[0].marketplaceId, "ATVPDKIKX0DER");
  assert.deepEqual(events, ["fetch-shipments", "fetch-shipments", "fetch-sellers"]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchLingxingListingRecords,
  fetchLingxingListingsBySidMskus,
  fetchLingxingProductRecords,
} from "../src/services/lingxingCatalogLookupService.js";
import { createPerformanceMetrics } from "../src/utils/performanceMetrics.js";

test("fetchLingxingListingRecords follows Lingxing offset pagination", async () => {
  const calls = [];
  const adapter = {
    async fetchListings(params) {
      calls.push(params);
      if (params.offset === 0) {
        return {
          data: {
            total: 3,
            list: [{ seller_sku: "A" }, { seller_sku: "B" }],
          },
        };
      }
      return {
        data: {
          total: 3,
          list: [{ seller_sku: "C" }],
        },
      };
    },
  };

  const records = await fetchLingxingListingRecords(adapter, { sid: 8708 }, { pageSize: 2 });

  assert.deepEqual(records.map((row) => row.seller_sku), ["A", "B", "C"]);
  assert.deepEqual(calls.map((call) => ({ offset: call.offset, length: call.length, sid: call.sid })), [
    { offset: 0, length: 2, sid: 8708 },
    { offset: 2, length: 2, sid: 8708 },
  ]);
});

test("fetchLingxingListingRecords fails when the declared total exceeds the scan limit", async () => {
  const adapter = {
    async fetchListings({ offset }) {
      return {
        data: {
          total: 3,
          list: [{ seller_sku: `MSKU-${offset}` }],
        },
      };
    },
  };

  await assert.rejects(
    fetchLingxingListingRecords(adapter, { sid: 8708 }, { pageSize: 1, maxOffset: 2 }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE"
      && error.details?.declaredTotal === 3
      && error.details?.rowCount === 2
      && error.details?.maxOffset === 2,
  );
});

test("fetchLingxingListingRecords rejects a total that changes across pages", async () => {
  const adapter = {
    async fetchListings({ offset }) {
      return {
        data: {
          total: offset === 0 ? 3 : 2,
          list: [{ seller_sku: `MSKU-${offset}` }],
        },
      };
    },
  };

  await assert.rejects(
    fetchLingxingListingRecords(adapter, { sid: 8708 }, { pageSize: 1, requireTotal: true }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE"
      && error.details?.reason === "total-changed"
      && error.details?.declaredTotal === 3,
  );
});

test("fetchLingxingListingsBySidMskus tries supported SID variants and fuzzy fallback", async () => {
  const calls = [];
  const adapter = {
    async fetchListings(params) {
      calls.push(params);
      if (params.seller_id === 8708 && params.exact_search === 0) {
        return { data: { total: 1, list: [{ seller_sku: "JM-DGC-BLUE", seller_id: 8708 }] } };
      }
      return { data: { total: 0, list: [] } };
    },
  };

  const records = await fetchLingxingListingsBySidMskus(adapter, 8708, ["JM-DGC-BLUE"], { batchSize: 50 });

  assert.equal(records.length, 1);
  assert.equal(records[0].seller_sku, "JM-DGC-BLUE");
  assert.deepEqual(calls.map((call) => ({
    sid: call.sid,
    sids: call.sids,
    seller_id: call.seller_id,
    sellerId: call.sellerId,
    exact_search: call.exact_search,
  })), [
    { sid: 8708, sids: undefined, seller_id: undefined, sellerId: undefined, exact_search: 1 },
    { sid: 8708, sids: undefined, seller_id: undefined, sellerId: undefined, exact_search: 0 },
    { sid: undefined, sids: [8708], seller_id: undefined, sellerId: undefined, exact_search: 1 },
    { sid: undefined, sids: [8708], seller_id: undefined, sellerId: undefined, exact_search: 0 },
    { sid: undefined, sids: undefined, seller_id: 8708, sellerId: undefined, exact_search: 1 },
    { sid: undefined, sids: undefined, seller_id: 8708, sellerId: undefined, exact_search: 0 },
  ]);
});

test("fetchLingxingListingsBySidMskus falls back to single MSKU queries for mixed batches", async () => {
  const searchedValues = [];
  const adapter = {
    async fetchListings(params) {
      searchedValues.push(params.search_value);
      if (Array.isArray(params.search_value) && params.search_value.length === 1 && params.search_value[0] === "B") {
        return { data: { total: 1, list: [{ seller_sku: "B" }] } };
      }
      return { data: { total: 0, list: [] } };
    },
  };

  const records = await fetchLingxingListingsBySidMskus(adapter, 8708, ["A", "B"], { sidVariants: [{ sid: 8708 }] });

  assert.deepEqual(records.map((row) => row.seller_sku), ["B"]);
  assert.deepEqual(searchedValues, [["A", "B"], ["A", "B"], ["A"], ["B"]]);
});

test("fetchLingxingListingsBySidMskus can include deleted listings for historical inventory", async () => {
  const calls = [];
  const adapter = {
    async fetchListings(params) {
      calls.push(params);
      if (!Object.hasOwn(params, "is_delete")) {
        return { data: { total: 1, list: [{ seller_sku: "JM-XSL-SP", local_sku: "TJ018", is_delete: 1 }] } };
      }
      return { data: { total: 0, list: [] } };
    },
  };

  const records = await fetchLingxingListingsBySidMskus(adapter, 8708, ["JM-XSL-SP"], {
    includeDeletedListings: true,
    sidVariants: [{ sid: 8708 }],
  });

  assert.deepEqual(records, [{ seller_sku: "JM-XSL-SP", local_sku: "TJ018", is_delete: 1 }]);
  assert.equal(calls[0].is_delete, undefined);
  assert.equal(Object.hasOwn(calls[0], "is_delete"), false);
});

test("fetchLingxingProductRecords uses local product fallback and strict errors", async () => {
  const calls = [];
  const adapter = {
    async fetchLocalProductInfos(params) {
      calls.push(["infos", params]);
      throw new Error("new api unavailable");
    },
    async fetchLocalProducts(params) {
      calls.push(["fallback", params]);
      return { data: { rows: [{ sku: "TJ001" }] } };
    },
  };

  const records = await fetchLingxingProductRecords(adapter, { skus: ["TJ001"] }, { sku_list: ["TJ001"] });

  assert.deepEqual(records, [{ sku: "TJ001" }]);
  assert.deepEqual(calls, [
    ["infos", { skus: ["TJ001"] }],
    ["fallback", { sku_list: ["TJ001"] }],
  ]);

  await assert.rejects(
    fetchLingxingProductRecords({
      async fetchLocalProductInfos() {
        throw new Error("new failed");
      },
      async fetchLocalProducts() {
        throw new Error("old failed");
      },
    }, { skus: ["TJ002"] }, { sku_list: ["TJ002"] }, { strict: true }),
    /ERP 产品管理查询失败：new failed; fallback: old failed/,
  );
});

test("Lingxing catalog lookup records request counters when metrics are provided", async () => {
  const metrics = createPerformanceMetrics("catalog-test", { now: () => 100 });
  const adapter = {
    async fetchListings() {
      return { data: { total: 0, list: [] } };
    },
    async fetchLocalProductInfos() {
      throw new Error("new api unavailable");
    },
    async fetchLocalProducts() {
      return { data: { rows: [{ sku: "TJ001" }] } };
    },
  };

  await fetchLingxingListingsBySidMskus(adapter, 8708, ["A"], {
    sidVariants: [{ sid: 8708 }],
    metrics,
  });
  await fetchLingxingProductRecords(adapter, { skus: ["TJ001"] }, { sku_list: ["TJ001"] }, { metrics });

  assert.deepEqual(metrics.summary().counters, {
    lingxingListingRequests: 2,
    lingxingProductInfoRequests: 1,
    lingxingProductFallbackRequests: 1,
  });
});

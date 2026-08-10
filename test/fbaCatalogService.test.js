import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFbaMskuPackMatchesErp,
  resolveFbaMskuFromErp,
  searchFbaMskus,
} from "../src/services/fbaCatalogService.js";

function listingPayload(rows = []) {
  return { code: 0, data: { list: rows, total: rows.length } };
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

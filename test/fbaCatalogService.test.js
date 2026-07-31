import assert from "node:assert/strict";
import test from "node:test";

import { searchFbaMskus } from "../src/services/fbaCatalogService.js";

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

  const result = await searchFbaMskus({ sids: [11500], q: "MD-889-382", matchMode: "exact", adapter });

  assert.equal(result.items.length, 0);
  assert.equal(result.diagnostics.unpairedListings.length, 1);
  assert.equal(result.diagnostics.unpairedListings[0].msku, "MD-889-382");
  assert.equal(result.diagnostics.unpairedListings[0].shopName, "tandanbo-US");
  assert.match(result.diagnostics.message, /Listing.*存在/);
  assert.match(result.diagnostics.message, /未配对 ERP 产品资料/);
  assert.equal(calls.some((params) => params.is_pair === 1), true);
  assert.equal(calls.some((params) => params.is_pair === undefined), true);
});

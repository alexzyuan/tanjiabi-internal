import assert from "node:assert/strict";
import test from "node:test";
import {
  SellerDirectoryUnavailableError,
  getSellerDirectory,
  normalizeSellerRecord,
  normalizeSellerRecords,
} from "../src/services/sellerDirectoryService.js";

test("normalizeSellerRecord accepts common aliases and preserves the source record", () => {
  const raw = {
    seller_id: "8708",
    seller_name: "xiamentanjia-US",
    country_name: "美国",
    country_code: "us",
    display_name: "探嘉美国",
    seller_id_amazon: "A1SELLER",
    marketplace_id: "ATVPDKIKX0DER",
    mid: "MID-US",
    status: 1,
  };

  assert.deepEqual(normalizeSellerRecord(raw), {
    sid: 8708,
    name: "xiamentanjia-US",
    country: "美国",
    countryCode: "US",
    displayName: "探嘉美国",
    sellerId: "A1SELLER",
    marketplaceId: "ATVPDKIKX0DER",
    mid: "MID-US",
    status: 1,
    raw,
  });
});

test("normalizeSellerRecords finds nested seller payloads and keeps the last record for a SID", () => {
  const payload = {
    data: {
      list: [
        { sid: "8708", name: "old-name", country: "美国" },
        { seller: { sellerId: "8709", shopName: "探嘉加拿大", countryCode: "CA" } },
        { sid: 8708, name: "new-name", country: "美国", displayName: "新名称" },
      ],
    },
  };

  assert.deepEqual(normalizeSellerRecords(payload).map(({ sid, name, displayName }) => ({ sid, name, displayName })), [
    { sid: 8708, name: "new-name", displayName: "新名称" },
    { sid: 8709, name: "探嘉加拿大", displayName: "探嘉加拿大" },
  ]);
});

test("normalizeSellerRecord rejects records without a positive numeric SID or name", () => {
  assert.equal(normalizeSellerRecord({ name: "missing sid" }), null);
  assert.equal(normalizeSellerRecord({ sid: "not-a-number", name: "bad sid" }), null);
  assert.equal(normalizeSellerRecord({ sid: 1, name: "   " }), null);
});

test("getSellerDirectory returns a cached directory without calling the API", async () => {
  let apiCalls = 0;
  const logs = [];
  const result = await getSellerDirectory({
    readCache: async () => ({
      updatedAt: "2026-08-10 09:00:00",
      sellers: [{ sid: "8708", name: "xiamentanjia-US", countryCode: "US" }],
    }),
    adapter: {
      async fetchSellers() {
        apiCalls += 1;
        throw new Error("API should not be called on a cache hit");
      },
    },
    logger: { info(...args) { logs.push(args); } },
  });

  assert.equal(apiCalls, 0);
  assert.deepEqual(result.meta, {
    source: "lingxing-sellers-cache",
    cacheHit: true,
    sellerCount: 1,
    updatedAt: "2026-08-10 09:00:00",
  });
  assert.equal(logs[0][0], "[seller-directory]");
  assert.deepEqual(Object.keys(logs[0][1]).sort(), ["cacheHit", "endpoint", "sellerCount", "source"]);
});

test("getSellerDirectory normalizes a nested API response and saves only valid sellers", async () => {
  let saved;
  const result = await getSellerDirectory({
    readCache: async () => ({ sellers: [] }),
    adapter: {
      async fetchSellers() {
        return {
          data: {
            records: [
              { seller: { id: "8708", name: "xiamentanjia-US", country_code: "US" } },
              { sid: "not-valid", name: "discard me" },
            ],
          },
        };
      },
    },
    saveCache: async (sellers) => { saved = sellers; },
    nowText: () => "2026-08-10 10:00:00",
    logger: { info() {} },
  });

  assert.equal(result.sellers.length, 1);
  assert.equal(result.sellers[0].sid, 8708);
  assert.deepEqual(result.meta, {
    source: "lingxing-api",
    cacheHit: false,
    sellerCount: 1,
    updatedAt: "2026-08-10 10:00:00",
  });
  assert.deepEqual(saved, result.sellers);
});

test("getSellerDirectory propagates API errors instead of returning an empty directory", async () => {
  const apiError = new Error("Lingxing unavailable");
  await assert.rejects(
    () => getSellerDirectory({
      readCache: async () => ({ sellers: [] }),
      adapter: { async fetchSellers() { throw apiError; } },
      logger: { error() {} },
    }),
    (error) => error === apiError,
  );
});

test("getSellerDirectory raises an explicit error when the API returns no valid sellers", async () => {
  await assert.rejects(
    () => getSellerDirectory({
      readCache: async () => ({ sellers: [] }),
      adapter: { async fetchSellers() { return { data: [] }; } },
      logger: { error() {} },
    }),
    (error) => error instanceof SellerDirectoryUnavailableError && /空店铺列表/.test(error.message),
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCoreSellers,
  getLingxingAdapter,
  LingxingAdapter,
  resetLingxingAdapterForTest,
} from "../src/adapters/lingxingAdapter.js";

const lingxingTestConfig = {
  baseUrl: "https://openapi.test/",
  appKey: "1234567890abcdef",
  appSecret: "secret",
};

function jsonResponse(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return payload;
    },
  };
}

test("filterCoreSellers includes JOI MEW Germany stores", () => {
  const sellers = filterCoreSellers([
    { name: "JOI MEW-US", country: "美国", countryCode: "US" },
    { name: "JOI MEW-DE", country: "德国", countryCode: "DE" },
    { name: "Other-JP", country: "日本", countryCode: "JP" },
  ]);

  assert.deepEqual(sellers.map((seller) => seller.name), ["JOI MEW-US", "JOI MEW-DE"]);
});

test("LingxingAdapter shares one OAuth token request across adapter instances", async () => {
  resetLingxingAdapterForTest();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    calls.push(pathname);
    if (pathname === "/api/auth-server/oauth/access-token") {
      return jsonResponse({
        code: "200",
        data: {
          access_token: "shared-access-token",
          refresh_token: "shared-refresh-token",
          expires_in: 3600,
        },
      });
    }
    return jsonResponse({ code: 0, data: [{ sid: 1, name: "JOI MEW-US" }] });
  };

  try {
    const adapters = Array.from({ length: 5 }, () => new LingxingAdapter(lingxingTestConfig));
    await Promise.all(adapters.map((adapter) => adapter.fetchSellers()));

    assert.equal(calls.filter((path) => path === "/api/auth-server/oauth/access-token").length, 1);
    assert.equal(calls.filter((path) => path === "/erp/sc/data/seller/lists").length, 5);
  } finally {
    globalThis.fetch = originalFetch;
    resetLingxingAdapterForTest();
  }
});

test("LingxingAdapter reuses one OAuth token across different Lingxing endpoints", async () => {
  resetLingxingAdapterForTest();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    calls.push(pathname);
    if (pathname === "/api/auth-server/oauth/access-token") {
      return jsonResponse({
        code: "200",
        data: {
          access_token: "multi-endpoint-token",
          refresh_token: "multi-endpoint-refresh",
          expires_in: 3600,
        },
      });
    }
    return jsonResponse({ code: 0, data: { records: [], total: 0 } });
  };

  try {
    const adapter = getLingxingAdapter(lingxingTestConfig);
    await adapter.fetchSellers();
    await adapter.fetchListings();
    await adapter.fetchOrders();
    await adapter.fetchFbaInventoryDetails();
    await adapter.fetchPayablePurchasePool();

    assert.equal(calls.filter((path) => path === "/api/auth-server/oauth/access-token").length, 1);
    assert.equal(new Set(calls.filter((path) => path !== "/api/auth-server/oauth/access-token")).size, 5);
  } finally {
    globalThis.fetch = originalFetch;
    resetLingxingAdapterForTest();
  }
});

test("LingxingAdapter refreshes an invalid token and retries the signed request once", async () => {
  resetLingxingAdapterForTest();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    calls.push({
      pathname: parsed.pathname,
      accessToken: parsed.searchParams.get("access_token"),
    });
    if (parsed.pathname === "/erp/sc/data/seller/lists" && calls.filter((item) => item.pathname === parsed.pathname).length === 1) {
      return jsonResponse({ code: 401, msg: "access_token 已失效" }, { ok: true });
    }
    if (parsed.pathname === "/api/auth-server/oauth/refresh") {
      return jsonResponse({
        code: "200",
        data: {
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          expires_in: 3600,
        },
      });
    }
    return jsonResponse({ code: 0, data: [{ sid: 1, name: "JOI MEW-US" }] });
  };

  try {
    const adapter = new LingxingAdapter({
      ...lingxingTestConfig,
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
    });
    const payload = await adapter.fetchSellers();

    assert.equal(payload.data[0].name, "JOI MEW-US");
    assert.equal(calls.filter((item) => item.pathname === "/api/auth-server/oauth/access-token").length, 0);
    assert.equal(calls.filter((item) => item.pathname === "/api/auth-server/oauth/refresh").length, 1);
    const sellerCalls = calls.filter((item) => item.pathname === "/erp/sc/data/seller/lists");
    assert.equal(sellerCalls.length, 2);
    assert.equal(sellerCalls[0].accessToken, "expired-access-token");
    assert.equal(sellerCalls[1].accessToken, "fresh-access-token");
  } finally {
    globalThis.fetch = originalFetch;
    resetLingxingAdapterForTest();
  }
});

test("getLingxingAdapter returns the process singleton for matching default config", () => {
  resetLingxingAdapterForTest();
  const first = getLingxingAdapter(lingxingTestConfig);
  const second = getLingxingAdapter({ ...lingxingTestConfig });

  assert.equal(first, second);
  resetLingxingAdapterForTest();
});

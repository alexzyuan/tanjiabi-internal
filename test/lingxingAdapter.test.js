import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCoreSellers,
  getLingxingAdapter,
  LingxingAdapter,
  resetLingxingAdapterForTest,
} from "../src/adapters/lingxingAdapter.js";
import { jsonResponse } from "./helpers/http.js";

const lingxingTestConfig = {
  baseUrl: "https://openapi.test/",
  appKey: "1234567890abcdef",
  appSecret: "secret",
};

test("normalized order profit keeps currency and Lingxing rate metadata", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1,
    amount: 10,
    net_amount: 9,
    currency_code: "USD",
    amount_cny: 72,
    exchange_rate: 7.2,
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);

  assert.equal(row.currencyCode, "USD");
  assert.equal(row.cnyAmount, 72);
  assert.equal(row.exchangeRate, 7.2);
});

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

test("LingxingAdapter sends exclusive end date to Lingxing without mutating UI filters", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };
  const filters = {
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    sids: [8708],
    currencyCode: "ORIGINAL",
  };

  await adapter.fetchMskuOrderProfit(filters);

  assert.equal(filters.endDate, "2026-07-14");
  assert.equal(calls[0].endpoint, "/basicOpen/finance/mreport/OrderProfit");
  assert.equal(calls[0].params.startDate, "2026-07-01");
  assert.equal(calls[0].params.endDate, "2026-07-15");
});

test("LingxingAdapter paginates order profit until the upstream total is exhausted", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (_endpoint, options) => {
    calls.push(options.params);
    const offset = options.params.offset;
    return {
      code: 0,
      data: {
        records: Array.from({ length: offset === 0 ? 5000 : 2 }, (_, index) => ({ id: offset + index })),
        total: 5002,
      },
    };
  };

  const payload = await adapter.fetchMskuOrderProfit({ startDate: "2026-07-01", endDate: "2026-07-31" });

  assert.deepEqual(calls.map(({ offset, length }) => ({ offset, length })), [
    { offset: 0, length: 5000 },
    { offset: 5000, length: 5000 },
  ]);
  assert.equal(adapter.normalizeRecordList(payload).length, 5002);
});

test("LingxingAdapter fails observably instead of truncating order profit at its safety cap", async () => {
  const adapter = new LingxingAdapter({ ...lingxingTestConfig, orderProfitMaxRows: 5000 });
  adapter.performSignedRequest = async () => ({
    code: 0,
    data: { records: Array.from({ length: 5000 }, (_, id) => ({ id })), total: 5001 },
  });

  await assert.rejects(
    () => adapter.fetchMskuOrderProfit({ startDate: "2026-07-01", endDate: "2026-07-31" }),
    (error) => error.endpoint === "/basicOpen/finance/mreport/OrderProfit"
      && error.details?.fetchedRows === 5000
      && /安全上限/.test(error.message),
  );
});

test("LingxingAdapter applies exclusive end_date to FBA shipment list at the API boundary", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { list: [] } };
  };

  await adapter.fetchFbaCargoShipments({
    sid: "8708",
    start_date: "2026-07-01",
    end_date: "2026-07-14",
  });

  assert.equal(calls[0].endpoint, "/erp/sc/data/fba_report/shipmentList");
  assert.equal(calls[0].params.start_date, "2026-07-01");
  assert.equal(calls[0].params.end_date, "2026-07-15");
});

test("LingxingAdapter sends FBA inventory history with month-form snake date fields", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { row_data: [] } };
  };

  await adapter.fetchFbaInventoryHistory({
    start_date: "2026-05",
    end_date: "2026-05",
    seller_id: ["A3U4NGIBQX1BFQ"],
  });

  assert.equal(calls[0].endpoint, "/cost/center/openApi/fba/detail/query");
  assert.equal(calls[0].params.start_date, "2026-05");
  assert.equal(calls[0].params.end_date, "2026-05");
});

test("LingxingAdapter applies exclusive created_end_time for payable pools", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchPayablePurchasePool({
    start_date: "2026-07-01",
    end_date: "2026-07-14",
    created_start_time: "2026-07-01",
    created_end_time: "2026-07-14",
  });

  assert.equal(calls[0].params.end_date, "2026-07-15");
  assert.equal(calls[0].params.created_end_time, "2026-07-15");
});

test("LingxingAdapter sends monthly inventory ledger summary with month-form camel date fields", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 1, data: { records: [] } };
  };

  await adapter.fetchMonthlyInventoryLedgerSummary({
    sellerIds: ["A3U4NGIBQX1BFQ"],
    startDate: "2026-05",
    endDate: "2026-05",
  });

  assert.equal(calls[0].endpoint, "/cost/center/ods/summary/query");
  assert.equal(calls[0].params.queryType, 1);
  assert.equal(calls[0].params.startDate, "2026-05");
  assert.equal(calls[0].params.endDate, "2026-05");
  assert.equal(calls[0].params.start_date, undefined);
  assert.equal(calls[0].params.end_date, undefined);
});

test("LingxingAdapter sends daily inventory ledger summary with camel exclusive end date", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 1, data: { records: [] } };
  };

  await adapter.fetchInventoryLedgerSummary({
    sellerIds: ["A3U4NGIBQX1BFQ"],
    startDate: "2026-05-01",
    endDate: "2026-05-31",
  });

  assert.equal(calls[0].endpoint, "/cost/center/ods/summary/query");
  assert.equal(calls[0].params.queryType, 2);
  assert.equal(calls[0].params.startDate, "2026-05-01");
  assert.equal(calls[0].params.endDate, "2026-06-01");
  assert.equal(calls[0].params.start_date, undefined);
  assert.equal(calls[0].params.end_date, undefined);
});

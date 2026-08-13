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

test("seller profit report requests one month using the API yyyy-MM date format", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchSellerProfitReport({
    startDate: "2026-07",
    endDate: "2026-07",
    sids: [11, 12],
    currencyCode: "CNY",
  });

  assert.equal(calls[0].endpoint, "/bd/profit/report/open/report/seller/list");
  assert.equal(calls[0].params.monthlyQuery, true);
  assert.equal(calls[0].params.summaryEnabled, true);
  assert.deepEqual(calls[0].params.sids, [11, 12]);
  assert.equal(calls[0].params.startDate, "2026-07");
  assert.equal(calls[0].params.endDate, "2026-07");
  assert.equal(calls[0].params.currencyCode, "CNY");
});

test("seller profit report paginates completely and omits ORIGINAL from signed params", async () => {
  const adapter = new LingxingAdapter({ ...lingxingTestConfig, sellerProfitPageSize: 1 });
  const calls = [];
  const pagination = [];
  adapter.performSignedRequest = async (_endpoint, options) => {
    calls.push(options.params);
    return options.params.offset === 0
      ? { code: 0, data: { records: [{ sid: 11 }], totalCount: 2, hasNext: true } }
      : { code: 0, data: { records: [{ sid: 12 }], totalCount: 2, hasNext: false } };
  };

  const payload = await adapter.fetchSellerProfitReport({
    startDate: "2026-07", endDate: "2026-07", sids: [11, 12], currencyCode: "ORIGINAL",
  }, { onPagination: (evidence) => pagination.push(evidence) });

  assert.deepEqual(calls.map(({ offset }) => offset), [0, 1]);
  assert.ok(calls.every((params) => !("currencyCode" in params)));
  assert.deepEqual(adapter.normalizeRecordList(payload).map(({ sid }) => sid), [11, 12]);
  assert.equal(pagination.at(-1).complete, true);
  assert.equal(pagination.at(-1).cumulativeRowCount, 2);
  assert.equal(pagination.at(-1).declaredTotal, 2);
  assert.deepEqual(Object.keys(pagination.at(-1)).sort(), [
    "complete", "cumulativeRowCount", "declaredTotal", "hasNext", "offset", "pageIndex",
    "pageRowCount", "safetyLimitHit", "terminalReason",
  ]);
});

test("seller profit report accepts a metadata-free short page as complete", async () => {
  const adapter = new LingxingAdapter({ ...lingxingTestConfig, sellerProfitPageSize: 2 });
  const pagination = [];
  adapter.performSignedRequest = async () => ({ code: 0, data: { records: [{ sid: 11 }] } });

  const payload = await adapter.fetchSellerProfitReport({}, { onPagination: (evidence) => pagination.push(evidence) });

  assert.equal(adapter.normalizeRecordList(payload).length, 1);
  assert.equal(pagination.at(-1).terminalReason, "short-page");
  assert.equal(pagination.at(-1).complete, true);
});

for (const scenario of [
  {
    name: "declared total changes",
    responses: [
      { records: [{ sid: 11 }], total: 3, hasNext: true },
      { records: [{ sid: 12 }], total: 2, hasNext: false },
    ],
  },
  {
    name: "hasNext false before total",
    responses: [{ records: [{ sid: 11 }], total: 2, hasNext: false }],
  },
  {
    name: "empty page before more",
    responses: [
      { records: [{ sid: 11 }], total: 2, hasNext: true },
      { records: [], total: 2, hasNext: true },
    ],
    code: "SELLER_PROFIT_PAGINATION_INCOMPLETE",
    terminalReason: "empty-before-more",
  },
]) {
  test(`seller profit report rejects incomplete pagination: ${scenario.name}`, async () => {
    const adapter = new LingxingAdapter({ ...lingxingTestConfig, sellerProfitPageSize: 1 });
    const pagination = [];
    let index = 0;
    adapter.performSignedRequest = async () => ({ code: 0, data: scenario.responses[index++] });
    await assert.rejects(
      () => adapter.fetchSellerProfitReport({}, { onPagination: (evidence) => pagination.push(evidence) }),
      (error) => error.code === (scenario.code || "SELLER_PROFIT_PAGINATION_CONTRACT_INVALID"),
    );
    assert.equal(pagination.at(-1).terminalReason, scenario.terminalReason || "pagination-contract-conflict");
    assert.equal(pagination.at(-1).complete, false);
  });
}

test("seller profit report rejects its pagination safety limit", async () => {
  const adapter = new LingxingAdapter({
    ...lingxingTestConfig, sellerProfitPageSize: 1, sellerProfitMaxRows: 1,
  });
  const pagination = [];
  adapter.performSignedRequest = async () => ({
    code: 0, data: { records: [{ sid: 11 }], total: 2, hasNext: true },
  });
  await assert.rejects(
    () => adapter.fetchSellerProfitReport({}, { onPagination: (evidence) => pagination.push(evidence) }),
    (error) => error.code === "SELLER_PROFIT_PAGINATION_SAFETY_LIMIT",
  );
  assert.equal(pagination.at(-1).terminalReason, "safety-limit");
  assert.equal(pagination.at(-1).safetyLimitHit, true);
});

test("LingxingAdapter keeps documented inclusive endpoint end dates unchanged", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchSellerProfitStatistics({ startDate: "2026-07-01", endDate: "2026-07-31" });
  await adapter.fetchProductPerformance({ start_date: "2026-07-01", end_date: "2026-07-31" });
  await adapter.fetchPurchaseOrders({ start_date: "2026-07-01", end_date: "2026-07-31" });
  await adapter.fetchInventoryLedgerSummary({ startDate: "2026-07-01", endDate: "2026-07-31" });

  assert.equal(calls[0].params.endDate, "2026-07-31");
  assert.equal(calls[1].params.end_date, "2026-07-31");
  assert.equal(calls[2].params.end_date, "2026-07-31");
  assert.equal(calls[3].params.endDate, "2026-07-31");
});

test("LingxingAdapter converts the documented order-list end date to an exclusive boundary", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchOrders({ start_date: "2026-07-01", end_date: "2026-07-31" });

  assert.equal(calls[0].endpoint, "/erp/sc/data/mws/orders");
  assert.equal(calls[0].params.end_date, "2026-08-01");
});

test("LingxingAdapter keeps undocumented endpoint end dates unchanged", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchReturnAnalysis({ startDate: "2026-07-01", endDate: "2026-07-31" });
  await adapter.fetchReviewV2({ start_date: "2026-07-01", end_date: "2026-07-31" });
  await adapter.fetchSettlementSummary({ startDate: "2026-07-01", endDate: "2026-07-31" });

  assert.equal(calls[0].params.endDate, "2026-07-31");
  assert.equal(calls[1].params.end_date, "2026-07-31");
  assert.equal(calls[2].params.endDate, "2026-07-31");
});

test("other fee list requests an inclusive date range at store dimension", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchOtherFeeList({
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    sids: [11],
  });

  assert.equal(calls[0].endpoint, "/bd/fee/management/open/feeManagement/otherFee/list");
  assert.equal(calls[0].params.date_type, "date");
  assert.deepEqual(calls[0].params.dimensions, [3]);
  assert.deepEqual(calls[0].params.sids, [11]);
  assert.equal(calls[0].params.start_date, "2026-07-01");
  assert.equal(calls[0].params.end_date, "2026-07-31");
});

test("normalized order profit keeps return quantity for monthly return-cost derivation", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1,
    amount: 100,
    volume: 100,
    return_quantity: 10,
    purchase_costs: -30,
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);

  assert.equal(row.totalSalesQuantity, 100);
  assert.equal(row.returnQuantity, 10);
  assert.equal(Number(row.purchaseCost), -30);
});

test("normalized MSKU profit keeps unsaleable returns and unit landed-cost fields", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1,
    volume: 100,
    fbaReturnsUnsaleableQuantity: 5,
    cgUnitPrice: -5.6,
    cgTransportUnitCosts: -1,
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);

  assert.equal(row.unsaleableReturnQuantity, 5);
  assert.equal(row.purchaseUnitCost, -5.6);
  assert.equal(row.firstLegUnitCost, -1);
});

test("seller profit otherFeeStr normalizes store-level custom fee allocations", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const records = adapter.normalizeSellerProfitOtherFeeRecords([{
    sid: 7,
    storeName: "Amazon-US",
    country: "美国",
    currencyCode: "CNY",
    otherFeeStr: [{ otherFeeName: "办公费用-租金", otherFeeTypeId: 1, feeAllocation: -12.5 }],
  }], [{ sid: 7, name: "Amazon-US", country: "美国" }], "2026-07");

  assert.deepEqual(records, [{
    sid: 7,
    storeName: "Amazon-US",
    country: "美国",
    currencyCode: "CNY",
    reportDate: "2026-07",
    other_fee_type: "办公费用-租金",
    other_fee_type_id: "1",
    fee: -12.5,
  }]);
});

test("normalized MSKU profit exposes the OrderProfit profit field for net gross rate", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1,
    amount: 100,
    net_amount: 90,
    gross_profit: 50,
    profit: 20,
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);

  assert.equal(row.salesProfit, 20);
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

test("LingxingAdapter keeps OrderProfit end date unchanged without mutating UI filters", async () => {
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
  assert.equal(calls[0].params.endDate, "2026-07-14");
});

test("LingxingAdapter paginates order profit until the upstream total is exhausted", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  const pagination = [];
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

  const payload = await adapter.fetchMskuOrderProfit(
    { startDate: "2026-07-01", endDate: "2026-07-31" },
    { onPagination: (evidence) => pagination.push(evidence) },
  );

  assert.deepEqual(calls.map(({ offset, length }) => ({ offset, length })), [
    { offset: 0, length: 5000 },
    { offset: 5000, length: 5000 },
  ]);
  assert.equal(adapter.normalizeRecordList(payload).length, 5002);
  assert.deepEqual(pagination, [
    {
      pageIndex: 1, offset: 0, pageRowCount: 5000, cumulativeRowCount: 5000,
      declaredTotal: 5002, hasNext: null, terminalReason: null, complete: false, safetyLimitHit: false,
    },
    {
      pageIndex: 2, offset: 5000, pageRowCount: 2, cumulativeRowCount: 5002,
      declaredTotal: 5002, hasNext: null, terminalReason: "total-exhausted", complete: true, safetyLimitHit: false,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(pagination), /records|seller_sku|amount|token|raw/i);
});

test("LingxingAdapter fails observably instead of truncating order profit at its safety cap", async () => {
  const adapter = new LingxingAdapter({ ...lingxingTestConfig, orderProfitMaxRows: 5000 });
  const pagination = [];
  adapter.performSignedRequest = async () => ({
    code: 0,
    data: { records: Array.from({ length: 5000 }, (_, id) => ({ id })), total: 5001 },
  });

  await assert.rejects(
    () => adapter.fetchMskuOrderProfit(
      { startDate: "2026-07-01", endDate: "2026-07-31" },
      { onPagination: (evidence) => pagination.push(evidence) },
    ),
    (error) => error.endpoint === "/basicOpen/finance/mreport/OrderProfit"
      && error.details?.fetchedRows === 5000
      && /安全上限/.test(error.message),
  );
  assert.equal(pagination.at(-1)?.terminalReason, "safety-limit");
  assert.equal(pagination.at(-1)?.complete, false);
  assert.equal(pagination.at(-1)?.safetyLimitHit, true);
});

test("LingxingAdapter reports incomplete pagination before rejecting an empty page", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const pagination = [];
  adapter.performSignedRequest = async (_endpoint, options) => ({
    code: 0,
    data: {
      records: options.params.offset === 0 ? [{ id: 1 }] : [],
      total: 2,
      hasNext: true,
    },
  });

  await assert.rejects(
    () => adapter.fetchMskuOrderProfit(
      { startDate: "2026-07-01", endDate: "2026-07-31" },
      { onPagination: (evidence) => pagination.push(evidence) },
    ),
    /空页/,
  );
  assert.equal(pagination.at(-1)?.terminalReason, "empty-before-more");
  assert.equal(pagination.at(-1)?.complete, false);
  assert.equal(pagination.at(-1)?.safetyLimitHit, false);
});

test("LingxingAdapter propagates pagination observer failures", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  adapter.performSignedRequest = async () => ({ code: 0, data: { records: [], total: 0 } });

  await assert.rejects(
    () => adapter.fetchMskuOrderProfit({}, { onPagination: () => { throw new Error("observer failed"); } }),
    /observer failed/,
  );
});

for (const scenario of [
  {
    name: "declared total changes across pages",
    responses: [
      { records: [{ id: 1 }], total: 3, hasNext: true },
      { records: [{ id: 2 }], total: 2, hasNext: false },
    ],
  },
  {
    name: "hasNext false before declared total",
    responses: [{ records: [{ id: 1 }], total: 2, hasNext: false }],
  },
  {
    name: "hasNext true after declared total",
    responses: [{ records: [{ id: 1 }], total: 1, hasNext: true }],
  },
  {
    name: "rows exceed declared total",
    responses: [{ records: [{ id: 1 }, { id: 2 }], total: 1 }],
  },
]) {
  test(`LingxingAdapter rejects contradictory OrderProfit pagination: ${scenario.name}`, async () => {
    const adapter = new LingxingAdapter(lingxingTestConfig);
    const pagination = [];
    let callIndex = 0;
    adapter.performSignedRequest = async () => ({
      code: 0,
      data: scenario.responses[callIndex++],
    });

    await assert.rejects(
      () => adapter.fetchMskuOrderProfit({}, { onPagination: (evidence) => pagination.push(evidence) }),
      (error) => error.code === "ORDER_PROFIT_PAGINATION_CONTRACT_INVALID",
    );
    assert.equal(pagination.at(-1)?.terminalReason, "pagination-contract-conflict");
    assert.equal(pagination.at(-1)?.complete, false);
    assert.equal(pagination.at(-1)?.safetyLimitHit, false);
  });
}

test("LingxingAdapter continues after a short page when upstream pagination metadata says more rows exist", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (_endpoint, options) => {
    calls.push(options.params);
    const offset = options.params.offset;
    if (offset === 0) return { code: 0, data: { records: [{ id: 1 }], total: 2, hasNext: true } };
    return { code: 0, data: { records: [{ id: 2 }], total: 2, hasNext: false } };
  };

  const payload = await adapter.fetchMskuOrderProfit({ startDate: "2026-07-01", endDate: "2026-07-31" });

  assert.deepEqual(calls.map(({ offset }) => offset), [0, 1]);
  assert.equal(adapter.normalizeRecordList(payload).length, 2);
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

test("LingxingAdapter keeps payable pool closed end dates and uses documented field names", async () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const calls = [];
  adapter.performSignedRequest = async (endpoint, options) => {
    calls.push({ endpoint, params: options.params });
    return { code: 0, data: { records: [] } };
  };

  await adapter.fetchPayablePurchasePool({
    start_time: "2026-07-01",
    end_time: "2026-07-14",
    time_field: "create_time",
  });

  assert.equal(calls[0].params.end_time, "2026-07-14");
  assert.equal(calls[0].params.time_field, "create_time");
  assert.equal(calls[0].params.end_date, undefined);
  assert.equal(calls[0].params.created_end_time, undefined);
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

test("LingxingAdapter sends daily inventory ledger summary with camel inclusive end date", async () => {
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
  assert.equal(calls[0].params.endDate, "2026-05-31");
  assert.equal(calls[0].params.start_date, undefined);
  assert.equal(calls[0].params.end_date, undefined);
});

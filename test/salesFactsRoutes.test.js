import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createSalesFactsRoutes, sanitizeSalesFactsHealth, serializeSalesFactsError } from "../routes/sales-facts.js";
import { dispatchApiRoute } from "../routes/api-dispatch.js";
import { createCoreRoutes } from "../routes/core.js";

function bodyRequest(value) {
  return Readable.from([JSON.stringify(value)]);
}

function deps(overrides = {}) {
  const defaultRefreshMeta = { source: "sales-facts-sqlite", cacheState: "hit" };
  return {
    readJsonBody: async (req, options) => JSON.parse(await new Promise((resolve, reject) => {
      let text = "";
      req.on("data", (chunk) => { text += chunk; });
      req.on("end", () => resolve(text));
      req.on("error", reject);
      assert.equal(options.maxBytes, 256 * 1024);
    })),
    sendJson: (_res, status, payload) => { _res.status = status; _res.payload = payload; },
    refreshOrderProfitScope: async (payload) => ({ facts: [], coverage: [], meta: defaultRefreshMeta, operation: "order-profit", payload }),
    refreshMonthlyReportScope: async (payload) => ({ facts: [], coverage: [], customFees: [], customFeeCoverage: [], meta: defaultRefreshMeta, operation: "monthly-report", payload }),
    syncListingOwnerHistory: async (payload) => ({ changed: false, ownerRevision: 0, scannedListingCount: 0, periodCount: 0, changedListingCount: 0, transferCount: 0, counts: { assigned: 0, unassigned: 0, multiple: 0, malformed: 0 }, operation: "owners", payload }),
    ...overrides,
  };
}

test("sales facts exposes the exact authenticated refresh descriptors", () => {
  const routes = createSalesFactsRoutes(deps());
  assert.equal(routes.find((route) => route.path === "/api/sales-facts/order-profit/refresh")?.auth, "session");
  assert.equal(routes.find((route) => route.path === "/api/sales-facts/monthly-report/refresh")?.auth, "finance");
  assert.equal(routes.find((route) => route.path === "/api/sales-facts/owners/sync")?.auth, "admin");
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    "POST /api/sales-facts/order-profit/refresh",
    "POST /api/sales-facts/monthly-report/refresh",
    "POST /api/sales-facts/owners/sync",
  ]);
});

test("refresh routes accept only the explicit scope contract and never accept listing owner", async () => {
  const calls = [];
  const routes = createSalesFactsRoutes(deps({
    refreshOrderProfitScope: async (payload) => { calls.push(payload); return { facts: [], coverage: [], meta: { source: "sales-facts-sqlite", cacheState: "refreshed" } }; },
  }));
  const route = routes[0];
  const req = bodyRequest({
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    sids: [8708, 8709],
    currencyMode: "CNY",
    forceRefresh: true,
  });
  const res = {};
  await route.handler({ req, res });
  assert.deepEqual(calls, [{
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    sids: [8708, 8709],
    currencyMode: "CNY",
    forceRefresh: true,
  }]);
  assert.equal(res.status, 200);

  await assert.rejects(
    route.handler({ req: bodyRequest({ ...JSON.parse(JSON.stringify(calls[0])), listingOwner: "Alice" }), res: {} }),
    (error) => error.statusCode === 400 && error.code === "SALES_FACTS_ROUTE_BODY_INVALID",
  );
});

test("request body cap is 256 KiB and errors stay controlled", async () => {
  let readOptions;
  const route = createSalesFactsRoutes(deps({
    readJsonBody: async (_req, options) => { readOptions = options; const error = new Error("too large"); error.statusCode = 413; error.code = "REQUEST_BODY_TOO_LARGE"; throw error; },
  }))[0];
  await assert.rejects(route.handler({ req: bodyRequest({}), res: {} }), (error) => error.statusCode === 413);
  assert.deepEqual(readOptions, { maxBytes: 256 * 1024 });
});

test("owner sync has an admin-only descriptor and forwards the detected date", async () => {
  const calls = [];
  const route = createSalesFactsRoutes(deps({
    syncListingOwnerHistory: async (payload) => { calls.push(payload); return { changed: false, ownerRevision: 0, scannedListingCount: 0, periodCount: 0, changedListingCount: 0, transferCount: 0, counts: { assigned: 0, unassigned: 0, multiple: 0, malformed: 0 } }; },
  }))[2];
  const res = {};
  await route.handler({ req: bodyRequest({ detectedDate: "2026-08-13" }), res });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [{ detectedDate: "2026-08-13" }]);
  assert.deepEqual(res.payload.result, {
    changed: false,
    ownerRevision: 0,
    scannedListingCount: 0,
    periodCount: 0,
    changedListingCount: 0,
    transferCount: 0,
    counts: { assigned: 0, unassigned: 0, multiple: 0, malformed: 0 },
  });
});

test("refresh success response is JSON-safe and exposes counts instead of BigInt fact rows", async () => {
  const sent = [];
  const route = createSalesFactsRoutes(deps({
    sendJson: (_res, status, payload) => {
      const body = JSON.stringify(payload);
      sent.push({ status, payload, body });
    },
    refreshMonthlyReportScope: async () => ({
      facts: [{ sid: 8708, metrics: { totalSalesAmount: 123n } }],
      coverage: [{ factDate: "2026-08-01", sid: 8708 }],
      customFees: [{ naturalMonth: "2026-08", sid: 8708, feeAmount: 456n }],
      customFeeCoverage: [{ naturalMonth: "2026-08", sid: 8708 }],
      meta: {
        source: "sales-facts-sqlite",
        cacheState: "refreshed",
        updatedAt: "2026-08-13T08:00:00.000Z",
        ageSeconds: 0,
        revision: 7,
        requestId: "monthly-test",
        scopeCount: { dates: 1, sids: 1 },
        refreshedPartitionCount: 1,
        refreshedRangeCount: 1,
        operation: "monthly-report",
      },
    }),
  })).find((item) => item.path === "/api/sales-facts/monthly-report/refresh");

  await route.handler({ req: bodyRequest({}), res: {} });

  assert.equal(sent[0].status, 200);
  assert.deepEqual(sent[0].payload.result, {
    meta: {
      source: "sales-facts-sqlite",
      cacheState: "refreshed",
      updatedAt: "2026-08-13T08:00:00.000Z",
      ageSeconds: 0,
      revision: 7,
      requestId: "monthly-test",
      scopeCount: { dates: 1, sids: 1 },
      refreshedPartitionCount: 1,
      refreshedRangeCount: 1,
      operation: "monthly-report",
    },
    counts: {
      factCount: 1,
      coverageCount: 1,
      customFeeCount: 1,
      customFeeCoverageCount: 1,
    },
  });
  assert.doesNotMatch(sent[0].body, /totalSalesAmount|123|456/u);
});

test("generic dispatch does not write a second response after the handler committed one", async () => {
  const sent = [];
  const logs = [];
  const res = { headersSent: true, writableEnded: true };
  await dispatchApiRoute({
    req: {},
    res,
    url: new URL("http://localhost/api/sales-facts/monthly-report/refresh"),
    route: {
      method: "POST",
      path: "/api/sales-facts/monthly-report/refresh",
      handler: async () => { throw new Error("late handler failure"); },
      serializeError: serializeSalesFactsError,
    },
    authorize: () => true,
    sendJson: (_res, status, payload) => sent.push({ status, payload }),
    logger: { error: (...args) => logs.push(args) },
  });
  assert.deepEqual(sent, []);
  assert.equal(logs[0]?.[0], "[api-error-after-response]");
  assert.equal(logs[0]?.[1]?.endpoint, "/api/sales-facts/monthly-report/refresh");
  assert.equal(logs[0]?.[1]?.responseState, "already-closed");
});

test("generic dispatch closes a response after headers were sent but before it ended", async () => {
  const logs = [];
  let endCount = 0;
  const res = {
    headersSent: true,
    writableEnded: false,
    destroyed: false,
    end: () => { endCount += 1; res.writableEnded = true; },
  };
  await dispatchApiRoute({
    req: {},
    res,
    url: new URL("http://localhost/api/sales-facts/monthly-report/refresh"),
    route: {
      method: "POST",
      path: "/api/sales-facts/monthly-report/refresh",
      handler: async () => { throw Object.assign(new Error("late handler failure"), { endpoint: "https://secret.example/?token=leak" }); },
      serializeError: serializeSalesFactsError,
    },
    authorize: () => true,
    sendJson: () => { throw new Error("must not write a second response"); },
    logger: { error: (...args) => logs.push(args) },
  });
  assert.equal(endCount, 1);
  assert.equal(logs[0]?.[1]?.endpoint, "/api/sales-facts/monthly-report/refresh");
  assert.doesNotMatch(JSON.stringify(logs), /token|secret\.example/u);
  assert.equal(logs[0]?.[1]?.responseState, "ended");
});

test("sales facts routes fail closed when a service returns an incomplete result", async () => {
  const routes = createSalesFactsRoutes(deps({
    refreshMonthlyReportScope: async () => ({}),
  }));
  await assert.rejects(
    routes.find((route) => route.path === "/api/sales-facts/monthly-report/refresh").handler({ req: bodyRequest({}), res: {} }),
    /刷新结果缺少必需/u,
  );
  const ownerRoute = createSalesFactsRoutes(deps({ syncListingOwnerHistory: async () => ({}) }))
    .find((route) => route.path === "/api/sales-facts/owners/sync");
  await assert.rejects(
    ownerRoute.handler({ req: bodyRequest({}), res: {} }),
    /缺少必需字段/u,
  );
});

test("sales facts error serializer redacts raw details and permits only controlled statuses", () => {
  const error = Object.assign(new Error("secret upstream body"), {
    name: "SalesFactsUpstreamError",
    statusCode: 502,
    code: "SALES_FACTS_UPSTREAM_FAILED",
    details: {
      requestId: "shadow-1",
      operation: "order-profit",
      sidCount: 18,
      raw: "token-secret",
      path: "/opt/tanjia-bi/data-cache/sales-facts-v1.sqlite",
    },
  });
  const serialized = serializeSalesFactsError(error, "/api/sales-facts/order-profit/refresh");
  assert.equal(serialized.statusCode, 502);
  assert.deepEqual(serialized.payload, {
    ok: false,
    error: "销售事实操作失败。",
    operation: "order-profit",
    code: "SALES_FACTS_UPSTREAM_FAILED",
    requestId: "shadow-1",
    counts: { sidCount: 18 },
  });
  assert.equal(JSON.stringify(serialized).includes("secret"), false);
  assert.equal(JSON.stringify(serialized).includes("/opt/tanjia"), false);
  assert.equal(JSON.stringify(serialized).includes("token"), false);

  const unknown = serializeSalesFactsError(Object.assign(new Error("x"), { statusCode: 500, code: "raw-body" }), "endpoint");
  assert.equal(unknown.statusCode, 503);
});

test("nested sales facts health stays safe and root health remains HTTP 200", async () => {
  const health = sanitizeSalesFactsHealth({
    ok: true,
    status: "healthy",
    schemaVersion: 1,
    quickCheck: "ok",
    salesFactsRevision: 4,
    ownerRevision: 2,
    dailyFactCount: 10,
    fetchMode: "daily",
    databasePath: "/opt/tanjia-bi/data-cache/sales-facts-v1.sqlite",
    sql: "SELECT secret",
  });
  assert.deepEqual(health, {
    ok: true,
    status: "healthy",
    schemaVersion: 1,
    quickCheck: "ok",
    salesFactsRevision: 4,
    ownerRevision: 2,
    dailyFactCount: 10,
    fetchMode: "daily",
  });
  const route = createCoreRoutes({
    config: { dataProvider: "lingxing", runtime: "test", dingtalk: { login: {} } },
    getSyncState: () => ({ provider: "lingxing" }),
    getProductCatalogHealth: () => ({ ok: true, schemaVersion: 1, quickCheck: "ok" }),
    getSalesFactsHealth: () => ({ ok: true, status: "healthy", schemaVersion: 1, quickCheck: "ok", databasePath: "/secret" }),
    sendJson: (_res, status, payload) => { _res.status = status; _res.payload = payload; },
    isAuthEnabled: () => false,
    getSession: () => null,
    isDingtalkLoginConfigured: () => false,
    isPasswordLoginEnabled: () => false,
  }).find((item) => item.path === "/api/health");
  const res = {};
  await route.handler({ res });
  assert.equal(res.status, 200);
  assert.deepEqual(res.payload.salesFacts, { ok: true, status: "healthy", schemaVersion: 1, quickCheck: "ok" });
});

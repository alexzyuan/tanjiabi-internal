import assert from "node:assert/strict";
import test from "node:test";

import { createCoreRoutes } from "../routes/core.js";
import {
  createProductCatalogRoutes,
  serializeProductCatalogError,
} from "../routes/product-catalog.js";
import { dispatchApiRoute } from "../routes/api-dispatch.js";

function createHarness(overrides = {}) {
  const sent = [];
  const calls = [];
  const deps = {
    readJsonBody: async () => ({}),
    sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
    refreshProductCatalogScope: async (input) => {
      calls.push(input);
      return { ok: true, records: [{ secret: "must-not-leak" }], meta: { revision: 7 } };
    },
    getProductCatalogHealth: () => ({
      ok: true,
      status: "healthy",
      schemaVersion: 1,
      quickCheck: "ok",
    }),
    ...overrides,
  };
  const routes = createProductCatalogRoutes(deps);
  return { routes, sent, calls };
}

test("catalog refresh route has the exact authenticated descriptor", () => {
  const { routes } = createHarness();
  assert.deepEqual(routes.map(({ method, path, auth }) => ({ method, path, auth })), [
    { method: "POST", path: "/api/product-catalog/refresh", auth: "session" },
  ]);
  assert.equal(typeof routes[0].serializeError, "function");
});

test("catalog refresh whitelists feature/items and exposes only safe result fields", async () => {
  const { routes, sent, calls } = createHarness({
    readJsonBody: async () => ({
      feature: "supplier-board",
      items: [{ sid: 8708, msku: "A", token: "item-secret" }],
      token: "raw-secret",
      repository: { path: "/tmp/private.sqlite" },
      requestId: "attacker-request-id",
    }),
    refreshProductCatalogScope: async (input) => {
      calls.push(input);
      return {
        ok: true,
        records: [{
          sid: 8708,
          msku: "A",
          mskuKey: "a",
          internalSku: "TJ001",
          internalSkuKey: "tj001",
          storeName: "店铺 A",
          country: "美国",
          productName: "商品 A",
          purchasePrice: 38,
          product: {
            internalSku: "TJ001",
            productName: "商品 A",
            purchasePrice: 38,
            raw: { token: "raw-secret" },
          },
          listing: {
            sid: 8708,
            msku: "A",
            internalSku: "TJ001",
            source: "lingxing-listing",
            raw: { token: "raw-secret" },
          },
          raw: { token: "raw-secret" },
        }],
        meta: {
          source: "sqlite",
          requestId: "safe-id",
          scopeCount: 1,
          liveOwnedSkipCount: 2,
          cacheUpdatedAt: "not-an-iso-date",
          revision: 7,
        },
      };
    },
  });

  await routes[0].handler({ req: {}, res: {} });

  assert.deepEqual(calls, [{ feature: "supplier-board", items: [{ sid: 8708, msku: "A" }] }]);
  assert.equal(sent[0].statusCode, 200);
  assert.deepEqual(sent[0].payload.meta, {
    source: "sqlite",
    requestId: "safe-id",
    scopeCount: 1,
    liveOwnedSkipCount: 2,
    revision: 7,
  });
  assert.deepEqual(sent[0].payload.records, [{
    sid: 8708,
    msku: "A",
    mskuKey: "a",
    internalSku: "TJ001",
    internalSkuKey: "tj001",
    storeName: "店铺 A",
    country: "美国",
    productName: "商品 A",
    purchasePrice: 38,
    product: {
      internalSku: "TJ001",
      productName: "商品 A",
      purchasePrice: 38,
    },
    listing: {
      sid: 8708,
      msku: "A",
      internalSku: "TJ001",
      source: "lingxing-listing",
    },
  }]);
  assert.equal(JSON.stringify(sent[0].payload).includes("raw-secret"), false);
});

test("catalog meta keeps only valid ISO cache timestamps", async () => {
  const { routes, sent } = createHarness({
    readJsonBody: async () => ({ feature: "supplier-board", items: [] }),
    refreshProductCatalogScope: async () => ({
      ok: true,
      records: [],
      meta: {
        source: "sqlite",
        requestId: "timestamp-test",
        scopeCount: 0,
        cacheUpdatedAt: "2026-08-12T10:20:30.000Z",
      },
    }),
  });
  await routes[0].handler({ req: {}, res: {} });
  assert.equal(sent[0].payload.meta.cacheUpdatedAt, "2026-08-12T10:20:30.000Z");
});

test("catalog refresh rejects invalid body or feature before service delegation", async () => {
  for (const body of [{}, { feature: "unknown", items: [] }, { feature: "supplier-board", items: {} }]) {
    let calls = 0;
    const { routes, sent } = createHarness({
      readJsonBody: async () => body,
      refreshProductCatalogScope: async () => { calls += 1; return { ok: true }; },
    });

    await assert.rejects(routes[0].handler({ req: {}, res: {} }), (error) => error.statusCode === 400);
    assert.equal(calls, 0);
    assert.equal(sent.length, 0);
  }
});

test("catalog refresh propagates typed service statuses to router dispatch", async () => {
  for (const statusCode of [400, 409, 422, 502, 503]) {
    const { routes } = createHarness({
      readJsonBody: async () => ({ feature: "fba-catalog", items: [{ sid: 8708, msku: "A" }] }),
      refreshProductCatalogScope: async () => {
        throw Object.assign(new Error("upstream free text token raw-secret"), { statusCode });
      },
    });
    await assert.rejects(routes[0].handler({ req: {}, res: {} }), (error) => error.statusCode === statusCode);
  }
});

test("catalog refresh preserves typed body-read status instead of converting 413 to 400", async () => {
  const { routes } = createHarness({
    readJsonBody: async () => { throw Object.assign(new Error("body too large"), { statusCode: 413, code: "REQUEST_BODY_TOO_LARGE" }); },
  });
  await assert.rejects(routes[0].handler({ req: {}, res: {} }), (error) => (
    error.statusCode === 413 && error.code === "REQUEST_BODY_TOO_LARGE"
  ));
});

test("catalog refresh does not relabel unexpected body-stream errors as malformed 400", async () => {
  const { routes } = createHarness({
    readJsonBody: async () => { throw new Error("body stream failed"); },
  });
  await assert.rejects(routes[0].handler({ req: {}, res: {} }), (error) => (
    error.message === "body stream failed" && error.statusCode === undefined
  ));
});

test("catalog error serializer preserves typed status while redacting arbitrary upstream text", () => {
  for (const statusCode of [400, 409, 422, 502, 503, 599]) {
    const response = serializeProductCatalogError(
      Object.assign(new Error("upstream free text token raw-secret payload"), {
        statusCode,
        code: "UPSTREAM_FAILURE",
        endpoint: "token raw-secret",
        details: {
          requestId: "safe-request-1",
          operation: "manual-refresh",
          raw: "raw-secret",
        },
      }),
      "/api/product-catalog/refresh",
    );
    assert.equal(response.statusCode, statusCode);
    assert.equal(JSON.stringify(response).includes("upstream free text"), false);
    assert.equal(JSON.stringify(response).includes("raw-secret"), false);
    assert.equal(response.payload.endpoint, "/api/product-catalog/refresh");
  }
  const invalid = serializeProductCatalogError(new Error("free text"), "/api/product-catalog/refresh");
  assert.equal(invalid.statusCode, 500);
  assert.equal(invalid.payload.error.includes("free text"), false);
});

test("catalog error serializer preserves reviewed database operation details", () => {
  for (const operation of ["read-scope", "get-revision", "repository-bootstrap"]) {
    const response = serializeProductCatalogError(Object.assign(new Error("database unavailable"), {
      statusCode: 503,
      code: "SQLITE_BUSY",
      details: { requestId: "safe-db-request", operation },
    }));
    assert.equal(response.payload.details.operation, operation);
    assert.equal(response.payload.details.requestId, "safe-db-request");
    assert.equal(response.payload.details.code, "SQLITE_BUSY");
  }
});

test("generic dispatch invokes route serializers with dynamic status and fail-closed payloads", async () => {
  const sent = [];
  const logs = [];
  const route = {
    method: "POST",
    path: "/api/product-catalog/refresh",
    auth: "session",
    serializeError: serializeProductCatalogError,
    handler: async () => {
      throw Object.assign(new Error("upstream free text token raw-secret"), { statusCode: 422 });
    },
  };
  const handled = await dispatchApiRoute({
    req: {},
    res: {},
    url: new URL("http://localhost/api/product-catalog/refresh"),
    route,
    params: {},
    authorize: () => true,
    sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
    logger: { error: (...args) => logs.push(args) },
  });
  assert.equal(handled, true);
  assert.equal(sent[0].statusCode, 422);
  assert.equal(sent[0].payload.error.includes("token"), false);
  assert.equal(JSON.stringify(logs).includes("raw-secret"), false);

  const invalidSent = [];
  await dispatchApiRoute({
    req: {},
    res: {},
    url: new URL("http://localhost/api/product-catalog/refresh"),
    route: {
      ...route,
      handler: async () => { throw Object.assign(new Error("arbitrary upstream text"), { statusCode: 700 }); },
    },
    params: {},
    authorize: () => true,
    sendJson: (_res, statusCode, payload) => invalidSent.push({ statusCode, payload }),
    logger: { error: () => {} },
  });
  assert.equal(invalidSent[0].statusCode, 500);
  assert.equal(invalidSent[0].payload.error.includes("arbitrary"), false);
});

test("generic dispatch logs serializer failures with route context before safe 500", async () => {
  const sent = [];
  const logs = [];
  await dispatchApiRoute({
    req: {},
    res: {},
    url: new URL("http://localhost/api/catalog"),
    route: {
      method: "POST",
      path: "/api/catalog",
      handler: async () => {
        throw Object.assign(new Error("handler failure"), { statusCode: 422 });
      },
      serializeError: () => {
        throw Object.assign(new Error("serializer exploded token raw-secret"), {
          name: "SerializerError",
          code: "SERIALIZER_FAILED",
        });
      },
    },
    params: {},
    authorize: () => true,
    sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
    logger: { error: (...args) => logs.push(args) },
  });
  assert.equal(sent[0]?.statusCode, 500);
  assert.equal(sent[0]?.payload.ok, false);
  assert.doesNotMatch(JSON.stringify(sent[0]?.payload), /serializer exploded|raw-secret|token/);
  const serializerLog = logs.find(([prefix]) => prefix === "[api-serializer-error]");
  assert.ok(serializerLog);
  assert.deepEqual(serializerLog[1], {
    path: "/api/catalog",
    method: "POST",
    statusCode: 500,
    errorName: "SerializerError",
    errorCode: "SERIALIZER_FAILED",
  });
});

test("catalog health route always includes a nested degraded-safe productCatalog shape", async () => {
  const createHealthHarness = (getProductCatalogHealth) => {
    const sent = [];
    const logs = [];
    const routes = createCoreRoutes({
      config: { dataProvider: "mock", runtime: "test", dingtalk: { login: {} } },
      getSyncState: () => ({ running: false }),
      getProductCatalogHealth,
      sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
      logger: { error: (...args) => logs.push(args) },
      getSession: () => null,
      isAuthEnabled: () => false,
      isDingtalkLoginConfigured: () => false,
      isPasswordLoginEnabled: () => false,
    });
    return { routes, sent, logs };
  };

  const healthy = createHealthHarness(() => ({
    ok: true,
    status: "healthy",
    schemaVersion: 1,
    quickCheck: "ok",
  }));
  await healthy.routes.find((route) => route.path === "/api/health").handler({ req: {}, res: {} });
  assert.equal(healthy.sent[0]?.statusCode, 200);
  assert.equal(healthy.sent[0]?.payload.ok, true);
  assert.deepEqual(healthy.sent[0]?.payload.productCatalog, {
    ok: true,
    status: "healthy",
    schemaVersion: 1,
    quickCheck: "ok",
  });

  const degraded = createHealthHarness(() => { throw Object.assign(new Error("token raw payload"), { code: "SQLITE_CORRUPT" }); });
  await degraded.routes.find((route) => route.path === "/api/health").handler({ req: {}, res: {} });
  assert.equal(degraded.sent[0]?.payload.productCatalog.ok, false);
  assert.equal(degraded.sent[0]?.payload.productCatalog.error, "SQLITE_CORRUPT");
  assert.equal(JSON.stringify(degraded.sent[0]?.payload).includes("token"), false);
  assert.equal(degraded.sent[0]?.statusCode, 200);
  assert.equal(degraded.sent[0]?.payload.ok, true);
  assert.equal(degraded.logs.length, 1);
  assert.deepEqual(degraded.logs[0]?.[1], {
    operation: "health",
    status: "degraded",
    code: "SQLITE_CORRUPT",
  });
  assert.equal(JSON.stringify(degraded.logs).includes("token"), false);
});

test("catalog health preserves a bounded quick-check diagnostic", async () => {
  const sent = [];
  const routes = createCoreRoutes({
    config: { dataProvider: "mock", runtime: "test", dingtalk: { login: {} } },
    getSyncState: () => ({ running: false }),
    getProductCatalogHealth: () => ({
      ok: false,
      status: "degraded",
      schemaVersion: 1,
      quickCheck: "disk I/O error",
      error: "SQLITE_IOERR",
    }),
    sendJson: (_res, statusCode, payload) => sent.push({ statusCode, payload }),
    logger: { error() {} },
    getSession: () => null,
    isAuthEnabled: () => false,
    isDingtalkLoginConfigured: () => false,
    isPasswordLoginEnabled: () => false,
  });
  await routes.find((route) => route.path === "/api/health").handler({ req: {}, res: {} });
  assert.equal(sent[0]?.statusCode, 200);
  assert.equal(sent[0]?.payload.productCatalog.quickCheck, "disk I/O error");
  assert.equal(sent[0]?.payload.productCatalog.error, "SQLITE_IOERR");
  assert.doesNotMatch(JSON.stringify(sent[0]?.payload), /\/tmp|SELECT|token|raw|secret/i);
});

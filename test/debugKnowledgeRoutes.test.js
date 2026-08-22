import assert from "node:assert/strict";
import test from "node:test";

import { createDebugKnowledgeRoutes } from "../routes/debug-knowledge.js";

function createFixture({ enabled = false } = {}) {
  const responses = [];
  const auditEntries = [];
  let upstreamCalls = 0;
  let timestamp = Date.parse("2026-08-22T00:00:00.000Z");
  const adapter = {
    async debugOrderProfitReport() {
      upstreamCalls += 1;
      return { results: [] };
    },
    async debugProfitSources() {
      upstreamCalls += 1;
      return { results: [] };
    },
  };
  const routes = createDebugKnowledgeRoutes({
    config: { debug: { lingxingFinancialEnabled: enabled } },
    getLingxingAdapter: () => adapter,
    readSalesDashboardFilters: () => ({ startDate: "2026-08-01", endDate: "2026-08-22" }),
    sendJson: (_res, statusCode, payload) => responses.push({ statusCode, payload }),
    getPlatformCashflowDashboard: async () => ({}),
    debugInventoryProvisionSource: async () => ({}),
    debugLowInventoryLedgerSource: async () => ({}),
    listKnowledgeDocuments: async () => [],
    logger: { info: (...args) => auditEntries.push(args), warn: (...args) => auditEntries.push(args) },
    now: () => {
      timestamp += 1;
      return timestamp;
    },
  });
  return { routes, responses, auditEntries, getUpstreamCalls: () => upstreamCalls };
}

test("financial Lingxing debug routes are absent unless explicitly enabled", () => {
  const { routes } = createFixture();
  const paths = routes.map((route) => route.path);

  assert.equal(paths.includes("/api/debug/lingxing/order-profit"), false);
  assert.equal(paths.includes("/api/debug/lingxing/profit-sources"), false);
  assert.equal(paths.includes("/api/knowledge"), true);
});

test("enabled financial debug routes require admin authorization", () => {
  const { routes } = createFixture({ enabled: true });
  const financialRoutes = routes.filter((route) => [
    "/api/debug/lingxing/order-profit",
    "/api/debug/lingxing/profit-sources",
  ].includes(route.path));

  assert.equal(financialRoutes.length, 2);
  assert.ok(financialRoutes.every((route) => route.auth === "admin"));
});

test("financial debug routes share a five-per-minute actor limit and emit safe audit metadata", async () => {
  const { routes, responses, auditEntries, getUpstreamCalls } = createFixture({ enabled: true });
  const route = routes.find((item) => item.path === "/api/debug/lingxing/order-profit");
  const request = {
    user: {
      name: "Finance Admin",
      role: "系统管理员",
      accessToken: "must-not-be-logged",
    },
  };
  const url = new URL("http://localhost/api/debug/lingxing/order-profit?secret=must-not-be-logged");

  for (let index = 0; index < 5; index += 1) {
    await route.handler({ req: request, res: {}, url });
  }
  await assert.rejects(
    () => route.handler({ req: request, res: {}, url }),
    (error) => error?.code === "FINANCIAL_DEBUG_RATE_LIMITED" && error?.statusCode === 429,
  );

  assert.equal(getUpstreamCalls(), 5);
  assert.equal(responses.length, 5);
  assert.equal(auditEntries.length, 6);
  const serializedAudit = JSON.stringify(auditEntries);
  assert.equal(serializedAudit.includes("must-not-be-logged"), false);
  assert.match(serializedAudit, /Finance Admin/);
  assert.match(serializedAudit, /rate-limited/);
  assert.match(serializedAudit, /2026-08-01/);
});

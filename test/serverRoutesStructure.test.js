import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { buildApiRoutes } from "../routes/index.js";
import { createInventoryRoutes } from "../routes/inventory.js";

const routeFiles = [
  "auth.js",
  "core.js",
  "sales.js",
  "advertising.js",
  "aftersales.js",
  "inventory.js",
  "finance-purchase.js",
  "fba.js",
  "admin.js",
  "webhook-assistant.js",
  "sync-store-inspection.js",
  "debug-knowledge.js",
  "product-catalog.js",
];

test("API routes are split into domain route modules", async () => {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverSource, /import \{ buildApiRoutes \} from "\.\/routes\/index\.js";/);
  assert.match(serverSource, /import \{ dispatchApiRoute as dispatchRoute \} from "\.\/routes\/api-dispatch\.js";/);
  assert.match(serverSource, /const apiRoutes = createApiRoutes\(buildApiRoutes\(\{/);

  for (const file of routeFiles) {
    await access(new URL(`../routes/${file}`, import.meta.url));
  }
});

test("route table requires every API route to declare auth", () => {
  const routes = buildApiRoutes({});

  assert.ok(routes.length >= 90, `expected all API routes to be registered, got ${routes.length}`);

  for (const route of routes) {
    assert.ok(route.method, "route is missing method");
    assert.ok(route.path || route.pattern, `${route.method} route is missing path or pattern`);
    assert.ok(Object.hasOwn(route, "auth"), `${route.method} ${route.path || route.pattern} is missing auth`);
    assert.ok(["none", "session", "finance", "admin"].includes(route.auth), `${route.method} ${route.path || route.pattern} has unsupported auth ${route.auth}`);
    assert.equal(typeof route.handler, "function", `${route.method} ${route.path || route.pattern} is missing handler`);
  }

  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/dashboard/payables")?.auth, "finance");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/dashboard/supplier-board")?.auth, "finance");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/finance/store-operating-monthly-report")?.auth, "finance");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/finance/store-operating-monthly-report/export")?.auth, "finance");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/purchase/supplier-details")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/admin/budget/uploads")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/admin/budget/upload")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/fba/jiufang/channels")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/fba/jiufang/orders/dry-run")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/fba/jiufang/orders/create")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/product-catalog/refresh")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/webhook-assistant/tasks")?.auth, "admin");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/webhook-assistant/tasks")?.auth, "admin");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/dashboard/clearance-inventory"), undefined);
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/dashboard/slow-moving-risk/live")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/dashboard/slow-moving-risk/reports")?.auth, "session");
  assert.ok(routes.some((route) => route.method === "GET" && route.pattern?.toString().includes("slow-moving-risk")));
});

test("product catalog route is composed from service entry points without refresh business logic in server", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /getProductCatalogHealth/);
  assert.match(source, /refreshProductCatalogScope/);
  assert.equal((source.match(/refreshProductCatalogScope\s*\(/g) || []).length, 0);
  assert.equal(source.includes("/api/product-catalog/refresh"), false);
  assert.equal(source.includes("SAFE_PRODUCT_CATALOG"), false);
});

test("server router no longer contains legacy API if-else branches", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const routerBody = source.slice(
    source.indexOf("async function router"),
    source.indexOf("startSyncScheduler();"),
  );

  assert.match(routerBody, /if \(await dispatchApiRoute\(req, res, url\)\) return;/);
  assert.equal(routerBody.includes('url.pathname === "/api'), false);
  assert.equal(routerBody.includes('url.pathname.startsWith("/api'), false);
  assert.equal(routerBody.includes("url.pathname.match(/^\\/api"), false);
  assert.equal(routerBody.includes("requireFinance(req, res)"), false);
  assert.equal(routerBody.includes("requireAdmin(req, res)"), false);
});

test("slow-moving-risk live route forwards the confirmed filter fields", async () => {
  let received = null;
  let payload = null;
  const route = createInventoryRoutes({
    sendJson: (_res, _status, value) => { payload = value; },
    getSlowMovingRiskDashboard: async (value) => { received = value; return { rows: [] }; },
    listSlowMovingRiskReports: async () => [],
    readSlowMovingRiskReport: async () => null,
  }).find((item) => item.path === "/api/dashboard/slow-moving-risk/live");

  await route.handler({
    res: {},
    url: new URL("http://localhost/api/dashboard/slow-moving-risk/live?country=US&storeName=tandanbo-US&listingOwner=Max&riskLevel=%E9%AB%98%E9%A3%8E%E9%99%A9&currencyCode=USD"),
  });

  assert.deepEqual(received, { filters: { country: "US", storeName: "tandanbo-US", listingOwner: "Max", riskLevel: "高风险", currencyCode: "USD" } });
  assert.deepEqual(payload, { rows: [] });
});

test("inventory provision cost refresh route is finance-protected and forwards its selected month", async () => {
  let received = null;
  let payload = null;
  const route = createInventoryRoutes({
    readJsonBody: async () => ({ date: "2026-05" }),
    refreshInventoryProvisionCosts: async (value) => {
      received = value;
      return { date: value.date, comparisonMonth: "2026-04", months: [] };
    },
    sendJson: (_res, _status, value) => { payload = value; },
  }).find((item) => item.path === "/api/dashboard/inventory-provision/refresh-costs");

  assert.equal(route?.method, "POST");
  assert.equal(route?.auth, "finance");
  await route.handler({ req: {}, res: {} });
  assert.deepEqual(received, { date: "2026-05" });
  assert.deepEqual(payload, { ok: true, refresh: { date: "2026-05", comparisonMonth: "2026-04", months: [] } });
});

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { buildApiRoutes } from "../routes/index.js";

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
];

test("API routes are split into domain route modules", async () => {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverSource, /import \{ buildApiRoutes \} from "\.\/routes\/index\.js";/);
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
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/purchase/supplier-details")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/admin/budget/uploads")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/admin/budget/upload")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/fba/jiufang/channels")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/fba/jiufang/orders/dry-run")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/fba/jiufang/orders/create")?.auth, "session");
  assert.equal(routes.find((route) => route.method === "GET" && route.path === "/api/webhook-assistant/tasks")?.auth, "admin");
  assert.equal(routes.find((route) => route.method === "POST" && route.path === "/api/webhook-assistant/tasks")?.auth, "admin");
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

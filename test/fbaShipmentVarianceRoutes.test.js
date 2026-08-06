import assert from "node:assert/strict";
import test from "node:test";

import { createFbaRoutes } from "../routes/fba.js";

function createRoutes(overrides = {}) {
  return createFbaRoutes({
    readFbaShipmentVarianceFilters: (url) => ({ startDate: url.searchParams.get("startDate") || "" }),
    readJsonBody: async () => ({ followupStatus: "调查中" }),
    sendJson: (_res, status, payload) => { overrides.sent.push({ status, payload }); },
    getFbaShipmentVariances: async (filters) => ({ ok: true, filters, rows: [] }),
    markFbaShipmentVarianceFollowup: async (input) => ({ ...input, followedUp: true }),
    clearFbaShipmentVarianceFollowup: async (input) => ({ ...input, followedUp: false }),
    ...overrides,
  });
}

test("shipment variance routes are session-authenticated and preserve filters plus operator audit", async () => {
  const sent = [];
  const routes = createRoutes({ sent });
  const listRoute = routes.find((route) => route.path === "/api/fba/shipment-variances");
  const markRoute = routes.find((route) => route.method === "PUT" && route.pattern?.toString().includes("shipment-variances"));
  const clearRoute = routes.find((route) => route.method === "DELETE" && route.pattern?.toString().includes("shipment-variances"));

  assert.equal(listRoute?.auth, "session");
  assert.equal(markRoute?.auth, "session");
  assert.equal(clearRoute?.auth, "session");

  await listRoute.handler({ res: {}, url: new URL("http://localhost/api/fba/shipment-variances?startDate=2026-07-05") });
  await markRoute.handler({
    req: { user: { displayName: "Alice" } },
    res: {},
    params: { sid: "8708", shipmentId: "FBA18QJFDCWJ" },
  });
  await clearRoute.handler({
    req: { user: { username: "Bob" } },
    res: {},
    params: { sid: "8708", shipmentId: "FBA18QJFDCWJ" },
  });

  assert.deepEqual(sent, [
    { status: 200, payload: { ok: true, filters: { startDate: "2026-07-05" }, rows: [] } },
    { status: 200, payload: { ok: true, row: { sid: "8708", shipmentId: "FBA18QJFDCWJ", operator: "Alice", followupStatus: "调查中", followedUp: true } } },
    { status: 200, payload: { ok: true, row: { sid: "8708", shipmentId: "FBA18QJFDCWJ", operator: "Bob", followedUp: false } } },
  ]);
});

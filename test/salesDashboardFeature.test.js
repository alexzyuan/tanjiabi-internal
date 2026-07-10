import assert from "node:assert/strict";
import test from "node:test";

import { createSalesDashboardFeature } from "../assets/js/features/sales-dashboard.js";

function createFeature(overrides = {}) {
  return createSalesDashboardFeature({
    bind: () => null,
    bindAll: () => [],
    buildDashboardQuery: () => "startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL",
    ...overrides,
  });
}

test("sales dashboard feature loads the sales weekly endpoint with the dashboard query", async () => {
  const requests = [];
  const { loadDashboard } = createFeature({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ meta: { source: "mock" }, summary: [["销售额", "100"]] }),
      };
    },
  });

  const dashboard = await loadDashboard();

  assert.equal(dashboard.meta.source, "mock");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/api\/dashboard\/sales-weekly\?startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL&_=.+/);
  assert.deepEqual(requests[0].options, { cache: "no-store", credentials: "same-origin" });
});

test("sales dashboard feature redirects on an expired session and returns fallback data", async () => {
  let redirectCount = 0;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const { loadDashboard } = createFeature({
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized" }),
      }),
      redirectToLogin: () => {
        redirectCount += 1;
      },
    });

    const dashboard = await loadDashboard();

    assert.equal(redirectCount, 1);
    assert.equal(dashboard.meta.source, "接口未连接");
    assert.match(dashboard.meta.syncStatus, /登录状态已失效/);
  } finally {
    console.info = originalInfo;
  }
});

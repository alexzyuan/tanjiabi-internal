import assert from "node:assert/strict";
import test from "node:test";

import { LingxingAdapter } from "../src/adapters/lingxingAdapter.js";
import { buildBudgetMskuDetailRows } from "../src/services/lingxingDashboardMapper.js";

const lingxingTestConfig = {
  baseUrl: "https://openapi.test/",
  appKey: "1234567890abcdef",
  appSecret: "secret",
};

test("OrderProfit shipping_cost remains buyer shipping and is not normalized as first-leg cost", () => {
  const adapter = new LingxingAdapter(lingxingTestConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1,
    shipping_cost: "12.50",
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);

  assert.equal(row.shipping_cost, "12.50");
  assert.equal(row.firstLegCost, "");
});

test("dashboard MSKU detail excludes buyer shipping aliases from first-leg cost", () => {
  const rows = buildBudgetMskuDetailRows([
    {
      sid: 1,
      storeName: "Amazon-US",
      country: "美国",
      msku: "MSKU-1",
      amount: 100,
      shipping_cost: 12,
      shippingCost: 8,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstLegCostRate, 0);
});

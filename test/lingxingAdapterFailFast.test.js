import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

test("LingxingAdapter exposes uncached fact loaders and no retired JSON cache methods", async () => {
  const projectRoot = process.cwd();
  const source = await readFile(new URL("../src/adapters/lingxingAdapter.js", import.meta.url), "utf8");
  const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
  const adapter = new LingxingAdapter({
    baseUrl: "https://openapi.test/",
    appKey: "1234567890abcdef",
    appSecret: "secret",
  });

  assert.equal(typeof adapter.fetchMskuOrderProfit, "function");
  assert.equal(adapter.fetchMskuOrderProfitCached, undefined);
  assert.equal(adapter.fetchSalesWeeklyData, undefined);
  assert.equal(adapter.fetchOrderProfitReportCached, undefined);
  assert.equal(adapter.fetchSellerProfitReportCached, undefined);
  assert.doesNotMatch(source, /readOrderProfitCache|saveOrderProfitCache|fetchMskuOrderProfitCached|orderProfitInflight/);
  assert.doesNotMatch(source, /readProfitReportCache|saveProfitReportCache|fetchOrderProfitReportCached|fetchSellerProfitReportCached/);
});

test("uncached OrderProfit loader keeps the explicit CNY request contract", async () => {
  const projectRoot = process.cwd();
  const { LingxingAdapter } = await importFresh(projectRoot, "src/adapters/lingxingAdapter.js");
  const adapter = new LingxingAdapter({
    baseUrl: "https://openapi.test/",
    appKey: "1234567890abcdef",
    appSecret: "secret",
  });
  const requests = [];
  adapter.signedRequest = async (endpoint, options) => {
    requests.push({ endpoint, options });
    return { data: { records: [], total: 0 } };
  };

  const payload = await adapter.fetchMskuOrderProfit({
    startDate: "2026-08-01",
    endDate: "2026-08-09",
    sids: [8708],
    currencyCode: "CNY",
  });

  assert.deepEqual(payload.data.records, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, "/basicOpen/finance/mreport/OrderProfit");
  assert.equal(requests[0].options.params.currencyCode, "CNY");
  assert.equal(requests[0].options.params.startDate, "2026-08-01");
  assert.equal(requests[0].options.params.endDate, "2026-08-09");
});

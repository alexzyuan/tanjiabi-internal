import assert from "node:assert/strict";
import test from "node:test";

import { createSlowMovingRiskFeature } from "../assets/js/features/slow-moving-risk.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const feature = createSlowMovingRiskFeature({
    root: { querySelector: () => null, querySelectorAll: () => [] },
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    escapeHtml: (value) => String(value ?? ""),
    fetchImpl: async () => ({ ok: true, json: async () => ({ reports: [] }) }),
    formatActualMoney: (value) => String(value),
    formatNumber: (value) => String(value),
    formatPercent: (value) => String(value),
    selectedFilterValues: () => [],
    setButtonBusy: () => {},
    setSelectOptions: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    ...overrides,
  });
  return { bindCalls, bindAllCalls, feature };
}

test("slow-moving risk feature owns its tab, refresh and filter bindings", () => {
  const { bindCalls, bindAllCalls, feature } = createFeature();

  feature.setupSlowMovingRisk();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName]) => [selector, eventName]),
    [
      ["#slow-moving-risk-refresh", "click"],
      ["#slow-moving-risk-country-filter", "change"],
      ["#slow-moving-risk-store-filter", "change"],
      ["#slow-moving-risk-owner-filter", "change"],
      ["#slow-moving-risk-level-filter", "change"],
      ["#slow-moving-risk-currency-filter", "change"],
      ["#slow-moving-risk-history-select", "change"],
    ],
  );
  assert.deepEqual(
    bindAllCalls.map(([, selector, eventName]) => [selector, eventName]),
    [
      ["[data-slow-moving-risk-tab]", "click"],
      ["[data-slow-moving-risk-tab]", "keydown"],
    ],
  );
});

test("slow-moving risk feature sends the selected original currency to the live report", async () => {
  const calls = [];
  const filters = {
    "#slow-moving-risk-currency-filter": { value: "USD" },
    "#slow-moving-risk-owner-filter": { value: "" },
    "#slow-moving-risk-level-filter": { value: "" },
  };
  const { feature } = createFeature({
    root: { querySelector: (selector) => filters[selector] || null, querySelectorAll: () => [] },
    selectedFilterValues: (selector) => selector === "#slow-moving-risk-currency-filter" ? ["USD"] : [],
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          dateRange: { endDate: "2026-07-26" },
          filters: {},
          kpis: {},
          rows: [],
          meta: { generatedAt: "2026-07-29T01:00:00.000Z", dataSources: {} },
        }),
      };
    },
  });

  await feature.loadSlowMovingRiskLive();

  assert.deepEqual(calls, ["/api/dashboard/slow-moving-risk/live?currencyCode=USD"]);
});

test("slow-moving risk feature renders each formerly combined metric in its own table cell", () => {
  const table = { innerHTML: "" };
  const { feature } = createFeature({
    root: { querySelector: (selector) => selector === "#slow-moving-risk-table" ? table : null, querySelectorAll: () => [] },
  });

  feature.renderDashboard({
    dateRange: { endDate: "2026-07-26" },
    kpis: {},
    rows: [{
      riskLevel: "高风险", storeName: "tandanbo-US", country: "美国", currencyCode: "USD", msku: "US-SKU",
      availableQuantity: 20, agedQuantity: 10, inventoryAmount: 200, agedInventoryAmount: 100,
      historicalDaysOfSupply: 130, cashConversionRate: 0.12, recent30SalesQuantity: 5,
      recent30GrossProfit: -15, averageGrossProfit: -3, recent30AdSpend: 12,
      adShare: 0.2, acos: null, cashRiskAmount: 130,
      clearanceRecoveryOriginal: 99, liquidationRecoveryOriginal: 10,
      removalFeeStatus: "unavailable", removalFeeReason: "缺少尺寸/重量，无法计算",
      recommendation: "停止广告并降价清仓", recommendationReason: "测试原因",
    }],
    meta: { generatedAt: "2026-07-29T01:00:00.000Z", dataSources: {} },
  });

  assert.equal((table.innerHTML.match(/<td>/g) || []).length, 22);
  assert.match(table.innerHTML, /<td>tandanbo-US<\/td>\s*<td>美国<\/td>/);
  assert.match(table.innerHTML, /<td>20<\/td>\s*<td><strong>10<\/strong><\/td>/);
  assert.match(table.innerHTML, /<td>不可用<\/td>/);
  assert.match(table.innerHTML, /<td>USD 99<\/td>\s*<td>USD 10<\/td>/);
});

test("slow-moving risk feature opens the latest successful weekly snapshot by default", async () => {
  const calls = [];
  const { feature } = createFeature({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === "/api/dashboard/slow-moving-risk/reports") {
        return { ok: true, json: async () => ({ reports: [{ reportKey: "2026-07-26", status: "success" }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          dashboard: {
            dateRange: { endDate: "2026-07-26" },
            kpis: {},
            rows: [],
            meta: { generatedAt: "2026-07-29T01:00:00.000Z", dataSources: {} },
          },
        }),
      };
    },
  });

  await feature.loadSlowMovingRiskView();

  assert.deepEqual(calls, [
    "/api/dashboard/slow-moving-risk/reports",
    "/api/dashboard/slow-moving-risk/reports/2026-07-26",
  ]);
});

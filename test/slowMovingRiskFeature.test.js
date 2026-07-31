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

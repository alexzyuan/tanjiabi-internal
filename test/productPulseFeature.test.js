import assert from "node:assert/strict";
import test from "node:test";

import { createProductPulseFeature } from "../assets/js/features/product-pulse.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const feature = createProductPulseFeature({
    root: { querySelector: () => null },
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    buildDashboardQuery: () => "startDate=2026-07-07&endDate=2026-07-07",
    getFrontDateEnd: () => "2026-07-07",
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatNumber: (value) => String(value),
    formatPercent: (value) => String(value),
    renderTableMessage: () => {},
    setText: () => {},
    ...overrides,
  });
  return { bindCalls, feature };
}

test("product pulse feature owns its refresh and date bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupProductPulse();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#pulse-refresh-button", "click", feature.loadProductPulse],
      ["#pulse-date", "change", feature.loadProductPulse],
    ],
  );
});

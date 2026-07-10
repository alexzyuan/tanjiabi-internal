import assert from "node:assert/strict";
import test from "node:test";

import { createLowInventoryFeeFeature } from "../assets/js/features/low-inventory-fee.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createLowInventoryFeeFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatNumber: (value) => String(value),
    getDefaultDate: () => "2026-07-07",
    renderTableMessage: () => {},
    selectedFilterValue: () => "",
    selectedFilterValues: () => [],
    setSelectOptions: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, feature };
}

test("low inventory fee feature owns its DOM event bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupLowInventoryFee();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#lowfee-refresh", "click", feature.loadLowInventoryFee],
      ["#lowfee-date", "change", feature.loadLowInventoryFee],
      ["#lowfee-country", "change", bindCalls[2][3]],
      ["#lowfee-store", "change", bindCalls[3][3]],
      ["#lowfee-only-risk", "change", feature.loadLowInventoryFee],
      ["#lowfee-keyword", "keydown", bindCalls[5][3]],
    ],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { createAdKeywordFeature } from "../assets/js/features/ad-keywords.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const debouncedActions = [];
  const feature = createAdKeywordFeature({
    root: { querySelector: () => null },
    loadDashboardSection: async () => {},
    addDays: (date) => date,
    bind: (...args) => bindCalls.push(args),
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatDate: () => "2026-07-07",
    formatMetricNumber: (value) => String(value),
    formatRateNullable: (value) => String(value),
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, debouncedActions, feature };
}

test("ad keyword feature owns its refresh, filter, and debounced search bindings", () => {
  const { bindCalls, debouncedActions, feature } = createFeature();

  feature.setupAdKeywordDashboard();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 350);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#ads-keyword-refresh", "click", feature.loadAdKeywordDashboard],
      ["#ads-keyword-end-date", "change", feature.loadAdKeywordDashboard],
      ["#ads-keyword-category", "change", feature.loadAdKeywordDashboard],
      ["#ads-keyword-search", "input", debouncedActions[0].debounced],
    ],
  );
});

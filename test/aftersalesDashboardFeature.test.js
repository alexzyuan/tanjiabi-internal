import assert from "node:assert/strict";
import test from "node:test";

import { createAftersalesDashboardFeature } from "../assets/js/features/aftersales-dashboard.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const debouncedActions = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createAftersalesDashboardFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatDate: () => "2026-07-07",
    formatNumber: (value) => String(value),
    formatPercent: (value) => String(value),
    getPacificTodayText: () => "2026-07-07",
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, debouncedActions, feature };
}

test("aftersales dashboard owns refresh, date, type, and keyword bindings", () => {
  const { bindCalls, debouncedActions, feature } = createFeature();

  feature.setupAftersalesDashboard();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 350);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#aftersales-refresh-button", "click", feature.loadAftersalesDashboard],
      ["#aftersales-start-date", "change", debouncedActions[0].debounced],
      ["#aftersales-end-date", "change", debouncedActions[0].debounced],
      ["#aftersales-date-type", "change", debouncedActions[0].debounced],
      ["#aftersales-keyword", "input", debouncedActions[0].debounced],
    ],
  );
});

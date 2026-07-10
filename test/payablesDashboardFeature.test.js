import assert from "node:assert/strict";
import test from "node:test";

import { createPayablesDashboardFeature } from "../assets/js/features/payables-dashboard.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const debouncedActions = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createPayablesDashboardFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    closestTarget: () => null,
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatDate: (date) => date.toISOString().slice(0, 10),
    setActiveElementState: () => {},
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindAllCalls, bindCalls, debouncedActions, feature };
}

test("payables dashboard owns its DOM event bindings and debounced search", () => {
  const { bindAllCalls, bindCalls, debouncedActions, feature } = createFeature();

  feature.setupPayablesDashboard();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 350);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#payables-refresh-button", "click", feature.loadPayablesDashboard],
      ["#payables-start-month", "change", feature.loadPayablesDashboard],
      ["#payables-end-month", "change", feature.loadPayablesDashboard],
      ["#payables-supplier", "input", debouncedActions[0].debounced],
      ["#payables-carrier", "input", debouncedActions[0].debounced],
    ],
  );
  assert.deepEqual(bindAllCalls.map(([, selector, eventName]) => [selector, eventName]), [[".payable-tabs", "click"]]);
});

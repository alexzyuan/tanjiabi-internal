import assert from "node:assert/strict";
import test from "node:test";

import { createFactoryInventoryFeature } from "../assets/js/features/factory-inventory.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const debouncedActions = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createFactoryInventoryFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    checkedField: () => false,
    closestTarget: () => null,
    compareTableSortableValues: () => 0,
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    renderTableMessage: () => {},
    setTableSortButtonGroupState: () => {},
    setText: () => {},
    trimmedFieldValue: () => "",
    windowApi: { clearTimeout: () => {}, setTimeout: () => 0 },
    ...overrides,
  });
  return { bindAllCalls, bindCalls, debouncedActions, feature };
}

test("factory inventory owns refresh, export, sorting, shipped quantity, and filter bindings", () => {
  const { bindAllCalls, bindCalls, debouncedActions, feature } = createFeature();

  feature.setupFactoryInventory();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 350);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#factory-inventory-refresh", "click", bindCalls[0][3]],
      ["#factory-inventory-export", "click", feature.exportFactoryInventoryExcel],
      ["#factory-inventory-table thead", "click", bindCalls[2][3]],
      ["#factory-inventory-table tbody", "input", bindCalls[3][3]],
      ["#factory-inventory-table tbody", "change", bindCalls[4][3]],
      ["#factory-inventory-table tbody", "focusout", bindCalls[5][3]],
      ["#factory-inventory-start-date", "change", debouncedActions[0].debounced],
      ["#factory-inventory-end-date", "change", debouncedActions[0].debounced],
      ["#factory-inventory-factory", "input", debouncedActions[0].debounced],
      ["#factory-inventory-keyword", "input", debouncedActions[0].debounced],
      ["#factory-inventory-only-remaining", "change", debouncedActions[0].debounced],
    ],
  );
  assert.deepEqual(
    bindAllCalls.map(([, selector, eventName]) => [selector, eventName]),
    [["#factory-inventory-table .factory-inventory-sort-button", "click"]],
  );
});

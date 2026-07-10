import assert from "node:assert/strict";
import test from "node:test";

import { createSupplierBoardFeature } from "../assets/js/features/supplier-board.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createSupplierBoardFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    closestTarget: () => null,
    compareTableSortableValues: () => 0,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatRateNullable: (value) => String(value),
    normalizeCountryName: (value) => String(value ?? ""),
    selectedFilterValues: () => [],
    setSelectOptions: () => {},
    setTableSortButtonGroupState: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindAllCalls, bindCalls, feature };
}

test("supplier board owns refresh, export, sorting, date, and filter bindings", () => {
  const { bindAllCalls, bindCalls, feature } = createFeature();

  feature.setupSupplierBoard();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#supplier-board-refresh", "click", bindCalls[0][3]],
      ["#supplier-board-export", "click", feature.exportSupplierBoardExcel],
      ["#supplier-board-table thead", "click", bindCalls[2][3]],
      ["#supplier-board-dimension", "change", feature.handleSupplierBoardDimensionChange],
      ["#supplier-board-start-date", "change", feature.loadSupplierBoard],
      ["#supplier-board-end-date", "change", feature.loadSupplierBoard],
      ["#supplier-board-country", "change", feature.handleSupplierBoardCountryChange],
      ["#supplier-board-store", "change", feature.handleSupplierBoardStoreChange],
      ["#supplier-board-supplier", "input", feature.renderSupplierBoard],
      ["#supplier-board-keyword", "input", feature.renderSupplierBoard],
    ],
  );
  assert.deepEqual(
    bindAllCalls.map(([, selector, eventName]) => [selector, eventName]),
    [["#supplier-board-table .supplier-sort-button", "click"]],
  );
});

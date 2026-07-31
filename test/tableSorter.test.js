import assert from "node:assert/strict";
import test from "node:test";

import {
  compareTableSortableValues,
  createTableSorter,
  parseTableSortableDate,
  parseTableSortableNumber,
} from "../assets/js/table-sorter.js";

test("table sorter parses compact money and Chinese unit values", () => {
  assert.equal(parseTableSortableNumber("¥1,234.50"), 1234.5);
  assert.equal(parseTableSortableNumber("2.5万"), 25000);
  assert.equal(parseTableSortableNumber("1.2亿"), 120000000);
  assert.equal(parseTableSortableNumber("-"), null);
});

test("table sorter compares dates, numbers, and text consistently", () => {
  assert.ok(parseTableSortableDate("2026-07-05") < parseTableSortableDate("2026-07-06"));
  assert.ok(compareTableSortableValues("2万", "19999") > 0);
  assert.ok(compareTableSortableValues("2026/07/05", "2026/07/06") < 0);
  assert.ok(compareTableSortableValues("MSKU-2", "MSKU-10") < 0);
  assert.ok(compareTableSortableValues("", "1") > 0);
});

test("table sorter owns the document click bridge for header sorting", () => {
  const root = {};
  let generatedButton = null;
  const targetHeader = {
    closest: () => null,
    querySelector: (selector) => (selector === ".sort-button" ? generatedButton : null),
  };
  const bindCalls = [];
  const closestCalls = [];
  const sorter = createTableSorter({
    root,
    bindEventTarget: (...args) => {
      bindCalls.push(args);
      return args[0];
    },
    closestTarget: (event, selector) => {
      closestCalls.push(selector);
      if (selector === ".sort-button") return null;
      if (selector === "th") return targetHeader;
      return null;
    },
    getApplyFactoryInventorySort: () => null,
    getApplyMskuDetailSort: () => null,
    getApplySupplierBoardSort: () => null,
    setTableSortState: () => {},
  });
  sorter.setupTableSortBridge();
  bindCalls[0][2]({ target: targetHeader });

  assert.deepEqual(bindCalls.map(([target, eventName]) => [target, eventName]), [[root, "click"]]);
  assert.deepEqual(closestCalls, [".sort-button", "th"]);
});

test("table sorter routes generated sort buttons through generic table sorting", () => {
  const appendedRows = [];
  const rowHigh = { cells: [{ textContent: "2" }], querySelector: () => null };
  const rowLow = { cells: [{ textContent: "1" }], querySelector: () => null };
  const tbody = {
    rows: [rowHigh, rowLow],
    appendChild(row) {
      appendedRows.push(row);
    },
  };
  const table = {
    dataset: {},
    id: "generic-table",
    tBodies: [tbody],
  };
  const headerRow = { children: [] };
  let generatedButton = null;
  const targetHeader = {
    colSpan: 1,
    dataset: {},
    parentElement: headerRow,
    closest(selector) {
      if (selector === ".login-body") return null;
      if (selector === "table") return table;
      return null;
    },
    querySelector: (selector) => (selector === ".sort-button" ? generatedButton : null),
  };
  headerRow.children = [targetHeader];
  generatedButton = {
    dataset: { tableSort: "amount" },
    closest: (selector) => (selector === "th" ? targetHeader : null),
  };
  const bindCalls = [];
  const stateCalls = [];
  const sorter = createTableSorter({
    root: {},
    bindEventTarget: (...args) => {
      bindCalls.push(args);
      return args[0];
    },
    closestTarget: (event, selector) => (selector === ".sort-button" ? generatedButton : targetHeader),
    setTableSortState: (...args) => stateCalls.push(args),
  });

  sorter.setupTableSortBridge();
  bindCalls[0][2]({ target: generatedButton });

  assert.deepEqual(appendedRows, [rowLow, rowHigh]);
  assert.equal(table.dataset.sortColumn, "0");
  assert.equal(table.dataset.sortDirection, "asc");
  assert.equal(stateCalls.at(-1)[0], targetHeader);
  assert.equal(stateCalls.at(-1)[1], true);
  assert.equal(stateCalls.at(-1)[2], "asc");
  assert.equal(stateCalls.at(-1)[3], generatedButton);
});

test("table sorter click bridge ignores feature-owned sort buttons", () => {
  const bindCalls = [];
  const sorter = createTableSorter({
    root: {},
    bindEventTarget: (...args) => {
      bindCalls.push(args);
      return args[0];
    },
    closestTarget: (event, selector) => (selector === ".sort-button" ? {} : null),
    setTableSortState: () => {},
  });

  sorter.setupTableSortBridge();
  bindCalls[0][2]({});

  assert.equal(bindCalls.length, 1);
});

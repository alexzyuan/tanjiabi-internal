import assert from "node:assert/strict";
import test from "node:test";

import { createSalesShell } from "../assets/js/sales-shell.js";
import { createSharedFilterStateStore } from "../assets/js/shared-filter-state.js";

function makeElement(extra = {}) {
  return {
    hidden: false,
    innerHTML: "",
    previousElementSibling: null,
    textContent: "",
    value: "",
    removeCalled: false,
    remove() {
      this.removeCalled = true;
    },
    after(element) {
      element.previousElementSibling = this;
    },
    ...extra,
  };
}

function makeRoot(elements) {
  return {
    body: {
      prepended: [],
      prepend(element) {
        this.prepended.push(element);
      },
    },
    createElement(tagName) {
      return makeElement({ tagName });
    },
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
}

function fieldValue(selectorOrElement, fallback = "", root) {
  const element = typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement;
  return element?.value ?? fallback;
}

function setElementsHidden(selectorOrElement, hidden, root) {
  const elements = Array.isArray(selectorOrElement)
    ? selectorOrElement.map((selector) => root.querySelector(selector)).filter(Boolean)
    : [typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement].filter(Boolean);
  elements.forEach((element) => {
    element.hidden = hidden;
  });
  return elements;
}

function setText(selectorOrElement, text, root) {
  const element = typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement;
  if (element) element.textContent = text;
}

function createShell(root) {
  return createSalesShell({
    root,
    bind: () => {},
    bindAll: () => {},
    bindClickOutside: () => {},
    fieldValue,
    formatDate: (date) => date.toISOString().slice(0, 10),
    getDateRangeByPreset: () => [new Date("2026-07-01T00:00:00Z"), new Date("2026-07-06T00:00:00Z")],
    getDefaultFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-07" }),
    setElementsHidden,
    setText,
  });
}

test("sales shell owns front date range control bindings", () => {
  const bindCalls = [];
  const bindAllCalls = [];
  const clickOutsideCalls = [];
  const pickerCalls = [];
  const pickerApi = {
    closeCalls: 0,
    setupCalls: 0,
    close() {
      this.closeCalls += 1;
    },
    setup() {
      this.setupCalls += 1;
    },
  };
  let refreshCount = 0;
  const elements = {
    "#front-date-range-popover": makeElement({ hidden: true }),
    ".date-range-control": makeElement(),
  };
  const root = makeRoot(elements);
  const shell = createSalesShell({
    root,
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    bindClickOutside: (...args) => clickOutsideCalls.push(args),
    createDateRangePickerImpl: (options) => {
      pickerCalls.push(options);
      return pickerApi;
    },
    fieldValue,
    formatDate: (date) => date.toISOString().slice(0, 10),
    getDateRangeByPreset: () => [new Date("2026-07-01T00:00:00Z"), new Date("2026-07-06T00:00:00Z")],
    getDefaultFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-07" }),
    onDateRangeChange: () => {
      refreshCount += 1;
    },
    setElementsHidden,
    setText,
  });

  shell.setupFrontDateRangeControls();

  assert.deepEqual(bindCalls, []);
  assert.deepEqual(bindAllCalls, []);
  assert.equal(pickerCalls.length, 1);
  assert.deepEqual({
    triggerSelector: pickerCalls[0].triggerSelector,
    popoverSelector: pickerCalls[0].popoverSelector,
    startInputSelector: pickerCalls[0].startInputSelector,
    endInputSelector: pickerCalls[0].endInputSelector,
  }, {
    triggerSelector: "#front-date-range-button",
    popoverSelector: "#front-date-range-popover",
    startInputSelector: "#front-date-start",
    endInputSelector: "#front-date-end",
  });
  assert.equal(pickerApi.setupCalls, 1);
  assert.deepEqual(clickOutsideCalls.map(([, selector]) => selector), [".date-range-control"]);

  pickerCalls[0].onChange({ start: "2026-07-01", end: "2026-07-06" });
  clickOutsideCalls[0][2]();

  assert.equal(refreshCount, 1);
  assert.equal(pickerApi.closeCalls, 1);
  assert.equal(elements["#front-date-range-popover"].hidden, true);
});

test("sales shell owns front date range state and popover visibility", () => {
  const elements = {
    "#front-date-start": makeElement(),
    "#front-date-end": makeElement(),
    "#front-date-range-button": makeElement(),
    "#front-date-range-popover": makeElement({ hidden: true }),
  };
  const root = makeRoot(elements);
  const shell = createShell(root);

  assert.deepEqual(shell.resetFrontDateRange(), { start: "2026-07-01", end: "2026-07-07" });
  assert.equal(elements["#front-date-start"].value, "2026-07-01");
  assert.equal(elements["#front-date-end"].value, "2026-07-07");
  assert.equal(elements["#front-date-range-button"].textContent, "2026-07-01 - 2026-07-07");

  shell.toggleFrontDatePopover();
  assert.equal(elements["#front-date-range-popover"].hidden, false);
  shell.applyFrontDatePreset("month");
  assert.deepEqual(shell.getFrontDateRange(), { start: "2026-07-01", end: "2026-07-06" });
  assert.equal(elements["#front-date-range-popover"].hidden, true);

  elements["#front-date-start"].value = "2026-07-10";
  elements["#front-date-end"].value = "2026-07-05";
  assert.deepEqual(shell.applyFrontDateInputs(), { start: "2026-07-05", end: "2026-07-10" });
});

test("sales shell owns sales toolbar placement and local preview warning", () => {
  const salesHero = makeElement();
  const filters = makeElement();
  const legacyInsight = makeElement();
  const updatedAt = makeElement();
  const elements = {
    "#view-sales .insight-row": legacyInsight,
    "#updated-at": updatedAt,
    "#sales-global-filters": filters,
    "#view-sales > .module-hero": salesHero,
  };
  const root = makeRoot(elements);
  const shell = createShell(root);

  shell.syncSalesToolbarVisibility(false);
  assert.equal(filters.hidden, true);
  shell.syncSalesToolbarVisibility("sales");
  assert.equal(filters.hidden, false);

  shell.placeSalesFiltersAfterBreadcrumb();
  assert.equal(filters.previousElementSibling, salesHero);
  shell.removeLegacySalesLayout();
  assert.equal(legacyInsight.removeCalled, true);
  assert.equal(updatedAt.removeCalled, true);
  shell.showLocalFileWarning();
  assert.equal(root.body.prepended.length, 1);
  assert.match(root.body.prepended[0].innerHTML, /本地预览文件/);
});

test("sales shell publishes date changes to the shared filter context", () => {
  const sharedFilterState = createSharedFilterStateStore({ syncUrl: false });
  const root = makeRoot({
    "#front-date-start": makeElement(),
    "#front-date-end": makeElement(),
    "#front-date-range-button": makeElement(),
  });
  const shell = createSalesShell({
    root,
    bind: () => {},
    bindAll: () => {},
    bindClickOutside: () => {},
    fieldValue,
    formatDate: (date) => date.toISOString().slice(0, 10),
    getDateRangeByPreset: () => [new Date("2026-07-01T00:00:00Z"), new Date("2026-07-06T00:00:00Z")],
    getDefaultFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-07" }),
    setElementsHidden,
    setText,
    sharedFilterState,
  });

  shell.updateFrontDateRange("2026-08-01", "2026-08-07");
  assert.deepEqual(sharedFilterState.get().date, { start: "2026-08-01", end: "2026-08-07" });
});

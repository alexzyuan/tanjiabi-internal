import assert from "node:assert/strict";
import test from "node:test";

import { createCashflowDashboardFeature } from "../assets/js/features/cashflow-dashboard.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createCashflowDashboardFeature({
    root,
    loadDashboardSection: async () => {},
    addDays: (date) => date,
    bind: (...args) => bindCalls.push(args),
    escapeHtml: (value) => String(value ?? ""),
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatDate: () => "2026-07-07",
    getPacificTodayDate: () => new Date("2026-07-07T00:00:00Z"),
    renderTableMessage: () => {},
    selectedFilterValue: () => "",
    selectedFilterValues: () => [],
    setButtonBusy: () => () => {},
    setSelectOptions: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    ...overrides,
  });
  return { bindCalls, feature };
}

test("cashflow dashboard owns its DOM event bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupCashflowDashboard();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#cashflow-refresh-button", "click", feature.loadCashflowDashboard],
      ["#cashflow-capture-button", "click", feature.captureCashflowSnapshot],
      ["#cashflow-start-date", "change", feature.loadCashflowDashboard],
      ["#cashflow-end-date", "change", feature.loadCashflowDashboard],
      ["#cashflow-date-type", "change", feature.loadCashflowDashboard],
      ["#cashflow-currency", "change", feature.loadCashflowDashboard],
      ["#cashflow-status", "change", feature.loadCashflowDashboard],
      ["#cashflow-country", "change", bindCalls[7][3]],
      ["#cashflow-store", "change", bindCalls[8][3]],
    ],
  );
});

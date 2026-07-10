import assert from "node:assert/strict";
import test from "node:test";

import { createInventoryProvisionFeature } from "../assets/js/features/inventory-provision.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createInventoryProvisionFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fetchImpl: async () => ({ ok: true, blob: async () => new Blob(), headers: { get: () => "" } }),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatNumber: (value) => String(value),
    getDefaultMonth: () => "2026-07",
    renderTableMessage: () => {},
    selectedFilterValue: () => "",
    selectedFilterValues: () => [],
    setButtonBusy: () => () => {},
    setSelectOptions: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, feature };
}

test("inventory provision feature owns its DOM event bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupInventoryProvision();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#inventory-provision-refresh", "click", feature.loadInventoryProvision],
      ["#inventory-provision-export", "click", bindCalls[1][3]],
      ["#inventory-provision-date", "change", feature.loadInventoryProvision],
      ["#inventory-provision-country", "change", bindCalls[3][3]],
      ["#inventory-provision-store", "change", bindCalls[4][3]],
      ["#inventory-provision-owner", "change", feature.loadInventoryProvision],
      ["#inventory-provision-cost-mode", "change", feature.loadInventoryProvision],
      ["#inventory-provision-keyword", "keydown", bindCalls[7][3]],
    ],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { createSupplierDetailFeature } from "../assets/js/features/supplier-detail.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const backdropCalls = [];
  const root = {
    body: { classList: { add() {}, remove() {} } },
    querySelector() {
      return null;
    },
  };
  const feature = createSupplierDetailFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    bindBackdropClose: (...args) => backdropCalls.push(args),
    closestTarget: () => null,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    readFileAsBase64: async () => "",
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { backdropCalls, bindCalls, feature };
}

test("supplier detail feature owns its DOM event bindings", () => {
  const { backdropCalls, bindCalls, feature } = createFeature();

  feature.setupSupplierDetail();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName]) => [selector, eventName]),
    [
      ["#supplier-detail-open-modal", "click"],
      ["#supplier-detail-close-modal", "click"],
      ["#supplier-detail-table tbody", "click"],
      ["#supplier-detail-form", "submit"],
      ["#supplier-detail-delete", "click"],
      ["#supplier-detail-download-template", "click"],
      ["#supplier-detail-export", "click"],
      ["#supplier-detail-file-input", "change"],
      ["#supplier-detail-reset", "click"],
      ["#supplier-detail-keyword", "input"],
      ["#supplier-detail-qualification-filter", "change"],
      ["#supplier-detail-payment-filter", "change"],
      ["#supplier-detail-invoice-filter", "change"],
    ],
  );
  assert.deepEqual(backdropCalls.map(([, selector]) => selector), ["#supplier-detail-modal"]);
});

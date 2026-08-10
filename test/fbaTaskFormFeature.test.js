import assert from "node:assert/strict";
import test from "node:test";

import { createFbaTaskFormFeature } from "../assets/js/features/fba-task-form.js";

function createFeature({ selectedShops = [], fbaValues = {}, sideEffects = [] } = {}) {
  const elements = new Map();
  const root = {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const feature = createFbaTaskFormFeature({
    root,
    bind: () => {},
    bindBackdropClose: () => {},
    checkedField: () => false,
    confirmImpl: () => true,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    fieldValue: () => "matched",
    findSelectedFbaMskuOption: () => null,
    fbaValue: (selector) => {
      sideEffects.push(`read:${selector}`);
      return fbaValues[selector] || "";
    },
    getSelectedFbaShops: () => selectedShops,
    hasCompleteFbaBoxSpec: () => false,
    loadFbaAutomationState: async () => {},
    readFbaBoxSpecFromForm: () => ({ boxDimensions: {}, boxWeight: {} }),
    renderFbaAutomationState: () => {},
    renderFbaResult: () => {},
    renderFbaShopOptions: () => {},
    renderFbaWarehouseOptions: () => {},
    scheduleFbaMskuLoad: () => {},
    selectFbaShopSids: () => {},
    setButtonBusy: () => () => {},
    setFbaBoxSpecFields: () => {},
    setModalOpenState: () => {},
    setText: () => {},
    syncFbaQuantityFields: () => sideEffects.push("sync"),
    timer: { setTimeout() {} },
    updateFbaShopButton: () => {},
  });
  return feature;
}

test("buildFbaPayload fails before any form read or side effect when no canonical shop is selected", () => {
  const sideEffects = [];
  const feature = createFeature({ sideEffects });

  assert.throws(() => feature.buildFbaPayload(), { message: "请选择有效店铺。" });
  assert.deepEqual(sideEffects, []);
});

test("buildFbaPayload rejects an invalid selected shop instead of falling back to 11501", () => {
  const feature = createFeature({ selectedShops: [{ sid: 0, name: "" }] });

  assert.throws(() => feature.buildFbaPayload(), { message: "请选择有效店铺。" });
});

test("buildFbaPayload uses the selected canonical shop sid", () => {
  const feature = createFeature({
    selectedShops: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", displayName: "探嘉美国" }],
    fbaValues: {
      "#fba-box-count": "1",
      "#fba-pack-quantity": "2",
      "#fba-msku": "MSKU-1",
      "#fba-plan-name": "plan",
    },
  });

  const payload = feature.buildFbaPayload();

  assert.equal(payload.sid, 8708);
  assert.equal(payload.shop.sid, 8708);
  assert.notEqual(payload.sid, 11501);
});

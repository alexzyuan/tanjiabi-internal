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

test("validateFbaPayload rejects scheduled tasks whose end date is before Beijing today", () => {
  const feature = createFeature();
  const payload = {
    planName: "plan",
    targetWarehouseCode: "GEU",
    boxCount: 1,
    positionType: "2",
    scheduleEnabled: true,
    activeEndDate: "2026-07-31",
    deliveryPreferences: { shipDate: "2026-08-20", deliveryDate: "2026-08-30" },
    inboundPlanItems: [{ msku: "MSKU-1" }],
  };

  assert.match(feature.validateFbaPayload(payload), /结束日期不能早于当前日期/);
});

test("validateFbaPayload allows scheduled tasks ending today in Beijing time", () => {
  const feature = createFeature();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const payload = {
    planName: "plan",
    targetWarehouseCode: "GEU",
    boxCount: 1,
    positionType: "2",
    scheduleEnabled: true,
    activeEndDate: today,
    deliveryPreferences: { shipDate: "2026-08-20", deliveryDate: "2026-08-30" },
    inboundPlanItems: [{ msku: "MSKU-1" }],
  };

  assert.equal(feature.validateFbaPayload(payload), "");
});

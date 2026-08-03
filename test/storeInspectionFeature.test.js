import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createStoreInspectionFeature } from "../assets/js/features/store-inspection.js";

function createElement() {
  return { innerHTML: "", textContent: "", className: "" };
}

test("store inspection renders this week's low inventory fee MSKUs in the dashboard", async () => {
  const elements = new Map([
    ["#inspection-low-inventory-fee-count", createElement()],
    ["#store-inspection-focus", createElement()],
    ["#store-inspection-table", createElement()],
    ["#store-inspection-history", createElement()],
    ["#store-inspection-status-text", createElement()],
    ["#store-inspection-overall-status", createElement()],
    ["#store-inspection-updated-at", createElement()],
    ["#store-inspection-notify-status", createElement()],
    ["#store-inspection-check-summary", createElement()],
    ["#store-inspection-table-count", createElement()],
    ["#store-inspection-history-count", createElement()],
    ["#inspection-feedback-count", createElement()],
    ["#inspection-review-count", createElement()],
    ["#inspection-review-note", createElement()],
    ["#inspection-voice-count", createElement()],
    ["#inspection-account-health-count", createElement()],
  ]);
  const root = { querySelector: (selector) => elements.get(selector) || null };
  const latest = {
    overall: "warning",
    overallLabel: "需复核",
    meta: { updatedAt: "2026-08-03 08:30", storeCount: 0 },
    feedback: { count: 0, status: "ok", rows: [] },
    review: { count: 0, lowCount: 0, status: "ok", rows: [] },
    voiceOfBuyer: { count: 0, status: "ok", rows: [] },
    accountHealth: { count: 0, status: "ok", rows: [] },
    erpBuyerMessages: { count: 0, status: "ok", rows: [] },
    aftersalesMail: { count: 0, newCount: 0, status: "ok", rows: [] },
    lowInventoryFee: {
      key: "low-inventory-fee",
      label: "低库存费 MSKU",
      status: "warning",
      tone: "warning",
      count: 1,
      detail: "本周已进入收费区间",
      rows: [{ storeName: "xiamentanjia-US", country: "US", msku: "FEE-1" }],
    },
    checks: [],
  };
  let dashboard = { latest, history: [latest], state: {}, schedule: {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => dashboard });
  try {
    const feature = createStoreInspectionFeature({
      root,
      bind: () => {},
      checkedField: () => false,
      escapeHtml: (value) => String(value ?? ""),
      fieldValue: () => "",
      redirectToLogin: () => {},
      setButtonBusy: () => () => {},
      setText: (selector, value, target) => {
        const element = target.querySelector(selector);
        if (element) element.textContent = String(value);
      },
    });

    await feature.loadStoreInspectionDashboard();

    assert.equal(elements.get("#inspection-low-inventory-fee-count").textContent, "1");
    assert.match(elements.get("#store-inspection-focus").innerHTML, /低库存费 MSKU/);
    assert.match(elements.get("#store-inspection-focus").innerHTML, /本周 1 个/);
    assert.match(elements.get("#store-inspection-focus").innerHTML, /本周已进入收费区间/);
    assert.match(elements.get("#store-inspection-table").innerHTML, /低库存费 MSKU/);
    assert.match(elements.get("#store-inspection-table").innerHTML, /xiamentanjia-US/);
    assert.match(elements.get("#store-inspection-table").innerHTML, /FEE-1/);
    assert.match(elements.get("#store-inspection-table").innerHTML, /<td>FEE-1<\/td>\s*<td>-<\/td>\s*<td>本周已进入低库存费区间<\/td>\s*<td>-<\/td>\s*<td><span[^>]*>本周低库存费<\/span><\/td>/);
    assert.match(elements.get("#store-inspection-history").innerHTML, /<td>1<\/td>\s*<\/tr>/);

    const noLowInventoryFee = { ...latest, lowInventoryFee: { ...latest.lowInventoryFee, count: 0, rows: [] } };
    dashboard = { latest: noLowInventoryFee, history: [], state: {}, schedule: {} };
    await feature.loadStoreInspectionDashboard();
    assert.match(elements.get("#store-inspection-table").innerHTML, /低库存费/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("store inspection markup provides the low inventory fee KPI and history column", async () => {
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(indexHtml, /<article class="metric-tile"><span>低库存费 MSKU<\/span><strong id="inspection-low-inventory-fee-count">0<\/strong><small>当前已进入收费区间<\/small><\/article>/);
  assert.match(indexHtml, /<th>低库存费 MSKU<\/th>/);
});

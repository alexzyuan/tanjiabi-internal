import assert from "node:assert/strict";
import test from "node:test";

import { createFbaShipmentVarianceFeature } from "../assets/js/features/fba-shipment-variance.js";

test("shipment variance feature sends date, store and follow-up filters and persists follow-up actions", async () => {
  const elements = {
    "#fba-shipment-variance-start-date": { value: "2026-07-05" },
    "#fba-shipment-variance-end-date": { value: "2026-08-03" },
    "#fba-shipment-variance-sid": { value: "8708", innerHTML: "", options: [] },
    "#fba-shipment-variance-followup-status": { value: "pending" },
    "#fba-shipment-variance-refresh": { disabled: false },
    "#fba-shipment-variance-table": { innerHTML: "" },
    "#fba-shipment-variance-followup-select": { value: "调查中" },
    "#fba-shipment-variance-followup-modal": {},
  };
  const binds = [];
  const requests = [];
  let target = null;
  const feature = createFbaShipmentVarianceFeature({
    root: { querySelector: (selector) => elements[selector] || null },
    bind: (...args) => binds.push(args),
    bindBackdropClose: () => {},
    closestTarget: (_event, selector) => selector === "[data-fba-shipment-variance-followup]" ? target : null,
    createDateRangePickerImpl: () => ({ setup() {}, refresh() {} }),
    escapeHtml: (value) => String(value ?? ""),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("/api/fba/shipment-variances?")) {
        return { ok: true, json: async () => ({ rows: [{ sid: 8708, shipmentId: "FBA1", investigationStatus: "待调查", differenceQuantity: 2, sla: { display: "还剩 6 天 0 小时" }, followup: { followedUp: false } }], summary: {} }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    },
    formatDate: () => "2026-08-03",
    formatNumber: (value) => String(value),
    getFbaShops: () => [],
    loadFbaShops: async () => {},
    normalizeFbaShop: (shop) => shop,
    renderTableMessage: (table, _columns, message) => { table.innerHTML = message; },
    setModalOpenState: () => {},
    setText: () => {},
  });

  await feature.loadFbaShipmentVariances();
  assert.match(requests[0].url, /startDate=2026-07-05/);
  assert.match(requests[0].url, /sids=8708/);
  assert.match(requests[0].url, /followupStatus=pending/);
  assert.match(elements["#fba-shipment-variance-table"].innerHTML, /已跟进/);

  feature.setupFbaShipmentVariance();
  const tableClick = binds.find(([, selector, eventName]) => selector === "#fba-shipment-variance-table" && eventName === "click")[3];
  target = { dataset: { fbaShipmentVarianceFollowup: "8708:FBA1" } };
  await tableClick({});
  const confirmFollowup = binds.find(([, selector, eventName]) => selector === "#fba-shipment-variance-followup-confirm" && eventName === "click")[3];
  await confirmFollowup();
  const followupRequest = requests.find((request) => request.url === "/api/fba/shipment-variances/8708/FBA1/followup");
  assert.equal(followupRequest?.options.method, "PUT");
});

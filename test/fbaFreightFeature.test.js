import assert from "node:assert/strict";
import test from "node:test";

import { createFbaFreightFeature } from "../assets/js/features/fba-freight.js";

function createFeature(overrides = {}) {
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-table": { innerHTML: "" },
  };
  const bindCalls = [];
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const feature = createFbaFreightFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    bindBackdropClose: () => {},
    cachedSalesImageUrl: () => "",
    closestTarget: () => null,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl: async () => ({ ok: true, json: async () => ({ rows: [] }) }),
    formatDate: () => "2026-07-14",
    formatNumber: (value) => String(value),
    getFbaShops: () => [],
    loadFbaShops: async () => {},
    normalizeFbaShop: (shop) => shop,
    renderTableMessage: (table, _cols, message) => {
      table.innerHTML = message;
    },
    setModalOpenState: () => {},
    setText: () => {},
    ...overrides,
  });
  return { bindCalls, elements, feature };
}

test("FBA freight refresh button forces API refresh and stays disabled while loading", async () => {
  let releaseFetch;
  const requestedUrls = [];
  const { bindCalls, elements, feature } = createFeature({
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      return { ok: true, json: async () => ({ rows: [] }) };
    },
  });
  feature.setupFbaFreight();
  const refreshHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-refresh" && eventName === "click")[3];

  const first = refreshHandler();
  const second = refreshHandler();

  assert.equal(elements["#fba-freight-refresh"].disabled, true);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /forceRefresh=true/);
  releaseFetch();
  await Promise.all([first, second]);
  assert.equal(elements["#fba-freight-refresh"].disabled, false);
});

test("FBA freight initial load does not connect to Jiufang channels", async () => {
  const requestedUrls = [];
  const { feature } = createFeature({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (url === "/api/fba/warehouses") return { ok: true, json: async () => ({ ok: true, warehouses: [] }) };
      if (url === "/api/fba/freight/templates") return { ok: true, json: async () => ({ ok: true, templates: [] }) };
      if (String(url).startsWith("/api/fba/freight/shipments")) return { ok: true, json: async () => ({ ok: true, rows: [] }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  await feature.loadFbaFreightInitial();

  assert.equal(requestedUrls.includes("/api/fba/jiufang/channels"), false);
});

test("FBA freight row Jiufang button dry-runs that shipment and channel", async () => {
  const requests = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "", innerHTML: "" },
    "#fba-freight-jiufang-confirm": { disabled: false },
    "#fba-freight-jiufang-summary": { innerHTML: "" },
    "#fba-freight-jiufang-modal": {},
    "#fba-freight-table": { innerHTML: "" },
  };
  let closestTargetValue = null;
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const bindCalls = [];
  const modalStates = [];
  const feature = createFbaFreightFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    bindBackdropClose: () => {},
    cachedSalesImageUrl: () => "",
    closestTarget: () => closestTargetValue,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (String(url).startsWith("/api/fba/freight/shipments")) {
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA18QJFDCWJ", shippedQuantity: 12 }] }) };
      }
      if (url === "/api/fba/jiufang/channels") {
        return { ok: true, json: async () => ({ ok: true, channels: [{ code: "SEA-US-07", name: "九方美国海派", isDefault: true }] }) };
      }
      if (url === "/api/fba/jiufang/orders/dry-run") {
        return { ok: true, json: async () => ({ ok: true, readyCount: 1, failedCount: 0, results: [{ shipmentId: "FBA18QJFDCWJ", status: "ready", summary: { boxCount: 1, totalKg: 10 } }] }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    formatDate: () => "2026-07-14",
    formatNumber: (value) => String(value),
    getFbaShops: () => [],
    loadFbaShops: async () => {},
    normalizeFbaShop: (shop) => shop,
    renderTableMessage: (table, _cols, message) => {
      table.innerHTML = message;
    },
    setModalOpenState: (modal, open) => modalStates.push({ modal, open }),
    setText: () => {},
  });

  await feature.loadFbaFreightShipments();
  assert.match(elements["#fba-freight-table"].innerHTML, /data-fba-freight-jiufang="FBA18QJFDCWJ"/);
  assert.doesNotMatch(elements["#fba-freight-table"].innerHTML, /data-fba-freight-jiufang-result/);
  feature.setupFbaFreight();
  const tableClickHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-table" && eventName === "click")[3];
  closestTargetValue = { dataset: { fbaFreightJiufang: "FBA18QJFDCWJ" } };

  await tableClickHandler({});

  assert.ok(requests.find((request) => request.url === "/api/fba/jiufang/channels"));
  const dryRunRequest = requests.find((request) => request.url === "/api/fba/jiufang/orders/dry-run");
  assert.equal(dryRunRequest.options.method, "POST");
  assert.deepEqual(JSON.parse(dryRunRequest.options.body), {
    filters: { startDate: "2026-07-01", endDate: "2026-07-14", sids: "8708", length: "500" },
    shipmentIds: ["FBA18QJFDCWJ"],
    channelCode: "SEA-US-07",
  });
  assert.equal(modalStates.at(-1).open, true);
});

test("FBA freight row Jiufang button requires explicit channel when Jiufang has no default", async () => {
  const requests = [];
  const statuses = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "", innerHTML: "" },
    "#fba-freight-jiufang-confirm": { disabled: false },
    "#fba-freight-jiufang-summary": { innerHTML: "" },
    "#fba-freight-jiufang-modal": {},
    "#fba-freight-table": { innerHTML: "" },
  };
  let closestTargetValue = null;
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const bindCalls = [];
  const feature = createFbaFreightFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    bindBackdropClose: () => {},
    cachedSalesImageUrl: () => "",
    closestTarget: () => closestTargetValue,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (String(url).startsWith("/api/fba/freight/shipments")) {
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA18QJFDCWJ", shippedQuantity: 12 }] }) };
      }
      if (url === "/api/fba/jiufang/channels") {
        return { ok: true, json: async () => ({ ok: true, channels: [{ code: "SEA-EU-03", name: "监管仓欧洲卡派", isDefault: false }] }) };
      }
      if (url === "/api/fba/jiufang/orders/dry-run") {
        return { ok: true, json: async () => ({ ok: true, results: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    formatDate: () => "2026-07-14",
    formatNumber: (value) => String(value),
    getFbaShops: () => [],
    loadFbaShops: async () => {},
    normalizeFbaShop: (shop) => shop,
    renderTableMessage: (table, _cols, message) => {
      table.innerHTML = message;
    },
    setModalOpenState: () => {},
    setText: (_selector, text) => statuses.push(text),
  });

  await feature.loadFbaFreightShipments();
  feature.setupFbaFreight();
  const tableClickHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-table" && eventName === "click")[3];
  closestTargetValue = { dataset: { fbaFreightJiufang: "FBA18QJFDCWJ" } };

  await tableClickHandler({});

  assert.ok(requests.find((request) => request.url === "/api/fba/jiufang/channels"));
  assert.equal(requests.some((request) => request.url === "/api/fba/jiufang/orders/dry-run"), false);
  assert.equal(elements["#fba-freight-jiufang-channel"].value, "");
  assert.match(statuses.at(-1), /请选择九方渠道/);
});

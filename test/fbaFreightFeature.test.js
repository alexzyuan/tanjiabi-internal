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

test("FBA freight row Jiufang button opens country channel picker before dry-run", async () => {
  const requests = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "", innerHTML: "" },
    "#fba-freight-jiufang-precheck": { disabled: false },
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
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA18QJFDCWJ", country: "美国", shippedQuantity: 12 }] }) };
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

  assert.equal(requests.some((request) => request.url === "/api/fba/jiufang/channels"), false);
  assert.equal(requests.some((request) => request.url === "/api/fba/jiufang/orders/dry-run"), false);
  assert.match(elements["#fba-freight-jiufang-channel"].innerHTML, /OA直送专线\(包税\)/);
  assert.match(elements["#fba-freight-jiufang-channel"].innerHTML, /准时达卡派\(包税\)/);
  assert.match(elements["#fba-freight-jiufang-channel"].innerHTML, /美国空派带电包税\(卡派\)/);
  assert.doesNotMatch(elements["#fba-freight-jiufang-channel"].innerHTML, /加拿大卡派/);
  assert.equal(modalStates.at(-1).open, true);

  elements["#fba-freight-jiufang-channel"].value = "SEA-MS-31";
  const precheckHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-jiufang-precheck" && eventName === "click")[3];
  await precheckHandler();

  const dryRunRequest = requests.find((request) => request.url === "/api/fba/jiufang/orders/dry-run");
  assert.equal(dryRunRequest.options.method, "POST");
  assert.deepEqual(JSON.parse(dryRunRequest.options.body), {
    filters: { startDate: "2026-07-01", endDate: "2026-07-14", sids: "8708", length: "500" },
    shipmentIds: ["FBA18QJFDCWJ"],
    channelCode: "SEA-MS-31",
  });
});

test("FBA freight Jiufang precheck shows missing fields and blocks create", async () => {
  const requests = [];
  const statuses = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "SEA-CA-02", innerHTML: "" },
    "#fba-freight-jiufang-precheck": { disabled: false },
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
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA18QJFDCWJ", country: "加拿大", shippedQuantity: 12 }] }) };
      }
      if (url === "/api/fba/jiufang/orders/dry-run") {
        return { ok: true, json: async () => ({ ok: false, readyCount: 0, failedCount: 1, results: [{ shipmentId: "FBA18QJFDCWJ", status: "failed", missingFields: ["TJ033 缺少材质", "TJ033 缺少申报单价"] }] }) };
      }
      if (url === "/api/fba/jiufang/orders/create") throw new Error("create should not be called after failed precheck");
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
  const precheckHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-jiufang-precheck" && eventName === "click")[3];
  await precheckHandler();

  assert.equal(requests.some((request) => request.url === "/api/fba/jiufang/channels"), false);
  assert.equal(requests.some((request) => request.url === "/api/fba/jiufang/orders/dry-run"), true);
  assert.equal(elements["#fba-freight-jiufang-confirm"].disabled, true);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /TJ033 缺少材质/);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /TJ033 缺少申报单价/);
  assert.match(statuses.at(-1), /九方预检完成/);
});

test("FBA freight Jiufang confirm automatically prechecks before creating order", async () => {
  const requests = [];
  const statuses = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "SEA-MS-31", innerHTML: "" },
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
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA-US-1", country: "美国", shippedQuantity: 12 }] }) };
      }
      if (url === "/api/fba/jiufang/orders/dry-run") {
        return { ok: true, json: async () => ({ ok: true, readyCount: 1, failedCount: 0, results: [{ shipmentId: "FBA-US-1", status: "ready", summary: { boxCount: 1, totalKg: 10 } }] }) };
      }
      if (url === "/api/fba/jiufang/orders/create") {
        return { ok: true, json: async () => ({ ok: true, createdCount: 1, failedCount: 0, results: [{ shipmentId: "FBA-US-1", status: "created", jiufangOrderNumber: "JF260715001" }] }) };
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
  closestTargetValue = { dataset: { fbaFreightJiufang: "FBA-US-1" } };
  await tableClickHandler({});
  await bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-jiufang-confirm" && eventName === "click")[3]();

  assert.deepEqual(requests.map((request) => request.url).filter((url) => String(url).startsWith("/api/fba/jiufang")), [
    "/api/fba/jiufang/orders/dry-run",
    "/api/fba/jiufang/orders/create",
  ]);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /预检通过/);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /下单成功/);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /JF260715001/);
  assert.ok(statuses.some((status) => /九方预检中/.test(status)));
});

test("FBA freight Jiufang create success stays in modal and shows order number", async () => {
  const requests = [];
  const elements = {
    "#fba-freight-refresh": { disabled: false },
    "#fba-freight-start-date": { value: "2026-07-01" },
    "#fba-freight-end-date": { value: "2026-07-14" },
    "#fba-freight-sid": { value: "8708" },
    "#fba-freight-shipment-id": { value: "" },
    "#fba-freight-status-filter": { value: "" },
    "#fba-freight-jiufang-channel": { value: "SEA-AU-01", innerHTML: "" },
    "#fba-freight-jiufang-precheck": { disabled: false },
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
        return { ok: true, json: async () => ({ rows: [{ shipmentId: "FBA-AU-1", country: "澳洲", shippedQuantity: 12 }] }) };
      }
      if (url === "/api/fba/jiufang/orders/dry-run") {
        return { ok: true, json: async () => ({ ok: true, readyCount: 1, failedCount: 0, results: [{ shipmentId: "FBA-AU-1", status: "ready", summary: { boxCount: 2, totalKg: 20 } }] }) };
      }
      if (url === "/api/fba/jiufang/orders/create") {
        return { ok: true, json: async () => ({ ok: true, createdCount: 1, failedCount: 0, results: [{ shipmentId: "FBA-AU-1", status: "created", jiufangOrderNumber: "JF260714888" }] }) };
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
  feature.setupFbaFreight();
  const tableClickHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-table" && eventName === "click")[3];
  closestTargetValue = { dataset: { fbaFreightJiufang: "FBA-AU-1" } };
  await tableClickHandler({});
  await bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-jiufang-precheck" && eventName === "click")[3]();
  await bindCalls.find(([, selector, eventName]) => selector === "#fba-freight-jiufang-confirm" && eventName === "click")[3]();

  const createRequest = requests.find((request) => request.url === "/api/fba/jiufang/orders/create");
  assert.deepEqual(JSON.parse(createRequest.options.body), {
    filters: { startDate: "2026-07-01", endDate: "2026-07-14", sids: "8708", length: "500" },
    shipmentIds: ["FBA-AU-1"],
    channelCode: "SEA-AU-01",
    confirmed: true,
  });
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /下单成功/);
  assert.match(elements["#fba-freight-jiufang-summary"].innerHTML, /JF260714888/);
  assert.equal(modalStates.at(-1).open, true);
});

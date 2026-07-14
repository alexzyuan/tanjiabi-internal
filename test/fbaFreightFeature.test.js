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

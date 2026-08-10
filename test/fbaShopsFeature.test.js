import assert from "node:assert/strict";
import test from "node:test";

import { createFbaShopsFeature } from "../assets/js/features/fba-shops.js";

function createFeature(overrides = {}) {
  const elements = {
    "#fba-shop-button": { querySelector: () => ({ textContent: "" }) },
    "#fba-shop-search": { value: "" },
    "#fba-shop-options": { innerHTML: "" },
  };
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const events = [];
  const feature = createFbaShopsFeature({
    root,
    bind: (...args) => events.push(args),
    bindClickOutside: () => {},
    closestTarget: () => null,
    escapeHtml: (value) => String(value ?? ""),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl: async () => ({ ok: true, json: async () => ({ shops: [] }) }),
    getDisplayShopName: (name, country) => `${name} · ${country}`,
    normalizeCountryName: (country) => String(country || ""),
    pickSellerCountry: (shop) => shop.country,
    pickSellerName: (shop) => shop.name,
    setElementsHidden: () => [null],
    ...overrides,
  });
  return { elements, events, feature };
}

test("FBA shop normalization accepts only a positive sid and non-empty name without an address", () => {
  const { feature } = createFeature();

  assert.equal(feature.normalizeFbaShop({ sid: 0, name: "invalid" }), null);
  assert.equal(feature.normalizeFbaShop({ sid: 8708, name: "" }), null);

  const normalized = feature.normalizeFbaShop({ sid: "8708", name: "xiamentanjia-US", country: "美国" });
  assert.deepEqual(normalized, {
    sid: 8708,
    name: "xiamentanjia-US",
    country: "美国",
    displayName: "xiamentanjia-US · 美国",
  });
  assert.equal(Object.hasOwn(normalized, "addressProfile"), false);
});

test("FBA shop selection starts empty and an empty directory clears options without inventing 11501", () => {
  const { elements, feature } = createFeature();

  assert.deepEqual(feature.getSelectedFbaShops(), []);
  feature.populateFbaShopSelect([{ sid: 8708, name: "xiamentanjia-US", country: "美国" }]);
  assert.deepEqual(feature.getSelectedFbaShops().map((shop) => shop.sid), []);

  feature.populateFbaShopSelect([]);
  assert.deepEqual(feature.getFbaShops(), []);
  assert.deepEqual(feature.getSelectedFbaShops(), []);
  assert.doesNotMatch(elements["#fba-shop-options"].innerHTML, /11501/);
});

test("FBA shop directory load renders only API shops and ignores front-shop or local fallbacks", async () => {
  let populated;
  const { feature } = createFeature({
    getFrontShopSellers: () => [{ sid: 11501, name: "front-fallback", country: "加拿大" }],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ shops: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }] }),
    }),
    onShopListChange: (shops) => {
      populated = shops;
    },
  });

  await feature.loadFbaShops();

  assert.deepEqual(populated.map((shop) => shop.sid), [8708]);
  assert.deepEqual(feature.getFbaShops().map((shop) => shop.sid), [8708]);
  assert.equal(feature.getFbaShops().some((shop) => shop.sid === 11501), false);
});

test("FBA shop directory load clears, reports, and rethrows non-ok responses", async () => {
  const errors = [];
  let rerenders = 0;
  const { feature } = createFeature({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    onDirectoryError: (error) => errors.push(error),
    onShopListChange: () => {
      rerenders += 1;
    },
  });
  feature.populateFbaShopSelect([{ sid: 8708, name: "xiamentanjia-US", country: "美国" }]);

  await assert.rejects(() => feature.loadFbaShops(), /API 503/);
  assert.equal(rerenders, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(feature.getFbaShops(), []);
  assert.deepEqual(feature.getSelectedFbaShops(), []);
});

test("FBA shop directory load clears, reports, and rethrows invalid JSON", async () => {
  const errors = [];
  const { feature } = createFeature({
    fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid json"); } }),
    onDirectoryError: (error) => errors.push(error),
  });

  await assert.rejects(() => feature.loadFbaShops(), /invalid json/);
  assert.equal(errors.length, 1);
  assert.deepEqual(feature.getFbaShops(), []);
});

test("FBA shop directory load treats an empty shops response as a failed directory", async () => {
  const errors = [];
  const { feature } = createFeature({
    fetchImpl: async () => ({ ok: true, json: async () => ({ shops: [] }) }),
    onDirectoryError: (error) => errors.push(error),
  });

  await assert.rejects(() => feature.loadFbaShops(), /店铺目录为空/);
  assert.equal(errors.length, 1);
  assert.deepEqual(feature.getFbaShops(), []);
  assert.deepEqual(feature.getSelectedFbaShops(), []);
});

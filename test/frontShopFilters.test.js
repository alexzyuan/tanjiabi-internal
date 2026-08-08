import assert from "node:assert/strict";
import test from "node:test";

import {
  createFrontShopFilters,
  getDisplayShopName,
  pickSellerCountry,
  pickSellerName,
} from "../assets/js/front-shop-filters.js";

function normalizeCountryName(country) {
  const map = { AU: "澳洲", CA: "加拿大", US: "美国" };
  const value = String(country || "").trim();
  return map[value.toUpperCase()] || value || "-";
}

function makeRoot(elements) {
  return {
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
}

function makeSelect(selectedValues = []) {
  return {
    multiple: true,
    selectedOptions: selectedValues.map((value) => ({ value })),
  };
}

function selectedFilterValues(selectorOrElement, root) {
  const element = typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement;
  return [...(element?.selectedOptions || [])].map((option) => option.value).filter(Boolean);
}

function selectedFilterValue(selectorOrElement, root) {
  return selectedFilterValues(selectorOrElement, root).join(",");
}

function fieldValue(selectorOrElement, fallback = "", root) {
  const element = typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement;
  return element?.value ?? fallback;
}

test("front shop helpers preserve seller display conventions", () => {
  assert.equal(pickSellerName({ seller_name: "xiamentanjia-US" }), "xiamentanjia-US");
  assert.equal(pickSellerCountry({ marketplace: "CA" }), "CA");
  assert.equal(getDisplayShopName("xiamentanjia-US", "美国"), "探嘉美国");
  assert.equal(getDisplayShopName("tandanbo-AU", "澳洲"), "坦蛋伯澳洲");
  assert.equal(getDisplayShopName("custom-store", "加拿大"), "custom-store加拿大");
});

test("front shop filters build the sales dashboard query from selected shops", () => {
  const elements = {
    "#front-country-filter": makeSelect(["美国"]),
    "#front-shop-filter": makeSelect(["xiamentanjia-US"]),
    "#front-currency-filter": { value: "USD" },
    "#front-owner-filter": { value: "运营A" },
  };
  const root = makeRoot(elements);
  const setSelectCalls = [];
  const filters = createFrontShopFilters({
    root,
    bind: () => {},
    fieldValue,
    getFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-06" }),
    normalizeCountryName,
    selectedFilterValue,
    selectedFilterValues,
    setSelectOptions: (select, options, allLabel, config) => {
      setSelectCalls.push({ select, options, allLabel, config });
    },
    syncAllOptionSelection: () => {},
  });

  filters.populateFrontShopFilters([
    { seller_name: "xiamentanjia-US", marketplace: "US", sid: 8708 },
    { seller_name: "xiamentanjia-CA", marketplace: "CA", sid: 8709 },
  ]);

  assert.equal(filters.getFrontShopSellers().length, 2);
  assert.equal(setSelectCalls[0].allLabel, "全部国家");
  assert.deepEqual(setSelectCalls[0].options, ["加拿大", "美国"]);
  assert.equal(setSelectCalls[1].allLabel, "全部店铺");
  assert.equal(setSelectCalls[1].config.groupByCountry, true);
  assert.deepEqual(filters.getSelectedFrontSids(), [8708]);
  assert.equal(
    filters.buildDashboardQuery(),
    "startDate=2026-07-01&endDate=2026-07-06&currencyCode=USD&sids=8708&listingOwner=%E8%BF%90%E8%90%A5A",
  );
});

test("front shop filters default the sales dashboard currency to CNY", () => {
  const elements = {
    "#front-country-filter": makeSelect([]),
    "#front-shop-filter": makeSelect([]),
    "#front-owner-filter": { value: "" },
  };
  const root = makeRoot(elements);
  const filters = createFrontShopFilters({
    root,
    bind: () => {},
    fieldValue,
    getFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-06" }),
    normalizeCountryName,
    selectedFilterValue,
    selectedFilterValues,
    setSelectOptions: () => {},
    syncAllOptionSelection: () => {},
  });

  assert.equal(
    filters.buildDashboardQuery(),
    "startDate=2026-07-01&endDate=2026-07-06&currencyCode=CNY",
  );
});

test("front shop filters own sales filter control bindings", async () => {
  const elements = {
    "#front-country-filter": makeSelect(["美国"]),
    "#front-shop-filter": makeSelect(["xiamentanjia-US"]),
    "#front-currency-filter": { value: "USD" },
    "#front-owner-filter": { value: "运营A" },
  };
  const root = makeRoot(elements);
  const bindCalls = [];
  const synced = [];
  let refreshCount = 0;
  const filters = createFrontShopFilters({
    root,
    bind: (...args) => bindCalls.push(args),
    fieldValue,
    getFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-06" }),
    normalizeCountryName,
    onFiltersChange: async () => {
      refreshCount += 1;
    },
    selectedFilterValue,
    selectedFilterValues,
    setSelectOptions: () => {},
    syncAllOptionSelection: (element) => synced.push(element),
  });

  filters.populateFrontShopFilters([
    { seller_name: "xiamentanjia-US", marketplace: "US", sid: 8708 },
  ]);
  filters.setupFrontShopFilterControls();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#front-country-filter", "change", bindCalls[0][3]],
      ["#front-shop-filter", "change", bindCalls[1][3]],
      ["#front-owner-filter", "change", bindCalls[2][3]],
      ["#front-currency-filter", "change", bindCalls[3][3]],
    ],
  );

  await bindCalls[0][3]();
  bindCalls[1][3]();
  await bindCalls[2][3]();
  await bindCalls[3][3]();

  assert.deepEqual(synced, [elements["#front-country-filter"], elements["#front-shop-filter"]]);
  assert.equal(refreshCount, 4);
});

test("front owner filter change reveals MSKU detail after dashboard refresh", async () => {
  const elements = {
    "#front-country-filter": makeSelect([]),
    "#front-shop-filter": makeSelect([]),
    "#front-currency-filter": { value: "ORIGINAL" },
    "#front-owner-filter": { value: "熊丹轩" },
  };
  const root = makeRoot(elements);
  const bindCalls = [];
  const order = [];
  const filters = createFrontShopFilters({
    root,
    bind: (...args) => bindCalls.push(args),
    fieldValue,
    getFrontDateRange: () => ({ start: "2026-07-01", end: "2026-07-06" }),
    normalizeCountryName,
    onFiltersChange: async () => {
      order.push("refresh");
    },
    onOwnerFilterChange: () => {
      order.push("reveal");
    },
    selectedFilterValue,
    selectedFilterValues,
    setSelectOptions: () => {},
    syncAllOptionSelection: () => {},
  });

  filters.setupFrontShopFilterControls();
  await bindCalls[2][3]();

  assert.deepEqual(order, ["refresh", "reveal"]);
});

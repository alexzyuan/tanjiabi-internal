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

function makeQuickFilterElement() {
  const label = { textContent: "负责人快捷筛选" };
  const button = {
    attributes: {},
    label,
    querySelector(selector) {
      return selector === ".filter-dropdown-button-label" ? label : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
  const menu = { hidden: true };
  const radios = ["林芃", "熊丹轩", "黄超"].map((value) => ({ type: "radio", value, checked: false }));
  return {
    querySelector(selector) {
      if (selector === ".filter-dropdown-button") return button;
      if (selector === ".filter-dropdown-menu") return menu;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "input[type='radio']" ? radios : [];
    },
    button,
    menu,
    label,
    radios,
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

test("front shop filters expose a quick owner dropdown for the three named leads", async () => {
  const quickFilter = makeQuickFilterElement();
  const ownerSelect = {
    value: "",
    options: [{ value: "" }, { value: "林芃" }, { value: "熊丹轩" }, { value: "黄超" }],
    selectedOptions: [],
  };
  const elements = {
    "#front-country-filter": makeSelect([]),
    "#front-shop-filter": makeSelect([]),
    "#front-currency-filter": { value: "ORIGINAL" },
    "#front-owner-filter": ownerSelect,
    "#front-owner-quick-filter": quickFilter,
  };
  const root = makeRoot(elements);
  const bindCalls = [];
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
    syncAllOptionSelection: () => {},
  });

  filters.setupFrontShopFilterControls();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName]) => [selector, eventName]),
    [
      ["#front-country-filter", "change"],
      ["#front-shop-filter", "change"],
      ["#front-owner-filter", "change"],
      ["#front-currency-filter", "change"],
      [".filter-dropdown-button", "click"],
      [".filter-dropdown-button", "keydown"],
      [".filter-dropdown-menu", "change"],
    ],
  );

  const clickHandler = bindCalls[4][3];
  const changeHandler = bindCalls[6][3];
  const clickEvent = {
    preventDefault() {},
    stopPropagation() {},
  };

  await clickHandler(clickEvent);
  assert.equal(quickFilter.menu.hidden, false);
  assert.equal(quickFilter.button.attributes["aria-expanded"], "true");

  const selectedRadio = quickFilter.radios[1];
  selectedRadio.checked = true;
  await changeHandler({ target: selectedRadio });

  assert.equal(ownerSelect.value, "熊丹轩");
  assert.equal(quickFilter.menu.hidden, true);
  assert.equal(quickFilter.button.attributes["aria-expanded"], "false");
  assert.equal(quickFilter.label.textContent, "熊丹轩");
  assert.equal(quickFilter.radios[0].checked, false);
  assert.equal(quickFilter.radios[1].checked, true);
  assert.equal(quickFilter.radios[2].checked, false);
  assert.equal(refreshCount, 1);
});

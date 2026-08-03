import assert from "node:assert/strict";
import test from "node:test";

import {
  createBudgetTargetsFeature,
  normalizeBudgetDeepLinkCountry,
} from "../assets/js/features/budget-targets.js";
import { createStoreOperatingMonthlyReportFeature } from "../assets/js/features/store-operating-monthly-report.js";

function makeElement(value = "") {
  return {
    value,
    textContent: "",
    innerHTML: "",
    disabled: false,
    selectedValues: [],
  };
}

function makeFeatureHarness({
  startMonth = "2026-06",
  endMonth = "2026-07",
  stores = [],
  countries = [],
  groups,
  storeOptions = [
    { name: "A", country: "美国" },
    { name: "B", country: "加拿大" },
  ],
} = {}) {
  const elements = {
    "#store-operating-report-start-month": makeElement(startMonth),
    "#store-operating-report-end-month": makeElement(endMonth),
    "#store-operating-report-store": makeElement(),
    "#store-operating-report-country": makeElement(),
    "#store-operating-report-status": makeElement(),
    "#store-operating-report-meta": makeElement(),
    "#store-operating-report-head": makeElement(),
    "#store-operating-report-body": makeElement(),
    "#store-operating-report-export": makeElement(),
    "#store-operating-report-table": makeElement(),
  };
  elements["#store-operating-report-store"].selectedValues = stores.slice();
  elements["#store-operating-report-country"].selectedValues = countries.slice();
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
  const requests = [];
  const refreshes = [];
  const optionUpdates = [];
  const navTargets = [];
  const location = { pathname: "/dashboard", search: "" };
  const history = {
    replaceState(_state, _title, url) {
      location.search = String(url).replace(location.pathname, "");
    },
  };
  const feature = createStoreOperatingMonthlyReportFeature({
    root,
    bind() {},
    clickVisibleNavItem(target) {
      navTargets.push(target);
    },
    downloadBlob() {},
    escapeHtml: (value) => String(value ?? ""),
    fetchImpl: async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            meta: {
              currencyMode: "ORIGINAL",
              currencyCodes: ["USD"],
              generatedAt: "2026-08-03T08:00:00.000Z",
              unavailableMetrics: [],
              missingExchangeRateCount: 0,
            },
            filters: { startMonth, endMonth, stores, countries },
            groups: groups || [{
              currencyCode: "USD",
              currencyAvailable: true,
              rows: [{
                key: "net-sales",
                category: "销售收入",
                name: "销售收入净额",
                level: 2,
                actual: 100,
                share: 1,
                budget: 120,
                achievement: 100 / 120,
                available: true,
              }],
            }],
            budgetStatus: { state: "configured", matched: true, matchCount: 1 },
          };
        },
      };
    },
    formatActualMoney: (value) => String(value),
    getCurrentMonth: () => "2026-08",
    getStoreOptions: () => storeOptions,
    historyRef: history,
    locationRef: location,
    refreshTable: (table) => refreshes.push(table),
    selectedFilterValues: (element) => element?.selectedValues?.slice() || [],
    setButtonBusy: () => () => {},
    setSelectOptions: (element, options, label, config) => {
      optionUpdates.push({ element, options, label, config });
    },
    setText: (selector, value) => {
      if (elements[selector]) elements[selector].textContent = value;
    },
    syncAllOptionSelection() {},
  });
  return { elements, feature, location, navTargets, optionUpdates, refreshes, requests };
}

test("valid month edits auto-refresh and invalid 13-month edits do not request", async () => {
  const { feature, requests, elements } = makeFeatureHarness({
    startMonth: "2026-06",
    endMonth: "2026-07",
    stores: ["A"],
    countries: ["美国"],
  });

  await feature.loadStoreOperatingMonthlyReport();
  assert.match(requests[0], /startMonth=2026-06/);
  assert.match(requests[0], /endMonth=2026-07/);
  assert.match(requests[0], /stores=A/);
  assert.match(requests[0], /countries=%E7%BE%8E%E5%9B%BD/);

  elements["#store-operating-report-end-month"].value = "2027-07";
  await feature.handleMonthChange();

  assert.match(elements["#store-operating-report-status"].textContent, /最多 12 个月/);
  assert.equal(requests.length, 1);
});

test("budget action carries the active scope to the budget view", () => {
  const { feature, location, navTargets } = makeFeatureHarness({
    startMonth: "2026-06",
    endMonth: "2026-07",
    stores: ["A"],
    countries: ["美国"],
  });

  feature.openBudgetTargets();

  assert.match(location.search, /view=budget/);
  assert.match(location.search, /budgetMonths=2026-06%2C2026-07/);
  assert.match(location.search, /budgetStores=A/);
  assert.match(location.search, /budgetCountries=%E7%BE%8E%E5%9B%BD/);
  assert.deepEqual(navTargets, ["budget"]);
});

test("country and store edits stay local until query while country edits narrow store options", async () => {
  const { feature, elements, optionUpdates, requests } = makeFeatureHarness();

  feature.initializeStoreOperatingMonthlyReportDefaults();
  elements["#store-operating-report-country"].selectedValues = ["美国"];
  feature.handleCountryChange();
  feature.handleStoreChange();

  assert.equal(requests.length, 0);
  const lastStoreUpdate = optionUpdates.filter((item) => item.element === elements["#store-operating-report-store"]).at(-1);
  assert.deepEqual(lastStoreUpdate.options.map((item) => item.name), ["A"]);

  await feature.loadStoreOperatingMonthlyReport();
  assert.equal(requests.length, 1);
});

test("successful rendering refreshes the shared managed table and writes filter state to the URL", async () => {
  const { feature, location, refreshes, elements } = makeFeatureHarness({ stores: ["A"] });

  await feature.loadStoreOperatingMonthlyReport();

  assert.deepEqual(refreshes, [elements["#store-operating-report-table"]]);
  assert.match(location.search, /view=store-operating-monthly-report/);
  assert.match(location.search, /startMonth=2026-06/);
  assert.match(location.search, /stores=A/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="actual"/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /销售收入净额/);
});

test("multi-currency rows keep their currency identity without unsortable group rows", async () => {
  const row = {
    key: "net-sales",
    category: "销售收入",
    name: "销售收入净额",
    level: 2,
    actual: 100,
    share: 1,
    budget: 120,
    achievement: 100 / 120,
    available: true,
  };
  const { feature, elements } = makeFeatureHarness({
    groups: [
      { currencyCode: "CAD", currencyAvailable: true, rows: [row] },
      { currencyCode: "USD", currencyAvailable: true, rows: [row] },
    ],
  });

  await feature.loadStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-body"].innerHTML, /CAD · 销售收入/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /USD · 销售收入/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /colspan=/);
});

test("budget targets consume report months, stores, and countries once as their initial scope", () => {
  const elements = {
    "#budget-upload-month": makeElement(),
    "#budget-month-picker": makeElement(),
    "#budget-month-chip-list": makeElement(),
    "#budget-store-filter": makeElement("旧筛选"),
  };
  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
  const locationRef = { search: "" };
  const feature = createBudgetTargetsFeature({
    root,
    bind() {},
    closestTarget: () => null,
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: (elementOrSelector) => {
      const element = typeof elementOrSelector === "string" ? root.querySelector(elementOrSelector) : elementOrSelector;
      return element?.value || "";
    },
    formatMoney: String,
    formatNumber: String,
    formatPercent: String,
    getPacificDateParts: () => ({ year: 2026, month: 8 }),
    locationRef,
    readFileAsBase64: async () => "",
    renderTableMessage() {},
    setButtonBusy: () => () => {},
    setText() {},
    trimmedFieldValue: (selector) => String(root.querySelector(selector)?.value || "").trim(),
  });

  feature.initializeBudgetDefaults();
  locationRef.search = "?view=budget&budgetMonths=2026-06%2C2026-07&budgetStores=A&budgetCountries=%E7%BE%8E%E5%9B%BD";
  feature.initializeBudgetDefaults();

  assert.match(elements["#budget-month-chip-list"].innerHTML, /2026年06月/);
  assert.match(elements["#budget-month-chip-list"].innerHTML, /2026年07月/);
  assert.equal(elements["#budget-store-filter"].value, "A");
  assert.deepEqual(feature.getBudgetDeepLinkScope(), {
    stores: ["A"],
    countries: ["美国"],
  });
});

test("budget deep-link countries match the budget service site labels", () => {
  assert.equal(normalizeBudgetDeepLinkCountry("美国站"), "美国");
  assert.equal(normalizeBudgetDeepLinkCountry("澳大利亚站"), "澳洲");
});

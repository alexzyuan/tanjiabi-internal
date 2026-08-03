import assert from "node:assert/strict";
import test from "node:test";

import {
  createBudgetTargetsFeature,
  normalizeBudgetDeepLinkCountry,
} from "../assets/js/features/budget-targets.js";
import { pickSellerCountry, pickSellerName } from "../assets/js/front-shop-filters.js";
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

function makeReportResponse({ name = "销售收入净额" } = {}) {
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
        groups: [{
          currencyCode: "USD",
          currencyAvailable: true,
          rows: [{
            key: "net-sales",
            category: "销售收入",
            name,
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
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeFeatureHarness({
  startMonth = "2026-06",
  endMonth = "2026-07",
  stores = [],
  countries = [],
  groups,
  fetchImpl,
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
    fetchImpl: fetchImpl || (async (url) => {
      requests.push(String(url));
      if (groups) {
        return {
          ...makeReportResponse(),
          async json() {
            const response = makeReportResponse();
            const data = await response.json();
            data.groups = groups;
            return data;
          },
        };
      }
      return makeReportResponse();
    }),
    formatActualMoney: (value) => String(value),
    getCurrentMonth: () => "2026-08",
    getStoreOptions: () => storeOptions,
    historyRef: history,
    locationRef: location,
    refreshTable: (table) => refreshes.push(table),
    normalizeCountryName: (country) => ({ US: "美国", CA: "加拿大", AU: "澳洲" }[country] || country || "-"),
    pickSellerCountry,
    pickSellerName,
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

test("seller aliases are normalized through the shared shop identity helpers", () => {
  const { feature, elements, optionUpdates } = makeFeatureHarness({
    storeOptions: [
      { seller_name: "seller-alias", marketplace: "US" },
      { account_name: "account-alias", country_name: "CA" },
      { shop_name: "shop-alias", marketplace: "AU" },
      { store_name: "store-alias", country_name: "美国" },
    ],
  });

  feature.initializeStoreOperatingMonthlyReportDefaults();

  const countryUpdate = optionUpdates.filter((item) => item.element === elements["#store-operating-report-country"]).at(-1);
  const storeUpdate = optionUpdates.filter((item) => item.element === elements["#store-operating-report-store"]).at(-1);
  assert.deepEqual(countryUpdate.options, ["澳洲", "加拿大", "美国"]);
  assert.deepEqual(
    storeUpdate.options.map(({ name, country }) => ({ name, country })),
    [
      { name: "seller-alias", country: "美国" },
      { name: "account-alias", country: "加拿大" },
      { name: "shop-alias", country: "澳洲" },
      { name: "store-alias", country: "美国" },
    ],
  );
});

test("the feature requires the managed table refresher dependency", () => {
  assert.throws(() => createStoreOperatingMonthlyReportFeature({
    root: { querySelector() { return null; } },
    bind() {},
    clickVisibleNavItem() {},
    downloadBlob() {},
    escapeHtml: String,
    fetchImpl() {},
    formatActualMoney: String,
    normalizeCountryName: String,
    pickSellerCountry,
    pickSellerName,
    selectedFilterValues() { return []; },
    setSelectOptions() {},
    setText() {},
    syncAllOptionSelection() {},
  }), /requires refreshTable/);
});

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
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="actual" data-column-kind="number" data-column-profile="money-rate"/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="budget" data-column-kind="number" data-column-profile="money-rate"/);
  assert.equal((elements["#store-operating-report-head"].innerHTML.match(/data-column-sortable="false"/g) || []).length, 6);
  assert.match(elements["#store-operating-report-body"].innerHTML, /销售收入净额/);
});

test("hierarchy renders expanded disclosure buttons and collapse keeps profit rows visible", async () => {
  const category = { key: "sales-profit-category", category: "销售利润", name: "销售利润", level: 1, children: ["sales-profit"], available: false };
  const profit = { key: "sales-profit", category: "销售利润", name: "销售利润", level: 2, actual: -6, budget: 10, share: -0.06, achievement: -0.6, available: true };
  const { feature, elements } = makeFeatureHarness({
    groups: [{ currencyCode: "USD", currencyAvailable: true, rows: [category, profit] }],
  });
  await feature.loadStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-body"].innerHTML, /data-report-category-toggle="sales-profit-category"/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /aria-expanded="true"/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /data-report-row-key="sales-profit"[^>]* hidden/);

  const ordinaryRow = { dataset: { reportRowKey: "ordinary-cost" }, hidden: false };
  const profitRow = { dataset: { reportRowKey: "sales-profit" }, hidden: false };
  elements["#store-operating-report-body"].querySelectorAll = () => [ordinaryRow, profitRow];
  const icon = { textContent: "▾" };
  const attributes = {};
  const button = {
    dataset: { currencyCode: "USD", reportCategoryToggle: "sales-profit-category" },
    setAttribute(name, value) { attributes[name] = value; },
    querySelector() { return icon; },
  };
  feature.toggleReportCategory({ target: { closest: () => button } });

  assert.equal(attributes["aria-expanded"], "false");
  assert.equal(icon.textContent, "▸");
  assert.equal(ordinaryRow.hidden, true);
  assert.equal(profitRow.hidden, false);
});

test("export surfaces structured server diagnostics", async () => {
  let callCount = 0;
  const { feature, elements } = makeFeatureHarness({
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 1) return makeReportResponse();
      return {
        ok: false,
        status: 502,
        async json() {
          return { error: "订单利润上游失败", details: { requestId: "trace-1" }, endpoint: "/basicOpen/finance/mreport/OrderProfit" };
        },
      };
    },
  });
  await feature.loadStoreOperatingMonthlyReport();
  await feature.exportStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-status"].textContent, /订单利润上游失败/);
  assert.match(elements["#store-operating-report-status"].textContent, /trace-1/);
  assert.match(elements["#store-operating-report-status"].textContent, /OrderProfit/);
});

test("a stale month response cannot replace the newer report DOM, URL, or status", async () => {
  const pending = [];
  const { feature, elements, location } = makeFeatureHarness({
    startMonth: "2026-06",
    endMonth: "2026-06",
    fetchImpl: (url) => {
      const deferred = createDeferred();
      pending.push({ url: String(url), deferred });
      return deferred.promise;
    },
  });

  const oldRequest = feature.loadStoreOperatingMonthlyReport();
  elements["#store-operating-report-end-month"].value = "2026-07";
  const newRequest = feature.handleMonthChange();

  assert.equal(pending.length, 2);
  pending[1].deferred.resolve(makeReportResponse({ name: "新月份数据" }));
  await newRequest;
  pending[0].deferred.resolve(makeReportResponse({ name: "旧月份数据" }));
  await oldRequest;

  assert.match(elements["#store-operating-report-body"].innerHTML, /新月份数据/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /旧月份数据/);
  assert.match(location.search, /endMonth=2026-07/);
  assert.equal(elements["#store-operating-report-status"].textContent, "预算已匹配 1 条");
});

test("store and country edits invalidate an in-flight report scope", async () => {
  for (const scope of ["store", "country"]) {
    const pending = createDeferred();
    const { feature, elements, location } = makeFeatureHarness({
      fetchImpl: () => pending.promise,
    });
    const request = feature.loadStoreOperatingMonthlyReport();

    if (scope === "store") {
      elements["#store-operating-report-store"].selectedValues = ["A"];
      feature.handleStoreChange();
    } else {
      elements["#store-operating-report-country"].selectedValues = ["美国"];
      feature.handleCountryChange();
    }
    pending.resolve(makeReportResponse({ name: `${scope} 旧筛选数据` }));
    await request;

    assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /旧筛选数据/);
    assert.equal(location.search, "");
    assert.equal(elements["#store-operating-report-export"].disabled, true);

    if (scope === "store") {
      elements["#store-operating-report-store"].selectedValues = [];
      feature.handleStoreChange();
    } else {
      elements["#store-operating-report-country"].selectedValues = [];
      feature.handleCountryChange();
    }
    assert.equal(elements["#store-operating-report-export"].disabled, true);
  }
});

test("failed rendering refreshes the managed table after replacing the header", async () => {
  const { feature, elements, refreshes } = makeFeatureHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async json() {
        return { ok: false, error: "报告服务不可用" };
      },
    }),
  });

  await feature.loadStoreOperatingMonthlyReport();

  assert.deepEqual(refreshes, [elements["#store-operating-report-table"]]);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="actual"/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /加载失败：报告服务不可用/);
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

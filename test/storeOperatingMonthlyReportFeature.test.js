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

function makeReportResponse({
  name = "销售收入净额",
  unavailableMetricNames = [],
  unavailableMetricDetails = [],
  customFeeSource = "/bd/profit/report/open/report/seller/list.otherFeeStr",
} = {}) {
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
          unavailableMetricNames,
          unavailableMetricDetails,
          customFeeSource,
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
  createDateRangePickerImpl,
  startDate = "2026-06-01",
  endDate = "2026-07-31",
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
    "#store-operating-report-start-date": makeElement(startDate),
    "#store-operating-report-end-date": makeElement(endDate),
    "#store-operating-report-store": makeElement(),
    "#store-operating-report-country": makeElement(),
    "#store-operating-report-currency": makeElement(""),
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
    bindBackdropClose() {},
    clickVisibleNavItem(target) {
      navTargets.push(target);
    },
    createDateRangePickerImpl,
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
    getCurrentDateRange: () => ({ startDate: "2026-08-01", endDate: "2026-08-07" }),
    getStoreOptions: () => storeOptions,
    historyRef: history,
    locationRef: location,
    refreshTable: (table) => refreshes.push(table),
    normalizeCountryName: (country) => ({ US: "美国", CA: "加拿大", AU: "澳洲" }[country] || country || "-"),
    pickSellerCountry,
    pickSellerName,
    selectedFilterValues: (element) => element?.selectedValues?.slice() || [],
    setButtonBusy: () => () => {},
    setModalOpenState() {},
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

test("monthly report seeds its current-month range before mounting the shared date picker", () => {
  const pickerOptions = [];
  const { feature, elements } = makeFeatureHarness({
    startDate: "",
    endDate: "",
    createDateRangePickerImpl(options) {
      pickerOptions.push(options);
      return { setup() {} };
    },
  });

  feature.setupStoreOperatingMonthlyReport();

  assert.equal(elements["#store-operating-report-start-date"].value, "2026-08-01");
  assert.equal(elements["#store-operating-report-end-date"].value, "2026-08-07");
  assert.equal(pickerOptions.length, 1);
  assert.equal(pickerOptions[0].maxCalendarMonths, 12);
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

test("valid date ranges request exact dates and invalid 13-month date ranges do not request", async () => {
  const { feature, requests, elements } = makeFeatureHarness({
    startDate: "2026-06-01",
    endDate: "2026-07-31",
    stores: ["A"],
    countries: ["美国"],
  });

  await feature.loadStoreOperatingMonthlyReport();
  assert.match(requests[0], /currencyCode=CNY/);
  assert.match(requests[0], /startDate=2026-06-01/);
  assert.match(requests[0], /endDate=2026-07-31/);
  assert.match(requests[0], /stores=A/);
  assert.match(requests[0], /countries=%E7%BE%8E%E5%9B%BD/);

  elements["#store-operating-report-start-date"].value = "2025-07-01";
  elements["#store-operating-report-end-date"].value = "2026-08-07";
  await feature.handleDateRangeChange();

  assert.match(elements["#store-operating-report-status"].textContent, /最多 12 个月/);
  assert.equal(requests.length, 1);
});

test("date range edits send exact startDate and endDate to the report API", async () => {
  const { feature, elements, requests } = makeFeatureHarness();
  elements["#store-operating-report-start-date"] = makeElement("2026-08-01");
  elements["#store-operating-report-end-date"] = makeElement("2026-08-07");
  delete elements["#store-operating-report-start-month"];
  delete elements["#store-operating-report-end-month"];

  await feature.loadStoreOperatingMonthlyReport();

  assert.match(requests[0], /startDate=2026-08-01/);
  assert.match(requests[0], /endDate=2026-08-07/);
  assert.doesNotMatch(requests[0], /startMonth=/);
});

test("currency filter defaults to CNY and explicit ORIGINAL selection is sent to the report API", async () => {
  const { feature, elements, requests } = makeFeatureHarness();

  await feature.loadStoreOperatingMonthlyReport();
  assert.equal(elements["#store-operating-report-currency"].value, "CNY");
  assert.match(requests[0], /currencyCode=CNY/);

  elements["#store-operating-report-currency"].value = "ORIGINAL";
  feature.handleCurrencyChange();
  await feature.loadStoreOperatingMonthlyReport();
  assert.match(requests[1], /currencyCode=ORIGINAL/);
});

test("budget action carries the active scope to the budget view", () => {
  const { feature, location, navTargets } = makeFeatureHarness({
    startDate: "2026-06-01",
    endDate: "2026-07-31",
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

test("successful rendering refreshes the shared managed table and writes filter state without pinning the startup view", async () => {
  const { feature, location, refreshes, elements } = makeFeatureHarness({ stores: ["A"] });

  await feature.loadStoreOperatingMonthlyReport();

  assert.deepEqual(refreshes, [elements["#store-operating-report-table"]]);
  assert.doesNotMatch(location.search, /view=store-operating-monthly-report/);
  assert.match(location.search, /startDate=2026-06-01/);
  assert.match(location.search, /stores=A/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="group-0-actual"[^>]*data-column-kind="number"[^>]*data-column-profile="money-rate"/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="group-0-budget"[^>]*data-column-kind="number"[^>]*data-column-profile="money-rate"/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /A · USD/);
  assert.ok((elements["#store-operating-report-head"].innerHTML.match(/data-column-sortable="false"/g) || []).length >= 6);
  assert.match(elements["#store-operating-report-body"].innerHTML, /销售收入净额/);
});

test("successful rendering attributes absent custom expense subjects to the seller-profit report", async () => {
  const { feature, elements } = makeFeatureHarness({
    fetchImpl: async () => makeReportResponse({
      unavailableMetricNames: ["广告费", "FBA国际物流运费"],
      unavailableMetricDetails: [{ category: "custom-expense" }],
    }),
  });

  await feature.loadStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-status"].textContent, /不可用科目：广告费、FBA国际物流运费/);
  assert.match(elements["#store-operating-report-status"].textContent, /店铺利润报表未返回对应费用科目/);
  assert.doesNotMatch(elements["#store-operating-report-status"].textContent, /未配置独立数据源/);
});

test("monthly report uses a single 科目 column and collapses non-profit subtotal details by default", async () => {
  const subtotal = {
    key: "revenue",
    category: "销售收入",
    name: "销售收入",
    level: 1,
    actual: 100,
    children: ["sales-income", "sales-discount"],
    available: true,
  };
  const details = [
    { key: "sales-income", category: "销售收入", name: "销售收入", level: 2, actual: 120, share: 1.2, available: true },
    { key: "sales-discount", category: "销售收入", name: "销售折扣", level: 2, actual: 20, share: 0.2, available: true },
  ];
  const { feature, elements } = makeFeatureHarness({
    groups: [{ currencyCode: "USD", currencyAvailable: true, rows: [subtotal, ...details] }],
  });

  await feature.loadStoreOperatingMonthlyReport();

  assert.doesNotMatch(elements["#store-operating-report-head"].innerHTML, />上级<\/th>/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="name"[^>]*>科目<\/th>/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /data-report-category-toggle="revenue"[^>]*aria-expanded="false"/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /销售收入小计/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /基础信息小计/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /data-report-row-key="sales-income"/);
});

test("account row visibility hides configured detail rows while retaining expanded category subtotals", async () => {
  const requests = [];
  const groups = [{
    currencyCode: "CNY",
    currencyAvailable: true,
    rows: [
      { key: "store-a", category: "店铺", name: "A", level: 0, children: ["platform-expense"] },
      { key: "platform-expense", category: "平台支出", name: "平台支出", level: 1, actual: 30, share: 1, budget: null, achievement: null, children: ["platform-fee", "ad-fee"] },
      { key: "platform-fee", category: "平台支出", name: "平台费", level: 2, actual: 10, share: 1 / 3, budget: null, achievement: null },
      { key: "ad-fee", category: "平台支出", name: "广告费", level: 2, actual: 20, share: 2 / 3, budget: null, achievement: null },
    ],
  }];
  const { feature, elements } = makeFeatureHarness({
    groups,
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url) === "/api/finance/store-operating-monthly-report/row-visibility") {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              hiddenMetricIds: ["ad-fee"],
              metrics: [{ key: "ad-fee", name: "广告费", category: "platform-expense", categoryName: "平台支出" }],
            };
          },
        };
      }
      const response = makeReportResponse();
      return {
        ...response,
        async json() {
          const data = await response.json();
          data.groups = groups;
          return data;
        },
      };
    },
  });

  await feature.loadStoreOperatingMonthlyReportRowVisibility();
  await feature.loadStoreOperatingMonthlyReport();
  feature.toggleReportCategory({
    target: {
      closest(selector) {
        return selector === "[data-report-category-toggle]"
          ? { dataset: { reportCategoryToggle: "platform-expense" }, setAttribute() {}, querySelector() { return null; } }
          : null;
      },
    },
  });

  assert.ok(requests.includes("/api/finance/store-operating-monthly-report/row-visibility"));
  assert.match(elements["#store-operating-report-body"].innerHTML, /平台支出小计/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /平台费/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /广告费/);
});

test("saving account row visibility sends only hidden metric ids and applies the returned setting", async () => {
  const requests = [];
  const groups = [{
    currencyCode: "CNY",
    currencyAvailable: true,
    rows: [
      { key: "store-a", category: "店铺", name: "A", level: 0, children: ["platform-expense"] },
      { key: "platform-expense", category: "平台支出", name: "平台支出", level: 1, actual: 30, share: 1, budget: null, achievement: null, children: ["ad-fee"] },
      { key: "ad-fee", category: "平台支出", name: "广告费", level: 2, actual: 30, share: 1, budget: null, achievement: null },
    ],
  }];
  const { feature, elements } = makeFeatureHarness({
    groups,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url) === "/api/finance/store-operating-monthly-report/row-visibility") {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              hiddenMetricIds: options.method === "PUT" ? ["ad-fee"] : [],
              metrics: [{ key: "ad-fee", name: "广告费", category: "platform-expense", categoryName: "平台支出" }],
            };
          },
        };
      }
      const response = makeReportResponse();
      return {
        ...response,
        async json() {
          const data = await response.json();
          data.groups = groups;
          return data;
        },
      };
    },
  });

  await feature.loadStoreOperatingMonthlyReportRowVisibility();
  await feature.loadStoreOperatingMonthlyReport();
  await feature.saveStoreOperatingMonthlyReportRowVisibility(["ad-fee"]);
  feature.toggleReportCategory({
    target: {
      closest(selector) {
        return selector === "[data-report-category-toggle]"
          ? { dataset: { reportCategoryToggle: "platform-expense" }, setAttribute() {}, querySelector() { return null; } }
          : null;
      },
    },
  });

  const saveRequest = requests.find((request) => request.options.method === "PUT");
  assert.equal(saveRequest.url, "/api/finance/store-operating-monthly-report/row-visibility");
  assert.equal(saveRequest.options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(saveRequest.options.body), { hiddenMetricIds: ["ad-fee"] });
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /广告费/);
});

test("monthly report does not render the removed basic-info block", async () => {
  const rows = [
    { key: "overview", category: "总概", name: "总概", level: 0, children: ["basic-info"] },
    { key: "basic-info", category: "基础信息", name: "基础信息", level: 1, children: ["store-country"], available: true },
    { key: "store-country", category: "基础信息", name: "店铺/国家", level: 2, actual: "Store-US / 美国", valueType: "text", available: true },
  ];
  const { feature, elements } = makeFeatureHarness({ groups: [{ currencyCode: "CNY", currencyAvailable: true, rows }] });

  await feature.loadStoreOperatingMonthlyReport();
  const body = elements["#store-operating-report-body"].innerHTML;
  assert.doesNotMatch(body, /基础信息小计/);
  assert.doesNotMatch(body, /data-report-row-key="store-country"/);
});

test("hierarchy renders collapsed subtotals and expands their detail rows", async () => {
  const category = { key: "sales-profit-category", category: "销售利润", name: "销售利润", level: 1, children: ["sales-profit"], available: false };
  const profit = { key: "sales-profit", category: "销售利润", name: "销售利润", level: 2, actual: -6, budget: 10, share: -0.06, achievement: -0.6, available: true };
  const { feature, elements } = makeFeatureHarness({
    groups: [{ currencyCode: "USD", currencyAvailable: true, rows: [category, profit] }],
  });
  await feature.loadStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-body"].innerHTML, /data-report-category-toggle="sales-profit-category"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /data-report-row-key="sales-profit"/);

  const icon = { textContent: "▾" };
  const attributes = {};
  const button = {
    dataset: { reportCategoryToggle: "sales-profit-category" },
    setAttribute(name, value) { attributes[name] = value; },
    querySelector() { return icon; },
  };
  feature.toggleReportCategory({ target: { closest: () => button } });

  assert.equal(elements["#store-operating-report-body"].innerHTML.includes('data-report-row-key="sales-profit"'), true);
  assert.match(elements["#store-operating-report-body"].innerHTML, /data-report-category-toggle="sales-profit-category"[^>]*aria-expanded="true"/);
});

test("monthly report renders毛利润 directly for the profit section", async () => {
  const rows = [
    { key: "overview", category: "总概", name: "总概", level: 0, children: ["platform-income", "profit"] },
    { key: "platform-income", category: "平台收入", name: "平台收入", level: 1, actual: 100, children: ["net-sales"], available: true },
    { key: "net-sales", category: "平台收入", name: "净销售额", level: 2, actual: 100, available: true },
    { key: "profit", category: "利润", name: "利润", level: 1, actual: 30, children: ["gross-profit", "gross-rate", "net-gross-rate"], available: true },
    { key: "gross-profit", category: "利润", name: "毛利润", level: 2, actual: 80, available: true },
    { key: "gross-rate", category: "利润", name: "毛利率", level: 2, actual: 0.8, valueType: "rate", available: true },
    { key: "net-gross-rate", category: "利润", name: "净毛利率", level: 2, actual: 0.3, valueType: "rate", available: true },
  ];
  const { feature, elements } = makeFeatureHarness({ groups: [{ currencyCode: "USD", currencyAvailable: true, rows }] });

  await feature.loadStoreOperatingMonthlyReport();
  const body = elements["#store-operating-report-body"].innerHTML;

  assert.match(body, /平台收入小计/);
  assert.doesNotMatch(body, /利润小计/);
  assert.match(body, /class="store-operating-report-result-row"[^>]*data-report-row-key="gross-profit"/);
  assert.match(body, /毛利润/);
  assert.match(body, /data-report-row-key="gross-profit"[\s\S]*?data-report-metric="share">/);
  assert.doesNotMatch(body, /data-report-category-toggle="profit"/);
  assert.doesNotMatch(body, /毛利率/);
  assert.doesNotMatch(body, /净毛利率/);
});

test("monthly report renders sales net between platform income and expense without a disclosure", async () => {
  const rows = [
    { key: "overview", category: "总概", name: "总概", level: 0, children: ["platform-income", "sales-net", "platform-expense"] },
    { key: "platform-income", category: "平台收入", name: "平台收入", level: 1, actual: 200, children: [] },
    { key: "sales-net", category: "销售净额", name: "销售净额", level: 1, actual: 155, share: 0.775, children: [] },
    { key: "platform-expense", category: "平台支出", name: "平台支出", level: 1, actual: 80, children: [] },
  ];
  const { feature, elements } = makeFeatureHarness({
    groups: [{ currencyCode: "CNY", rows }],
  });

  await feature.loadStoreOperatingMonthlyReport();

  const body = elements["#store-operating-report-body"].innerHTML;
  assert.match(body, /data-report-row-key="platform-income"[\s\S]*?data-report-row-key="sales-net"[\s\S]*?data-report-row-key="platform-expense"/);
  assert.match(body, /data-report-row-key="sales-net"[\s\S]*?>销售净额<\/td>/);
  assert.doesNotMatch(body, /销售净额小计/);
  assert.doesNotMatch(body, /data-report-category-toggle="sales-net"/);
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

test("report load surfaces structured server diagnostics", async () => {
  const { feature, elements } = makeFeatureHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      async json() {
        return { error: "订单利润上游失败", details: { requestId: "trace-load" }, endpoint: "/basicOpen/finance/mreport/OrderProfit" };
      },
    }),
  });

  await feature.loadStoreOperatingMonthlyReport();

  assert.match(elements["#store-operating-report-status"].textContent, /trace-load/);
  assert.match(elements["#store-operating-report-status"].textContent, /OrderProfit/);
});

test("a stale month response cannot replace the newer report DOM, URL, or status", async () => {
  const pending = [];
  const { feature, elements, location } = makeFeatureHarness({
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    fetchImpl: (url) => {
      const deferred = createDeferred();
      pending.push({ url: String(url), deferred });
      return deferred.promise;
    },
  });

  const oldRequest = feature.loadStoreOperatingMonthlyReport();
  elements["#store-operating-report-end-date"].value = "2026-07-31";
  const newRequest = feature.handleDateRangeChange();

  assert.equal(pending.length, 2);
  pending[1].deferred.resolve(makeReportResponse({ name: "新月份数据" }));
  await newRequest;
  pending[0].deferred.resolve(makeReportResponse({ name: "旧月份数据" }));
  await oldRequest;

  assert.match(elements["#store-operating-report-body"].innerHTML, /新月份数据/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /旧月份数据/);
  assert.match(location.search, /endDate=2026-07-31/);
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
  assert.match(elements["#store-operating-report-head"].innerHTML, /data-column-key="name"[^>]*>科目<\/th>/);
  assert.match(elements["#store-operating-report-body"].innerHTML, /加载失败：报告服务不可用/);
});

test("multi-currency rows render currency in the group headers", async () => {
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

  assert.match(elements["#store-operating-report-head"].innerHTML, /全部店铺 · CAD/);
  assert.match(elements["#store-operating-report-head"].innerHTML, /全部店铺 · USD/);
  assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /colspan=/);
});

test("selected stores render one four-metric group per store and merge rows horizontally", async () => {
  const row = (actual, budget) => ({
    key: "net-sales",
    category: "销售收入",
    name: "销售收入净额",
    level: 2,
    actual,
    share: 1,
    budget,
    achievement: actual / budget,
    available: true,
  });
  const { feature, elements } = makeFeatureHarness({
    stores: ["A", "B"],
    groups: [
      { storeName: "A", currencyCode: "CNY", currencyAvailable: true, rows: [row(100, 120)] },
      { storeName: "B", currencyCode: "CNY", currencyAvailable: true, rows: [row(80, 100)] },
    ],
  });

  await feature.loadStoreOperatingMonthlyReport();

  const header = elements["#store-operating-report-head"].innerHTML;
  assert.match(header, /<th colspan="4"[^>]*>A · CNY<\/th>/);
  assert.match(header, /<th colspan="4"[^>]*>B · CNY<\/th>/);
  assert.equal((header.match(/data-report-metric=/g) || []).length, 8);
  const body = elements["#store-operating-report-body"].innerHTML;
  assert.equal((body.match(/销售收入净额/g) || []).length, 1);
  assert.match(body, /data-report-group-index="0" data-report-metric="actual">100/);
  assert.match(body, /data-report-group-index="1" data-report-metric="actual">80/);
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

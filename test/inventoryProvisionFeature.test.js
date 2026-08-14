import assert from "node:assert/strict";
import test from "node:test";

import { createInventoryProvisionFeature } from "../assets/js/features/inventory-provision.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createInventoryProvisionFeature({
    root,
    loadDashboardSection: async () => {},
    bind: (...args) => bindCalls.push(args),
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fetchImpl: async () => ({ ok: true, blob: async () => new Blob(), headers: { get: () => "" } }),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatNumber: (value) => String(value),
    getDefaultMonth: () => "2026-07",
    renderTableMessage: () => {},
    selectedFilterValue: () => "",
    selectedFilterValues: () => [],
    setButtonBusy: () => () => {},
    setSelectOptions: () => {},
    setText: () => {},
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, feature };
}

test("inventory provision feature owns its DOM event bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupInventoryProvision();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#inventory-provision-refresh", "click", feature.loadInventoryProvision],
      ["#inventory-provision-export", "click", bindCalls[1][3]],
      ["#inventory-provision-refresh-costs", "click", feature.refreshInventoryProvisionCosts],
      ["#inventory-provision-date", "change", bindCalls[3][3]],
      ["#inventory-provision-country", "change", bindCalls[4][3]],
      ["#inventory-provision-store", "change", bindCalls[5][3]],
      ["#inventory-provision-owner", "change", feature.loadInventoryProvision],
      ["#inventory-provision-cost-mode", "change", feature.loadInventoryProvision],
      ["#inventory-provision-keyword", "keydown", bindCalls[8][3]],
      ["#inventory-detail-table", "click", bindCalls[9][3]],
    ],
  );
});

test("inventory provision cost refresh confirms the annual scope, posts no month, and reloads the dashboard", async () => {
  const elements = new Map([
    ["#inventory-provision-date", { value: "2026-05" }],
    ["#inventory-provision-refresh-costs", { disabled: false }],
  ]);
  const fetchCalls = [];
  const statuses = [];
  let confirmation = "";
  let dashboardLoads = 0;
  const { feature } = createFeature({
    root: { querySelector: (selector) => elements.get(selector) || null },
    fieldValue: (selector) => elements.get(selector)?.value || "",
    confirmImpl: (message) => {
      confirmation = message;
      return true;
    },
    fetchImpl: async (...args) => {
      fetchCalls.push(args);
      return {
        ok: true,
        json: async () => ({ ok: true, refresh: {
          year: "2026",
          refreshedAt: "2026/8/14 10:00:00",
          months: [
            { month: "2026-01", updatedRows: 1 },
            { month: "2026-07", updatedRows: 2 },
          ],
        } }),
      };
    },
    loadDashboardSection: async () => { dashboardLoads += 1; },
    setText: (selector, value) => statuses.push([selector, value]),
  });

  await feature.refreshInventoryProvisionCosts();

  assert.equal(confirmation, "将使用领星产品管理当前采购成本和单位头程成本，刷新本年度所有已结束月份。是否继续？");
  assert.deepEqual(fetchCalls, [[
    "/api/dashboard/inventory-provision/refresh-costs",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
  ]]);
  assert.equal(dashboardLoads, 1);
  assert.match(statuses.at(-1)[1], /2026-01.*2026-07.*3/);
  assert.match(statuses.at(-1)[1], /成本缓存刷新时间：2026\/8\/14 10:00:00/);
});

test("inventory provision cost refresh preserves the rendered table when the API fails", async () => {
  const table = { innerHTML: "existing rows" };
  const elements = new Map([
    ["#inventory-provision-date", { value: "2026-08" }],
    ["#inventory-provision-refresh-costs", { disabled: false }],
    ["#inventory-detail-table", table],
  ]);
  const statuses = [];
  let dashboardLoads = 0;
  const { feature } = createFeature({
    root: { querySelector: (selector) => elements.get(selector) || null },
    confirmImpl: () => true,
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "ERP Listing 查询失败" }),
    }),
    loadDashboardSection: async () => { dashboardLoads += 1; },
    setText: (selector, value) => statuses.push([selector, value]),
  });

  await feature.refreshInventoryProvisionCosts();

  assert.equal(dashboardLoads, 0);
  assert.equal(table.innerHTML, "existing rows");
  assert.equal(statuses.at(-1)[1], "成本刷新失败：ERP Listing 查询失败");
});

test("inventory provision cost refresh remains available when the dashboard selects the current month", async () => {
  const elements = new Map([
    ["#inventory-provision-date", { value: "2026-08" }],
    ["#inventory-provision-refresh-costs", { disabled: false }],
  ]);
  let requestCount = 0;
  const { feature } = createFeature({
    root: { querySelector: (selector) => elements.get(selector) || null },
    fieldValue: (selector) => elements.get(selector)?.value || "",
    confirmImpl: () => true,
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, json: async () => ({ ok: true, refresh: { year: "2026", months: [], refreshedAt: "2026/8/14 10:00:00" } }) };
    },
    getDefaultMonth: () => "2026-08",
  });

  await feature.refreshInventoryProvisionCosts();

  assert.equal(requestCount, 1);
});

test("inventory provision historical note labels the cost cache refresh time", () => {
  const elements = new Map([
    ["#inventory-provision-date", { value: "2026-01" }],
    ["#inventory-provision-refresh-costs", { disabled: false }],
    ["#inventory-detail-table", { innerHTML: "" }],
    ["#inventory-bucket-table", { innerHTML: "" }],
    ["#inventory-age-trend-chart", { innerHTML: "" }],
    ["#inventory-age-donut-chart", { innerHTML: "" }],
    ["#inventory-store-chart", { innerHTML: "" }],
  ]);
  const texts = new Map();
  const { feature } = createFeature({
    root: { querySelector: (selector) => elements.get(selector) || null },
    setText: (selector, value) => texts.set(selector, value),
  });

  feature.renderInventoryProvision({
    meta: {
      source: "测试",
      date: "2026-01",
      historicalMode: true,
      snapshotAvailable: true,
      costRefreshedAt: "2026/8/13 10:00:00",
    },
    filters: { countryOptions: [], storeOptions: [], ownerOptions: [] },
    buckets: [],
    bucketSummary: [],
    storeDistribution: [],
    monthTrend: [],
    kpis: {},
    detailRows: [],
  });

  assert.match(texts.get("#inventory-provision-date-note"), /成本缓存刷新时间：2026\/8\/13 10:00:00/);
});

test("inventory provision renders MSKU summary rows and expands batch details from the MSKU button", () => {
  const elements = new Map();
  const detailTable = {
    innerHTML: "",
    rowsByKey: new Map(),
    togglesByKey: new Map(),
    querySelectorAll(selector) {
      if (selector === "[data-inventory-batch-row]") return [...this.rowsByKey.values()];
      return [];
    },
    querySelector(selector) {
      const rowMatch = selector.match(/\[data-inventory-batch-row="([^"]+)"\]/);
      if (rowMatch) return this.rowsByKey.get(rowMatch[1]) || null;
      const toggleMatch = selector.match(/\[data-inventory-summary-toggle="([^"]+)"\]/);
      if (toggleMatch) return this.togglesByKey.get(toggleMatch[1]) || null;
      return null;
    },
  };
  elements.set("#inventory-detail-table", detailTable);
  elements.set("#inventory-bucket-table", { innerHTML: "" });
  ["#inventory-age-trend-chart", "#inventory-age-donut-chart", "#inventory-store-chart"].forEach((selector) => {
    elements.set(selector, { innerHTML: "" });
  });
  const root = {
    querySelector(selector) {
      return elements.get(selector) || detailTable.querySelector(selector);
    },
  };
  const bindCalls = [];
  const { feature } = createFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    formatActualMoney: (value) => Number(value || 0).toLocaleString("zh-CN"),
    formatNumber: (value) => Number(value || 0).toLocaleString("zh-CN"),
  });

  feature.renderInventoryProvision({
    meta: { source: "测试", date: "2026-05", syncStatus: "已同步", snapshotAvailable: true },
    filters: { countryOptions: [], storeOptions: [], ownerOptions: [] },
    buckets: [],
    bucketSummary: [],
    storeDistribution: [],
    monthTrend: [],
    kpis: {},
    detailRows: [
      {
        rowKey: "xiamentanjia-us|美国|jm-9006truck|林芃",
        storeName: "xiamentanjia-US",
        country: "美国",
        msku: "JM-9006Truck",
        skuName: "TJ024高速越野短卡绿色",
        listingOwner: "林芃",
        quantity: 135,
        amount: 24975,
        provisionAmount: 18278,
        monthlyProvisionAmount: 9990,
        reversalAmount: 1850,
        netProvisionAmount: 8140,
        batchRows: [
          {
            cohortMonth: "2025-11",
            ageDays: 210,
            bucketLabel: "181-270天",
            quantity: 112,
            amount: 20720,
            provisionAmount: 16576,
            monthlyProvisionAmount: 8288,
            reversalAmount: 1850,
            netProvisionAmount: 6438,
          },
        ],
      },
    ],
  });

  assert.match(detailTable.innerHTML, /data-inventory-summary-toggle="xiamentanjia-us\\|美国\\|jm-9006truck\\|林芃"/);
  assert.match(detailTable.innerHTML, /JM-9006Truck/);
  assert.match(detailTable.innerHTML, />135</);
  assert.match(detailTable.innerHTML, />¥24,975</);
  assert.match(detailTable.innerHTML, />¥18,278</);
  assert.match(detailTable.innerHTML, />¥9,990</);
  assert.match(detailTable.innerHTML, />¥1,850</);
  assert.match(detailTable.innerHTML, />¥8,140</);
  assert.doesNotMatch(detailTable.innerHTML, /单位采购成本/);
  assert.match(detailTable.innerHTML, /2025-11 批次/);

  feature.setupInventoryProvision();
  const clickHandler = bindCalls.find(([, selector, eventName]) => selector === "#inventory-detail-table" && eventName === "click")?.[3];
  assert.equal(typeof clickHandler, "function");
  const batchRow = { hidden: true };
  const toggle = {
    dataset: { inventorySummaryToggle: "xiamentanjia-us|美国|jm-9006truck|林芃" },
    textContent: "JM-9006Truck",
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  detailTable.rowsByKey.set("xiamentanjia-us|美国|jm-9006truck|林芃", batchRow);
  detailTable.togglesByKey.set("xiamentanjia-us|美国|jm-9006truck|林芃", toggle);
  clickHandler({
    target: {
      closest(selector) {
        if (selector === "[data-inventory-summary-toggle]") {
          return toggle;
        }
        return null;
      },
    },
  });

  assert.equal(batchRow.hidden, false);
  assert.equal(toggle["aria-expanded"], "true");
});

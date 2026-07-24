import assert from "node:assert/strict";
import test from "node:test";

import { createSalesDashboardFeature } from "../assets/js/features/sales-dashboard.js";

function createFeature(overrides = {}) {
  return createSalesDashboardFeature({
    bind: () => null,
    bindAll: () => [],
    buildDashboardQuery: () => "startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL",
    ...overrides,
  });
}

test("sales dashboard feature loads the sales weekly endpoint with the dashboard query", async () => {
  const requests = [];
  const { loadDashboard } = createFeature({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ meta: { source: "mock" }, summary: [["销售额", "100"]] }),
      };
    },
  });

  const dashboard = await loadDashboard();

  assert.equal(dashboard.meta.source, "mock");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/api\/dashboard\/sales-weekly\?startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL&_=.+/);
  assert.deepEqual(requests[0].options, { cache: "no-store", credentials: "same-origin" });
});

test("sales dashboard feature redirects on an expired session and returns fallback data", async () => {
  let redirectCount = 0;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const { loadDashboard } = createFeature({
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized" }),
      }),
      redirectToLogin: () => {
        redirectCount += 1;
      },
    });

    const dashboard = await loadDashboard();

    assert.equal(redirectCount, 1);
    assert.equal(dashboard.meta.source, "接口未连接");
    assert.match(dashboard.meta.syncStatus, /登录状态已失效/);
  } finally {
    console.info = originalInfo;
  }
});

test("sales dashboard feature keeps the three quick owner names in the owner select", () => {
  const ownerSelect = {
    value: "运营A",
    options: [
      { value: "" },
      { value: "运营A" },
      { value: "林芃" },
      { value: "熊丹轩" },
      { value: "黄超" },
    ],
    set innerHTML(value) {
      this._innerHTML = value;
    },
    get innerHTML() {
      return this._innerHTML || "";
    },
  };
  const root = {
    querySelector(selector) {
      return selector === "#front-owner-filter" ? ownerSelect : null;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { renderDashboard } = createSalesDashboardFeature({
      root,
      bind: () => null,
      bindAll: () => [],
      buildDashboardQuery: () => "startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL",
      canAccessFinance: () => false,
      escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      getCurrentAuthUser: () => null,
      setText: () => {},
    });

    renderDashboard({ filters: { ownerOptions: [{ value: "运营A", name: "运营A" }] } });

    assert.match(ownerSelect.innerHTML, /林芃/);
    assert.match(ownerSelect.innerHTML, /熊丹轩/);
    assert.match(ownerSelect.innerHTML, /黄超/);
    assert.match(ownerSelect.innerHTML, /运营A/);
    assert.equal(ownerSelect.value, "运营A");
  } finally {
    console.error = originalError;
  }
});

test("sales dashboard feature filters MSKU detail rows by current listing owner", () => {
  const ownerSelect = {
    value: "熊丹轩",
    options: [
      { value: "" },
      { value: "林芃" },
      { value: "熊丹轩" },
    ],
    set innerHTML(value) {
      this._innerHTML = value;
    },
    get innerHTML() {
      return this._innerHTML || "";
    },
  };
  const detailTable = { innerHTML: "" };
  const storeTabs = { innerHTML: "" };
  const status = { textContent: "" };
  const root = {
    querySelector(selector) {
      return {
        "#front-owner-filter": ownerSelect,
        "#detail-table": detailTable,
        "#msku-store-tabs": storeTabs,
        "#msku-detail-status": status,
      }[selector] || null;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { renderDashboard } = createSalesDashboardFeature({
      root,
      bind: () => null,
      bindAll: () => [],
      buildDashboardQuery: () => "startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL&listingOwner=%E7%86%8A%E4%B8%B9%E8%BD%A9",
      canAccessFinance: () => false,
      escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      formatActualMoney: (value) => String(value),
      formatNumber: (value) => String(value),
      getCurrentAuthUser: () => null,
      renderDataValueButtonsHtml: (items, dataAttribute) => items.map((item) => `<button ${dataAttribute}="${item}">${item}</button>`).join(""),
      setTableSortButtonGroupState: () => {},
      setText: () => {},
    });

    renderDashboard({
      filters: { ownerOptions: [{ value: "林芃", name: "林芃" }, { value: "熊丹轩", name: "熊丹轩" }] },
      detailRows: [
        { budgetStoreName: "探嘉美国", msku: "MSKU-LP", listingOwner: "林芃", productName: "林芃产品", budgetQuantity: 1 },
        { budgetStoreName: "探嘉加拿大", msku: "MSKU-XDX", listingOwner: "熊丹轩", productName: "熊丹轩产品", budgetQuantity: 2 },
      ],
    });

    assert.equal(status.textContent, "随销售看板同步加载 · 1 条预算 MSKU");
    assert.match(detailTable.innerHTML, /MSKU-XDX/);
    assert.doesNotMatch(detailTable.innerHTML, /MSKU-LP/);
    assert.match(storeTabs.innerHTML, /探嘉加拿大/);
    assert.doesNotMatch(storeTabs.innerHTML, /探嘉美国/);
  } finally {
    console.error = originalError;
  }
});

test("sales dashboard feature reveals the MSKU detail panel", () => {
  const scrollCalls = [];
  const panel = {
    scrollIntoView(options) {
      scrollCalls.push(options);
    },
  };
  const detailTable = {
    closest(selector) {
      return selector === ".detail-panel" ? panel : null;
    },
  };
  const root = {
    querySelector(selector) {
      return selector === "#detail-table" ? detailTable : null;
    },
  };
  const { revealMskuDetailPanel } = createSalesDashboardFeature({
    root,
    bind: () => null,
    bindAll: () => [],
    buildDashboardQuery: () => "startDate=2026-07-01&endDate=2026-07-06&currencyCode=ORIGINAL",
  });

  revealMskuDetailPanel();

  assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "start" }]);
});

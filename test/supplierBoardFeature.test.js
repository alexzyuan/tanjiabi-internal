import assert from "node:assert/strict";
import test from "node:test";

import { createSupplierBoardFeature } from "../assets/js/features/supplier-board.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createSupplierBoardFeature({
    root,
    loadDashboardSection: async () => {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    bind: (...args) => bindCalls.push(args),
    bindAll: (...args) => bindAllCalls.push(args),
    closestTarget: () => null,
    compareTableSortableValues: () => 0,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatActualMoney: (value) => String(value),
    formatRateNullable: (value) => String(value),
    normalizeCountryName: (value) => String(value ?? ""),
    selectedFilterValues: () => [],
    setSelectOptions: () => {},
    setTableSortButtonGroupState: () => {},
    setButtonBusy: (button, busyText, restoreText = button?.textContent || "") => {
      if (!button) return () => {};
      button.disabled = true;
      button.textContent = busyText;
      return () => {
        button.disabled = false;
        button.textContent = restoreText;
      };
    },
    setText: () => {},
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindAllCalls, bindCalls, feature };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

async function createProductRefreshFeatureFixture({ rows = [], refreshResponse = jsonResponse({ ok: true, meta: { refreshCommittedCount: 1 } }), reloadResult = { ok: true }, reloadError = null, selectedValues = {} } = {}) {
  const bindCalls = [];
  const bindAllCalls = [];
  const requests = [];
  const dashboardLoads = [];
  const status = { textContent: "" };
  const productRefreshListeners = new Map();
  const productRefreshButton = {
    disabled: false,
    textContent: "刷新商品资料",
    addEventListener(eventName, handler) {
      const handlers = productRefreshListeners.get(eventName) || [];
      handlers.push(handler);
      productRefreshListeners.set(eventName, handlers);
    },
    async dispatch(eventName, init = {}) {
      const event = {
        defaultPrevented: false,
        isComposing: false,
        key: "",
        repeat: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...init,
      };
      const handlers = productRefreshListeners.get(eventName) || [];
      await Promise.all(handlers.map((handler) => handler.call(productRefreshButton, event)));
      return event;
    },
  };
  const startDate = {
    value: "2026-01",
    type: "text",
    removeAttribute() {},
  };
  const endDate = {
    value: "2026-02",
    type: "text",
    removeAttribute() {},
  };
  const elements = new Map([
    ["#supplier-board-status", status],
    ["#supplier-board-product-refresh", productRefreshButton],
    ["#supplier-board-start-date", startDate],
    ["#supplier-board-end-date", endDate],
  ]);
  const root = {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  let dashboardData = { rows };
  let dashboardLoadCount = 0;
  const feature = createSupplierBoardFeature({
    root,
    loadDashboardSection: async (options) => {
      dashboardLoadCount += 1;
      const endpoint = new URL(options.endpoint, "http://localhost");
      dashboardLoads.push({ forceRefresh: endpoint.searchParams.get("forceRefresh") === "1" });
      await options.onData(dashboardData);
      await options.onFinally();
      if (dashboardLoadCount > 1 && reloadError) throw reloadError;
      return reloadResult;
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return refreshResponse;
    },
    bind: (...args) => {
      bindCalls.push(args);
      const [, selector, eventName, handler] = args;
      root.querySelector(selector)?.addEventListener?.(eventName, handler);
    },
    bindAll: (...args) => bindAllCalls.push(args),
    closestTarget: () => null,
    compareTableSortableValues: () => 0,
    downloadBlob: () => {},
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: (selector) => (selector === "#supplier-board-start-date" ? startDate.value : selector === "#supplier-board-end-date" ? endDate.value : ""),
    formatActualMoney: (value) => String(value),
    formatRateNullable: (value) => String(value),
    normalizeCountryName: (value) => String(value ?? ""),
    selectedFilterValues: (selector) => selectedValues[selector] || [],
    setSelectOptions: () => {},
    setTableSortButtonGroupState: () => {},
    setButtonBusy: (button, busyText, restoreText = button?.textContent || "") => {
      if (!button) return () => {};
      button.disabled = true;
      button.textContent = busyText;
      return () => {
        button.disabled = false;
        button.textContent = restoreText;
      };
    },
    setText: (selector, value) => {
      if (selector === "#supplier-board-status") status.textContent = String(value);
    },
    syncAllOptionSelection: () => {},
    trimmedFieldValue: () => "",
    logger: { error() {} },
  });
  dashboardData = { rows };
  await feature.loadSupplierBoard();
  dashboardLoads.length = 0;
  return {
    bindAllCalls,
    bindCalls,
    dashboardLoads,
    feature,
    productRefreshButton,
    requests,
    statusText: () => status.textContent,
  };
}

test("supplier board owns refresh, export, sorting, date, and filter bindings", () => {
  const { bindAllCalls, bindCalls, feature } = createFeature();

  feature.setupSupplierBoard();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#supplier-board-refresh", "click", bindCalls[0][3]],
      ["#supplier-board-product-refresh", "click", feature.refreshSupplierBoardProducts],
      ["#supplier-board-product-refresh", "keydown", feature.handleSupplierBoardProductRefreshKeydown],
      ["#supplier-board-export", "click", feature.exportSupplierBoardExcel],
      ["#supplier-board-table thead", "click", bindCalls[4][3]],
      ["#supplier-board-dimension", "change", feature.handleSupplierBoardDimensionChange],
      ["#supplier-board-start-date", "change", feature.loadSupplierBoard],
      ["#supplier-board-end-date", "change", feature.loadSupplierBoard],
      ["#supplier-board-country", "change", feature.handleSupplierBoardCountryChange],
      ["#supplier-board-store", "change", feature.handleSupplierBoardStoreChange],
      ["#supplier-board-supplier", "input", feature.renderSupplierBoard],
      ["#supplier-board-keyword", "input", feature.renderSupplierBoard],
    ],
  );
  assert.deepEqual(
    bindAllCalls.map(([, selector, eventName]) => [selector, eventName]),
    [["#supplier-board-table .supplier-sort-button", "click"]],
  );
});

test("supplier product refresh posts only unique current-page SID+MSKU rows then reloads normally", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [
      { sid: 8708, msku: " A " },
      { sid: "8708", msku: "a" },
      { sid: 8709, msku: "B" },
      { sid: 0, msku: "invalid-zero" },
      { sid: -1, msku: "invalid-negative" },
      { sid: 1.5, msku: "invalid-fraction" },
      { sid: 8710, msku: "   " },
    ],
    refreshResponse: jsonResponse({ ok: true, meta: { refreshCommittedCount: 2 } }),
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, true);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, "/api/product-catalog/refresh");
  assert.deepEqual(fixture.requests[0].options, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feature: "supplier-board", items: [{ sid: 8708, msku: "A" }, { sid: 8709, msku: "B" }] }),
  });
  assert.deepEqual(fixture.dashboardLoads, [{ forceRefresh: false }]);
  assert.match(fixture.statusText(), /已刷新 2 个/);
});

test("empty current filtered page does not call API and shows a visible error", async () => {
  const fixture = await createProductRefreshFeatureFixture({ rows: [] });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-scope");
  assert.equal(fixture.requests.length, 0);
  assert.match(fixture.statusText(), /当前筛选范围没有可刷新的 SID \+ MSKU/);
});

test("HTTP or non-JSON failure restores button state, does not reload, and does not leak raw body", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: {
      ok: false,
      status: 502,
      async json() {
        throw new Error("raw token should not be shown");
      },
    },
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.equal(fixture.productRefreshButton.disabled, false);
  assert.equal(fixture.productRefreshButton.textContent, "刷新商品资料");
  assert.match(fixture.statusText(), /刷新失败：API 502/);
  assert.doesNotMatch(fixture.statusText(), /raw token|token/);
  assert.equal(fixture.dashboardLoads.length, 0);
});

test("controlled API error is visible without echoing untrusted response fields", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: false, error: "产品管理接口失败", secret: "token-should-not-leak" }, 502),
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.match(fixture.statusText(), /刷新失败：产品管理接口失败/);
  assert.doesNotMatch(fixture.statusText(), /token-should-not-leak/);
  assert.equal(fixture.dashboardLoads.length, 0);
});

test("malformed API error shape falls back to status and never renders sensitive error text", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: false, error: "token secret should not be shown" }, 502),
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.match(fixture.statusText(), /刷新失败：API 502/);
  assert.doesNotMatch(fixture.statusText(), /token|secret/);
  assert.equal(fixture.dashboardLoads.length, 0);
});

test("successful API response without a committed count fails closed before dashboard reload", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: true, meta: {} }),
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.equal(fixture.dashboardLoads.length, 0);
  assert.match(fixture.statusText(), /刷新失败：刷新响应无效/);
  assert.equal(fixture.productRefreshButton.disabled, false);
});

test("commit success with reload failure reports partial committed state", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: true, meta: { refreshCommittedCount: 1 } }),
    reloadResult: { ok: false, error: new Error("raw reload error") },
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.equal(result.committed, true);
  assert.match(fixture.statusText(), /商品资料已提交 1 个，但看板重载失败/);
  assert.equal(fixture.productRefreshButton.disabled, false);
});

test("commit success with thrown dashboard reload reports partial committed state", async () => {
  const fixture = await createProductRefreshFeatureFixture({
    rows: [{ sid: 8708, msku: "A" }],
    refreshResponse: jsonResponse({ ok: true, meta: { refreshCommittedCount: 1 } }),
    reloadError: new Error("raw reload error"),
  });

  const result = await fixture.feature.refreshSupplierBoardProducts();

  assert.equal(result.ok, false);
  assert.equal(result.committed, true);
  assert.match(fixture.statusText(), /商品资料已提交 1 个，但看板重载失败/);
  assert.equal(fixture.productRefreshButton.disabled, false);
});

test("repeated setup binds product refresh once and native click handler is exported", async () => {
  const fixture = await createProductRefreshFeatureFixture({ rows: [{ sid: 8708, msku: "A" }] });
  fixture.feature.setupSupplierBoard();
  fixture.feature.setupSupplierBoard();

  const productBindings = fixture.bindCalls.filter(([, selector, eventName]) => selector === "#supplier-board-product-refresh" && eventName === "click");
  const productKeyBindings = fixture.bindCalls.filter(([, selector, eventName]) => selector === "#supplier-board-product-refresh" && eventName === "keydown");
  assert.equal(productBindings.length, 1);
  assert.equal(productKeyBindings.length, 1);
  assert.equal(typeof productBindings[0][3], "function");
});

test("supplier product refresh handles Enter exactly once when native click synthesis is unavailable", async () => {
  const fixture = await createProductRefreshFeatureFixture({ rows: [{ sid: 8708, msku: "A" }] });
  fixture.feature.setupSupplierBoard();

  const event = await fixture.productRefreshButton.dispatch("keydown", { key: "Enter" });

  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.productRefreshButton.disabled, false);
  assert.equal(fixture.productRefreshButton.textContent, "刷新商品资料");
});

test("supplier product refresh ignores repeated and composing Enter key events", async () => {
  const fixture = await createProductRefreshFeatureFixture({ rows: [{ sid: 8708, msku: "A" }] });
  fixture.feature.setupSupplierBoard();

  const repeated = await fixture.productRefreshButton.dispatch("keydown", { key: "Enter", repeat: true });
  const composing = await fixture.productRefreshButton.dispatch("keydown", { key: "Enter", isComposing: true });

  assert.equal(repeated.defaultPrevented, false);
  assert.equal(composing.defaultPrevented, false);
  assert.equal(fixture.requests.length, 0);
});

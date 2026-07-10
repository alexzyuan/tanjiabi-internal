import assert from "node:assert/strict";
import test from "node:test";

async function loadModule() {
  const moduleUrl = new URL("../assets/js/dashboard-loader.js", import.meta.url);
  moduleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  return import(moduleUrl.href);
}

function createDomHarness() {
  const button = {
    disabled: false,
    textContent: "刷新",
  };
  const status = {
    textContent: "",
  };
  const table = {
    innerHTML: "",
  };
  const root = {
    querySelector(selector) {
      return {
        "#refresh": button,
        "#status": status,
        "#table": table,
      }[selector] || null;
    },
  };
  return { button, root, status, table };
}

test("loadDashboardSection handles success, loading UI, and cleanup", async () => {
  const { loadDashboardSection } = await loadModule();
  const dom = createDomHarness();
  const events = [];

  const result = await loadDashboardSection({
    endpoint: "/api/example",
    buttonSelector: "#refresh",
    busyText: "加载中",
    restoreText: "刷新",
    statusSelector: "#status",
    loadingStatus: "正在加载",
    tableSelector: "#table",
    tableColspan: 3,
    loadingMessage: "读取中",
    root: dom.root,
    fetchApi: async (endpoint, options) => {
      events.push(["fetch", endpoint, options.cache]);
      assert.equal(dom.button.disabled, true);
      assert.equal(dom.button.textContent, "加载中");
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, rows: [1] };
        },
      };
    },
    onData(data) {
      events.push(["data", data.rows.length]);
    },
    onFinally() {
      events.push(["finally", dom.button.textContent]);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    ["fetch", "/api/example", "no-store"],
    ["data", 1],
    ["finally", "加载中"],
  ]);
  assert.equal(dom.status.textContent, "正在加载");
  assert.match(dom.table.innerHTML, /读取中/);
  assert.equal(dom.button.disabled, false);
  assert.equal(dom.button.textContent, "刷新");
});

test("loadDashboardSection passes parsed error payload to onError", async () => {
  const { loadDashboardSection } = await loadModule();
  const dom = createDomHarness();
  let fallback = null;

  const result = await loadDashboardSection({
    endpoint: "/api/fail",
    buttonSelector: "#refresh",
    busyText: "加载中",
    restoreText: "刷新",
    root: dom.root,
    fetchApi: async () => ({
      ok: false,
      status: 503,
      async json() {
        return { error: "上游不可用", rows: [] };
      },
    }),
    onError(error) {
      fallback = {
        message: error.message,
        payload: error.payload,
        status: error.response?.status,
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(fallback, {
    message: "上游不可用",
    payload: { error: "上游不可用", rows: [] },
    status: 503,
  });
  assert.equal(dom.button.disabled, false);
  assert.equal(dom.button.textContent, "刷新");
});

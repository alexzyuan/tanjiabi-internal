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

test("dashboard loading overlay is scoped to the requested content target", async () => {
  const { loadDashboardSection } = await loadModule();
  const dom = createDomHarness();
  const bodyChildren = [];
  const targetChildren = [];
  const target = {
    children: targetChildren,
    classList: {
      values: new Set(),
      add(value) {
        this.values.add(value);
      },
      remove(value) {
        this.values.delete(value);
      },
      contains(value) {
        return this.values.has(value);
      },
    },
    appendChild(element) {
      targetChildren.push(element);
      element.parentNode = target;
      return element;
    },
    removeChild(element) {
      const index = targetChildren.indexOf(element);
      if (index >= 0) targetChildren.splice(index, 1);
      element.parentNode = null;
      return element;
    },
  };
  const body = {
    children: bodyChildren,
    appendChild(element) {
      bodyChildren.push(element);
      element.parentNode = body;
      return element;
    },
    removeChild(element) {
      const index = bodyChildren.indexOf(element);
      if (index >= 0) bodyChildren.splice(index, 1);
      element.parentNode = null;
      return element;
    },
  };
  const overlayElements = [];
  const root = {
    ...dom.root,
    body,
    querySelector(selector) {
      if (selector === "#content") return target;
      return dom.root.querySelector(selector);
    },
    createElement(tagName) {
      const element = {
        tagName,
        className: "",
        textContent: "",
        attributes: {},
        children: [],
        parentNode: null,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        append(...children) {
          this.children.push(...children);
        },
      };
      overlayElements.push(element);
      return element;
    },
  };

  const result = await loadDashboardSection({
    endpoint: "/api/slow",
    root,
    loadingOverlay: { targetSelector: "#content", message: "正在加载销售复盘数据...", delayMs: 0 },
    fetchApi: async () => {
      assert.equal(bodyChildren.length, 0);
      assert.equal(targetChildren.length, 1);
      assert.equal(targetChildren[0].className, "dashboard-loading-overlay");
      assert.equal(targetChildren[0].attributes.role, "status");
      assert.equal(targetChildren[0].attributes["aria-live"], "polite");
      assert.equal(targetChildren[0].attributes["aria-label"], "正在加载销售复盘数据...");
      assert.equal(targetChildren[0].children[1].className, "dashboard-loading-copy");
      assert.match(targetChildren[0].children[1].children[0].textContent, /正在加载销售复盘数据/);
      assert.equal(targetChildren[0].children[2].className, "dashboard-loading-progress");
      assert.equal(targetChildren[0].children[2].attributes.role, "progressbar");
      assert.equal(target.classList.contains("dashboard-loading-target"), true);
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(bodyChildren.length, 0);
  assert.equal(targetChildren.length, 0);
  assert.equal(target.classList.contains("dashboard-loading-target"), false);
  assert.ok(overlayElements.some((element) => element.className === "dashboard-loading-spinner"));
  assert.ok(overlayElements.some((element) => element.className === "dashboard-loading-percent"));
});

test("loadDashboardSection shows the default overlay only when a request stays pending", async () => {
  const { loadDashboardSection } = await loadModule();
  const dom = createDomHarness();
  const bodyChildren = [];
  const body = {
    appendChild(element) {
      bodyChildren.push(element);
      element.parentNode = body;
      return element;
    },
    removeChild(element) {
      const index = bodyChildren.indexOf(element);
      if (index >= 0) bodyChildren.splice(index, 1);
      element.parentNode = null;
      return element;
    },
  };
  const root = {
    ...dom.root,
    body,
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
        attributes: {},
        children: [],
        parentNode: null,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        append(...children) {
          this.children.push(...children);
        },
      };
    },
  };
  let releaseFetch;
  const pendingFetch = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  const resultPromise = loadDashboardSection({
    endpoint: "/api/slow",
    root,
    loadingOverlay: { delayMs: 5 },
    fetchApi: async () => {
      await pendingFetch;
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        },
      };
    },
  });

  assert.equal(bodyChildren.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(bodyChildren.length, 1);
  assert.equal(bodyChildren[0].attributes["aria-label"], "数据加载中...");
  releaseFetch();
  const result = await resultPromise;

  assert.equal(result.ok, true);
  assert.equal(bodyChildren.length, 0);
});

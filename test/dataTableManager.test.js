import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDataTableVariant,
  createDataTableManager,
  estimateSmartColumnWidth,
  inferSmartColumnProfile,
  inferTableColumnKind,
  inferTableStateTone,
  normalizeColumnWidth,
  resolveTableColumnKind,
} from "../assets/js/data-table-manager.js";

function createResizeInteractionHarness({
  storageData = new Map(),
  headerLabel = "销售额",
  explicitWidth = "128",
  rowValues = [],
} = {}) {
  const rootListeners = new Map();
  const windowListeners = new Map();
  const scheduledTimers = [];
  const storage = {
    getItem: (key) => storageData.get(key) || null,
    setItem: (key, value) => storageData.set(key, String(value)),
  };
  let widthWriteCount = 0;
  const colStyle = {};
  Object.defineProperty(colStyle, "width", {
    configurable: true,
    enumerable: true,
    get: () => colStyle.currentWidth || "",
    set(value) {
      widthWriteCount += 1;
      colStyle.currentWidth = value;
    },
  });
  const col = { dataset: {}, style: colStyle };
  const tableClassNames = new Set();
  const headerClassNames = new Set();
  const handle = {
    dataset: { columnIndex: "0" },
    closest(selector) {
      if (selector === ".table-resize-handle") return handle;
      if (selector === "table") return table;
      if (selector === "th") return header;
      return null;
    },
  };
  const colgroup = {
    children: [col],
    appendChild(child) {
      this.children.push(child);
    },
  };
  const table = {
    id: "test-table",
    className: "data-table",
    dataset: {},
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    classList: {
      add: (...names) => names.forEach((name) => tableClassNames.add(name)),
      remove: (...names) => names.forEach((name) => tableClassNames.delete(name)),
    },
    ownerDocument: { defaultView: { localStorage: storage } },
    closest: () => null,
    querySelector(selector) {
      if (selector === ":scope > colgroup") return colgroup;
      if (selector.includes("colgroup col")) return col;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("colgroup")) return [col];
      return [];
    },
  };
  const header = {
    classList: {
      contains: (name) => headerClassNames.has(name),
      toggle(name, enabled) {
        if (enabled) headerClassNames.add(name);
        else headerClassNames.delete(name);
      },
    },
    dataset: { columnIndex: "0", columnKey: "sales", columnWidth: explicitWidth },
    getAttribute(name) {
      if (name === "data-column-key") return this.dataset.columnKey;
      if (name === "data-column-width") return this.dataset.columnWidth || "";
      if (name === "data-column-profile") return this.dataset.columnProfile || "";
      return "";
    },
    getBoundingClientRect: () => ({ width: 128 }),
    offsetWidth: 128,
    querySelector(selector) {
      if (selector === ":scope > .table-resize-handle") return handle;
      return null;
    },
    tagName: "TH",
    textContent: headerLabel,
  };
  table.tHead = { rows: [{ cells: [header] }] };
  const bodyCells = rowValues.map((textContent) => ({
    classList: { toggle() {} },
    colSpan: 1,
    dataset: {},
    querySelectorAll: () => [],
    textContent,
  }));
  table.tBodies = [{ rows: bodyCells.map((cell) => ({ cells: [cell] })) }];
  header.closest = (selector) => (selector === "th" ? header : null);
  const root = {
    body: { classList: { add() {}, remove() {} } },
    addEventListener(eventName, listener) {
      rootListeners.set(eventName, listener);
    },
    removeEventListener() {},
    querySelectorAll: (selector) => (selector === ".table-wrap, .table-scroll" ? [] : selector.includes("table") ? [table] : []),
  };
  const windowRef = {
    localStorage: storage,
    addEventListener(eventName, listener) {
      windowListeners.set(eventName, listener);
    },
    removeEventListener() {},
    setTimeout(callback) {
      scheduledTimers.push(callback);
      return callback;
    },
    clearTimeout() {},
  };
  const manager = createDataTableManager({ root, windowRef });
  manager.setupDataTables();
  return {
    bodyCells,
    col,
    handle,
    header,
    manager,
    rootListeners,
    scheduledTimers,
    storageData,
    widthWriteCount: () => widthWriteCount,
    windowListeners,
  };
}

function createCancelableEvent(target, extra = {}) {
  const calls = [];
  return {
    target,
    preventDefault: () => calls.push("preventDefault"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
    stopPropagation: () => calls.push("stopPropagation"),
    calls,
    ...extra,
  };
}

test("data table manager classifies table variants by business shape", () => {
  assert.equal(classifyDataTableVariant({ className: "sales-forecast-table", columnCount: 49 }), "matrix");
  assert.equal(classifyDataTableVariant({ className: "data-table", columnCount: 15 }), "wide");
  assert.equal(classifyDataTableVariant({ className: "data-table", columnCount: 8 }), "standard");
});

test("smart table widths classify BI column semantics", () => {
  const cases = new Map([
    ["关注", "selection"],
    ["发货产品图片", "image"],
    ["国家", "compact-dimension"],
    ["FBA可售", "number"],
    ["采购成本小计", "money-rate"],
    ["创建时间", "date-time"],
    ["货件状态", "status"],
    ["MSKU / FNSKU", "identifier"],
    ["货件单号", "code-order"],
    ["产品名称", "name"],
    ["处理结果", "narrative"],
    ["操作", "action"],
  ]);

  for (const [label, expected] of cases) {
    assert.equal(inferSmartColumnProfile(label), expected, label);
  }
});

test("smart width estimator samples 30 rows and resists one long outlier", () => {
  const values = Array.from({ length: 30 }, () => "TJ033");
  values[29] = "X".repeat(200);
  values.push("Y".repeat(300));

  const result = estimateSmartColumnWidth({
    label: "MSKU",
    values,
    measureText: (value) => String(value).length * 8,
  });

  assert.equal(result.profile, "identifier");
  assert.equal(result.sampleCount, 30);
  assert.equal(result.measuredContentWidth, 40);
  assert.equal(result.width, 112);
});

test("smart width estimator clamps each semantic profile", () => {
  const measureText = (value) => String(value).length * 8;

  assert.equal(estimateSmartColumnWidth({ label: "国家", values: ["美国"], measureText }).width, 56);
  assert.equal(estimateSmartColumnWidth({ label: "产品名称", values: ["X".repeat(80)], measureText }).width, 240);
  assert.equal(estimateSmartColumnWidth({ label: "发货产品图片", values: ["很长的图片占位文字"], measureText }).width, 56);
  assert.equal(estimateSmartColumnWidth({ label: "操作", values: [], controlWidth: 248, measureText }).width, 264);
});

test("data table manager infers numeric columns from BI headers", () => {
  [
    "销售额",
    "采购成本小计",
    "广告费率",
    "FBA可售天数",
    "MSKU 数",
    "ACOS",
    "计提比例",
    "FBA在库",
    "FBA 可售",
    "FBA 转库",
    "FBA 在途",
    "采购量",
    "销量统计",
    "申请中",
    "未申请",
    "销售目标(原币)",
    "退款目标(原币)",
    "利润目标(原币)",
    "本月增加计提（当月）",
    "已计提冲回",
  ].forEach((label) => {
    assert.equal(inferTableColumnKind(label), "number", `${label} should be numeric`);
  });

  [
    "产品名称",
    "店铺",
    "国家",
    "货件状态",
    "创建时间",
    "MSKU",
    "币种",
  ].forEach((label) => {
    assert.equal(inferTableColumnKind(label), "text", `${label} should be text`);
  });
});

test("data table manager prefers explicit column kind over header inference", () => {
  assert.equal(resolveTableColumnKind({ explicitKind: "number", label: "MSKU" }), "number");
  assert.equal(resolveTableColumnKind({ explicitKind: "money", label: "产品名称" }), "number");
  assert.equal(resolveTableColumnKind({ explicitKind: "percent", label: "店铺" }), "number");
  assert.equal(resolveTableColumnKind({ explicitKind: "text", label: "销售额" }), "text");
  assert.equal(resolveTableColumnKind({ explicitKind: "unknown", label: "销售额" }), "number");
});

test("data table manager ignores its own inferred column marker as an explicit contract", () => {
  assert.equal(resolveTableColumnKind({ explicitKind: "text", explicitSource: "inferred", label: "销售额" }), "number");
  assert.equal(resolveTableColumnKind({ explicitKind: "number", explicitSource: "explicit", label: "MSKU" }), "number");
});

test("data table manager clamps manual column widths to usable minimums", () => {
  assert.equal(normalizeColumnWidth(180), 180);
  assert.equal(normalizeColumnWidth("92.4"), 92);
  assert.equal(normalizeColumnWidth(12), 44);
  assert.equal(normalizeColumnWidth("bad", 128), 128);
});

test("data table manager classifies table state row messages", () => {
  assert.equal(inferTableStateTone("正在读取货件。"), "loading");
  assert.equal(inferTableStateTone("当前筛选没有货件。"), "empty");
  assert.equal(inferTableStateTone("读取失败：接口错误"), "error");
});

test("data table manager suppresses the click generated by column resize", () => {
  const { handle, header, rootListeners, scheduledTimers, windowListeners } = createResizeInteractionHarness();
  const pointerDownEvent = createCancelableEvent(handle, { clientX: 100 });

  rootListeners.get("pointerdown")(pointerDownEvent);
  windowListeners.get("pointerup")();
  const clickEvent = createCancelableEvent(header);
  rootListeners.get("click")(clickEvent);

  assert.ok(clickEvent.calls.includes("preventDefault"));
  assert.ok(clickEvent.calls.includes("stopPropagation"));
  assert.equal(scheduledTimers.length, 1);
});

test("data table manager does not suppress ordinary header clicks", () => {
  const { header, rootListeners } = createResizeInteractionHarness();
  const clickEvent = createCancelableEvent(header);

  rootListeners.get("click")(clickEvent);

  assert.deepEqual(clickEvent.calls, []);
});

test("data table manager persists user resized column widths", () => {
  const { col, handle, rootListeners, storageData, windowListeners } = createResizeInteractionHarness();
  const pointerDownEvent = createCancelableEvent(handle, { clientX: 100 });

  rootListeners.get("pointerdown")(pointerDownEvent);
  windowListeners.get("pointermove")({ clientX: 142 });
  windowListeners.get("pointerup")();

  assert.equal(col.style.width, "170px");
  const stored = JSON.parse(storageData.get("tanjia:tableColumnWidths:v1:test-table"));
  assert.equal(stored.widths.sales, 170);
});

test("data table manager restores saved column widths during enhancement", () => {
  const storageData = new Map();
  storageData.set("tanjia:tableColumnWidths:v1:test-table", JSON.stringify({ widths: { sales: 188 } }));

  const { col: restoredCol } = createResizeInteractionHarness({ storageData });

  assert.equal(restoredCol.style.width, "188px");
  assert.equal(restoredCol.dataset.userWidth, "188");
});

test("data table manager keeps active user widths when enhancement reruns", () => {
  const storageData = new Map();
  storageData.set("tanjia:tableColumnWidths:v1:test-table", JSON.stringify({ widths: { sales: 188 } }));

  const { col: restoredCol, manager } = createResizeInteractionHarness({ storageData });
  restoredCol.style.width = "170px";
  restoredCol.dataset.userWidth = "170";
  manager.setupDataTables();

  assert.equal(restoredCol.style.width, "170px");
  assert.equal(restoredCol.dataset.userWidth, "170");
});

test("data table manager applies smart widths from sampled table content", () => {
  const rowValues = Array.from({ length: 30 }, () => `产品${"X".repeat(14)}`);
  rowValues[29] = "Y".repeat(200);

  const { bodyCells, col, header } = createResizeInteractionHarness({
    explicitWidth: "",
    headerLabel: "产品名称",
    rowValues,
  });

  assert.equal(col.style.width, "160px");
  assert.equal(col.dataset.widthProfile, "name");
  assert.equal(col.dataset.widthSource, "smart");
  assert.equal(header.dataset.widthProfile, "name");
  assert.equal(bodyCells[0].dataset.widthProfile, "name");
});

test("data table manager keeps explicit widths ahead of smart widths", () => {
  const { col } = createResizeInteractionHarness({
    explicitWidth: "164",
    headerLabel: "产品名称",
    rowValues: ["短名称"],
  });

  assert.equal(col.style.width, "164px");
  assert.equal(col.dataset.widthSource, "explicit");
});

test("data table manager does not rewrite unchanged smart widths", () => {
  const harness = createResizeInteractionHarness({
    explicitWidth: "",
    headerLabel: "国家",
    rowValues: ["美国", "加拿大"],
  });
  const writesAfterFirstEnhancement = harness.widthWriteCount();

  harness.manager.setupDataTables();

  assert.equal(harness.widthWriteCount(), writesAfterFirstEnhancement);
});

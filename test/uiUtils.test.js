import assert from "node:assert/strict";
import test from "node:test";

async function loadUiUtils() {
  const moduleUrl = new URL("../assets/js/ui-utils.js", import.meta.url);
  moduleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  globalThis.window = {};
  const module = await import(moduleUrl.href);
  return { module, utils: globalThis.window.TanjiaUiUtils };
}

test("ui utils preserve existing formatting and normalization behavior", async () => {
  const { utils } = await loadUiUtils();

  assert.equal(utils.escapeHtml(`<a title="x&y">Tom's</a>`), "&lt;a title=&quot;x&amp;y&quot;&gt;Tom&#39;s&lt;/a&gt;");
  assert.equal(utils.formatMoney(120000), "12.00万");
  assert.equal(utils.formatMoney(1234.56), "1,235");
  assert.equal(utils.formatPercent(0.1234), "12.34%");
  assert.equal(utils.formatActualMoney(1234.567), "1,234.57");
  assert.equal(utils.formatRateNullable(null), "-");
  assert.equal(utils.formatRateNullable(0.0315), "3.15%");
  assert.equal(utils.parseNumber("1,234.5%"), 1234.5);
  assert.equal(utils.parseDisplayPercent("4.40%"), 4.4);
  assert.equal(utils.normalizeCountryName("US"), "美国");
  assert.equal(utils.normalizeCountryName(" au "), "澳洲");
  assert.deepEqual(JSON.parse(JSON.stringify(utils.normalizeFilterOption({ name: "店铺A", country: "CA" }))), {
    value: "店铺A",
    label: "店铺A",
    country: "加拿大",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(utils.normalizeFilterOptions(["A", "", { value: "B", label: "店铺B" }]))), [
    { value: "A", label: "A", country: "" },
    { value: "B", label: "店铺B", country: "" },
  ]);
});

test("ui utils expose named module exports and the legacy global", async () => {
  const { module, utils } = await loadUiUtils();

  assert.equal(module.default, utils);
  assert.equal(module.escapeHtml, utils.escapeHtml);
  assert.equal(module.setElementsHidden, utils.setElementsHidden);
  assert.equal(typeof module.bindDelegated, "function");
});

test("ui data value button html helper escapes labels and marks active value", async () => {
  const { utils } = await loadUiUtils();
  const html = utils.renderDataValueButtonsHtml(["US探嘉", `A&B "店"`], "data-msku-store", `A&B "店"`, {
    allLabel: "全部店铺",
  });

  assert.equal(
    html,
    `<button type="button" data-msku-store="">全部店铺</button>` +
      `<button type="button" data-msku-store="US探嘉">US探嘉</button>` +
      `<button class="active" type="button" data-msku-store="A&amp;B &quot;店&quot;">A&amp;B &quot;店&quot;</button>`,
  );

  assert.equal(utils.renderDataValueButtonsHtml([], "data-msku-store", "", { allLabel: "全部店铺" }), `<button class="active" type="button" data-msku-store="">全部店铺</button>`);
});

test("ui event helpers bind existing elements only once per call", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const element = {
    addEventListener(eventName, handler, options) {
      calls.push({ eventName, handler, options });
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#exists" ? element : null;
    },
    querySelectorAll(selector) {
      return selector === ".items" ? [element, element] : [];
    },
  };

  assert.equal(utils.bind(documentLike, "#exists", "click", () => "ok"), element);
  assert.equal(utils.bind(documentLike, "#missing", "click", () => "no"), null);
  assert.equal(utils.bindAll(documentLike, ".items", "change", () => "ok").length, 2);
  assert.equal(utils.bindEventTarget(element, "mouseover", () => "ok", { passive: true }), element);
  assert.equal(utils.bindEventTarget(null, "click", () => "no"), null);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].eventName, "click");
  assert.equal(calls[1].eventName, "change");
  assert.equal(calls[2].eventName, "change");
  assert.equal(calls[3].eventName, "mouseover");
  assert.deepEqual(calls[3].options, { passive: true });
});

test("ui delegated event helper resolves scoped targets", async () => {
  const { utils } = await loadUiUtils();
  const listeners = [];
  const insideTarget = { id: "inside" };
  const outsideTarget = { id: "outside" };
  const container = {
    addEventListener(eventName, handler, options) {
      listeners.push({ eventName, handler, options });
    },
    contains(target) {
      return target === insideTarget;
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#container" ? container : null;
    },
  };
  insideTarget.closest = (selector) => (selector === "[data-action]" ? insideTarget : null);
  outsideTarget.closest = (selector) => (selector === "[data-action]" ? outsideTarget : null);
  const calls = [];

  assert.equal(utils.bindDelegated(documentLike, "#container", "click", "[data-action]", (target, event) => {
    calls.push([target.id, event.type]);
  }, { passive: true }), container);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].eventName, "click");
  assert.deepEqual(listeners[0].options, { passive: true });
  listeners[0].handler({ type: "click", target: insideTarget, currentTarget: container });
  listeners[0].handler({ type: "click", target: outsideTarget, currentTarget: container });
  listeners[0].handler({ type: "click", target: {}, currentTarget: container });
  assert.deepEqual(calls, [["inside", "click"]]);
  assert.equal(utils.bindDelegated(documentLike, "#missing", "click", "[data-action]", () => {}), null);
});

test("ui visible click helper only clicks visible elements", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const visibleElement = {
    hidden: false,
    closest(selector) {
      return selector === "[hidden]" ? null : null;
    },
    click() {
      calls.push("visible");
    },
  };
  const hiddenElement = {
    hidden: true,
    closest() {
      return null;
    },
    click() {
      calls.push("hidden");
    },
  };
  const hiddenAncestorElement = {
    hidden: false,
    closest(selector) {
      return selector === "[hidden]" ? { hidden: true } : null;
    },
    click() {
      calls.push("ancestor");
    },
  };

  assert.equal(utils.clickVisibleElement(visibleElement), visibleElement);
  assert.equal(utils.clickVisibleElement(hiddenElement), null);
  assert.equal(utils.clickVisibleElement(hiddenAncestorElement), null);
  assert.equal(utils.clickVisibleElement(null), null);
  assert.deepEqual(calls, ["visible"]);
});

test("ui visibility helper detects hidden elements and hidden ancestors", async () => {
  const { utils } = await loadUiUtils();
  const visibleElement = {
    hidden: false,
    closest(selector) {
      return selector === "[hidden]" ? null : null;
    },
  };
  const hiddenElement = {
    hidden: true,
    closest() {
      return null;
    },
  };
  const hiddenAncestorElement = {
    hidden: false,
    closest(selector) {
      return selector === "[hidden]" ? { hidden: true } : null;
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#visible" ? visibleElement : null;
    },
  };

  assert.equal(utils.isVisibleElement(visibleElement), true);
  assert.equal(utils.isVisibleElement(hiddenElement), false);
  assert.equal(utils.isVisibleElement(hiddenAncestorElement), false);
  assert.equal(utils.isVisibleElement(null), false);
  assert.equal(utils.isVisibleElement("#visible", documentLike), true);
  assert.equal(utils.isVisibleElement("#missing", documentLike), false);
});

test("ui aria expanded helper writes boolean state safely", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const button = {
    setAttribute(name, value) {
      calls.push([name, value]);
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#toggle" ? button : null;
    },
  };

  assert.equal(utils.setAriaExpanded(button, true), button);
  assert.equal(utils.setAriaExpanded("#toggle", false, documentLike), button);
  assert.equal(utils.setAriaExpanded("#missing", true, documentLike), null);
  assert.deepEqual(calls, [
    ["aria-expanded", "true"],
    ["aria-expanded", "false"],
  ]);
});

test("ui disclosure helper syncs hidden panel and expanded control", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const panel = { hidden: true };
  const toggle = {
    setAttribute(name, value) {
      calls.push([name, value]);
    },
  };
  const documentLike = {
    querySelector(selector) {
      return {
        "#panel": panel,
        "#toggle": toggle,
      }[selector] || null;
    },
  };

  const opened = utils.setDisclosureState("#panel", "#toggle", true, documentLike);
  assert.equal(opened.panel, panel);
  assert.equal(opened.toggle, toggle);
  assert.equal(panel.hidden, false);
  assert.deepEqual(calls, [["aria-expanded", "true"]]);

  const closed = utils.setDisclosureState(panel, toggle, false);
  assert.equal(closed.panel, panel);
  assert.equal(closed.toggle, toggle);
  assert.equal(panel.hidden, true);
  assert.deepEqual(calls, [
    ["aria-expanded", "true"],
    ["aria-expanded", "false"],
  ]);

  const missingPanel = utils.setDisclosureState("#missing", "#toggle", true, documentLike);
  assert.equal(missingPanel.panel, null);
  assert.equal(missingPanel.toggle, toggle);
});

test("ui disclosure group helper syncs many panels and skips an exception", async () => {
  const { utils } = await loadUiUtils();
  function createPanel(id) {
    const calls = [];
    const toggle = {
      calls,
      setAttribute(name, value) {
        calls.push([name, value]);
      },
    };
    return { id, hidden: false, toggle };
  }
  const first = createPanel("first");
  const second = createPanel("second");
  const third = createPanel("third");
  const documentLike = {
    querySelector(selector) {
      return selector === "#second" ? second : null;
    },
    querySelectorAll(selector) {
      return selector === ".menu" ? [first, second, third] : [];
    },
  };

  const result = utils.setDisclosureGroupState(".menu", false, {
    except: "#second",
    root: documentLike,
    toggleForPanel: (panel) => panel.toggle,
  });
  assert.equal(result.length, 3);
  assert.equal(first.hidden, true);
  assert.equal(second.hidden, false);
  assert.equal(third.hidden, true);
  assert.deepEqual(first.toggle.calls, [["aria-expanded", "false"]]);
  assert.deepEqual(second.toggle.calls, []);
  assert.deepEqual(third.toggle.calls, [["aria-expanded", "false"]]);
  assert.equal(utils.setDisclosureGroupState(".missing", false, { root: documentLike }).length, 0);
});

test("ui expanded class helper syncs class state and expanded control", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const classes = new Set();
  const container = {
    classList: {
      contains(className) {
        return classes.has(className);
      },
      toggle(className, forced) {
        if (forced) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        return classes.has(className);
      },
    },
  };
  const toggle = {
    setAttribute(name, value) {
      calls.push([name, value]);
    },
  };
  const documentLike = {
    querySelector(selector) {
      return {
        "#container": container,
        "#toggle": toggle,
      }[selector] || null;
    },
  };

  const opened = utils.setExpandedClassState("#container", "#toggle", true, "is-open", documentLike);
  assert.equal(opened.container, container);
  assert.equal(opened.toggle, toggle);
  assert.equal(classes.has("is-open"), true);
  assert.deepEqual(calls, [["aria-expanded", "true"]]);

  const closed = utils.setExpandedClassState(container, toggle, false);
  assert.equal(closed.container, container);
  assert.equal(closed.toggle, toggle);
  assert.equal(classes.has("is-open"), false);
  assert.deepEqual(calls, [
    ["aria-expanded", "true"],
    ["aria-expanded", "false"],
  ]);

  const missingContainer = utils.setExpandedClassState("#missing", "#toggle", true, "is-open", documentLike);
  assert.equal(missingContainer.container, null);
  assert.equal(missingContainer.toggle, toggle);
});

test("ui table sort helper syncs header and button state", async () => {
  const { utils } = await loadUiUtils();
  const headerClasses = new Set();
  const buttonClasses = new Set();
  const headerCalls = [];
  const button = {
    dataset: {},
    classList: {
      toggle(className, forced) {
        if (forced) {
          buttonClasses.add(className);
        } else {
          buttonClasses.delete(className);
        }
        return buttonClasses.has(className);
      },
    },
  };
  const header = {
    classList: {
      toggle(className, forced) {
        if (forced) {
          headerClasses.add(className);
        } else {
          headerClasses.delete(className);
        }
        return headerClasses.has(className);
      },
    },
    setAttribute(name, value) {
      headerCalls.push(["set", name, value]);
    },
    removeAttribute(name) {
      headerCalls.push(["remove", name]);
    },
  };
  const documentLike = {
    querySelector(selector) {
      return {
        "#header": header,
        "#button": button,
      }[selector] || null;
    },
  };

  const active = utils.setTableSortState("#header", true, "asc", "#button", documentLike);
  assert.equal(active.header, header);
  assert.equal(active.button, button);
  assert.equal(headerClasses.has("table-sort-active"), true);
  assert.equal(headerClasses.has("table-sort-asc"), true);
  assert.equal(headerClasses.has("table-sort-desc"), false);
  assert.equal(buttonClasses.has("active"), true);
  assert.equal(button.dataset.direction, "asc");
  assert.deepEqual(headerCalls, [["set", "aria-sort", "ascending"]]);

  const inactive = utils.setTableSortState(header, false, "desc", button);
  assert.equal(inactive.header, header);
  assert.equal(inactive.button, button);
  assert.equal(headerClasses.has("table-sort-active"), false);
  assert.equal(headerClasses.has("table-sort-asc"), false);
  assert.equal(headerClasses.has("table-sort-desc"), false);
  assert.equal(buttonClasses.has("active"), false);
  assert.equal(button.dataset.direction, "");
  assert.deepEqual(headerCalls, [
    ["set", "aria-sort", "ascending"],
    ["remove", "aria-sort"],
  ]);

  const missingHeader = utils.setTableSortState("#missing", true, "desc", "#button", documentLike);
  assert.equal(missingHeader.header, null);
  assert.equal(missingHeader.button, button);
});

test("ui table sort button group helper syncs sortable button groups", async () => {
  const { utils } = await loadUiUtils();
  function createSortButton(sortKey) {
    const headerClasses = new Set();
    const buttonClasses = new Set();
    const headerCalls = [];
    const header = {
      headerClasses,
      headerCalls,
      classList: {
        toggle(className, forced) {
          if (forced) {
            headerClasses.add(className);
          } else {
            headerClasses.delete(className);
          }
          return headerClasses.has(className);
        },
      },
      setAttribute(name, value) {
        headerCalls.push(["set", name, value]);
      },
      removeAttribute(name) {
        headerCalls.push(["remove", name]);
      },
    };
    const button = {
      buttonClasses,
      dataset: { supplierSort: sortKey },
      classList: {
        toggle(className, forced) {
          if (forced) {
            buttonClasses.add(className);
          } else {
            buttonClasses.delete(className);
          }
          return buttonClasses.has(className);
        },
      },
      closest(selector) {
        return selector === "th" ? header : null;
      },
    };
    return { button, header };
  }
  const quantity = createSortButton("quantity");
  const supplier = createSortButton("supplier");
  const documentLike = {
    querySelectorAll(selector) {
      return selector === ".sort-button" ? [quantity.button, supplier.button] : [];
    },
  };

  const result = utils.setTableSortButtonGroupState(".sort-button", "supplierSort", "quantity", "desc", documentLike);
  assert.equal(result.length, 2);
  assert.equal(quantity.header.headerClasses.has("table-sort-active"), true);
  assert.equal(quantity.header.headerClasses.has("table-sort-desc"), true);
  assert.equal(quantity.button.buttonClasses.has("active"), true);
  assert.equal(quantity.button.dataset.direction, "desc");
  assert.deepEqual(quantity.header.headerCalls, [["set", "aria-sort", "descending"]]);
  assert.equal(supplier.header.headerClasses.has("table-sort-active"), false);
  assert.equal(supplier.button.buttonClasses.has("active"), false);
  assert.equal(supplier.button.dataset.direction, "");
  assert.deepEqual(supplier.header.headerCalls, [["remove", "aria-sort"]]);
  assert.equal(utils.setTableSortButtonGroupState(".missing", "supplierSort", "quantity", "desc", documentLike).length, 0);
});

test("ui active element helper keeps one active item in a group", async () => {
  const { utils } = await loadUiUtils();
  function createElement(id) {
    const classes = new Set();
    return {
      id,
      classes,
      classList: {
        toggle(className, forced) {
          if (forced) {
            classes.add(className);
          } else {
            classes.delete(className);
          }
          return classes.has(className);
        },
      },
    };
  }
  const first = createElement("first");
  const second = createElement("second");
  const documentLike = {
    querySelector(selector) {
      return selector === "#second" ? second : null;
    },
    querySelectorAll(selector) {
      return selector === ".item" ? [first, second] : [];
    },
  };

  const selectorResult = utils.setActiveElementState(".item", "#second", "active", documentLike);
  assert.equal(selectorResult.length, 2);
  assert.equal(selectorResult[0], first);
  assert.equal(selectorResult[1], second);
  assert.equal(first.classes.has("active"), false);
  assert.equal(second.classes.has("active"), true);

  const elementResult = utils.setActiveElementState([first, second], first);
  assert.equal(elementResult.length, 2);
  assert.equal(elementResult[0], first);
  assert.equal(elementResult[1], second);
  assert.equal(first.classes.has("active"), true);
  assert.equal(second.classes.has("active"), false);
  assert.equal(utils.setActiveElementState(".missing", "#second", "active", documentLike).length, 0);
});

test("ui active dataset value helper keeps matching data value active", async () => {
  const { utils } = await loadUiUtils();
  function createElement(value) {
    const classes = new Set();
    return {
      classes,
      dataset: { fbaFilter: value },
      classList: {
        toggle(className, forced) {
          if (forced) {
            classes.add(className);
          } else {
            classes.delete(className);
          }
          return classes.has(className);
        },
      },
    };
  }
  const all = createElement("all");
  const history = createElement("history");
  const missing = createElement("");
  const documentLike = {
    querySelectorAll(selector) {
      return selector === "[data-fba-filter]" ? [all, history, missing] : [];
    },
  };

  const result = utils.setActiveDatasetValueState("[data-fba-filter]", "fbaFilter", "history", documentLike);
  assert.equal(result.length, 3);
  assert.equal(all.classes.has("active"), false);
  assert.equal(history.classes.has("active"), true);
  assert.equal(missing.classes.has("active"), false);
  assert.equal(utils.setActiveDatasetValueState(".missing", "fbaFilter", "history", documentLike).length, 0);
});

test("ui class state map helper syncs multiple classes on one element", async () => {
  const { utils } = await loadUiUtils();
  const classes = new Set(["factory-inventory-view"]);
  const element = {
    classes,
    classList: {
      toggle(className, forced) {
        if (forced) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        return classes.has(className);
      },
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "body" ? element : null;
    },
  };

  const result = utils.setClassStateMap("body", {
    "sales-view": true,
    "factory-inventory-view": false,
  }, documentLike);
  assert.equal(result, element);
  assert.equal(classes.has("sales-view"), true);
  assert.equal(classes.has("factory-inventory-view"), false);

  utils.setClassStateMap(element, { "sales-view": false, "factory-inventory-view": true });
  assert.equal(classes.has("sales-view"), false);
  assert.equal(classes.has("factory-inventory-view"), true);
  assert.equal(utils.setClassStateMap(".missing", { "sales-view": true }, documentLike), null);
});

test("ui exclusive class helper keeps one class from a known group", async () => {
  const { utils } = await loadUiUtils();
  const classes = new Set(["metric-tile", "sync-error", "sync-pending"]);
  const element = {
    classList: {
      add(className) {
        classes.add(className);
      },
      remove(className) {
        classes.delete(className);
      },
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#sync-card" ? element : null;
    },
  };

  const result = utils.setExclusiveClassState(
    "#sync-card",
    ["sync-success", "sync-error", "sync-running", "sync-pending"],
    "sync-success",
    documentLike,
  );
  assert.equal(result, element);
  assert.equal(classes.has("metric-tile"), true);
  assert.equal(classes.has("sync-success"), true);
  assert.equal(classes.has("sync-error"), false);
  assert.equal(classes.has("sync-running"), false);
  assert.equal(classes.has("sync-pending"), false);

  utils.setExclusiveClassState(element, ["sync-success", "sync-error"], "");
  assert.equal(classes.has("metric-tile"), true);
  assert.equal(classes.has("sync-success"), false);
  assert.equal(utils.setExclusiveClassState("#missing", ["sync-success"], "sync-success", documentLike), null);
});

test("ui modal helper syncs hidden state, body modal class, and dialog semantics", async () => {
  const { utils } = await loadUiUtils();
  const bodyClasses = new Set();
  const attrs = [];
  const dialog = {
    setAttribute(name, value) {
      attrs.push([name, value]);
    },
    getAttribute() {
      return "";
    },
  };
  const modal = {
    hidden: true,
    querySelector(selector) {
      return selector === "article" ? dialog : null;
    },
  };
  const body = {
    classList: {
      toggle(className, forced) {
        if (forced) {
          bodyClasses.add(className);
        } else {
          bodyClasses.delete(className);
        }
        return bodyClasses.has(className);
      },
      remove(className) {
        bodyClasses.delete(className);
      },
    },
  };
  const documentLike = {
    body,
    querySelector(selector) {
      return selector === "#modal" ? modal : null;
    },
  };

  const opened = utils.setModalOpenState("#modal", true, documentLike);
  assert.equal(opened, modal);
  assert.equal(modal.hidden, false);
  assert.equal(bodyClasses.has("modal-open"), true);
  assert.deepEqual(attrs, [
    ["role", "dialog"],
    ["aria-modal", "true"],
  ]);

  utils.setModalOpenState(modal, false, documentLike);
  assert.equal(modal.hidden, true);
  assert.equal(bodyClasses.has("modal-open"), false);

  bodyClasses.add("modal-open");
  assert.equal(utils.setModalOpenState("#missing", false, documentLike), null);
  assert.equal(bodyClasses.has("modal-open"), false);
});

test("ui status message helper syncs text and tone classes", async () => {
  const { utils } = await loadUiUtils();
  const classes = new Set();
  const status = {
    textContent: "",
    classList: {
      toggle(className, forced) {
        if (forced) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        return classes.has(className);
      },
    },
  };
  const documentLike = {
    querySelector(selector) {
      return selector === "#status" ? status : null;
    },
  };

  const success = utils.setStatusMessage("#status", "保存成功", "success", documentLike);
  assert.equal(success, status);
  assert.equal(status.textContent, "保存成功");
  assert.equal(classes.has("status-success"), true);
  assert.equal(classes.has("status-danger"), false);

  utils.setStatusMessage(status, "保存失败", "danger");
  assert.equal(status.textContent, "保存失败");
  assert.equal(classes.has("status-success"), false);
  assert.equal(classes.has("status-danger"), true);

  utils.setStatusMessage("#status", "等待操作", "", documentLike);
  assert.equal(status.textContent, "等待操作");
  assert.equal(classes.has("status-success"), false);
  assert.equal(classes.has("status-danger"), false);
  assert.equal(utils.setStatusMessage("#missing", "无元素", "success", documentLike), null);
});

test("ui selected element helper syncs active class and aria-selected", async () => {
  const { utils } = await loadUiUtils();
  function createElement(id) {
    const classes = new Set();
    const attributes = [];
    return {
      id,
      attributes,
      classes,
      classList: {
        toggle(className, forced) {
          if (forced) {
            classes.add(className);
          } else {
            classes.delete(className);
          }
          return classes.has(className);
        },
      },
      setAttribute(name, value) {
        attributes.push([name, value]);
      },
    };
  }
  const first = createElement("first");
  const second = createElement("second");
  const documentLike = {
    querySelector(selector) {
      return selector === "#second" ? second : null;
    },
    querySelectorAll(selector) {
      return selector === ".tab" ? [first, second] : [];
    },
  };

  const selected = utils.setSelectedElementState(".tab", "#second", documentLike);
  assert.equal(selected.length, 2);
  assert.equal(selected[0], first);
  assert.equal(selected[1], second);
  assert.equal(first.classes.has("active"), false);
  assert.equal(second.classes.has("active"), true);
  assert.deepEqual(first.attributes, [["aria-selected", "false"]]);
  assert.deepEqual(second.attributes, [["aria-selected", "true"]]);
  assert.equal(utils.setSelectedElementState(".missing", "#second", documentLike).length, 0);
});

test("ui field helpers read values, trims, and checked state safely", async () => {
  const { utils } = await loadUiUtils();
  const field = { value: "  供应商A  " };
  const emptyField = { value: "" };
  const checked = { checked: true };
  const unchecked = { checked: false };
  const documentLike = {
    querySelector(selector) {
      return {
        "#field": field,
        "#empty": emptyField,
        "#checked": checked,
        "#unchecked": unchecked,
      }[selector] || null;
    },
  };

  assert.equal(utils.fieldValue("#field", "fallback", documentLike), "  供应商A  ");
  assert.equal(utils.fieldValue("#missing", "fallback", documentLike), "fallback");
  assert.equal(utils.fieldValue(emptyField, "fallback"), "");
  assert.equal(utils.trimmedFieldValue("#field", "", documentLike), "供应商A");
  assert.equal(utils.trimmedFieldValue("#missing", "  fallback  ", documentLike), "fallback");
  assert.equal(utils.checkedField("#checked", documentLike), true);
  assert.equal(utils.checkedField("#unchecked", documentLike), false);
  assert.equal(utils.checkedField("#missing", documentLike), false);
});

test("ui click outside helper only fires when the click target is outside", async () => {
  const { utils } = await loadUiUtils();
  const listeners = [];
  const root = {
    addEventListener(eventName, handler, options) {
      listeners.push({ eventName, handler, options });
    },
  };
  const insideElement = {
    contains(target) {
      return target?.insideElement === true;
    },
  };
  const selectorTarget = {
    closest(selector) {
      return selector === ".menu" ? true : null;
    },
  };
  const parentSelectorTarget = {
    parentElement: {
      closest(selector) {
        return selector === ".menu" ? true : null;
      },
    },
  };
  const outsideTarget = {};
  const calls = [];

  const selectorListener = utils.bindClickOutside(root, ".menu", (event) => calls.push(["selector", event.target]), { capture: true });
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].eventName, "click");
  assert.equal(listeners[0].handler, selectorListener);
  assert.deepEqual(listeners[0].options, { capture: true });

  selectorListener({ target: selectorTarget });
  selectorListener({ target: parentSelectorTarget });
  selectorListener({ target: outsideTarget });
  assert.deepEqual(calls, [["selector", outsideTarget]]);

  const elementListener = utils.bindClickOutside(root, insideElement, (event) => calls.push(["element", event.target]));
  elementListener({ target: { insideElement: true } });
  elementListener({ target: outsideTarget });
  assert.deepEqual(calls, [["selector", outsideTarget], ["element", outsideTarget]]);

  assert.equal(utils.bindClickOutside(null, ".menu", () => {}), null);
});

test("ui backdrop close helper only fires for direct backdrop clicks", async () => {
  const { utils } = await loadUiUtils();
  const listeners = [];
  const backdrop = {
    addEventListener(eventName, handler, options) {
      listeners.push({ eventName, handler, options });
    },
  };
  const child = {};
  const calls = [];
  const documentLike = {
    querySelector(selector) {
      return selector === "#modal" ? backdrop : null;
    },
  };

  const listener = utils.bindBackdropClose(documentLike, "#modal", (event) => calls.push(event.target), { capture: true });

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].eventName, "click");
  assert.equal(listeners[0].handler, listener);
  assert.deepEqual(listeners[0].options, { capture: true });

  listener({ target: child });
  listener({ target: backdrop });
  assert.deepEqual(calls, [backdrop]);
  assert.equal(utils.bindBackdropClose(documentLike, "#missing", () => {}), null);
});

test("ui closest target helper resolves event targets and parent fallback", async () => {
  const { utils } = await loadUiUtils();
  const directTarget = {
    closest(selector) {
      return selector === "[data-action]" ? "direct" : null;
    },
  };
  const parentTarget = {
    parentElement: {
      closest(selector) {
        return selector === "[data-action]" ? "parent" : null;
      },
    },
  };

  assert.equal(utils.closestTarget({ target: directTarget }, "[data-action]"), "direct");
  assert.equal(utils.closestTarget(parentTarget, "[data-action]"), "parent");
  assert.equal(utils.closestTarget({ target: {} }, "[data-action]"), null);
  assert.equal(utils.closestTarget(null, "[data-action]"), null);
});

test("ui debounced action helper keeps only the latest scheduled call", async () => {
  const { utils } = await loadUiUtils();
  const callbacks = new Map();
  const cleared = [];
  let nextId = 1;
  const timerApi = {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      callbacks.delete(id);
    },
  };
  const calls = [];
  const schedule = utils.createDebouncedAction((value) => {
    calls.push(value);
  }, 350, timerApi);

  const firstId = schedule("first");
  const secondId = schedule("second");

  assert.equal(firstId, 1);
  assert.equal(secondId, 2);
  assert.deepEqual(cleared, [1]);
  assert.equal(callbacks.get(2).delay, 350);

  callbacks.get(2).callback();
  assert.deepEqual(calls, ["second"]);

  const thirdId = schedule("third");
  assert.equal(thirdId, 3);
  schedule.cancel();
  assert.deepEqual(cleared, [1, 2, 3]);
  assert.equal(callbacks.has(3), false);
});

test("ui table message helper renders escaped colspan rows", async () => {
  const { utils } = await loadUiUtils();
  const tableBody = { innerHTML: "" };
  const documentLike = {
    querySelector(selector) {
      return selector === "#target-table" ? tableBody : null;
    },
  };

  assert.equal(utils.renderTableMessage("#target-table", 4, "<加载失败 & 重试>", documentLike), tableBody);
  assert.equal(tableBody.innerHTML, '<tr class="table-state-row"><td class="table-state is-error" colspan="4">&lt;加载失败 &amp; 重试&gt;</td></tr>');

  assert.equal(utils.renderTableMessage(tableBody, 0, "空数据"), tableBody);
  assert.equal(tableBody.innerHTML, '<tr class="table-state-row"><td class="table-state is-empty" colspan="1">空数据</td></tr>');
  assert.equal(utils.renderTableMessage(tableBody, 2, "正在加载数据"), tableBody);
  assert.equal(tableBody.innerHTML, '<tr class="table-state-row"><td class="table-state is-loading" colspan="2">正在加载数据</td></tr>');
  assert.equal(utils.renderTableMessage(tableBody, 2, "无权限查看"), tableBody);
  assert.equal(tableBody.innerHTML, '<tr class="table-state-row"><td class="table-state is-denied" colspan="2">无权限查看</td></tr>');
  assert.equal(utils.renderTableMessage("#missing", 3, "不会写入", documentLike), null);
});

test("ui button busy helper toggles text and disabled state", async () => {
  const { utils } = await loadUiUtils();
  const button = { textContent: "刷新", disabled: false };

  const restore = utils.setButtonBusy(button, "刷新中...");
  assert.equal(button.textContent, "刷新中...");
  assert.equal(button.disabled, true);

  restore();
  assert.equal(button.textContent, "刷新");
  assert.equal(button.disabled, false);

  const softButton = { textContent: "导出", disabled: false };
  const restoreSoft = utils.setButtonBusy(softButton, "导出中...", "导出文件", { disable: false });
  assert.equal(softButton.textContent, "导出中...");
  assert.equal(softButton.disabled, false);

  restoreSoft();
  assert.equal(softButton.textContent, "导出文件");
  assert.equal(softButton.disabled, false);

  assert.doesNotThrow(() => utils.setButtonBusy(null, "处理中")());
});

test("ui disabled helper toggles one or more controls safely", async () => {
  const { utils } = await loadUiUtils();
  const first = { disabled: false };
  const second = { disabled: false };
  const documentLike = {
    querySelector(selector) {
      return selector === "#first" ? first : null;
    },
  };

  const selected = utils.setElementsDisabled("#first", true, documentLike);
  assert.equal(selected.length, 1);
  assert.equal(selected[0], first);
  assert.equal(first.disabled, true);

  const restored = utils.setElementsDisabled([first, null, second, "#missing"], false, documentLike);
  assert.equal(restored.length, 2);
  assert.equal(restored[0], first);
  assert.equal(restored[1], second);
  assert.equal(first.disabled, false);
  assert.equal(second.disabled, false);

  assert.equal(utils.setElementsDisabled(null, true, documentLike).length, 0);
});

test("ui hidden helper toggles one or more elements safely", async () => {
  const { utils } = await loadUiUtils();
  const first = { hidden: false };
  const second = { hidden: true };
  const documentLike = {
    querySelector(selector) {
      return selector === "#first" ? first : null;
    },
  };

  const selected = utils.setElementsHidden("#first", true, documentLike);
  assert.equal(selected.length, 1);
  assert.equal(selected[0], first);
  assert.equal(first.hidden, true);

  const restored = utils.setElementsHidden([first, null, second, "#missing"], false, documentLike);
  assert.equal(restored.length, 2);
  assert.equal(restored[0], first);
  assert.equal(restored[1], second);
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, false);

  assert.equal(utils.setElementsHidden(null, true, documentLike).length, 0);
});

test("ui blob download helper creates a temporary link and revokes the object url", async () => {
  const { utils } = await loadUiUtils();
  const calls = [];
  const link = {
    href: "",
    download: "",
    click() {
      calls.push(["click", this.href, this.download]);
    },
    remove() {
      calls.push(["remove"]);
    },
  };
  const documentLike = {
    body: {
      appendChild(node) {
        calls.push(["append", node]);
      },
    },
    createElement(tagName) {
      calls.push(["create", tagName]);
      return link;
    },
  };
  const urlApi = {
    createObjectURL(blob) {
      calls.push(["createObjectURL", blob]);
      return "blob:mock-url";
    },
    revokeObjectURL(url) {
      calls.push(["revokeObjectURL", url]);
    },
  };
  const blob = { size: 12 };

  utils.downloadBlob(blob, "导出.xlsx", documentLike, urlApi);

  assert.deepEqual(calls, [
    ["createObjectURL", blob],
    ["create", "a"],
    ["append", link],
    ["click", "blob:mock-url", "导出.xlsx"],
    ["remove"],
    ["revokeObjectURL", "blob:mock-url"],
  ]);
});

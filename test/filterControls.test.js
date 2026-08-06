import assert from "node:assert/strict";
import test from "node:test";

import {
  createFilterControls,
  updateFilterDropdownMenuAlignment,
  getFilterDropdownMenuAlignment,
  getFilterDropdownSummary,
} from "../assets/js/filter-controls.js";

function makeSelect(allLabel, selectedLabels) {
  return {
    options: [{ value: "", textContent: allLabel }],
    selectedOptions: selectedLabels.map((label) => ({ value: label, textContent: label })),
  };
}

test("filter dropdown summary shows the all label when no value is selected", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", [])), {
    text: "全部店铺",
    accessibleText: "全部店铺",
    title: "全部店铺",
  });
});

test("filter dropdown summary exposes the selected item accessibly", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", ["tandanbo-CA"])), {
    text: "tandanbo-CA",
    accessibleText: "已选 1 项：tandanbo-CA",
    title: "tandanbo-CA",
  });
});

test("filter dropdown summary summarizes two selected items with an accessible label list", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", ["tandanbo-CA", "xiamentanjia-US"])), {
    text: "已选 2 项",
    accessibleText: "已选 2 项：tandanbo-CA、xiamentanjia-US",
    title: "tandanbo-CA、xiamentanjia-US",
  });
});

test("filter dropdown summary ignores the all option and trims selected labels", () => {
  const select = {
    options: [{ value: "", textContent: "全部店铺" }],
    selectedOptions: [
      { value: "", textContent: "全部店铺" },
      { value: "tandanbo-CA", textContent: " tandanbo-CA " },
    ],
  };

  assert.deepEqual(getFilterDropdownSummary(select), {
    text: "tandanbo-CA",
    accessibleText: "已选 1 项：tandanbo-CA",
    title: "tandanbo-CA",
  });
});

test("filter dropdown summary normalizes whitespace in selected labels", () => {
  const select = {
    options: [{ value: "", textContent: "全部店铺" }],
    selectedOptions: [
      { value: "", textContent: "全部店铺" },
      { value: "tandanbo-CA", textContent: "  tandanbo\n  CA  " },
    ],
  };

  assert.deepEqual(getFilterDropdownSummary(select), {
    text: "tandanbo CA",
    accessibleText: "已选 1 项：tandanbo CA",
    title: "tandanbo CA",
  });
});

test("filter dropdown menu aligns to its end edge when its start edge would exceed the viewport", () => {
  assert.equal(getFilterDropdownMenuAlignment({ right: 804 }, 800), "end");
  assert.equal(getFilterDropdownMenuAlignment({ right: 784 }, 800), "start");
});

test("filter dropdown menu recalculates alignment from its start edge when reopened", () => {
  let endAligned = true;
  const calls = [];
  const menu = {
    classList: {
      remove(className) {
        calls.push(`remove:${className}`);
        if (className === "filter-dropdown-menu--align-end") endAligned = false;
      },
      toggle(className, force) {
        calls.push(`toggle:${className}:${force}`);
        if (className === "filter-dropdown-menu--align-end") endAligned = force;
      },
    },
    getBoundingClientRect() {
      calls.push("measure");
      return { right: endAligned ? 784 : 804 };
    },
  };

  assert.equal(updateFilterDropdownMenuAlignment(menu, 800), "end");
  assert.deepEqual(calls, [
    "remove:filter-dropdown-menu--align-end",
    "measure",
    "toggle:filter-dropdown-menu--align-end:true",
  ]);
});

test("filter dropdown trigger closes an open menu with Escape", () => {
  const bindCalls = [];
  const disclosureCalls = [];
  let focusCount = 0;
  const button = {
    attributes: { "aria-expanded": "true" },
    focus() {
      focusCount += 1;
    },
  };
  const menu = { hidden: false };
  const dropdown = {
    querySelector(selector) {
      return {
        ".filter-dropdown-button": button,
        ".filter-dropdown-menu": menu,
      }[selector] || null;
    },
  };
  const select = {
    classList: { add() {} },
    insertAdjacentElement(position, element) {
      assert.equal(position, "afterend");
      this.nextElementSibling = element;
    },
  };
  const controls = createFilterControls({
    root: { createElement: () => dropdown },
    globalObject: {},
    bind: (...args) => bindCalls.push(args),
    setDisclosureState(panel, trigger, expanded) {
      disclosureCalls.push([panel, trigger, expanded]);
      panel.hidden = !expanded;
      trigger.attributes["aria-expanded"] = String(expanded);
    },
  });

  controls.createFilterDropdown(select);
  const keydownHandler = bindCalls.find(([, selector, eventName]) => (
    selector === ".filter-dropdown-button" && eventName === "keydown"
  ))?.[3];
  assert.equal(typeof keydownHandler, "function");

  let nonEscapePrevented = false;
  keydownHandler({
    key: "Enter",
    currentTarget: button,
    preventDefault() {
      nonEscapePrevented = true;
    },
  });
  assert.equal(nonEscapePrevented, false);
  assert.equal(menu.hidden, false);
  assert.equal(button.attributes["aria-expanded"], "true");
  assert.equal(focusCount, 0);

  let escapePrevented = false;
  keydownHandler({
    key: "Escape",
    currentTarget: button,
    preventDefault() {
      escapePrevented = true;
    },
  });
  assert.equal(escapePrevented, true);
  assert.equal(menu.hidden, true);
  assert.equal(button.attributes["aria-expanded"], "false");
  assert.equal(focusCount, 1);
  assert.deepEqual(disclosureCalls, [[menu, button, false]]);
});

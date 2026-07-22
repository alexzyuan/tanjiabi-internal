import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("filter dropdown menu aligns to its end edge when its start edge would exceed the viewport", () => {
  assert.equal(getFilterDropdownMenuAlignment({ right: 804 }, 800), "end");
  assert.equal(getFilterDropdownMenuAlignment({ right: 784 }, 800), "start");
});

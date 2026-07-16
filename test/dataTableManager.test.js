import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDataTableVariant,
  inferTableColumnKind,
  inferTableStateTone,
  normalizeColumnWidth,
} from "../assets/js/data-table-manager.js";

test("data table manager classifies table variants by business shape", () => {
  assert.equal(classifyDataTableVariant({ className: "sales-forecast-table", columnCount: 49 }), "matrix");
  assert.equal(classifyDataTableVariant({ className: "data-table", columnCount: 15 }), "wide");
  assert.equal(classifyDataTableVariant({ className: "data-table", columnCount: 8 }), "standard");
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

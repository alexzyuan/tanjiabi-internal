# 店铺巡检低库存费汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日店铺巡检复用低库存费看板口径，将当前已进入低库存费区间（供货天数小于 28 天）的 MSKU 汇总进日报和巡检页面，不新增负责人 `@` 提醒。

**Architecture:** `lowInventoryFeeService` 仍唯一负责 FBA 库存读取、缓存和 `amazonFeeEligible` 判断。`storeInspectionService` 调用 `getLowInventoryFeeDashboard({ onlyRisk: "0" })`，仅压缩并消费已经收费区间的店铺、国家、MSKU；它负责保存巡检快照、总状态、日报和前端数据。

**Tech Stack:** Node.js ESM、Node test runner、原生 HTML/CSS/JavaScript、Lingxing adapter。

---

## File structure

- `src/services/storeInspectionService.js`: 导入低库存费服务；新增摘要、错误转换、巡检并行调用、快照/总状态/日报整合。不能复制或改动低库存费判定。
- `test/storeInspectionService.test.js`: 测试摘要过滤、可见错误、日报按店铺清单、总体风险和不 @ 负责人。
- `index.html`: 增加 KPI 与巡检历史列。
- `assets/js/features/store-inspection.js`: 渲染 KPI、概览卡、待处理行和历史列；不增加请求。
- `test/storeInspectionFeature.test.js`: 新建，覆盖低库存费 UI 渲染。
- `assets/css/pages/23-store-inspection.css`: 只在响应式布局确有需要时用现有 token 调整；`styles.css` 仅由 `npm run build:css` 生成。

### Task 1: Test and build the inspection summary contract

**Files:**
- Modify: `test/storeInspectionService.test.js`
- Modify: `src/services/storeInspectionService.js`

- [ ] **Step 1: Write failing summary and no-mention tests**

```js
import { buildLowInventoryFeeInspectionSummary, recomputeInspectionOverall } from "../src/services/storeInspectionService.js";

test("buildLowInventoryFeeInspectionSummary keeps only MSKUs already in the fee interval", () => {
  const summary = buildLowInventoryFeeInspectionSummary({ rows: [
    { storeName: "xiamentanjia-US", country: "美国", msku: "FEE-1", amazonFeeEligible: true },
    { storeName: "xiamentanjia-US", country: "美国", msku: "EARLY-1", amazonFeeEligible: false },
  ] });
  assert.deepEqual(summary.rows, [{ storeName: "xiamentanjia-US", country: "美国", msku: "FEE-1" }]);
  assert.equal(summary.status, "risk");
});

test("low inventory fee rows make the inspection actionable without @ targets", () => {
  const lowInventoryFee = buildLowInventoryFeeInspectionSummary({ rows: [{ storeName: "xiamentanjia-US", msku: "FEE-1", amazonFeeEligible: true }] });
  const result = recomputeInspectionOverall({
    feedback: { count: 0, status: "ok", rows: [] }, review: { count: 0, status: "ok", rows: [] }, voiceOfBuyer: { count: 0, status: "ok", rows: [] }, accountHealth: { count: 0, status: "ok", rows: [] }, erpBuyerMessages: { count: 0, status: "ok", rows: [] }, aftersalesMail: { count: 0, status: "ok", rows: [] }, lowInventoryFee,
  });
  assert.equal(result.overallLabel, "需处理");
  assert.deepEqual(storeInspectionMentionUserIds(result, mentionConfig), []);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/storeInspectionService.test.js`

Expected: FAIL because the summary export and low-inventory-fee total-status path do not exist.

- [ ] **Step 3: Implement the minimal summary**

```js
export function buildLowInventoryFeeInspectionSummary(dashboard = {}) {
  const rows = (dashboard.rows || []).filter((row) => row?.amazonFeeEligible === true).map((row) => ({
    storeName: String(row.storeName || "").trim(), country: String(row.country || "").trim(), msku: String(row.msku || "").trim(),
  })).filter((row) => row.storeName && row.msku);
  return { key: "lowInventoryFee", label: "低库存费 MSKU", status: rows.length ? "risk" : "ok", tone: rows.length ? "danger" : "success", count: rows.length, detail: rows.length ? `本周 ${rows.length} 个 MSKU 已进入低库存费区间。` : "本周无 MSKU 进入低库存费区间。", rows };
}
```

Add `result.lowInventoryFee` to `buildChecks` and `recomputeInspectionOverall` core checks. Do not add its rows to `storeInspectionMentionTargets`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/storeInspectionService.test.js`

Expected: PASS.

### Task 2: Reuse the low-inventory-fee service in daily inspection

**Files:**
- Modify: `src/services/storeInspectionService.js`
- Modify: `test/storeInspectionService.test.js`

- [ ] **Step 1: Write the failing visible-error test**

```js
test("low inventory fee inspection failure is visible rather than treated as an empty list", () => {
  const summary = lowInventoryFeeInspectionError(new Error("FBA inventory detail unavailable"));
  assert.equal(summary.status, "error");
  assert.equal(summary.count, 0);
  assert.match(summary.detail, /FBA inventory detail unavailable/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/storeInspectionService.test.js`

Expected: FAIL because `lowInventoryFeeInspectionError` is not exported.

- [ ] **Step 3: Implement direct service reuse**

Import `getLowInventoryFeeDashboard` from `./lowInventoryFeeService.js` and add:

```js
export function lowInventoryFeeInspectionError(error) {
  return { key: "lowInventoryFee", label: "低库存费 MSKU", status: "error", tone: "danger", count: 0, detail: error?.message || "低库存费看板读取失败", rows: [] };
}
```

Add `getLowInventoryFeeDashboard({ onlyRisk: "0" })` to `runStoreInspection`'s `Promise.allSettled`. Convert success through `buildLowInventoryFeeInspectionSummary`, failure through `lowInventoryFeeInspectionError`; include it in `coreChecks`, the saved result and mock/default/recompute result shapes. Keep `onlyRisk: "0"` so `<28 天` selection remains explicit.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test test/storeInspectionService.test.js && npm run check:js`

Expected: PASS.

### Task 3: Add compact store-level Markdown lines

**Files:**
- Modify: `test/storeInspectionService.test.js`
- Modify: `src/services/storeInspectionService.js`

- [ ] **Step 1: Write failing Markdown test**

```js
test("buildStoreInspectionMarkdown lists current fee-interval MSKUs in their store section", () => {
  const markdown = buildStoreInspectionMarkdown({
    meta: { storeCount: 1, updatedAt: "2026/8/3 08:30:00", stores: [{ name: "xiamentanjia-US", country: "美国" }] },
    feedback: { rows: [], storeStats: [] }, review: { rows: [], storeStats: [] }, voiceOfBuyer: { rows: [] }, accountHealth: { rows: [], storeStats: [] }, erpBuyerMessages: { rows: [] }, aftersalesMail: { detail: "无待回复邮件。", rows: [] },
    lowInventoryFee: { rows: [{ storeName: "xiamentanjia-US", msku: "FEE-1" }, { storeName: "xiamentanjia-US", msku: "FEE-2" }] },
  }, [], mentionConfig);
  assert.match(markdown, /本周低库存费 MSKU：FEE-1、FEE-2。/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/storeInspectionService.test.js`

Expected: FAIL because report collection and store sections ignore `lowInventoryFee`.

- [ ] **Step 3: Render the compact list**

Include `lowInventoryFee.rows` in `collectReportStoreNames` and `storeHasInspectionItems`. In `buildStoreReportSection`, append only when nonempty:

```js
const feeMskus = [...new Set((latest?.lowInventoryFee?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)).map((row) => normalizeReportText(row.msku)).filter(Boolean))];
// Append: feeMskus.length ? `- 本周低库存费 MSKU：${feeMskus.join("、")}。` : "",
```

No mention-target logic may be changed.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/storeInspectionService.test.js`

Expected: PASS.

### Task 4: Add the summary to the existing inspection UI

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/store-inspection.js`
- Create: `test/storeInspectionFeature.test.js`
- Modify: `assets/css/pages/23-store-inspection.css` only if responsive inspection-card layout requires it

- [ ] **Step 1: Write failing UI rendering test**

Create a DOM-double test with one `lowInventoryFee` row. Assert `#inspection-low-inventory-fee-count` receives `1` and pending-record HTML contains `低库存费 MSKU`, `xiamentanjia-US`, and `FEE-1`.

- [ ] **Step 2: Verify RED**

Run: `node --test test/storeInspectionFeature.test.js`

Expected: FAIL because the KPI target and low-fee record rendering are missing.

- [ ] **Step 3: Implement semantic markup and rendering**

Add to the inspection KPI grid:

```html
<article class="metric-tile"><span>低库存费 MSKU</span><strong id="inspection-low-inventory-fee-count">0</strong><small>当前已进入收费区间</small></article>
```

Render a low-fee overview card, `lowInventoryFeeRows`, KPI text, and detail rows shaped as:

```js
{ type: "低库存费 MSKU", storeName: item.storeName, object: item.msku, actor: "-", content: "本周已进入低库存费区间", createdAt: "-", status: "本周低库存费" }
```

Add a low-fee header/count to the history table and renderer, and update empty-state text. Use existing classes and semantic tokens; do not edit `styles.css` directly.

- [ ] **Step 4: Build and verify GREEN**

Run: `npm run build:css && node --test test/storeInspectionFeature.test.js && npm run check`

Expected: PASS.

### Task 5: Final verification and commit

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-store-inspection-low-inventory-fee-design.md` only if the implementation causes a real documented decision change

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Browser verification**

Run: `npm run dev`. In the Store Inspection view verify no console errors; KPI, overview, module state, pending rows and history appear; “立即巡检” is mouse/keyboard usable; desktop and narrow layouts keep the shell at viewport width with table-local horizontal scrolling; `GET /api/store-inspection/status` returns `lowInventoryFee` and Markdown lists only `<28 天` MSKUs.

- [ ] **Step 3: Check and commit**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only task-owned files. Commit with `git commit -m "feat: include low inventory fee in store inspection"`.

# 销售复盘明细 30d 退款率 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售复盘明细中增加一列“30d 退款率”，以筛选器结束日为锚点统计最近 30 个自然日的退款金额 / 销售额，并放在现有“退款率”之前。

**Architecture:** 销售周报数据入口复用现有 OrderProfit 缓存适配器，同时请求当前筛选周期与 `[endDate - 29 天, endDate]` 的 30d 窗口；服务层把两组已标准化记录传给 mapper。mapper 按店铺 + MSKU 聚合 30d 退款与销售，输出 nullable 的 `refundRate30d`；前端只负责展示、排序和列顺序。缓存 source 版本升级，避免旧缓存缺少新窗口数据。

**Tech Stack:** Node.js 22 ESM、Node built-in test runner、原生 HTML、ES modules、现有 LingxingAdapter OrderProfit cache、Playwright 浏览器校验。

---

### Task 1: 为 30d 窗口日期和适配器请求建立失败测试

**Files:**
- Modify: `test/lingxingAdapterFailFast.test.js`
- Modify: `test/salesWeeklySourceCache.test.js`

- [ ] **Step 1: Write the failing adapter test**

在 `test/lingxingAdapterFailFast.test.js` 增加测试，替换 `adapter.fetchMskuOrderProfitCached` 为记录调用参数的真实 stub，调用：

```js
const data = await adapter.fetchSalesWeeklyData({
  startDate: "2026-08-01",
  endDate: "2026-08-09",
  currencyCode: "CNY",
  sids: [8708],
});
```

断言两次调用分别为：

```js
[
  { startDate: "2026-08-01", endDate: "2026-08-09", sids: [8708], currencyCode: "CNY" },
  { startDate: "2026-07-11", endDate: "2026-08-09", sids: [8708], currencyCode: "CNY" },
]
```

并断言返回值包含 `recent30OrderProfitRecords` 和 `raw.recent30`，当前周期日期不被改写。

- [ ] **Step 2: Run the focused test and verify it fails for the missing behavior**

Run: `node --test test/lingxingAdapterFailFast.test.js`

Expected: FAIL because `fetchSalesWeeklyData` currently makes only one OrderProfit cache call and does not return a 30d record set.

- [ ] **Step 3: Add a cache-source regression fixture**

在 `test/salesWeeklySourceCache.test.js` 的 source fixture 增加 `recent30OrderProfitRecords` 和 `raw.recent30`，并把 fixture/cache scope 版本从 `sales-weekly-source-v1` 改为 `sales-weekly-source-v2`；为后续 mapper 读取缓存新字段建立覆盖。

- [ ] **Step 4: Run the cache test and verify the new fixture is initially unused**

Run: `node --test test/salesWeeklySourceCache.test.js`

Expected: PASS for existing owner filtering, while the new 30d field is not yet asserted; this confirms the fixture is valid before implementation.

---

### Task 2: 实现 OrderProfit 30d 窗口加载和 source cache 版本升级

**Files:**
- Modify: `src/adapters/lingxingAdapter.js:1-3,1622-1680`
- Modify: `src/services/dashboardService.js:31-42,74-115,149-181`
- Modify: `test/lingxingAdapterFailFast.test.js`
- Modify: `test/salesWeeklySourceCache.test.js`

- [ ] **Step 1: Implement the smallest date-window request**

在 `src/adapters/lingxingAdapter.js` 引入已有 `addDaysToDateText`，在 `fetchSalesWeeklyData` 的 `range` 确定后计算：

```js
const recent30Range = {
  startDate: addDaysToDateText(range.endDate, -29),
  endDate: range.endDate,
};
```

使用 `Promise.all` 调用当前范围与 `recent30Range` 的 `fetchMskuOrderProfitCached`，两次都传入相同 `selectedSids`、`currencyCode`、`sellerList` 和 `reportDate: range.endDate`。任一请求抛错都让 `fetchSalesWeeklyData` 抛出，不添加降级数据。

- [ ] **Step 2: Add observable metadata without secrets**

返回：

```js
recent30OrderProfitRecords: recent30OrderProfitResult.records,
raw: {
  ...,
  recent30: {
    startDate: recent30Range.startDate,
    endDate: recent30Range.endDate,
    cacheState: recent30OrderProfitResult.cacheState,
    cacheUpdatedAt: recent30OrderProfitResult.cacheUpdatedAt,
    recordCount: recent30OrderProfitResult.records.length,
  },
},
```

同时在适配器日志中记录窗口、币种、sid 数、行数、缓存状态和耗时；不得记录凭据。

- [ ] **Step 3: Make source cache keys invalidate old sources**

把 `salesWeeklySourceScope` 的 `version` 改为 `sales-weekly-source-v2`，并同步测试中的 cache key。`mapSalesWeeklySourceToDashboard` 读取并传递 `recent30OrderProfitRecords` 与 `raw.recent30`，旧 source 不再命中 v2 key。

- [ ] **Step 4: Run the focused adapter and cache tests**

Run: `node --test test/lingxingAdapterFailFast.test.js test/salesWeeklySourceCache.test.js`

Expected: PASS，且 adapter test 明确验证 `2026-07-11` 到 `2026-08-09` 的双闭区间请求。

---

### Task 3: 为按店铺 + MSKU 的 30d 退款率映射建立失败测试

**Files:**
- Modify: `test/salesBudgetMskuOwnerMapping.test.js`
- Create: `test/salesReview30dRefundRate.test.js`

- [ ] **Step 1: Write the failing mapper test**

新增测试调用 `buildBudgetMskuDetailRows(currentRecords, budgetTargets, inventoryRecords, sellers, ownerRows, filters, recent30Records)`，构造同一店铺/MSKU 的当前周期与 30d 记录：

```js
currentRecords = [{ sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 100, totalSalesRefunds: 5 }];
recent30Records = [{ sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 400, totalSalesRefunds: 12 }];
```

断言行同时保留 `refundRate === 5`、`refundRate30d === 3`，并验证 30d 记录按相同店铺/MSKU 汇总而不是取第一条。再增加一个 30d 销售额为 0 的行，断言 `refundRate30d === null`。

- [ ] **Step 2: Run the mapper test and verify RED**

Run: `node --test test/salesReview30dRefundRate.test.js`

Expected: FAIL because `buildBudgetMskuDetailRows` 尚未接受 30d records，也没有 `refundRate30d` 字段。

---

### Task 4: 实现 mapper 的 30d 聚合与响应元数据

**Files:**
- Modify: `src/services/lingxingDashboardMapper.js:825-940,969-1030`
- Modify: `src/services/dashboardService.js:101-120`
- Modify: `test/salesReview30dRefundRate.test.js`

- [ ] **Step 1: Add a nullable ratio helper**

在 mapper 中新增：

```js
function getNullableRatioPercent(numerator, denominator) {
  if (!Number.isFinite(Number(denominator)) || Number(denominator) <= 0) return null;
  return Number(((Number(numerator) / Number(denominator)) * 100).toFixed(2));
}
```

保持现有 `getRatioPercent` 不变，避免改变旧退款率的零分母行为。

- [ ] **Step 2: Extend detail-row mapping with a separate recent map**

给 `buildBudgetMskuDetailRows` 增加最后一个参数 `recent30Records = []`。创建 `recent30ActualMap = buildActualMskuMap(recent30Records)`；每条预算/未覆盖实际行通过 `findActualMsku(recent30ActualMap, row)` 获取 30d sales/refund，并设置：

```js
refundRate30d: recent30Actual ? getNullableRatioPercent(recent30Actual.refund, recent30Actual.sales) : null,
```

不得让 30d 记录影响当前周期的销量、利润、库存或现有 `refundRate`。

- [ ] **Step 3: Thread the records through the dashboard mapper**

给 `mapLingxingToSalesDashboard` 增加 `recent30OrderProfitRecords = []` 参数，并把它传给 `buildBudgetMskuDetailRows`。在正常和无数据响应的 `meta` 中原样传递适配器已生成的窗口元数据：

```js
recent30: raw.recent30 || null,
```

若适配器的结束日期无效，`addDaysToDateText` 会在上游抛错；mapper 不重新计算日期，也不生成伪窗口。

- [ ] **Step 4: Run mapper tests**

Run: `node --test test/salesReview30dRefundRate.test.js test/salesBudgetMskuOwnerMapping.test.js`

Expected: PASS，当前退款率保持旧值，30d 零分母保持 `null`。

---

### Task 5: 在销售复盘明细中新增列并保持共享表格契约

**Files:**
- Modify: `index.html:402-420`
- Modify: `assets/js/features/sales-dashboard.js:238-300`
- Modify: `test/salesDashboardFeature.test.js`
- Modify: `test/stylesStructure.test.js`

- [ ] **Step 1: Write the failing frontend assertions**

在 `test/salesDashboardFeature.test.js` 增加 detail row fixture 的 `refundRate30d: 3`，断言渲染 HTML 中 `3%` 位于 `5%`（现有退款率）之前，并触发 `[data-msku-sort="refundRate30d"]` 后排序键为 `refundRate30d`。在 `test/stylesStructure.test.js` 把表头数量断言从 18 改为 19，并断言新 header 的稳定 key 和位置。

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test test/salesDashboardFeature.test.js test/stylesStructure.test.js`

Expected: FAIL because the HTML has no `refundRate30d` column and the renderer omits the property.

- [ ] **Step 3: Add the header before current refundRate**

在 `index.html` 的 `refundRate` header 前插入：

```html
<th data-column-key="refundRate30d" data-column-kind="number" data-column-profile="money-rate"><button class="sort-button" type="button" data-msku-sort="refundRate30d">30d 退款率</button></th>
```

- [ ] **Step 4: Render and sort the new field**

在 `renderMskuDetailTable` 的 `grossRate` 与 `refundRate` 单元格之间调用 `mskuRateCell("refundRate30d", row.refundRate30d)`。调整 `mskuRateCell` 使 `null`/`undefined` 输出 `—`，而现有数值仍输出百分号；在退款率阈值规则中复用 `refundRate30d` 的同一告警阈值。空表 `colspan` 改为 19。

- [ ] **Step 5: Run focused frontend tests**

Run: `node --test test/salesDashboardFeature.test.js test/stylesStructure.test.js`

Expected: PASS，新列位于原退款率之前，排序按钮使用共享 `.sort-button`，无新增 CSS。

---

### Task 6: 全链路回归与浏览器验证

**Files:**
- Modify: `test/salesWeeklySourceCache.test.js` (only if assertions need the v2 recent30 metadata)

- [ ] **Step 1: Run all automated checks**

Run: `npm run check && npm test`

Expected: JS/CSS checks and all Node/browser tests PASS，且没有新增 warning/error。

- [ ] **Step 2: Start the local server**

Run: `npm start`

Expected: server starts without syntax or startup errors; keep the process running for browser verification.

- [ ] **Step 3: Verify desktop behavior in the browser**

打开销售复盘，选择一个明确结束日，检查 `/api/dashboard/sales-weekly` 请求对应 30d start/end；确认明细表头顺序为“毛利率、30d 退款率、退款率、广告费率”，任意一行的 30d 值与接口 `refundRate30d` 一致，点击 30d 表头可升降序排序。

- [ ] **Step 4: Verify filters and narrow viewport**

切换店铺和负责人筛选，确认只改变行集合，不改变同一行的 30d 数值；用键盘聚焦排序按钮并触发；在窄屏检查文档和应用 shell 仍为视口宽度，只有表格 wrapper 横向滚动。

- [ ] **Step 5: Stop the server and review the diff**

停止本地服务器，运行 `git diff --check` 与 `git status --short`，确认只包含本功能代码、测试和计划/设计记录，不修改未跟踪的用户文件。

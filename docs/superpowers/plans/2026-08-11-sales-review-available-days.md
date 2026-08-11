# 销售复盘可售天数 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售复盘 MSKU 明细的 FBA 库存后显示销售预估缓存的同店铺可售天数。

**Architecture:** 销售预估服务提供只读、精确到 `SID + MSKU` 的可售天数缓存索引；销售复盘服务补齐明细字段和来源元数据；前端只显示后端字段。

**Tech Stack:** Node.js ESM、原生 HTML/JS、Node 内置测试。

## Global Constraints

- 复用 `sales-forecast-dashboard-cache.json` 的 `fbaAvailableDays`，不新增领星调用、不重算库存或日销。
- 仅按 `SID + MSKU` 匹配；未提供显示 `—`，不是 `0`。
- 缓存结构或读取错误向上抛出并记录上下文；`styles.css` 仅通过构建生成。

---

### Task 1: 精确可售天数缓存索引

**Files:**
- Modify: `src/services/salesForecastService.js:1237-1288`
- Test: `test/salesForecastPersistence.test.js`

**Interfaces:**
- Produces: `getSalesForecastAvailableDaysBySellerMsku(): Promise<{ map: Map<string, number>, status: string, updatedAt: string, cacheHit: boolean }>`，键为 `${Number(sid)}|${normalizedMsku}`。

- [ ] **Step 1: 写出失败的测试**

```js
const result = await getSalesForecastAvailableDaysBySellerMsku();
assert.equal(result.map.get("101|md-legblue"), 28.5);
assert.equal(result.map.get("102|md-legblue"), 73);
assert.equal(result.map.size, 2);
```

夹具包含不同 `sid` 的同一 MSKU；断言空缓存返回空 `Map` 和明确状态，损坏 JSON 仍抛出错误。

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/salesForecastPersistence.test.js`

Expected: FAIL，函数尚未导出。

- [ ] **Step 3: 实现只读索引**

```js
function salesForecastAvailableDaysKey(sid, msku) {
  const sellerId = Number(sid);
  const normalizedMsku = String(msku || "").trim().toLowerCase();
  return Number.isFinite(sellerId) && sellerId > 0 && normalizedMsku ? `${sellerId}|${normalizedMsku}` : "";
}

export async function getSalesForecastAvailableDaysBySellerMsku() {
  const cache = await readSalesForecastDashboardCache();
  const map = new Map();
  if (!cache?.rows?.length) return { map, status: "销售预估缓存暂无可售天数数据", updatedAt: "", cacheHit: false };
  for (const row of cache.rows) {
    const key = salesForecastAvailableDaysKey(row.sid, row.msku);
    const days = Number(row.fbaAvailableDays);
    if (key && Number.isFinite(days)) map.set(key, days);
  }
  return { map, status: `复用销售预估可售天数 ${map.size} 条`, updatedAt: cache.updatedAt || "", cacheHit: true };
}
```

不修改 `getSalesForecastFbaInventoryByMsku`，它保留工厂库存的跨店铺汇总语义。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/salesForecastPersistence.test.js`

Expected: PASS。

```bash
git add src/services/salesForecastService.js test/salesForecastPersistence.test.js
git commit -m "feat: index sales forecast available days"
```

### Task 2: 销售复盘后端补齐与可观测性

**Files:**
- Modify: `src/services/lingxingDashboardMapper.js:830-910`
- Modify: `src/services/dashboardService.js:1-145,315-470,471-550`
- Test: `test/salesReview30dRefundRate.test.js`
- Test: `test/salesWeeklySourceCache.test.js`

**Interfaces:**
- Consumes: Task 1 的索引和 `detailRows[].sid`、`detailRows[].msku`。
- Produces: `enrichSalesReviewAvailableDays(dashboard): Promise<dashboard>`，写入 `detailRows[].fbaAvailableDays: number | null` 和 `meta.availableDays: { source, updatedAt, matchedCount, missingCount, cacheHit }`。

- [ ] **Step 1: 写出失败的测试**

```js
assert.equal(rows[0].sid, 101);
assert.equal(rows[0].fbaAvailableDays, null);
const dashboard = await enrichSalesReviewAvailableDays({ detailRows: [{ sid: 101, msku: "MD-LEGBLUE" }], meta: {} });
assert.equal(dashboard.detailRows[0].fbaAvailableDays, 28.5);
assert.equal(dashboard.meta.availableDays.matchedCount, 1);
```

增加同 MSKU、不同 SID 的两行和一条未命中行，断言各自数值、不串值及 `missingCount`。旧销售复盘缓存缺 `fbaAvailableDays` 时必须被契约拒绝。

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/salesReview30dRefundRate.test.js test/salesWeeklySourceCache.test.js`

Expected: FAIL，明细身份或补齐函数不存在。

- [ ] **Step 3: 实现身份保留与补齐**

`buildBudgetMskuDetailRows` 每行加入：

```js
sid: Number(actual.sid || resolveBudgetRowSid(row)) || null,
fbaAvailableDays: null,
```

`dashboardService.js` 调用 Task 1 索引，按同一键补齐明细并写入元数据。所有 `getSalesWeeklyDashboard` 返回分支及 `getMskuDetailDashboard` 在响应前等待此函数。缓存读取错误记录 `{ cacheKey, error }` 后重新抛出。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/salesReview30dRefundRate.test.js test/salesWeeklySourceCache.test.js`

Expected: PASS。

```bash
git add src/services/lingxingDashboardMapper.js src/services/dashboardService.js test/salesReview30dRefundRate.test.js test/salesWeeklySourceCache.test.js
git commit -m "feat: enrich sales review available days"
```

### Task 3: 明细列展示与浏览器验证

**Files:**
- Modify: `index.html:393-417`
- Modify: `assets/js/features/sales-dashboard.js:287-325`
- Test: `test/frontendStructure.test.js`
- Test: `test/salesDashboardFeature.test.js`
- Test: `test/stylesStructure.test.js`

**Interfaces:**
- Consumes: Task 2 的 `detailRows[].fbaAvailableDays`。
- Produces: `fba-available-days` 列，有限数值显示 `<value>天`，未提供显示 `—`。

- [ ] **Step 1: 写出失败的测试**

```js
assert.match(tableMatch[0], /data-column-key="fbaInventory"[\s\S]*?data-column-key="fba-available-days"[\s\S]*?可售天数[\s\S]*?data-column-key="quantityAchievement"/);
assert.match(detailTable.innerHTML, /<td>28.5天<\/td>/);
assert.match(detailTable.innerHTML, /<td>—<\/td>/);
```

同时将表头数和空状态 `colspan` 从 19 更新为 20，且断言未添加页级固定列宽。

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/frontendStructure.test.js test/salesDashboardFeature.test.js test/stylesStructure.test.js`

Expected: FAIL，新列不存在。

- [ ] **Step 3: 实现表格列**

```html
<th data-column-key="fba-available-days" data-column-kind="number" data-column-profile="number"><button class="sort-button" type="button" data-msku-sort="fbaAvailableDays">可售天数</button></th>
```

新增 `availableDaysCell(value)`：`Number.isFinite(Number(value))` 时输出 `${formatActualMoney(value)}天`，否则输出 `<td>—</td>`。在 FBA 库存后调用，空状态使用 `colspan="20"`，不增加页面级宽度或颜色。

- [ ] **Step 4: 验证并提交**

Run: `npm run build:css && npm run check && node --test test/frontendStructure.test.js test/salesDashboardFeature.test.js test/stylesStructure.test.js`

Expected: exit 0。

Browser flow: 打开销售复盘，检查列顺序、命中“天”、未命中 `—`；在桌面与 390px 窄屏确认表格滚动保留在容器内、无页面级溢出和控制台错误。

```bash
git add index.html assets/js/features/sales-dashboard.js test/frontendStructure.test.js test/salesDashboardFeature.test.js test/stylesStructure.test.js
git commit -m "feat: show sales review available days"
```

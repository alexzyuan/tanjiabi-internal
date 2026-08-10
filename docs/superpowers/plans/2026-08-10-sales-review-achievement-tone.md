# 销售复盘明细达成率状态与表头精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售复盘 MSKU 明细中，按时间进度突出销量达成率的落后与显著领先状态，并精简七个费率表头。

**Architecture:** 前端功能模块从既有 KPI 数组提取“时间进度”，由一个纯函数计算数量达成率的状态。渲染层只给该百分比单元格增加语义 class；页面 CSS 复用设计 token 表示黄、红、蓝状态。表头保持其稳定列键和排序键不变。

**Tech Stack:** 原生 HTML、CSS、ES 模块 JavaScript、Node test runner。

---

## 文件结构

- 修改 `assets/js/features/sales-dashboard.js`：新增纯状态函数；在 `renderDashboard` 保存当前时间进度；在 `renderMskuDetailTable` 为销量达成率单元格生成 class。
- 修改 `index.html`：替换七个显示表头文本，不变更 `data-column-key`、排序属性或列顺序。
- 修改 `assets/css/pages/22-sales-dashboard.css`：增加销售复盘详情状态单元格颜色规则，仅使用既有语义 token。
- 修改 `test/salesDashboardFeature.test.js`：验证纯函数阈值和生成的表格单元格状态 class。
- 修改 `test/stylesStructure.test.js`：验证表头精简文本、列键顺序与状态样式位于销售页 CSS。

### Task 1: 数量达成率状态纯函数

**Files:**
- Modify: `assets/js/features/sales-dashboard.js`
- Test: `test/salesDashboardFeature.test.js`

- [ ] **Step 1: 写入失败测试，覆盖边界阈值和不可用值**

在 `test/salesDashboardFeature.test.js` 导入的模块中调用将要导出的 `getQuantityAchievementTone`：

```js
assert.equal(getQuantityAchievementTone(75, 80), "msku-achievement-warning");
assert.equal(getQuantityAchievementTone(74.99, 80), "msku-achievement-danger");
assert.equal(getQuantityAchievementTone(80, 80), "");
assert.equal(getQuantityAchievementTone(95, 80), "");
assert.equal(getQuantityAchievementTone(95.01, 80), "msku-achievement-info");
assert.equal(getQuantityAchievementTone(75, null), "");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/salesDashboardFeature.test.js`

Expected: FAIL，因为模块尚未导出 `getQuantityAchievementTone`。

- [ ] **Step 3: 最小实现纯函数并导出**

在 `assets/js/features/sales-dashboard.js` 顶层加入：

```js
export function getQuantityAchievementTone(quantityAchievement, timeProgress) {
  const achievement = Number(quantityAchievement);
  const progress = Number(timeProgress);
  if (!Number.isFinite(achievement) || !Number.isFinite(progress)) return "";
  const difference = achievement - progress;
  if (difference < -5) return "msku-achievement-danger";
  if (difference < 0) return "msku-achievement-warning";
  if (difference > 15) return "msku-achievement-info";
  return "";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/salesDashboardFeature.test.js`

Expected: PASS。

- [ ] **Step 5: 提交纯函数与测试**

```bash
git add assets/js/features/sales-dashboard.js test/salesDashboardFeature.test.js
git commit -m "feat: classify sales review achievement progress"
```

### Task 2: 在明细渲染中应用状态

**Files:**
- Modify: `assets/js/features/sales-dashboard.js`
- Test: `test/salesDashboardFeature.test.js`

- [ ] **Step 1: 写入失败渲染测试**

在现有 `renderDashboard` 测试数据中添加：

```js
kpis: [{ title: "时间进度", value: "80%" }],
detailRows: [{
  budgetStoreName: "探嘉美国",
  msku: "MSKU-RED",
  quantityAchievement: 74,
}]
```

并断言：

```js
assert.match(detailTable.innerHTML, /<td class="msku-achievement-danger">74%<\/td>/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/salesDashboardFeature.test.js`

Expected: FAIL，因为明细渲染尚未读取时间进度或输出状态 class。

- [ ] **Step 3: 保存时间进度并渲染语义单元格**

在 `createSalesDashboardFeature` 的闭包状态中初始化 `let salesTimeProgress = null;`。新增：

```js
function dashboardTimeProgress(kpis = []) {
  const item = kpis.map(normalizeKpi).find((kpi) => kpi.title === "时间进度");
  const value = Number(String(item?.value || "").replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

function quantityAchievementCell(value) {
  const tone = getQuantityAchievementTone(value, salesTimeProgress);
  return `<td${tone ? ` class="${tone}"` : ""}>${formatActualMoney(value || 0)}%</td>`;
}
```

在 `renderDashboard(data)` 的表格渲染之前写入：

```js
salesTimeProgress = dashboardTimeProgress(data.kpis || []);
```

将数量达成率的现有 `<td>` 改为：

```js
${quantityAchievementCell(row.quantityAchievement)}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/salesDashboardFeature.test.js`

Expected: PASS，且输出红色状态 class。

- [ ] **Step 5: 提交渲染改动**

```bash
git add assets/js/features/sales-dashboard.js test/salesDashboardFeature.test.js
git commit -m "feat: highlight sales review achievement gaps"
```

### Task 3: 精简表头和状态视觉

**Files:**
- Modify: `index.html`
- Modify: `assets/css/pages/22-sales-dashboard.css`
- Test: `test/stylesStructure.test.js`

- [ ] **Step 1: 写入失败结构测试**

在销售复盘明细表结构测试中断言每个列键与新显示文本配对：

```js
assert.match(tableMatch[0], /data-column-key="refundRate30d"[\s\S]*?30d退款/);
assert.match(tableMatch[0], /data-column-key="adFeeRate"[\s\S]*?>广告</);
assert.match(tableMatch[0], /data-column-key="promotionDiscountRate"[\s\S]*?>折扣</);
assert.match(tableMatch[0], /data-column-key="storageFeeRate"[\s\S]*?>仓储</);
assert.match(tableMatch[0], /data-column-key="platformFeeRate"[\s\S]*?>平台</);
assert.match(tableMatch[0], /data-column-key="purchaseCostRate"[\s\S]*?>采购</);
assert.match(tableMatch[0], /data-column-key="firstLegCostRate"[\s\S]*?>头程</);
```

同时读取 `assets/css/pages/22-sales-dashboard.css` 并断言存在三个 class 和 token：

```js
assert.match(pageSource, /\.msku-achievement-warning[\s\S]*?var\(--tj-warning\)/);
assert.match(pageSource, /\.msku-achievement-danger[\s\S]*?var\(--tj-danger\)/);
assert.match(pageSource, /\.msku-achievement-info[\s\S]*?var\(--tj-action-blue\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/stylesStructure.test.js`

Expected: FAIL，因为旧表头和状态样式仍存在。

- [ ] **Step 3: 修改表头文本与页面级状态样式**

在 `index.html` 中只替换按钮可见文本：

```html
30d退款、广告、折扣、仓储、平台、采购、头程
```

在 `assets/css/pages/22-sales-dashboard.css` 添加：

```css
.msku-achievement-warning { color: var(--tj-warning); font-weight: 700; }
.msku-achievement-danger { color: var(--tj-danger); font-weight: 700; }
.msku-achievement-info { color: var(--tj-action-blue); font-weight: 700; }
```

- [ ] **Step 4: 生成 CSS 并运行结构测试**

Run: `npm run build:css && node --test test/stylesStructure.test.js`

Expected: PASS；只改动源 CSS 和生成后的 `styles.css`。

- [ ] **Step 5: 提交表头与样式**

```bash
git add index.html assets/css/pages/22-sales-dashboard.css styles.css test/stylesStructure.test.js
git commit -m "feat: simplify sales review metric headers"
```

### Task 4: 端到端回归验证

**Files:**
- Verify only: `assets/js/features/sales-dashboard.js`
- Verify only: `index.html`
- Verify only: `assets/css/pages/22-sales-dashboard.css`

- [ ] **Step 1: 运行目标测试和静态检查**

Run: `node --test test/salesDashboardFeature.test.js test/stylesStructure.test.js && npm run check`

Expected: 两个目标测试文件通过；`npm run check` 通过。

- [ ] **Step 2: 运行全量测试并记录基线差异**

Run: `npm test`

Expected: 销售复盘相关测试通过；若仍有已记录的工厂库存与路由安全基线失败，记录其原始失败信息，不修改无关模块。

- [ ] **Step 3: 浏览器验证销售复盘表格**

Run: 使用浏览器打开本地销售复盘页面，确认控制台无错误、精简表头存在，且在桌面和窄视口下横向滚动仍由表格容器承载。

- [ ] **Step 4: 最终工作树检查**

Run: `git diff --check && git status --short --branch`

Expected: 无空白错误；仅包含本计划列出的文件。


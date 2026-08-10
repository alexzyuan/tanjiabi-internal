# 销售复盘筛选栏时间进度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售复盘的日期与币种筛选控件之间显示当前筛选周期的只读时间进度，且所有文字始终留在方框内。

**Architecture:** `index.html` 声明一个稳定的只读状态元素；销售复盘功能模块从已经加载的 KPI 数据写入该元素；销售页面 CSS 以现有令牌定义固定尺寸、双行排版和截断保护。该改动不改变接口、查询参数或通用筛选器。

**Tech Stack:** 原生 HTML、ES modules、分层 CSS、Node 内置测试。

---

### Task 1: 筛选栏结构与数据更新

**Files:**
- Modify: `index.html:251-281`
- Modify: `assets/js/features/sales-dashboard.js:356-373`
- Test: `test/frontendStructure.test.js`
- Test: `test/salesDashboardFeature.test.js`

- [ ] **Step 1: 写出失败的结构与行为测试**

```js
assert.match(salesFiltersMarkup, /id="front-time-progress"/);
assert.ok(dateIndex < progressIndex && progressIndex < currencyIndex);
assert.equal(root.querySelector("#front-time-progress").textContent, "29.03%");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/frontendStructure.test.js test/salesDashboardFeature.test.js`

Expected: FAIL，原因是 `front-time-progress` 尚未声明或未更新。

- [ ] **Step 3: 最小实现结构与更新**

在日期 `label` 后、币种 `label` 前加入：

```html
<div class="sales-filter-time-progress" aria-label="当前筛选周期时间进度">
  <span>时间进度</span>
  <strong id="front-time-progress">-</strong>
</div>
```

在 `fillTables(data)` 内、读取 `data.kpis` 后调用已有 KPI 解析逻辑，并通过 `setText("#front-time-progress", progress === null ? "-" : `${formatActualMoney(progress)}%", root)` 更新。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/frontendStructure.test.js test/salesDashboardFeature.test.js`

Expected: PASS，且缺失时间进度显示 `-`。

### Task 2: 方框内文字与响应式样式

**Files:**
- Modify: `assets/css/pages/22-sales-dashboard.css:1-15`
- Modify: `styles.css`（仅通过构建生成）
- Test: `test/stylesStructure.test.js`

- [ ] **Step 1: 写出失败的 CSS 结构测试**

```js
assert.match(pageSource, /\.sales-filter-time-progress\s*\{/);
assert.match(pageSource, /overflow:\s*hidden/);
assert.match(pageSource, /white-space:\s*nowrap/);
assert.match(pageSource, /var\(--tj-action-blue\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/stylesStructure.test.js --test-name-pattern='sales filter time progress'`

Expected: FAIL，因为页面尚无该 CSS 块。

- [ ] **Step 3: 最小实现样式并生成 CSS**

在销售页样式层增加 `.sales-filter-time-progress`：高度与控件一致、`min-width` 与 `max-width` 都为 `142px`、`overflow: hidden`、`white-space: nowrap`、双行居中网格布局；标题和值使用行高与 `text-overflow: ellipsis`，只使用既有语义令牌。

Run: `npm run build:css`

- [ ] **Step 4: 运行 CSS 测试确认通过**

Run: `node --test test/stylesStructure.test.js --test-name-pattern='sales filter time progress'`

Expected: PASS。

### Task 3: 浏览器验证与提交

**Files:**
- Verify: `index.html`
- Verify: `assets/js/features/sales-dashboard.js`
- Verify: `assets/css/pages/22-sales-dashboard.css`

- [ ] **Step 1: 运行完整相关检查**

Run: `npm run check && node --test test/frontendStructure.test.js test/salesDashboardFeature.test.js test/stylesStructure.test.js`

Expected: exit 0。

- [ ] **Step 2: 浏览器验证桌面与窄屏**

Flow: 打开销售复盘 → 读取时间进度 → 检查日期、时间进度、币种顺序；在桌面和 390px 窄屏下，确认所有时间进度文字在边框内、筛选栏本身不产生页面级横向溢出，并检查控制台无相关错误。

- [ ] **Step 3: 提交功能改动**

```bash
git add index.html assets/js/features/sales-dashboard.js assets/css/pages/22-sales-dashboard.css styles.css test/frontendStructure.test.js test/salesDashboardFeature.test.js test/stylesStructure.test.js
git commit -m "feat: show sales review filter time progress"
```

# 滞销处置周报人民币列与币种筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将滞销处置周报拆为独立指标列，默认以人民币展示金额，并支持按店铺原币种筛选日常预警。

**Architecture:** 后端向领星订单利润接口请求 `CNY` 口径金额，在库存归一化层识别店铺原币种；服务层据此生成筛选选项并过滤。前端新增币种选择，并用一个单元格对应一个指标。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、node:test、领星 ERP 适配器。

## Global Constraints

- 人民币金额必须直接使用领星 `CNY` 口径；BI 不维护静态汇率。
- 原币种只用于筛选与原币处置情景；生产店铺无法识别币种时必须失败并记录上下文。
- 每个新增表格列必须有稳定 `data-column-key`，共享 `data-table-manager` 管理宽度。
- 仅编辑 `assets/css/*` 后运行 `npm run build:css`；禁止手写 `styles.css`。
- 不改变周二 09:00 调度、六个月留存、风险阈值与处置规则。

---

### Task 1: 人民币数据口径与店铺原币种

**Files:**
- Modify: `src/services/inventoryProvisionService.js`
- Modify: `src/services/slowMovingRiskService.js`
- Test: `test/inventoryProvisionService.test.js`
- Test: `test/slowMovingRiskService.test.js`

**Interfaces:**
- Consumes: 库存明细记录和 `fetchMskuOrderProfit({ startDate, endDate, sids, currencyCode })`。
- Produces: 标准库存行的 `currencyCode`；dashboard 的 CNY 金额、`currencyOptions` 与币种过滤。

- [ ] **Step 1: Write failing service tests**

```js
test("slow-moving dashboard requests CNY profit data and filters by store original currency", async () => {
  // USD/CAD inventory fixtures; assert CNY request, only USD row after filtering, and USD/CAD options.
});
test("inventory normalization derives a store original currency", () => {
  // Assert US => USD and CA => CAD if the row omits currency fields.
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/inventoryProvisionService.test.js test/slowMovingRiskService.test.js`

Expected: FAIL because no original-currency normalization/option exists and the profit request uses `ORIGINAL`.

- [ ] **Step 3: Implement minimal service behavior**

```js
// inventory row
currencyCode: readFirst(record, ["currency", "currency_code", "currencyCode"]) || sellerCurrencyCode(seller)
// order profit request
currencyCode: "CNY"
// dashboard filter/options
currencyOptions: unique currencyCode values; filters.currencyCode compares row.currencyCode
```

Known US/CA/AU markets resolve to USD/CAD/AUD. An unresolved production currency throws `error.source = "currency"` with SKU and store context.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/inventoryProvisionService.test.js test/slowMovingRiskService.test.js`

Expected: PASS with explicit USD/CAD fixtures and a `currencyCode: "CNY"` request.

- [ ] **Step 5: Commit Task 1**

Run: `git add src/services/inventoryProvisionService.js src/services/slowMovingRiskService.js test/inventoryProvisionService.test.js test/slowMovingRiskService.test.js && git commit -m "feat: add slow-moving risk currency filtering"`

### Task 2: 路由币种参数

**Files:**
- Modify: `routes/inventory.js`
- Test: `test/serverRoutesStructure.test.js`

**Interfaces:**
- Consumes: `?currencyCode=CAD`。
- Produces: `getSlowMovingRiskDashboard({ filters: { currencyCode: "CAD" } })`。

- [ ] **Step 1: Write a failing route test**

```js
test("slow-moving live route forwards currencyCode", async () => {
  // Invoke the live route with ?currencyCode=CAD and assert filters.currencyCode is CAD.
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: FAIL because the route does not forward `currencyCode`.

- [ ] **Step 3: Add the route field**

```js
currencyCode: url.searchParams.get("currencyCode") || "",
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run: `git add routes/inventory.js test/serverRoutesStructure.test.js && git commit -m "feat: forward slow-moving risk currency filter"`

### Task 3: 独立表格列与前端币种筛选

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/slow-moving-risk.js`
- Modify: `assets/css/pages/26-slow-moving-risk.css`
- Test: `test/slowMovingRiskFeature.test.js`
- Test: `test/frontendStructure.test.js`
- Test: `test/stylesStructure.test.js`

**Interfaces:**
- Consumes: `filters.currencyOptions` 与行级指标。
- Produces: `currencyCode` 查询，以及独立的店铺、站点、库存、金额、利润、广告、回收和原币种列。

- [ ] **Step 1: Write failing frontend tests**

```js
test("slow-moving live query includes selected currencyCode", async () => {
  // Select CAD and assert fetch URL contains currencyCode=CAD.
});
test("slow-moving table has one cell for each metric", () => {
  // Assert independently rendered stock, aged stock, gross profit, ad share, ACOS, clearance and liquidation values.
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/slowMovingRiskFeature.test.js test/frontendStructure.test.js test/stylesStructure.test.js`

Expected: FAIL because no currency control or standalone cells exist.

- [ ] **Step 3: Implement markup and rendering**

```html
<label>币种<select id="slow-moving-risk-currency-filter"><option value="">全部原币种</option></select></label>
<th data-column-key="store-name">店铺</th>
<th data-column-key="site-country">站点</th>
<!-- Every former slash metric receives an individual header and td. -->
```

```js
const currencyCode = query("#slow-moving-risk-currency-filter")?.value || "";
if (currencyCode) params.set("currencyCode", currencyCode);
setSelectOptions("#slow-moving-risk-currency-filter", filters.currencyOptions || [], "全部原币种");
```

Render CNY with `money()`, render 清仓/清算回收 with their original `currencyCode`, and render null ACOS as `不可用`.

- [ ] **Step 4: Build CSS and verify GREEN**

Run: `npm run build:css && node --test test/slowMovingRiskFeature.test.js test/frontendStructure.test.js test/stylesStructure.test.js`

Expected: PASS; generated CSS is current and page CSS contains no business-column widths.

- [ ] **Step 5: Commit Task 3**

Run: `git add index.html assets/js/features/slow-moving-risk.js assets/css/pages/26-slow-moving-risk.css styles.css test/slowMovingRiskFeature.test.js test/frontendStructure.test.js test/stylesStructure.test.js && git commit -m "feat: split slow-moving risk report columns"`

### Task 4: 集成验证

**Files:** Verify all Task 1–3 files only.

- [ ] **Step 1: Run full checks**

Run: `npm test && npm run check && git diff --check`

Expected: all tests pass and generated CSS is current.

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`

Verify USD/CAD filtering generates `currencyCode` requests, rows and columns remain readable on desktop and 390px screens, the document has no horizontal overflow, and only the table wrapper scrolls.

- [ ] **Step 3: Confirm clean final state**

Run: `git status --short`

Expected: empty output after Task 1–3 commits.

# 店铺经营月报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 在财务模块交付可筛选、可跨月累计、与预算目标联动的店铺经营月报，并以领星订单利润为实际值的唯一来源。

**Architecture:** 纯 mapper 将订单利润记录转换为严格的科目树；服务层先解析有效店铺与币种模式，再逐月拉取订单利润和预算并输出同一份页面/导出模型。财务路由只解析筛选、调用服务；独立前端 feature 拥有交互、URL 状态和渲染。

**Tech Stack:** Node.js 22 ESM、原生 HTML/CSS/JavaScript、Node \`node:test\`、既有 Lingxing Adapter、SheetJS \`xlsx\`。

## Global Constraints

- 实际值唯一来自领星 \`/basicOpen/finance/mreport/OrderProfit\`；禁止 mock、静默空列表、旧数据或其他科目补值。
- 领星日期参数必须使用 \`src/utils/lingxingDateRange.js\`；API 只接收用户可见结束月的最后一天，适配器只加一天一次。
- 开始月、结束月必填，开始不得晚于结束，范围最长 12 月；无效输入抛出明确错误，不能交换、截断或默认。
- 预算只读取 \`budgetTargetService\` 已解析行：销售收入净额/推广费用/退款金额/销售利润对应 \`salesTarget\`/\`adBudget\`/\`refundTarget\`/\`profitTarget\`；其余预算为 \`—\`。
- 多个有效国家统一人民币；一个有效国家按订单利润 API 返回的原币币种分组。缺币种、CNY 金额或领星汇率必须明确不可用。
- 只有 API 明确返回 0 才显示 0。缺失字段、预算不存在、汇率不存在或分母为 0 都显示不可用。
- 新业务状态、渲染器和事件绑定不得进入 \`app.js\`；\`app.js\`仅可导入、注入和初始化 feature。
- CSS 只编辑 \`assets/css/*\`，之后运行 \`npm run build:css\`；不得手改 \`styles.css\`，不得固定普通业务列宽或给页面加 \`min-width\`。
- 新 API 和入口均须 \`finance\` 权限，错误向前端返回可追溯原因。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| \`src/services/storeOperatingMonthlyReportMapper.js\` | 严格字段存在性、科目树、预算映射、占比、达成率。 |
| \`src/services/storeOperatingMonthlyReportService.js\` | 月份校验、店铺/国家过滤、订单利润拉取、预算累计、币种和日志元数据。 |
| \`src/adapters/lingxingAdapter.js\` | 在订单利润标准化记录保留币种、CNY 金额和领星汇率字段。 |
| \`src/services/budgetTargetService.js\` | 支持按月份、店铺、国家读取实时预算摘要。 |
| \`routes/finance-purchase.js\` | 月报 JSON 与 XLSX 导出、参数解析、财务授权。 |
| \`server.js\` | 仅把服务函数注入既有路由组合。 |
| \`assets/js/features/store-operating-monthly-report.js\` | 筛选、自动月份刷新、URL、预算深链、渲染、导出。 |
| \`index.html\` | 财务导航项、语义化视图、筛选和表格骨架。 |
| \`app.js\`、\`assets/js/features/breadcrumb-shell.js\`、\`assets/js/features/budget-targets.js\` | 仅 feature 装配、权限/导航加载、面包屑和预算页深链预设。 |
| \`assets/css/pages/56-store-operating-monthly-report.css\` | 月报独有布局，复用 semantic tokens 和共享表格。 |
| \`test/storeOperatingMonthlyReport*.test.js\` | mapper、服务、路由和前端 feature 的隔离测试。 |

### Task 1: 写订单利润科目 mapper

**Files:**
- Create: \`src/services/storeOperatingMonthlyReportMapper.js\`
- Create: \`test/storeOperatingMonthlyReportMapper.test.js\`

**Interfaces:**
- Consumes: 已标准化订单利润记录：\`totalSalesAmount\`、\`netSalesAmount\`、\`promotionDiscount\`、\`totalSalesRefunds\`、\`purchaseCost\`、\`firstLegCost\`、\`storageFee\`、\`totalAdsCost\`、\`platformFee\`、\`fbaDeliveryFee\`、\`grossProfit\`。
- Produces: \`buildStoreOperatingReportRows({ records, budgetByMetric, currencyCode }) -> { rows, unavailableMetrics }\`；row 为 \`{ key, category, name, level, actual, budget, share, achievement, available, children }\`。

- [ ] **Step 1: 写失败测试**

~~~js
import assert from "node:assert/strict";
import test from "node:test";
import { buildStoreOperatingReportRows } from "../src/services/storeOperatingMonthlyReportMapper.js";

test("missing order-profit fields stay unavailable rather than becoming zero", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, netSalesAmount: 90, totalSalesRefunds: 10, grossProfit: 20 }],
    budgetByMetric: { "net-sales": 120, "ad-spend": 18, refunds: 12, "sales-profit": 24 },
    currencyCode: "USD",
  });
  const advertising = result.rows.find((row) => row.key === "ad-spend");
  const netSales = result.rows.find((row) => row.key === "net-sales");
  assert.equal(advertising.actual, null);
  assert.equal(advertising.budget, 18);
  assert.equal(advertising.achievement, null);
  assert.equal(netSales.actual, 90);
  assert.equal(netSales.share, 1);
  assert.ok(result.unavailableMetrics.includes("ad-spend"));
});

test("only the four configured budget metrics receive a budget", () => {
  const result = buildStoreOperatingReportRows({
    records: [{ totalSalesAmount: 100, netSalesAmount: 80, totalAdsCost: 8, totalSalesRefunds: 4, grossProfit: 16 }],
    budgetByMetric: { "net-sales": 120, "ad-spend": 20, refunds: 6, "sales-profit": 24 },
    currencyCode: "CNY",
  });
  assert.equal(result.rows.find((row) => row.key === "net-sales").achievement, 80 / 120);
  assert.equal(result.rows.find((row) => row.key === "ad-spend").budget, 20);
  assert.equal(result.rows.find((row) => row.key === "platform-fee").budget, null);
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/storeOperatingMonthlyReportMapper.test.js\`
Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小 mapper**

~~~js
const METRICS = [
  ["sales-income", "销售收入", "totalSalesAmount"],
  ["sales-discount", "销售折扣", "promotionDiscount"],
  ["refunds", "退款金额", "totalSalesRefunds"],
  ["net-sales", "销售收入净额", "netSalesAmount"],
  ["purchase-cost", "商品采购成本", "purchaseCost"],
  ["first-leg-cost", "头程费用", "firstLegCost"],
  ["storage-fee", "平台仓储费用", "storageFee"],
  ["ad-spend", "推广费用", "totalAdsCost"],
  ["platform-fee", "平台费用", "platformFee"],
  ["fba-delivery-fee", "FBA 配送费", "fbaDeliveryFee"],
  ["sales-profit", "销售利润", "grossProfit"],
];

function sumPresent(records, field) {
  const values = records.map((row) => row[field]).filter((value) => value !== "" && value !== null && value !== undefined);
  return values.length === records.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}
~~~

Implement the confirmed category tree from this canonical list. A derived parent may only sum child values when every required child is present; otherwise its actual is \`null\`. Use \`null\`, never \`Number(value || 0)\`, for missing source data.

- [ ] **Step 4: 运行 mapper 测试**

Run: \`node --test test/storeOperatingMonthlyReportMapper.test.js\`
Expected: PASS；补充销售收入净额为 0、预算为 0、关键结果行和分类层级断言。

- [ ] **Step 5: 提交**

~~~bash
git add src/services/storeOperatingMonthlyReportMapper.js test/storeOperatingMonthlyReportMapper.test.js
git commit -m "feat: map store operating monthly report metrics"
~~~

### Task 2: 扩展订单利润元数据与预算范围读取

**Files:**
- Modify: \`src/adapters/lingxingAdapter.js: normalizeMskuOrderProfitRecords\`
- Modify: \`src/services/budgetTargetService.js: getBudgetTargetContext\`
- Modify: \`test/lingxingAdapter.test.js\`
- Modify: \`test/budgetTargetService.test.js\`

**Interfaces:**
- Produces: 标准化记录的 \`currencyCode\`、\`cnyAmount\`、\`exchangeRate\`；\`getBudgetTargetContext({ months, storeNames, countries })\` 的最新匹配记录和 totals。

- [ ] **Step 1: 写失败测试**

~~~js
test("normalized order profit keeps currency and Lingxing rate metadata", () => {
  const adapter = new LingxingAdapter(testConfig);
  const [row] = adapter.normalizeMskuOrderProfitRecords([{
    sid: 1, amount: 10, net_amount: 9, currency_code: "USD", amount_cny: 72, exchange_rate: 7.2,
  }], [{ sid: 1, name: "Amazon-US", country: "美国" }]);
  assert.equal(row.currencyCode, "USD");
  assert.equal(row.cnyAmount, 72);
  assert.equal(row.exchangeRate, 7.2);
});

test("budget context sums exact store-country rows for all requested months", async () => {
  await withTempService(async ({ saveBudgetUpload, getBudgetTargetContext }) => {
    await saveBudgetUpload(uploadPayload({ budgetMonth: "2026-06", salesAmount: 100 }));
    await saveBudgetUpload(uploadPayload({ budgetMonth: "2026-07", salesAmount: 200 }));
    const value = await getBudgetTargetContext({
      months: ["2026-06", "2026-07"], storeNames: ["探嘉美国"], countries: ["美国"],
    });
    assert.equal(value.totals.salesTarget, 300);
  });
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/lingxingAdapter.test.js test/budgetTargetService.test.js\`
Expected: FAIL，三个元数据字段和多月过滤尚未支持。

- [ ] **Step 3: 实现严格字段和范围过滤**

~~~js
// normalizeMskuOrderProfitRecords 的返回对象中
currencyCode: readFirst(record, ["currency_code", "currencyCode", "currency"]),
cnyAmount: readFirst(record, ["amount_cny", "cny_amount", "total_amount_cny"]),
exchangeRate: readFirst(record, ["exchange_rate", "exchangeRate", "rate_to_cny"]),
~~~

~~~js
export async function getBudgetTargetContext({ months = [], storeNames = [], countries = [] } = {}) {
  const targets = await listBudgetTargets();
  const monthSet = new Set(months.map(normalizeBudgetMonth).filter(Boolean));
  const storeSet = new Set(storeNames.map(normalizeText).filter(Boolean));
  const countrySet = new Set(countries.map(normalizeText).filter(Boolean));
  const rows = targets.rows.filter((row) =>
    (!monthSet.size || monthSet.has(normalizeBudgetMonth(row.month)))
    && (!storeSet.size || storeSet.has(normalizeText(row.storeName)))
    && (!countrySet.size || countrySet.has(normalizeText(row.site))),
  );
  return { months: [...monthSet], rows, totals: summarizeBudgetTargetRows(rows), matched: rows.length > 0 };
}
~~~

Preserve existing callers by accepting their former single-month range input and translating it into \`months\` before applying this exact filter. Do not cache \`listBudgetTargets()\` results.

- [ ] **Step 4: 运行测试**

Run: \`node --test test/lingxingAdapter.test.js test/budgetTargetService.test.js\`
Expected: PASS；追加“同月预算被上传替换后再次读取返回新 totals”的断言。

- [ ] **Step 5: 提交**

~~~bash
git add src/adapters/lingxingAdapter.js src/services/budgetTargetService.js test/lingxingAdapter.test.js test/budgetTargetService.test.js
git commit -m "feat: expose report currencies and budget ranges"
~~~

### Task 3: 构建跨月月报服务

**Files:**
- Create: \`src/services/storeOperatingMonthlyReportService.js\`
- Create: \`test/storeOperatingMonthlyReportService.test.js\`
- Modify: \`src/services/storeOperatingMonthlyReportMapper.js\`

**Interfaces:**
- Consumes: \`getStoreOperatingMonthlyReport(filters, { adapter, getBudgetTargetContext, now })\`。
- Produces: \`{ ok, meta, filters, rows, groups, budgetStatus }\`；meta 含 \`currencyMode\`、\`currencyCodes\`、\`recordCount\`、\`budgetMatchCount\`、\`unavailableMetrics\`、\`missingExchangeRateCount\`、\`generatedAt\`。

- [ ] **Step 1: 写失败测试**

~~~js
import { getStoreOperatingMonthlyReport, normalizeStoreOperatingMonthlyReportFilters } from "../src/services/storeOperatingMonthlyReportService.js";

test("service rejects a 13-month range without changing either boundary", () => {
  assert.throws(
    () => normalizeStoreOperatingMonthlyReportFilters({ startMonth: "2025-01", endMonth: "2026-01" }),
    /最多 12 个月/,
  );
});

test("service sums each requested month and uses CNY for multiple effective countries", async () => {
  const calls = [];
  const value = await getStoreOperatingMonthlyReport({ startMonth: "2026-06", endMonth: "2026-07" }, {
    adapter: fakeAdapter({ countries: ["美国", "加拿大"], calls }),
    getBudgetTargetContext: async () => ({ rows: budgetRows, totals: { salesTarget: 300 }, matched: true }),
  });
  assert.equal(value.meta.currencyMode, "CNY");
  assert.deepEqual(calls.map((call) => call.currencyCode), ["CNY", "CNY"]);
  assert.equal(value.rows.find((row) => row.key === "net-sales").actual, 180);
});

test("single-country result separates original API currencies", async () => {
  const value = await getStoreOperatingMonthlyReport({ startMonth: "2026-07", endMonth: "2026-07", countries: ["美国"] }, {
    adapter: fakeAdapter({ countries: ["美国"], currencies: ["USD", "CAD"] }),
    getBudgetTargetContext: async () => ({ rows: budgetRows, totals: {}, matched: true }),
  });
  assert.equal(value.meta.currencyMode, "ORIGINAL");
  assert.deepEqual(value.groups.map((group) => group.currencyCode), ["CAD", "USD"]);
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/storeOperatingMonthlyReportService.test.js\`
Expected: FAIL，服务模块尚不存在。

- [ ] **Step 3: 实现验证、数据读取和币种分支**

~~~js
export function normalizeStoreOperatingMonthlyReportFilters({ startMonth, endMonth, stores = [], countries = [] } = {}) {
  if (!/^\d{4}-\d{2}$/.test(startMonth || "") || !/^\d{4}-\d{2}$/.test(endMonth || "")) {
    throw new Error("请选择开始月份和结束月份");
  }
  const months = listInclusiveMonths(startMonth, endMonth);
  if (!months.length || months.length > 12) throw new Error("统计范围最多 12 个月");
  return { startMonth, endMonth, months, stores: uniqueText(stores), countries: uniqueText(countries) };
}
~~~

~~~js
const sellers = filterSellers(await adapter.fetchSellers(), filters);
const currencyMode = new Set(sellers.map((seller) => seller.country)).size > 1 ? "CNY" : "ORIGINAL";
const recordsByMonth = await Promise.all(filters.months.map(async (month) => {
  const { startDate, endDate } = monthBounds(month);
  const payload = await adapter.fetchMskuOrderProfit({
    startDate, endDate, sids: sellers.map((seller) => seller.sid),
    currencyCode: currencyMode === "CNY" ? "CNY" : "ORIGINAL",
  });
  return adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(payload), sellers, endDate);
}));
const budget = await getBudgetTargetContext({
  months: filters.months, storeNames: sellers.map((seller) => seller.name), countries: [...new Set(sellers.map((seller) => seller.country))],
});
~~~

\`monthBounds\` passes the display month's last calendar day to the adapter; the existing adapter applies \`withLingxingExclusiveEndDate\` once. In original mode, group only by API \`currencyCode\`; a blank value is an explicit unavailable group. In CNY mode, use CNY source fields; convert an applicable budget row only with its matching Lingxing rate. Missing rate means that budget is \`null\` and increments \`missingExchangeRateCount\`, never a guessed conversion. Log request ID, range, counts, mode, unmapped metrics, missing rates and elapsed time without order payloads.

- [ ] **Step 4: 运行服务测试**

Run: \`node --test test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportService.test.js\`
Expected: PASS；补充 1/12/13 月、空筛选全量、空匹配、预算未配置、分母为零、汇率缺失和上游错误传播案例。

- [ ] **Step 5: 提交**

~~~bash
git add src/services/storeOperatingMonthlyReportMapper.js src/services/storeOperatingMonthlyReportService.js test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportService.test.js
git commit -m "feat: aggregate store operating monthly reports"
~~~

### Task 4: 接入财务 JSON 与导出 API

**Files:**
- Modify: \`routes/finance-purchase.js\`
- Modify: \`server.js\`
- Create: \`test/storeOperatingMonthlyReportRoutes.test.js\`
- Modify: \`test/serverRoutesStructure.test.js\`

**Interfaces:**
- Consumes: \`GET /api/finance/store-operating-monthly-report?startMonth&endMonth&stores&countries\`。
- Produces: 同一筛选的 JSON；\`GET /api/finance/store-operating-monthly-report/export\` 返回服务生成的 XLSX。

- [ ] **Step 1: 写失败测试**

~~~js
test("monthly report route is finance-protected and forwards repeated filter values", async () => {
  let payload;
  const route = createFinancePurchaseRoutes({
    sendJson: (_res, _status, value) => { payload = value; },
    getStoreOperatingMonthlyReport: async (filters) => ({ ok: true, filters }),
  }).find((item) => item.path === "/api/finance/store-operating-monthly-report");

  assert.equal(route.auth, "finance");
  await route.handler({
    res: {},
    url: new URL("http://localhost/api/finance/store-operating-monthly-report?startMonth=2026-06&endMonth=2026-07&stores=A&stores=B&countries=%E7%BE%8E%E5%9B%BD"),
  });
  assert.deepEqual(payload.filters, { startMonth: "2026-06", endMonth: "2026-07", stores: ["A", "B"], countries: ["美国"] });
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js\`
Expected: FAIL，路由不存在。

- [ ] **Step 3: 实现参数解析、路由和同源导出**

~~~js
const monthlyReportFilters = (url) => ({
  startMonth: url.searchParams.get("startMonth") || "",
  endMonth: url.searchParams.get("endMonth") || "",
  stores: url.searchParams.getAll("stores").filter(Boolean),
  countries: url.searchParams.getAll("countries").filter(Boolean),
});

{
  method: "GET",
  path: "/api/finance/store-operating-monthly-report",
  auth: "finance",
  errorStatusCode: 502,
  handler: async ({ res, url }) => sendJson(res, 200, await getStoreOperatingMonthlyReport(monthlyReportFilters(url))),
}
~~~

Add a neighboring finance export route. It calls \`exportStoreOperatingMonthlyReportXlsx(monthlyReportFilters(url))\`, writes only its returned buffer with the XLSX content type, \`contentDispositionAttachment(result.filename)\`, and \`cache-control: no-store\`. Do not accept numbers, currency modes or report rows from the client. Inject both functions in the existing \`buildApiRoutes\` call.

- [ ] **Step 4: 运行路由测试**

Run: \`node --test test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js\`
Expected: PASS；结构测试断言两条路由均为 \`finance\`。

- [ ] **Step 5: 提交**

~~~bash
git add routes/finance-purchase.js server.js test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js
git commit -m "feat: expose store operating monthly report api"
~~~

### Task 5: 构建财务视图与独立前端 feature

**Files:**
- Create: \`assets/js/features/store-operating-monthly-report.js\`
- Modify: \`index.html\`
- Modify: \`app.js\`
- Modify: \`assets/js/features/breadcrumb-shell.js\`
- Modify: \`assets/js/features/budget-targets.js\`
- Create: \`test/storeOperatingMonthlyReportFeature.test.js\`
- Modify: \`test/frontendStructure.test.js\`

**Interfaces:**
- Produces: \`createStoreOperatingMonthlyReportFeature(deps)\`，返回 \`setupStoreOperatingMonthlyReport\`、\`loadStoreOperatingMonthlyReport\`、\`initializeStoreOperatingMonthlyReportDefaults\`。

- [ ] **Step 1: 写失败测试**

~~~js
test("valid month edits auto-refresh and invalid 13-month edits do not request", async () => {
  const { feature, requests, elements } = makeFeatureHarness({
    startMonth: "2026-06", endMonth: "2026-07", stores: ["A"], countries: ["美国"],
  });
  await feature.loadStoreOperatingMonthlyReport();
  assert.match(requests[0], /startMonth=2026-06/);
  assert.match(requests[0], /stores=A/);
  elements["#store-operating-report-end-month"].value = "2027-07";
  await feature.handleMonthChange();
  assert.match(elements["#store-operating-report-status"].textContent, /最多 12 个月/);
  assert.equal(requests.length, 1);
});

test("budget action carries the active scope to the budget view", () => {
  const { feature, location } = makeFeatureHarness({
    startMonth: "2026-06", endMonth: "2026-07", stores: ["A"], countries: ["美国"],
  });
  feature.openBudgetTargets();
  assert.match(location.search, /view=budget/);
  assert.match(location.search, /budgetMonths=2026-06%2C2026-07/);
  assert.match(location.search, /budgetStores=A/);
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/storeOperatingMonthlyReportFeature.test.js\`
Expected: FAIL，feature 模块尚不存在。

- [ ] **Step 3: 增加 HTML、feature 与装配**

~~~html
<button class="nav-item" data-view="store-operating-monthly-report">
  <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg></span>
  <span class="nav-label">店铺经营月报</span>
</button>

<section class="view" id="view-store-operating-monthly-report">
  <section class="module-hero"><div><span>财务</span><h2>店铺经营月报</h2><p id="store-operating-report-meta">等待读取经营数据。</p></div><div class="hero-actions"><button id="store-operating-report-export" type="button">导出 Excel</button><button id="store-operating-report-budget" type="button">查看预算目标</button></div></section>
  <section class="filters" aria-label="店铺经营月报筛选">
    <label>开始月份<input id="store-operating-report-start-month" type="month" /></label>
    <label>结束月份<input id="store-operating-report-end-month" type="month" /></label>
    <label>店铺<select id="store-operating-report-store" multiple></select></label>
    <label>国家<select id="store-operating-report-country" multiple></select></label>
    <button id="store-operating-report-query" type="button">查询</button>
    <button id="store-operating-report-reset" type="button">重置</button>
  </section>
  <article class="panel"><p id="store-operating-report-status" role="status" aria-live="polite"></p><div class="table-wrap store-operating-report-table-wrap"><table class="data-table" data-table-key="store-operating-monthly-report"><thead id="store-operating-report-head"></thead><tbody id="store-operating-report-body"></tbody></table></div></article>
</section>
~~~

~~~js
function handleMonthChange() {
  const filters = readFilters();
  const validation = validateMonthRange(filters.startMonth, filters.endMonth);
  if (!validation.ok) return setText("#store-operating-report-status", validation.error, root);
  return loadStoreOperatingMonthlyReport();
}

function openBudgetTargets() {
  const query = new URLSearchParams({ view: "budget", budgetMonths: listInclusiveMonths(readFilters().startMonth, readFilters().endMonth).join(",") });
  readFilters().stores.forEach((value) => query.append("budgetStores", value));
  readFilters().countries.forEach((value) => query.append("budgetCountries", value));
  history.replaceState({}, "", location.pathname + "?" + query);
  clickVisibleNavItem("budget");
}
~~~

Use existing multi-select controls. Date change auto-refreshes only when valid; country/store changes update options but query only on “查询”. Add an app import and dependency injection, initialization, navigation load branch, finance authorization condition and breadcrumb entry. The budget feature reads \`budgetMonths\`, \`budgetStores\`, \`budgetCountries\` from \`location.search\` before loading, then normal user controls remain authoritative. After dynamic header rendering, invoke the shared data table manager refresh hook; do not add custom sort/width rules.

- [ ] **Step 4: 运行前端测试**

Run: \`node --test test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js\`
Expected: PASS；追加断言财务导航、面包屑、过滤 URL、预算深链和无效日期不请求。

- [ ] **Step 5: 提交**

~~~bash
git add index.html app.js assets/js/features/store-operating-monthly-report.js assets/js/features/breadcrumb-shell.js assets/js/features/budget-targets.js test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js
git commit -m "feat: add store operating monthly report view"
~~~

### Task 6: 页面样式、完整验证与文档收尾

**Files:**
- Create: \`assets/css/pages/56-store-operating-monthly-report.css\`
- Modify: \`styles.css\`（仅通过构建生成）
- Modify: \`AGENTS.md\`（仅当最终模块/数据源方向与现有活文档不同）

- [ ] **Step 1: 写失败结构测试**

~~~js
test("monthly report delegates business column width and sorting to shared table tooling", async () => {
  const feature = await readFile(new URL("../assets/js/features/store-operating-monthly-report.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../assets/css/pages/56-store-operating-monthly-report.css", import.meta.url), "utf8");
  assert.match(feature, /data-table-key="store-operating-monthly-report"/);
  assert.equal(/(?:th|td):nth-child\([^)]*\)\s*\{[^}]*\b(?:width|min-width)\s*:/.test(css), false);
  assert.equal(/\.store-operating[^,{]*\{[^}]*min-width\s*:/.test(css), false);
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: \`node --test test/frontendStructure.test.js\`
Expected: FAIL，页面 CSS 源文件不存在。

- [ ] **Step 3: 添加 token 驱动的样式并生成 CSS**

~~~css
#view-store-operating-monthly-report .store-operating-report-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

#view-store-operating-monthly-report .store-operating-report-key-row > * {
  background: var(--tj-warning-soft);
  color: var(--tj-text-strong);
  font-weight: 700;
}

#view-store-operating-monthly-report .store-operating-report-status {
  color: var(--tj-text-muted);
  font-size: 12px;
  line-height: 1.45;
}
~~~

Use an existing semantic highlight token; if absent, add one reusable token in \`assets/css/tokens/00-semantic-foundation.css\` and record it in \`design.md\`. Do not add gradients, literals or fixed business widths. Run \`npm run build:css\`.

- [ ] **Step 4: 执行 automated 和浏览器验证**

Run: \`npm run check && npm test\`
Expected: PASS。

Use a local server and browser verification at desktop and narrow widths. Confirm all of the following: finance user can enter/API works while non-finance is denied; valid month change automatically issues correct query; 13-month range issues none; mouse and keyboard operate multi-selects; single-country original groups and multi-country CNY labels match response; budget deep link preserves months/stores/countries; export metadata matches page; no console errors, text collision or shell-level horizontal overflow.

- [ ] **Step 5: 提交最终视觉与文档**

~~~bash
git add assets/css/pages/56-store-operating-monthly-report.css styles.css test/frontendStructure.test.js
git add AGENTS.md  # only when Task 6 changed the living documentation
git commit -m "style: polish store operating monthly report"
~~~

Run \`git status --short\` before completion and report unrelated existing changes without changing them.

## Plan Self-Review

- **Spec coverage:** Tasks 1–3 cover strict actual values, the four budgets, cross-month totals, CNY/original mode and observable missing states. Task 4 adds finance APIs and export. Task 5 adds all confirmed UI, automatic month refresh, filtering and budget linkage. Task 6 enforces CSS, tests and browser evidence.
- **Placeholder scan:** Every task names exact files, interfaces, a red test, green implementation direction, run command and commit.
- **Type consistency:** All public layers use \`startMonth\`, \`endMonth\`, \`stores\`, \`countries\`; the service is \`getStoreOperatingMonthlyReport\`; the feature is \`createStoreOperatingMonthlyReportFeature\`; the APIs use \`/api/finance/store-operating-monthly-report\`.

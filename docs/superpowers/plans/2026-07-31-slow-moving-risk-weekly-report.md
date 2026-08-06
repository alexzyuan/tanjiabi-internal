# 滞销处置周报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy clearance calculator with a cash-flow-first FBA slow-moving-risk page that produces an immutable weekly report every Tuesday at 09:00 Asia/Shanghai and retains six months of reports.

**Architecture:** `slowMovingRiskService` is the single owner of risk-policy calculations and live Lingxing composition. `slowMovingRiskSnapshotStore` persists immutable successful reports, while `slowMovingRiskWeeklyJob` owns date-window selection, idempotency and scheduler state. The new front-end feature renders the three tabs and consumes only the inventory routes; `app.js` only composes it.

**Tech Stack:** Node.js ESM, native HTML/CSS/JavaScript, Node test runner, existing Lingxing adapter, atomic JSON store, existing job lock, generated CSS source layers.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/services/inventoryProvisionService.js` | Export a narrowly named FBA inventory-detail loader that preserves existing inventory normalization and can be used by the new service. Remove legacy clearance-only helpers after the new service no longer depends on them. |
| `src/services/slowMovingRiskService.js` | Policy constants, date window, row aggregation, thresholds, recovery scenarios, filters, KPI aggregation, Lingxing live-data composition and observability summary. |
| `src/services/slowMovingRiskSnapshotStore.js` | Atomic snapshot list/read/write and six-month cleanup. |
| `src/jobs/slowMovingRiskWeeklyJob.js` | Tuesday 09:00 Shanghai scheduler, report-key idempotency and failure-state persistence. |
| `routes/inventory.js` | Live dashboard and report-list/report-detail routes; remove `/api/dashboard/clearance-inventory`. |
| `server.js` | Compose the new service functions into routes and start exactly one weekly scheduler. |
| `assets/js/features/slow-moving-risk.js` | Tab state, filter state, fetches, semantic table rendering, loading/error UI and keyboard interactions. |
| `index.html` | Replace the `view-clearance` markup with the three-tab slow-moving-risk view. |
| `assets/css/pages/26-slow-moving-risk.css` | Feature-specific styles using existing semantic tokens and the shared table/filter patterns. |
| `app.js` | Replace the legacy feature import/composition/view loader with the new feature only. |
| `package.json` | Replace legacy clearance source in JS checks with the new feature/service/job files. |
| `test/slowMovingRiskService.test.js` | Pure policy, aggregation, filters and live-data-source failure tests. |
| `test/slowMovingRiskSnapshotStore.test.js` | Snapshot persistence, immutable reads and retention tests. |
| `test/slowMovingRiskWeeklyJob.test.js` | Shanghai schedule, report-key and duplicate-run tests. |
| `test/slowMovingRiskFeature.test.js` | Feature DOM rendering, request and keyboard-tab tests. |
| `test/serverRoutesStructure.test.js`, `test/frontendStructure.test.js`, `test/stylesStructure.test.js` | Update structural expectations from legacy clearance to slow-moving risk. |

Do not modify unrelated sales dashboards, product pulse, advertising review, aftersales, FBA logistics, generated `styles.css`, or `design.md` unless a reusable visual token is genuinely absent.

### Task 1: Establish the risk-policy contract as pure tested functions

**Files:**
- Create: `test/slowMovingRiskService.test.js`
- Create: `src/services/slowMovingRiskService.js`

- [ ] **Step 1: Write a failing policy test with one high-risk, negative-margin row**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlowMovingRiskRow,
  completedWeeklyRange,
  RISK_PARAMETERS,
} from "../src/services/slowMovingRiskService.js";

test("buildSlowMovingRiskRow marks a 90-day slow negative-margin SKU as high risk and ad waste", () => {
  const row = buildSlowMovingRiskRow({
    sid: 11500,
    storeName: "tandanbo-US",
    country: "US",
    msku: "MD-DINOBATH",
    availableQuantity: 646,
    inventoryAmount: 14728.8,
    age91To180Quantity: 623,
    age91To180Amount: 14204.4,
    age181PlusQuantity: 0,
    historicalDaysOfSupply: 240,
    estimatedStorageCostNextMonth: 93.17,
    recent30SalesQuantity: 59,
    recent30SalesAmount: 7229.16,
    recent30GrossProfit: -4709.9,
    recent30AdSpend: 1680.25,
    recent30AdSales: 3308.26,
    currencyCode: "USD",
  }, RISK_PARAMETERS);

  assert.equal(row.riskLevel, "高风险");
  assert.equal(row.cashConversionRate, 0.0837);
  assert.equal(row.averageGrossProfit, -79.8288);
  assert.equal(row.adWaste, true);
  assert.equal(row.clearanceRecoveryOriginal, 6167.7);
  assert.equal(row.liquidationRecoveryOriginal, 623);
  assert.equal(row.removalFeeStatus, "unavailable");
});

test("completedWeeklyRange ends on the Sunday before the Tuesday report run", () => {
  assert.deepEqual(completedWeeklyRange(new Date("2026-08-04T01:00:00.000Z")), {
    startDate: "2026-07-04",
    endDate: "2026-08-02",
    reportKey: "2026-08-02",
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the service does not exist**

Run: `node --test test/slowMovingRiskService.test.js`  
Expected: `ERR_MODULE_NOT_FOUND` for `src/services/slowMovingRiskService.js`.

- [ ] **Step 3: Implement the policy-only service exports**

Implement the following contract without networking in the named functions. Round all user-visible monetary and rate values through one local `round(value, digits)` helper; retain `null` for unavailable ratios.

```js
export const RISK_PARAMETERS = Object.freeze({
  annualCapitalCostRate: 0.12,
  clearanceUnitPriceOriginal: 9.9,
  liquidationUnitPriceOriginal: 1,
  adShareThreshold: 0.15,
  reportRetentionMonths: 6,
});

export function completedWeeklyRange(now = new Date()) {
  const clock = shanghaiClock(now);
  const endDate = previousSunday(clock.date);
  return { startDate: addDaysText(endDate, -29), endDate, reportKey: endDate };
}

export function classifyRisk({ agedQuantity = 0, age181PlusQuantity = 0, historicalDaysOfSupply = 0, cashConversionRate = 0, recent30GrossProfit = 0 } = {}) {
  if (agedQuantity > 0 && (age181PlusQuantity > 0 || historicalDaysOfSupply > 180) && cashConversionRate < 0.1 && recent30GrossProfit <= 0) return "强制处置";
  if (agedQuantity > 0 && historicalDaysOfSupply > 120 && cashConversionRate < 0.15) return "高风险";
  if (agedQuantity > 0 && historicalDaysOfSupply > 90 && cashConversionRate < 0.2) return "关注";
  return "正常";
}
```

`buildSlowMovingRiskRow` must implement these exact formulas:

```js
const agedQuantity = age91To180Quantity + age181PlusQuantity;
const cashConversionRate = recent30SalesQuantity / (recent30SalesQuantity + availableQuantity);
const averageGrossProfit = recent30SalesQuantity > 0
  ? recent30GrossProfit / recent30SalesQuantity
  : null;
const adShare = recent30SalesAmount > 0 ? recent30AdSpend / recent30SalesAmount : null;
const adWaste = recent30GrossProfit < 0 && recent30AdSpend > 0
  && (recent30SalesAmount === 0 || adShare >= parameters.adShareThreshold);
const capitalCostThreeMonths = agedInventoryAmount * parameters.annualCapitalCostRate / 4;
const cashRiskAmount = agedInventoryAmount
  + estimatedStorageCostNextMonth * 3
  + capitalCostThreeMonths
  + Math.max(0, -recent30GrossProfit);
```

For removal fees, return `{ removalFeeStatus: "unavailable", removalFeeReason: "缺少尺寸/重量，无法计算", removalFeeOriginal: null }` unless marketplace, size tier, shipping weight and an explicit fee resolver are present. Never introduce a fixed removal fee.

- [ ] **Step 4: Extend the failing test with boundary cases and make them pass**

Add tests that assert all of the following:

```js
assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 1, historicalDaysOfSupply: 181, cashConversionRate: 0.09, recent30GrossProfit: 0 }), "强制处置");
assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 0, historicalDaysOfSupply: 121, cashConversionRate: 0.149, recent30GrossProfit: 1 }), "高风险");
assert.equal(classifyRisk({ agedQuantity: 1, age181PlusQuantity: 0, historicalDaysOfSupply: 91, cashConversionRate: 0.199, recent30GrossProfit: 1 }), "关注");
assert.equal(buildSlowMovingRiskRow({ availableQuantity: 7, recent30SalesQuantity: 0, recent30SalesAmount: 0, recent30AdSpend: 8, recent30GrossProfit: -2 }).adWaste, true);
assert.equal(buildSlowMovingRiskRow({ availableQuantity: 7, recent30SalesQuantity: 0, recent30SalesAmount: 0, recent30AdSpend: 0, recent30GrossProfit: -2 }).averageGrossProfit, null);
```

Run: `node --test test/slowMovingRiskService.test.js`  
Expected: all tests pass.

- [ ] **Step 5: Commit the policy contract**

```bash
git add src/services/slowMovingRiskService.js test/slowMovingRiskService.test.js
git commit -m "feat: add slow-moving risk policy"
```

### Task 2: Compose real FBA inventory and 30-day order-profit data into the live dashboard

**Files:**
- Modify: `src/services/inventoryProvisionService.js`
- Modify: `src/services/slowMovingRiskService.js`
- Modify: `test/slowMovingRiskService.test.js`

- [ ] **Step 1: Write a failing dependency-injected live-composition test**

```js
test("getSlowMovingRiskDashboard aggregates FBA age buckets and order-profit advertising fields", async () => {
  const dashboard = await createSlowMovingRiskService({
    loadInventoryRows: async () => [{
      sid: 11500, storeName: "tandanbo-US", country: "US", msku: "MD-DINOBATH",
      quantity: 623, ageDays: 120, totalInventory: 646, unitCost: 22.8,
      estimatedStorageCostAllocation: 93.17,
    }],
    loadSellers: async () => [{ sid: 11500, name: "tandanbo-US", country: "US" }],
    fetchOrderProfit: async () => [{
      sid: 11500, msku: "MD-DINOBATH", volume: 59, amount: 7229.16,
      gross_profit: -4709.9, spend: 1680.25, ad_sales_amount: 3308.26,
    }],
    normalizeOrderProfit: (rows) => rows,
  }).getDashboard({ dateRange: { startDate: "2026-07-04", endDate: "2026-08-02" } });

  assert.equal(dashboard.rows.length, 1);
  assert.equal(dashboard.rows[0].recent30AdSpend, 1680.25);
  assert.equal(dashboard.rows[0].riskLevel, "高风险");
  assert.equal(dashboard.meta.dataSources.orderProfit.status, "success");
});
```

- [ ] **Step 2: Run the test and verify it fails because `createSlowMovingRiskService` is not exported**

Run: `node --test test/slowMovingRiskService.test.js`  
Expected: `SyntaxError` or assertion failure identifying the missing export.

- [ ] **Step 3: Export one generic inventory loader from the inventory-provision service**

Refactor the existing `loadInventoryRowsFromLingxing` implementation into this exported function without changing the inventory-provision dashboard output:

```js
export async function loadFbaInventoryDetailRows({
  adapter = getLingxingAdapter(),
  getSellers = getSharedSellers,
  sellersOverride = null,
} = {}) {
  const sellers = sellersOverride?.length
    ? filterCoreSellers(sellersOverride)
    : filterCoreSellers((await getSellers({ adapter })).sellers || []);
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const records = await adapter.fetchAllFbaInventoryDetails(sids);
  return { rows: normalizeLingxingInventoryRows(records, sellers), sellers, rawCount: records.length };
}
```

Keep the existing private `loadInventoryRowsFromLingxing` as a delegating call until all existing inventory-provision callers continue to pass; do not change its return shape.

- [ ] **Step 4: Implement `createSlowMovingRiskService` and fail fast on core source failure**

Use injected dependencies in tests and defaults in production. Group inventory by `sid + msku + fnsku`; sum 91–180 and 181+ quantities separately, allocate inventory amount from `quantity × unitCost`, and use the inventory record’s current availability, days of supply and estimated next-month storage fee. Fetch one 30-day `fetchMskuOrderProfit` request with the selected SIDs and `currencyCode: "ORIGINAL"`, then sum `volume`, `amount`, `gross_profit`, `spend` and `ad_sales_amount` by `sid + msku`.

```js
export function createSlowMovingRiskService({
  loadInventoryRows = loadFbaInventoryDetailRows,
  loadSellers = getSharedSellers,
  adapter = getLingxingAdapter(),
  fetchOrderProfit = (filters) => adapter.fetchMskuOrderProfit(filters),
  normalizeOrderProfit = (rows, sellers) => adapter.normalizeMskuOrderProfitRecords(rows, sellers),
  now = () => new Date(),
} = {}) {
  async function getDashboard({ dateRange = completedWeeklyRange(now()), filters = {}, parameters = RISK_PARAMETERS } = {}) {
    const inventory = await loadInventoryRows({ adapter, getSellers: loadSellers });
    const payload = await fetchOrderProfit({ startDate: dateRange.startDate, endDate: dateRange.endDate, sids: inventory.sellers.map((seller) => seller.sid), currencyCode: "ORIGINAL" });
    const profits = normalizeOrderProfit(adapter.normalizeRecordList ? adapter.normalizeRecordList(payload) : payload, inventory.sellers);
    return buildSlowMovingRiskDashboard({ inventoryRows: inventory.rows, profitRows: profits, dateRange, filters, parameters, generatedAt: now().toISOString() });
  }
  return { getDashboard };
}
```

If inventory, seller lookup or order-profit loading rejects, propagate the original error with an added `source` property (`inventory`, `sellers`, or `orderProfit`). Do not return rows that lack a complete core source. Build `meta.dataSources` only after all three complete successfully.

- [ ] **Step 5: Add source-failure and filter tests, then run the focused suite**

```js
await assert.rejects(
  () => createSlowMovingRiskService({ loadInventoryRows: async () => { throw Object.assign(new Error("timeout"), { source: "inventory" }); } }).getDashboard(),
  (error) => error.source === "inventory" && error.message === "timeout",
);
assert.deepEqual(filterSlowMovingRiskRows(dashboard.rows, { country: "US", riskLevel: "高风险" }).map((row) => row.msku), ["MD-DINOBATH"]);
```

Run: `node --test test/slowMovingRiskService.test.js test/inventoryProvisionService.test.js`  
Expected: all tests pass, including the unchanged inventory-provision tests.

- [ ] **Step 6: Commit live composition**

```bash
git add src/services/inventoryProvisionService.js src/services/slowMovingRiskService.js test/slowMovingRiskService.test.js
git commit -m "feat: compose live slow-moving risk dashboard"
```

### Task 3: Persist immutable six-month snapshots and schedule Tuesday reports

**Files:**
- Create: `src/services/slowMovingRiskSnapshotStore.js`
- Create: `src/jobs/slowMovingRiskWeeklyJob.js`
- Create: `test/slowMovingRiskSnapshotStore.test.js`
- Create: `test/slowMovingRiskWeeklyJob.test.js`

- [ ] **Step 1: Write failing store tests using a temporary data directory**

```js
test("snapshot store keeps the report payload immutable and prunes entries older than six months", async () => {
  const store = createSlowMovingRiskSnapshotStore({ dataDir: tempDir, now: () => new Date("2026-07-31T01:00:00.000Z") });
  await store.saveSuccess({ reportKey: "2026-07-26", dashboard: { rows: [{ msku: "A" }], parameters: { annualCapitalCostRate: 0.12 } } });
  await store.saveSuccess({ reportKey: "2026-01-25", dashboard: { rows: [{ msku: "OLD" }] } });

  assert.deepEqual((await store.list()).map((item) => item.reportKey), ["2026-07-26"]);
  assert.equal((await store.read("2026-07-26")).dashboard.rows[0].msku, "A");
});
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `node --test test/slowMovingRiskSnapshotStore.test.js test/slowMovingRiskWeeklyJob.test.js`  
Expected: module-not-found failures for the two new modules.

- [ ] **Step 3: Implement the atomic snapshot store**

Use `readJson` and `writeJsonAtomic` at `data-cache/slow-moving-risk-reports.json`. The persisted root shape is `{ version: 1, reports: [] }`; every success report is `{ reportKey, status: "success", generatedAt, dashboard }`; every failure is `{ reportKey, status: "failed", attemptedAt, error: { source, message }, observability }`.

```js
export const slowMovingRiskSnapshotFile = (dataDir = process.cwd()) => path.join(dataDir, "data-cache", "slow-moving-risk-reports.json");
export class SlowMovingRiskSnapshotConflictError extends Error {
  constructor(reportKey) { super(`Slow-moving risk report already exists: ${reportKey}`); this.name = "SlowMovingRiskSnapshotConflictError"; }
}
```

`saveSuccess` must throw `SlowMovingRiskSnapshotConflictError` when a successful report key already exists; it must never overwrite the previous dashboard.

- [ ] **Step 4: Write and implement weekly scheduling tests**

Add tests for Tuesday 09:00, Monday 09:00, Tuesday 08:59, already-successful report key, failure persistence, and lock contention. Implement these exports:

```js
export function shouldRunSlowMovingRiskWeeklyJob({ now, state = {}, runAt = "09:00" }) {
  const clock = shanghaiClock(now);
  const reportKey = completedWeeklyRange(now).reportKey;
  return clock.weekday === 2 && clock.time >= runAt && state.lastSuccessfulReportKey !== reportKey;
}
```

`runSlowMovingRiskWeeklyJobIfNeeded` must call `reportService.getDashboard({ dateRange: completedWeeklyRange(now) })`, then `snapshotStore.saveSuccess({ reportKey, dashboard })` and persist `{ lastSuccessfulReportKey: reportKey, lastStatus: "success" }`. On rejection, it must call `snapshotStore.saveFailure({ reportKey, error: { source: error.source || "unknown", message: error.message }, observability })`, persist `lastStatus: "failed"`, and rethrow. `startSlowMovingRiskWeeklyScheduler` must make one startup call and then schedule the same call every five minutes.

Use lock name `slow-moving-risk-weekly-report`, TTL `3 * 60 * 60 * 1000`, state file `data-cache/slow-moving-risk-weekly-job.json`, and `console.info` event names `[slow-moving-risk-weekly-job] started|finished|failed` with report key, duration, row count and source summary. Never log credentials or raw Lingxing payloads.

- [ ] **Step 5: Run snapshot and job tests**

Run: `node --test test/slowMovingRiskSnapshotStore.test.js test/slowMovingRiskWeeklyJob.test.js`  
Expected: all tests pass.

- [ ] **Step 6: Commit snapshot and job support**

```bash
git add src/services/slowMovingRiskSnapshotStore.js src/jobs/slowMovingRiskWeeklyJob.js test/slowMovingRiskSnapshotStore.test.js test/slowMovingRiskWeeklyJob.test.js
git commit -m "feat: schedule slow-moving risk reports"
```

### Task 4: Register the new routes and remove the legacy clearance backend

**Files:**
- Modify: `routes/inventory.js`
- Modify: `server.js`
- Modify: `src/services/inventoryProvisionService.js`
- Modify: `test/serverRoutesStructure.test.js`
- Modify: `test/inventoryProvisionService.test.js`

- [ ] **Step 1: Write failing route-table assertions**

```js
const routes = buildApiRoutes({});
assert.equal(routes.find((route) => route.path === "/api/dashboard/clearance-inventory"), undefined);
assert.equal(routes.find((route) => route.path === "/api/dashboard/slow-moving-risk/live")?.auth, "session");
assert.equal(routes.find((route) => route.path === "/api/dashboard/slow-moving-risk/reports")?.auth, "session");
assert.equal(routes.find((route) => route.pattern?.toString().includes("slow-moving-risk/reports"))?.auth, "session");
```

- [ ] **Step 2: Run the structural test and verify it fails**

Run: `node --test test/serverRoutesStructure.test.js`  
Expected: missing slow-moving-risk routes and still-present legacy route.

- [ ] **Step 3: Replace the inventory routes and compose server dependencies**

In `routes/inventory.js`, remove `getClearanceInventoryDashboard` from dependencies and remove the old route. Add these handlers, preserving multi-value filters as comma-separated strings handled by the service:

```js
{
  method: "GET", path: "/api/dashboard/slow-moving-risk/live", auth: "session", errorStatusCode: 502,
  handler: async ({ res, url }) => sendJson(res, 200, await getSlowMovingRiskDashboard({
    filters: { country: url.searchParams.get("country") || "", storeName: url.searchParams.get("storeName") || "", listingOwner: url.searchParams.get("listingOwner") || "", riskLevel: url.searchParams.get("riskLevel") || "" },
  })),
},
{
  method: "GET", path: "/api/dashboard/slow-moving-risk/reports", auth: "session",
  handler: async ({ res }) => sendJson(res, 200, await listSlowMovingRiskReports()),
},
{
  method: "GET", pattern: /^\/api\/dashboard\/slow-moving-risk\/reports\/(?<reportKey>[^/]+)$/u, auth: "session",
  handler: async ({ res, params }) => sendJson(res, 200, await readSlowMovingRiskReport(params.reportKey)),
},
```

The report-detail function must throw an error with `statusCode = 404` for an unknown key. In `server.js`, import and compose `getSlowMovingRiskDashboard`, snapshot store list/read functions and `startSlowMovingRiskWeeklyScheduler`, then call the scheduler once beside the existing startup schedulers. Remove the legacy clearance export and all clearance-only code from `inventoryProvisionService.js` only after its existing tests pass without it.

- [ ] **Step 4: Run focused backend tests**

Run: `node --test test/serverRoutesStructure.test.js test/inventoryProvisionService.test.js test/slowMovingRiskService.test.js test/slowMovingRiskSnapshotStore.test.js test/slowMovingRiskWeeklyJob.test.js`  
Expected: all tests pass, and route table has no legacy clearance endpoint.

- [ ] **Step 5: Commit routes and legacy backend removal**

```bash
git add routes/inventory.js server.js src/services/inventoryProvisionService.js test/serverRoutesStructure.test.js test/inventoryProvisionService.test.js
git commit -m "feat: expose slow-moving risk reports"
```

### Task 5: Build the feature module and replace the page markup

**Files:**
- Create: `assets/js/features/slow-moving-risk.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `package.json`
- Modify: `test/frontendStructure.test.js`
- Create: `test/slowMovingRiskFeature.test.js`
- Delete: `assets/js/features/clearance-calculator.js`

- [ ] **Step 1: Write failing feature tests against a minimal DOM fixture**

Test `createSlowMovingRiskFeature` with injected `root`, `fetchImpl`, `bind`, `setText` and `escapeHtml`. Assert that it requests the exact paths, shows a successful snapshot by default, can switch to live data, and supports ArrowRight keyboard navigation:

```js
await feature.loadSlowMovingRiskView();
assert.equal(calls[0], "/api/dashboard/slow-moving-risk/reports");
assert.equal(calls[1], "/api/dashboard/slow-moving-risk/reports/2026-07-26");
await feature.setSlowMovingRiskTab("live");
assert.match(calls.at(-1), /^\/api\/dashboard\/slow-moving-risk\/live\?/);
```

- [ ] **Step 2: Run the feature test and verify it fails**

Run: `node --test test/slowMovingRiskFeature.test.js`  
Expected: missing-module failure for `assets/js/features/slow-moving-risk.js`.

- [ ] **Step 3: Implement the focused feature module**

Export exactly this factory and returned public surface:

```js
export function createSlowMovingRiskFeature({ root = globalThis.document, bind, escapeHtml, fetchImpl = globalThis.fetch, formatActualMoney, formatNumber, selectedFilterValues, setButtonBusy, setSelectOptions, setText, syncAllOptionSelection } = {}) {
  return { loadSlowMovingRiskView, setupSlowMovingRisk };
}
```

`loadSlowMovingRiskView` fetches the report directory, selects the newest `status === "success"` report, then calls `loadSlowMovingRiskReport(reportKey)`. `loadSlowMovingRiskLive` serializes the four filters with `URLSearchParams` and fetches `/api/dashboard/slow-moving-risk/live`. `setSlowMovingRiskTab` updates only the current tab state and invokes one of those loaders; it never binds listeners. `renderSlowMovingRiskDashboard` writes status metadata, four KPIs and every table cell from the response. `setupSlowMovingRisk` binds tab click/keydown, refresh and filters once.

The table renderer must use `escapeHtml` for all response text and must render `—` for `null` values, `无销量` for null average margin, and the server-provided removal-fee reason instead of a numeric default. Use `aria-selected`, `role="tab"`, `role="tabpanel"` and roving focus for the three tabs. Do not bind listeners inside any load function.

- [ ] **Step 4: Replace `view-clearance` markup and app composition**

Replace only the old `section#view-clearance` markup with semantic tabs, grouped multi-select country/store filters, single-select owner/risk controls, a refresh button, four KPI `metric-tile` elements and a `data-table-wrap` table. Use these durable table attributes:

```html
<table class="data-table data-table--middle slow-moving-risk-table" data-table-key="slow-moving-risk-weekly">
  <th data-column-key="riskLevel">风险</th>
  <th data-column-key="store">店铺 / 站点</th>
  <th data-column-key="msku">MSKU</th>
  <th data-column-key="inventoryQuantity">当前可售 / 90天+</th>
  <th data-column-key="inventoryAmount">库存金额 / 90天+</th>
  <th data-column-key="velocity">可售天数 / 30日转化</th>
  <th data-column-key="margin">30日销量 / 毛利 / 均毛利</th>
  <th data-column-key="advertising">广告花费 / 广告占比 / ACOS</th>
  <th data-column-key="cashRisk">资金风险金额</th>
  <th data-column-key="recovery">清仓 / 清算回收</th>
  <th data-column-key="removal">移除费</th>
  <th data-column-key="recommendation">本周建议</th>
</table>
```

In `app.js`, replace the clearance import and composition with `createSlowMovingRiskFeature`, replace `loadClearanceView()` with `loadSlowMovingRiskView()`, and call `setupSlowMovingRisk()` in the one-time setup area. Remove the legacy feature file. In `package.json`, replace the clearance feature in both `check:js` and `check` with `slow-moving-risk.js` and add the new service/job files to syntax checking.

- [ ] **Step 5: Update front-end structure expectations and run focused tests**

Replace each clearance-specific assertion in `test/frontendStructure.test.js` with assertions for `createSlowMovingRiskFeature`, `loadSlowMovingRiskView`, `loadSlowMovingRiskLive`, `renderSlowMovingRiskDashboard`, `setupSlowMovingRisk`, and the absence of `createClearanceCalculatorFeature`/`clearance-calculator.js`.

Run: `node --test test/slowMovingRiskFeature.test.js test/frontendStructure.test.js`  
Expected: all tests pass.

- [ ] **Step 6: Commit the page replacement**

```bash
git add index.html app.js package.json assets/js/features/slow-moving-risk.js test/slowMovingRiskFeature.test.js test/frontendStructure.test.js
git rm assets/js/features/clearance-calculator.js
git commit -m "feat: replace clearance page with weekly risk report"
```

### Task 6: Move styles to the page layer and verify rendered behavior

**Files:**
- Create: `assets/css/pages/26-slow-moving-risk.css`
- Modify: `test/stylesStructure.test.js`
- Delete: `assets/css/pages/26-clearance-calculator.css`
- Modify: `styles.css` (generated only by `npm run build:css`)

- [ ] **Step 1: Write failing CSS ownership assertions**

```js
const pageSource = await readFile(new URL("../assets/css/pages/26-slow-moving-risk.css", import.meta.url), "utf8");
assert.match(pageSource, /^\/\* Slow-moving risk page\. \*\//m);
assert.match(pageSource, /^#view-clearance \.slow-moving-risk-tabs\s*\{/m);
assert.match(pageSource, /^#view-clearance \.slow-moving-risk-kpis\s*\{/m);
assert.match(pageSource, /^#view-clearance \.slow-moving-risk-table-wrap\s*\{/m);
assert.match(pageSource, /^@media \(max-width:\s*720px\)/m);
assert.equal(/#[0-9a-f]{3,8}\b/i.test(pageSource), false);
```

- [ ] **Step 2: Run the CSS structure test and verify it fails**

Run: `node --test test/stylesStructure.test.js`  
Expected: missing-file assertion for `26-slow-moving-risk.css`.

- [ ] **Step 3: Add token-based page styles and remove legacy styles**

Use only existing semantic tokens and shared classes. The CSS must make the tab list compact, show active/inactive states with `:focus-visible`, preserve the shared banner-adjacent filter behavior, put the horizontal scroll on `.slow-moving-risk-table-wrap`, and keep action reasons readable at narrow width. Use `.data-table-wrap--detail` / `.data-table--detail` where sticky headers are needed; do not add business-column pixel widths. Delete `26-clearance-calculator.css` and replace its test expectations entirely.

- [ ] **Step 4: Build CSS and run style tests**

Run: `npm run build:css && node --test test/stylesStructure.test.js && npm run build:css -- --check`  
Expected: `styles.css rebuilt` or `styles.css already up to date`, all tests pass, and the final check exits zero.

- [ ] **Step 5: Commit style migration**

```bash
git add assets/css/pages/26-slow-moving-risk.css styles.css test/stylesStructure.test.js
git rm assets/css/pages/26-clearance-calculator.css
git commit -m "style: add slow-moving risk report page"
```

### Task 7: Run complete verification and browser checks

**Files:**
- Modify only if a verification failure identifies a concrete defect in a file named above.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test && npm run check`  
Expected: Node test runner completes with zero failing tests; CSS freshness, CSS standards and JavaScript syntax checks all exit zero.

- [ ] **Step 2: Start the local BI server and inspect the report route in a browser**

Run: `npm run dev`  
Expected: server starts without scheduler startup errors. Open the local application, log in with an authorized test session, then navigate to 「销售 → 动销预警」.

- [ ] **Step 3: Verify desktop interaction and network behavior**

Confirm all of the following in the browser:

1. The default tab displays the newest successful weekly snapshot and its end date is a Sunday.
2. Tabs respond to mouse, Tab and ArrowRight/ArrowLeft; `aria-selected` follows the visible panel.
3. Country/store/owner/risk filters generate an encoded request to `/api/dashboard/slow-moving-risk/live` and the table/KPIs update.
4. A row with missing removal fields displays `缺少尺寸/重量，无法计算` rather than a fee.
5. Rows are ordered by descending cash-risk amount; advertising-waste rows require both negative margin and the confirmed 15% ad-share rule, except zero sales with spend.
6. DevTools console has no errors and API responses expose generation time, data end date and source status without credentials.

- [ ] **Step 4: Verify narrow viewport behavior**

At a narrow viewport, verify the application shell and document remain viewport-width, the filter controls wrap, and only `.slow-moving-risk-table-wrap` scrolls horizontally. Confirm table header and action text remain readable and focused controls stay visible.

- [ ] **Step 5: Record final evidence and commit only verified fixes**

If a defect is found, add a regression test before its minimal correction, rerun the affected focused test, then rerun `npm test && npm run check`. Commit each verified correction with a message naming the fixed behavior. Do not create a production package or deploy in this plan.

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement all metrics, thresholds, 15% ad-share rule, original-currency recovery values and removal-fee incompleteness; Tasks 3–4 implement Tuesday scheduling, Sunday cutoff, immutable six-month history, errors and observability; Tasks 5–6 replace the page with confirmed table design and accessibility; Task 7 validates desktop, narrow screen and requests.
- **No hidden fallbacks:** Core source failures reject and become observable failed reports; only removal-fee field incompleteness is permitted and visibly labeled.
- **Type consistency:** `reportKey` is the Sunday end date throughout service, store, job, route and feature; `riskLevel`, `cashConversionRate`, `adShare`, `cashRiskAmount` and recovery field names are established in Task 1 and reused in later tasks.

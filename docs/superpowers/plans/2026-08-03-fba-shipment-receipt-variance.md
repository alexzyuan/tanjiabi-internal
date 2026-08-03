# FBA 货件收发差异 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在物流模块提供可筛选的 FBA 收发差异看板，并为 `CLOSED` 短收货件提供从 `closed_time` 起算七天的内部跟进 SLA 和可撤销的持久化跟进状态。

**Architecture:** 差异服务复用 `getFbaShipmentCandidates` 的领星货件数据，按货件汇总明细数量并与独立 JSON 跟进存储合并。FBA 路由把列表与跟进变更暴露给一个独立原生 JS feature；`app.js` 只装配和初始化它，页面样式使用现有 token、筛选栏、指标卡和表格组件。

**Tech Stack:** Node.js ESM、`node:test`、原生 HTML/CSS/JavaScript、项目 `jsonStore`、Adobe Spectrum 交互原则。

---

## File structure

| 文件 | 责任 |
| --- | --- |
| `src/services/fbaShipmentVarianceFollowupStore.js` | 跟进状态的验证、原子读写、读取、标记和撤销。 |
| `src/services/fbaShipmentVarianceService.js` | 规范化筛选、汇总领星货件、判定短收/SLA、合并跟进状态、计算指标。 |
| `routes/fba.js` | 会话认证的列表、标记跟进和撤销跟进路由。 |
| `server.js` | 仅注入 `followupStatus` 筛选字段和新增服务依赖。 |
| `assets/js/features/fba-shipment-variance.js` | 视图加载、筛选、表格/明细渲染、标记和撤销交互。 |
| `index.html` | 物流导航、视图、筛选、指标、表格和明细弹窗标记。 |
| `app.js` | feature 的导入、实例化、导航加载和 setup 调用。 |
| `assets/js/features/breadcrumb-shell.js` | 该视图的物流面包屑。 |
| `assets/js/features/home-quick-links.js` | 可配置的首页快捷入口元数据。 |
| `assets/css/pages/38-fba-shipment-variance.css` | 仅页面布局、SLA 强调和明细弹窗。 |
| `scripts/build-styles.js` 或其 CSS 清单 | 将新页面样式纳入生成顺序。 |
| `test/fbaShipmentVarianceFollowupStore.test.js` | JSON 跟进状态的持久化与审计。 |
| `test/fbaShipmentVarianceService.test.js` | 差异聚合、状态、SLA、筛选和上游错误传播。 |
| `test/fbaShipmentVarianceFeature.test.js` | 前端交互与请求。 |
| `test/serverRoutesStructure.test.js`、`test/frontendStructure.test.js` | 新路由与前端装配结构。 |

### Task 1: 实现跟进记录存储（TDD）

**Files:**
- Create: `test/fbaShipmentVarianceFollowupStore.test.js`
- Create: `src/services/fbaShipmentVarianceFollowupStore.js`

- [ ] **Step 1: 写入失败测试，定义持久化键、操作人和撤销语义**

```js
test("marking a shipment follow-up persists sid, shipmentId, operator and timestamp", async () => {
  await withTempStore(async (storeFile) => {
    const row = await markFbaShipmentVarianceFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ", operator: "Alice" }, {
      storeFile,
      now: () => new Date("2026-08-03T08:00:00.000Z"),
    });
    assert.deepEqual(row, {
      sid: 8708, shipmentId: "FBA18QJFDCWJ", followedUp: true,
      followedUpAt: "2026-08-03T08:00:00.000Z", followedUpBy: "Alice", updatedAt: "2026-08-03T08:00:00.000Z",
    });
  });
});

test("clearing a follow-up keeps a non-followed-up audit row that listByKeys returns", async () => {
  await withTempStore(async (storeFile) => {
    await markFbaShipmentVarianceFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ", operator: "Alice" }, { storeFile, now: () => new Date("2026-08-03T08:00:00.000Z") });
    const cleared = await clearFbaShipmentVarianceFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ", operator: "Bob" }, { storeFile, now: () => new Date("2026-08-03T09:00:00.000Z") });
    const rows = await listFbaShipmentVarianceFollowups(["8708:FBA18QJFDCWJ"], { storeFile });
    assert.equal(cleared.followedUp, false);
    assert.equal(cleared.clearedBy, "Bob");
    assert.equal(cleared.clearedAt, "2026-08-03T09:00:00.000Z");
    assert.equal(rows.get("8708:FBA18QJFDCWJ").followedUp, false);
  });
});

test("follow-up store rejects a missing sid or shipment ID", async () => {
  await assert.rejects(() => markFbaShipmentVarianceFollowup({ shipmentId: "FBA18QJFDCWJ" }), /缺少店铺 SID/);
  await assert.rejects(() => markFbaShipmentVarianceFollowup({ sid: 8708 }), /缺少货件单号/);
});
```

- [ ] **Step 2: 运行测试，确认因模块尚不存在而失败**

Run: `node --test test/fbaShipmentVarianceFollowupStore.test.js`

Expected: FAIL，提示找不到 `fbaShipmentVarianceFollowupStore.js`。

- [ ] **Step 3: 写入最小存储实现，不吞掉 JSON 或文件系统错误**

```js
const defaultStoreFile = path.join(process.cwd(), "data-cache", "fba-shipment-variance-followups.json");
const fallbackStore = { version: 1, rows: [] };
const followupKey = ({ sid, shipmentId }) => `${Number(sid)}:${firstText(shipmentId)}`;

export async function listFbaShipmentVarianceFollowups(keys = [], { storeFile = defaultStoreFile } = {}) {
  const wanted = new Set(keys);
  const store = normalizeStore(await readJson(storeFile, fallbackStore));
  return new Map(store.rows.filter((row) => wanted.has(followupKey(row))).map((row) => [followupKey(row), row]));
}

export async function markFbaShipmentVarianceFollowup(input, options = {}) {
  return saveFollowup({ ...input, followedUp: true }, options);
}

export async function clearFbaShipmentVarianceFollowup(input, options = {}) {
  return saveFollowup({ ...input, followedUp: false }, options);
}
```

Use `readJson` and `updateJsonAtomic` from `src/utils/jsonStore.js`. Validate inputs before entering the update function. Preserve only one row per `sid + shipmentId`, timestamp via injectable `now`, and log only the key, action and operator.

- [ ] **Step 4: 运行存储测试，确认通过**

Run: `node --test test/fbaShipmentVarianceFollowupStore.test.js`

Expected: PASS，所有跟进存储测试通过。

- [ ] **Step 5: 提交这一个原子任务**

```bash
git add src/services/fbaShipmentVarianceFollowupStore.js test/fbaShipmentVarianceFollowupStore.test.js
git commit -m "feat: persist FBA shipment variance follow-ups"
```

### Task 2: 实现货件差异和七天内部 SLA（TDD）

**Files:**
- Create: `test/fbaShipmentVarianceService.test.js`
- Create: `src/services/fbaShipmentVarianceService.js`

- [ ] **Step 1: 写入失败测试，覆盖状态、聚合和不猜测时间**

```js
test("CLOSED short shipment aggregates item quantities and starts seven-day internal SLA from closedAt", async () => {
  const result = await getFbaShipmentVariances({}, {
    now: () => new Date("2026-08-03T08:00:00.000Z"),
    getShipmentCandidates: async () => ({ rows: [{
      sid: 8708, shipmentId: "FBA18QJFDCWJ", shipmentStatus: "closed", closedAt: "2026-08-01 08:00:00",
      items: [{ msku: "A", shippedQuantity: 10, receivedQuantity: 7 }, { msku: "B", shippedQuantity: 5, receivedQuantity: 5 }],
    }] }),
    followupStore: { listByKeys: async () => new Map() },
  });
  assert.equal(result.rows[0].differenceQuantity, 3);
  assert.equal(result.rows[0].investigationState, "pending");
  assert.equal(result.rows[0].remainingSlaHours, 120);
  assert.equal(result.summary.closedShortageCount, 1);
});

test("RECEIVING shipment shows current difference without an SLA", async () => {
  const result = await getFbaShipmentVariances({}, { now: () => new Date("2026-08-03T08:00:00.000Z"), getShipmentCandidates: async () => ({ rows: [{ sid: 8708, shipmentId: "FBA-RECEIVING", shipmentStatus: "RECEIVING", items: [{ shippedQuantity: 10, receivedQuantity: 4 }] }] }), followupStore: { listByKeys: async () => new Map() } });
  assert.equal(result.rows[0].differenceQuantity, 6);
  assert.equal(result.rows[0].investigationState, "receiving");
  assert.equal(result.rows[0].slaState, "not_started");
  assert.equal(result.rows[0].slaDeadlineAt, "");
});
test("CLOSED matching or over-received shipment is not an investigation candidate", async () => {
  const row = buildFbaShipmentVarianceRow({ sid: 8708, shipmentId: "FBA-MATCH", shipmentStatus: "CLOSED", closedAt: "2026-08-01 08:00:00", items: [{ shippedQuantity: 10, receivedQuantity: 10 }] }, null, new Date("2026-08-03T08:00:00.000Z"));
  assert.equal(row.investigationState, "resolved");
  assert.equal(row.slaState, "not_applicable");
});
test("CLOSED short shipment without closedAt declares SLA unavailable", async () => {
  const row = buildFbaShipmentVarianceRow({ sid: 8708, shipmentId: "FBA-NO-CLOSE", shipmentStatus: "CLOSED", items: [{ shippedQuantity: 10, receivedQuantity: 9 }] }, null, new Date("2026-08-03T08:00:00.000Z"));
  assert.equal(row.investigationState, "pending");
  assert.equal(row.slaState, "unavailable");
  assert.equal(row.slaDeadlineAt, "");
});
test("followupStatus filters pending, followed_up and overdue without changing source calculations", async () => {
  const fixture = { rows: [
    { sid: 8708, shipmentId: "FBA-PENDING", shipmentStatus: "CLOSED", closedAt: "2026-08-08 08:00:00", items: [{ shippedQuantity: 10, receivedQuantity: 9 }] },
    { sid: 8708, shipmentId: "FBA-FOLLOWED", shipmentStatus: "CLOSED", closedAt: "2026-08-08 08:00:00", items: [{ shippedQuantity: 10, receivedQuantity: 9 }] },
    { sid: 8708, shipmentId: "FBA-OVERDUE", shipmentStatus: "CLOSED", closedAt: "2026-08-01 08:00:00", items: [{ shippedQuantity: 10, receivedQuantity: 9 }] },
  ] };
  const followups = new Map([["8708:FBA-FOLLOWED", { followedUp: true, followedUpBy: "Alice" }]]);
  const pending = await getFbaShipmentVariances({ followupStatus: "pending" }, { now: () => new Date("2026-08-10T08:00:00.000Z"), getShipmentCandidates: async () => fixture, followupStore: { listByKeys: async () => followups } });
  assert.deepEqual(pending.rows.map((row) => row.shipmentId), ["FBA-PENDING"]);
});
test("Lingxing candidate failure rejects from variance service", async () => {
  await assert.rejects(() => getFbaShipmentVariances({}, { getShipmentCandidates: async () => { throw new Error("Lingxing unavailable"); } }), /Lingxing unavailable/);
});
```

- [ ] **Step 2: 运行测试，确认因为服务尚不存在而失败**

Run: `node --test test/fbaShipmentVarianceService.test.js`

Expected: FAIL，提示找不到 `fbaShipmentVarianceService.js`。

- [ ] **Step 3: 实现显式的纯计算与加载函数**

```js
export function normalizeFbaShipmentVarianceFilters(filters = {}) {
  return { ...normalizeFbaShipmentCandidateFilters(filters), followupStatus: normalizeFollowupStatus(filters.followupStatus) };
}

export function buildFbaShipmentVarianceRow(shipment, followup, now) {
  const items = shipment.items || [];
  const shippedQuantity = items.reduce((sum, item) => sum + numberValue(item.shippedQuantity), 0);
  const receivedQuantity = items.reduce((sum, item) => sum + numberValue(item.receivedQuantity), 0);
  const differenceQuantity = shippedQuantity - receivedQuantity;
  const status = firstText(shipment.shipmentStatus).toUpperCase();
  const closedAt = firstText(shipment.closedAt, shipment.raw?.closed_time);
  return buildVarianceState({ shipment, shippedQuantity, receivedQuantity, differenceQuantity, status, closedAt, followup, now });
}

export async function getFbaShipmentVariances(filters, { getShipmentCandidates = getFbaShipmentCandidates, followupStore = defaultFollowupStore, now = () => new Date() } = {}) {
  const normalized = normalizeFbaShipmentVarianceFilters(filters);
  const source = await getShipmentCandidates(normalized);
  const keys = source.rows.map((row) => `${Number(row.sid)}:${firstText(row.shipmentId)}`);
  const followups = await followupStore.listByKeys(keys);
  const rows = source.rows.map((row) => buildFbaShipmentVarianceRow(row, followups.get(`${Number(row.sid)}:${firstText(row.shipmentId)}`), now())).filter((row) => matchesFollowupStatus(row, normalized.followupStatus));
  return { filters: normalized, rows, summary: summarizeFbaShipmentVariances(rows), source: source.source, cache: source.cache };
}
```

Normalize raw `closed_time` into `closedAt` in `fbaFreightSheetService.js` only as an additive data mapping; do not change existing freight behavior. Date parsing must reject invalid values and return SLA unavailable. Never turn missing data into zero, an invented date, or a false “已超时”.

- [ ] **Step 4: 运行服务测试，确认通过**

Run: `node --test test/fbaShipmentVarianceService.test.js test/fbaShipmentCandidateService.test.js`

Expected: PASS，新增服务和候选货件回归都通过。

- [ ] **Step 5: 提交这一个原子任务**

```bash
git add src/services/fbaShipmentVarianceService.js src/services/fbaFreightSheetService.js test/fbaShipmentVarianceService.test.js
git commit -m "feat: calculate FBA shipment receipt variances"
```

### Task 3: 暴露会话认证 API 并保留错误可见性（TDD）

**Files:**
- Modify: `server.js:648-659, 814-870`
- Modify: `routes/fba.js:1-75`
- Modify: `test/serverRoutesStructure.test.js`

- [ ] **Step 1: 写入失败测试，查找并直接调用新增路由**

```js
test("FBA variance routes require session and forward filters and operator", async () => {
  const calls = [];
  const routes = createFbaRoutes({
    sendJson: (_res, _status, body) => { calls.push(body); },
    getFbaShipmentVariances: async (filters) => ({ filters, rows: [] }),
    markFbaShipmentVarianceFollowup: async (input) => input,
    clearFbaShipmentVarianceFollowup: async (input) => input,
  });
  const list = routes.find((route) => route.path === "/api/fba/shipment-variances");
  assert.equal(list.auth, "session");
  await list.handler({ res: {}, url: new URL("http://localhost/api/fba/shipment-variances?followupStatus=pending&sids=8708") });
  assert.equal(calls[0].filters.followupStatus, "pending");
});
```

- [ ] **Step 2: 运行结构测试，确认路由尚未注册而失败**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: FAIL，找不到 `/api/fba/shipment-variances`。

- [ ] **Step 3: 添加依赖和三条路由**

```js
{
  method: "GET", path: "/api/fba/shipment-variances", auth: "session", errorStatusCode: 502,
  handler: async ({ res, url }) => sendJson(res, 200, await getFbaShipmentVariances(readFbaShipmentVarianceFilters(url))),
},
{
  method: "PUT", pattern: /^\/api\/fba\/shipment-variances\/(?<sid>\d+)\/(?<shipmentId>[^/]+)\/followup$/, auth: "session", errorStatusCode: 400,
  handler: async ({ req, res, params }) => sendJson(res, 200, { ok: true, row: await markFbaShipmentVarianceFollowup({ sid: Number(params.sid), shipmentId: decodeURIComponent(params.shipmentId), operator: requestOperator(req) }) }),
},
{
  method: "DELETE", pattern: /^\/api\/fba\/shipment-variances\/(?<sid>\d+)\/(?<shipmentId>[^/]+)\/followup$/, auth: "session", errorStatusCode: 400,
  handler: async ({ req, res, params }) => sendJson(res, 200, { ok: true, row: await clearFbaShipmentVarianceFollowup({ sid: Number(params.sid), shipmentId: decodeURIComponent(params.shipmentId), operator: requestOperator(req) }) }),
},
```

Add `readFbaShipmentVarianceFilters` in `server.js` by extending `readFbaFreightFilters` with only `followupStatus`. Pass the new service functions through `buildApiRoutes` dependencies. Do not catch and replace upstream errors with an empty result.

- [ ] **Step 4: 运行路由测试，确认通过**

Run: `node --test test/serverRoutesStructure.test.js && npm run check:js`

Expected: PASS，所有路由声明认证，JavaScript 语法检查通过。

- [ ] **Step 5: 提交这一个原子任务**

```bash
git add server.js routes/fba.js test/serverRoutesStructure.test.js
git commit -m "feat: add FBA shipment variance API routes"
```

### Task 4: 添加原生前端 feature、导航和可访问标记（TDD）

**Files:**
- Create: `assets/js/features/fba-shipment-variance.js`
- Create: `test/fbaShipmentVarianceFeature.test.js`
- Modify: `index.html:62-72, after view-fba-freight`
- Modify: `app.js:imports, declarations, setupNavigation, setupNavigation tail`
- Modify: `assets/js/features/breadcrumb-shell.js`
- Modify: `assets/js/features/home-quick-links.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: 写入失败的 feature 测试**

```js
test("variance feature defaults to the latest thirty days and requests every shop", async () => {
  const { feature, fetchCalls } = createFeature();
  await feature.loadFbaShipmentVariances();
  assert.match(fetchCalls[0], /\/api\/fba\/shipment-variances\?/);
  assert.match(fetchCalls[0], /startDate=/);
  assert.equal(new URL(fetchCalls[0], "http://localhost").searchParams.get("sids"), "");
});

test("marking followed-up issues a PUT then refreshes the rendered rows", async () => {
  const { feature, fetchCalls } = createFeature();
  await feature.markFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ" });
  assert.equal(fetchCalls[0].url, "/api/fba/shipment-variances/8708/FBA18QJFDCWJ/followup");
  assert.equal(fetchCalls[0].options.method, "PUT");
  assert.match(fetchCalls[1].url, /forceRefresh=true/);
});
test("clearing followed-up issues a DELETE then refreshes the rendered rows", async () => {
  const { feature, fetchCalls } = createFeature();
  await feature.clearFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ" });
  assert.equal(fetchCalls[0].url, "/api/fba/shipment-variances/8708/FBA18QJFDCWJ/followup");
  assert.equal(fetchCalls[0].options.method, "DELETE");
  assert.match(fetchCalls[1].url, /forceRefresh=true/);
});
test("rendered RECEIVING rows say receipt is in progress and closed shortages show the internal SLA", () => {
  const { feature, elements } = createFeature();
  feature.renderFbaShipmentVarianceRows([{ shipmentId: "FBA-1", shipmentStatus: "RECEIVING", investigationState: "receiving", slaDisplay: "收货中，暂未开始" }, { shipmentId: "FBA-2", shipmentStatus: "CLOSED", investigationState: "pending", slaDisplay: "还剩 3 天 7 小时" }]);
  assert.match(elements["#fba-shipment-variance-table"].innerHTML, /收货中，暂未开始/);
  assert.match(elements["#fba-shipment-variance-table"].innerHTML, /还剩 3 天 7 小时/);
});
```

- [ ] **Step 2: 运行前端测试，确认 feature 尚未存在而失败**

Run: `node --test test/fbaShipmentVarianceFeature.test.js`

Expected: FAIL，提示找不到 `fba-shipment-variance.js`。

- [ ] **Step 3: 实现最小 feature**

```js
export function createFbaShipmentVarianceFeature({ root = globalThis.document, bind, bindBackdropClose, createDateRangePickerImpl = createDateRangePicker, fetchImpl = globalThis.fetch, escapeHtml, formatNumber, getFbaShops, loadFbaShops, normalizeFbaShop, renderTableMessage, setModalOpenState, setText } = {}) {
  function buildQuery(forceRefresh = false) { return new URLSearchParams({ startDate: selectedStartDate(), endDate: selectedEndDate(), sids: selectedSid(), followupStatus: selectedFollowupStatus(), forceRefresh: String(forceRefresh) }); }
  async function loadFbaShipmentVariances({ forceRefresh = false } = {}) { const response = await fetchImpl(`/api/fba/shipment-variances?${buildQuery(forceRefresh)}`); const data = await response.json(); if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`); renderFbaShipmentVarianceRows(data.rows || []); }
  async function markFollowup(row) { await mutateFollowup("PUT", row); await loadFbaShipmentVariances({ forceRefresh: true }); }
  async function clearFollowup(row) { await mutateFollowup("DELETE", row); await loadFbaShipmentVariances({ forceRefresh: true }); }
  function setupFbaShipmentVariance() { bind(root, "#fba-shipment-variance-refresh", "click", () => loadFbaShipmentVariances({ forceRefresh: true })); bind(root, "#fba-shipment-variance-followup-status", "change", () => loadFbaShipmentVariances()); bindBackdropClose(root, "#fba-shipment-variance-detail-modal", closeDetail); }
  return { loadFbaShipmentVarianceInitial, loadFbaShipmentVariances, setupFbaShipmentVariance };
}
```

Render table cells with `escapeHtml`; use stable `data-table-key="fba-shipment-variances"` and `data-column-key` attributes. Add semantic numeric columns, visible status labels, `aria-label` on actions, and no `innerHTML` from unescaped data. The detail modal lists SKU/MSKU, shipped, received and difference. Do not add new feature state or event binding blocks to `app.js`.

- [ ] **Step 4: 添加标记和装配**

Add the navigation item directly after FBA 货件处理, a `view-fba-shipment-variance` section with shared `module-hero`, `filter-toolbar`, metric tiles, responsive table wrapper and detail modal. Add `"fba-shipment-variance": ["首页", "物流", "货件收发差异"]` to breadcrumb metadata and a logistics quick link. Import/instantiate the feature in `app.js`, add `loadFbaShipmentVarianceInitial` in the navigation branch, and call `setupFbaShipmentVariance` once during setup.

- [ ] **Step 5: 运行 feature 与结构测试，确认通过**

Run: `node --test test/fbaShipmentVarianceFeature.test.js test/frontendStructure.test.js`

Expected: PASS，默认筛选、PUT/DELETE、导航、面包屑和页面装配均通过。

- [ ] **Step 6: 提交这一个原子任务**

```bash
git add assets/js/features/fba-shipment-variance.js test/fbaShipmentVarianceFeature.test.js index.html app.js assets/js/features/breadcrumb-shell.js assets/js/features/home-quick-links.js test/frontendStructure.test.js
git commit -m "feat: add FBA shipment receipt variance dashboard"
```

### Task 5: 添加页面样式并生成 CSS（TDD/视觉回归）

**Files:**
- Create: `assets/css/pages/38-fba-shipment-variance.css`
- Modify: `scripts/build-styles.js`（若页面样式清单为显式维护）
- Modify: `styles.css`（仅由 `npm run build:css` 自动生成）
- Modify: `test/stylesStructure.test.js`（若结构守卫要求新页面样式覆盖）

- [ ] **Step 1: 写入或调整 CSS 结构测试，禁止页面级筛选栏和普通业务列宽覆盖**

```js
test("shipment variance page uses shared filters and table widths", async () => {
  const source = await readFile(new URL("../assets/css/pages/38-fba-shipment-variance.css", import.meta.url), "utf8");
  assert.equal(/\.fba-shipment-variance-toolbar\s*\{[\s\S]*?(display|gap|padding|min-height)\s*:/.test(source), false);
  assert.equal(/\.fba-shipment-variance-table\s+(th|td)[^{]*\{[\s\S]*?\b(width|min-width)\s*:/.test(source), false);
});
```

- [ ] **Step 2: 运行样式结构测试，确认缺少页面样式文件而失败**

Run: `node --test test/stylesStructure.test.js`

Expected: FAIL，提示 `38-fba-shipment-variance.css` 尚不存在。

- [ ] **Step 3: 编写最小页面专属样式**

```css
#view-fba-shipment-variance .fba-shipment-variance-table-shell { overflow-x: auto; }
#view-fba-shipment-variance .variance-sla--warning { color: var(--tj-warning); font-weight: 700; }
#view-fba-shipment-variance .variance-sla--overdue { color: var(--tj-danger); font-weight: 700; }
#view-fba-shipment-variance .fba-shipment-variance-detail-dialog { width: min(760px, calc(100vw - 32px)); }
```

Use only existing tokens. Reuse `.risk-badge`, `.metric-grid`, `.table-shell`, `.table-actions`, modal and `:focus-visible` shared rules. Do not add color literals, an independent sticky filter baseline, fixed business-column widths, global min-width or non-semantic clickable elements.

- [ ] **Step 4: 生成并检查 CSS**

Run: `npm run build:css && npm run build:css -- --check && node --test test/stylesStructure.test.js`

Expected: PASS，`styles.css` 仅由生成器更新，结构测试通过。

- [ ] **Step 5: 提交这一个原子任务**

```bash
git add assets/css/pages/38-fba-shipment-variance.css scripts/build-styles.js styles.css test/stylesStructure.test.js
git commit -m "style: add FBA shipment variance dashboard layout"
```

### Task 6: 端到端验证、可观测性核对与最终检查

**Files:**
- Modify only if verification reveals a defect; otherwise none.

- [ ] **Step 1: 运行完整自动化检查**

Run: `npm test && npm run check`

Expected: exit 0；所有 Node 测试、CSS 结构检查和 JavaScript 语法检查通过。

- [ ] **Step 2: 启动本地应用并进行浏览器验证**

Run: `npm start`

Use the in-app browser or Playwright to verify:

1. “物流 › 货件收发差异”打开后无控制台错误。
2. 默认日期是最近 30 天，店铺为全部，日期控件与店铺/跟进筛选均可用鼠标及键盘操作。
3. `RECEIVING` 行显示收货中且没有 SLA 倒计时。
4. `CLOSED` 短收行显示从 `closed_time` 算出的七天内部 SLA；缺少关闭时间时显示不可计算。
5. 点击“已跟进”后，刷新页面和重新读取货件仍保留状态；按“已跟进”筛选可见；点击“撤销跟进”后恢复待跟进。
6. 宽屏与窄屏截图均无文字重叠、页面横向溢出或表格外溢；横向滚动只发生在表格容器。
7. 网络请求含 `startDate`、`endDate`、店铺和 `followupStatus`；跟进请求使用对应的 `PUT` / `DELETE` 路由。

- [ ] **Step 3: 审查日志和失败路径**

Force a controlled mock/adapter error and verify API 返回错误而非空行；确认服务日志仅包含货件数量、短收数量、状态分布、超期数量、货件键和操作人，不记录令牌或密码。

- [ ] **Step 4: 复查变更范围并提交验证修复（如有）**

Run: `git diff --check && git status --short`

If verification produced a code fix, stage only the files required by that fix and commit it with a specific `fix:` message. Do not stage unrelated pre-existing worktree changes.

# 店铺经营月报项目行配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让店铺经营月报按当前登录账号保存项目明细行的显示/隐藏偏好，并提供可搜索、分组批量操作的配置弹窗。

**Architecture:** 后端以 `req.user` 的稳定账号身份为唯一归属，在 `data-cache` 中原子保存 `hiddenMetricIds`。指标 key、名称和分类只从月报 mapper 导出；前端读取配置后仅过滤 level 2 项目行，一级分类小计、动态数值列和 Excel 导出维持现状。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、node:test、现有 JSON 原子存储、Adobe Spectrum 语义 token。

---

## File Structure

- `src/services/storeOperatingMonthlyReportMapper.js`: 导出可配置指标目录，继续作为指标 key、名称、分类的唯一来源。
- `src/services/storeOperatingMonthlyReportRowVisibilityService.js`: 新建账号级偏好存储、输入规范化和错误类型；不涉及 HTTP。
- `routes/finance-purchase.js`: 新增 GET/PUT 路由，使用 `req.user`，不接受用户身份字段。
- `server.js`: 创建服务并将读写函数注入路由。
- `index.html`: 增加入口和语义化 modal 标记。
- `assets/js/features/store-operating-monthly-report.js`: 状态、API 调用、modal、过滤和事件绑定。
- `app.js`: 仅向 feature factory 注入 modal 工具。
- `assets/css/pages/56-store-operating-monthly-report.css`: 配置弹窗的页面级样式。
- `test/storeOperatingMonthlyReportRowVisibilityService.test.js`: 服务测试。
- `test/storeOperatingMonthlyReportRoutes.test.js`: 路由测试。
- `test/storeOperatingMonthlyReportFeature.test.js`: 弹窗与过滤测试。

不修改月报数据服务、Excel 导出、领星适配器、`assets/js/data-table-manager.js` 或生成的 `styles.css`。

### Task 1: 指标目录和账号级偏好服务

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportMapper.js`
- Create: `src/services/storeOperatingMonthlyReportRowVisibilityService.js`
- Create: `test/storeOperatingMonthlyReportRowVisibilityService.test.js`

- [ ] **Step 1: 写失败服务测试。** 临时文件中以两个身份调用服务，覆盖账号隔离、去重、未知 ID 丢弃、非数组输入报 400、身份缺失报 400、存储异常透传，以及同一路径的并发更新。

```js
test("stores normalized hidden metric ids separately for each account", async () => {
  const service = createStoreOperatingMonthlyReportRowVisibilityService({
    filePath: path.join(dir, "row-visibility.json"),
    listMetrics: () => [
      { key: "ad-fee", name: "广告费", category: "platform-expense", categoryName: "平台支出" },
      { key: "purchase-cost", name: "采购成本", category: "product-cost-expense", categoryName: "商品成本支出" },
    ],
  });
  await service.save({ username: "finance-a", source: "managed" }, { hiddenMetricIds: ["ad-fee", "ad-fee", "retired"] });
  await service.save({ username: "finance-b", source: "managed" }, { hiddenMetricIds: ["purchase-cost"] });
  assert.deepEqual((await service.read({ username: "finance-a", source: "managed" })).hiddenMetricIds, ["ad-fee"]);
  assert.deepEqual((await service.read({ username: "finance-b", source: "managed" })).hiddenMetricIds, ["purchase-cost"]);
});
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test test/storeOperatingMonthlyReportRowVisibilityService.test.js`

Expected: FAIL，因为指标目录导出和新服务都不存在。

- [ ] **Step 3: 从 mapper 导出唯一指标目录。** 在 `METRIC_DEFINITIONS` 和 `CATEGORIES` 定义之后增加如下函数。返回值只包含现有 level 2 指标的稳定 key、名称和分类信息，按当前定义顺序；任何前端或存储代码均不得复制中文名称或分类规则。

```js
export function listStoreOperatingMonthlyReportMetricDefinitions() {
  const categoryNames = new Map(CATEGORIES);
  return METRIC_DEFINITIONS.map(({ key, name, category }) => Object.freeze({
    key,
    name,
    category,
    categoryName: categoryNames.get(category) || category,
  }));
}
```

- [ ] **Step 4: 实现最小服务。** 服务默认文件为 `data-cache/store-operating-monthly-report-row-visibility.json`，默认内容为 `{ version: 1, users: {} }`。账号 key 必须包含来源：managed 为 `managed:${username.toLowerCase()}`，钉钉为 `dingtalk:${id || username}`。身份缺失时抛出含 `statusCode = 400` 的 `StoreOperatingMonthlyReportRowVisibilityInputError`。`hiddenMetricIds` 必须是数组；trim、仅保留 mapper 已知 key、去重并按 mapper 顺序输出。读取返回 `{ hiddenMetricIds, updatedAt, metrics }`；保存用 `updateJsonAtomic()` 写入当前账号记录并返回相同结构。使用 `readJsonWithRecovery()` 检查和恢复已有存储；文件读取/写入异常不可吞掉。

```js
export function createStoreOperatingMonthlyReportRowVisibilityService({
  filePath = path.join(process.cwd(), "data-cache", "store-operating-monthly-report-row-visibility.json"),
  listMetrics = listStoreOperatingMonthlyReportMetricDefinitions,
  now = () => new Date().toISOString(),
} = {}) {
  return { read, save };
}
```

- [ ] **Step 5: 验证并提交。**

Run: `node --test test/storeOperatingMonthlyReportRowVisibilityService.test.js`

Expected: PASS，临时目录清理后没有数据残留。

```bash
git add src/services/storeOperatingMonthlyReportMapper.js src/services/storeOperatingMonthlyReportRowVisibilityService.js test/storeOperatingMonthlyReportRowVisibilityService.test.js
git commit -m "feat: store monthly report row visibility by account"
```

### Task 2: 账号归属的 GET/PUT 接口

**Files:**
- Modify: `routes/finance-purchase.js`
- Modify: `server.js`
- Modify: `test/storeOperatingMonthlyReportRoutes.test.js`
- Modify: `test/serverRoutesStructure.test.js`

- [ ] **Step 1: 写失败路由测试。** 构造带 `req.user` 的 finance 路由，向工厂注入 read/save spies。断言 GET 和 PUT 都为 `finance`；PUT body 即使含 `username: "other-user"`，服务仍接收 `req.user` 作为第一个参数，body 原样作为第二参数。

```js
await route.handler({
  req: { user: { username: "finance-a", source: "managed" } },
  res: {},
  url: new URL("http://localhost/api/finance/store-operating-monthly-report/row-visibility"),
});
assert.deepEqual(saved.user, { username: "finance-a", source: "managed" });
assert.deepEqual(saved.payload, { username: "other-user", hiddenMetricIds: ["ad-fee"] });
```

- [ ] **Step 2: 运行失败路由测试。**

Run: `node --test test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js`

Expected: FAIL，因为配置路由尚未注册。

- [ ] **Step 3: 注册并注入路由。** 在现有月报 GET/export 旁边添加下列路由；在 `server.js` 创建单一 service 实例，并向 `buildApiRoutes()` 传入绑定的 `readStoreOperatingMonthlyReportRowVisibility` 和 `saveStoreOperatingMonthlyReportRowVisibility`。不在浏览器或请求体传账号 key。

```js
{
  method: "GET",
  path: "/api/finance/store-operating-monthly-report/row-visibility",
  auth: "finance",
  handler: async ({ req, res }) => {
    sendJson(res, 200, { ok: true, ...(await readStoreOperatingMonthlyReportRowVisibility(req.user)) });
  },
},
{
  method: "PUT",
  path: "/api/finance/store-operating-monthly-report/row-visibility",
  auth: "finance",
  errorStatusCode: 400,
  handler: async ({ req, res }) => {
    sendJson(res, 200, { ok: true, ...(await saveStoreOperatingMonthlyReportRowVisibility(req.user, await readJsonBody(req))) });
  },
},
```

- [ ] **Step 4: 验证并提交。**

Run: `node --test test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js`

Expected: PASS，配置路由可发现且权限为 `finance`。

```bash
git add routes/finance-purchase.js server.js test/storeOperatingMonthlyReportRoutes.test.js test/serverRoutesStructure.test.js
git commit -m "feat: expose monthly report row visibility settings"
```

### Task 3: 弹窗状态和月报行过滤

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/store-operating-monthly-report.js`
- Modify: `app.js`
- Modify: `test/storeOperatingMonthlyReportFeature.test.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: 扩展 harness 并写失败测试。** 增加配置按钮、modal、搜索输入、项目容器、应用/取消按钮和可派发 click/input/key 事件的最小 mock。模拟配置 GET 返回 `metrics` 和 `hiddenMetricIds: ["ad-fee"]`，再模拟月报数据含 `platform-expense` 小计和 `ad-fee` 明细。断言：展开分类后不出现广告费、仍出现平台支出小计；搜索只过滤 modal 项；取消不改变已生效表格；PUT 失败保留 modal 草稿和旧表格；PUT 成功发送 JSON 并刷新当前内存数据。

```js
assert.doesNotMatch(elements["#store-operating-report-body"].innerHTML, /广告费/);
assert.match(elements["#store-operating-report-body"].innerHTML, /平台支出小计/);
assert.equal(requests.at(-1).url, "/api/finance/store-operating-monthly-report/row-visibility");
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { hiddenMetricIds: ["ad-fee"] });
```

- [ ] **Step 2: 运行失败测试。**

Run: `node --test test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js`

Expected: FAIL，因为入口、modal、配置状态和请求不存在。

- [ ] **Step 3: 添加 HTML 与 feature 行为。** 在月报 hero 操作区添加 `#store-operating-report-row-visibility`，新增采用现有 `.modal-backdrop`、`.modal-head`、`.modal-body`、`.modal-foot` 的 `#store-operating-report-row-visibility-modal`。modal 以 `<fieldset><legend>` 分组，项目用原生 checkbox，搜索有 `<label>`。

在 feature 中维护如下状态，且只通过 `readApiResponse()` 读取配置 API：

```js
let rowVisibility = { hiddenMetricIds: new Set(), metrics: [], loaded: false };
let rowVisibilityDraft = null;

function isVisibleReportDetail(row) {
  return Number(row?.level) !== 2 || !rowVisibility.hiddenMetricIds.has(String(row?.key || ""));
}
```

修改 `renderRows()` 的可见条件：level 2 必须同时通过 `isVisibleReportDetail(row)` 和既有展开条件；level 0/1 永远保留。`loadRowVisibility()` GET 成功后更新状态并重渲染已有报表；失败时显示“项目行配置读取失败：…”并保留默认全显示。打开时克隆草稿；搜索、全选、清空、分组全选/取消、恢复默认只改草稿；应用 PUT `{ hiddenMetricIds }`，仅在成功后替换已生效状态、关闭 modal、重渲染。失败时不关闭 modal，不替换已生效状态，并显示明确错误。通过注入的 `setModalOpenState`、`bindBackdropClose` 处理关闭和 Escape。

- [ ] **Step 4: 保持 bootstrap 边界。** `app.js` 只传 `bindBackdropClose` 与 `setModalOpenState`；调用 `loadRowVisibility()` 时与月报数据加载并行，使用独立取消控制器，配置失败不可覆盖月报查询状态。更新结构测试，断言入口/modal/CSS 源存在，且 feature-specific renderer 仍不进入 `app.js`。

- [ ] **Step 5: 验证并提交。**

Run: `node --test test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js`

Expected: PASS，旧筛选、展开、排序和导出测试仍通过。

```bash
git add index.html assets/js/features/store-operating-monthly-report.js app.js test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js
git commit -m "feat: configure visible monthly report rows"
```

### Task 4: 样式、构建和浏览器验证

**Files:**
- Modify: `assets/css/pages/56-store-operating-monthly-report.css`
- Generated through build: `styles.css`
- Modify if required: `test/frontendStructure.test.js`

- [ ] **Step 1: 写失败 CSS 结构测试。** 断言页面 CSS 源含 `.store-operating-row-visibility-groups` 和 720px 窄屏规则，并且不引入三位数固定 `min-width`。

```js
assert.match(css, /\.store-operating-row-visibility-groups/);
assert.match(css, /@media \(max-width: 720px\)/);
assert.doesNotMatch(css, /min-width:\s*\d{3,}px/);
```

- [ ] **Step 2: 运行失败样式测试。**

Run: `node --test test/frontendStructure.test.js`

Expected: FAIL，因为页面级样式不存在。

- [ ] **Step 3: 添加 token 化 CSS 并构建。** 使用 `--tj-*` 和 `--spectrum-*` token 设置受视口约束的 dialog、可滚动分组区、稳定的 checkbox 行、组操作与 `:focus-visible`；不改生成 CSS。

Run: `npm run build:css`

Expected: PASS，`styles.css` 只由构建生成。

- [ ] **Step 4: 自动化和浏览器回归。**

Run: `npm test && git diff --check`

Expected: PASS。

使用 Browser plugin 启动或复用本地服务，在登录态验证月报：无 console error；鼠标和键盘可开关/关闭 modal；搜索、分组操作、恢复默认、应用均可用；网络 GET/PUT 指向配置端点，PUT body 没有账号字段；桌面与 390px 宽截图中没有文字重叠，表格自身而非页面承担横向滚动。以第二账号确认看不到第一账号的配置。

- [ ] **Step 5: 提交样式和构建产物。**

```bash
git add assets/css/pages/56-store-operating-monthly-report.css styles.css test/frontendStructure.test.js
git commit -m "style: polish monthly report row configuration"
```

### Task 5: 最终回归与发布保护

**Files:**
- Verify only: all files above

- [ ] **Step 1: 确认提交边界与工作树。**

Run: `git status --short && git log --oneline -5`

Expected: 无未提交变更；提交只包含本功能、构建 CSS 与本已提交的规格/计划。

- [ ] **Step 2: 运行目标和完整测试。**

Run: `node --test test/storeOperatingMonthlyReportRowVisibilityService.test.js test/storeOperatingMonthlyReportRoutes.test.js test/storeOperatingMonthlyReportFeature.test.js test/serverRoutesStructure.test.js test/frontendStructure.test.js && npm test`

Expected: 两个测试层级都 PASS。

- [ ] **Step 3: 仅在用户明确要求发布时部署。** 确认分支为 `main`、工作树干净、提交完整后，使用 `DEPLOY_CONFIRM_BRANCH=main` 的现有打包部署流程；不得手工复制运行文件到生产服务器。

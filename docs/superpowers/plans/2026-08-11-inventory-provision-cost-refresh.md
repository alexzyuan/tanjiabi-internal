# 库存计提成本刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让财务用户对一个历史库存月显式刷新产品管理成本，并将 `tanjia-eu-DE`（SID `17307`）及其库存纳入刷新后的库存计提。

**Architecture:** 新增一个成本刷新服务，编排强制历史库存重载、店铺目录刷新、Listing MSKU→内部 SKU 映射和产品管理成本覆盖；现有库存计提服务继续拥有 FIFO、月末库存和计提计算。刷新操作在目标月和比较月都完成上游验证后才写入历史缓存；路由只触发刷新并返回摘要，前端随后用现有 GET 加载链重新渲染。

**Tech Stack:** Node.js ESM、原生 HTTP 路由、领星适配器、原生 HTML/CSS/JavaScript、`node:test`、Playwright CLI。

## Global Constraints

- 所有新业务逻辑位于 `src/services/*`；`app.js` 不新增状态机、渲染或事件绑定。
- 历史月的普通 GET 继续复用历史缓存；只有新的显式成本刷新请求强制重建历史源并查询产品管理。
- 产品管理或 Listing 信息缺失必须失败并留下可定位诊断；不得用 `0`、旧成本或未匹配 MSKU 兜底覆盖缓存。
- 刷新成本仅允许历史月；当前月仍使用实时 FBA 库存接口返回的成本字段。
- `tanjia-eu-DE`（SID `17307`）必须存在于新鲜的运行时店铺目录；EU 合并仓 `sid=0` 继续使用既有 `seller_group_name` 归属。
- 不手改 `styles.css`，不新增 CSS token；复用既有按钮样式并运行 `npm run build:css` 验证生成目标。
- 所有成本刷新日志只记录月份、SID、店铺、MSKU、内部 SKU、阶段、计数和字段名，绝不记录密钥或完整上游响应。

---

### Task 1: 使历史库存加载器可被显式刷新安全复用

**Files:**
- Modify: `src/services/inventoryProvisionService.js:1472-1602`
- Modify: `test/inventoryProvisionService.test.js`

**Interfaces:**
- Produces: `loadHistoricalInventoryRows(month, { adapter, sellers, forceRefresh, persist })`，返回当前已有的 `{ rows, rawCount, ledgerCount, matchedRows, ... }`。
- Consumes: `getSharedSellers`, `filterCoreSellers`, `saveInventoryProvisionHistoryCache`, `readInventoryProvisionHistoryCache`。
- Guarantees: `forceRefresh: true` 跳过月份缓存；`persist: false` 不写任何历史缓存；普通看板仍使用默认 `{ forceRefresh: false, persist: true }`。

- [ ] **Step 1: 写出失败测试，锁定强制重载不会读写旧缓存**

  在 `test/inventoryProvisionService.test.js` 增加测试，注入一个含美国和德国 `tanjia-eu-DE / 17307` 的 seller 列表以及领星历史库存、分类账和 Listing 响应；断言 `forceRefresh: true, persist: false` 返回德国库存行，同时不调用 `readInventoryProvisionHistoryCache` 与 `saveInventoryProvisionHistoryCache`。

  ```js
  test("historical inventory refresh bypasses the month cache and keeps Germany", async () => {
    const result = await loadHistoricalInventoryRows("2026-05", {
      forceRefresh: true,
      persist: false,
      sellers: [{ sid: 17307, seller_id: "A-DE", name: "tanjia-eu-DE", country: "德国", countryCode: "DE" }],
      adapter: fakeHistoricalAdapter,
      readHistoryCache: async () => { throw new Error("cache must not be read"); },
      saveHistoryCache: async () => { throw new Error("cache must not be written"); },
    });
    assert.equal(result.rows[0].sid, 17307);
    assert.equal(result.rows[0].storeName, "tanjia-eu-DE");
  });
  ```

- [ ] **Step 2: 运行测试，确认它因缺少可注入加载接口而失败**

  Run: `node --test test/inventoryProvisionService.test.js`

  Expected: FAIL，导入的 `loadHistoricalInventoryRows` 不存在，或测试无法控制历史缓存路径。

- [ ] **Step 3: 提取历史加载函数并保留默认行为**

  将私有 `loadHistoricalInventoryRowsFromLingxing(selectedMonth)` 重命名并导出为：

  ```js
  export async function loadHistoricalInventoryRows(selectedMonth, {
    adapter = getLingxingAdapter(),
    sellers = null,
    getSellers = getSharedSellers,
    readHistoryCache = readInventoryProvisionHistoryCache,
    saveHistoryCache = saveInventoryProvisionHistoryCache,
    forceRefresh = false,
    persist = true,
  } = {}) { /* existing FBA report + 10-month ledger reconstruction */ }
  ```

  只有 `!forceRefresh` 时才读取版本匹配缓存；未传 `sellers` 时获取并 `filterCoreSellers` 运行时目录；仅 `persist` 为真时写缓存。把现有看板和对比月调用替换为该函数的默认调用，保持当前页面行为不变。

- [ ] **Step 4: 运行目标测试，确认通过**

  Run: `node --test test/inventoryProvisionService.test.js`

  Expected: PASS，既有归一化、FIFO 与计提测试继续通过。

- [ ] **Step 5: 提交这一独立重构**

  ```bash
  git add src/services/inventoryProvisionService.js test/inventoryProvisionService.test.js
  git commit -m "refactor: expose refreshable inventory history loader"
  ```

### Task 2: 实现产品管理成本刷新服务

**Files:**
- Create: `src/services/inventoryProvisionCostRefreshService.js`
- Modify: `src/services/inventoryProvisionService.js:1-16,1472-1602,1770-1796`
- Modify: `test/inventoryProvisionService.test.js`
- Create: `test/inventoryProvisionCostRefreshService.test.js`

**Interfaces:**
- Produces: `createInventoryProvisionCostRefreshService(dependencies).refresh({ date })` 与默认导出函数 `refreshInventoryProvisionCosts({ date })`。
- Input date: exact `YYYY-MM`, strictly before Pacific current month and no earlier than the provision comparison baseline.
- Output: `{ date, comparisonMonth, refreshedAt, months: [{ month, rows, updatedRows, listingMatches, productMatches }], diagnostics }`。
- Consumes: Task 1 的 `loadHistoricalInventoryRows`, `saveInventoryProvisionHistoryCache`, `getSharedSellers({ forceRefresh: true })`, `fetchLingxingListingsBySidMskus`, `fetchLingxingProductRecords`。

- [ ] **Step 1: 写出失败测试，定义成功刷新和德国路径**

  新建 `test/inventoryProvisionCostRefreshService.test.js`。用依赖注入避免真实领星调用：历史加载器返回 `2026-05`、`2026-04` 的同一德国 MSKU 批次；Listing 返回 `seller_sku: "JMDE-HJ825A", local_sku: "TJ-DE-001"`；产品管理返回 `purchase_price: "12.5", unit_first_leg_fee: "3.2"`。断言两个待保存月份都包含 `purchaseCost: 12.5`、`firstLegCost: 3.2` 和成本元数据，且 fresh seller directory 被以 `forceRefresh: true` 调用。

  ```js
  const result = await service.refresh({ date: "2026-05" });
  assert.deepEqual(saved.map(({ month }) => month), ["2026-04", "2026-05"]);
  assert.equal(saved[1].data.rows[0].purchaseCost, 12.5);
  assert.equal(saved[1].data.rows[0].firstLegCost, 3.2);
  assert.equal(result.months[1].updatedRows, 1);
  ```

- [ ] **Step 2: 增加失败测试，锁定不覆盖旧缓存的边界**

  在同一测试文件增加三个独立用例：

  ```js
  await assert.rejects(() => service.refresh({ date: "2026-05" }), /产品管理.*单位头程成本/);
  assert.equal(saved.length, 0);
  ```

  分别覆盖：缺 `local_sku`、产品记录不存在、产品记录缺采购成本或单位头程成本；并覆盖新鲜店铺目录没有 `17307` 时抛出带 SID 的明确错误。每个用例都断言缓存保存函数未被调用。

- [ ] **Step 3: 运行测试，确认服务尚不存在而失败**

  Run: `node --test test/inventoryProvisionCostRefreshService.test.js`

  Expected: FAIL，模块或 `createInventoryProvisionCostRefreshService` 尚不存在。

- [ ] **Step 4: 最小实现完整的数据映射与失败诊断**

  在新服务中实现以下顺序，所有网络调用均通过注入依赖：

  1. 验证 `date` 格式、历史月限制及比较月。
  2. `getSharedSellers({ forceRefresh: true })` 后 `filterCoreSellers`；缺少 `sid === 17307` 时抛错。
  3. 对比较月和目标月调用 Task 1 接口，传入同一新鲜 sellers、`forceRefresh: true`、`persist: false`。
  4. 以唯一 `sid + msku` 批量调用 Listing；只接受匹配的 `local_sku` / `localSku` / `sku`。
  5. 用内部 SKU 批量调用产品管理；采购成本按 `purchase_price`, `purchasePrice`, `purchase_cost`, `purchaseCost`, `cg_price`, `unit_cg_price`, `unit_purchase_cost`, `product_purchase_cost`, `local_purchase_cost` 读取；单位头程按 `unit_first_leg_fee`, `first_leg_cost`, `firstLegCost`, `first_transport_fee`, `head_cost`, `unit_head_cost`, `unit_shipping_cost`, `freight_cost`, `cg_transport_costs`, `unit_cg_transport_costs` 读取。
  6. 为每条库存批次覆盖两个成本字段，添加 `costSource: "lingxing-product-management"`、`costRefreshedAt`、`costRefreshMonth`、`costRefreshSummary`；缺任一映射或成本字段则收集结构化诊断并在写入前统一抛错。
  7. 仅在所有两个月行均通过校验后，按月份升序调用 `saveInventoryProvisionHistoryCache`；写入错误必须带 `writtenMonths` / `pendingMonths` 后重新抛出，不能返回成功。

  同时在 `getInventoryProvisionDashboard` 的 `meta` 传递 `costRefreshedAt` 和刷新摘要，使 UI 能显示实际成本刷新时间。

- [ ] **Step 5: 运行服务和现有库存测试，确认通过**

  Run: `node --test test/inventoryProvisionCostRefreshService.test.js test/inventoryProvisionService.test.js`

  Expected: PASS；所有失败路径均没有调用保存，德国行使用规范 SID。

- [ ] **Step 6: 提交成本刷新服务**

  ```bash
  git add src/services/inventoryProvisionCostRefreshService.js src/services/inventoryProvisionService.js test/inventoryProvisionCostRefreshService.test.js test/inventoryProvisionService.test.js
  git commit -m "feat: refresh historical inventory provision costs"
  ```

### Task 3: 增加财务受限的刷新 API 路由

**Files:**
- Modify: `routes/inventory.js:1-53`
- Modify: `server.js:45-50,815-823`
- Modify: `test/serverRoutesStructure.test.js`

**Interfaces:**
- Produces: `POST /api/dashboard/inventory-provision/refresh-costs`，`auth: "finance"`。
- Request: JSON `{ "date": "2026-05" }`。
- Response: `200 { ok: true, refresh: RefreshResult }`；输入/刷新错误遵循现有 dispatch 的安全 JSON 错误响应。
- Consumes: `readJsonBody`, `sendJson`, `refreshInventoryProvisionCosts`。

- [ ] **Step 1: 写出失败的路由结构与转发测试**

  在 `test/serverRoutesStructure.test.js` 增加：路由表包含 POST 路径且 `auth === "finance"`；调用 handler 时 `readJsonBody` 的 `date` 被原样传给注入的 `refreshInventoryProvisionCosts`，并以 `{ ok: true, refresh }` 返回。

  ```js
  const route = createInventoryRoutes({
    readJsonBody: async () => ({ date: "2026-05" }),
    refreshInventoryProvisionCosts: async (input) => ({ ...input, months: [] }),
    sendJson: (_res, status, body) => received = { status, body },
  }).find((item) => item.path === "/api/dashboard/inventory-provision/refresh-costs");
  assert.equal(route.auth, "finance");
  ```

- [ ] **Step 2: 运行测试，确认新路由尚未注册而失败**

  Run: `node --test test/serverRoutesStructure.test.js`

  Expected: FAIL，找不到刷新成本路由。

- [ ] **Step 3: 最小实现路由和服务注入**

  在 `server.js` 导入 `refreshInventoryProvisionCosts`，放入 `buildApiRoutes` 依赖对象；在 `routes/inventory.js` 解构该依赖，新增 POST 路由并使用 `await readJsonBody(req)`。不在 `server.js` 添加 feature-specific 路由分支。

- [ ] **Step 4: 运行路由与语法检查**

  Run: `node --test test/serverRoutesStructure.test.js && npm run check:js`

  Expected: PASS。

- [ ] **Step 5: 提交 API 路由**

  ```bash
  git add routes/inventory.js server.js test/serverRoutesStructure.test.js
  git commit -m "feat: add inventory provision cost refresh API"
  ```

### Task 4: 在库存计提页面提供明确的刷新成本操作

**Files:**
- Modify: `index.html:1308-1320`
- Modify: `assets/js/features/inventory-provision.js:1-24,200-230,308-380`
- Modify: `test/inventoryProvisionFeature.test.js`
- Modify: `test/frontendStructure.test.js:1269-1276`

**Interfaces:**
- Adds: `#inventory-provision-refresh-costs` 原生 `<button type="button">`。
- Adds: feature method `refreshInventoryProvisionCosts()`。
- Calls: `POST /api/dashboard/inventory-provision/refresh-costs` with JSON `{ date }`; after success calls existing `loadInventoryProvision()`.
- Current month: the button is disabled and status explains current月使用实时 FBA 成本；history month button enabled。

- [ ] **Step 1: 写出失败的前端行为测试**

  在 `test/inventoryProvisionFeature.test.js` 扩展 `createFeature` 注入：可变的日期 input、按钮对象、`fetchImpl` 记录调用。测试历史月点击处理会发送：

  ```js
  assert.deepEqual(fetchCalls[0], [
    "/api/dashboard/inventory-provision/refresh-costs",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-05" }) },
  ]);
  ```

  并断言成功时重新加载看板、状态文本含更新/匹配计数；当前月调用不发请求且按钮为 disabled；API 失败时当前表格不会被 `renderTableMessage` 清空。更新绑定断言，要求新按钮只绑定一次。

- [ ] **Step 2: 运行测试，确认按钮和方法尚不存在而失败**

  Run: `node --test test/inventoryProvisionFeature.test.js`

  Expected: FAIL，绑定列表和 feature 方法不匹配。

- [ ] **Step 3: 实现语义按钮、确认、busy 与状态渲染**

  在 hero actions 中放入次要按钮 `#inventory-provision-refresh-costs`，按钮文本“刷新成本”；添加简短可见说明到现有 `#inventory-provision-date-note`/状态区域，不新增专属 CSS。

  在 feature 模块中：

  - 复用 `setButtonBusy`、`fieldValue`、`setText` 和现有 `fetchImpl` 注入；不将事件绑定移回 `app.js`。
  - 若月份等于 `getDefaultMonth()`，禁用按钮并显示“当前月为实时 FBA 成本，不能回算产品管理成本”。
  - 历史月执行前使用 `globalThis.confirm` 显示“将用产品管理当前成本回算 {month} 及上月，覆盖历史成本缓存”；用户取消不发请求。
  - 成功显示服务返回的目标月、比较月、更新行数和刷新时间，然后调用 `loadInventoryProvision()`；失败仅更新状态，不清空已渲染数据。
  - 在 `renderInventoryProvision` 中将 `meta.costRefreshedAt` 附加到历史月缓存说明，确保用户可区分“历史库存缓存时间”和“成本刷新时间”。

- [ ] **Step 4: 运行前端单元与结构测试**

  Run: `node --test test/inventoryProvisionFeature.test.js test/frontendStructure.test.js`

  Expected: PASS，且结构测试继续保证 feature 自己拥有事件绑定。

- [ ] **Step 5: 构建 CSS、检查前端语法并进行浏览器验证**

  Run:

  ```bash
  npm run build:css
  npm run check:js
  npm run dev
  ```

  使用已认证的本地浏览器或 Playwright：打开库存计提，选择 `2026-05`，检查刷新成本按钮可通过 Tab 聚焦和 Enter 触发；确认请求为 POST 且 body 是选中月份；验证成功状态包含成本刷新时间；选择当前月时按钮禁用；在德国筛选中确认 `tanjia-eu-DE` 可选。检查桌面和窄视口截图无溢出、无控制台错误。结束本地服务后继续。

- [ ] **Step 6: 提交页面实现**

  ```bash
  git add index.html assets/js/features/inventory-provision.js test/inventoryProvisionFeature.test.js test/frontendStructure.test.js
  git commit -m "feat: add inventory provision cost refresh control"
  ```

### Task 5: 完整验证与文档收尾

**Files:**
- Modify if factual behavior differs: `README.md:47`
- Verify: `docs/superpowers/specs/2026-08-11-inventory-provision-cost-refresh-design.md`

**Interfaces:**
- Preserves: README 的库存计提数据来源描述与实现一致。

- [ ] **Step 1: 更新真实数据口径说明（如实现与 README 不同）**

  仅当 Task 2 实际的产品管理字段名或当前月限制与 README 现有文字不同，补充“历史月可由财务用户显式以产品管理当前成本回算，并会同时刷新比较月；失败不覆盖缓存”的一句说明。不要记录接口密钥、真实店铺以外的敏感数据或不确定字段。

- [ ] **Step 2: 运行完整自动化验证**

  Run:

  ```bash
  npm test
  npm run check
  git diff --check
  ```

  Expected: 全部 PASS，`git diff --check` 无输出。

- [ ] **Step 3: 审查工作区与提交完成的文档变更**

  Run:

  ```bash
  git status --short
  git log --oneline --decorate -6
  ```

  Expected: 无与本功能无关的修改；README 若被修改则单独提交。

- [ ] **Step 4: 最终提交（若 README 被修改）**

  ```bash
  git add README.md
  git commit -m "docs: document inventory provision cost refresh"
  ```

## Plan Self-Review

- **Spec coverage:** Task 1 解决强制历史源读取；Task 2 覆盖 Listing→产品管理、德国、缓存和失败诊断；Task 3 覆盖财务权限 API；Task 4 覆盖可访问 UI 与浏览器检查；Task 5 覆盖文档和全量验证。
- **No placeholders:** 每个任务指定文件、接口、先失败再实现的测试命令和期望结果；没有 TBD/TODO 或“适当处理”的未定义动作。
- **Type consistency:** 路由调用 `refreshInventoryProvisionCosts({ date })`；服务通过 `loadHistoricalInventoryRows(month, options)` 取得行并通过 `saveInventoryProvisionHistoryCache(month, data)` 持久化；前端仅传 `{ date }` 后再用既有 GET 重载筛选结果。

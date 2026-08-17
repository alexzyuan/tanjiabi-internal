# 库存计提当前月刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“刷新计提”安全重建当前选中的历史月份，并在成功前保留可回退的旧缓存。

**Architecture:** `inventoryProvisionRefreshService` 协调旧缓存读取、强制 FIFO 重建（不落盘）、备份和原子写入。显式财务权限 POST 调用服务；页面成功后沿用普通 GET 读取已更新的筛选视图，普通加载不会写缓存。

**Tech Stack:** Node.js ESM、node:test、原子 JSON 文件存储、原生 HTML/JavaScript。

---

## File Structure

- `src/utils/cacheStore.js`: 月度历史缓存备份与每月 5 份保留。
- `src/services/inventoryProvisionRefreshService.js`: 单月刷新事务、验证、日志。
- `server.js`, `routes/inventory.js`: 注入服务和财务权限 POST。
- `assets/js/features/inventory-provision.js`: 显式刷新交互；保留普通 GET 加载。
- `test/cacheStore.test.js`, `test/inventoryProvisionRefreshService.test.js`, `test/serverRoutesStructure.test.js`, `test/inventoryProvisionFeature.test.js`: 行为测试。

### Task 1: 缓存备份原语

**Files:** Modify `src/utils/cacheStore.js`; Test `test/cacheStore.test.js`

- [ ] **Step 1: 写失败测试**

```js
test("inventory provision history backup preserves current cache", async () => {
  await withTempProject(async (projectRoot) => {
    const store = await importFresh(projectRoot, "src/utils/cacheStore.js");
    await store.saveInventoryProvisionHistoryCache("2026-07", { rows: [{ msku: "JM-9006Truck", quantity: 27 }] });
    const backup = await store.backupInventoryProvisionHistoryCache("2026-07", { operationId: "refresh-1" });
    assert.equal(backup.created, true);
    assert.equal(backup.month, "2026-07");
    assert.deepEqual(backup.cached.data.rows, [{ msku: "JM-9006Truck", quantity: 27 }]);
  });
});
```

- [ ] **Step 2: 确认 RED**

Run: `node --test test/cacheStore.test.js`

Expected: FAIL, `backupInventoryProvisionHistoryCache is not a function`.

- [ ] **Step 3: 最小实现**

新增 `inventoryProvisionHistoryBackupDir`。`backupInventoryProvisionHistoryCache(month, { operationId })` 调用正式读取器；没有旧缓存时返回 `{ created: false, month, operationId, cached: null }`。有旧缓存时用 `writeJsonAtomic` 在 `inventory-provision-history-backups/<month hash>/` 写入月、操作 ID、备份时间、旧缓存时间和完整 `cached` 包装对象；写完后只删除同月超过 5 份的最旧备份。文件系统异常必须抛出。

```js
const backup = { month, operationId, createdAt: new Date().toLocaleString("zh-CN", { hour12: false }), previousCacheUpdatedAt: cached.updatedAt || "", cached };
await writeJsonAtomic(backupPath, backup);
return { created: true, month, operationId, previousCacheUpdatedAt: backup.previousCacheUpdatedAt, cached };
```

- [ ] **Step 4: 确认 GREEN 并提交**

Run: `node --test test/cacheStore.test.js`

Expected: PASS.

```bash
git add src/utils/cacheStore.js test/cacheStore.test.js && git commit -m "feat: back up inventory history before refresh"
```

### Task 2: 单月受保护刷新服务

**Files:** Create `src/services/inventoryProvisionRefreshService.js`; Test `test/inventoryProvisionRefreshService.test.js`

- [ ] **Step 1: 写失败测试**

```js
test("selected-month refresh rebuilds before backup and cache write", async () => {
  const calls = [];
  const service = createInventoryProvisionRefreshService({
    todayText: () => "2026-08-17",
    readHistoryCache: async () => ({ data: { rows: [{ quantity: 27 }] } }),
    rebuildHistory: async (month, options) => { calls.push(["rebuild", month, options]); return { rows: [{ quantity: 27 }], rawCount: 1, ledgerCount: 10, matchedRows: 1 }; },
    backupHistoryCache: async (month) => { calls.push(["backup", month]); return { created: true }; },
    saveHistoryCache: async (month) => { calls.push(["save", month]); },
  });
  const result = await service.refresh({ date: "2026-07" });
  assert.equal(result.backupCreated, true);
  assert.deepEqual(calls.map(([name]) => name), ["rebuild", "backup", "save"]);
  assert.deepEqual(calls[0].slice(1), ["2026-07", { forceRefresh: true, persist: false }]);
});
```

另写两个测试：重建报“FIFO 生成了非整数批次数量”时 backup/save 都不能调用；当前月报“当前月仅支持实时库存读取，不能重建月末历史计提”。

- [ ] **Step 2: 确认 RED**

Run: `node --test test/inventoryProvisionRefreshService.test.js`

Expected: FAIL, 模块不存在.

- [ ] **Step 3: 最小实现**

```js
const rebuilt = await rebuildHistory(month, { forceRefresh: true, persist: false });
const backup = await backupHistoryCache(month, { operationId });
await saveHistoryCache(month, rebuilt);
return { operationId, month, backupCreated: backup.created, previousCacheExists: Boolean(previous), ...rebuilt };
```

`validateHistoricalMonth` 必须严格校验 `YYYY-MM` 并拒绝当前月和未来月。catch 日志必须包含 operation ID、月份、阶段、旧缓存是否存在、是否已备份、错误文本；刷新失败原样抛出，绝不返回旧缓存作为成功结果。

- [ ] **Step 4: 确认 GREEN 并提交**

Run: `node --test test/inventoryProvisionRefreshService.test.js test/inventoryProvisionService.test.js`

Expected: PASS.

```bash
git add src/services/inventoryProvisionRefreshService.js test/inventoryProvisionRefreshService.test.js && git commit -m "feat: refresh selected inventory provision month"
```

### Task 3: 财务权限 POST 路由

**Files:** Modify `server.js`, `routes/inventory.js`; Test `test/serverRoutesStructure.test.js`

- [ ] **Step 1: 写失败测试**

```js
test("inventory provision refresh route is finance-protected and forwards selected month", async () => {
  let received = null;
  const route = createInventoryRoutes({
    readJsonBody: async () => ({ date: "2026-07" }),
    refreshInventoryProvisionMonth: async (value) => { received = value; return { month: "2026-07", backupCreated: true }; },
    sendJson: () => {},
  }).find((item) => item.path === "/api/dashboard/inventory-provision/refresh");
  assert.equal(route?.method, "POST");
  assert.equal(route?.auth, "finance");
  await route.handler({ req: {}, res: {} });
  assert.deepEqual(received, { date: "2026-07" });
});
```

- [ ] **Step 2: 确认 RED**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: FAIL, 路由未找到.

- [ ] **Step 3: 最小实现**

`server.js` 只注入 `refreshInventoryProvisionMonth`。`routes/inventory.js` 增加以下路由，业务逻辑留在刷新服务：

```js
{ method: "POST", path: "/api/dashboard/inventory-provision/refresh", auth: "finance", errorStatusCode: 502,
  handler: async ({ req, res }) => {
    const payload = await readJsonBody(req);
    const refresh = await refreshInventoryProvisionMonth({ date: payload?.date });
    sendJson(res, 200, { ok: true, refresh });
  },
}
```

- [ ] **Step 4: 确认 GREEN 并提交**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: PASS.

```bash
git add server.js routes/inventory.js test/serverRoutesStructure.test.js && git commit -m "feat: expose inventory provision refresh route"
```

### Task 4: 页面按钮接入

**Files:** Modify `assets/js/features/inventory-provision.js`; Test `test/inventoryProvisionFeature.test.js`

- [ ] **Step 1: 写失败测试**

```js
test("inventory provision refresh posts selected month then reloads dashboard", async () => {
  const elements = new Map([["#inventory-provision-date", { value: "2026-07" }], ["#inventory-provision-refresh", { textContent: "刷新计提" }]]);
  const calls = [];
  let reloads = 0;
  const { feature } = createFeature({
    root: { querySelector: (key) => elements.get(key) || null }, fieldValue: (key) => elements.get(key)?.value || "", confirmImpl: () => true,
    fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ refresh: { month: "2026-07", backupCreated: true, rawCount: 77, ledgerCount: 817, rows: [] } }) }; },
    loadDashboardSection: async () => { reloads += 1; },
  });
  await feature.refreshInventoryProvision();
  assert.deepEqual(calls, [["/api/dashboard/inventory-provision/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-07" }) }]]);
  assert.equal(reloads, 1);
});
```

再写失败测试：HTTP 422 `{ error: "当前月仅支持实时库存读取" }` 不重新加载，状态为 `库存计提刷新失败：当前月仅支持实时库存读取`。

- [ ] **Step 2: 确认 RED**

Run: `node --test test/inventoryProvisionFeature.test.js`

Expected: FAIL, `refreshInventoryProvision is not a function`.

- [ ] **Step 3: 最小实现**

新增 `refreshInventoryProvision`：确认文案说明会从领星重建所选月的库存、库龄和 FIFO，且旧缓存先备份；以 POST 发送 `{ date }`；成功后调用 `loadInventoryProvision()` 并显示刷新月、原始库存数、分类账数、批次数和备份状态；失败不改表格。把 `#inventory-provision-refresh` 的绑定从 `loadInventoryProvision` 改为新函数，并在 feature 返回对象公开它。

- [ ] **Step 4: 确认 GREEN 并提交**

Run: `node --test test/inventoryProvisionFeature.test.js`

Expected: PASS.

```bash
git add assets/js/features/inventory-provision.js test/inventoryProvisionFeature.test.js && git commit -m "feat: make inventory provision refresh rebuild selected month"
```

### Task 5: 回归与受保护发布

**Files:** Verify only.

- [ ] **Step 1: 运行定向测试**

Run: `node --test test/cacheStore.test.js test/inventoryProvisionRefreshService.test.js test/inventoryProvisionService.test.js test/inventoryProvisionFeature.test.js test/serverRoutesStructure.test.js`

Expected: PASS, 0 failures.

- [ ] **Step 2: 运行完整检查**

Run: `npm test && npm run check && git diff --check`

Expected: 全量通过且无空白错误.

- [ ] **Step 3: 等待明确部署授权**

从整洁、已提交 `main` 执行 `DEPLOY_CONFIRM_BRANCH=main npm run package:deploy`；使用既有部署脚本的库存计提缓存快照与完整性检查，不得手工复制运行时文件。

## Plan Self-Review

- Spec coverage：任务 1 是备份与保留，任务 2 是成功后才写入与日志，任务 3 是财务权限 POST，任务 4 是页面语义，任务 5 是回归和受保护发布。
- Placeholder scan：没有 TBD、TODO 或未定义的“适当处理”。
- Type consistency：前端、路由和服务都用 `{ date: "YYYY-MM" }`；返回使用 `{ ok: true, refresh }`；备份使用 `operationId`。

# 库存计提早期历史月成本刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 2026 年 1 月至 3 月可按产品管理最新成本刷新，并在成功后清晰显示成本缓存刷新时间。

**Architecture:** 成本刷新服务按计提月度变动起始月决定是否需要比较月：4 月及以后保留比较月重算，1 月至 3 月只重算目标月。前端复用服务返回的 `refreshedAt`，在状态与历史说明展示一致的缓存刷新时间。

**Tech Stack:** Node.js ESM、原生 JavaScript、`node:test`。

---

### Task 1: 放开早期历史月的成本刷新范围

**Files:**
- Modify: `src/services/inventoryProvisionCostRefreshService.js:80-104`
- Modify: `test/inventoryProvisionCostRefreshService.test.js`

- [ ] **Step 1: 写出失败测试**

```js
test("cost refresh rebuilds only the selected month before provision movement starts", async () => {
  const fixture = createServiceDependencies();
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);
  const result = await service.refresh({ date: "2026-01" });
  assert.deepEqual(fixture.calls.history.map((call) => call.month), ["2026-01"]);
  assert.deepEqual(fixture.saved.map(({ month }) => month), ["2026-01"]);
  assert.equal(result.comparisonMonth, "");
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/inventoryProvisionCostRefreshService.test.js`

Expected: FAIL，服务拒绝 `2026-01`，提示仅支持 `2026-04` 及之后月份。

- [ ] **Step 3: 最小实现**

删除早期月份拒绝逻辑。以常量 `2026-04` 判断比较月：目标月小于该月时 `months = [targetMonth]` 且结果 `comparisonMonth = ""`；其他历史月保持 `[previousMonth, targetMonth]` 的现有顺序。

- [ ] **Step 4: 运行服务测试**

Run: `node --test test/inventoryProvisionCostRefreshService.test.js`

Expected: PASS，原有德国店铺、缺成本和写入保护测试不变。

### Task 2: 显示成本缓存刷新时间

**Files:**
- Modify: `assets/js/features/inventory-provision.js:225-240,364-401`
- Modify: `test/inventoryProvisionFeature.test.js`

- [ ] **Step 1: 写出失败测试**

```js
assert.match(statuses.at(-1)[1], /成本缓存刷新时间：2026\\/8\\/13 10:00:00/);
```

并在渲染历史月元数据的测试中断言说明文本包含同一前缀与 `data.meta.costRefreshedAt`。

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/inventoryProvisionFeature.test.js`

Expected: FAIL，当前成功文案只显示无标签的时间，历史说明使用“成本刷新”。

- [ ] **Step 3: 最小实现**

将历史说明改为 `成本缓存刷新时间：${costRefreshedAt}`；将成功状态改为包含同一标签。当服务没有比较月时，成功状态只显示目标月份，不显示“与上月”。

- [ ] **Step 4: 运行前端测试与静态检查**

Run: `node --test test/inventoryProvisionFeature.test.js && npm run check:js`

Expected: PASS。

### Task 3: 完整验证与部署

**Files:**
- Modify: `README.md:47`

- [ ] **Step 1: 更新运行说明**

明确所有历史月可刷新成本，只有 2026 年 4 月及以后会同步刷新上月；页面会显示成本缓存刷新时间。

- [ ] **Step 2: 全量验证**

Run: `npm test && npm run check && git diff --check`

Expected: 全部通过。

- [ ] **Step 3: 合并、推送并部署**

将已验证分支合并到最新 `main`，推送 `origin/main`，使用 `DEPLOY_CONFIRM_BRANCH=main npm run package:deploy` 生成包，上传至 `/opt/tanjia-bi/tanjia-bi-deploy.tar.gz` 并执行 `bash deploy.sh`；确认 `/api/health` 与部署完整性检查通过。

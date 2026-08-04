# 店铺经营月报按店铺列展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让店铺经营月报在选择店铺时按店铺横向展示四项指标，未选择时展示全部店铺总计，并让 Excel 导出保持同样的分组结构。

**Architecture:** 后端把领星订单利润与预算目标按展示范围、店铺和币种构造成统一 `groups`，每组继续复用现有科目树 mapper。前端以 `groups` 为列分组、以 `row.key` 为行身份合并横向单元格；导出直接消费同一服务结果，避免重复计算。

**Tech Stack:** Node.js ES modules、原生 HTML/CSS/JS、node:test、XLSX、现有 data-table-manager/table-sorter。

---

### Task 1: 扩展服务分组模型与预算匹配

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Test: `test/storeOperatingMonthlyReportService.test.js`

- [ ] **Step 1: Write failing service tests**

覆盖三个契约：选中 A/B 时返回 `A`、`B` 两个 CNY 分组；未选店铺时返回一个 `全部店铺` 分组；单国家原币模式下同店铺的 USD/CAD 分组都保留，并且预算只匹配对应店铺/币种。

- [ ] **Step 2: Run service tests and verify the new assertions fail**

Run: `node --test test/storeOperatingMonthlyReportService.test.js`

Expected: 新增的分组标题/分组数量断言失败，现有实现仍按币种聚合。

- [ ] **Step 3: Implement scoped grouping**

在 `getStoreOperatingMonthlyReport` 中先建立展示 scopes：有 `filters.stores` 时每个 seller 一个 scope；否则一个 `{ storeName: "全部店铺", sellers }` scope。记录按 scope 的 seller SID 过滤；CNY 模式按 scope 汇总全部记录，ORIGINAL 模式再按币种拆分。扩展预算 helper，使预算转换/原币匹配接收 scope 店铺集合；每个 group 返回 `storeName`、`storeScope`、`currencyCode`、`currencyAvailable`、`rows`。

- [ ] **Step 4: Run service tests**

Run: `node --test test/storeOperatingMonthlyReportService.test.js`

Expected: 新增测试与既有服务测试全部 PASS。

- [ ] **Step 5: Commit backend grouping**

```bash
git add src/services/storeOperatingMonthlyReportService.js test/storeOperatingMonthlyReportService.test.js
git commit -m "feat: group monthly report by store"
```

### Task 2: 让 Excel 导出使用动态店铺分组表头

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Test: `test/storeOperatingMonthlyReportService.test.js`

- [ ] **Step 1: Write failing export assertions**

构造两个 group，断言工作表前两行分别为左侧 `分类/名称`、每个店铺四列指标，且数据行按同一科目横向输出；断言 `全部店铺` 也能正常导出。

- [ ] **Step 2: Run the focused export test and verify failure**

Run: `node --test test/storeOperatingMonthlyReportService.test.js --test-name-pattern="export"`

Expected: 旧的纵向 `币种/分类/科目` 表头断言失败。

- [ ] **Step 3: Implement dynamic export rows**

新增导出叶子列构造 helper：左侧 `分类`、`名称`，每个 group 追加四项指标；按首个 group 的 `row.key` 顺序生成行，其他 group 通过 key 查找，缺失值写入 `—`。工作表使用两行表头，保留筛选、列宽和报表说明。

- [ ] **Step 4: Run export and full service tests**

Run: `node --test test/storeOperatingMonthlyReportService.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: Commit export changes**

```bash
git add src/services/storeOperatingMonthlyReportService.js test/storeOperatingMonthlyReportService.test.js
git commit -m "feat: export monthly report store columns"
```

### Task 3: 实现前端动态两级表头与横向渲染

**Files:**
- Modify: `assets/js/features/store-operating-monthly-report.js`
- Modify: `index.html`
- Test: `test/storeOperatingMonthlyReportFeature.test.js`

- [ ] **Step 1: Write failing DOM tests**

断言有两个 group 时生成两行表头、每个 group 有四个叶子指标；断言未选店铺时标题显示 `全部店铺`；断言数据行只出现一次科目名称并横向出现各组实际/预算值；空数据的 colspan 等于动态叶子列数。

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run: `node --test test/storeOperatingMonthlyReportFeature.test.js`

Expected: 现有固定六列表头与纵向 group 行渲染无法满足新增断言。

- [ ] **Step 3: Implement shared frontend group helpers**

新增 `reportColumnGroups(data, filters)` 与 `rowMapByKey(group)`；`renderHeader` 输出 rowspan/colspan 两级表头；`renderRows` 以第一组 rows 的顺序渲染，每行按组读取同一 `row.key` 的四项指标。折叠 key 改为 `groupIdentity:categoryKey`，空态和错误态使用动态列数。

- [ ] **Step 4: Update sorting and managed-table metadata**

叶子列使用稳定 `data-column-key`（组身份 + 指标），排序按点击叶子列对应的组和指标比较分类行，仍保持分类块与子行相邻；保留 `data-column-profile="money-rate"`。更新 index.html 初始空态为两列左侧 + 一个四列占位组。

- [ ] **Step 5: Run frontend tests**

Run: `node --test test/storeOperatingMonthlyReportFeature.test.js test/frontendStructure.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: Commit frontend changes**

```bash
git add assets/js/features/store-operating-monthly-report.js index.html test/storeOperatingMonthlyReportFeature.test.js
git commit -m "feat: render monthly report columns by store"
```

### Task 4: 全量验证与部署合并

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Run project checks**

Run: `npm run check`

Expected: exit code 0。

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: exit code 0，0 failures。

- [ ] **Step 3: Run browser verification**

启动本地服务，用 Playwright/in-app browser 检查月报桌面与窄屏：动态两级表头、横向滚动、店铺筛选、全部店铺标题、月份自动刷新、控制台无错误。

- [ ] **Step 4: Merge into production branch**

确认工作树干净后切回 `codex/yesterday-plus-webhook`，合并本分支，运行合并后的检查。

- [ ] **Step 5: Build guarded deploy package and deploy**

按 `scripts/package-deploy.js` 的分支确认要求生成包含 `.deploy-manifest.json` 的 CSS 构建包，通过 `deploy.sh` 部署到 `/opt/tanjia-bi`；不得手工复制运行时文件绕过部署守卫。

- [ ] **Step 6: Verify production health and report commit/deploy evidence**

检查生产健康接口和月报 API 响应，记录部署分支、提交和验证结果。

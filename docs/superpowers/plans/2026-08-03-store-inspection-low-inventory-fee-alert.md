# 店铺巡检低库存费强调提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将每日巡检的低库存费 MSKU 提示改为红色加粗，并追加“已产生附加费，请及时关注”。

**Architecture:** 只扩展 `buildStoreReportSection` 中已有的低库存费日报行。MSKU 选择、顺序、去重和无 MSKU 时的省略规则不变；使用钉钉 Markdown 的内联字体标签包裹加粗文案。

**Tech Stack:** Node.js ESM、Node test runner、钉钉 Markdown。

---

### Task 1: Update the report line with a regression test

**Files:**
- Modify: `test/storeInspectionService.test.js`
- Modify: `src/services/storeInspectionService.js`

- [ ] **Step 1: Write the failing report-format test**

Update the existing fee-only store Markdown test to require:

```js
assert.match(markdown, /- <font color="#D7373F">\*\*本周低库存费 MSKU：FEE-2、FEE-1，已产生附加费，请及时关注。\*\*<\/font>/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/storeInspectionService.test.js`

Expected: FAIL because the current line is plain Markdown text ending after the MSKU list.

- [ ] **Step 3: Implement only the confirmed format**

Replace the existing low-inventory-fee report line with:

```js
lowInventoryFeeMskus.length
  ? `- <font color="#D7373F">**本周低库存费 MSKU：${lowInventoryFeeMskus.join("、")}，已产生附加费，请及时关注。**</font>`
  : "",
```

Do not modify low-inventory-fee eligibility, report collection, mention targeting, notification sending, UI rendering, or any other report line.

- [ ] **Step 4: Run verification**

Run: `node --test test/storeInspectionService.test.js && npm test && npm run check && git diff --check`

Expected: all tests pass, generated CSS is current and the diff has no whitespace errors.

- [ ] **Step 5: Commit and deploy through repository guards**

Commit the two implementation files and this plan with message `feat: emphasize low inventory fee report alerts`. Then generate the guarded production package using `DEPLOY_CONFIRM_BRANCH=codex/yesterday-plus-webhook npm run package:deploy`, upload `tanjia-bi-deploy.tar.gz` to `/opt/tanjia-bi/`, and run `bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz` via SSH.

Expected: package manifest reports the production branch and new commit; server deploy verifies health and all navigation modules.

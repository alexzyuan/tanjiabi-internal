# Budget Target Import Modal Implementation Plan

> 2026-08-08 follow-up: the shipped contract uses a single month picker, requires country/store selection in the import dialog, removes dialog listing-owner input, and records the authenticated uploader as `uploadedBy`. The historical-owner compatibility rule remains unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicated budget sources from generating duplicate sales-review rows, and replace the budget-page upload panel with a filtered modal import workflow that persists a selected listing owner.

**Architecture:** `budgetTargetService` owns budget-source uniqueness, upload validation, parsed listing-owner persistence, and template generation. `routes/admin.js` exposes the protected template endpoint. The native HTML view hosts filter and dialog markup; `budget-targets.js` owns modal/filter state and request composition; `assets/css/pages/30-budget-targets.css` owns the resulting presentation.

**Tech Stack:** Node.js ESM, node:test, SheetJS (`xlsx`), native HTML `<dialog>`, CSS semantic tokens, browser-client verification.

---

### Task 1: Make duplicate budget sources an explicit service error

**Files:**
- Modify: `src/services/budgetTargetService.js`
- Modify: `test/budgetTargetService.test.js`

- [ ] **Step 1: Write the failing tests**

Add an exported-independent behavior test that creates two historical parsed summaries for the same store and month, then asserts `listBudgetTargets()` rejects and contains both source file names. Extend `uploadPayload` with the required `listingOwner` field so existing successful imports remain valid.

```js
test("listBudgetTargets rejects duplicate store-month sources with file names", async () => {
  await withTempService(async ({ saveBudgetUpload, listBudgetTargets }) => {
    await saveBudgetUpload(uploadPayload({ listingOwner: "林芃" }));
    // Copy a second valid parsed summary for the same store/month under another stored name.
    await assert.rejects(
      () => listBudgetTargets(),
      /探嘉美国.*2026-07.*预算.*xlsx/,
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/budgetTargetService.test.js`

Expected: the new duplicate-source test fails because `listBudgetTargets()` currently returns both entries.

- [ ] **Step 3: Implement the minimal integrity guard**

Add `assertUniqueBudgetSources(rows)` in `src/services/budgetTargetService.js`. Group only `status === "已解析"` rows by normalized `storeName` and normalized `month`; when a group has more than one row, throw an `Error` whose message starts with `预算数据重复：` and lists `storeName`、`month` and all `fileName` values. Call it before calculating `mskuRows` and totals in `listBudgetTargets()`.

```js
const key = `${normalizeText(row.storeName)}|${normalizeBudgetMonth(row.month)}`;
throw new Error(`预算数据重复：${storeName} ${month} 同时存在 ${fileNames.join("、")}`);
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/budgetTargetService.test.js`

Expected: all budget-target tests pass, including the duplicate-source rejection.

- [ ] **Step 5: Commit the service guard**

```bash
git add src/services/budgetTargetService.js test/budgetTargetService.test.js
git commit -m "fix: reject duplicate budget sources"
```

### Task 2: Persist the selected listing owner and serve a clean template

**Files:**
- Modify: `src/services/budgetTargetService.js`
- Modify: `routes/admin.js`
- Modify: `server.js`
- Modify: `test/budgetTargetService.test.js`
- Modify: `test/serverSecurity.test.js`

- [ ] **Step 1: Write failing service and route tests**

Add tests for: missing `listingOwner` rejects with `请先选择链接负责人`; a successful import has the owner in `summary.listingOwner` and each `summary.mskuRows[0].listingOwner`; `createBudgetImportTemplate()` returns an XLSX buffer whose workbook has `汇总` and `销售预算` sheets. Add an authenticated request test for `GET /api/admin/budget/template` verifying XLSX content type and attachment disposition.

```js
const upload = await saveBudgetUpload(uploadPayload({ listingOwner: "林芃" }));
assert.equal(upload.summary.listingOwner, "林芃");
assert.equal(upload.summary.mskuRows[0].listingOwner, "林芃");
await assert.rejects(() => saveBudgetUpload(uploadPayload({ listingOwner: "" })), /请先选择链接负责人/);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test test/budgetTargetService.test.js test/serverSecurity.test.js`

Expected: new assertions fail because the upload payload has no owner validation and no template endpoint exists.

- [ ] **Step 3: Implement the bounded backend behavior**

In `budgetTargetService.js`, add `normalizeListingOwner(value)` that trims and throws for empty input. Pass the normalized value from `saveBudgetUpload()` into `parseBudgetWorkbook()`; add it to the returned summary and each MSKU row. Do not bump `BUDGET_SUMMARY_SCHEMA_VERSION`: historical summaries remain readable without an invented owner, and their owner filters use their existing `skuOwner`. Export `createBudgetImportTemplate()` which uses `xlsx` to generate the canonical `汇总` and `销售预算` sheets with parser-recognized headers and one sample row.

In `server.js`, pass `createBudgetImportTemplate` to `createAdminRoutes`. In `routes/admin.js`, add a session-authenticated GET route that writes the XLSX buffer using the existing attachment helper and a fixed `预算目标导入模板.xlsx` filename.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --test test/budgetTargetService.test.js test/serverSecurity.test.js`

Expected: all focused tests pass and the endpoint returns a readable workbook.

- [ ] **Step 5: Commit owner persistence and template route**

```bash
git add src/services/budgetTargetService.js routes/admin.js server.js test/budgetTargetService.test.js test/serverSecurity.test.js
git commit -m "feat: persist budget listing owner"
```

### Task 3: Replace the budget upload panel with modal markup and filters

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/budget-targets.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write failing frontend structure assertions**

Add explicit assertions for `#budget-country-filter`, `#budget-store-filter`, `#budget-listing-owner-filter`, `#budget-import-button`, `#budget-import-dialog`, `#budget-import-owner`, `#budget-template-download`, and that the obsolete `#budget-upload-panel` is absent. Assert the feature contains `openBudgetImportDialog`, `closeBudgetImportDialog`, and sends `listingOwner` in the import request.

- [ ] **Step 2: Run the focused assertion test and confirm RED**

Run: `node --test test/frontendStructure.test.js`

Expected: the new selector and function assertions fail against the current inline upload panel.

- [ ] **Step 3: Implement HTML and feature behavior**

Replace the old status filter and upload panel with native multi-select country/store controls, a listing-owner filter, and the import command. Add a native `<dialog id="budget-import-dialog">` containing visible labels, `input[type=month]`, `input[list]` plus an owner `datalist`, a template download anchor, the existing file picker pattern, a cancel command and submit command.

Extend `budget-targets.js` to derive country/store/owner options from loaded rows, apply all six filters to summary and MSKU rows, populate owner suggestions from `listingOwner` plus legacy `skuOwner`, and manage dialog open/close/Esc/reset. Update `uploadBudgetTemplate()` to require and submit `listingOwner`; on API failure, display `error.message` rather than a generic success-like fallback. Do not alter `app.js`.

- [ ] **Step 4: Run the focused assertion test and confirm GREEN**

Run: `node --test test/frontendStructure.test.js`

Expected: the feature ownership assertions and new budget selector assertions pass.

- [ ] **Step 5: Commit markup and feature state**

```bash
git add index.html assets/js/features/budget-targets.js test/frontendStructure.test.js
git commit -m "feat: add budget import modal"
```

### Task 4: Style the modal and responsive filter toolbar

**Files:**
- Modify: `assets/css/pages/30-budget-targets.css`
- Generated: `styles.css`
- Modify: `test/stylesStructure.test.js` only if the current source-ownership test needs a new assertion

- [ ] **Step 1: Write a failing source-level style assertion**

Add a focused assertion that the page source owns `.budget-import-dialog` and a narrow-width rule for `.budget-toolbar`, while `styles.css` is not manually edited.

- [ ] **Step 2: Run the style test and confirm RED**

Run: `node --test test/stylesStructure.test.js`

Expected: the new selector assertion fails.

- [ ] **Step 3: Implement source CSS and generate the target**

Remove inline-panel-only rules. Add `.budget-import-dialog` sizing, zero default border, dialog backdrop, labeled field grid, file picker, footer, and mobile one-column rules using existing semantic tokens and existing modal sizes. Keep table scrolling owned by `.budget-target-table-wrap`. Run `npm run build:css`.

- [ ] **Step 4: Run style checks and confirm GREEN**

Run: `node --test test/stylesStructure.test.js && npm run build:css -- --check`

Expected: source assertion passes and generated CSS is current.

- [ ] **Step 5: Commit styles**

```bash
git add assets/css/pages/30-budget-targets.css styles.css test/stylesStructure.test.js
git commit -m "style: organize budget import workflow"
```

### Task 5: Verify end to end and repair the confirmed production data

**Files:**
- No production-code changes expected

- [ ] **Step 1: Run full local verification**

Run: `npm test && npm run check`

Expected: all tests, CSS standards and JavaScript syntax checks pass.

- [ ] **Step 2: Run browser verification**

Start: `npm start`

Test flow: `http://localhost:4173/` -> 预算目标 -> click 导入预算 -> fill 2026-09 and a listing owner -> choose a valid XLSX -> inspect request payload -> cancel and Esc close behavior. Capture desktop and narrow screenshots, page identity, DOM snapshot and console error/warn logs.

- [ ] **Step 3: Delete only the confirmed production duplicate and stale response caches**

Over SSH, first verify both exact files exist under `/opt/tanjia-bi/uploads/budget-targets/` and their summaries exist under `/opt/tanjia-bi/data-cache/budget-targets/`. Then remove only:

```text
2026-07-24T08-13-39-571Z-探嘉美国-2026年7月预算.xlsx
2026-07-24T08-13-39-571Z-探嘉美国-2026年7月预算.xlsx.json
```

Then remove only files within `/opt/tanjia-bi/data-cache/sales-weekly-source/` and `/opt/tanjia-bi/data-cache/msku-detail/` so responses rebuild. Do not delete other upload or data-cache directories.

- [ ] **Step 4: Validate production after deployment authorization**

Only when the user requests deployment: merge/commit to clean `main`, generate the guarded package with `DEPLOY_CONFIRM_BRANCH=main`, deploy using `deploy.sh`, then verify `/api/health` and a sales-weekly request contains no duplicate `(store, msku)` detail rows for the selected 8月范围. Verify that the remaining 8月 file is the correctly named file.

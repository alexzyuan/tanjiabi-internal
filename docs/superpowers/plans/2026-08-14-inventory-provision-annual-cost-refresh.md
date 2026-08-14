# Inventory Provision Annual Cost Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inventory-provision cost button refresh the latest Lingxing product-management purchase and first-leg costs across every completed month in the current year without rebuilding historical inventory data.

**Architecture:** The existing cost-refresh service will read already-persisted monthly history caches, deduplicate `SID + MSKU` identities for Listing and product-management lookups, validate all costs before writing, then atomically save the refreshed monthly cache payloads. The route will invoke a no-month-payload annual operation, and the feature will present the annual scope and cache refresh timestamp.

**Tech Stack:** Native ES modules, Node `node:test`, Lingxing adapter/catalog lookup helpers, native HTML/JavaScript feature module, JSON cache store.

---

### Task 1: Replace selected-month service tests with annual-cache tests

**Files:**
- Modify: `test/inventoryProvisionCostRefreshService.test.js`

- [ ] **Step 1: Rewrite the fixture around `readHistoryCache`**

Replace the `loadHistoricalRows` dependency with a `readHistoryCache(month)` dependency that returns an envelope containing the existing monthly rows. Keep the German seller fixture, and make the fixture expose `calls.history` and `saved` so tests can assert reads and writes.

- [ ] **Step 2: Add the failing annual refresh test**

Use `todayText: () => "2026-08-14"`, call `service.refresh({})`, and assert that history reads are exactly `2026-01` through `2026-07`, that no `loadHistoricalRows` dependency is called, and that every month is saved with `costRefreshedAt`, `costSource`, `purchaseCost: 12.5`, and `firstLegCost: 3.2`. Assert the result contains `year: "2026"`, `months.length === 7`, and `refreshedAt: "2026/8/14 10:00:00"`.

- [ ] **Step 3: Add failure and deduplication tests**

Cover a missing monthly cache, a missing first-leg cost, and duplicate rows for one `SID + MSKU` across multiple months. Assert that failures leave `saved.length === 0` and that duplicated identities cause one Listing/product lookup while both month rows are updated.

- [ ] **Step 4: Run the focused tests and verify the expected RED state**

Run:

```bash
node --test test/inventoryProvisionCostRefreshService.test.js
```

Expected: the new annual tests fail because the current service still requires a selected historical month and calls `loadHistoricalRows` with `forceRefresh: true`.

### Task 2: Implement cache-only annual cost refresh with diagnostics

**Files:**
- Modify: `src/services/inventoryProvisionCostRefreshService.js`

- [ ] **Step 1: Add current-year completed-month calculation**

Derive the current year and current month from the injected `todayText`. Return `YYYY-01` through the month before the current month; throw an explicit error when there are no completed months. Do not use the request body date to select a month.

- [ ] **Step 2: Inject and use `readHistoryCache`**

Replace the historical-loader dependency with `readInventoryProvisionHistoryCache`. Read all target month envelopes before any write, and throw `库存计提历史缓存缺失：YYYY-MM` when an envelope or non-empty `data.rows` is absent. Keep the current seller-directory refresh and required German SID validation.

- [ ] **Step 3: Reuse one product lookup per deduplicated identity**

Build one `rowsByIdentity` map from all monthly rows, request Listing records once per SID, resolve internal SKUs, and request product information in batches of 80. Apply the latest validated purchase and first-leg values to every matching row in every monthly payload.

- [ ] **Step 4: Validate before writing and record stage timings**

Capture elapsed milliseconds for cache reads, Listing lookups, product lookups, validation, and writes. Log an operation id, year, month count, row count, lookup counts, and stage timings. Keep errors fail-fast and do not substitute zero or stale cost values.

- [ ] **Step 5: Save all prepared months and return an annual result**

After all rows validate, save each month through the existing `saveHistoryCache` function. On a write error attach `writtenMonths` and `pendingMonths` to `error.details`. Return `{ year, months, refreshedAt, totalRows, updatedRows, diagnostics: [] }`; each month item includes `month`, `rows`, `updatedRows`, `listingMatches`, and `productMatches`.

- [ ] **Step 6: Run the focused service tests and verify GREEN**

Run:

```bash
node --test test/inventoryProvisionCostRefreshService.test.js
```

Expected: all service tests pass, including the annual range, no historical-loader call, deduplication, and zero-write failure cases.

### Task 3: Change route contract to an annual operation

**Files:**
- Modify: `routes/inventory.js`
- Modify: `test/serverRoutesStructure.test.js`

- [ ] **Step 1: Write the failing route contract test**

Change the route test to provide `readJsonBody: async () => ({ date: "2026-05" })`, invoke the handler, and assert that `refreshInventoryProvisionCosts` receives `{}` rather than the selected date. Assert the returned payload is the annual result and the route remains `POST` with `auth: "finance"`.

- [ ] **Step 2: Implement the route contract**

Read the request body only for compatibility, discard its month field, and call `refreshInventoryProvisionCosts({})`. Keep the existing finance authorization and JSON response shape. Use the service's explicit error status when available; otherwise retain the route's existing 400 handling for validation failures.

- [ ] **Step 3: Run the route tests**

Run:

```bash
node --test test/serverRoutesStructure.test.js
```

Expected: route structure and annual payload assertions pass.

### Task 4: Update the inventory-provision feature for one-click annual refresh

**Files:**
- Modify: `assets/js/features/inventory-provision.js`
- Modify: `test/inventoryProvisionFeature.test.js`
- Modify: `index.html`

- [ ] **Step 1: Write the failing feature tests**

Assert that the cost-refresh confirmation says it refreshes the current year's completed months, that the POST body has no `date`, and that a successful response renders the year/month range, updated-row count, and `成本缓存刷新时间`. Assert that selecting the current month does not disable the button or block the request because the button is no longer tied to the selected dashboard month.

- [ ] **Step 2: Implement annual refresh behavior**

Remove the selected-month guard from `syncInventoryProvisionCostRefreshState` and `refreshInventoryProvisionCosts`. Confirm with `将使用领星产品管理当前采购成本和单位头程成本，刷新本年度所有已结束月份。是否继续？`, POST `{}` to `/api/dashboard/inventory-provision/refresh-costs`, reload the dashboard, and render the annual result. Keep button busy/restore behavior and preserve the table on failure.

- [ ] **Step 3: Update visible button/help text**

Change only the existing button label or adjacent accessible text in `index.html` so the action reads as an annual cost refresh. Do not add CSS or hand-edit generated `styles.css`.

- [ ] **Step 4: Run focused frontend tests**

Run:

```bash
node --test test/inventoryProvisionFeature.test.js
```

Expected: all feature tests pass with the annual confirmation, empty request payload, success timestamp, and current-month selection behavior.

### Task 5: Documentation and regression verification

**Files:**
- Modify: `README.md` if the existing cost-refresh description still says selected-month refresh.

- [ ] **Step 1: Update the single source of truth for the user-facing behavior**

Change the relevant README text to say that the action refreshes the latest product-management purchase and first-leg costs for all completed months in the current year.

- [ ] **Step 2: Run JavaScript checks and the full test suite**

Run:

```bash
npm run check:js
npm test
npm run check
git diff --check
```

Expected: all commands exit `0`; `npm test` reports zero failures.

- [ ] **Step 3: Review the diff and commit the implementation**

Run `git diff --stat` and `git status --short`, confirm only the scoped service, route, feature, tests, HTML, and documentation files changed, then commit:

```bash
git add src/services/inventoryProvisionCostRefreshService.js routes/inventory.js assets/js/features/inventory-provision.js index.html test/inventoryProvisionCostRefreshService.test.js test/inventoryProvisionFeature.test.js test/serverRoutesStructure.test.js README.md
git commit -m "fix: refresh annual inventory provision costs from product management"
```

### Task 6: Merge, deploy, and verify production

**Files:**
- No additional source files; deployment uses the committed branch.

- [ ] **Step 1: Merge into `main` without reverting unrelated work**

Verify the main worktree's existing commit and any unrelated local changes, merge this feature branch into `main`, and push `main` only after the worktree is clean and the deployment preflight requirements are satisfied.

- [ ] **Step 2: Build a guarded deployment package**

Use `DEPLOY_CONFIRM_BRANCH=main` and the repository's approved sales-facts preflight artifact/hash. Do not bypass `scripts/package-deploy.js` or `deploy.sh` guards.

- [ ] **Step 3: Verify production**

After deployment, check `/api/health`, PM2 status, and the deployed commit. Run one controlled annual refresh only if the production operator confirms it is acceptable to write the current-year historical cost caches; verify the response includes all completed months and `costRefreshedAt`.

# Budget Filter Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the budget page to the approved countries, stores, platforms, and listing owners while preserving historical budget files.

**Architecture:** The server-side budget shop catalog returns only the approved Germany, United States, Canada, and Australia shop options. The budget feature owns the default four-country row scope and fixed owner choices, so no historical row can expand a selector or appear in the default table. Page markup provides the two approved platform values and their Chinese labels.

**Tech Stack:** Node.js ES modules, native HTML/CSS/JavaScript, Node test runner, shared filter controls.

---

### Task 1: Limit the Shared Budget Shop Catalog

**Files:**
- Modify: `src/data/budgetShopCatalog.js`
- Modify: `test/budgetShopCatalog.test.js`

- [ ] **Step 1: Write a failing catalog scope assertion**

```js
assert.deepEqual(
  [...new Set(listBudgetShopCatalog().map((shop) => shop.country))],
  ["澳洲", "德国", "加拿大", "美国"],
);
assert.equal(listBudgetShopCatalog().some((shop) => shop.country === "巴西" || shop.country === "墨西哥"), false);
```

- [ ] **Step 2: Run the catalog test to verify it fails**

Run: `node --test test/budgetShopCatalog.test.js`

Expected: FAIL because the current catalog includes Brazil and Mexico.

- [ ] **Step 3: Filter catalog entries by the approved countries**

```js
const budgetCountries = new Set(["德国", "美国", "加拿大", "澳洲"]);

export function listBudgetShopCatalog() {
  return [...lingxingShopMap, ...budgetOnlyShops]
    .filter((shop) => budgetCountries.has(shop.country))
    .map((shop) => ({
      country: shop.country,
      storeName: shop.displayName,
      sid: shop.sid,
      sourceName: shop.name,
    }))
    .sort((left, right) => left.country.localeCompare(right.country, "zh-CN")
      || left.storeName.localeCompare(right.storeName, "zh-CN"));
}
```

- [ ] **Step 4: Run the catalog test to verify it passes**

Run: `node --test test/budgetShopCatalog.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the scoped catalog**

```bash
git add src/data/budgetShopCatalog.js test/budgetShopCatalog.test.js
git commit -m "feat: limit budget shop catalog"
```

### Task 2: Apply the Default Four-Country Scope and Fixed Owners

**Files:**
- Modify: `assets/js/features/budget-targets.js`
- Modify: `test/budgetTargetsFeature.test.js`

- [ ] **Step 1: Write failing frontend behavior tests**

```js
assert.deepEqual(listBudgetCountries(), ["德国", "美国", "加拿大", "澳洲"]);
assert.deepEqual(listBudgetListingOwners(), ["林芃", "熊丹轩"]);
assert.deepEqual(
  filterBudgetRowsByCountryScope([
    { country: "美国", storeName: "探嘉美国" },
    { country: "巴西", storeName: "坦蛋伯巴西" },
  ], []),
  [{ country: "美国", storeName: "探嘉美国" }],
);
```

- [ ] **Step 2: Run the feature test to verify it fails**

Run: `node --test test/budgetTargetsFeature.test.js`

Expected: FAIL because the feature currently derives countries and owners from uploaded data and treats an empty country selection as unscoped.

- [ ] **Step 3: Implement fixed option helpers and default row scope**

```js
const budgetCountries = ["德国", "美国", "加拿大", "澳洲"];
const budgetListingOwners = ["林芃", "熊丹轩"];

export function listBudgetCountries() {
  return budgetCountries.slice();
}

export function listBudgetListingOwners() {
  return budgetListingOwners.slice();
}

export function filterBudgetRowsByCountryScope(rows = [], countries = []) {
  const scope = countries.length ? new Set(countries) : new Set(budgetCountries);
  return rows.filter((row) => scope.has(normalizeBudgetDeepLinkCountry(row.country || row.site || "")));
}
```

Use the catalog-only `availableBudgetShops()` result for country/store selectors. Use `listBudgetListingOwners()` when rendering the owner select. Apply `filterBudgetRowsByCountryScope()` to the summary and MSKU table rows before platform, store, owner, and keyword filters. Do not change upload parsing or stored historical rows.

- [ ] **Step 4: Run the focused frontend tests and JavaScript check**

Run: `node --test test/budgetTargetsFeature.test.js test/frontendStructure.test.js && npm run check:js`

Expected: PASS.

- [ ] **Step 5: Commit default scope behavior**

```bash
git add assets/js/features/budget-targets.js test/budgetTargetsFeature.test.js test/frontendStructure.test.js
git commit -m "feat: scope budget filters to approved options"
```

### Task 3: Replace the Platform Options

**Files:**
- Modify: `index.html`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write a failing markup assertion**

```js
assert.match(budgetView, /<option value="Amazon">亚马逊<\/option>/);
assert.match(budgetView, /<option value="Walmart">沃尔玛<\/option>/);
assert.doesNotMatch(budgetView, /Tik Tok/);
```

- [ ] **Step 2: Run the structure test to verify it fails**

Run: `node --test test/frontendStructure.test.js`

Expected: FAIL because the platform options are currently Amazon and Tik Tok.

- [ ] **Step 3: Change only the budget platform select options**

```html
<select id="budget-platform-filter">
  <option value="">销售平台</option>
  <option value="Amazon">亚马逊</option>
  <option value="Walmart">沃尔玛</option>
</select>
```

- [ ] **Step 4: Run the structure test**

Run: `node --test test/frontendStructure.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the platform labels**

```bash
git add index.html test/frontendStructure.test.js
git commit -m "feat: limit budget platform filters"
```

### Task 4: Verify the Approved Budget Scope

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-budget-filter-scope-design.md`

- [ ] **Step 1: Record verification results**

Add a verification section with the passing automated tests and browser checks.

- [ ] **Step 2: Run complete automated verification**

Run: `npm test && npm run check`

Expected: all tests pass, CSS source and generated stylesheet are consistent, and JavaScript syntax checks pass.

- [ ] **Step 3: Verify the budget page in a browser**

Run: `npm start`

Check:

1. Country and store selectors show only Germany, United States, Canada, and Australia catalog entries.
2. Import country/store controls contain the same four-country catalog and country linkage.
3. Default summary and MSKU tables do not show Brazil or Mexico rows.
4. Platform choices are 亚马逊 and 沃尔玛; owner choices are 林芃 and 熊丹轩.
5. Opened country/store menus remain contained to their controls and there are no relevant console errors.

- [ ] **Step 4: Commit verification documentation**

```bash
git add docs/superpowers/specs/2026-08-09-budget-filter-scope-design.md
git commit -m "docs: record budget filter scope verification"
```

### Task 5: Deploy the Verified Main Branch

**Files:**
- No source-file changes.

- [ ] **Step 1: Verify clean committed main**

Run: `git status --short --branch && git log -1 --oneline`

Expected: `main` is clean and its latest commit contains the approved scope changes.

- [ ] **Step 2: Push and package the production build**

Run: `git push origin main && DEPLOY_CONFIRM_BRANCH=main ALLOW_CSS_DEPLOY=1 npm run package:deploy -- --include-css`

Expected: push succeeds and the manifest records `main`, the current commit, clean state, and confirmed branch.

- [ ] **Step 3: Deploy through the guarded script**

Run: `scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz && ssh root@47.107.92.14 'cd /opt/tanjia-bi && ALLOW_CSS_DEPLOY=1 ./deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'`

Expected: the script accepts the manifest, restarts PM2, and passes its integrity check.

- [ ] **Step 4: Verify production health and catalog scope**

Run: `ssh root@47.107.92.14 'curl -fsS http://127.0.0.1:4173/api/health'`

Expected: health succeeds. Then, from `/opt/tanjia-bi`, call `listBudgetTargets()` and verify its `shopOptions` contains only the four approved countries and their catalog stores.

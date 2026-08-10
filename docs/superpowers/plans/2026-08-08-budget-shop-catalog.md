# Budget Shop Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the budget page use one canonical shop catalog so Germany and Australia stores are selectable in both filters and imports before any budget data exists.

**Architecture:** A server-side catalog module will compose the existing Lingxing shop mapping with the Germany-only budget entry. `budgetTargetService` will expose that catalog alongside uploaded budget rows. The budget feature will merge catalog and historical values only for display options, while preserving the actual selected country and store as the import source of truth.

**Tech Stack:** Node.js ES modules, native HTML/CSS/JavaScript, Node test runner, existing Spectrum-aligned filter controls.

---

### Task 1: Define the Canonical Budget Shop Catalog

**Files:**
- Create: `src/data/budgetShopCatalog.js`
- Test: `test/budgetShopCatalog.test.js`

- [ ] **Step 1: Write the failing catalog test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { listBudgetShopCatalog } from "../src/data/budgetShopCatalog.js";

test("budget shop catalog includes German and Australian import stores", () => {
  assert.deepEqual(
    listBudgetShopCatalog().filter((shop) => ["德国", "澳洲"].includes(shop.country)),
    [
      { country: "澳洲", storeName: "探嘉澳洲", sid: 11499, sourceName: "xiamentanjia-AU" },
      { country: "澳洲", storeName: "坦蛋伯澳洲", sid: 11503, sourceName: "tandanbo-AU" },
      { country: "德国", storeName: "欧洲-探嘉德国店铺", sid: 17307, sourceName: "tanjia-eu-DE" },
    ],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/budgetShopCatalog.test.js`

Expected: FAIL because `src/data/budgetShopCatalog.js` does not exist.

- [ ] **Step 3: Implement the catalog from the existing Lingxing mapping**

```js
import { lingxingShopMap } from "./lingxingShopMap.js";

const budgetOnlyShops = [
  { name: "tanjia-eu-DE", country: "德国", sid: 17307, displayName: "欧洲-探嘉德国店铺" },
];

export function listBudgetShopCatalog() {
  return [...lingxingShopMap, ...budgetOnlyShops]
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

- [ ] **Step 5: Commit the catalog**

```bash
git add src/data/budgetShopCatalog.js test/budgetShopCatalog.test.js
git commit -m "feat: add budget shop catalog"
```

### Task 2: Return the Catalog with Budget Data

**Files:**
- Modify: `src/services/budgetTargetService.js`
- Modify: `test/budgetTargetService.test.js`

- [ ] **Step 1: Write a failing service assertion**

```js
assert.deepEqual(result.shopOptions.find((shop) => shop.storeName === "欧洲-探嘉德国店铺"), {
  country: "德国",
  storeName: "欧洲-探嘉德国店铺",
  sid: 17307,
  sourceName: "tanjia-eu-DE",
});
```

Place this assertion in the existing empty-budget `listBudgetTargets()` test, so the test establishes that selectable shops are available without uploaded workbooks.

- [ ] **Step 2: Run the service test to verify it fails**

Run: `node --test test/budgetTargetService.test.js`

Expected: FAIL because `shopOptions` is absent.

- [ ] **Step 3: Add the catalog to the service response**

```js
import { listBudgetShopCatalog } from "../data/budgetShopCatalog.js";

// In listBudgetTargets(), preserve all current parsed-row fields and append:
return {
  rows,
  mskuRows,
  totals,
  shopOptions: listBudgetShopCatalog(),
};
```

Do not derive or overwrite uploaded workbook country/store fields. The catalog is only an available-option source.

- [ ] **Step 4: Run the focused service tests**

Run: `node --test test/budgetShopCatalog.test.js test/budgetTargetService.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the API contract**

```bash
git add src/services/budgetTargetService.js test/budgetTargetService.test.js
git commit -m "feat: expose budget shop options"
```

### Task 3: Use the Shared Options in Budget Filters and Imports

**Files:**
- Modify: `assets/js/features/budget-targets.js`
- Modify: `app.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write a failing frontend structure assertion**

```js
assert.match(
  budgetFeatureSource,
  /budgetShopOptions\s*=\s*payload\.shopOptions/,
  "budget filters must load canonical server-side shop options",
);
```

- [ ] **Step 2: Run the structure test to verify it fails**

Run: `node --test test/frontendStructure.test.js`

Expected: FAIL because the feature currently derives all options from uploaded rows.

- [ ] **Step 3: Merge catalog options with historical rows and render from that merged list**

```js
let budgetShopOptions = [];

function budgetCountry(row) {
  return normalizeCountryName(row.country || row.site || "").replace(/站$/, "");
}

function availableBudgetShops() {
  const rows = [...budgetTargetRows, ...budgetMskuRows].map((row) => ({
    country: budgetCountry(row),
    storeName: row.storeName || row.store,
  }));
  const options = [...budgetShopOptions, ...rows];
  return Array.from(new Map(options
    .filter((shop) => shop.country && shop.storeName)
    .map((shop) => [`${shop.country}\u0000${shop.storeName}`, shop]))
    .values());
}

// When loading /api/budget-targets:
budgetShopOptions = Array.isArray(payload.shopOptions) ? payload.shopOptions : [];
```

Use `availableBudgetShops()` for both top-level country/store options and import-modal country/store options. Keep the existing country-to-store linkage, shared multi-select behaviors, and user-selected filter values. Bump only the budget feature cache-buster in `app.js`.

- [ ] **Step 4: Run the frontend structure test**

Run: `node --test test/frontendStructure.test.js && npm run check:js`

Expected: PASS.

- [ ] **Step 5: Commit the frontend integration**

```bash
git add assets/js/features/budget-targets.js app.js test/frontendStructure.test.js
git commit -m "feat: show catalog stores in budget controls"
```

### Task 4: Verify the Budget Shop Catalog End to End

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-budget-shop-catalog-design.md`

- [ ] **Step 1: Record the verified API/UI behavior in the accepted design**

Add a verification note stating that `GET /api/budget-targets` includes the catalog and that the top filter and import modal use it before any uploaded budget exists.

- [ ] **Step 2: Run full automated verification**

Run: `npm test && npm run check`

Expected: all tests pass and CSS/JavaScript checks pass.

- [ ] **Step 3: Run local browser verification**

Run: `npm start`

Verify at a desktop viewport and a narrow viewport:

1. Navigate to the budget page and open the country/store filters.
2. Confirm `德国` contains `欧洲-探嘉德国店铺`.
3. Confirm `澳洲` contains `探嘉澳洲` and `坦蛋伯澳洲`.
4. Open `导入预算`, select each country, and confirm only its matching store choices are available.
5. Confirm no console errors, no document-wide dropdown, and keyboard close works for the modal.

- [ ] **Step 4: Commit verification documentation**

```bash
git add docs/superpowers/specs/2026-08-08-budget-shop-catalog-design.md
git commit -m "docs: record budget shop catalog verification"
```

### Task 5: Deploy the Verified Main Branch

**Files:**
- No source-file changes.

- [ ] **Step 1: Verify clean, committed `main`**

Run: `git status --short --branch && git log -1 --oneline`

Expected: branch is `main`, worktree is clean, and the latest commit includes the catalog changes.

- [ ] **Step 2: Push the main branch**

Run: `git push origin main`

Expected: push succeeds.

- [ ] **Step 3: Build a guarded deployment package**

Run: `DEPLOY_CONFIRM_BRANCH=main ALLOW_CSS_DEPLOY=1 npm run package:deploy -- --include-css`

Expected: package manifest records branch `main`, the current commit, clean state, and confirmed branch.

- [ ] **Step 4: Deploy only through the guarded deployment script**

Run: `./deploy.sh <generated-package-path>`

Expected: deployment accepts the manifest and restarts the production application.

- [ ] **Step 5: Verify production health and catalog API**

Run: `ssh root@47.107.92.14 'curl -fsS http://127.0.0.1:4173/api/health'`

Expected: the health response succeeds. Then authenticate through the application’s normal flow and verify the budget API response exposes German/Australian `shopOptions`; do not mutate production data for this verification.

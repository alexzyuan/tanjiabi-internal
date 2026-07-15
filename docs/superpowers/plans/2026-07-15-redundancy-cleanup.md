# Redundancy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce duplicated helper code without changing business behavior or weakening fail-fast guarantees.

**Architecture:** Keep production business ownership unchanged: services stay in `src/services/*`, adapters stay in `src/adapters/*`, and frontend feature logic stays in `assets/js/features/*`. This pass introduces focused shared helpers only where semantics are already identical, then leaves higher-risk Lingxing catalog lookup consolidation for a separate reviewed phase.

**Tech Stack:** Node.js ESM, native `node:test`, existing npm scripts.

---

## File Structure

- Create `test/helpers/moduleImport.js`: owns cache-busting dynamic imports for tests.
- Create `test/helpers/env.js`: owns temporary environment overrides for tests.
- Create `test/helpers/http.js`: owns tiny test HTTP response stubs.
- Create `src/utils/recordAccess.js`: owns generic field lookup, nested field lookup, number coercion, and list normalization.
- Modify fail-fast and adapter tests that currently duplicate local helpers.
- Modify only a small set of backend modules whose helper behavior matches the new utility exactly.
- Do not touch `styles.css`, frontend layout files, deployment scripts, or Lingxing product/listing query behavior in this phase.

## Task 1: Test Helper Extraction

**Files:**
- Create: `test/helpers/moduleImport.js`
- Create: `test/helpers/env.js`
- Create: `test/helpers/http.js`
- Modify: `test/factoryInventoryFailFast.test.js`
- Modify: `test/lingxingAdapterFailFast.test.js`
- Modify: `test/supplierBoardFailFast.test.js`
- Modify: `test/jiufangAdapter.test.js`
- Modify: `test/inventoryProvisionService.test.js`
- Modify: `test/lingxingAdapter.test.js`
- Modify: `test/lingxingClient.test.js`

- [ ] **Step 1: Add helper modules**

```js
// test/helpers/moduleImport.js
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function importFresh(projectRoot, relativePath) {
  const url = pathToFileURL(path.join(projectRoot, relativePath));
  url.searchParams.set("testRun", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}
```

```js
// test/helpers/env.js
export async function withEnv(values, run) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await run();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
```

```js
// test/helpers/http.js
export function jsonResponse(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return payload;
    },
  };
}
```

- [ ] **Step 2: Replace local duplicated helpers**

Replace local `importFresh`, `withEnv`, and `jsonResponse` declarations with imports from the new helper files.

- [ ] **Step 3: Run targeted tests**

```bash
node --test test/factoryInventoryFailFast.test.js test/lingxingAdapterFailFast.test.js test/supplierBoardFailFast.test.js test/jiufangAdapter.test.js test/inventoryProvisionService.test.js test/lingxingAdapter.test.js test/lingxingClient.test.js
```

Expected: all targeted tests pass.

## Task 2: Generic Record Helper Extraction

**Files:**
- Create: `src/utils/recordAccess.js`
- Modify: `src/services/payablesService.js`
- Modify: `src/services/adPerformanceReviewService.js`
- Modify: `src/services/adPortfolioService.js`

- [ ] **Step 1: Add focused utility**

```js
export function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeRecordList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.list)) return payload.list;
  return [];
}
```

- [ ] **Step 2: Replace only exact semantic matches**

Import the new helpers in modules whose local implementation is identical or equivalent. Leave business-specific helpers in place. `lowInventoryFeeService.js` and `productPulseService.js` intentionally keep their local number parsing because their percent/string coercion semantics are narrower than `recordAccess.toNumber()`.

- [ ] **Step 3: Run targeted tests and syntax checks**

```bash
node --test test/redundancyHelpers.test.js test/payablesService.test.js test/payablesDashboardFeature.test.js test/adPerformanceReviewService.test.js test/adPerformanceReviewFeature.test.js test/adPortfolioFeature.test.js
npm run check
```

Expected: all available targeted tests pass and `npm run check` passes.

## Task 3: Full Verification And Delivery

**Files:**
- No extra files beyond Tasks 1-2.

- [ ] **Step 1: Full automated verification**

```bash
npm test
npm run check
npm audit
```

Expected: tests pass, check passes, audit reports no vulnerabilities.

- [ ] **Step 2: Commit and push**

```bash
git status -sb
git add docs/superpowers/plans/2026-07-15-redundancy-cleanup.md test/helpers/*.js test/*.test.js src/utils/recordAccess.js src/services/*.js
git commit -m "refactor: consolidate duplicated helpers"
git push
```

Expected: branch pushes to origin.

- [ ] **Step 3: Deployment**

Use the established package deployment workflow after tests pass. Do not include CSS-specific deployment flags because this phase does not touch CSS.

```bash
npm run package:deploy
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
ssh root@47.107.92.14 'cd /opt/tanjia-bi && KEEP_RELEASES=5 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
ssh root@47.107.92.14 'curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
```

Expected: deployment completes and `/api/health` returns healthy JSON.

## Later Phase: Lingxing Catalog Lookup Consolidation

Do not mix this into the first helper cleanup. The later phase should first add focused tests around Listing/Product/Owner lookup behavior, then consolidate duplicate fetching in `sharedDataService`, `fbaCatalogService`, `supplierBoardService`, `inventoryProvisionService`, and `listingOwnerService`.

## Later Phase Implementation: Lingxing Catalog Lookup Service

**Files:**
- Create: `src/services/lingxingCatalogLookupService.js`
- Create: `test/lingxingCatalogLookupService.test.js`
- Modify: `src/services/sharedDataService.js`
- Modify: `src/services/fbaCatalogService.js`
- Modify: `src/services/supplierBoardService.js`
- Modify: `src/services/inventoryProvisionService.js`
- Modify: `src/services/listingOwnerService.js`

**Boundary:**
- Shared service owns Lingxing Listing pagination, supported SID parameter variants, exact-to-fuzzy seller_sku lookup fallback, per-MSKU fallback for mixed batches, and local product-management fallback calls.
- Feature modules still own record normalization, owner extraction, product-map construction, cache keys, and UI/business response shapes.
- `fbaCatalogService.js` uses only the shared pagination helper for shop listing fetches because its existing behavior stops on the first successful empty listing response; it does not use the exact-to-fuzzy batch helper.

**Verification:**
```bash
node --test test/lingxingCatalogLookupService.test.js test/sharedDataService.test.js test/supplierBoardFeature.test.js test/supplierBoardFailFast.test.js
node --test test/lingxingCatalogLookupService.test.js test/inventoryProvisionService.test.js test/inventoryProvisionFeature.test.js test/supplierBoardFailFast.test.js
node --test test/lingxingCatalogLookupService.test.js test/sharedDataService.test.js test/fbaFreightSheetService.test.js test/fbaFreightFeature.test.js test/fbaShipmentOrderService.test.js
```

Expected: all targeted tests pass before full `npm test`, `npm run check`, and `npm audit`.

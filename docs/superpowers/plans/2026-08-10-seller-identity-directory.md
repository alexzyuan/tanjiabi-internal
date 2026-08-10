# Unified Seller Identity Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lingxing runtime seller data the only source of selectable shops, remove silent FBA shop/address fallbacks, and fail visibly before an unknown seller can enter a logistics payload.

**Architecture:** Add a focused `sellerDirectoryService` that normalizes Lingxing seller payloads, reads the shared cache first, refreshes from the adapter when needed, and returns source diagnostics. Existing Lingxing and FBA routes consume that service; static mappings remain an audited legal-owner boundary only. Frontend FBA features render only API shops and keep selection empty when the directory is unavailable.

**Tech Stack:** Node.js ES modules, native browser JavaScript, `node:test`, existing JSON cache and HTTP route factories.

---

## File structure and ownership

- Create `src/services/sellerDirectoryService.js`: normalize, deduplicate, load and diagnose the runtime seller directory.
- Create `test/sellerDirectoryService.test.js`: directory cache/API/error contract.
- Modify `src/services/sharedDataService.js` and `src/services/syncService.js`: delegate seller loading to the directory service.
- Modify `src/services/fbaCatalogService.js`, `routes/fba.js`, `server.js`: expose runtime FBA shops with mapping diagnostics.
- Modify `src/data/fbaAddressBook.js`, `src/services/fbaStaService.js`, `src/services/fbaStaTaskService.js`, `src/services/fbaFreightSheetService.js`: make unknown legal owners fail instead of becoming `tandanbo`.
- Create `test/fbaShopsFeature.test.js` and modify `test/frontendStructure.test.js`: prove frontend fallbacks are absent.
- Modify `assets/js/features/fba-shops.js`, `fba-freight.js`, `fba-shipment-order.js`, `fba-task-form.js`, `sync-center.js`, and `app.js`: consume canonical shops and surface directory failures.
- Modify `src/services/fbaShipmentCandidateService.js` and its tests: remove static seller seeding/default SID behavior.
- Do not modify `styles.css`, `assets/css/*`, report metric mappers, deploy scripts, or credentials.

### Task 1: Canonical seller directory service

**Files:**
- Create: `src/services/sellerDirectoryService.js`
- Create: `test/sellerDirectoryService.test.js`
- Modify: `src/services/sharedDataService.js:728-755`
- Modify: `src/services/syncService.js:116-122`

- [ ] **Step 1: Write failing directory contract tests**

Cover a cache hit without API access, nested API payload normalization and cache save, duplicate SID rejection by last-write normalization, cache miss plus API failure propagation, and an empty API response raising `SellerDirectoryUnavailableError`. The tests must assert diagnostics exactly:

```js
assert.deepEqual(result.meta, {
  source: "lingxing-api",
  cacheHit: false,
  sellerCount: 1,
  updatedAt: "2026-08-10 10:00:00",
});
await assert.rejects(
  () => getSellerDirectory({ readCache: async () => ({ sellers: [] }), adapter }),
  (error) => error.name === "SellerDirectoryUnavailableError" && /空店铺列表/.test(error.message),
);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/sellerDirectoryService.test.js`

Expected: FAIL because `src/services/sellerDirectoryService.js` does not exist.

- [ ] **Step 3: Implement the minimal directory API**

Export these stable interfaces:

```js
export class SellerDirectoryUnavailableError extends Error {}
export function normalizeSellerRecord(record = {}) {}
export function normalizeSellerRecords(payload) {}
export async function getSellerDirectory(options = {}) {}
```

`normalizeSellerRecord` must require a numeric SID and non-empty name, normalize field aliases once, and return `{ sid, name, country, countryCode, displayName, sellerId, marketplaceId, mid, status, raw }`. `getSellerDirectory` must use cache-first behavior, refresh through `adapter.fetchSellers()` when no valid cached sellers exist, save only non-empty normalized rows, log `[seller-directory]` with `source`, `cacheHit`, `sellerCount`, `endpoint`, and `errorName`, and throw on an empty or failed source. Never log raw payloads or credentials.

- [ ] **Step 4: Delegate existing shared entry points**

Make `getSharedSellers()` return the directory sellers plus the existing top-level `source`, `cacheHit`, and `updatedAt` fields for compatibility. Make `getLingxingShops()` call the same service and return `{ sellers, ...meta }`; it must no longer convert a missing cache into successful `sellers: []`.

- [ ] **Step 5: Verify GREEN and compatibility**

Run: `node --test test/sellerDirectoryService.test.js test/sharedDataService.test.js`

Expected: all selected tests PASS with no unhandled rejection.

- [ ] **Step 6: Commit**

```bash
git add src/services/sellerDirectoryService.js src/services/sharedDataService.js src/services/syncService.js test/sellerDirectoryService.test.js test/sharedDataService.test.js
git commit -m "refactor: centralize seller directory loading"
```

### Task 2: Runtime FBA shop API and auditable legal mapping

**Files:**
- Modify: `src/services/fbaCatalogService.js:365-401`
- Modify: `src/data/fbaAddressBook.js:47-54`
- Modify: `routes/fba.js:41-46`
- Modify: `server.js:75-85,760-850`
- Create: `test/fbaShopDirectory.test.js`
- Modify: `test/fbaCatalogService.test.js`
- Modify: `test/fbaShipmentVarianceRoutes.test.js`

- [ ] **Step 1: Write failing backend FBA tests**

Prove that `/api/fba/shops` awaits an async directory result, excludes a runtime seller without an approved legal owner from `shops`, returns it in `unmappedShops`, and never adds a static seller absent from runtime data. Prove the default address lookup is strict:

```js
assert.equal(getFbaAddressProfile("unknown-store"), null);
assert.equal(result.shops.some((shop) => shop.sid === 11501), false);
assert.deepEqual(result.unmappedShops, [{ sid: 17305, name: "tanjia-eu-UK", country: "英国" }]);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/fbaShopDirectory.test.js test/fbaCatalogService.test.js test/fbaShipmentVarianceRoutes.test.js`

Expected: FAIL because `getFbaShopOptions()` is synchronous/static and unknown address lookup returns `tandanbo`.

- [ ] **Step 3: Implement runtime intersection and diagnostics**

Change `getFbaShopOptions({ getDirectory = getSellerDirectory, logger = console } = {})` to await the canonical directory. For each runtime seller, resolve `getFbaAddressProfile(name)`; mapped sellers become `shops`, unmapped sellers become redacted identity rows in `unmappedShops`, and a warning logs their SID/name without raw data. Return `{ shops, unmappedShops, ...meta }`. Static `lingxingShopMap` must not seed or supplement the returned list.

- [ ] **Step 4: Make legal owner resolution strict by default**

Change `getFbaAddressProfile` so recognized `xiamentanjia*` and `tandanbo*` names return their profiles and every other input returns `null`. Remove the `strict` option because non-strict behavior is no longer allowed. Update `/api/fba/shops` to send the awaited result directly and wire the async dependency through `server.js`.

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/fbaShopDirectory.test.js test/fbaCatalogService.test.js test/fbaShipmentVarianceRoutes.test.js test/jiufangFbaOrderService.test.js`

Expected: all selected tests PASS; Jiufang known-owner behavior remains intact.

- [ ] **Step 6: Commit**

```bash
git add src/services/fbaCatalogService.js src/data/fbaAddressBook.js routes/fba.js server.js test/fbaShopDirectory.test.js test/fbaCatalogService.test.js test/fbaShipmentVarianceRoutes.test.js test/jiufangFbaOrderService.test.js
git commit -m "refactor: serve FBA shops from runtime directory"
```

### Task 3: Remove frontend FBA fallbacks

**Files:**
- Modify: `assets/js/features/fba-shops.js`
- Modify: `assets/js/features/fba-freight.js`
- Modify: `assets/js/features/fba-shipment-order.js`
- Modify: `assets/js/features/fba-task-form.js`
- Modify: `assets/js/features/sync-center.js`
- Modify: `app.js`
- Create: `test/fbaShopsFeature.test.js`
- Create: `test/fbaTaskFormFeature.test.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write failing browser-module behavior tests**

Instantiate the feature factories with small fake DOM roots. Assert a successful API response renders only its shops; an HTTP error rejects `loadFbaShops()`, clears shops and selection, calls an injected `onDirectoryError(error)`, and produces no SID `11501` or stale address. Assert `buildFbaPayload()` without a selected canonical shop throws `请选择有效店铺。` before reading the rest of the form.

- [ ] **Step 2: Add structural regression assertions**

Read the source files and assert all of these are absent:

```js
assert.doesNotMatch(fbaShopsFeatureSource, /fallbackFbaShops|fallbackFbaAddresses|getFallbackFbaShop/);
assert.doesNotMatch(fbaTaskFormFeatureSource, /sid\s*\|\|\s*11501|getFallbackFbaShop/);
assert.doesNotMatch(appSource, /getFallbackFbaShop|getFallbackFbaShops|fallbackFbaShops:/);
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test test/fbaShopsFeature.test.js test/fbaTaskFormFeature.test.js test/frontendStructure.test.js`

Expected: FAIL on the existing fallback constants and default SID behavior.

- [ ] **Step 4: Implement minimal fail-visible frontend behavior**

Delete static shops and addresses from `fba-shops.js`. Initialize selection as an empty `Set`; accept only normalized API rows with SID/name; if fetch, JSON, or empty shops fails, clear state, rerender, call `onDirectoryError`, and rethrow. Remove `getFrontShopSellers`, `getFallback*`, and address synthesis. In task form, throw before payload construction when no selected shop exists. In freight and shipment-order features, render only `getFbaShops()`.

- [ ] **Step 5: Update composition and sync-center error flow**

Remove fallback variables and dependencies from `app.js`. Keep error presentation in the owning FBA feature through existing `setText`/table-message utilities. Change `sync-center.js` so a failed `/api/lingxing/shops` request displays the error but does not call `renderLingxingShops({ sellers: [] })` as if loading succeeded.

- [ ] **Step 6: Verify GREEN**

Run: `node --test test/fbaShopsFeature.test.js test/fbaTaskFormFeature.test.js test/frontendStructure.test.js test/frontShopFilters.test.js`

Expected: all selected tests PASS and source scans find no fallback identifiers.

- [ ] **Step 7: Commit**

```bash
git add assets/js/features/fba-shops.js assets/js/features/fba-freight.js assets/js/features/fba-shipment-order.js assets/js/features/fba-task-form.js assets/js/features/sync-center.js app.js test/fbaShopsFeature.test.js test/fbaTaskFormFeature.test.js test/frontendStructure.test.js
git commit -m "refactor: remove FBA seller fallbacks"
```

### Task 4: Enforce canonical sellers in FBA candidates and STA payloads

**Files:**
- Modify: `src/services/fbaShipmentCandidateService.js`
- Modify: `src/services/fbaFreightSheetService.js`
- Modify: `src/services/fbaStaService.js`
- Modify: `src/services/fbaStaTaskService.js`
- Modify: `test/fbaShipmentCandidateService.test.js`
- Modify: `test/fbaFreightSheetService.test.js`
- Modify: `test/fbaStaService.test.js`
- Modify: `test/fbaStaTaskService.test.js`

- [ ] **Step 1: Write failing service boundary tests**

Assert candidate filters do not default to `lingxingShopMap` SIDs, seller maps contain only supplied/runtime sellers, unknown shipment SIDs remain unresolved and produce an explicit error, and STA/task payload normalization rejects an unknown store before resolving any sender profile. Keep positive tests for known `xiamentanjia` and `tandanbo` shops.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/fbaStaService.test.js test/fbaStaTaskService.test.js`

Expected: FAIL because candidates seed static mappings/default SIDs and STA paths accept the non-strict address fallback.

- [ ] **Step 3: Remove static identity sources**

Make candidate and freight methods require caller-provided sellers or load them via `getSellerDirectory`; build seller maps only from those rows. If no SIDs are requested, derive them from the directory, never `lingxingShopMap`. Unknown response SID/name must be listed in diagnostics and must not receive a fabricated name/country.

- [ ] **Step 4: Fail before STA/Freight legal payload generation**

Resolve the selected shop against the canonical seller list by SID/name. Require a non-null legal profile before building STA, persisted task, or freight/Jiufang Excel sender fields. Throw messages containing the unresolved SID/name and log the service path; do not include raw request/response objects.

- [ ] **Step 5: Verify GREEN**

Run: `node --test test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/fbaStaService.test.js test/fbaStaTaskService.test.js test/jiufangFbaOrderService.test.js`

Expected: all selected tests PASS; known legal senders retain the documented company and English address fields.

- [ ] **Step 6: Commit**

```bash
git add src/services/fbaShipmentCandidateService.js src/services/fbaFreightSheetService.js src/services/fbaStaService.js src/services/fbaStaTaskService.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/fbaStaService.test.js test/fbaStaTaskService.test.js
git commit -m "fix: reject unmapped sellers in FBA workflows"
```

### Task 5: Mapping audit, documentation, and end-to-end verification

**Files:**
- Modify: `CONTEXT.md` only if implementation changes a domain term
- Modify: `docs/superpowers/specs/2026-08-10-seller-identity-directory-design.md` only if implementation changes the approved contract
- Test: all files under `test/`

- [ ] **Step 1: Run an offline mapping audit**

Use the canonical normalizer against `data-cache/lingxing-sellers.json` when present and print only `{ sid, name, country, mappedOwner }`. If absent, report that live completeness cannot be proven. Confirm repository-only findings: `tanjia-eu-UK` SID `17305` is test-only/unmapped and `tanjia-eu-DE` SID `17307` is budget-only/not FBA-approved.

- [ ] **Step 2: Run static and targeted verification**

Run:

```bash
npm run check
node --test test/sellerDirectoryService.test.js test/fbaShopDirectory.test.js test/fbaShopsFeature.test.js test/fbaTaskFormFeature.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/fbaStaService.test.js test/fbaStaTaskService.test.js test/jiufangFbaOrderService.test.js test/frontendStructure.test.js
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: exit `0`, zero failed tests, including the existing browser CSS check.

- [ ] **Step 4: Verify the rendered UI in a real browser**

Start the local server with a test-safe seller directory fixture or authenticated development setup. Verify the FBA view renders without console errors, mouse and keyboard can open/select the shop control, API `/api/fba/shops` supplies the selected SID/name, and an unavailable directory leaves the control empty with a visible error at desktop and narrow viewport widths. Capture screenshots for both states and remove any temporary fixture/harness afterward.

- [ ] **Step 5: Review the final diff against the approved spec**

Confirm every acceptance criterion is backed by a test or browser observation, no fallback identifiers remain, no raw seller payload/token is logged, no CSS was changed, and unrelated refactors are absent.

- [ ] **Step 6: Commit verification-only documentation changes if any**

```bash
git add CONTEXT.md docs/superpowers/specs/2026-08-10-seller-identity-directory-design.md
git diff --cached --quiet || git commit -m "docs: align seller directory contract"
```

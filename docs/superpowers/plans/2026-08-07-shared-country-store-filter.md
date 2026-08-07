# Shared Country And Store Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one reusable country/store multi-select rule and use it in the store operating monthly report.

**Architecture:** `createFilterControls()` will expose a generic `syncCountryStoreSelection()` helper. The helper receives the two native select elements and complete normalized store options, then delegates rendering to the existing `setSelectOptions()` path so enhanced dropdown state stays synchronized. The monthly-report feature remains responsible for building its seller directory and for query loading, but delegates country-change selection projection to the shared helper.

**Tech Stack:** Native ES modules, Node.js built-in test runner, native HTML selects, existing enhanced filter dropdown controls, Playwright/in-app browser verification.

---

## File Structure

- Modify: `assets/js/filter-controls.js` - add the page-agnostic country-to-store selection helper and export it from the shared control factory.
- Modify: `test/filterControls.test.js` - cover all-option and country-to-store selection projection at the shared boundary.
- Modify: `assets/js/features/store-operating-monthly-report.js` - inject and call the shared helper while preserving report-specific filter/query ownership.
- Modify: `test/storeOperatingMonthlyReportFeature.test.js` - prove a country change requests the shared helper and uses its selected matching stores in the later report query.
- Modify: `index.html` - order the monthly report filter markup as date, country, store, currency, query, reset.
- Modify: `app.js` - pass the helper returned by `createFilterControls()` into the monthly-report feature factory.
- Do not modify: backend routes/services, `assets/css/*`, generated `styles.css`, or unrelated page feature modules.

### Task 1: Shared Country/Store Projection

**Files:**
- Modify: `test/filterControls.test.js`
- Modify: `assets/js/filter-controls.js`

- [ ] **Step 1: Write failing unit tests for the shared helper**

Add a DOM-like multiple-select fixture whose `options` track `selected` state, and test the public factory method. The tests must require the following contract:

```js
test("country store selection selects matching stores when countries are selected", () => {
  const { controls, countrySelect, storeSelect } = makeCountryStoreControls({
    countries: ["美国"],
    stores: [
      { value: "us-a", label: "US-A", country: "美国" },
      { value: "ca-a", label: "CA-A", country: "加拿大" },
      { value: "us-b", label: "US-B", country: "美国" },
    ],
  });

  controls.syncCountryStoreSelection({ countrySelect, storeSelect, storeOptions: stores });

  assert.deepEqual(selectedValues(storeSelect), ["us-a", "us-b"]);
  assert.equal(storeSelect.options[0].selected, false);
});

test("country store selection restores all stores when no concrete country is selected", () => {
  const { controls, countrySelect, storeSelect, stores } = makeCountryStoreControls({ countries: [] });

  controls.syncCountryStoreSelection({ countrySelect, storeSelect, storeOptions: stores });

  assert.deepEqual(selectedValues(storeSelect), []);
  assert.equal(storeSelect.options[0].selected, true);
});
```

Include a third test that passes a null store select and asserts the explicit helper error. Do not test private HTML details.

- [ ] **Step 2: Run the focused test file and verify it fails because the public helper is absent**

Run:

```bash
node --test test/filterControls.test.js
```

Expected: the new test cases fail with `controls.syncCountryStoreSelection is not a function`.

- [ ] **Step 3: Implement the minimal shared helper**

Inside `createFilterControls()`, add a method that validates input, obtains concrete countries through the injected `selectedFilterValues`, and reuses `setSelectOptions`:

```js
function syncCountryStoreSelection({ countrySelect, storeSelect, storeOptions = [] } = {}) {
  if (!countrySelect) throw new Error("syncCountryStoreSelection requires a country select.");
  if (!storeSelect) throw new Error("syncCountryStoreSelection requires a store select.");
  if (!Array.isArray(storeOptions)) throw new Error("syncCountryStoreSelection requires storeOptions to be an array.");

  syncAllOptionSelection(countrySelect);
  const countries = selectedFilterValues(countrySelect);
  setSelectOptions(storeSelect, storeOptions, "全部店铺", {
    groupByCountry: true,
    countries,
    selectAllVisible: countries.length > 0,
  });
}
```

Expose `syncCountryStoreSelection` alongside `setSelectOptions` and `syncAllOptionSelection`. This uses the existing renderer's stable all-option behavior: concrete country values select all matching stores; an empty country scope selects the store all-option.

- [ ] **Step 4: Run the focused shared-filter test file and verify it passes**

Run:

```bash
node --test test/filterControls.test.js
```

Expected: all filter-controls tests pass, including all-state, selected-country, and invalid-input coverage.

- [ ] **Step 5: Commit the shared helper**

```bash
git add assets/js/filter-controls.js test/filterControls.test.js
git commit -m "feat: share country store filter selection"
```

### Task 2: Store Operating Monthly Report Adoption

**Files:**
- Modify: `test/storeOperatingMonthlyReportFeature.test.js`
- Modify: `assets/js/features/store-operating-monthly-report.js`
- Modify: `app.js`
- Modify: `index.html`

- [ ] **Step 1: Write a failing feature test for country-to-store delegation**

Extend `makeFeatureHarness()` with a `syncCountryStoreSelection` spy. Add a test asserting that a country change delegates the complete normalized store directory and, after a query, sends the projected store values:

```js
test("monthly report country selection delegates matching store selection to shared controls", async () => {
  const { feature, elements, requests, countryStoreSyncCalls } = makeFeatureHarness();
  feature.initializeStoreOperatingMonthlyReportDefaults();
  elements["#store-operating-report-country"].selectedValues = ["美国"];

  feature.handleCountryChange();

  assert.equal(countryStoreSyncCalls.length, 1);
  assert.deepEqual(countryStoreSyncCalls[0].storeOptions.map(({ name, country }) => ({ name, country })), [
    { name: "A", country: "美国" },
    { name: "B", country: "加拿大" },
  ]);
  assert.deepEqual(elements["#store-operating-report-store"].selectedValues, ["A"]);

  await feature.loadStoreOperatingMonthlyReport();
  assert.match(requests[0], /stores=A/);
  assert.match(requests[0], /countries=%E7%BE%8E%E5%9B%BD/);
});
```

The harness spy may set the supplied `storeSelect.selectedValues` to matching option names, modelling the shared helper's public contract. Update the pre-existing “country edits narrow store options” test so it asserts shared delegation rather than page-owned narrowed rendering.

- [ ] **Step 2: Run the focused feature test and verify it fails due to the missing dependency**

Run:

```bash
node --test test/storeOperatingMonthlyReportFeature.test.js
```

Expected: the new test fails because the feature neither accepts nor invokes `syncCountryStoreSelection`.

- [ ] **Step 3: Adopt the shared helper in the monthly-report feature**

Add `syncCountryStoreSelection` to `createStoreOperatingMonthlyReportFeature()` dependencies and validate it. Replace the country-change path with:

```js
function handleCountryChange() {
  invalidateActiveReportLoad();
  syncCountryStoreSelection({
    countrySelect: query("#store-operating-report-country"),
    storeSelect: query("#store-operating-report-store"),
    storeOptions,
  });
  const exportButton = query("#store-operating-report-export");
  if (exportButton) exportButton.disabled = !sameQuery(buildReportQuery(), lastSuccessfulQuery);
}
```

Keep `refreshStoreOptions()` for initial URL restoration and reset. Do not call it from `handleCountryChange`, because the shared helper is now the only country-change projection owner. Wire the helper from `app.js`:

```js
const { initializeFilterDropdowns, setSelectOptions, syncAllOptionSelection, syncCountryStoreSelection } = createFilterControls(/* existing dependencies */);
```

Pass `syncCountryStoreSelection` into `createStoreOperatingMonthlyReportFeature()` with its other filter dependencies.

Move the two markup labels in `index.html` so country precedes store while retaining existing IDs, labels, multiple attributes, first all-options, and sizes.

- [ ] **Step 4: Run feature tests and JavaScript syntax verification**

Run:

```bash
node --test test/storeOperatingMonthlyReportFeature.test.js
npm run check:js
```

Expected: both commands exit 0; the feature test proves country scope maps to matching stores and the request retains repeated store/country parameters.

- [ ] **Step 5: Commit monthly report adoption**

```bash
git add app.js index.html assets/js/features/store-operating-monthly-report.js test/storeOperatingMonthlyReportFeature.test.js
git commit -m "feat: link monthly report country and store filters"
```

### Task 3: Full Regression And Browser Verification

**Files:**
- No additional production files unless verification identifies a concrete defect.

- [ ] **Step 1: Build and run static checks**

Run:

```bash
npm run check
node --test test/filterControls.test.js test/storeOperatingMonthlyReportFeature.test.js
```

Expected: CSS generation check, CSS standards, JS syntax, and both focused suites pass.

- [ ] **Step 2: Run complete automated regression suite**

Run:

```bash
npm test
```

Expected: all Node tests pass and `test:store-operating-css-browser` exits 0.

- [ ] **Step 3: Verify the rendered control order and interaction in a browser**

Start the local server if no existing local server serves this checkout. Open the monthly-report view and authenticate using the existing local session. Verify at desktop and a narrow viewport:

1. Date range is followed by country, then store.
2. Country and store dropdowns show `全部国家` and `全部店铺` as their first choices.
3. Selecting `美国` checks every visible United States store and excludes non-US stores.
4. The query request includes `countries=美国` plus each selected US `stores` value.
5. Selecting `全部国家` restores the store all-option, without document-level horizontal overflow or console errors.

- [ ] **Step 4: Commit any verification-only corrective change**

Only when Steps 1-3 uncover a reproducible defect, write a failing test first, implement the minimal correction, rerun Steps 1-3, then commit with a precise `fix:` message. Do not create a commit if no corrective code is needed.

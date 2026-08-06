# Filter CSS Ownership Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove page and legacy filter CSS overrides, enforce the shared ownership boundary in tests, and make filter control focus presentation keyboard-specific.

**Architecture:** The page and legacy layers retain business-content layout only. `assets/css/components/30-surfaces-and-filters.css` and `assets/css/components/35-filter-toolbar.css` remain the only owners of shared filter control structure. The structural test derives page-specific aliases from the real `index.html` elements that carry `.filters` or `.filter-toolbar`, then rejects baseline declarations for those aliases in page and legacy CSS.

**Tech Stack:** Native HTML, layered CSS compiled by `scripts/build-styles.js`, Node.js built-in test runner, Playwright/local browser verification.

---

## File Structure

- Modify `test/stylesStructure.test.js`: derive shared filter aliases from live markup, test page and legacy declarations, and update the clearance ownership assertion after its filter alias is removed.
- Modify `assets/css/pages/26-clearance-calculator.css`: remove only the ineffective filter baseline declarations; retain workbench, KPI, result, and responsive hero layout.
- Modify `assets/css/pages/36-fba-shipment-order.css`: remove only the unused shipment-order toolbar and its mobile overrides; retain panel, summary, status, and table presentation.
- Modify `assets/css/legacy/current.css`: remove `.filters` from the legacy responsive grid selector.
- Modify `assets/css/components/30-surfaces-and-filters.css`: replace filter/form `:focus` selectors with `:focus-visible`, retaining the shared token declarations.
- Regenerate `styles.css` only through `npm run build:css`.

### Task 1: Make the ownership test fail for real shared-filter aliases

**Files:**
- Modify: `test/stylesStructure.test.js:88-111, 324-337, 1352-1381`
- Test: `test/stylesStructure.test.js`

- [ ] **Step 1: Add a helper that derives aliases from live shared-filter markup**

  Add this helper immediately above `pageFilterBaselineOverrides`:

  ```js
  function sharedFilterSelectors(indexSource) {
    const selectors = new Set([".filters", ".filter-toolbar"]);
    for (const match of indexSource.matchAll(/\bclass="([^"]*)"/g)) {
      const classes = match[1].trim().split(/\s+/).filter(Boolean);
      if (!classes.includes("filters") && !classes.includes("filter-toolbar")) continue;
      for (const className of classes) selectors.add(`.${className}`);
    }
    return selectors;
  }
  ```

- [ ] **Step 2: Change the violation helper to accept live selectors and normalize every comma-separated selector**

  Use the following signature and predicate; keep the two sales visibility exceptions:

  ```js
  function pageFilterBaselineOverrides(cssSource, filterSelectors) {
    const overrides = [];
    const source = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");
    const forbiddenDeclarationPattern = /\b(?:display|grid-template(?:-columns|-rows)?|gap|column-gap|row-gap|padding|border|border-color|border-radius|min-height|height|width|flex|align-items|box-shadow|outline|font)\s*:/;

    for (const match of source.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      const body = match[2].trim().replace(/\s+/g, " ");
      if (!forbiddenDeclarationPattern.test(body)) continue;
      for (const selector of match[1].split(",")) {
        const normalized = selector.trim().replace(/\s+/g, " ");
        if (![...filterSelectors].some((filterSelector) => normalized.includes(filterSelector))) continue;
        if (normalized === "#sales-global-filters[hidden]" && /display\s*:\s*none\s*!important/.test(body)) continue;
        if (normalized === "body:not(.sales-view) #sales-global-filters" && /display\s*:\s*none\s*!important/.test(body)) continue;
        overrides.push(`${normalized} { ${body} }`);
      }
    }
    return overrides;
  }
  ```

- [ ] **Step 3: Replace the current page-only guard with a page-and-legacy test named `shared filter CSS ownership rejects page and legacy baselines`**

  Read `index.html` and `assets/css/legacy/current.css`, use `sharedFilterSelectors(indexSource)`, append violations from every page CSS file and from the legacy source, then assert `assert.deepEqual(violations, [])`. Include the source path in each pushed entry, exactly as the current page loop does.

- [ ] **Step 4: Add dead-toolbar and focus assertions to the same test**

  Read `assets/css/pages/36-fba-shipment-order.css` and `assets/css/components/30-surfaces-and-filters.css`, then add:

  ```js
  assert.equal(indexSource.includes("fba-shipment-order-toolbar"), false);
  assert.equal(shipmentOrderSource.includes("fba-shipment-order-toolbar"), false);
  assert.match(surfacesSource, /\.filters input:focus-visible,/);
  assert.equal(surfacesSource.includes(".filters input:focus,"), false);
  ```

- [ ] **Step 5: Update the clearance page ownership test to stop requiring `.clearance-rate-panel` CSS**

  Remove the `assert.match(pageSource, /^#view-clearance \\.clearance-rate-panel\\s*\\{/m);` assertion and remove `".clearance-rate-panel {"` from its legacy ownership snippet array. Keep assertions for the remaining page-owned workbench, KPI, action, and semantic-token rules.

- [ ] **Step 6: Run the focused test and verify the expected red state**

  Run: `node --test --test-name-pattern="shared filter CSS ownership rejects page and legacy baselines" test/stylesStructure.test.js`

  Expected: FAIL with violations containing `assets/css/pages/26-clearance-calculator.css`, `assets/css/pages/36-fba-shipment-order.css`, and `assets/css/legacy/current.css`.

- [ ] **Step 7: Commit the failing test only**

  ```bash
  git add test/stylesStructure.test.js
  git commit -m "test: enforce shared filter css ownership"
  ```

### Task 2: Remove duplicate filter baselines and standardize keyboard focus

**Files:**
- Modify: `assets/css/pages/26-clearance-calculator.css:2-11, 78-81`
- Modify: `assets/css/pages/36-fba-shipment-order.css:17-53, 81-89`
- Modify: `assets/css/legacy/current.css:234`
- Modify: `assets/css/components/30-surfaces-and-filters.css:159-167`
- Modify: `styles.css` (generated)

- [ ] **Step 1: Remove the clearance filter overrides**

  Delete the three top-level `.clearance-rate-panel` blocks and remove `.clearance-rate-panel` from the narrow `grid-template-columns: 1fr` selector. Do not alter `.clearance-workbench`, `.clearance-kpi-grid`, textarea sizing, or the module hero responsive rules.

- [ ] **Step 2: Remove the unused shipment-order toolbar blocks**

  Delete every `.fba-shipment-order-toolbar` selector, including the descendant label/input/button rules and both narrow-screen rules. Keep `#fba-shipment-order-status`, `.fba-shipment-order-summary`, table styles, and the summary mobile rule. Do not remove `#fba-shipment-order-create`, which is a live feature control and remains outside this task unless the dead-toolbar removal makes its selector unused; verify with `rg -n "fba-shipment-order-create" index.html assets/js` before deciding.

- [ ] **Step 3: Remove the legacy filter selector without changing the remaining responsive grid rules**

  Change the grouped selector from:

  ```css
  .filters,
  .metric-grid,
  ```

  to:

  ```css
  .metric-grid,
  ```

- [ ] **Step 4: Limit the shared focus ring to keyboard focus**

  In `assets/css/components/30-surfaces-and-filters.css`, replace each `:focus` in the shared filter/form selector group with `:focus-visible`:

  ```css
  .filters input:focus-visible,
  .filters select:focus-visible,
  .filters .filter-dropdown-button:focus-visible,
  .form-grid input:focus-visible,
  .form-grid select:focus-visible,
  .inline-date input:focus-visible,
  .filter-toolbar input:focus-visible,
  .filter-toolbar select:focus-visible {
  ```

  Preserve the existing `outline`, `border-color`, and `box-shadow` token declarations.

- [ ] **Step 5: Regenerate the compiled stylesheet**

  Run: `npm run build:css`

  Expected: exits `0`, updates `styles.css`, and does not modify source files other than the intended CSS inputs.

- [ ] **Step 6: Run the focused test and verify the green state**

  Run: `node --test --test-name-pattern="shared filter CSS ownership rejects page and legacy baselines" test/stylesStructure.test.js`

  Expected: PASS.

- [ ] **Step 7: Commit the CSS implementation**

  ```bash
  git add assets/css/components/30-surfaces-and-filters.css assets/css/legacy/current.css assets/css/pages/26-clearance-calculator.css assets/css/pages/36-fba-shipment-order.css styles.css
  git commit -m "fix: consolidate shared filter css ownership"
  ```

### Task 3: Verify generated output and rendered behavior

**Files:**
- Verify only: `styles.css`, `index.html`, `assets/css/components/30-surfaces-and-filters.css`

- [ ] **Step 1: Run complete automated verification**

  Run: `npm test && npm run check`

  Expected: both commands exit `0`; the generated stylesheet check confirms `styles.css` is current.

- [ ] **Step 2: Run the server and verify the clearance filter at two widths**

  Run: `npm run dev`

  Open the local application, navigate to `#view-clearance`, and inspect the filter section at a desktop viewport and a narrow viewport around 390px wide.

  Expected: the filter section remains within the viewport, controls do not overlap, multi-select selected summaries are clipped or count-based according to the existing shared contract, and no page-level horizontal scrolling appears.

- [ ] **Step 3: Verify keyboard focus and control interaction**

  Use `Tab` to focus a country or shop filter control, open the enhanced dropdown with keyboard, select multiple options, then close it.

  Expected: the `--tj-focus-ring` treatment appears for keyboard focus, the trigger text does not paint over its disclosure icon or adjacent controls, and browser console output has no new errors.

- [ ] **Step 4: Inspect ownership evidence**

  Run:

  ```bash
  rg -n "clearance-rate-panel|fba-shipment-order-toolbar" assets/css/pages assets/css/legacy styles.css
  npm run build:css -- --check
  ```

  Expected: no matching page, legacy, or generated CSS selector for either removed private baseline; the stylesheet freshness check exits `0`.

- [ ] **Step 5: Commit verification-only adjustments if any are required**

  If verification exposes a real regression, add a focused test first, make the minimal shared-layer correction, rebuild `styles.css`, rerun Steps 1-4, and commit the correction separately. Do not add a page-specific CSS fallback.

## Plan Self-Review

- Spec coverage: Task 1 covers both page and legacy structural ownership, alias detection, dead toolbar removal checks, and focus-selector assertions. Task 2 removes every audited rule and regenerates generated CSS. Task 3 covers the required automated, desktop, narrow-width, mouse/keyboard, console, and generated-output checks.
- Placeholder scan: no deferred requirements or unspecified code paths remain.
- Consistency: all test names, paths, selector names, and commands correspond to the scoped source files and the design specification.

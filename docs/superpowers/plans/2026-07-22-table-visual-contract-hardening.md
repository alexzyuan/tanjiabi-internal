# Shared Table Visual Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BI table widths, semantics, styling, scrolling, and refresh behavior consistent across static and dynamic tables.

**Architecture:** `data-table-manager.js` remains the ownership point for width persistence and runtime enhancement. Renderers emit stable table/column metadata; shared CSS owns the visual baseline. Runtime mutation handling receives only affected tables rather than reprocessing the whole document.

**Tech Stack:** Native ES modules, Node test runner, layered CSS build.

## Global Constraints

- Do not hand-edit `styles.css`; run `npm run build:css`.
- User-resized width precedence stays `user > explicit > smart`.
- All table horizontal scrolling remains contained in its wrapper.
- Keep business behavior and page content unchanged.

### Task 1: Stable Dynamic Column Identity

**Files:** `assets/js/features/ad-portfolios.js`, `assets/js/features/payables-dashboard.js`, `test/adPortfolios.test.js`, `test/payablesDashboard.test.js`.

- [ ] Add failing renderer tests asserting generated header cells carry stable `data-column-key`, `data-column-kind`, and `data-column-profile` values.
- [ ] Verify the tests fail because renderers currently output bare `<th>` elements.
- [ ] Emit metadata from each advertising column definition and fixed semantic keys for payables table modes.
- [ ] Rerun focused tests and commit the green change.

### Task 2: Shared Identity and Semantic Contract

**Files:** `assets/js/data-table-manager.js`, `index.html`, `assets/js/features/sales-forecast.js`, `test/dataTableManager.test.js`, `test/stylesStructure.test.js`.

- [ ] Add failing tests for corrected financial/date/quantity labels, stable dynamic table keys, and explicit metadata on durable static tables.
- [ ] Verify the tests fail on the current classifier and positional fallback markup.
- [ ] Centralize inferred semantic mappings, extend known label coverage, add stable keys/profile metadata to static business tables, and keep fallback warnings observable.
- [ ] Rerun focused tests and commit the green change.

### Task 3: Shared Styling and Wrapper Scrolling

**Files:** `assets/css/components/45-table-controls.css`, `assets/css/components/48-application-ui-overrides.css`, `assets/css/legacy/current.css`, `assets/css/pages/24-review-rating.css`, `index.html`, `test/stylesStructure.test.js`.

- [ ] Add failing structural tests forbidding global table header pointer/vertical alignment, legacy table baseline selectors, and inline freight table widths.
- [ ] Verify the tests fail.
- [ ] Move table baseline to `.data-table`, preserve sortable affordances and table variants, and replace local width rules with semantic metadata.
- [ ] Rebuild CSS, rerun focused tests, and commit the green change.

### Task 4: Targeted Runtime Refresh and Dead-Code Removal

**Files:** `assets/js/data-table-manager.js`, `test/dataTableManager.test.js`, `assets/js/features/fba-shipment-order.js`, `assets/css/pages/36-fba-shipment-order.css`, `test/frontendStructure.test.js`.

- [ ] Add failing tests proving `.data-table-wrap` receives scroll updates and unrelated mutations do not invoke `enhanceAll`.
- [ ] Verify the tests fail.
- [ ] Bind scroll on resolved wrappers, batch affected-table refreshes, remove unreferenced FBA shipment-order files and update structure assertions.
- [ ] Rerun focused tests and commit the green change.

### Task 5: System Verification and Release

**Files:** generated `styles.css`, `design.md`, `AGENTS.md` if contract wording changes.

- [ ] Run `npm test`, `npm run check`, and `git diff --check`.
- [ ] Inspect desktop and 390px pages covering sales forecast, payables, advertising, FBA freight, and factory inventory.
- [ ] Merge into `codex/yesterday-plus-webhook`, push, package with CSS confirmation, deploy, and verify health plus all modules.

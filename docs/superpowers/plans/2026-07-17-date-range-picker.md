# Date Range Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared BI date range picker matching the approved dual-calendar screenshot and connect it first to Sales Review and FBA Freight.

**Architecture:** `assets/js/date-range-picker.js` owns range normalization, preset ranges, calendar rendering, and input synchronization. Existing feature modules keep their current start/end input IDs so API query code does not change. CSS lives in the shared component layer and page CSS only keeps page-specific layout.

**Tech Stack:** Native HTML/CSS/JavaScript ES modules, Node `--test`, generated `styles.css` from `assets/css/*`.

---

### Task 1: Shared Picker Behavior

**Files:**
- Create: `assets/js/date-range-picker.js`
- Create: `test/dateRangePicker.test.js`

- [ ] Add tests for range normalization, preset resolution, and month grid generation.
- [ ] Implement exported helpers and `createDateRangePicker`.
- [ ] Verify with `node --test test/dateRangePicker.test.js`.

### Task 2: Sales Review Integration

**Files:**
- Modify: `index.html`
- Modify: `assets/js/sales-shell.js`
- Modify: `test/salesShell.test.js`

- [ ] Replace the old Sales Review date popover internals with a shared picker mount.
- [ ] Initialize the picker from `createSalesShell` and keep `onDateRangeChange` behavior.
- [ ] Verify Sales shell tests.

### Task 3: FBA Freight Integration

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/fba-freight.js`
- Modify: `test/fbaFreightFeature.test.js`

- [ ] Keep hidden original `#fba-freight-start-date` and `#fba-freight-end-date` values.
- [ ] Add a visible shared picker trigger to the FBA filter toolbar.
- [ ] Refresh picker label after default dates are initialized.

### Task 4: Shared CSS And Structure Gates

**Files:**
- Create: `assets/css/components/36-date-range-picker.css`
- Modify: `test/stylesStructure.test.js`
- Modify: `styles.css` via `npm run build:css`

- [ ] Add shared trigger, popover, shortcut rail, dual-month calendar, range fill, selected-day, and hidden-input styles using semantic tokens.
- [ ] Add structure tests so picker CSS stays outside page and legacy layers.
- [ ] Run `npm run build:css`.

### Task 5: Verification, Publish, Deploy

**Files:**
- Verify all changed files.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Browser test Sales Review and FBA Freight date picker at `http://localhost:4173/`.
- [ ] Commit, push `codex/table-baseline-resizable`, deploy package, and check `/api/health`.

# Shared Smart Table Widths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every managed BI table resolve its default column widths from one shared rule that combines column-name semantics with the first 30 business rows while preserving user widths.

**Architecture:** Extend `data-table-manager.js` with pure semantic profile and width-estimation functions, then connect them to bounded DOM sampling and the existing `colgroup` pipeline. Stable runtime keys, legacy storage migration, reset behavior, and structured diagnostics remain in the manager; shared CSS renders the resolved width and alignment while page CSS keeps only true layout exceptions.

**Tech Stack:** Native ES modules, browser DOM and Canvas 2D text measurement, `localStorage`, layered CSS, Node.js built-in test runner.

---

### Task 1: Semantic Profiles And Pure Width Estimation

**Files:**
- Modify: `assets/js/data-table-manager.js`
- Modify: `test/dataTableManager.test.js`

- [ ] **Step 1: Write failing semantic-profile tests**

Import `inferSmartColumnProfile` and assert project vocabulary resolves to the intended profiles:

```js
test("smart table widths classify BI column semantics", () => {
  const cases = new Map([
    ["关注", "selection"],
    ["发货产品图片", "image"],
    ["国家", "compact-dimension"],
    ["FBA可售", "number"],
    ["采购成本小计", "money-rate"],
    ["创建时间", "date-time"],
    ["货件状态", "status"],
    ["MSKU / FNSKU", "identifier"],
    ["货件单号", "code-order"],
    ["产品名称", "name"],
    ["处理结果", "narrative"],
    ["操作", "action"],
  ]);
  for (const [label, expected] of cases) {
    assert.equal(inferSmartColumnProfile(label), expected, label);
  }
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/dataTableManager.test.js`

Expected: FAIL because `inferSmartColumnProfile` is not exported.

- [ ] **Step 3: Add shared profiles and classifier**

Define immutable profiles and ordered specific-to-general label patterns in `data-table-manager.js`:

```js
const SMART_COLUMN_PROFILES = Object.freeze({
  selection: { min: 44, preferred: 48, max: 56, padding: 12, align: "center" },
  image: { min: 52, preferred: 56, max: 64, padding: 8, align: "center" },
  "compact-dimension": { min: 56, preferred: 64, max: 80, padding: 20, align: "left" },
  number: { min: 64, preferred: 76, max: 96, padding: 20, align: "right" },
  "money-rate": { min: 80, preferred: 92, max: 112, padding: 20, align: "right" },
  "date-time": { min: 96, preferred: 112, max: 136, padding: 20, align: "left" },
  status: { min: 84, preferred: 96, max: 128, padding: 20, align: "left" },
  identifier: { min: 112, preferred: 136, max: 180, padding: 20, align: "left" },
  "code-order": { min: 128, preferred: 152, max: 200, padding: 20, align: "left" },
  name: { min: 140, preferred: 176, max: 240, padding: 20, align: "left" },
  narrative: { min: 160, preferred: 200, max: 280, padding: 20, align: "left" },
  action: { min: 72, preferred: 104, max: 320, padding: 16, align: "left" },
  text: { min: 80, preferred: 112, max: 180, padding: 20, align: "left" },
});

export function inferSmartColumnProfile(label = "", explicitProfile = "") {
  const explicit = String(explicitProfile || "").trim().toLowerCase();
  if (SMART_COLUMN_PROFILES[explicit]) return explicit;
  const normalized = normalizeColumnLabel(label);
  for (const [profile, pattern] of SMART_COLUMN_PROFILE_PATTERNS) {
    if (pattern.test(normalized)) return profile;
  }
  return "text";
}
```

- [ ] **Step 4: Write failing estimator tests**

Add tests for clamping, first-30 sampling, and outlier resistance with a deterministic `measureText` stub:

```js
test("smart width estimator samples 30 rows and resists one long outlier", () => {
  const values = Array.from({ length: 30 }, () => "TJ033");
  values[29] = "X".repeat(200);
  values.push("Y".repeat(300));
  const result = estimateSmartColumnWidth({
    label: "MSKU",
    values,
    measureText: (value) => String(value).length * 8,
  });
  assert.equal(result.profile, "identifier");
  assert.equal(result.sampleCount, 30);
  assert.ok(result.width >= 112 && result.width < 180);
});
```

- [ ] **Step 5: Implement pure estimation**

Implement and export `estimateSmartColumnWidth({ label, values, explicitProfile, measureText, controlWidth })`. It slices to 30 values, sorts measured widths, selects the 90th percentile, adds profile padding, includes measured header width, handles fixed selection/image profiles, uses `controlWidth` for action columns, and clamps to profile bounds.

- [ ] **Step 6: Run focused tests**

Run: `node --test test/dataTableManager.test.js`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add assets/js/data-table-manager.js test/dataTableManager.test.js
git commit -m "feat: add smart table width profiles"
```

### Task 2: DOM Sampling, Width Precedence, And Diagnostics

**Files:**
- Modify: `assets/js/data-table-manager.js`
- Modify: `test/dataTableManager.test.js`

- [ ] **Step 1: Extend the test harness for rows and text measurement**

Add configurable headers, body rows, `document.createElement("canvas")`, and a deterministic canvas context to the harness. Add assertions that only the first 30 non-state rows are sampled and excluded tooltip/helper content does not affect the width.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test test/dataTableManager.test.js`

Expected: FAIL because smart DOM sampling is not connected to enhancement.

- [ ] **Step 3: Implement bounded cell extraction and text measurement**

Add these focused helpers:

```js
function extractSampleCellText(cell) {
  if (!cell) return "";
  const clone = cell.cloneNode?.(true);
  if (!clone) return String(cell.textContent || "").trim();
  clone.querySelectorAll?.(".table-resize-handle, [role='tooltip'], [hidden], .tooltip").forEach((node) => node.remove());
  return String(clone.textContent || "").replace(/\s+/g, " ").trim();
}

function createTextMeasurer(table) {
  const canvas = table.ownerDocument.createElement("canvas");
  const context = canvas.getContext("2d");
  const style = table.ownerDocument.defaultView.getComputedStyle(table);
  context.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  return (value) => context.measureText(String(value || "")).width;
}
```

- [ ] **Step 4: Implement one-pass smart resolution**

Add `resolveSmartColumnWidths(table, storage, { force = false } = {})` that:

1. Reads leaf headers and at most 30 non-state rows.
2. Builds all column samples before writing styles.
3. Applies precedence `user > explicit > smart > fallback`.
4. Stores `data-width-profile`, `data-width-source`, and measured metadata on each `col`.
5. Sets `--tj-table-resolved-width` to the summed widths.
6. Adds `is-smart-width` and `is-column-resized` once.
7. Emits a gated structured `console.debug("[data-table-manager] smart widths", details)` record.

- [ ] **Step 5: Add a sample signature cache**

Use a module-level `WeakMap` keyed by table. The signature combines stable column keys, labels, explicit metadata, and sampled values. Repeated mutation enhancement with the same signature must not remeasure or rewrite widths.

- [ ] **Step 6: Run focused tests**

Run: `node --test test/dataTableManager.test.js`

Expected: PASS, including user and explicit width precedence.

- [ ] **Step 7: Commit Task 2**

```bash
git add assets/js/data-table-manager.js test/dataTableManager.test.js
git commit -m "feat: apply sampled smart table widths"
```

### Task 3: Stable Keys, Legacy Migration, And Restore Command

**Files:**
- Modify: `assets/js/data-table-manager.js`
- Modify: `assets/css/components/45-table-controls.css`
- Modify: `test/dataTableManager.test.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write failing key and migration tests**

Test that an anonymous table inside `#view-payables` receives a stable runtime key, a renamed header keeps an index-based fallback column key, and a legacy header-derived `v1` record is copied to the stable storage key without deletion.

- [ ] **Step 2: Implement stable runtime identities**

Add `ensureStableTableIdentity(table)` and `ensureStableColumnIdentities(table, headers)`:

```js
function ensureStableTableIdentity(table) {
  if (table.dataset.tableKey || table.id) return table.dataset.tableKey || table.id;
  const view = table.closest(".view[id]");
  if (!view) throw new Error("[data-table-manager] managed table requires an id or containing view id");
  const tables = Array.from(view.querySelectorAll(TABLE_SELECTOR));
  const index = tables.indexOf(table);
  if (index < 0) throw new Error("[data-table-manager] managed table identity could not be resolved");
  table.dataset.tableKey = `${view.id}:table-${index + 1}`;
  return table.dataset.tableKey;
}
```

For columns, prefer existing `data-column-key`, sort-field attributes, or a child control's sort-field attribute; otherwise assign `column-${index + 1}`. Detect duplicate table keys in the document and log a structured error.

- [ ] **Step 3: Implement legacy storage migration**

Before reading the stable key, calculate the former header-derived key. When the stable key is empty and the legacy key contains valid widths, map legacy index/label entries to current stable column keys, write the stable record with `migratedFrom`, and log the migration.

- [ ] **Step 4: Write failing restore tests**

Test that `manager.restoreSmartWidths(table)` removes only that table's storage record, clears every `data-user-width`, reapplies smart widths, and leaves another table's record unchanged.

- [ ] **Step 5: Implement restore API and conditional icon command**

Expose `restoreSmartWidths(table)` from the manager. Add one button to the table wrapper only when saved user widths exist:

```html
<button class="table-width-reset" type="button" aria-label="恢复智能列宽" title="恢复智能列宽">↺</button>
```

The delegated click handler resolves the owned table, restores smart widths, refreshes sticky offsets and overflow hints, and logs the reset. The button is hidden when the table has no user overrides.

- [ ] **Step 6: Add shared reset-button styling**

Place the button in the wrapper's top-right control area with a 32 px stable hit target, semantic border/background tokens, hover state, and visible focus ring. Ensure it does not cover the last table header.

- [ ] **Step 7: Run focused structure and manager tests**

Run: `node --test test/dataTableManager.test.js test/frontendStructure.test.js`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add assets/js/data-table-manager.js assets/css/components/45-table-controls.css test/dataTableManager.test.js test/frontendStructure.test.js
git commit -m "feat: add stable smart width reset"
```

### Task 4: Shared CSS Contract And Page Rule Cleanup

**Files:**
- Modify: `assets/css/components/45-table-controls.css`
- Modify: `assets/css/final/90-table-invariants.css`
- Modify: `assets/css/pages/25-sales-forecast.css`
- Modify: `assets/css/pages/35-fba-freight.css`
- Modify: `assets/css/pages/53-supplier-board.css`
- Modify: `assets/css/pages/52-factory-inventory.css`
- Modify: other `assets/css/pages/*.css` files only when the structure test identifies an ordinary fixed business-column width
- Modify: `assets/js/features/sales-forecast.js`
- Modify: `test/stylesStructure.test.js`
- Modify: `test/dataTableManager.test.js`
- Regenerate: `styles.css`

- [ ] **Step 1: Write failing shared-contract tests**

Require shared CSS to use `--tj-table-resolved-width`, right-align numeric headers and cells, center selection/image profiles, and constrain narrative/identifier overflow. Add a structure scan that rejects page selectors assigning ordinary `th:nth-child(...)` or business-column `width/min-width`, with a narrow allowlist for modal and sticky-layout constraints.

- [ ] **Step 2: Run style tests and verify failure**

Run: `node --test test/stylesStructure.test.js`

Expected: FAIL on current fixed page widths and missing smart-width contract.

- [ ] **Step 3: Implement shared smart-width CSS**

Add the shared rules:

```css
table.data-table.is-smart-width {
  width: max(100%, var(--tj-table-resolved-width, 980px));
  min-width: 0;
  table-layout: fixed;
}

table.data-table :is(th, td)[data-width-align="right"] { text-align: right; }
table.data-table :is(th, td)[data-width-align="center"] { text-align: center; }
table.data-table :is(th, td)[data-width-profile="identifier"] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.data-table :is(th, td)[data-width-profile="narrative"] { overflow-wrap: anywhere; white-space: normal; }
```

The manager writes matching profile/alignment attributes to headers and body cells.

- [ ] **Step 4: Remove conflicting ordinary fixed widths**

Remove the FBA `380px` operation width, Supplier Board `1680px` blanket width, Factory Inventory blanket width where resolved columns supersede it, and Sales Forecast per-column width/min-width declarations. Keep sticky positioning and group backgrounds; calculate sticky offsets exclusively from resolved `colgroup` widths.

Remove `width` values from `salesForecastColumns` so it supplies stable column keys and business types but receives width from the shared engine.

- [ ] **Step 5: Regenerate CSS and run focused tests**

Run:

```bash
npm run build:css
node --test test/dataTableManager.test.js test/stylesStructure.test.js
npm run check
```

Expected: PASS with generated `styles.css` matching layered sources and no new CSS debt.

- [ ] **Step 6: Commit Task 4**

```bash
git add assets/css assets/js/features/sales-forecast.js styles.css test/dataTableManager.test.js test/stylesStructure.test.js
git commit -m "refactor: unify table width presentation"
```

### Task 5: Rendered Calibration, Regression Verification, And Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` only if the shared table source-of-truth guidance is absent
- Modify: tests or shared implementation only when rendered evidence exposes a root-cause defect

- [ ] **Step 1: Start a local mock server**

Run: `PORT=4321 DATA_PROVIDER=mock AUTH_USERNAME= AUTH_PASSWORD= SESSION_SECRET= node server.js`

Expected: app serves `http://127.0.0.1:4321/`; missing Lingxing credentials may produce explicit mock-environment errors but must not blank the UI.

- [ ] **Step 2: Verify representative desktop tables**

Use the Browser plugin at 1280x720 and inspect:

- Sales Forecast: compact controls, readable product/MSKU, no sticky overlap.
- FBA Freight: compact country/image fields, action width reflects controls, result text wraps.
- Supplier Board: compact image/country, readable identifiers and money columns.
- Factory Inventory: image, SKU, money, quantity, date, and inventory profiles.
- Payables and Inventory Provision: financial alignment and readable totals.
- Review Rating: a four-column table fills its container without forced 980 px overflow.

Expected: no framework overlay, no relevant console warning/error, and no page-level horizontal overflow outside table wrappers.

- [ ] **Step 3: Verify interaction and persistence**

On Sales Forecast, drag one column, reload, and confirm the saved width remains. Activate `恢复智能列宽`, confirm the shared width returns, reload again, and confirm the smart width remains.

- [ ] **Step 4: Verify narrow viewport containment**

Use a 390x844 viewport on Sales Forecast, FBA Freight, and Review Rating.

Expected: no page-level horizontal overflow, table wrappers scroll independently, controls and text do not overlap, and the reset icon remains usable.

- [ ] **Step 5: Update living documentation**

Document in `README.md` that table widths are centrally managed by `assets/js/data-table-manager.js`, use semantic profiles plus 30-row sampling, and preserve browser-local user overrides. Add the same source-of-truth rule to `AGENTS.md` if it is not already present.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm test
npm run check
git diff --check
git status --short --branch
```

Expected: all tests and checks pass; only intentional implementation files are modified.

- [ ] **Step 7: Commit documentation and final calibration fixes**

```bash
git add README.md AGENTS.md assets test styles.css
git commit -m "docs: document shared smart table widths"
```

- [ ] **Step 8: Stop local server and record deployment readiness**

Stop the local server. Do not package, push, merge, or deploy until the user explicitly requests those actions for this implementation branch.

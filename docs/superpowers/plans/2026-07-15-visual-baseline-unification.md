# Visual Baseline Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the temporary `styles.css` visual lock safely, then unify the application's visual layer around Spectrum-aligned project tokens without breaking the approved sidebar/topbar baseline.

**Architecture:** Keep `styles.css` as a generated artifact and do not hand-edit it. First make current visuals observable through repeatable screenshots, then make `assets/css/*` reproduce the locked baseline, then run a controlled CSS rebuild, and only after that apply visual unification through tokens, shared components, and page-layer CSS.

**Tech Stack:** Native HTML/CSS/JS, Node.js ESM, existing CSS build scripts, in-app browser or Playwright for visual verification, `node:test`, `npm run build:css -- --check`, `npm run check`.

---

## File Structure

- Create `docs/visual-baseline/2026-07-15/README.md`: records baseline pages, viewport sizes, interaction states, and screenshot artifact paths.
- Create `docs/visual-baseline/2026-07-15/findings.md`: records visual mismatches found during parity work and how each was resolved.
- Modify `scripts/build-styles.js`: add a safe non-destructive `--output` flag so generated CSS can be previewed without overwriting `styles.css`.
- Modify CSS source files under `assets/css/*` only:
  - `assets/css/tokens/*` for reusable semantic tokens.
  - `assets/css/layout/*` for shell/sidebar/topbar.
  - `assets/css/components/*` for shared controls, tables, modal shells, status pills, filters.
  - `assets/css/pages/*` for feature-specific rules.
  - `assets/css/legacy/*` only to shrink or document temporary parity selectors.
- Modify `test/stylesStructure.test.js` only when the visual lock is actually removed and the generated CSS budget/gates are re-enabled.
- Do not hand-edit `styles.css` before Phase 3.
- Do not add one-off visual overrides to the end of `styles.css`.
- Do not add isolated React islands; this remains native HTML/CSS/JS.

## Phase 1: Current Visual Baseline

### Task 1: Capture The Locked Baseline

**Files:**
- Create: `docs/visual-baseline/2026-07-15/README.md`

- [x] **Step 1: Start the local server**

Run:
```bash
npm start
```

Expected:
```text
探嘉 BI listening on http://127.0.0.1:4173
```

If port `4173` is already in use, stop the existing local server only if it belongs to this repo; otherwise use the already-running server for screenshots.

- [x] **Step 2: Capture desktop baseline screenshots**

Use the in-app browser or Playwright at `http://127.0.0.1:4173/`.

Capture these states at `1440x1000`:
```text
home-shell-expanded
home-shell-collapsed
sales-dashboard
sales-forecast
supplier-board
inventory-provision
fba-freight
admin-settings
modal-open-state
```

Expected screenshots directory:
```text
docs/visual-baseline/2026-07-15/locked/desktop/
```

- [x] **Step 3: Capture narrow baseline screenshots**

Use viewport `390x844`.

Capture:
```text
home-shell-mobile
sales-dashboard-mobile
sales-forecast-mobile
supplier-board-mobile
inventory-provision-mobile
fba-freight-mobile
```

Expected screenshots directory:
```text
docs/visual-baseline/2026-07-15/locked/mobile/
```

- [x] **Step 4: Record the manifest**

Write `docs/visual-baseline/2026-07-15/README.md`:
```markdown
# Visual Baseline 2026-07-15

This baseline captures the approved locked `styles.css` visual state before CSS source parity work.

## Environment

- Local URL: http://127.0.0.1:4173/
- CSS mode: locked `styles.css`
- Desktop viewport: 1440x1000
- Mobile viewport: 390x844

## Required States

- home-shell-expanded
- home-shell-collapsed
- sales-dashboard
- sales-forecast
- supplier-board
- inventory-provision
- fba-freight
- admin-settings
- modal-open-state
- home-shell-mobile
- sales-dashboard-mobile
- sales-forecast-mobile
- supplier-board-mobile
- inventory-provision-mobile
- fba-freight-mobile

## Acceptance

Generated CSS must visually match these screenshots before `styles.css` is rebuilt.
```

- [x] **Step 5: Verify no code changed except docs/screenshots**

Run:
```bash
git status -sb
```

Expected: only `docs/visual-baseline/2026-07-15/*` is modified or untracked.

- [x] **Step 6: Commit baseline artifacts**

Run:
```bash
git add docs/visual-baseline/2026-07-15
git commit -m "test: capture visual baseline"
```

## Phase 2: CSS Source Parity

### Task 2: Add A Non-Destructive Generated CSS Preview Path

**Files:**
- Modify: `scripts/build-styles.js`
- Test: `test/stylesStructure.test.js`

- [x] **Step 1: Write the failing test**

Add this test to `test/stylesStructure.test.js` near the existing build script tests:
```js
test("build-styles supports non-destructive preview output", async () => {
  const source = await readFile(new URL("../scripts/build-styles.js", import.meta.url), "utf8");
  assert.match(source, /--output/);
  assert.match(source, /outputPath/);
});
```

- [x] **Step 2: Run the red test**

Run:
```bash
node --test test/stylesStructure.test.js
```

Expected: fails because `scripts/build-styles.js` does not yet support `--output`.

- [x] **Step 3: Implement minimal preview output support**

In `scripts/build-styles.js`, add a small argument reader:
```js
function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}
```

Then update the output file selection:
```js
const previewOutput = argValue("--output");
const outputPath = previewOutput ? path.resolve(rootDir, previewOutput) : outputFile;
```

Use `outputPath` anywhere the script currently reads, stats, or writes `outputFile`, except inside `isLegacyVisualRollbackActive()` which must continue checking the real locked `styles.css`.

- [x] **Step 4: Run the green test**

Run:
```bash
node --test test/stylesStructure.test.js
```

Expected: pass.

- [x] **Step 5: Verify preview generation does not touch `styles.css`**

Run:
```bash
before=$(shasum -a 256 styles.css)
ALLOW_CSS_REBUILD=1 npm run build:css -- --output /tmp/tanjia-generated-preview.css
after=$(shasum -a 256 styles.css)
test "$before" = "$after"
test -s /tmp/tanjia-generated-preview.css
```

Expected: command exits 0 and `/tmp/tanjia-generated-preview.css` exists.

- [x] **Step 6: Commit preview support**

Run:
```bash
git add scripts/build-styles.js test/stylesStructure.test.js
git commit -m "test: add generated css preview path"
```

### Task 3: Reproduce Shell, Sidebar, And Topbar In Source CSS

**Files:**
- Modify: `assets/css/layout/10-shell.css`
- Modify: `assets/css/legacy/98-shell-topbar-parity.css`
- Modify: `assets/css/legacy/current.css`
- Create/modify: `docs/visual-baseline/2026-07-15/findings.md`

- [x] **Step 1: Generate preview CSS**

Run:
```bash
ALLOW_CSS_REBUILD=1 npm run build:css -- --output /tmp/tanjia-generated-preview.css
```

Expected: preview CSS generated without changing `styles.css`.

- [x] **Step 2: Compare shell states**

Render the app with `/tmp/tanjia-generated-preview.css` injected over the locked stylesheet.

Compare against:
```text
docs/visual-baseline/2026-07-15/locked/desktop/home-shell-expanded
docs/visual-baseline/2026-07-15/locked/desktop/home-shell-collapsed
docs/visual-baseline/2026-07-15/locked/mobile/home-shell-mobile
```

Check:
```text
sidebar width
active item icon position
active item pill shape
topbar height
breadcrumb alignment
account menu position
content left offset
mobile sidebar overlay behavior
```

- [x] **Step 3: Record each mismatch**

Create or update `docs/visual-baseline/2026-07-15/findings.md`:
```markdown
# Visual Parity Findings

## Shell

| State | Mismatch | Source File | Resolution |
| --- | --- | --- | --- |
| home-shell-expanded | Example: active icon vertical offset | assets/css/layout/10-shell.css | Move the owning selector into `layout/10-shell.css`, then remove the matching legacy parity selector |
```

- [x] **Step 4: Move only shell ownership into layout**

For each shell mismatch, adjust `assets/css/layout/10-shell.css` first. Use semantic tokens from `assets/css/tokens/*` when a color, spacing, radius, or control size is reusable.

Current result: no shell mismatch was found because `/tmp/tanjia-generated-preview.css` is byte-identical to checked-in `styles.css`; no source CSS change was needed.

Allowed examples:
```css
.sidebar .nav-item.active {
  background: var(--tj-action-blue);
  color: var(--tj-content-bg);
}
```

Disallowed examples:
```css
/* Do not add a page-local one-off patch. */
#view-sales .sidebar .nav-item.active {
  background: #1677ff !important;
}
```

- [x] **Step 5: Shrink parity selectors only after source ownership exists**

When a selector is fully represented in `layout/10-shell.css`, remove the matching temporary selector from `assets/css/legacy/98-shell-topbar-parity.css` or `assets/css/legacy/current.css`.

Current result: no selectors were removed in this pass because no shell mismatch required ownership movement.

- [x] **Step 6: Run CSS checks**

Run:
```bash
npm run build:css -- --check
npm run check
```

Expected: both exit 0. The build check may print the existing visual lock skip message until Phase 3.

- [x] **Step 7: Re-capture preview screenshots**

Capture generated-preview screenshots for the shell states:
```text
docs/visual-baseline/2026-07-15/generated/desktop/home-shell-expanded
docs/visual-baseline/2026-07-15/generated/desktop/home-shell-collapsed
docs/visual-baseline/2026-07-15/generated/mobile/home-shell-mobile
```

Expected: no visible regression against locked baseline for shell/sidebar/topbar.

- [x] **Step 8: Commit shell parity**

Run:
```bash
git add assets/css/layout/10-shell.css assets/css/legacy/98-shell-topbar-parity.css assets/css/legacy/current.css docs/visual-baseline/2026-07-15
git commit -m "style: align generated shell css with locked baseline"
```

### Task 4: Reproduce Core Page Surfaces In Source CSS

**Files:**
- Modify: `assets/css/components/*`
- Modify: `assets/css/pages/22-sales-dashboard.css`
- Modify: `assets/css/pages/25-sales-forecast.css`
- Modify: `assets/css/pages/35-fba-freight.css`
- Modify: `assets/css/pages/53-supplier-board.css`
- Modify: `assets/css/pages/55-inventory-provision.css`
- Modify: `assets/css/legacy/current.css`
- Modify: `docs/visual-baseline/2026-07-15/findings.md`

- [x] **Step 1: Generate preview CSS**

Run:
```bash
ALLOW_CSS_REBUILD=1 npm run build:css -- --output /tmp/tanjia-generated-preview.css
```

- [x] **Step 2: Compare core page screenshots**

Compare generated preview to locked baseline for:
```text
sales-dashboard
sales-forecast
supplier-board
inventory-provision
fba-freight
admin-settings
modal-open-state
```

Check:
```text
filter toolbar density
button height and radius
table header and row height
card border and shadow
status pill tone
modal width and backdrop
text overflow at narrow width
focus-visible state
```

- [x] **Step 3: Move shared rules to components**

If the same visual rule appears in two or more pages, put it under `assets/css/components/*`.

Current result: no generated-preview mismatch was found because `/tmp/tanjia-generated-preview.css` is byte-identical to checked-in `styles.css`; no shared component CSS move was needed.

Examples:
```css
.filter-toolbar {
  gap: var(--spectrum-spacing-100);
}

.status-pill {
  border-radius: var(--spectrum-control-radius);
}
```

- [x] **Step 4: Keep page-only rules in page files**

If a rule is unique to one page, keep it in the owning page file, such as:
```css
#view-supplier-board .supplier-board-table-stack {
  min-width: 960px;
}
```

Current result: no page-only CSS move was needed in this parity pass.

- [x] **Step 5: Remove migrated selectors from legacy**

After each selector has a clear owner in `components/*` or `pages/*`, remove its duplicate from `assets/css/legacy/current.css`.

Current result: no migrated selectors were removed because no mismatch required ownership movement.

- [x] **Step 6: Verify**

Run:
```bash
npm test
npm run check
```

Expected: all tests pass and CSS standards debt does not increase.

- [x] **Step 7: Commit core page parity**

Run:
```bash
git add assets/css/components assets/css/pages assets/css/legacy/current.css docs/visual-baseline/2026-07-15
git commit -m "style: align generated page css with locked baseline"
```

## Phase 3: Controlled CSS Rebuild And Unlock

### Task 5: Rebuild `styles.css` After Browser-Verified Parity

**Files:**
- Modify: `styles.css`
- Modify: `test/stylesStructure.test.js`
- Modify: `assets/css/README.md`
- Modify: `design.md`

- [x] **Step 1: Confirm parity sign-off**

Before rebuilding, confirm these are true:
```text
locked and generated screenshots match for desktop shell
locked and generated screenshots match for mobile shell
locked and generated screenshots match for sales-dashboard
locked and generated screenshots match for sales-forecast
locked and generated screenshots match for supplier-board
locked and generated screenshots match for inventory-provision
locked and generated screenshots match for fba-freight
locked and generated screenshots match for modal-open-state
```

- [x] **Step 2: Rebuild the generated CSS**

Run:
```bash
ALLOW_CSS_REBUILD=1 npm run build:css
```

Expected:
```text
styles.css rebuilt
```

Current result: `styles.css` was already byte-identical to the generated output, so the command reported `styles.css already up to date`.

- [x] **Step 3: Update lock documentation**

In `assets/css/README.md`, replace the temporary visual lock section with:
```markdown
Visual baseline:

- `styles.css` is generated from `assets/css/*`.
- Do not hand-edit `styles.css`.
- Run `npm run build:css` after changing CSS source files.
- Browser screenshot verification is required for shell, sidebar, topbar, filters, tables, and modal changes.
```

In `design.md`, replace the temporary lock wording with the same rule: generated CSS is now the source-compatible visual baseline.

- [x] **Step 4: Update structure tests**

In `test/stylesStructure.test.js`, remove or update assertions that expect:
```text
temporary visual lock is active
locked visual styles should be visibly larger than the modern CSS budget
locked visual styles should preserve the approved sidebar/topbar visual baseline
```

Keep assertions that:
```text
styles.css is generated from layered CSS sources
styles.css keeps semantic token roots consolidated
CSS standards gate is part of the default check command
```

- [x] **Step 5: Verify**

Run:
```bash
npm run build:css -- --check
npm test
npm run check
npm audit
```

Expected:
```text
build:css -- --check exits 0 without visual lock skip
all tests pass
check exits 0
npm audit reports 0 vulnerabilities
```

- [x] **Step 6: Commit rebuild unlock**

Run:
```bash
git add styles.css test/stylesStructure.test.js assets/css/README.md design.md
git commit -m "style: unlock generated css baseline"
```

## Phase 4: Visual Unification

### Task 6: Normalize Shared Component Visuals

**Files:**
- Modify: `assets/css/tokens/00-semantic-foundation.css`
- Modify: `assets/css/components/20-module-primitives.css`
- Modify: `assets/css/components/30-surfaces-and-filters.css`
- Modify: `assets/css/components/32-form-controls.css`
- Modify: `assets/css/components/34-dashboard-data-primitives.css`
- Modify: `assets/css/components/40-status-pill.css`
- Modify: `assets/css/components/45-table-controls.css`
- Modify: `assets/css/components/55-modal-shell.css`
- Modify: `design.md`

- [x] **Step 1: Define the shared visual target**

Use existing project tokens first:
```css
--tj-shell-bg
--tj-page-bg
--tj-content-bg
--tj-action-blue
--tj-action-blue-hover
--tj-action-blue-soft
--tj-text-strong
--tj-text-body
--tj-text-muted
--tj-border-subtle
--tj-border-control
--tj-positive
--tj-warning
--tj-danger
```

Only add a token when the concept is reused by at least two components.

- [x] **Step 2: Normalize controls**

Update shared control CSS so buttons, inputs, selects, filter chips, and icon buttons use consistent:
```text
height
padding
border
radius
focus-visible ring
disabled state
hover state
```

- [x] **Step 3: Normalize tables**

Update shared table primitives for:
```text
header background
row hover
cell padding
sticky header
empty state
sort button state
horizontal overflow behavior
```

- [x] **Step 4: Normalize cards and panels**

Keep cards for repeated items, modals, and framed tools. Do not introduce nested cards.

- [x] **Step 5: Normalize modals**

Update modal shell CSS for consistent:
```text
backdrop
dialog radius
header layout
footer actions
mobile width
focus-visible states
```

- [x] **Step 6: Browser verification**

Check desktop and mobile:
```text
sales-dashboard
sales-forecast
supplier-board
inventory-provision
fba-freight
admin-settings
modal-open-state
```

Acceptance:
```text
no overlapping text
no clipped buttons
keyboard focus visible
filters usable by mouse and keyboard
tables remain horizontally scrollable where needed
no one-off page palette dominates
```

- [x] **Step 7: Verify and commit**

Run:
```bash
npm run build:css
npm test
npm run check
```

Expected: all pass.

Commit:
```bash
git add assets/css design.md styles.css
git commit -m "style: unify shared visual components"
```

### Task 7: Normalize Page-Specific Visuals In Small Batches

**Files:**
- Modify page CSS files under `assets/css/pages/*`.
- Modify `styles.css` only by running `npm run build:css`.

- [x] **Step 1: Batch pages by risk**

Use this order:
```text
Batch 1: home, sales dashboard, sales forecast
Batch 2: supplier board, inventory provision, factory inventory, payables
Batch 3: FBA freight, FBA automation, FBA task form, freight rates
Batch 4: admin, sync center, knowledge library, aftersales
```

- [x] **Step 2: For each batch, edit only owning page files**

Example:
```text
Batch 2 edits only assets/css/pages/51-payables.css, 52-factory-inventory.css, 53-supplier-board.css, 55-inventory-provision.css unless a repeated rule belongs in components.
```

Current result:

```text
Batch 1 edited only:
- assets/css/pages/21-home-quick-links.css
- assets/css/pages/22-sales-dashboard.css
- assets/css/pages/25-sales-forecast.css

styles.css was regenerated with npm run build:css.
```

- [ ] **Step 3: Rebuild and verify each batch**

Run after each batch:
```bash
npm run build:css
npm test
npm run check
```

Expected: all pass.

Current Batch 1 result:

```text
node --test test/stylesStructure.test.js: pass
npm test: pass, 373 passing
npm run check: pass
git diff --check: pass
```

- [ ] **Step 4: Browser verify each batch**

For each changed page:
```text
desktop render has no console errors
mobile render has no overlapping text
changed controls work by mouse
changed controls show visible keyboard focus
tables and modals remain usable
```

Current Batch 1 result:

```text
home desktop/mobile: no horizontal document overflow
sales-dashboard desktop/mobile: no horizontal document overflow
sales-forecast desktop/mobile: no horizontal document overflow
home mobile hero stacks vertically and sync pill stays within viewport
sales and sales-forecast tables remain horizontally scrollable where needed
app console errors/warnings: none observed during Batch 1 browser checks
```

- [ ] **Step 5: Commit each batch**

Use batch-specific commits:
```bash
git add assets/css/pages assets/css/components styles.css
git commit -m "style: unify sales page visuals"
git commit -m "style: unify finance inventory visuals"
git commit -m "style: unify fba page visuals"
git commit -m "style: unify admin support visuals"
```

## Final Verification And Release

- [ ] **Step 1: Full local verification**

Run:
```bash
npm run build:css -- --check
npm test
npm run check
npm audit
```

Expected:
```text
CSS build check exits 0
all tests pass
check exits 0
npm audit reports 0 vulnerabilities
```

- [ ] **Step 2: Push**

Run:
```bash
git push -u origin codex/visual-baseline-unification
```

- [ ] **Step 3: Package and deploy**

Run:
```bash
npm run package:deploy
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
ssh root@47.107.92.14 'cd /opt/tanjia-bi && KEEP_RELEASES=5 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
```

- [ ] **Step 4: Production verification**

Run:
```bash
ssh root@47.107.92.14 'curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
```

Expected:
```text
health ok
PM2 status online
```

Browser check production pages after cache bypass:
```text
home
sales dashboard
sales forecast
supplier board
inventory provision
fba freight
admin settings
```

## Self-Review

- Spec coverage: The four requested phases are represented as Phase 1 baseline capture, Phase 2 source parity, Phase 3 controlled rebuild/unlock, and Phase 4 visual unification.
- Placeholder scan: No task relies on hand-editing `styles.css`, unspecified "fix later" work, or silent visual acceptance.
- Type consistency: Script names, paths, and commands match the current repository conventions.
- Risk control: Every phase has screenshot or browser verification before moving to the next phase.

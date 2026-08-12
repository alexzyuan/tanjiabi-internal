# Frontend Refresh And Console Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the dashboard overlay empty-selector exception, make Supplier Board product refresh submit exactly once from keyboard activation, and clear the four high-severity npm advisories without forced or breaking upgrades.

**Architecture:** Keep fixes inside their current owners: dashboard selector resolution in `dashboard-loader.js`, Supplier Board activation in its feature module, and dependency remediation in the package manifest/lockfile. Tests prove each production symptom before implementation, while existing single-flight and safe-error behavior remain the only refresh state machine.

**Tech Stack:** Native ES modules, Node test runner, native HTML button semantics, npm lockfile/audit, Browser plugin.

---

### Task 1: Guard Optional Dashboard Overlay Selectors

**Files:**
- Modify: `test/dashboardLoader.test.js`
- Modify: `assets/js/dashboard-loader.js`

- [ ] **Step 1: Write the failing test**

Add a test whose root throws if `querySelector("")` or whitespace is called, then invoke `showDashboardLoadingOverlay()` with default and whitespace-only `targetSelector`. Assert the fallback active view receives the overlay and no empty selector reaches the root.

```js
test("optional loading-overlay selectors never call querySelector with empty input", async () => {
  const { showDashboardLoadingOverlay } = await loadModule();
  const selectors = [];
  const root = createOverlayRoot({
    querySelector(selector) {
      selectors.push(selector);
      if (!String(selector).trim()) throw new SyntaxError("empty selector");
      return selector === ".view.active" ? this.activeView : null;
    },
  });

  const hideDefault = showDashboardLoadingOverlay({ root });
  hideDefault();
  const hideWhitespace = showDashboardLoadingOverlay({ root, targetSelector: "   " });
  hideWhitespace();

  assert.equal(selectors.includes(""), false);
  assert.equal(selectors.includes("   "), false);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test test/dashboardLoader.test.js`

Expected: FAIL because `resolveElement()` passes the default empty selector to `root.querySelector`.

- [ ] **Step 3: Implement the selector-boundary fix**

Normalize string selectors before querying, return `null` for empty/whitespace-only input, and leave malformed non-empty selector errors observable.

```js
function resolveElement(selectorOrElement, root = globalThis.document) {
  if (typeof selectorOrElement !== "string") return selectorOrElement;
  const selector = selectorOrElement.trim();
  return selector ? root?.querySelector?.(selector) : null;
}
```

- [ ] **Step 4: Verify GREEN and focused compatibility**

Run: `node --test test/dashboardLoader.test.js test/frontendStructure.test.js`

Expected: all tests pass; malformed non-empty selectors remain fail-fast.

- [ ] **Step 5: Commit**

```bash
git add assets/js/dashboard-loader.js test/dashboardLoader.test.js
git commit -m "fix: ignore empty dashboard overlay selectors"
```

### Task 2: Prove And Fix Supplier Product Refresh Keyboard Activation

**Files:**
- Modify: `test/supplierBoardFeature.test.js`
- Modify: `assets/js/features/supplier-board.js`

- [ ] **Step 1: Add an event-capable feature fixture**

Extend the existing product-refresh button fixture with `addEventListener`, `dispatchEvent`, and click synthesis controls so the test invokes the actual handler registered by `setupSupplierBoard()` instead of calling the exported refresh method directly.

- [ ] **Step 2: Write the failing keyboard test**

Assert one Enter keydown on the focused product-refresh button prevents default, creates exactly one refresh request, restores the button, and does not require a synthetic click from the test harness.

```js
test("supplier product refresh handles Enter exactly once when native click synthesis is unavailable", async () => {
  const fixture = await createProductRefreshFeatureFixture({ rows: [{ sid: 8708, msku: "A" }] });
  fixture.feature.setupSupplierBoard();

  const event = fixture.productRefreshButton.dispatch("keydown", { key: "Enter" });
  await fixture.waitForRefresh();

  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.productRefreshButton.disabled, false);
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `node --test test/supplierBoardFeature.test.js`

Expected: FAIL because setup currently binds only `click`; Enter without native synthesis produces zero requests.

- [ ] **Step 4: Implement one shared activation handler**

Keep the existing click path and add only an Enter keydown path. Reject repeats/composition and call `preventDefault()` before invoking the existing single-flight refresh function. Do not add Space handling because the native button already owns Space activation and duplicating it risks two clicks.

```js
function handleSupplierBoardProductRefreshKeydown(event) {
  if (event?.key !== "Enter" || event.repeat || event.isComposing) return;
  event.preventDefault?.();
  refreshSupplierBoardProducts();
}
```

Bind it in `setupSupplierBoard()` beside the existing click binding.

- [ ] **Step 5: Add non-duplication assertions**

Verify mouse click still makes one request, repeated setup registers one click and one keydown handler, repeat/composition keydowns are ignored, and two activation events during the in-flight promise still produce one request.

- [ ] **Step 6: Verify GREEN**

Run: `node --test test/supplierBoardFeature.test.js test/frontendStructure.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add assets/js/features/supplier-board.js test/supplierBoardFeature.test.js test/frontendStructure.test.js
git commit -m "fix: support supplier refresh keyboard activation"
```

### Task 3: Remediate High-Severity Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Capture the vulnerable tree**

Run:

```bash
npm audit --json
npm ls mailparser linkify-it undici imapflow socks ip-address
```

Expected baseline: four high findings across `mailparser -> linkify-it`, direct `undici`, and `imapflow -> socks -> ip-address`.

- [ ] **Step 2: Apply supported non-forced updates**

Run `npm audit fix` without `--force`, then inspect `git diff package.json package-lock.json` and the resolved dependency tree. If npm leaves an advisory, update only the owning direct dependency to its latest compatible release and regenerate the lockfile; do not introduce an override unless the upstream direct dependency cannot select a patched transitive version.

- [ ] **Step 3: Verify the dependency tree and audit**

Run:

```bash
npm audit
npm ls mailparser linkify-it undici imapflow socks ip-address
```

Expected: zero high/critical advisories and a valid dependency tree.

- [ ] **Step 4: Run boundary tests**

Run:

```bash
node --test test/aftersalesMailService.test.js test/aftersalesMailSettingsService.test.js test/serverSecurity.test.js test/lingxingAdapter.test.js
```

Expected: mail parsing/settings, credential redaction, image-cache private-network rejection, and upstream adapter behavior pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: update vulnerable network dependencies"
```

### Task 4: Full Verification And Browser QA

**Files:**
- No committed files expected; screenshots stay under `/tmp`.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm run check
npm test
git diff --check
git status --short --branch
```

Expected: check and test commands exit 0, no diff whitespace errors, only intentional committed history.

- [x] **Step 2: Start a local production-like server**

Use a non-production port and `NODE_ENV=test`. Keep the exact local URL for the Browser session; do not use production for regression testing.

- [x] **Step 3: Verify with Browser plugin on desktop**

Flow: local app -> Supplier Board -> filter to one row -> focus “刷新商品资料” -> press Enter -> observe disabled busy state -> controlled test response -> restored button/status. Confirm page identity, meaningful DOM, no overlay, clean console, and exactly one refresh request.

- [x] **Step 4: Do not run narrow viewport verification**

Per the project-wide verification policy confirmed during implementation, this project does not run narrow/mobile viewport tests. No viewport override was applied.

- [x] **Step 5: Capture desktop evidence outside the repo**

Save the desktop screenshot under `/tmp/frontend-refresh-console-fix-desktop.png` and finalize both browser sessions without leaving test tabs open.

- [ ] **Step 6: Final self-review**

Re-read the design and diff. Confirm no changes to `app.js`, `server.js`, product-catalog backend/schema, deployment scripts, `index.html`, CSS sources, or generated `styles.css`.

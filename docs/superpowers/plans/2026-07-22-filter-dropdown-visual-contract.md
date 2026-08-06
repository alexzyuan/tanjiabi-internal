# Shared Filter Dropdown Visual Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shared dashboard multi-select show a stable, accessible selected-state summary and keep its popup inside the viewport.

**Architecture:** `assets/js/filter-controls.js` will expose two small pure helpers so the presentation rules can be tested without a DOM: one turns selected native options into visible/accessibility text, and one decides when a popup needs end alignment. The existing factory remains the owner of markup updates and disclosure events. Shared CSS keeps the trigger text and arrow in separate layout tracks and applies the alignment class; generated `styles.css` is rebuilt from the source layers.

**Tech Stack:** Native ES modules, Node built-in test runner, layered CSS build, in-app Browser verification.

---

## File Structure

- Modify: `assets/js/filter-controls.js` — pure summary/alignment helpers; enhanced-filter trigger markup; ARIA/title updates; opening-time popup alignment.
- Modify: `assets/css/components/30-surfaces-and-filters.css` — compact trigger label clipping and end-aligned filter-menu modifier.
- Modify: `assets/css/components/32-form-controls.css` — generic multi-select button grid contract that reserves its disclosure-arrow track.
- Create: `test/filterControls.test.js` — direct tests for selected-state summaries and viewport-alignment decisions.
- Generated: `styles.css` — rebuilt only through `npm run build:css`.

### Task 1: Specify and prove selected-state summaries

**Files:**
- Create: `test/filterControls.test.js`
- Modify: `assets/js/filter-controls.js:1-37`

- [ ] **Step 1: Write the failing tests for the three visible states**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { getFilterDropdownSummary } from "../assets/js/filter-controls.js";

function makeSelect(allLabel, selectedLabels) {
  return {
    options: [{ value: "", textContent: allLabel }],
    selectedOptions: selectedLabels.map((label) => ({ value: label, textContent: label })),
  };
}

test("filter dropdown summary retains the all label when no value is selected", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", [])), {
    text: "全部店铺",
    accessibleText: "全部店铺",
    title: "全部店铺",
  });
});

test("filter dropdown summary shows the selected label for one value", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", ["tandanbo-CA"])), {
    text: "tandanbo-CA",
    accessibleText: "已选 1 项：tandanbo-CA",
    title: "tandanbo-CA",
  });
});

test("filter dropdown summary counts two or more selections without concatenating labels", () => {
  assert.deepEqual(getFilterDropdownSummary(makeSelect("全部店铺", ["tandanbo-CA", "xiamentanjia-US"])), {
    text: "已选 2 项",
    accessibleText: "已选 2 项：tandanbo-CA、xiamentanjia-US",
    title: "tandanbo-CA、xiamentanjia-US",
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the helper is not exported**

Run: `node --test test/filterControls.test.js`

Expected: `SyntaxError` reporting that `getFilterDropdownSummary` is not exported.

- [ ] **Step 3: Implement the smallest pure helper and consume it from the existing updater**

Add above `createFilterControls`:

```js
export function getFilterDropdownSummary(select) {
  const labels = [...(select?.selectedOptions || [])]
    .filter((option) => option.value)
    .map((option) => option.textContent.trim())
    .filter(Boolean);
  const allText = select?.options?.[0]?.textContent?.trim() || "全部";
  const title = labels.length ? labels.join("、") : allText;
  const text = labels.length > 1 ? `已选 ${labels.length} 项` : (labels[0] || allText);
  const accessibleText = labels.length ? `已选 ${labels.length} 项：${title}` : allText;
  return { text, accessibleText, title };
}
```

Replace `updateFilterDropdownButton` with a call to this helper. Write the visible text into `.filter-dropdown-button-label`, then set `aria-label` and `title` on the button. Change the trigger markup in `createFilterDropdown` to:

```html
<button class="filter-dropdown-button multi-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
  <span class="filter-dropdown-button-label"></span>
</button>
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/filterControls.test.js`

Expected: three passing subtests.

- [ ] **Step 5: Commit the tested summary behavior**

```bash
git add assets/js/filter-controls.js test/filterControls.test.js
git commit -m "fix: summarize multi-select filter labels"
```

### Task 2: Bound popup alignment at the viewport edge

**Files:**
- Modify: `test/filterControls.test.js`
- Modify: `assets/js/filter-controls.js:1-80`
- Modify: `assets/css/components/30-surfaces-and-filters.css:85-96`

- [ ] **Step 1: Write the failing pure alignment test**

```js
import { getFilterDropdownMenuAlignment } from "../assets/js/filter-controls.js";

test("filter dropdown menu aligns to its end edge when its start edge would exceed the viewport", () => {
  assert.equal(
    getFilterDropdownMenuAlignment({ right: 804 }, 800),
    "end",
  );
  assert.equal(
    getFilterDropdownMenuAlignment({ right: 784 }, 800),
    "start",
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the helper is not exported**

Run: `node --test test/filterControls.test.js`

Expected: `SyntaxError` reporting that `getFilterDropdownMenuAlignment` is not exported.

- [ ] **Step 3: Implement the helper and apply it after opening the existing disclosure**

Add the exported helper:

```js
export function getFilterDropdownMenuAlignment(menuRect, viewportWidth, gutter = 16) {
  return menuRect.right > viewportWidth - gutter ? "end" : "start";
}
```

Immediately after `setDisclosureState(menu, event.currentTarget, opening)`, when `opening` is true, call it with `menu.getBoundingClientRect()` and `globalObject.innerWidth`; toggle only `filter-dropdown-menu--align-end` on that menu when the result is `"end"`. Remove the class when the result is `"start"`. Do not add a global resize listener: opening a menu recalculates its real geometry and avoids new persistent state.

Add the modifier to the shared filter menu source:

```css
.filters .filter-dropdown-menu--align-end {
  right: 0;
  left: auto;
}
```

Keep the existing `max-width: min(360px, calc(100vw - 32px))` so its width is never wider than the available viewport gutter.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/filterControls.test.js`

Expected: four passing subtests.

- [ ] **Step 5: Commit the tested popup positioning behavior**

```bash
git add assets/js/filter-controls.js assets/css/components/30-surfaces-and-filters.css test/filterControls.test.js
git commit -m "fix: keep filter dropdown menus in view"
```

### Task 3: Reserve trigger text and disclosure-arrow space

**Files:**
- Modify: `assets/css/components/32-form-controls.css:28-44`
- Modify: `assets/css/components/30-surfaces-and-filters.css:80-83`
- Generated: `styles.css`

- [ ] **Step 1: Add the shared button layout contract**

Replace the flex layout for `.multi-select-button` with a two-track grid and add a text-label rule:

```css
.multi-select-button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  text-align: left;
}

.multi-select-button .filter-dropdown-button-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Keep `.multi-select-button::after` as the second grid item so the arrow has fixed visual space. Do not add page-specific width rules; `.filters label` remains responsible for filter field width.

- [ ] **Step 2: Build generated CSS and verify source/target consistency**

Run: `npm run build:css && npm run build:css -- --check`

Expected: both commands exit `0`; `styles.css` changes only as the generated counterpart of the two CSS source edits.

- [ ] **Step 3: Run the automated suite and structural checks**

Run: `npm test && npm run check`

Expected: all Node tests and CSS/JavaScript checks pass with exit `0`.

- [ ] **Step 4: Verify the rendered user flow in the Browser**

Start the local application with `npm run dev`. In the Browser, load the sales dashboard and validate at a desktop viewport and a narrow viewport:

1. Confirm page identity, meaningful content, no error overlay, and no relevant console errors/warnings.
2. Open the country and shop selectors with mouse and keyboard; verify focus-visible treatment and `aria-expanded` state.
3. Select one long store label and verify it appears only inside the trigger.
4. Select a second long store label and verify the trigger reads `已选 2 项`, the arrow remains visible, and neighboring controls are not overlapped.
5. Open the rightmost applicable filter near the narrow viewport edge; verify its menu stays inside the viewport, option text ellipsizes, and the option list remains scrollable.
6. Save desktop and narrow screenshots outside the repository for final evidence.

- [ ] **Step 5: Commit the visual contract and generated CSS**

```bash
git add assets/css/components/30-surfaces-and-filters.css assets/css/components/32-form-controls.css styles.css
git commit -m "fix: contain shared filter dropdown text"
```

## Self-review

- Spec coverage: Task 1 implements the 0/1/many summary plus `aria-label`/title; Task 2 covers viewport-safe popup alignment; Task 3 reserves the arrow track, retains text ellipsis, rebuilds CSS, and proves desktop/narrow behavior.
- Scope: only the shared filter controls and their source CSS change. `app.js`, views, API queries, and feature-specific filter logic remain untouched.
- No placeholders: all files, helper names, expected test outcomes, commands, and interaction checks are explicit.

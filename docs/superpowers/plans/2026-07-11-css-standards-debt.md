# CSS Standards Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a CSS standards baseline and reduce low-risk CSS debt without changing business behavior, UI structure, or the approved desktop visual baseline.

**Architecture:** Keep `scripts/check-css-standards.js` as the standards gate, but make it baseline-aware so current known debt is tracked and new debt fails. Use explicit accessibility allowlist patterns for legitimate `!important` rules, and move obvious low-risk hardcoded colors behind semantic tokens.

**Tech Stack:** Node.js ESM, native CSS source files under `assets/css/*`, generated `styles.css` via `scripts/build-styles.js`.

---

### Task 1: Baseline-Aware CSS Standards Gate

**Files:**
- Modify: `scripts/check-css-standards.js`
- Create: `scripts/css-standards-baseline.json`

- [ ] Add line-level issue collection for `important`, `hardcoded-color`, `gradient`, `legacy-token`, and `legacy-selector`.
- [ ] Add an accessibility allowlist for `[hidden]`, `.visually-hidden`, `.sr-only`, `.screen-reader-only`, and `.sr-only-focusable` `!important` rules.
- [ ] Compare current issue counts by `category + file` against `scripts/css-standards-baseline.json`.
- [ ] Fail only when current count exceeds the baseline count for a category/file.
- [ ] Print a concise summary showing total current debt, baseline debt, reductions, and any new over-baseline debt.

### Task 2: Low-Risk Token Substitution

**Files:**
- Modify: `assets/css/tokens/00-semantic-foundation.css`
- Modify selected low-risk component/page CSS files.

- [ ] Add semantic tokens for existing translucent surface, focus ring, overlay, and home-card border values.
- [ ] Replace obvious hardcoded colors in small component/page files with semantic tokens.
- [ ] Avoid broad visual restyling and do not force unrelated colors into a single blue token.
- [ ] Rebuild `styles.css` through `node scripts/build-styles.js`.

### Task 3: Documentation

**Files:**
- Create: `CSS_STANDARDS_DEBT.md`
- Modify: `ENGINEERING_BASELINE.md`

- [ ] Record debt counts by category.
- [ ] Document main files, whether each category is directly fixable, and whether it requires allowlist/baseline.
- [ ] Document the allowlist policy and baseline rule: current debt is accepted only as a ceiling, and future changes must not increase it.

### Task 4: Verification

**Commands:**

```bash
npm run check:js
node scripts/build-styles.js --check
npm test
node scripts/check-css-standards.js
git diff --check
```

- [ ] All verification commands must pass except any documented command that intentionally reports baseline status with exit code 0.
- [ ] Confirm changed files do not include backend business logic, API routes, database code, or frontend JS behavior.

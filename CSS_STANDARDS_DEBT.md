# CSS Standards Debt

Date: 2026-07-11

This document records the G0-6 CSS standards baseline. The goal is not to hide CSS debt. The goal is to make current debt observable, prevent new debt, and reduce it in small reviewed steps without redesigning the UI.

## Gate Policy

The standards gate is implemented in `scripts/check-css-standards.js`.

The gate now:

- Scans `assets/css/**/*.css` and generated `styles.css`.
- Tracks debt by category and file.
- Allows only specific accessibility/visibility `!important` exceptions.
- Compares current debt against `scripts/css-standards-baseline.json`.
- Fails when any `category + file` count exceeds the baseline.
- Passes when debt is equal to or lower than the baseline.

The baseline is a ceiling, not a waiver. When a change reduces debt, regenerate the baseline:

```bash
node scripts/check-css-standards.js --update-baseline
```

## Allowlist

The only current `!important` allowlist is for accessibility and visibility utilities where `display: none !important` is the intended contract:

- `[hidden]`
- `.visually-hidden`
- `.sr-only`
- `.screen-reader-only`
- `.sr-only-focusable`

Other `!important` rules remain tracked debt.

## Debt Counts

Initial scan before low-risk token cleanup:

| Category | Count |
| --- | ---: |
| `!important` | 618 |
| Hardcoded color | 230 |
| Gradient | 86 |
| Legacy token | 96 |
| Legacy CSS selector | 123 |

Current G0-6 baseline after low-risk token cleanup:

| Category | Count |
| --- | ---: |
| `!important` | 618 |
| Hardcoded color | 193 |
| Gradient | 84 |
| Legacy token | 76 |
| Legacy CSS selector | 123 |

Reduction in this pass:

| Category | Reduced By |
| --- | ---: |
| Hardcoded color | 37 |
| Gradient | 2 |
| Legacy token | 20 |

## Category Breakdown

### `!important`

Main files:

- `assets/css/legacy/98-shell-topbar-parity.css`: 381
- `styles.css`: 112 generated occurrences
- `assets/css/pages/20-login.css`: 70
- `assets/css/pages/67-aftersales-mail.css`: 13
- `assets/css/legacy/current.css`: 11
- `assets/css/legacy/99-solid-blue-overrides.css`: 10

Can directly fix: partially.

Needs allowlist: only accessibility/visibility utilities listed above.

Notes: Most remaining occurrences are visual-lock or legacy override rules. Remove them by moving ownership into the correct layout/component/page layer, not by replacing them with longer selectors.

### Hardcoded Color

Main files:

- `assets/css/layout/10-shell.css`: 86
- `assets/css/pages/20-login.css`: 58
- `assets/css/legacy/current.css`: 20
- `assets/css/legacy/98-shell-topbar-parity.css`: 9
- `assets/css/pages/68-knowledge-library.css`: 8
- `assets/css/pages/40-ai-image-workflow.css`: 6

Can directly fix: yes, in small batches.

Needs allowlist: no. New hardcoded colors should not be added outside token files.

Notes: Prefer existing semantic tokens first. Add a new semantic token only when the value represents a reusable UI concept.

### Gradient

Main files:

- `styles.css`: 37 generated occurrences
- `assets/css/pages/20-login.css`: 26
- `assets/css/pages/22-sales-dashboard.css`: 6
- `assets/css/layout/10-shell.css`: 5
- `assets/css/pages/40-ai-image-workflow.css`: 3
- `assets/css/legacy/current.css`: 2

Can directly fix: partially.

Needs allowlist: no current broad allowlist.

Notes: Decorative gradients should become semantic solid surfaces. If a gradient is truly product language, define it as a token first and document the reason before allowing it.

### Legacy Token

Main files:

- `styles.css`: 25 generated occurrences
- `assets/css/tokens/10-legacy-compatibility.css`: 20
- `assets/css/legacy/current.css`: 11
- `assets/css/components/20-module-primitives.css`: 9
- `assets/css/pages/20-login.css`: 7
- `assets/css/layout/10-shell.css`: 4

Can directly fix: yes, but staged.

Needs allowlist: no. The compatibility token file is tracked debt until remaining references are migrated.

Notes: New CSS must not use `--blue-*`, `--purple`, `--line`, `--text`, `--muted`, `--shadow`, or related legacy aliases.

### Legacy CSS Selector

Main files:

- `assets/css/legacy/current.css`: 64
- `assets/css/legacy/98-shell-topbar-parity.css`: 54
- `assets/css/legacy/99-solid-blue-overrides.css`: 5

Can directly fix: no, not safely in one pass.

Needs baseline: yes.

Notes: These selectors should be moved gradually into `layout`, `components`, or `pages` based on ownership, with browser verification after each small migration.

## G0-6 Low-Risk Cleanup Performed

This pass only tokenized existing values and did not redesign UI structure:

- Added semantic tokens for body background, translucent surfaces, focus ring, overlay, floating/modal shadows, inset control shadows, and a small set of status/accent colors.
- Replaced obvious hardcoded colors in low-risk component/page files.
- Removed a small number of decorative gradients by using existing semantic surfaces.
- Replaced several legacy token references with semantic tokens.

## Required Verification

Run these commands before treating CSS standards work as complete:

```bash
npm run check:js
node scripts/build-styles.js --check
npm test
node scripts/check-css-standards.js
git diff --check
```

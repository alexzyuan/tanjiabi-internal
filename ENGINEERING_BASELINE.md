# Engineering Baseline

Date: 2026-07-10

This repository baseline was created from the local BI / Lingxing ERP internal tool workspace after engineering rounds 1-3.

## Scope

This initial Git baseline contains:

- Source code for the native HTML/CSS/JS frontend and Node.js ESM backend.
- Tests under `test/`.
- Documentation under project root and `docs/`.
- `package.json` and `package-lock.json`.
- Build, deployment, rollback, CSS, and packaging scripts.
- Round 1-3 engineering changes:
  - repository hygiene and path filtering;
  - Node version constraints;
  - Lingxing client/auth/sign/pagination/error modules;
  - sync job history;
  - JSON store;
  - sync job repository;
  - sync job lock;
  - related tests and handoff documentation.

## Excluded From Git

The baseline intentionally excludes runtime, secret, and business-data artifacts:

- `.env`
- `.env.*` except `.env.example`
- `node_modules/`
- `data-cache/`
- `uploads/`
- `output/`
- `releases/`
- `.deploy-tmp-*`
- `.playwright-cli/`
- `*.log`
- `tanjia-bi-deploy.tar.gz`
- macOS metadata files such as `.DS_Store` and `._*`

## Pre-Commit Verification

Commands run before the initial baseline commit:

```bash
npm run check:js
node scripts/build-styles.js --check
npm test
```

Results:

- `npm run check:js`: passed.
- `node scripts/build-styles.js --check`: passed.
- `npm test`: failed with the known CSS structure baseline debt:
  - tests: 267
  - pass: 252
  - fail: 14
  - skipped: 1

## Resolved CSS Structure Test Debt

At the initial Git baseline, the remaining failures were all in `test/stylesStructure.test.js` and predated the Git baseline task. They were not caused by the Git initialization or GitHub push.

Those historical CSS structure failures included:

- `styles.css` has 4 token roots where the target test expects 2.
- Brand blue values still appear outside the expected semantic-token path.
- `styles.css` is above the raw size budget: 261,054 bytes versus a 250 KB test budget.
- Expected split CSS files are still missing:
  - `assets/css/components/34-dashboard-data-primitives.css`
  - `assets/css/components/48-application-ui-overrides.css`
  - `assets/css/components/32-form-controls.css`
  - `assets/css/pages/21-home-quick-links.css`
  - `assets/css/pages/51-payables.css`
  - `assets/css/pages/54-supplier-detail.css`
- Some rules still remained in legacy CSS or did not yet match the target layer comments.

Status: resolved by the CSS structure baseline update below. `test/stylesStructure.test.js` now passes with 43 passed, 0 failed, and 1 skipped.

This task intentionally did not change UI, CSS visuals, business metrics, API response structures, database/storage choices, or Lingxing business endpoint behavior.

## CSS Structure Baseline Update

Date: 2026-07-10

The CSS structure baseline has been brought back to green without changing backend business logic, API response contracts, or the native HTML/CSS/JS technology direction.

Verification for the CSS structure baseline:

```bash
npm run check:js
node scripts/build-styles.js --check
node --test test/stylesStructure.test.js
npm test
git diff --check
```

Results:

- `npm run check:js`: passed.
- `node scripts/build-styles.js --check`: passed.
- `node --test test/stylesStructure.test.js`: 43 passed, 0 failed, 1 skipped.
- `npm test`: 266 passed, 0 failed, 1 skipped.
- `git diff --check`: passed.

## Current CI Baseline

GitHub Actions intentionally runs the stable engineering baseline only:

```bash
npm ci
npm run check:js
node scripts/build-styles.js --check
npm test
```

CI uses Node.js versions within the supported project range declared in `package.json`: `>=22.19.0 <25`.

`npm run check` is not a blocking CI command yet because it includes the broader CSS standards gate described below. That gate is valuable, but it still reports historical CSS standards debt outside the current CSS structure baseline scope.

## Known CSS Standards Debt

`npm run check` still fails because `scripts/check-css-standards.js` reports existing CSS standards debt. The known categories are:

- Old `!important` rules that still need to be removed through layer order or selector ownership fixes.
- Hardcoded colors that still need to move behind semantic tokens.
- Decorative gradients that still need to be replaced with approved semantic solids or surfaces.
- Legacy token/color compatibility rules that still expose old visual language tokens.

These are tracked as follow-up CSS standards work. They should not be hidden or bypassed, but they are not part of the current blocking CI baseline until the remaining CSS standards debt is deliberately paid down.

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

## Known Test Debt

The remaining failures are all in `test/stylesStructure.test.js` and predate the Git baseline task. They are not caused by the Git initialization or GitHub push.

Known CSS structure failures include:

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
- Some rules still remain in legacy CSS or do not yet match the target layer comments.

This task intentionally did not change UI, CSS visuals, business metrics, API response structures, database/storage choices, or Lingxing business endpoint behavior.

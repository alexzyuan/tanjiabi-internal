# HANDOFF

Date: 2026-07-10

This document is for a new Codex session with no chat history. Read this before touching the project.

## What We Are Doing

We are stabilizing and modernizing the TanJia BI native HTML/CSS/JS project after a deep code review found security issues, performance issues, and heavy frontend/CSS debt.

The current active thread has mostly focused on CSS modernization and visual parity:

1. Keep the app native HTML/CSS/JS. Do not add React islands.
2. Keep `app.js` as a bootstrap/composition layer. Do not move feature logic back into it.
3. Keep feature frontend logic under `assets/js/features/*`.
4. Keep CSS source under `assets/css/*` and generate the single deploy target `styles.css`.
5. Preserve the approved sidebar/topbar visual baseline while removing the blue-purple gradient look.
6. Deploy only reviewed CSS with an explicit safety flag and rollback point.

The latest user-facing task fixed two CSS regressions found after manual production verification of the previous candidate:

1. Expanded sidebar active child icons, especially `产品 > 产品设计需求`, still did not read as centered.
2. `库存 > 库存计提` charts regressed: stacked bars/legend rendered black and the donut chart disappeared.

Both fixes have been deployed.

## Current Production State

Production host:

```text
root@47.107.92.14:/opt/tanjia-bi
```

PM2 app:

```text
tanjia-bi
```

Production port:

```text
4173
```

Latest deployed `styles.css`:

```text
5dfc215ab4ee799f85d3741051bddb6e6134a95e34b543f83db9bf56f8d85755  styles.css
```

Latest local deploy package:

```text
/Users/maclex/Documents/Codex/2026-04-29/bi-erp/tanjia-bi-deploy.tar.gz
f1cfd3d8f805dffc13d16ff62295b444995b5bc93db78b0bb766f1d662e399c2
```

Latest production verification passed:

```bash
ssh root@47.107.92.14 'cd /opt/tanjia-bi && sha256sum styles.css && sha256sum tanjia-bi-deploy.tar.gz && curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
```

Public CSS hash also matched:

```bash
curl -fsS 'http://47.107.92.14:4173/styles.css?v=20260710-101958' | shasum -a 256
# 5dfc215ab4ee799f85d3741051bddb6e6134a95e34b543f83db9bf56f8d85755
```

## What Has Been Completed

### Security Fixes Already Confirmed In Prior Rounds

Earlier security fixes were reviewed and tests passed:

- G0.1: `payables` and `supplier-board` finance permission checks stayed in place.
- G0.2: child account password login bug was fixed.
- G0.3: hardcoded session secret fallback was removed or guarded.
- G0.4: `/api/image-cache` SSRF hardening tests stayed in place.

Important nuance: the user later clarified that not every purchase/supplier interface needs restrictive permissions. Only finance-related areas need finance permission. Do not blindly reapply the original audit recommendation to lock every supplier/purchase route unless the user re-confirms the product policy.

### Frontend Module Direction

`AGENTS.md` has been updated from the old "put frontend logic near app.js" guidance. The current rule is:

- `app.js` is the bootstrap/composition layer.
- Feature state, rendering, loading, and events belong in `assets/js/features/*`.
- Shared utilities belong in `assets/js/*`.
- Do not grow `app.js` back into the old monolith.

### CSS Migration State

The CSS stack is partially modernized:

- Source CSS is split under `assets/css/{tokens,base,layout,components,pages,legacy}`.
- `styles.css` is generated from `assets/css/*`.
- `assets/css/legacy/current.css` still contains large legacy CSS.
- `assets/css/legacy/98-shell-topbar-parity.css` is a temporary parity layer to preserve the approved sidebar/topbar baseline.
- `assets/css/legacy/99-solid-blue-overrides.css` removes the blue-purple gradient direction and keeps solid blue.
- `styles.css` is now around `259510` bytes and `1931` lines after generation, not the old 17k-line monolith.

Do not hand-edit `styles.css`. Edit layered source files and rebuild only when the CSS change is intentional and visually verified:

```bash
ALLOW_CSS_REBUILD=1 npm run build:css
npm run build:css -- --check
```

### Sidebar/Topbar Visual Work

The user wanted only the gradient blue-purple styling changed to solid blue. Sidebar and topbar dimensions, icons, spacing, and behavior should stay aligned with the locked visual baseline.

Completed fixes:

- Solid blue active states deployed.
- Sidebar/topbar parameters were aligned to the locked baseline through the parity layer.
- Black outline around expanded sidebar child items was removed.
- Sidebar icons were restored to line icons with `fill: none` and `stroke: currentColor`.
- Expanded active child icon offset was fixed by overriding only expanded second-level active nav icons to `24px`.
- The previous active child SVG `translateY(1px)` correction was reverted to `transform: none`; it made `销售复盘` read low even though the icon box was centered.
- Account logout menu overlap was fixed with a scoped parity override `top: 37px`; root cause was generated CSS minifying `calc(100% + 7px)` to invalid `calc(100%+7px)`, which computed as `top: 0px`.

Latest changed files:

- `assets/css/legacy/98-shell-topbar-parity.css`
- `assets/css/pages/55-inventory-provision.css`
- generated `styles.css`
- `HANDOFF.md`

The narrow latest fix is at:

```css
body:not(.login-body) .app-shell:not(.sidebar-collapsed) .sidebar .nav .nav-group .nav-item.active .nav-icon,
html.os-windows body:not(.login-body) .app-shell:not(.sidebar-collapsed) .sidebar .nav .nav-group .nav-item.active .nav-icon {
  flex: 0 0 24px !important;
  justify-self: center !important;
  align-self: center !important;
  width: 24px !important;
  height: 24px !important;
  margin: 0 !important;
  border-radius: 8px !important;
  background: transparent !important;
}

body:not(.login-body) .app-shell:not(.sidebar-collapsed) .sidebar .nav .nav-group .nav-item.active .nav-icon svg,
html.os-windows body:not(.login-body) .app-shell:not(.sidebar-collapsed) .sidebar .nav .nav-group .nav-item.active .nav-icon svg {
  transform: none !important;
  transform-box: fill-box !important;
  transform-origin: center !important;
}

body:not(.login-body) .account-logout {
  top: 37px !important;
}
```

The latest inventory chart fix restores page-owned chart bucket rules in `assets/css/pages/55-inventory-provision.css`:

- `#view-provision .chart-bucket` now has explicit `color`, `fill`, and `stroke`.
- Actual bucket classes `chart-bucket--0-30`, `--31-60`, `--61-90`, `--91-180`, `--181-270`, `--271-plus` are covered.
- Numeric fallback classes `--1` through `--6` are covered.
- `.inventory-donut-track` has a neutral stroke again.
- `.bucket-dot` uses `background: currentColor`, matching the locked baseline pattern.

Root causes:

- Sidebar: candidate/parity CSS reintroduced `background: rgba(255,255,255,.14)` on expanded active child `.nav-icon`. The SVG and icon box were geometrically centered, but the semi-transparent icon box made asymmetric line icons read visually off-center. The locked visual baseline had transparent active child icon backgrounds.
- Inventory charts: the CSS migration omitted the old locked `#view-provision .chart-bucket...` and `.inventory-donut-track` rules. SVG rects therefore fell back to black fill, and donut circles had `stroke: none`, so the donut disappeared.

Local browser verification showed:

- Account menu open state: logout button `top: 37px`, 7px below account chip, vertical overlap `0`; clicking the account chip again closes the menu instead of logging out.
- Expanded `销售复盘` active item: item `160x32`, icon `24x24`, SVG `16x16`, icon center aligned to item center, SVG center aligned to icon center, SVG transform `none`, no console errors.
- Expanded `产品设计需求` active item after selecting the page and re-expanding the sidebar: item `160x32`, icon `24x24`, SVG `16x16`, icon/SVG center deltas `0`, icon background `rgba(0, 0, 0, 0)`, no console errors.
- `库存 > 库存计提`: active view rendered with trend rects and donut circles colored; donut circles had non-empty strokes and `stroke-width="28"`; `.inventory-donut-track` stroke was `rgb(238, 242, 246)`; no console errors.
- Collapsed sidebar top-level icon behavior was not changed by this fix.

Screenshots from the last local verification:

```text
/tmp/sidebar-store-inspection-expanded.png
/tmp/sidebar-collapsed-after-fix.png
```

## Deployment And Rollback

Deployment package command for reviewed CSS deployments:

```bash
ALLOW_CSS_DEPLOY=1 npm run package:deploy -- --include-css
```

Upload:

```bash
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
```

Deploy:

```bash
ssh root@47.107.92.14 'cd /opt/tanjia-bi && ALLOW_CSS_DEPLOY=1 KEEP_RELEASES=5 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
```

Latest backup created immediately before the last deploy:

```text
/opt/tanjia-bi/releases/20260710-101958
```

Other retained remote backups:

```text
/opt/tanjia-bi/releases/20260709-161337
/opt/tanjia-bi/releases/20260709-164619
/opt/tanjia-bi/releases/20260710-094858
/opt/tanjia-bi/releases/20260710-101958
/opt/tanjia-bi/releases/manual-visual-before-rollback-20260707-184950
```

Known older CSS baselines:

- Previous candidate backup: `/opt/tanjia-bi/releases/20260709-155456`
- Pre-SVG-visual-center-fix backup: `/opt/tanjia-bi/releases/20260709-164619`
- Pre-account-menu/sidebar-icon-fix backup: `/opt/tanjia-bi/releases/20260710-094858`
- Pre-product-icon/inventory-chart-fix backup: `/opt/tanjia-bi/releases/20260710-101958`

Do not fix production by hand-editing remote `styles.css`. Roll back by restoring a release directory or redeploying a reviewed package.

## Current Blockers / Open Items

There is no active deployment blocker. The latest CSS fix is deployed and health checks passed.

The next useful step is manual production visual verification by the user after cache bypass:

1. Expanded sidebar `产品 > 产品设计需求` active state: active child icon should read centered, with no semi-transparent square behind it.
2. `库存 > 库存计提`: stacked bars, legend swatches, and donut chart should be colored and visible.
3. Open topbar account menu; `退出登录` should still appear below the name chip and not overlap it.
4. Click the account chip again; it should close the menu rather than logging out.
5. Expanded sidebar `销售 > 销售复盘` and `销售 > 店铺巡检` active states should remain acceptable.
6. Collapsed sidebar top-level icons should remain unchanged.
7. Topbar otherwise unchanged.
8. No return of blue-purple gradients.

Known unresolved technical debt:

- `node scripts/check-css-standards.js` still fails on existing CSS debt such as `!important`, hardcoded colors, and legacy gradients. Do not present that as a new regression from the latest fix.
- `npm audit` during production deploy reports `1 high severity vulnerability`; not addressed in this CSS task.
- G2.1 route-table migration is still incomplete. Prior notes said only about 8 routes had moved to the new forced-auth route-table style, with many old `if (url.pathname === ...)` branches remaining.
- G3 remains largely untouched: high-risk service tests, `.gitignore`, JSON atomic writes, SQLite evaluation, hardcoded PII cleanup.
- Some service modules still have little or no test coverage, especially complex inventory and Lingxing mapping areas.
- CSS is still not "clean"; it is stabilized enough for the current visual baseline, but `legacy/current.css` and parity overrides still need careful staged migration.

## Next Plan

Recommended next sequence:

1. Ask the user to confirm production visual state after refresh/cache bypass.
2. If accepted, treat current `styles.css` hash `5dfc215a...` as the active approved candidate.
3. Do not continue broad CSS cleanup until the sidebar/topbar baseline is accepted.
4. For future CSS work, migrate one area at a time from `assets/css/legacy/current.css` into proper `tokens/base/layout/components/pages` files.
5. For each migrated CSS slice, add or run screenshot/DOM structure checks before rebuilding and deploying.
6. When touching backend, continue the route-table migration only incrementally: new routes must have explicit `auth`, old routes move one domain at a time.

## Absolute Pitfalls To Avoid

1. Do not hand-edit `styles.css`.
   - It is generated.
   - Edit `assets/css/*`, then run `ALLOW_CSS_REBUILD=1 npm run build:css`.

2. Do not rebuild or deploy CSS for unrelated backend work.
   - CSS deploys require `ALLOW_CSS_DEPLOY=1`.
   - Package with `--include-css` only after visual verification.

3. Do not change sidebar/topbar dimensions while only fixing colors or icons.
   - The user explicitly wants the old sidebar/topbar visual preserved except for gradient-to-solid-blue changes.

4. Do not reintroduce blue-purple gradients.
   - The accepted direction is solid blue.

5. Do not convert icons to filled black icons.
   - Sidebar icons must remain line icons: `fill: none`, `stroke: currentColor`.

6. Do not make `首页` oversized.
   - It should align with first-level groups: expanded `34px`, collapsed `50px`.

7. Do not add React islands.
   - The project remains native HTML/CSS/JS.
   - AGENTS.md says to use Spectrum semantics/tokens as native mappings, not React components.

8. Do not grow `app.js` again.
   - New feature-specific frontend logic belongs in `assets/js/features/*`.

9. Do not blindly apply the original audit permission recommendations.
   - User clarified only finance areas need finance permission. Confirm policy before locking non-finance supplier/purchase views.

10. Do not claim visual fixes without browser-based evidence.
    - Use local server plus Chrome/Playwright/in-app browser screenshot or DOM measurements.

11. Do not rely on the in-app browser screenshot alone if it looks inconsistent.
    - In the last round, in-app browser screenshots mixed collapsed/expanded-looking visuals despite DOM measurements. Independent Chrome headless verification was used to confirm the actual rendered state.

12. Do not ignore deployment backup hashes.
    - Always record local CSS hash, remote CSS hash, public CSS hash, package hash, PM2 status, health output, and backup path.

## Useful Commands

Local CSS build and checks:

```bash
ALLOW_CSS_REBUILD=1 npm run build:css
npm run build:css -- --check
npm run check:js
```

Local visual server:

```bash
PORT=4175 AUTH_ENABLED=false SESSION_SECRET=local-sidebar-regression-secret npm start
```

Package and deploy CSS:

```bash
ALLOW_CSS_DEPLOY=1 npm run package:deploy -- --include-css
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
ssh root@47.107.92.14 'cd /opt/tanjia-bi && ALLOW_CSS_DEPLOY=1 KEEP_RELEASES=5 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
```

Post-deploy verification:

```bash
ssh root@47.107.92.14 'cd /opt/tanjia-bi && sha256sum styles.css && sha256sum tanjia-bi-deploy.tar.gz && curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
curl -fsS 'https://tanjiabi.cc/styles.css?v=20260705-frontend-refactor-v15' -o /tmp/tanjiabi-public-styles.css
shasum -a 256 /tmp/tanjiabi-public-styles.css
```

## Reference Docs

- `AGENTS.md`: current repo rules and module boundaries.
- `design.md`: UI design source of truth.
- `docs/handoff-sidebar-icon-parity-deploy-20260709.md`: detailed log for the latest sidebar icon fix and deploy.
- `docs/frontend-optimization-stage-summary-20260707.md`: earlier frontend optimization stage summary.
- `docs/performance-optimization-static-cache-20260707.md`: earlier performance optimization notes.
- `docs/g2-route-refactor-20260707.md`: route-table refactor notes.

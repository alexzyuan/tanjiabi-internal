# Handoff: Sidebar Icon Parity Fix And Deployment

Date: 2026-07-09

## Current Status

The sidebar active child icon offset regression has been fixed locally and deployed to production.

Production is running the new `styles.css`:

- Local `styles.css` SHA-256: `7eb9f22d96770e39884cc6322666df6e99fd20bd817aff25452fe4b8df8532ea`
- Remote `/opt/tanjia-bi/styles.css` SHA-256: `7eb9f22d96770e39884cc6322666df6e99fd20bd817aff25452fe4b8df8532ea`
- Public `https://tanjiabi.cc/styles.css?v=20260705-frontend-refactor-v15` SHA-256: `7eb9f22d96770e39884cc6322666df6e99fd20bd817aff25452fe4b8df8532ea`

PM2 app `tanjia-bi` is online and `/api/health` passed after deployment.

## User-Visible Issue Fixed

The expanded sidebar active child item, specifically `销售 > 店铺巡检`, showed the small icon container visually offset inside the active blue pill.

Root cause:

- Expanded child nav items use a `24px` icon grid column.
- The generic active nav rule gave `.nav-item.active .nav-icon` a `26px` icon container.
- That mismatch made the icon box appear shifted inside the 32px-tall active child pill.

## Code Changed

Changed only the sidebar/topbar parity layer:

- `assets/css/legacy/98-shell-topbar-parity.css`
- Generated `styles.css` via `ALLOW_CSS_REBUILD=1 npm run build:css`

Added a narrow override for expanded sidebar child active items only:

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
}
```

This intentionally does not change:

- Home nav item sizing.
- Top-level nav group icon sizing.
- Collapsed sidebar sizing.
- Topbar layout.
- Existing solid blue visual direction.

## Local Verification Performed

Commands:

```bash
ALLOW_CSS_REBUILD=1 npm run build:css
npm run build:css -- --check
npm run check:js
```

Rendered checks:

- Local server started with:

```bash
PORT=4175 AUTH_ENABLED=false SESSION_SECRET=local-sidebar-regression-secret npm start
```

- Verified expanded active child item in Chrome:
  - `.app-shell` not collapsed.
  - `.nav-item[data-view="store-inspection"]` active.
  - Item rect: `160x32`.
  - Icon rect: `24x24`.
  - SVG rect: `16x16`.
  - Grid columns: `24px 52px`.
  - Icon `fill: none`.
  - Icon stroke: white.

- Verified collapsed sidebar:
  - `.app-shell.sidebar-collapsed`.
  - Top-level `销售` icon rect: `24x24`.
  - SVG rect: `16x16`.
  - Icon `fill: none`.
  - Icon stroke remained dark line icon, not solid black.

Screenshots generated during verification:

- `/tmp/sidebar-store-inspection-expanded.png`
- `/tmp/sidebar-collapsed-after-fix.png`

## Deployment Performed

Package command:

```bash
ALLOW_CSS_DEPLOY=1 npm run package:deploy -- --include-css
```

Local package SHA-256:

```text
9024e9a070ba724d02c06d6df3820f67702c529cb3a0fb5b578bd4b9843afd5e  tanjia-bi-deploy.tar.gz
```

Upload command:

```bash
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
```

Deploy command:

```bash
ssh root@47.107.92.14 'cd /opt/tanjia-bi && ALLOW_CSS_DEPLOY=1 KEEP_RELEASES=5 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
```

Deployment backup created:

```text
/opt/tanjia-bi/releases/20260709-161337
```

Current retained remote backups after deployment:

```text
/opt/tanjia-bi/releases/20260709-115454
/opt/tanjia-bi/releases/20260709-154828
/opt/tanjia-bi/releases/20260709-155456
/opt/tanjia-bi/releases/20260709-161337
/opt/tanjia-bi/releases/manual-visual-before-rollback-20260707-184950
```

## Production Verification Performed

Remote checks:

```bash
ssh root@47.107.92.14 'cd /opt/tanjia-bi && sha256sum styles.css && sha256sum tanjia-bi-deploy.tar.gz && curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
```

Results:

- `styles.css` hash matched local: `7eb9f22d96770e39884cc6322666df6e99fd20bd817aff25452fe4b8df8532ea`
- Deploy package hash matched local: `9024e9a070ba724d02c06d6df3820f67702c529cb3a0fb5b578bd4b9843afd5e`
- Health check returned `{"ok":true,...}`
- Lingxing sync completed after restart.
- PM2 showed `tanjia-bi` as `online`.

Public CSS check:

```bash
curl -fsS 'https://tanjiabi.cc/styles.css?v=20260705-frontend-refactor-v15' -o /tmp/tanjiabi-public-styles-after-icon-fix.css
shasum -a 256 /tmp/tanjiabi-public-styles-after-icon-fix.css
wc -c /tmp/tanjiabi-public-styles-after-icon-fix.css
```

Results:

- Public CSS hash: `7eb9f22d96770e39884cc6322666df6e99fd20bd817aff25452fe4b8df8532ea`
- Public CSS size: `259510` bytes

## Rollback Notes

If production visual verification fails, the safest immediate rollback point for the version before this deploy is:

```text
/opt/tanjia-bi/releases/20260709-161337
```

This backup was created automatically by `deploy.sh` immediately before deploying the icon alignment fix.

Older known CSS baselines from the prior visual rollback work:

- Original locked CSS backup: `/opt/tanjia-bi/releases/20260709-154828`
- Previous candidate backup: `/opt/tanjia-bi/releases/20260709-155456`

Do not hand-edit remote `styles.css`. Roll back by restoring a release directory or redeploying a reviewed package.

## Known Caveats

- `npm audit` during remote install still reports `1 high severity vulnerability`; this was not addressed in this targeted CSS deployment.
- `node scripts/check-css-standards.js` is still expected to fail on existing CSS debt such as `!important`, hardcoded colors and legacy gradients. This task used `npm run build:css -- --check` and `npm run check:js` instead.
- Production sidebar visual was not directly inspected authenticated in-browser during this handoff. Public CSS and server health were verified, and local Chrome rendered verification covered the exact sidebar states.

## Recommended Next Step

Have the user refresh production with cache bypass and visually check:

1. Expanded sidebar `销售 > 店铺巡检` active state.
2. Collapsed sidebar top-level icons.
3. Topbar unchanged.

If accepted, keep this CSS baseline as the current deployed candidate.

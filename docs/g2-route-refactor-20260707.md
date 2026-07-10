# G2.1 Server Route Table Refactor

Date: 2026-07-07

## Scope

This stage completed the G2.1 backend routing refactor for `server.js`.

The previous router kept most API endpoints in one long `if (req.method && url.pathname)` chain. That structure made authorization easy to forget because every branch had to remember its own role check.

## Root Cause

- API routing, authorization, and handler error wrapping were mixed together in `server.js`.
- Permission requirements were implicit inside route branches instead of explicit route metadata.
- Dynamic routes used ad hoc `url.pathname.match()` and `startsWith()` checks.
- New endpoints could be added without declaring an auth policy.

## Decisions

- Keep the native Node HTTP server. No framework, bundler, or middleware stack was introduced.
- Move route definitions into domain files under `routes/`.
- Require every route to declare `auth` explicitly: `none`, `session`, `finance`, or `admin`.
- Keep permission semantics aligned with the current product decision:
  - finance dashboards remain `finance`;
  - account and knowledge admin remain `admin`;
  - supplier detail and budget upload/list routes remain authenticated but role-open as `session`.
- Keep `server.js` as the registration and dispatch layer.
- Support dynamic endpoints through `pattern: RegExp` route entries.

## Implemented Files

- `routes/index.js`
- `routes/auth.js`
- `routes/core.js`
- `routes/sales.js`
- `routes/advertising.js`
- `routes/aftersales.js`
- `routes/inventory.js`
- `routes/finance-purchase.js`
- `routes/fba.js`
- `routes/admin.js`
- `routes/sync-store-inspection.js`
- `routes/debug-knowledge.js`
- `server.js`
- `test/serverRoutesStructure.test.js`
- `package.json`

## Result

- Registered API routes: 90
- Auth split:
  - `none`: 6
  - `session`: 62
  - `admin`: 13
  - `finance`: 9
- `server.js`: reduced to 894 lines / 29,243 bytes.
- The legacy API `if/else` chain was removed from `router()`.
- `npm run check` now syntax-checks all `routes/*.js` files.
- Structural tests now fail if:
  - route modules are missing;
  - route count unexpectedly drops;
  - any route omits `auth`;
  - legacy API branches return inside `server.js`.

## Verification

Commands run:

```bash
node --test test/serverRoutesStructure.test.js
node --test test/serverSecurity.test.js
npm run check:js
npm run check
npm test
```

Results:

- `test/serverRoutesStructure.test.js`: 3/3 passed.
- `test/serverSecurity.test.js`: 9/9 passed.
- `npm run check:js`: passed.
- `npm run check`: passed.
- `npm test`: 219/219 passed.

## Notes

The current folder is not a Git repository, so no commit was created from this workspace.

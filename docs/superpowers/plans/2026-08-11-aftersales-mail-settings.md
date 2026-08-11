# JM 售后邮箱授权设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow only system administrators to manage the `jmcustomer@163.com` IMAP/SMTP switch and 163 authorization code from Settings → Sync Center without exposing the secret.

**Architecture:** A focused `aftersalesMailSettingsService` owns masked reads, candidate protocol checks, atomic `.env` writes, runtime configuration reload and secret-free audit records. Core admin routes expose that service, while the Sync Center feature renders and submits the native form. The entire Settings navigation and its management routes move from session access to administrator-only access.

**Tech Stack:** Native HTML/CSS/ES modules, Node.js ESM, `imapflow`, `nodemailer`, Node test runner, existing session/admin route authorization.

## Global Constraints

- Use Adobe Spectrum/project semantic tokens and existing native form controls; do not add React.
- Keep feature UI in `assets/js/features/sync-center.js`; `app.js` remains composition only.
- Edit layered CSS only if existing `.panel`, `.form-grid`, `.toggle-row`, and button primitives prove insufficient; never hand-edit generated `styles.css`.
- Never log, return, render, test-output, commit, or audit an authorization code.
- Store the authorization code only in production `.env`; retain its existing file mode and replace it atomically.
- An IMAP/SMTP candidate test must not send a message, trigger a mail sync, or overwrite configuration.
- All Settings UI and Settings management APIs require the exact `系统管理员` role; browser hiding is not a security boundary.
- Do not call a real 163 endpoint in automated tests; inject IMAP/SMTP verifiers.
- Preserve existing aftersales inbox, sent-mail matching, reply, and DingTalk inspection behavior.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/config/index.js` | Reload the in-memory `.env` map after the restricted settings service writes configuration. |
| `src/services/aftersalesMailSettingsService.js` | Read masked mailbox status, test a candidate code, atomically persist enabled/code settings, and record secret-free audit metadata. |
| `routes/core.js` | Expose administrator-only mailbox configuration routes. |
| `routes/sync-store-inspection.js` | Require administrator authorization for all existing Settings/Synchronization management routes. |
| `server.js` | Compose the mailbox settings service into the route dependency bag only. |
| `assets/js/features/auth-shell.js` | Hide the Settings group/view for non-administrators and navigate away if it is active. |
| `index.html` | Mark Settings as administrator-only and add semantic Sync Center mailbox settings markup. |
| `assets/js/features/sync-center.js` | Load/render/test/save the masked status and bind accessible controls. |
| `test/aftersalesMailSettingsService.test.js` | Unit-test secret masking, validation, atomic persistence and audit behavior using injected protocol probes. |
| `test/serverSecurity.test.js` | Prove Settings and mailbox APIs reject session-only roles while an administrator is allowed. |
| `test/authShellFeature.test.js` | Prove the Settings navigation/view is hidden and redirected for non-administrators. |
| `test/syncCenterFeature.test.js` | Prove the feature submits only the entered password and renders no secret. |
| `test/frontendStructure.test.js` | Preserve module boundaries and required Sync Center handlers. |

### Task 1: Reloadable runtime configuration and secret-safe settings service

**Files:**
- Modify: `src/config/index.js`
- Create: `src/services/aftersalesMailSettingsService.js`
- Create: `test/aftersalesMailSettingsService.test.js`

**Interfaces:**
- Produces `reloadDotEnv(): Record<string, string>` from `src/config/index.js`; subsequent `getConfig()` calls use the fresh map.
- Produces `createAftersalesMailSettingsService(options)` returning `getStatus()`, `testConnection(payload)`, and `saveSettings(payload, actor)`.
- `testConnection({ password?: string })` resolves `{ ok, checkedAt, message }` and never writes.
- `saveSettings({ enabled: boolean, password?: string }, actor)` resolves the same masked status shape as `getStatus()` and writes only after required verification succeeds.

- [ ] **Step 1: Write failing service tests in an isolated temporary directory**

```js
test("mail settings status never returns the configured authorization code", async () => {
  await withTempMailboxSettings(async ({ service }) => {
    const status = await service.getStatus();
    assert.equal(status.account, "jmcustomer@163.com");
    assert.equal(status.passwordConfigured, true);
    assert.equal(JSON.stringify(status).includes("secret-163-code"), false);
  });
});

test("a failed candidate test does not overwrite the prior .env code", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    await assert.rejects(
      service.saveSettings({ enabled: true, password: "bad-code" }, { name: "系统管理员" }),
      /SMTP authentication failed/,
    );
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=secret-163-code/);
  });
});

test("a verified replacement is persisted atomically and audit rows contain no code", async () => {
  await withTempMailboxSettings(async ({ service, envPath, auditPath }) => {
    const status = await service.saveSettings({ enabled: true, password: "rotated-code" }, { name: "系统管理员" });
    assert.equal(status.enabled, true);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=rotated-code/);
    assert.equal((await readFile(auditPath, "utf8")).includes("rotated-code"), false);
  });
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `node --test test/aftersalesMailSettingsService.test.js`

Expected: FAIL because `aftersalesMailSettingsService.js` and `reloadDotEnv` do not exist.

- [ ] **Step 3: Make `.env` reload explicit and implement the focused service**

In `src/config/index.js`, replace the immutable parsed map with a refreshable binding and export a reload function:

```js
let dotEnv = loadDotEnv();

export function reloadDotEnv() {
  dotEnv = loadDotEnv();
  return { ...dotEnv };
}
```

In `src/services/aftersalesMailSettingsService.js`, use dependency injection for files, clock, config lookup and protocol probes. Persist only the two managed keys via a same-directory temporary file and rename:

```js
export function createAftersalesMailSettingsService({
  envPath = path.join(process.cwd(), ".env"),
  auditPath = path.join(process.cwd(), "data-cache", "aftersales-mail-settings-audit.json"),
  getConfig = getRuntimeConfig,
  reloadConfig = reloadDotEnv,
  verifyImap = defaultVerifyImap,
  verifySmtp = defaultVerifySmtp,
  now = () => new Date().toISOString(),
} = {}) {
  // getStatus() returns account/enabled/passwordConfigured/lastTest/lastChange only.
  // testConnection() selects payload.password || current password and probes IMAP then SMTP.
  // saveSettings() probes a supplied new password before writing; disabling does not delete the saved code.
}
```

`defaultVerifyImap` must create an `ImapFlow` connection and disconnect after authentication. `defaultVerifySmtp` must call `nodemailer.createTransport(...).verify()`. Catch an upstream error only to return a user-safe message such as `IMAP 登录失败：<provider message>`; do not log the password or include it in `details`.

- [ ] **Step 4: Run focused tests and inspect the persisted audit payload**

Run: `node --test test/aftersalesMailSettingsService.test.js`

Expected: PASS. Add assertions that test-only `password` values are absent from both `getStatus()` JSON and the audit file, and that setting `enabled: false` keeps `AFTERSALES_MAIL_PASSWORD` unchanged while changing `AFTERSALES_MAIL_ENABLED=false`.

- [ ] **Step 5: Commit the service foundation**

```bash
git add src/config/index.js src/services/aftersalesMailSettingsService.js test/aftersalesMailSettingsService.test.js
git commit -m "feat: add secure aftersales mail settings service"
```

### Task 2: Enforce administrator-only Settings APIs

**Files:**
- Modify: `routes/core.js`
- Modify: `routes/sync-store-inspection.js`
- Modify: `server.js`
- Modify: `test/serverSecurity.test.js`

**Interfaces:**
- Consumes the three methods returned by `createAftersalesMailSettingsService()`.
- Produces `GET /api/admin/aftersales-mail-config`, `POST /api/admin/aftersales-mail-config/test`, and `PUT /api/admin/aftersales-mail-config`, each with `auth: "admin"`.
- Changes every route in `createSyncStoreInspectionRoutes()` to `auth: "admin"`.

- [ ] **Step 1: Extend route-security tests before changing routes**

Add a subaccount rejection matrix and administrator success checks:

```js
const settingsRoutes = [
  "/api/sync/status",
  "/api/lingxing/shops",
  "/api/store-inspection/status",
  "/api/store-inspection/settings",
  "/api/admin/aftersales-mail-config",
];
for (const path of settingsRoutes) {
  const response = await fetch(`${server.baseUrl}${path}`, { headers: { cookie: subaccount.cookie } });
  assert.equal(response.status, 403, path);
}

const configResponse = await fetch(`${server.baseUrl}/api/admin/aftersales-mail-config`, { headers: { cookie: admin.cookie } });
assert.equal(configResponse.status, 200);
assert.equal((await configResponse.json()).passwordConfigured, false);
```

Also change the existing session-route test that expects `/api/sync/status` and `/api/lingxing/shops` to return `200` for a subaccount; it must now expect `403`.

- [ ] **Step 2: Run security tests to verify the new matrix fails**

Run: `node --test test/serverSecurity.test.js`

Expected: FAIL because the existing Settings routes still use `session`, and mailbox routes do not exist.

- [ ] **Step 3: Register admin routes and tighten all Settings route guards**

Pass the service methods through the existing `server.js` `buildApiRoutes({...})` dependency object. In `routes/core.js`, add:

```js
{
  method: "GET",
  path: "/api/admin/aftersales-mail-config",
  auth: "admin",
  handler: async ({ res }) => sendJson(res, 200, await getAftersalesMailSettings()),
},
{
  method: "POST",
  path: "/api/admin/aftersales-mail-config/test",
  auth: "admin",
  errorStatusCode: 400,
  handler: async ({ req, res }) => sendJson(res, 200, await testAftersalesMailSettings(await readJsonBody(req))),
},
{
  method: "PUT",
  path: "/api/admin/aftersales-mail-config",
  auth: "admin",
  errorStatusCode: 400,
  handler: async ({ req, res }) => sendJson(res, 200, await saveAftersalesMailSettings(await readJsonBody(req), req.user)),
},
```

Change every `auth: "session"` value in `routes/sync-store-inspection.js` to `auth: "admin"`. In `routes/core.js`, change only `/api/sync/status` and `/api/lingxing/shops` to `auth: "admin"`; keep `/api/health` as `auth: "none"`.

- [ ] **Step 4: Run route-security and syntax checks**

Run: `node --test test/serverSecurity.test.js && node --check server.js && node --check routes/core.js && node --check routes/sync-store-inspection.js`

Expected: PASS. Confirm the response bodies for mailbox GET/test/save contain no `password` property or secret test value.

- [ ] **Step 5: Commit route authorization**

```bash
git add routes/core.js routes/sync-store-inspection.js server.js test/serverSecurity.test.js
git commit -m "feat: restrict settings routes to administrators"
```

### Task 3: Restrict the Settings navigation and add accessible mailbox markup

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/auth-shell.js`
- Modify: `test/authShellFeature.test.js`
- Modify: `test/frontendStructure.test.js`

**Interfaces:**
- Settings group is identifiable as `.nav-group[data-permission="admin"]` and Sync view as `#view-sync[data-permission="admin"]`.
- `applyAuthVisibility()` hides or reveals those elements based on `canManageAdminSettings(user)` and redirects a non-admin from Sync to Home.
- Markup provides `#aftersales-mail-settings-form`, `#aftersales-mail-enabled`, `#aftersales-mail-password`, `#aftersales-mail-test`, `#aftersales-mail-save`, `#aftersales-mail-status`, and `#aftersales-mail-summary`.

- [ ] **Step 1: Add failing permission and structure assertions**

Add an auth-shell unit test using the existing fake-root helpers:

```js
const result = feature.applyAuthVisibility({ role: "子账号" });
assert.equal(result.canEnterAdmin, false);
assert.equal(settingsGroup.hidden, true);
assert.equal(syncView.hidden, true);
assert.equal(homeButton.clickCount, 1);
```

Add static structure assertions:

```js
assert.match(indexSource, /<section class="nav-group" aria-label="设置" data-permission="admin" hidden>/);
assert.match(indexSource, /<section class="view" id="view-sync" data-permission="admin" hidden>/);
assert.match(indexSource, /id="aftersales-mail-password" type="password"/);
assert.match(indexSource, /id="aftersales-mail-test" type="button"/);
```

- [ ] **Step 2: Run the focused frontend tests to verify they fail**

Run: `node --test test/authShellFeature.test.js test/frontendStructure.test.js`

Expected: FAIL because Settings is neither tagged nor handled by `syncPermissionVisibility`, and the mailbox controls do not exist.

- [ ] **Step 3: Apply the smallest semantic markup and visibility extension**

Use existing form primitives; do not add page-specific styles:

```html
<article class="panel" id="aftersales-mail-settings-panel">
  <div class="panel-head"><h2>JM 售后邮箱授权</h2><span>仅系统管理员可管理</span></div>
  <form class="form-grid" id="aftersales-mail-settings-form">
    <label>邮箱账号<input id="aftersales-mail-account" type="text" readonly /></label>
    <label class="toggle-row"><input id="aftersales-mail-enabled" type="checkbox" />启用收件与 ERP 回复</label>
    <label>163 授权码<input id="aftersales-mail-password" type="password" autocomplete="new-password" placeholder="留空表示不更换" /></label>
    <div><button class="secondary-button" id="aftersales-mail-test" type="button">测试连接</button><button class="primary-button" id="aftersales-mail-save" type="submit">保存设置</button></div>
  </form>
  <p id="aftersales-mail-status" role="status" aria-live="polite"></p>
  <div class="config-list" id="aftersales-mail-summary"></div>
</article>
```

Extend `syncPermissionVisibility()` with an administrator list:

```js
const adminSettingsGroups = root?.querySelectorAll?.('.nav-group[data-permission="admin"], .view[data-permission="admin"]') || [];
setElementsHidden(adminSettingsGroups, !canEnterAdmin, root);
```

Extend `moveToDefaultViewIfRestricted()` to regard `.nav-item[data-view="sync"].active` as restricted for `!canEnterAdmin` and use the existing Home button click navigation.

- [ ] **Step 4: Run focused frontend tests**

Run: `node --test test/authShellFeature.test.js test/frontendStructure.test.js`

Expected: PASS. Confirm no user-provided authorization string is represented in markup, test fixtures, or static source.

- [ ] **Step 5: Commit Settings visibility and markup**

```bash
git add index.html assets/js/features/auth-shell.js test/authShellFeature.test.js test/frontendStructure.test.js
git commit -m "feat: restrict settings navigation to administrators"
```

### Task 4: Bind the Sync Center mailbox controls

**Files:**
- Modify: `assets/js/features/sync-center.js`
- Create: `test/syncCenterFeature.test.js`
- Modify: `test/frontendStructure.test.js`

**Interfaces:**
- `createSyncCenterFeature()` produces `loadAftersalesMailSettings()`, `testAftersalesMailSettings()`, and `saveAftersalesMailSettings(event)`.
- The GET response shape is `{ account, enabled, passwordConfigured, lastTest, lastChange }`; client state never stores a password after a request completes.
- `setupSyncCenter()` binds test button click and form submit exactly once through the injected `bind` helper.

- [ ] **Step 1: Write failing feature tests with a fake DOM and fetch queue**

```js
test("sync center masks the stored authorization code and renders admin mailbox status", async () => {
  const feature = createFeatureWithMailboxElements({
    fetchImpl: async () => jsonResponse({ account: "jmcustomer@163.com", enabled: true, passwordConfigured: true, lastTest: null, lastChange: null }),
  });
  await feature.loadAftersalesMailSettings();
  assert.equal(elements.get("#aftersales-mail-account").value, "jmcustomer@163.com");
  assert.equal(elements.get("#aftersales-mail-password").value, "");
  assert.match(elements.get("#aftersales-mail-summary").innerHTML, /授权码已配置/);
});

test("testing and saving send only a currently entered code", async () => {
  elements.get("#aftersales-mail-password").value = "new-code";
  await feature.testAftersalesMailSettings();
  await feature.saveAftersalesMailSettings({ preventDefault() {} });
  assert.deepEqual(requests.map((request) => request.body), [
    { password: "new-code" },
    { enabled: true, password: "new-code" },
  ]);
  assert.equal(elements.get("#aftersales-mail-password").value, "");
});
```

- [ ] **Step 2: Run the feature test to verify it fails**

Run: `node --test test/syncCenterFeature.test.js`

Expected: FAIL because the Sync Center has no mailbox loaders, renderers, or handlers.

- [ ] **Step 3: Implement focused client behavior**

Add a local renderer that uses `escapeHtml` for server messages and only derives the display text from booleans:

```js
function renderAftersalesMailSettings(data = {}) {
  const password = query("#aftersales-mail-password");
  if (password) password.value = "";
  const account = query("#aftersales-mail-account");
  if (account) account.value = data.account || "jmcustomer@163.com";
  query("#aftersales-mail-enabled").checked = data.enabled === true;
  query("#aftersales-mail-summary").innerHTML = `<div><strong>${data.passwordConfigured ? "授权码已配置" : "授权码未配置"}</strong><span>${escapeHtml(data.lastTest?.message || "尚未测试")}</span></div>`;
}
```

Use `POST /api/admin/aftersales-mail-config/test` for the test button and `PUT /api/admin/aftersales-mail-config` for form submission. Parse JSON errors, show them through `setStatusMessage`, clear the password input in `finally`, and reload the masked status after either successful action. Extend the feature factory contract in `test/frontendStructure.test.js` without moving fetches into `app.js`.

- [ ] **Step 4: Run focused feature and structure tests**

Run: `node --test test/syncCenterFeature.test.js test/frontendStructure.test.js`

Expected: PASS. Confirm the request body contains `password` only when the administrator entered one, and feature state does not retain it.

- [ ] **Step 5: Commit Sync Center behavior**

```bash
git add assets/js/features/sync-center.js test/syncCenterFeature.test.js test/frontendStructure.test.js
git commit -m "feat: manage aftersales mail authorization in sync center"
```

### Task 5: Full verification, browser checks, and guarded production delivery

**Files:**
- Modify only if required by failed verification: files from Tasks 1–4
- Verify: `test/aftersalesMailSettingsService.test.js`, `test/serverSecurity.test.js`, `test/authShellFeature.test.js`, `test/syncCenterFeature.test.js`, `test/frontendStructure.test.js`, `package.json`

**Interfaces:**
- All prior interfaces remain stable. No route returns or logs a password.

- [ ] **Step 1: Run the complete automated suite and static checks**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: every Node test passes, checks exit `0`, and the diff has no whitespace errors. If any test fails, return to the owning task and add the smallest cause-level correction with a corresponding regression assertion.

- [ ] **Step 2: Verify administrator and non-administrator behavior in a local browser**

Start the app with test-safe local credentials. In the browser:

1. Log in as a system administrator; open Settings → Sync Center; verify the mailbox card is visible, password input is blank, keyboard focus reaches the switch/test/save controls, and no console error occurs.
2. Submit an intentionally invalid local/test authorization code through the mocked or injected test environment; verify a clear failure status and that the displayed `passwordConfigured` state does not change.
3. Log in as a subaccount; verify the Settings group is absent, force navigation to the Sync view, and confirm the app returns to Home.
4. Use the subaccount session to request `/api/sync/status` and `/api/admin/aftersales-mail-config`; verify `403` responses.
5. At a narrow viewport, verify the card remains within the viewport and only the form, not the document, wraps/scrolls as needed.

- [ ] **Step 3: Create a final implementation commit**

```bash
git status --short
git add src/config/index.js src/services/aftersalesMailSettingsService.js routes/core.js routes/sync-store-inspection.js server.js index.html assets/js/features/auth-shell.js assets/js/features/sync-center.js test
git commit -m "feat: secure aftersales mail settings"
```

Expected: only task-scoped source, tests and docs are staged. Do not include `.env`, `data-cache`, `uploads`, generated `styles.css`, or unrelated worktree changes.

- [ ] **Step 4: Package and deploy only after the worktree is clean and the production branch is confirmed**

Run from the committed production branch:

```bash
git status --short
DEPLOY_CONFIRM_BRANCH=main npm run package:deploy
scp tanjia-bi-deploy.tar.gz root@47.107.92.14:/opt/tanjia-bi/tanjia-bi-deploy.tar.gz
ssh root@47.107.92.14 'cd /opt/tanjia-bi && bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz'
```

Expected: packaging writes a manifest with a clean committed `main` state; the remote deploy guard accepts it; PM2 restarts `tanjia-bi`; local health check succeeds. Do not hand-copy runtime files around the deploy guard.

- [ ] **Step 5: Perform a production-safe post-deploy check**

Run:

```bash
ssh root@47.107.92.14 'curl -fsS http://127.0.0.1:4173/api/health && pm2 status tanjia-bi --no-color'
```

Then sign in as a system administrator and verify the masked mailbox status is rendered. Do not press “测试连接” or “保存设置” in production unless an operator explicitly supplies a replacement authorization code; the deployed existing `.env` credential must remain untouched.

# 产品证书有效期台账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a persistent product-certificate ledger with automatic expiry status, CRUD, an XLSX template and atomic XLSX import.

**Architecture:** `productCertificateService` owns record validation, status calculation, JSON persistence and workbook conversion. `product-certificates` routes expose only session-authenticated HTTP mappings. The native view remains in `index.html`; `product-certificates.js` owns state, fetches and dialogs, while `app.js` only composes the feature and triggers the view loader.

**Tech Stack:** Node.js ESM, node:test, SheetJS (`xlsx`), native HTML `<dialog>`, native CSS layers, browser verification.

**Spec:** `docs/superpowers/specs/2026-08-20-product-certificate-ledger-design.md`

## Global Constraints

- Persist only ledger fields in `data-cache/product-certificates/product-certificates-v1.json`; status is a read-time derived field.
- Required XLSX headers, in order: `国家`, `产品SKU`, `证书类型`, `证书编号`, `签发日期`, `过期日期`; no user-supplied status field is accepted.
- Status priority is: expired, 0–30 days `预警`, 31–60 days `注意`, then `有效`.
- Import is all-or-nothing and rejects duplicate business keys in the same workbook.
- All API routes use `session` auth. No Lingxing calls, attachment storage, background process or app-specific business state in `app.js`.
- Edit CSS source layers only, run `npm run build:css`, and never hand-edit `styles.css`.

---

### Task 1: Implement the ledger service with test-first persistence and status rules

**Files:**
- Create: `src/services/productCertificateService.js`
- Create: `test/productCertificateService.test.js`

**Interfaces:**
- Produces `createProductCertificateService({ directory, now, logger })` with `listCertificates(filters)`, `saveCertificate(input)`, `updateCertificate(id, input)`, `deleteCertificate(id)`, `importCertificates(payload)`, and `createCertificateImportTemplate()`.
- Each list result is `{ rows, summary, filters }`; each row has `id`, `country`, `productSku`, `certificateType`, `certificateNumber`, `issuedDate`, `expiryDate`, `status`.

- [ ] **Step 1: Write failing status-boundary and validation tests**

```js
test("certificate status uses expiry priority at 30 and 60 day boundaries", async () => {
  await withService({ now: () => Date.parse("2026-08-20T00:00:00Z") }, async (service) => {
    await service.saveCertificate(record({ certificateNumber: "EX", expiryDate: "2026-08-19" }));
    await service.saveCertificate(record({ certificateNumber: "W30", expiryDate: "2026-09-19" }));
    await service.saveCertificate(record({ certificateNumber: "N31", expiryDate: "2026-09-20" }));
    await service.saveCertificate(record({ certificateNumber: "N60", expiryDate: "2026-10-19" }));
    await service.saveCertificate(record({ certificateNumber: "A61", expiryDate: "2026-10-20" }));
    assert.deepEqual((await service.listCertificates()).rows.map((row) => row.status), ["已过期", "预警", "注意", "注意", "有效"]);
  });
});

test("certificate rejects invalid dates and inverted issue expiry dates", async () => {
  await withService({}, async (service) => {
    await assert.rejects(() => service.saveCertificate(record({ expiryDate: "2026-02-30" })), /过期日期/);
    await assert.rejects(() => service.saveCertificate(record({ issuedDate: "2026-10-01", expiryDate: "2026-09-30" })), /不得早于签发日期/);
  });
});
```

- [ ] **Step 2: Run the service tests and confirm RED**

Run: `node --test test/productCertificateService.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Add the minimal JSON-backed service**

Implement normalized business-key comparison, strict date parsing, UUID generation, status calculation from injected `now`, and `readLedger`/`writeLedgerAtomically`. Save a complete JSON document to a temporary sibling path, then rename it only after serialization succeeds. Make all record mutation methods return the saved record with derived status.

```js
const businessKey = (row) => [row.country, row.productSku, row.certificateType, row.certificateNumber]
  .map((value) => normalizeText(value).toLocaleLowerCase("en-US"))
  .join("\u0001");

function expiryStatus(expiryDate, now) {
  const days = Math.floor((parseDateUtc(expiryDate) - startOfUtcDay(now)) / 86_400_000);
  if (days < 0) return "已过期";
  if (days <= 30) return "预警";
  if (days <= 60) return "注意";
  return "有效";
}
```

- [ ] **Step 4: Run focused service tests and confirm GREEN**

Run: `node --test test/productCertificateService.test.js`

Expected: PASS for status and validation tests.

- [ ] **Step 5: Add failing atomic-import and template tests**

```js
test("certificate import rejects one invalid row without changing existing ledger", async () => {
  await withService({}, async (service) => {
    await service.saveCertificate(record({ certificateNumber: "OLD" }));
    await assert.rejects(() => service.importCertificates(xlsxPayload([
      record({ certificateNumber: "NEW" }),
      record({ certificateNumber: "BAD", expiryDate: "invalid-date" }),
    ])), /第3行.*过期日期/);
    assert.deepEqual((await service.listCertificates()).rows.map((row) => row.certificateNumber), ["OLD"]);
  });
});

test("certificate template uses the fixed import headers in order", async () => {
  const workbook = XLSX.read(await service.createCertificateImportTemplate(), { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })[0], ["国家", "产品SKU", "证书类型", "证书编号", "签发日期", "过期日期"]);
});
```

- [ ] **Step 6: Implement workbook parsing and atomic upsert**

Use SheetJS on the first worksheet with `header: 1`; validate the exact fixed header sequence, skip fully blank rows, reject unknown/missing data and duplicate business keys before reading or writing current rows. Merge validated imported rows by business key into a cloned ledger, perform one atomic write, and return `{ importedCount, updatedCount, totalCount }`. Require `.xlsx`, a non-empty Base64 payload, and reject a decoded empty buffer.

- [ ] **Step 7: Run focused service tests and confirm GREEN**

Run: `node --test test/productCertificateService.test.js`

Expected: PASS for service CRUD, status, template and atomic import cases.

- [ ] **Step 8: Commit service behavior**

```bash
git add src/services/productCertificateService.js test/productCertificateService.test.js
git commit -m "feat: add product certificate ledger service"
```

### Task 2: Add session-protected certificate routes and server composition

**Files:**
- Create: `routes/product-certificates.js`
- Modify: `routes/index.js`
- Modify: `server.js`
- Create: `test/productCertificateRoutes.test.js`
- Modify: `test/serverRoutesStructure.test.js`

**Interfaces:**
- Consumes Task 1 service functions as route dependencies.
- Produces all six `/api/product-certificates` route descriptors using `session` auth.

- [ ] **Step 1: Write failing route descriptor and delegation tests**

```js
test("certificate routes are session-authenticated and delegate exact operations", async () => {
  const { routes, calls } = createHarness();
  assert.deepEqual(routes.map((route) => route.auth), ["session", "session", "session", "session", "session", "session"]);
  await routes.find((route) => route.method === "POST" && route.path === "/api/product-certificates").handler({ req: {}, res: {} });
  assert.deepEqual(calls.save, [{ country: "美国", productSku: "SKU-1" }]);
});

test("certificate template returns an XLSX attachment", async () => {
  const route = createHarness().routes.find((item) => item.path === "/api/product-certificates/template");
  await route.handler({ res });
  assert.match(headers["content-type"], /spreadsheetml/);
  assert.match(headers["content-disposition"], /产品证书有效期导入模板\.xlsx/);
});
```

- [ ] **Step 2: Run route tests and confirm RED**

Run: `node --test test/productCertificateRoutes.test.js test/serverRoutesStructure.test.js`

Expected: FAIL because the route module and composition do not yet exist.

- [ ] **Step 3: Implement routes and dependency injection**

Create route handlers that use `readJsonBody` for write/import requests and `sendJson` for JSON responses. Use the established `contentDispositionAttachment` helper for the template. Add `createProductCertificateRoutes(deps)` to `routes/index.js`, import the service factory in `server.js`, create it once, and pass its public methods into `buildApiRoutes`. Set write route `errorStatusCode: 400`; do not catch errors locally.

- [ ] **Step 4: Run focused route tests and confirm GREEN**

Run: `node --test test/productCertificateRoutes.test.js test/serverRoutesStructure.test.js`

Expected: PASS; all routes declare session authentication, template headers are correct, and service input is forwarded unchanged.

- [ ] **Step 5: Commit routes**

```bash
git add routes/product-certificates.js routes/index.js server.js test/productCertificateRoutes.test.js test/serverRoutesStructure.test.js
git commit -m "feat: expose product certificate ledger API"
```

### Task 3: Build the certificate view and isolated frontend feature

**Files:**
- Modify: `index.html`
- Create: `assets/js/features/product-certificates.js`
- Modify: `app.js`
- Modify: `assets/js/features/breadcrumb-shell.js`
- Modify: `test/frontendStructure.test.js`

**Interfaces:**
- Produces `createProductCertificatesFeature({ root, bind, escapeHtml, fetchImpl, readFileAsBase64, setButtonBusy, setStatusMessage, refreshTable })` with `loadProductCertificates()` and `setupProductCertificates()`.
- Uses GET `/api/product-certificates`, CRUD requests, POST `/api/product-certificates/import`, and the template URL.

- [ ] **Step 1: Write failing structure and ownership tests**

```js
test("certificates owns a usable ledger and import workflow outside app bootstrap", async () => {
  assert.match(certificateView, /<th[^>]*>国家<\/th>[\s\S]*产品 SKU[\s\S]*过期日期[\s\S]*状态/);
  assert.match(certificateView, /id="certificate-import-dialog"/);
  assert.match(certificateView, /id="certificate-editor-dialog"/);
  assert.match(featureSource, /export function createProductCertificatesFeature/);
  assert.match(featureCall, /readFileAsBase64,/);
  assert.equal(appSource.includes('bind(document, "#certificate-'), false);
});
```

- [ ] **Step 2: Run structure test and confirm RED**

Run: `node --test test/frontendStructure.test.js`

Expected: FAIL because the view remains a static six-column placeholder and the feature module is absent.

- [ ] **Step 3: Implement semantic markup and feature state**

Replace the placeholder section with metric tiles for 有效/预警/注意/已过期, accessible country/type/status/keyword controls, and a managed table with stable `data-table-key="product-certificates"` and semantic column keys. Add native editor and import dialogs with labels, close/cancel controls, a template link, file input and live status messages. In the feature, render escaped rows and status pills, derive client-side filters from fetched rows, submit CRUD/import requests, refresh after each successful mutation, and display server errors without fallback success messages.

Import and construct the feature in `app.js`; pass shared helpers only. On `view === "certificates"`, call `loadProductCertificates()`. Add the breadcrumb mapping `certificates: ["首页", "产品", "证书有效期"]` only if it is not already present; do not duplicate it.

- [ ] **Step 4: Run frontend structure test and confirm GREEN**

Run: `node --test test/frontendStructure.test.js`

Expected: PASS; the certificate flow is fully feature-owned and app bootstrap contains no certificate-specific state or event bindings.

- [ ] **Step 5: Commit frontend behavior**

```bash
git add index.html assets/js/features/product-certificates.js app.js assets/js/features/breadcrumb-shell.js test/frontendStructure.test.js
git commit -m "feat: add product certificate ledger view"
```

### Task 4: Add token-based certificate page styles and regenerate CSS

**Files:**
- Create: `assets/css/pages/69-product-certificates.css`
- Generated: `styles.css`
- Modify: `test/stylesStructure.test.js`

**Interfaces:**
- Uses shared buttons, form controls, modal shell, status pills and table behavior from the design system.
- Produces only certificate-specific layout selectors; column sizing remains data-table-managed.

- [ ] **Step 1: Write a failing source-ownership test**

```js
test("product certificate styles live in the page source layer without business column widths", async () => {
  const css = await readFile(new URL("../assets/css/pages/69-product-certificates.css", import.meta.url), "utf8");
  assert.match(css, /\.certificate-toolbar/);
  assert.match(css, /\.certificate-import-dialog/);
  assert.equal(/(?:th|td):nth-child\([^)]*\)\s*\{[^}]*\b(?:width|min-width)\s*:/.test(css), false);
});
```

- [ ] **Step 2: Run the styles test and confirm RED**

Run: `node --test test/stylesStructure.test.js`

Expected: FAIL because the certificate source CSS does not exist.

- [ ] **Step 3: Add source CSS and generate `styles.css`**

Style only the toolbar, metric grid, table wrapper spacing, dialog field grid, import status, and desktop behavior using existing `--spectrum-*` / project semantic tokens. Use the existing modal and status-pill classes rather than new literal colors. Run `npm run build:css` after adding the CSS source.

- [ ] **Step 4: Run source and generated-CSS checks**

Run: `node --test test/stylesStructure.test.js && npm run build:css -- --check`

Expected: PASS and generated `styles.css` exactly matches layered sources.

- [ ] **Step 5: Commit styles**

```bash
git add assets/css/pages/69-product-certificates.css styles.css test/stylesStructure.test.js
git commit -m "style: add product certificate ledger layout"
```

### Task 5: Verify end-to-end behavior and prepare the guarded deployment artifact

**Files:**
- No production code changes expected

- [ ] **Step 1: Run all automated verification**

Run: `npm test && npm run check`

Expected: all project tests, generated-CSS validation and JavaScript syntax checks pass.

- [ ] **Step 2: Perform browser verification at desktop width**

Run: `npm start`

Open the local application, navigate 产品 → 证书有效期, verify the console has no errors, add a record through the keyboard-accessible editor, download the XLSX template, import a valid completed workbook, and confirm that the resulting row, calculated status, metrics and status filter agree. Then import a workbook with an invalid date and confirm the error is visible while existing rows remain unchanged. Verify table overflow is contained within its wrapper.

- [ ] **Step 3: Check deployment preconditions and package only a clean, committed production branch**

Run: `git status --short && git branch --show-current && git log -1 --oneline`

Expected: clean worktree on the approved production branch after the implementation commits have been reviewed and integrated. Only then run `DEPLOY_CONFIRM_BRANCH=main npm run package:deploy`. Do not package or deploy the isolated feature branch without explicit `ALLOW_NON_PRODUCTION_DEPLOY=1` authorization.

- [ ] **Step 4: Commit verification-only documentation only if needed**

```bash
git status --short
```

Expected: no uncommitted tracked source changes; do not create a placeholder verification commit.

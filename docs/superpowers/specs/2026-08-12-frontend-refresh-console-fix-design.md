# Frontend Refresh And Console Reliability Design

## Goal

Remove the production dashboard loading-overlay console exception, make Supplier Board product refresh reliably keyboard-operable without duplicate submissions, and remove the four current high-severity dependency advisories through reviewed non-breaking upgrades.

## Scope And Ownership

- `assets/js/dashboard-loader.js` owns selector-to-element resolution for dashboard loading overlays. It will reject empty or whitespace-only selector strings before calling `querySelector`.
- `assets/js/features/supplier-board.js` owns Supplier Board product-refresh activation. The existing semantic `<button type="button">` in `index.html` remains the control; no feature state or event handling moves into `app.js`.
- `package.json` and `package-lock.json` own dependency remediation. Upgrades must follow the existing direct dependency graph and may not use `npm audit fix --force`.
- Regression coverage belongs in `test/dashboardLoader.test.js`, `test/supplierBoardFeature.test.js`, and the existing mail/network/security suites.
- `server.js`, product-catalog services/schema, deployment scripts, `index.html`, CSS sources, and generated `styles.css` are not changed unless root-cause evidence proves they are required. The current evidence does not require them.

## Root Causes

### Empty selector exception

`resolveOverlayTarget()` passes the default empty `targetSelector` to the local `resolveElement()` helper. That helper treats every string as a CSS selector and calls `root.querySelector("")`, which throws instead of allowing the overlay target fallback chain to continue.

The fix belongs at the selector resolution boundary: normalize string input, return `null` for empty input, and let malformed non-empty selectors continue to throw. This preserves fail-fast behavior for real selector bugs while making the documented optional-selector default valid.

### Supplier Board keyboard activation

The product refresh control is already a native button and the feature binds one `click` handler. A native button normally synthesizes click from Enter/Space, so adding an unconditional key handler can double-submit. The implementation must first reproduce the production behavior with a real keyboard event and then use the narrowest compatible activation path:

1. Preserve the native semantic button and single in-flight guard.
2. If the application/browser path does not synthesize click, bind only the missing keyboard behavior in the Supplier Board feature.
3. Prevent the corresponding native default before invoking refresh so one key press produces exactly one request.
4. Keep repeated setup idempotent and verify mouse click still submits once.

## Dependency Remediation

The current audit findings are:

- direct `mailparser@3.9.12` through `linkify-it@5.0.1`;
- direct `undici@8.5.0`;
- transitive `ip-address@10.2.0` through `imapflow -> socks`.

Use supported, non-major package resolution updates that clear the advisories. Validate the resulting tree with `npm audit`, `npm ls`, the mail parser/settings tests, image-cache SSRF tests, adapter/network tests, and the full suite. If a transitive fix requires a direct override, document why the parent dependency cannot yet select the patched version; do not add an override merely to silence the audit.

## Error Handling And Observability

- Empty optional selectors return `null`; malformed non-empty selectors still throw.
- Product refresh keeps its existing fail-closed response validation, safe status text, button restoration, and redacted logs.
- Keyboard activation uses the same `refreshSupplierBoardProducts()` path and the same single-flight promise as mouse activation; no parallel state machine is introduced.
- Dependency upgrades must not weaken the existing SSRF/private-address rejection or mail credential redaction.

## Verification

1. TDD RED/GREEN for empty and whitespace-only overlay selectors, including a root whose `querySelector` records/throws on invalid calls.
2. TDD RED/GREEN for Enter activation, exactly one API request, busy restoration, repeated setup, and unchanged mouse activation.
3. Focused Node tests for dashboard loader, Supplier Board, frontend structure, mail, network, and security boundaries.
4. `npm audit`, `npm ls`, `npm run check`, `npm test`, and `git diff --check`.
5. Browser plugin verification on a local server at desktop and 390px width: page identity, nonblank render, no framework overlay, clean console, keyboard Enter interaction, mouse interaction, busy/restored state, and screenshots.

No production deployment is included in this change. A later deploy must use the package guard from a clean, pushed `main` and should not include CSS because this design changes no styles.

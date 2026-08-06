# Visual Baseline 2026-07-15

This baseline captures the approved locked `styles.css` visual state before CSS source parity work.

## Environment

- Local URL: `http://127.0.0.1:4173/`
- CSS mode: locked `styles.css`
- Data provider: local mock runtime
- Desktop viewport: `1440x1000`
- Mobile viewport: `390x844`
- Browser path: in-app Browser loaded the page and verified DOM identity; its screenshot API timed out, so screenshots were captured with the Playwright CLI wrapper using Chrome.

## Desktop Screenshots

- `locked/desktop/home-shell-expanded.png`
- `locked/desktop/home-shell-collapsed.png`
- `locked/desktop/sales-dashboard.png`
- `locked/desktop/sales-forecast.png`
- `locked/desktop/supplier-board.png`
- `locked/desktop/inventory-provision.png`
- `locked/desktop/fba-freight.png`
- `locked/desktop/admin-settings.png`
- `locked/desktop/modal-open-state.png`

## Mobile Screenshots

- `locked/mobile/home-shell-mobile.png`
- `locked/mobile/sales-dashboard-mobile.png`
- `locked/mobile/sales-forecast-mobile.png`
- `locked/mobile/supplier-board-mobile.png`
- `locked/mobile/inventory-provision-mobile.png`
- `locked/mobile/fba-freight-mobile.png`

## Capture Notes

- The desktop shell screenshots intentionally include both expanded text navigation and collapsed icon navigation.
- `modal-open-state.png` uses the supplier detail modal because it exercises the shared modal backdrop, dialog shell, form controls, and footer action layout.
- The modal screenshot was captured from a temporary browser DOM state with `#supplier-detail-modal` visible; no source files were changed to create this state.
- Local startup emitted expected Lingxing credential warnings for scheduled warmup jobs because the capture runtime used mock data without production Lingxing credentials. The page itself rendered successfully for baseline capture.

## Acceptance

Generated CSS must visually match these screenshots before `styles.css` is rebuilt.

The next phase may create `generated/desktop/*` and `generated/mobile/*` screenshots for side-by-side parity checks.

# Visual Parity Findings

## Shell

Preview CSS was generated with:

```bash
ALLOW_CSS_REBUILD=1 npm run build:css -- --output /tmp/tanjia-generated-preview.css
```

`styles.css` and `/tmp/tanjia-generated-preview.css` have the same SHA-256 hash:

```text
116a2f2b05ed3f68fb463c24bb2ad6fc698d8bdf38ef5439d5af1d312b3b1771
```

Because the generated preview is byte-identical to the current checked-in `styles.css`, the shell/sidebar/topbar source CSS already reproduces the locked baseline. No shell CSS source changes were required for this parity pass.

| State | Mismatch | Source File | Resolution |
| --- | --- | --- | --- |
| home-shell-expanded | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/layout/10-shell.css`, `assets/css/legacy/98-shell-topbar-parity.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| home-shell-collapsed | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/layout/10-shell.css`, `assets/css/legacy/98-shell-topbar-parity.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| home-shell-mobile | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/layout/10-shell.css`, `assets/css/legacy/98-shell-topbar-parity.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |

## Evidence

- Generated desktop expanded screenshot: `generated/desktop/home-shell-expanded.png`
- Generated desktop collapsed screenshot: `generated/desktop/home-shell-collapsed.png`
- Generated mobile screenshot: `generated/mobile/home-shell-mobile.png`
- Browser state check: `http://127.0.0.1:4173/`, title `探嘉数据分析系统`, active view `view-home`, app console logs empty.
- Browser runtime emitted one external Statsig network timeout from the Codex browser environment; it was not present in the app console log list and is not an application issue.

## Core Pages

Preview CSS was regenerated before this pass and remained byte-identical to checked-in `styles.css`:

```text
116a2f2b05ed3f68fb463c24bb2ad6fc698d8bdf38ef5439d5af1d312b3b1771
```

Because the generated preview is byte-identical to the current checked-in `styles.css`, the core page source CSS already reproduces the locked baseline. No component, page, or legacy CSS changes were required for this parity pass.

| State | Mismatch | Source File | Resolution |
| --- | --- | --- | --- |
| sales-dashboard | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, `assets/css/pages/22-sales-dashboard.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| sales-forecast | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, `assets/css/pages/25-sales-forecast.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| supplier-board | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, `assets/css/pages/53-supplier-board.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| inventory-provision | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, `assets/css/pages/55-inventory-provision.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| fba-freight | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, `assets/css/pages/35-fba-freight.css`, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| admin-settings | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, page CSS, `assets/css/legacy/current.css` | Captured generated-preview screenshot for evidence; no CSS change |
| modal-open-state | None observed; generated CSS is byte-identical to `styles.css` | `assets/css/components/*`, supplier detail page CSS, `assets/css/legacy/current.css` | Opened via the real `#supplier-detail-open-modal` button and captured generated-preview screenshot; no CSS change |

Core generated-preview screenshots:

- `generated/desktop/sales-dashboard.png`
- `generated/desktop/sales-forecast.png`
- `generated/desktop/supplier-board.png`
- `generated/desktop/inventory-provision.png`
- `generated/desktop/fba-freight.png`
- `generated/desktop/admin-settings.png`
- `generated/desktop/modal-open-state.png`
- `generated/mobile/sales-dashboard-mobile.png`
- `generated/mobile/sales-forecast-mobile.png`
- `generated/mobile/supplier-board-mobile.png`
- `generated/mobile/inventory-provision-mobile.png`
- `generated/mobile/fba-freight-mobile.png`

Browser state check: `http://127.0.0.1:4173/`, title `探嘉数据分析系统`, final active view `view-fba-freight`, no horizontal document overflow at `390x844`, app console logs empty.

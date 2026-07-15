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

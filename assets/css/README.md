# CSS Source Layers

The single CSS target is generated `styles.css` from `assets/css/*`.

Temporary visual lock:

- Current generated CSS from `assets/css/*` does not yet reproduce the approved sidebar/topbar visual baseline.
- `styles.css` is temporarily locked to prevent accidental visual regressions while the layered source catches up.
- Do not hand-edit `styles.css`.
- Do not run `npm run build:css` to overwrite `styles.css` until generated CSS has been screenshot-verified against the locked visual baseline.
- `npm run build:css -- --check` and `scripts/check-css-standards.js` intentionally skip modern CSS structure gates while this visual lock is active.
- Use `ALLOW_CSS_REBUILD=1 npm run build:css` only after a reviewed visual-parity migration.

Layer order:

1. `tokens/`
2. `base/`
3. `layout/`
4. `components/`
5. `pages/`
6. `legacy/`

Files within each layer are concatenated alphabetically. Use numeric prefixes when order matters.

Keep new CSS in the first five layers. `legacy/current.css` is the temporary source for the existing large stylesheet and should shrink as selectors are moved into named layers.

Modern target:

- `styles.css` must match the minified concatenation of `assets/css/{tokens,base,layout,components,pages,legacy}`.
- `legacy/current.css` should shrink toward zero as selectors move into named component/page layers.
- New or migrated rules should use semantic tokens from `tokens/`.
- Shared primitives belong in `components/`; shell/sidebar/topbar rules belong in `layout/`; feature-only rules belong in `pages/`.
- Modern CSS gates should be re-enabled after generated CSS reaches browser-verified visual parity with the locked baseline.

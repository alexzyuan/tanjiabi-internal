# CSS Source Layers

The single CSS target is generated `styles.css` from `assets/css/*`.

Visual baseline:

- `styles.css` is generated from `assets/css/*`.
- Do not hand-edit `styles.css`.
- Run `npm run build:css` after changing CSS source files.
- Browser screenshot verification is required for shell, sidebar, topbar, filters, tables, and modal changes.

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
- Modern CSS gates stay enabled; screenshot evidence under `docs/visual-baseline/` is the regression baseline for visual changes.

# Repository UI Rules

## Default Design System

Adobe React Spectrum is the default design system for all new UI work in this repository.

Official sources:

- Repository: https://github.com/adobe/react-spectrum
- Documentation: https://react-spectrum.adobe.com/

Follow these rules:

1. Use Spectrum interaction, accessibility, spacing, typography, state and responsive behavior as the default.
2. Preserve established product-specific layout decisions documented in `design.md`.
3. The current frontend is native HTML, CSS and JavaScript. Use the semantic tokens and native component mappings in `design.md`; do not add isolated React islands.
4. If the frontend is migrated to React, use `@adobe/react-spectrum` with a root `Provider` and `defaultTheme`.
5. Prefer semantic controls, visible labels, keyboard access and `:focus-visible` states. Do not replace accessible native controls with non-semantic `div` interactions.
6. New colors, spacing, radii and control sizes must use the semantic tokens documented in `design.md` and implemented in `styles.css` instead of one-off literals.
7. Do not copy source code or private implementation details from the React Spectrum repository. Use the public package and documented APIs.

## Structure And Module Boundaries

This project is a native HTML/CSS/JS application. The frontend has been partially split out of the former `app.js` monolith into focused ES modules under `assets/js/*` and `assets/js/features/*`. New work must preserve that direction and must not move feature-specific logic back into `app.js`.

Before implementing any non-trivial feature or UI change, write down the intended structure in the working notes or response:

1. Which view, service, adapter, mapper, or UI utility owns the change.
2. Which existing function or CSS block will be extended.
3. Whether a reusable helper/component/token is needed.
4. Which files should not be touched.
5. How the change will be verified.

Default ownership:

- View markup stays in `index.html` until a planned frontend split is approved.
- `app.js` is the bootstrap/composition layer. It may wire shared dependencies and feature factories, but should not receive new feature-specific state machines, renderers, API loaders, or event binding blocks.
- Feature-specific frontend state, event binding, API loading and rendering stay in focused modules under `assets/js/features/*`.
- Shared frontend utilities stay in `assets/js/*` files such as `ui-utils.js`, `dashboard-loader.js`, `filter-controls.js`, `navigation-utils.js`, `sales-shell.js`, `table-sorter.js`, `date-utils.js`, `file-utils.js`, `image-url.js` and `fba-utils.js`.
- Shared formatting, parsing, table sorting and filter helpers must stay generic and not include feature-specific business rules.
- Visual rules stay in `styles.css` using Spectrum or project semantic tokens.
- The single CSS target is generated `styles.css` from `assets/css/*`. Current generated CSS does not yet reproduce the approved sidebar/topbar visual baseline, so `styles.css` is temporarily locked to prevent accidental regressions while the layered source catches up. Do not rebuild or hand-edit `styles.css` during unrelated work.
- For new CSS work, edit layered source files under `assets/css/*`. Only after screenshot-verified visual parity may a reviewed CSS baseline migration run `ALLOW_CSS_REBUILD=1 npm run build:css` and remove the visual lock. Do not append one-off rules to `styles.css`.
- API routing and auth stay in `server.js`.
- External API calls stay in `src/adapters/*`.
- Business composition stays in `src/services/*`.
- Field-name translation and metric mapping stay in mapper files such as `src/services/lingxingDashboardMapper.js`.

If a change would add a large new feature, prefer adding a focused module under `src/` for backend code and a focused feature module under `assets/js/features/` for frontend code instead of adding an unbounded block to `app.js`.

Current frontend module examples:

- Dashboard loaders and common async UI state: `assets/js/dashboard-loader.js`.
- Shared filter dropdowns and grouped multi-selects: `assets/js/filter-controls.js`.
- Navigation and sidebar behavior: `assets/js/navigation-utils.js`, `assets/js/features/sidebar-shell.js`.
- Feature surfaces: `assets/js/features/payables-dashboard.js`, `assets/js/features/supplier-detail.js`, `assets/js/features/knowledge-library.js`, `assets/js/features/fba-automation.js`, and related files.

## Refactor Checkpoints

After each small feature is working, do a local cleanup pass before finishing:

1. Remove duplicated selectors, formatting logic and one-off CSS.
2. Fold patch-only code into the nearest existing helper or feature section.
3. Check that state is initialized once and event listeners are not rebound repeatedly.
4. Check table rendering and filter updates for avoidable full-page work.
5. Keep unrelated refactors out of the task unless they are needed for stability.

When the user asks for repeated detail adjustments in the same area, proactively suggest or perform a scoped cleanup of that feature before adding another patch.

## Design Tokens And Reusable UI

Use `design.md` as the source of truth for UI decisions. For new or changed UI:

1. Reuse existing semantic tokens and component classes first.
2. Add new tokens only when the concept is reusable across pages.
3. Add feature-specific CSS only when it cannot reasonably be expressed as a shared component or token.
4. Prefer improving a shared component class over adding page-only overrides.
5. Document reusable visual patterns in `design.md` when they become part of the product language.

## Frontend Verification

Before claiming a frontend task is complete, run browser-based verification when the change affects layout, interactions or rendered data. Prefer the in-app browser or Chrome DevTools MCP when available; otherwise use Playwright against a local server.

Minimum checks:

1. The target view renders without console errors.
2. The changed controls can be used with mouse and keyboard.
3. Text does not overlap or overflow at desktop and narrow widths.
4. Relevant requests contain the expected query/body fields.
5. Screenshots or DOM checks confirm the UI state that was changed.

For complex components, create an isolated component preview harness as a temporary local page or route, render only the target component/state, inspect layout and DOM there, then remove the harness before final delivery unless the user asks to keep it.

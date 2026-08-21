# G4A — Frontend Shared Filter State + Feature Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical, shareable frontend filter context and an explicit feature registry, then connect the sales and operating-monthly-report surfaces without changing backend data behavior.

**Architecture:** Keep state/URL semantics in `assets/js/shared-filter-state.js`, feature capabilities in `assets/js/feature-registry.js`, and inject both from `app.js`. Existing feature modules remain owners of their DOM and API behavior. The registry distinguishes page context support from API query forwarding so unsupported fields are reported rather than silently discarded.

**Tech Stack:** Native ES modules, Node test runner, existing native HTML/CSS/JS frontend. No CSS changes are expected.

**Spec:** [docs/superpowers/specs/2026-08-21-g4a-shared-filter-state-design.md](../specs/2026-08-21-g4a-shared-filter-state-design.md)

## Global Constraints

- Do not modify Sales Facts, inventory caches, backend routes, or database schemas.
- Do not move feature-specific state into `app.js`.
- Preserve existing API query contracts; only explicitly declared `queryFilters` are forwarded.
- Fail fast on malformed recognized state and expose omitted-field diagnostics.
- Do not hand-edit generated `styles.css`; do not run narrow/mobile tests.

## Tasks

- [x] **Task 1 — Define the shared state contract and RED tests**
  - Files: add `test/sharedFilterState.test.js`; add the approved design/spec if not already present.
  - Write failing tests for canonical normalization, malformed dates/SIDs/currency, URL round trips, comma/repeated list decoding, unknown query preservation, and history updates.
  - Run `node --test test/sharedFilterState.test.js`; confirm the new module is missing and the tests fail for the expected reason.

- [x] **Task 2 — Implement the shared state module (GREEN)**
  - Files: add `assets/js/shared-filter-state.js`.
  - Implement `normalizeSharedFilterState`, `encodeSharedFilterState`, `decodeSharedFilterState`, `createSharedFilterStateStore`, and the documented error type.
  - Keep the URL writer limited to canonical keys and preserve unrelated parameters.
  - Run the targeted test until green, then refactor only for clarity.

- [x] **Task 3 — Define the feature registry with RED → GREEN tests**
  - Files: add `test/featureRegistry.test.js`; add `assets/js/feature-registry.js`.
  - Test duplicate/unknown definitions, strict unsupported-context errors, query projection, and explicit omitted-key diagnostics.
  - Export the initial sales and monthly-report definitions.
  - Run targeted registry and shared-state tests until green.

- [x] **Task 4 — Integrate the shared store into existing frontend composition**
  - Files: `app.js`, `assets/js/sales-shell.js`, `assets/js/front-shop-filters.js`, `assets/js/features/store-operating-monthly-report.js`, and their focused tests.
  - Inject one shared store and registry from `app.js`.
  - Hydrate desktop sales/monthly filters from canonical URL state, update the store on filter changes, and use registry query projections while retaining current API parameter names.
  - Add regression tests for URL hydration, query compatibility and non-forwarded diagnostics.
  - Run the affected feature tests; no CSS changes.

- [x] **Task 5 — Desktop browser verification and cleanup**
  - Start the local app with the existing test configuration and verify sales and monthly-report filter changes update the URL and reload with the same context; inspect console and network request parameters.
  - Do not run narrow/mobile viewport tests.
  - Remove temporary browser artifacts and perform a duplication/refactor pass.

- [x] **Task 6 — Full verification and branch handoff**
  - Run `npm test`, `npm run check`, `git diff --check`, and the focused tests again.
  - Confirm `main` remains untouched, commit the feature branch, and report the branch/commit. Do not merge, push or deploy until separately requested.

### Verification notes

- Desktop Playwright verification confirmed URL hydration for sales review and the operating monthly report. Sales review retained date, country, store, currency and URL owner context; the monthly report retained its supported date, country, store and currency context and reported unsupported owner context through the registry projection.
- The local browser run intentionally used the repository's no-credentials environment. Expected upstream 502/row-visibility 400 responses were visible and logged; no frontend exception or silent state loss occurred.
- `npm test`: 1246 tests passed, including the generated CSS browser check.
- `npm run check`: passed; `git diff --check`: passed.

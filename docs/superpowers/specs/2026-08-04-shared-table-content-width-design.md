# Shared Table Content Width Design

## Goal

Managed BI tables should size themselves to their resolved column widths instead of being expanded to the full width of the content container. Tables that are wider than their container must continue to scroll inside their existing table wrapper.

## Scope and ownership

- `assets/css/components/45-table-controls.css` owns the shared table sizing presentation.
- `assets/js/data-table-manager.js` owns the resolved table width derived from managed `colgroup` widths.
- `test/dataTableManager.test.js` covers width resolution and resize behavior.
- `test/stylesStructure.test.js` or a focused CSS assertion covers the shared sizing rule.
- No page markup, feature module, API route, or business table renderer should be changed.

## Behavior

1. Ordinary `standard` tables use their smart column-width sum and no longer inherit a universal 980px minimum.
2. `wide` tables retain a 1280px minimum and `matrix` tables retain a 2400px minimum.
3. The resolved width is the maximum of the smart/user column-width sum and the variant minimum.
4. The CSS table width uses the resolved width directly; it must not use `max(100%, ...)`.
5. When a user drags a column, the manager recalculates the total from all managed columns and updates `--tj-table-resolved-width` before overflow hints are refreshed.
6. Re-enhancement, dynamic row refresh, and restore-smart-width all recompute the same resolved width deterministically.
7. Existing browser-local saved widths, stable identities, sticky offsets, sorting, and wrapper-owned horizontal scrolling remain unchanged.

## Error handling and observability

The manager must fail visibly for invalid table structure as it does today. Width recalculation should emit the existing `[data-table-manager]` structured diagnostic when width debugging is enabled, including the table key, variant, resolved width, and column count. It must not silently fall back to page-specific widths.

## Testing and verification

- Add a failing unit test proving a standard table resolves to its column-width sum rather than the wrapper width.
- Add tests for wide/matrix minimums and for a drag updating the resolved width.
- Run the focused data-table tests, CSS build/check, and the full Node test suite.
- Run the app in a browser and verify the flow: table view loads → a short table remains content-width → a wider table scrolls inside its wrapper → a column drag changes total table width → reload preserves the user width. Check desktop and narrow viewports, with no console errors or page-level horizontal overflow.

## Non-goals

- No changes to table content, sorting, filtering, or data loading.
- No new per-page width overrides.
- No cross-device width synchronization.

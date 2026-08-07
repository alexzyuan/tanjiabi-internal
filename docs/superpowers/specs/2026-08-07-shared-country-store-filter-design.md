# Shared Country And Store Filter Design

## Goal

Make country and store multi-select filters follow one reusable rule: country appears before store, both controls retain an explicit first all-option, and choosing countries selects every store in those countries.

## Scope

This change standardizes the shared interaction contract and applies it first to store operating monthly report. It does not change API query formats, seller authorization, date filters, currency behavior, or result rendering.

## Ownership

- `assets/js/filter-controls.js` owns the generic country-to-store selection projection and dropdown refresh. It accepts the two select elements plus the normalized store directory; it does not know page-specific selectors or load data.
- `assets/js/features/store-operating-monthly-report.js` owns the monthly report's store directory, binds its country and store events, and asks the shared helper to rebuild the store control.
- `index.html` owns the monthly report filter order and places country before store.
- `test/filterControls.test.js` owns shared interaction coverage. `test/storeOperatingMonthlyReportFeature.test.js` owns page wiring coverage.
- The backend, `app.js`, `assets/css/*`, and unrelated feature modules are out of scope unless verification finds an existing shared-contract test that needs an import update.

## Interaction Contract

Both controls are native multiple selects enhanced by the existing accessible dropdown surface.

| User action | Country selection | Store selection |
| --- | --- | --- |
| Initial state or selects all countries | First option `全部国家` selected | First option `全部店铺` selected |
| Selects one or more countries | Selected country values retained | Rebuilt to visible stores and every visible store selected |
| Changes from one country set to another | New country values retained | Rebuilt and every store belonging to the new country set selected |
| Clears explicit countries or chooses `全部国家` | First option selected | First option `全部店铺` selected |
| Changes stores directly | Unchanged | User's explicit store selection retained; first all-option reflects whether no concrete store is selected |

The first option is a real all-selection control, represented by value `""`. It is never submitted as a concrete country or store. Concrete selections always clear it; an empty concrete selection restores it.

## Data Flow

Each page normalizes its store directory into `{ value, label, country }` objects using existing mappings. When country changes, the feature reads selected concrete country values, calls the shared helper with the complete directory, and receives a rebuilt store select. The helper filters the directory by country, renders the existing `全部店铺` first option and country optgroups, selects all visible stores when a concrete country scope exists, or selects the all-option when there is no concrete scope. It then refreshes the existing enhanced dropdown so button summaries, checkbox state, keyboard behavior, and ARIA labels remain synchronized.

The monthly report retains its existing query construction. After the shared rule updates the store control, its existing query action reads concrete values only, so selected countries and their store set continue to reach the API using the established repeated `countries` and `stores` parameters.

## Error Handling And Observability

The shared helper throws when called without a country select, store select, or normalized store directory. It does not silently retain out-of-scope stores. Existing page status rendering remains responsible for API errors; this interaction performs no API request itself.

## Verification

1. Unit-test the shared helper for all-state, one-country, multi-country, and manual-store selection behavior.
2. Unit-test the monthly report feature to ensure a country change rebuilds and selects its matching stores.
3. Run the feature and shared-filter test files, then the full `npm test` suite.
4. Use the local browser to verify the monthly report displays country before store, both dropdowns show their all-option first, selecting a country checks matching stores, and the request contains the expected filters.
5. Check desktop and narrow screenshots for overflow or control-order regressions.

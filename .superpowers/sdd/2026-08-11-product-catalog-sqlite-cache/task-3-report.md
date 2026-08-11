# Task 3 Report: Shared Product Catalog Normalization

## Implementation

- Added `src/services/productCatalogNormalization.js` as the single, explicit whitelist for Listing and product field translation.
  - `normalizeCatalogListing` keeps SID/MSKU identity separate from ERP `local_sku`; `listingSku` is populated only from the local SKU value.
  - `normalizeCatalogProduct` preserves the existing declaration, image, supplier, price, nested-record, battery, and FBA packaging aliases without returning `raw`, tokens, or arbitrary upstream fields.
  - `mergeCatalogProduct` merges only named canonical fields.
  - `catalogProductToRepositoryRows` emits repository-ready product/listing rows and aliases, including `sourceField: "local_sku"` only for `listing_sku` aliases; Amazon seller SKU/MSKU is never emitted as a global alias.
- Added `src/services/listingSharedCatalogService.js` for Listing shared-catalog XLSX ownership.
  - Preserves configured-file support, sorted `.xlsx` enumeration, AppleDouble exclusion, all-sheet `sheet_to_json({ defval: "" })`, missing-directory empty results, and legacy store/country/SID matching precedence.
- Refactored `src/services/sharedDataService.js` to consume and re-export the focused normalization/XLSX interfaces while retaining existing catalog map, cache, API lookup, and fallback behavior. It no longer owns field alias arrays or XLSX path discovery.
- Added focused compatibility and security tests in `test/productCatalogNormalization.test.js` for declaration/FBA packaging, raw-field exclusion, Listing identity semantics, repository-row provenance, XLSX matching, and missing-directory behavior.

## RED

Command:

```text
node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js
```

The new normalization test failed before implementation with `ERR_MODULE_NOT_FOUND` for `src/services/productCatalogNormalization.js`; the existing shared-data suite remained green (9 tests), confirming the intended missing-module red state.

## GREEN

Commands:

```text
node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js test/fbaCatalogService.test.js
npm run check:js
git diff --check
node --test test/*.test.js
```

Results:

- Targeted normalization/shared-data/FBA run passed 23/23 tests.
- JavaScript syntax checks completed successfully.
- `git diff --check` completed with no whitespace errors.
- Repository-wide Node test run passed 769/769 tests.

## Compatibility verification

- Existing `buildSharedProductCatalogMap` declaration, nested customs, battery code, Listing local-SKU fallback, multi-index merge, cache, concurrency, and Listing shared-XLSX fallback tests all pass unchanged.
- Existing `fbaCatalogService` runtime-directory and packaging behavior tests pass unchanged.
- A repository smoke check confirmed `catalogProductToRepositoryRows` can be passed directly to `upsertCatalog`, including the validated `listing_sku` provenance marker.

## Self-review

- Touched only the brief-owned normalization, Listing shared-catalog, shared-data facade, focused test, and task report files.
- No database writes, migration logic, API routing, or FBA service ownership was added.
- Normalized outputs are explicitly enumerated; no upstream `raw` record is carried into a catalog product/listing or repository row.
- Shared-data behavior still permits the legacy cache read path; this task intentionally does not switch persistence or implement migration.

## Concerns

- `catalogProductToRepositoryRows` uses caller-provided source timestamps when available and deterministic `0` defaults for compatibility; Task 4/5 orchestration should pass the actual Lingxing source and refresh timestamps before repository writes.
- The compatibility context fields on normalized Listings are explicit enumerable whitelist fields so spread/JSON consumers retain the required scope and provenance context.

## Review fix round 1

### Regression coverage added

Updated the brief-owned tests in `test/productCatalogNormalization.test.js` and `test/sharedDataService.test.js` to cover each review finding:

- A Listing containing only `local_sku` is rejected as missing Amazon MSKU; an ERP `sku`/`product_sku` fallback remains internal-only and cannot create a `listing_sku` alias.
- Legacy `photo` image input survives normalization; canonical products expose enumerable `sku`/`asin`, while repository product rows explicitly omit `asin`.
- Missing-SKU product records are skipped by `buildSharedProductCatalogMap` rather than throwing.
- Shared XLSX rows require an internal SKU, and one no-SID row produces independent clones for separate SID/store scopes without identity bleed.
- Required Listing context/provenance fields survive object spread and JSON serialization without `raw`, token, or arbitrary upstream keys.
- Configured XLSX file selection, sorted/all-sheet reading, `sheet_to_json({ defval: "" })`, and missing-directory semantics remain covered.
- Nested packaging values are cloned through the dimensions/weight whitelist only.

### RED

Command run after adding the review regressions and before production fixes:

```text
node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js
```

Key output: 24 tests, 17 passed, 7 failed. Failures covered local-SKU MSKU fallback/provenance, `photo`/`sku`/`asin`, packaging token leakage, missing-SKU product TypeError, and shared XLSX scope identity/cloning. The XLSX fixture initially required the test-only `XLSX.set_fs(fs)` setup; after that fixture correction the intended production failures remained RED.

### GREEN

Production fixes were limited to the normalization module, focused Listing shared-catalog service, and shared-data facade:

- `LISTING_MSKU_KEYS` no longer treats `local_sku` as MSKU; `readFirstWithKey` tracks the actual internal-SKU source and only local-SKU provenance creates `listing_sku` with `sourceField: "local_sku"`.
- Normalized compatibility context is enumerable and explicitly whitelisted; canonical product `sku`/`asin` are retained, while the repository product-row mapper remains explicit and excludes `asin`.
- Product-map normalization filters null products; shared XLSX matching filters unusable rows and clones each match before scope enrichment; packaging clones copy only named fields.
- The XLSX reader configures the `xlsx` filesystem adapter while retaining existing file enumeration, all-sheet parsing, and empty-directory behavior.

Commands and results:

```text
node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js
# 24 passed, 0 failed

node --test test/productCatalogNormalization.test.js test/sharedDataService.test.js test/fbaCatalogService.test.js test/productCatalogRepository.test.js
# 46 passed, 0 failed

npm run check:js
# passed

git diff --check
# passed

node --test test/*.test.js
# 777 passed, 0 failed
```

### Compatibility validation and self-review

- `sharedDataService.js` still re-exports the focused normalization and XLSX functions, preserving existing import paths and public behavior.
- Listing shared-catalog mechanics (configured file, all sheets, `defval`, AppleDouble exclusion, sorted enumeration, missing-directory empty result, and matching precedence) remain unchanged except for the required internal-SKU gate and per-scope clone safety.
- No database writes, persistence changes, migrations, or FBA packaging-reader changes were introduced.
- Review scope is limited to the three production modules, their two focused test files, and this report. `git diff --check` is clean and the full suite is green.

### Concerns

- The legacy report's initial 769-test baseline remains historical; this fix round adds eight regression tests and the current full suite is 777/777.
- `listing_sku` provenance is intentionally empty when internal SKU came from generic `sku`/`product_sku`; downstream Task 4/5 code must only construct the validation alias when `listingSkuSourceField`/`internalSkuSourceField` identifies `local_sku`.
- FBA service ownership and SQLite persistence/migration remain outside this task as required.

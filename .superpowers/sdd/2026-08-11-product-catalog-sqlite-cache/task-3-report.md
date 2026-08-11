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
- The compatibility context fields on normalized Listings are non-enumerable so the concise canonical Listing shape remains stable; shared-data and repository-row consumers access them explicitly.

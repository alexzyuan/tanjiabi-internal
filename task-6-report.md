# Task 6 Report — SQLite-backed shared product-catalog facade

## RED

Added `test/productCatalogConsumerReuse.test.js` before changing the facade and ran:

```text
node --test test/productCatalogConsumerReuse.test.js
```

The old row-set facade failed 3/4 cases: `[A]` then `[A,B]` fetched `A` again and wrote the legacy cache, `allowFetchMissing:false` still called Lingxing instead of returning 422, and aliases were rebuilt as separate row-set objects.

## GREEN

- `getSharedProductCatalogMap()` now delegates normal lookups to `getProductCatalogForRows()` and forced lookups to `refreshProductCatalogScope()`.
- Canonical Task 5 records are converted into request-local compatibility aliases only; SID+MSKU remains the persisted identity. Legacy shared/supplier product-map writers are no longer imported by the facade, and cache-store writer exports are marked deprecated for rollback tooling.
- Empty consumer scopes remain a no-op with revision metadata; malformed non-array scopes still use Task 5 validation errors.
- Candidate and freight regressions seed the same SQLite repository and prove Listing/product APIs are not called.

Verification:

```text
node --test test/sharedDataService.test.js test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js test/productCatalogConsumerReuse.test.js  # 49 passed
node --test test/productCatalogIdentity.test.js test/productCatalogNormalization.test.js test/productCatalogRepository.test.js test/productCatalogLegacyMigration.test.js test/productCatalogService.test.js test/lingxingCatalogLookupService.test.js test/sellerDirectoryService.test.js  # 69 passed
node --test test/*.test.js  # 809 passed, 0 failed
npm run check:js  # passed
git diff --check  # passed
```

## Concerns / follow-up

- Task 5 manual-refresh metadata does not expose `productFetchedCount`; facade metrics record the successful refresh's product lookup as one batch when that field is absent. Normal lookup uses the canonical count directly.
- `cacheStore.js` retains deprecated JSON read/write exports for migration/rollback compatibility. Supplier-board runtime removal is owned by Task 7.

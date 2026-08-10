# Sales Review Cache Guard Design

## Goal

Prevent a sales-review cache created by an older response shape from rendering a missing `30d` refund rate as an apparently valid empty value.

## Scope

- `src/services/dashboardService.js` owns the sales-review source-cache contract.
- `scripts/deploy-integrity.js` owns the authenticated production smoke check.
- `test/salesWeeklySourceCache.test.js` and `test/deployIntegrity.test.js` cover the contracts.
- The Lingxing adapter, frontend renderer, CSS, and unrelated dashboard caches are out of scope.

## Cache Contract

The sales-review source cache moves to `sales-weekly-source-v3`. A cache entry is usable only when its scope uses that version and it contains both `recent30OrderProfitRecords` as an array and `raw.recent30` with the requested 30-day range and numeric record count. Missing or malformed fields are treated as an invalid cache entry, logged with the cache key and validation reason, and never mapped as an empty data set.

## Deployment Smoke Check

`deploy-integrity.js` will authenticate using deployment-only environment variables already loaded from the server `.env`, request the sales-review API for an explicit date range, and require every returned detail row to declare `refundRate30d`. A missing credential, non-success response, absent detail row array, or missing field fails deployment. Credentials are never printed or stored in the package manifest.

## Verification

Tests first prove that an old/malformed sales-review cache is rejected and that the deployment checker rejects an API payload without `refundRate30d`. The full project check and test suite run before merge. The production deploy then runs the guarded package workflow and confirms the authenticated smoke result.

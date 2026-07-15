# Page Open Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve page open speed by making heavy backend paths observable first, then adding shared cache, in-flight coalescing, and default-view warmup where evidence shows repeated work.

**Architecture:** Keep feature modules owning their business response shapes. Put generic performance measurement in `src/utils/performanceMetrics.js`, keep Lingxing catalog request counters in `src/services/lingxingCatalogLookupService.js`, and expose aggregate timings through existing service meta/logs before adding new caching behavior.

**Tech Stack:** Node.js ESM, native `node:test`, existing JSON file caches, existing Node HTTP server.

---

## File Structure

- Create `src/utils/performanceMetrics.js`: small timing/counter helper with no business rules.
- Create `test/performanceMetrics.test.js`: verifies metric duration, counters, and structured summary behavior.
- Modify `src/services/lingxingCatalogLookupService.js`: increment request counters for Listing and product-management calls.
- Modify `src/services/sharedDataService.js`: include shared product catalog performance metadata and logs.
- Modify `package.json`: include new utility in syntax checks if needed.
- Do not touch `styles.css`, frontend layout, or Lingxing API payload semantics in this phase.

## Task 1: Performance Metrics Helper

**Files:**
- Create: `src/utils/performanceMetrics.js`
- Create: `test/performanceMetrics.test.js`

- [ ] **Step 1: Write failing tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createPerformanceMetrics } from "../src/utils/performanceMetrics.js";

test("performance metrics measure elapsed time and counters", async () => {
  const metrics = createPerformanceMetrics("shared-product-catalog", { now: (() => {
    const values = [100, 112, 140];
    return () => values.shift();
  })() });

  const result = await metrics.measure("listing", async () => {
    metrics.increment("lingxingRequests", 2);
    return "ok";
  });
  metrics.increment("rowCount", 3);

  assert.equal(result, "ok");
  assert.deepEqual(metrics.summary(), {
    scope: "shared-product-catalog",
    durationMs: 40,
    counters: { lingxingRequests: 2, rowCount: 3 },
    timings: { listingMs: 12 },
  });
});
```

- [ ] **Step 2: Run red test**

```bash
node --test test/performanceMetrics.test.js
```

Expected: fails because `src/utils/performanceMetrics.js` does not exist.

- [ ] **Step 3: Implement helper**

Add `createPerformanceMetrics(scope, { now = Date.now } = {})` with `increment`, `measure`, and `summary`.

- [ ] **Step 4: Run green test**

```bash
node --test test/performanceMetrics.test.js
```

Expected: pass.

## Task 2: Lingxing Catalog Request Counters

**Files:**
- Modify: `src/services/lingxingCatalogLookupService.js`
- Modify: `test/lingxingCatalogLookupService.test.js`

- [ ] **Step 1: Add failing test**

Add a test showing `fetchLingxingListingsBySidMskus()` increments `metrics.lingxingListingRequests` and `fetchLingxingProductRecords()` increments product request counters.

- [ ] **Step 2: Implement optional `metrics` parameter**

Increment counters around actual adapter calls only. Do not count cache hits or local normalization work as Lingxing requests.

- [ ] **Step 3: Run tests**

```bash
node --test test/lingxingCatalogLookupService.test.js test/performanceMetrics.test.js
```

Expected: pass.

## Task 3: Shared Product Catalog Observability

**Files:**
- Modify: `src/services/sharedDataService.js`
- Modify: `test/sharedDataService.test.js`

- [ ] **Step 1: Add tests for returned meta**

Verify `getSharedProductCatalogMap()` includes `performance.cacheHit`, `performance.rowCount`, and Lingxing request counters for both cache hit and refresh paths.

- [ ] **Step 2: Implement metrics wiring**

Use `createPerformanceMetrics("shared-product-catalog")` inside `getSharedProductCatalogMap()`. Pass the metrics object into listing/product fetch helpers. Return `performance: metrics.summary()` and log a concise `[shared-product-catalog] performance` line.

- [ ] **Step 3: Run targeted tests**

```bash
node --test test/sharedDataService.test.js test/lingxingCatalogLookupService.test.js test/performanceMetrics.test.js
```

Expected: pass.

## Later Tasks

Do these only after performance logs confirm repeated heavy work:

1. Add in-flight coalescing to `getSharedProductCatalogMap()` by cache key.
2. Add default-view warmup jobs for supplier board, inventory provision, and sales forecast.
3. Add process-level TTL cache for hot JSON cache reads where parsing large files is measurable.
4. Profile table render paths before changing frontend rendering strategy.

## Verification

Before commit and deployment:

```bash
npm test
npm run check
npm audit
```

Expected: all tests pass, check passes, and audit reports 0 vulnerabilities.

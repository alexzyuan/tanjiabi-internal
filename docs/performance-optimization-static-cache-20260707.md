# Static Asset Performance Optimization - 2026-07-07

## Scope

This pass focused on speed, memory use, and scalability in the current native HTML/CSS/JS application without introducing a framework or build tool.

Files reviewed:

- `server.js`
- `app.js`
- `assets/js/*`
- `assets/js/features/*`
- `src/services/*`
- existing `test/*.test.js`

Code intentionally changed by this performance pass:

- `server.js`
- `test/serverSecurity.test.js`

Documentation changed by this pass:

- `docs/performance-optimization-static-cache-20260707.md`
- `AGENTS.md`

## Scope Boundary And Non-Performance Change Noted

During review, an existing sales forecast export change was observed in `src/services/salesForecastService.js` with a corresponding test in `test/salesForecastService.test.js`:

- Export column: `货值统计`
- Current formula in code: `补货预计 × (单位采购成本 + 单位头程费用)`
- Related test: `销售预估导出按旺季预测扣总库存和在途，并使用采购成本加头程成本统计货值`

This calculation is a business metric change, not a performance optimization. It was not validated as part of this performance pass because the correct financial口径 depends on real business data and an owner decision. Before deploying or presenting this work as "performance-only", a business owner should validate whether the formula, source fields, currency assumptions, and edge cases are correct.

Open validation questions:

- Should `货值统计` use replenishment quantity, forecast quantity, or another inventory planning quantity?
- Should unit cost be `采购成本 + 头程成本`, purchase cost only, weighted average landed cost, or another finance-approved measure?
- Are currencies normalized before multiplication?
- How should missing, duplicate, or conflicting MSKU/SKU cost records be handled?
- Should negative replenishment estimates clamp to zero or remain visible?

## Bottlenecks Found

### 1. Static assets were read from disk on every request

`server.js` served `index.html`, `styles.css`, `app.js`, and `assets/*` through `serveStatic()`. The old implementation called `readFile(filePath)` for every GET request.

Impact:

- Speed: repeated disk reads on every app load and refresh.
- Memory: each request allocated a fresh `Buffer` for large bundles such as `styles.css`.
- Scalability: concurrent users requesting the same static assets caused repeated identical filesystem work.
- Network: unchanged assets always returned `200` with the full body because there was no `ETag` or `304 Not Modified` path.

### 2. Client-side long-cache was not safe for this project

The project recently had a deployment issue where an unverified `styles.css` broke layout. Because of that, long-lived browser caching is not appropriate yet.

Decision:

- Do not use long `max-age` for `html/js/css`.
- Use `Cache-Control: no-cache, must-revalidate` plus `ETag`.
- This keeps the browser required to revalidate, while allowing a cheap `304` when unchanged.

### 3. Other candidates were lower confidence for this pass

Additional areas worth future profiling:

- Table rendering and sorting on very large client-side tables.
- JSON-file backed services under concurrent writes.
- Large service computations such as inventory provision and sales forecast.

Those need domain-specific datasets to avoid optimizing synthetic cases. Static asset serving was selected because it is deterministic, easy to benchmark, and used by every page load.

## Root Cause

The server treated immutable-ish application bundles as ordinary files:

```js
const content = await readFile(filePath);
res.end(content);
```

There was no process-level cache, no cold-read coalescing, and no conditional response handling.

## Implemented Optimization

Implemented in `server.js`:

1. Added a process-level static file cache keyed by absolute file path.
2. Cache invalidation uses file `size` and `mtimeMs` from `stat()`.
3. Added weak `ETag` generation from size and mtime.
4. Added `If-None-Match` handling with `304 Not Modified`.
5. Added an 8 MB memory budget and LRU-style eviction using `Map` insertion order.
6. Added in-flight read coalescing so concurrent cold requests for the same file share one `readFile()`.
7. Kept `html/js/css` on `no-cache, must-revalidate` to avoid stale deployments.

Behavioral test added:

- `test/serverSecurity.test.js`
- Test name: `static assets use etag revalidation instead of sending unchanged bundles`

## Before / After Data

Benchmark environment:

- Local Node server spawned with `NODE_ENV=test DATA_PROVIDER=mock AUTH_ENABLED=false`.
- Each path fetched 180 times sequentially over loopback.
- Metric is wall-clock request time measured with `performance.now()`.
- This is a local microbenchmark; production gains should be validated with real traffic and network latency.

### Normal 200 responses

| Path | Before avg | After avg | Before p95 | After p95 | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/styles.css` | 0.637 ms | 0.504 ms | 1.553 ms | 1.201 ms | avg -20.9%, p95 -22.7% |
| `/app.js` | 0.246 ms | 0.226 ms | 0.372 ms | 0.401 ms | avg -8.1%, p95 noise |
| `/assets/js/ui-utils.js` | 0.260 ms | 0.217 ms | 0.567 ms | 0.616 ms | avg -16.5%, p95 noise |

The smaller JS p95 values are noisy because the files are small and loopback timing is sub-millisecond. The main deterministic win is avoiding repeated file reads and allocations.

### Revalidated `styles.css`

| Scenario | Status | Total body bytes over 180 requests | Avg | p50 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, no ETag path | 200 | 42,015,960 | 0.637 ms | 0.462 ms | 1.553 ms |
| After, `If-None-Match` | 304 | 0 | 0.132 ms | 0.115 ms | 0.247 ms |

The 304 path is the largest user-visible win after the first load: unchanged CSS no longer transfers the 233 KB body.

## Validation

Run:

```bash
npm run build:css -- --check
node --check server.js
node --test test/serverSecurity.test.js test/serverRoutesStructure.test.js
npm run check
npm test
```

Manual benchmark command used:

```bash
node --input-type=module <<'NODE'
// Spawn server.js with NODE_ENV=test DATA_PROVIDER=mock AUTH_ENABLED=false,
// fetch /styles.css, /app.js, and /assets/js/ui-utils.js 180 times,
// then fetch /styles.css with If-None-Match.
NODE
```

Expected behavioral checks:

- First `GET /styles.css` returns `200`, an `ETag`, and `Cache-Control: no-cache, must-revalidate`.
- Second `GET /styles.css` with `If-None-Match` returns `304` with an empty body.
- API auth behavior remains unchanged.

## Remaining Risk

- The cache still performs `stat()` per static request to preserve immediate file-change detection. This is intentional for deployment safety.
- For maximum production throughput, a reverse proxy or CDN should eventually serve static assets. This server-side cache is a low-risk improvement for the current single Node process.
- Large binary files are bounded by the 8 MB cache budget and can be evicted under pressure.

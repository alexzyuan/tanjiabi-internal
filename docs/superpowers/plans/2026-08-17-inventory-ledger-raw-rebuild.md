# Inventory Ledger Raw Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically archive Lingxing Amazon inventory-ledger detail reports on the 10th of each month and rebuild all inventory-provision history caches from `2025-10` through the previous month.

**Architecture:** A Lingxing adapter owns export-task creation, polling, URL renewal, and binary download. A focused raw-report service owns month planning, server-side archival, strict parsing, FIFO reconstruction, and all-or-nothing cache commits; an independent calendar job invokes it after the 10th at 02:00 Asia/Shanghai and persists retryable state. Existing inventory-provision rendering and cost-refresh paths remain consumers of the rebuilt cache and are not made responsible for report downloads.

**Tech Stack:** Node.js 22 ESM, native `node:test`, `node:zlib`, existing `xlsx` TSV reader, atomic JSON/file writes, existing `withJobLock`, Lingxing signed API adapter.

---

## File map and ownership

- Create `src/services/inventoryLedgerReportParser.js`: strict gzip/TSV decoding, header aliases, field validation, and normalized event records.
- Create `src/services/inventoryProvisionLedgerRebuilder.js`: pure event-to-FIFO-cohort reconstruction for all target months.
- Create `src/services/inventoryLedgerRawReportService.js`: seller/month planning, export polling, archival manifest, base-row metadata merge, rebuild orchestration, status, and structured logging.
- Create `src/jobs/inventoryLedgerRawRebuildJob.js`: Asia/Shanghai calendar gate, persisted job state, lock, retry behavior, and scheduler timer.
- Create `scripts/rebuild-inventory-ledger.js`: explicit server-side maintenance command for the first full rebuild or a reviewed force rebuild; it never exposes a browser download.
- Modify `src/adapters/lingxingAdapter.js`: add report-document URL renewal and binary download methods beside existing report task methods.
- Modify `src/utils/cacheStore.js`: add an injectable raw-report store and transactional history-cache commit helper while preserving existing cache APIs.
- Modify `src/services/inventoryProvisionService.js`: expose the existing age-bucket/FIFO primitives through a narrow pure interface or consume the new rebuilder without moving download logic into this service.
- Modify `src/config/index.js`: expose `INVENTORY_LEDGER_REBUILD_AT` with default `02:00`.
- Modify `routes/admin.js`, `routes/index.js`, and `server.js`: add a read-only admin status route and start the scheduler; do not add a raw-file route or UI button.
- Create `test/inventoryLedgerReportParser.test.js`, `test/inventoryProvisionLedgerRebuilder.test.js`, `test/inventoryLedgerRawReportService.test.js`, and `test/inventoryLedgerRawRebuildJob.test.js`; extend `test/lingxingAdapter.test.js` and `test/serverRoutesStructure.test.js`.
- Create `test/fixtures/inventory-ledger/2025-10.tsv` and `test/fixtures/inventory-ledger/2025-11.tsv` with a beginning balance, receipt, shipment, return, and a deliberately unknown event fixture for failure assertions.

Do not modify frontend modules, generated `styles.css`, cost-refresh business rules, Listing matching rules, or the unrelated dirty default worktree.

### Task 1: Lock the export/download adapter contract with failing tests

**Files:**
- Modify: `test/lingxingAdapter.test.js`
- Modify: `src/adapters/lingxingAdapter.js`

- [ ] **Step 1: Add request-contract tests.** Add tests beside the existing report-task tests that stub `performSignedRequest` and assert:

```js
await adapter.createReportExportTask({
  seller_id: "A-SELLER",
  report_type: "GET_LEDGER_DETAIL_VIEW_DATA",
  data_start_time: "2025-10-01T00:00:00Z",
  data_end_time: "2025-10-31T23:59:59Z",
  marketplace_ids: ["ATVPD"],
  region: "na",
});
await adapter.queryReportExportTask({ seller_id: "A-SELLER", task_id: "task-1", region: "na" });
await adapter.renewReportExportTask({ seller_id: "A-SELLER", report_document_id: "doc-1", region: "na" });
assert.deepEqual(calls.map(({ endpoint }) => endpoint), [
  "/basicOpen/report/create/reportExportTask",
  "/basicOpen/report/query/reportExportTask",
  "/basicOpen/report/amazonReportExportTask",
]);
```

Assert that no token, URL, or full external payload is put into the adapter log path. Add a download test using an injected `fetchImpl` that returns a non-empty `ArrayBuffer`, and a second test that rejects a non-2xx response and an empty body.

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run: `node --test test/lingxingAdapter.test.js`

Expected: FAIL because `renewReportExportTask` and the binary download method are not implemented.

- [ ] **Step 3: Implement the minimal adapter methods.** Keep signed JSON calls in `performSignedRequest`:

```js
renewReportExportTask(params = {}) {
  return this.signedRequest("/basicOpen/report/amazonReportExportTask", {
    method: "POST", params,
  });
}

async downloadReportDocument(url, { fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  const response = await fetchWithTimeout(fetchImpl, url, { method: "GET" }, timeoutMs);
  if (!response.ok) throw new Error(`库存分类账下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("库存分类账下载失败：报表文件为空。");
  return buffer;
}
```

Use the adapter's existing timeout helper or extract it to a shared private function; never print `url` query parameters or authorization values.

- [ ] **Step 4: Run the focused tests to verify they pass.**

Run: `node --test test/lingxingAdapter.test.js`

Expected: all adapter tests pass.

- [ ] **Step 5: Commit the adapter contract.**

Run: `git add src/adapters/lingxingAdapter.js test/lingxingAdapter.test.js && git commit -m "feat: support Lingxing inventory ledger report downloads"`

### Task 2: Add raw-report storage and transactional cache primitives

**Files:**
- Modify: `src/utils/cacheStore.js`
- Create: `test/inventoryLedgerRawStore.test.js`

- [ ] **Step 1: Write storage and rollback tests.** Use a temporary `data-cache` root injected into a store factory. Assert that a successful save writes `YYYY-MM/<seller-id>-<marketplace>.tsv.gz` and a manifest containing only safe metadata (`month`, seller ID, report type, task/document IDs, compression, byte count, SHA-256, fetchedAt, parsedRowCount). Assert that a failed staged history commit leaves the original month JSON byte-for-byte unchanged; assert a successful commit replaces all target months and preserves a non-target cache file.

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run: `node --test test/inventoryLedgerRawStore.test.js`

Expected: FAIL because the injectable store and transactional commit helper do not exist.

- [ ] **Step 3: Implement `createInventoryLedgerRawReportStore`.** Add a factory with this interface:

```js
createInventoryLedgerRawReportStore({ dataDir = path.join(process.cwd(), "data-cache") } = {}) => ({
  readManifest(month, scopeKey),
  saveReport({ month, scopeKey, extension, bytes, manifest }),
  readReport({ month, scopeKey, extension }),
  listManifests(months),
  readJobState(),
  writeJobState(state),
  commitInventoryProvisionHistoryBatch({ entries, targetMonths }),
});
```

Use `writeJsonAtomic`, temporary files, SHA-256, and a staging directory under the same `data-cache` parent. The history commit must stage all target JSON files, validate that every staged entry has a non-empty `data.rows` array or an explicit empty result, rename the live directory to a timestamped backup, rename staging into place, and restore the backup if the second rename fails. Preserve existing `saveInventoryProvisionHistoryCache` and `readInventoryProvisionHistoryCache` behavior for normal callers.

- [ ] **Step 4: Run storage tests and inspect the diff.**

Run: `node --test test/inventoryLedgerRawStore.test.js && git diff --check`

Expected: all storage tests pass and `git diff --check` is clean.

- [ ] **Step 5: Commit the storage boundary.**

Run: `git add src/utils/cacheStore.js test/inventoryLedgerRawStore.test.js && git commit -m "feat: add atomic inventory ledger report storage"`

### Task 3: Build a strict raw report parser

**Files:**
- Create: `src/services/inventoryLedgerReportParser.js`
- Create: `test/inventoryLedgerReportParser.test.js`
- Create: `test/fixtures/inventory-ledger/2025-10.tsv`
- Create: `test/fixtures/inventory-ledger/2025-11.tsv`

- [ ] **Step 1: Add fixture-driven parser tests.** The fixture headers must include the Amazon/Lingxing detail names `event-date`, `msku`, `event-type`, `quantity`, `fulfillment-center`, `disposition`, `reference-id`, and `reason`. Include rows for `BeginningBalance`, `Receipts`, `CustomerShipments`, `CustomerReturns`, and `WarehouseTransferOut`. Assert normalized records contain ISO `date`, trimmed `msku`, numeric quantity, event type, seller scope supplied by the caller, and a stable source row number. Add tests for gzip input, UTF-8 BOM, missing required headers, invalid quantity, and an event outside the expected month.

- [ ] **Step 2: Run parser tests to verify they fail.**

Run: `node --test test/inventoryLedgerReportParser.test.js`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement parser normalization.** Export:

```js
parseInventoryLedgerReport(buffer, {
  compressionAlgorithm = "GZIP",
  expectedMonth,
  sellerId,
  marketplaceId,
  scopeKey,
}) => ({
  records,
  meta: { rowCount, expectedMonth, sellerId, marketplaceId, scopeKey },
});
```

Use `gunzipSync` only for `GZIP`, reject any other compression algorithm unless it is explicitly `NONE`, and parse the first worksheet with `xlsx` using raw values. Normalize headers by lowercasing, removing BOM, whitespace, `_`, and `-`; accept the documented aliases but require all seven canonical fields. Parse dates as the first ten characters of an ISO or `YYYY-MM-DD` value; reject invalid dates and dates not in `expectedMonth`. Parse quantity with `Number` and reject non-finite values. Do not discard an unknown event type here; preserve it for the FIFO layer to reject with a key and row number.

- [ ] **Step 4: Run parser tests to verify they pass.**

Run: `node --test test/inventoryLedgerReportParser.test.js`

Expected: all parser tests pass, including the explicit malformed-input failures.

- [ ] **Step 5: Commit the parser.**

Run: `git add src/services/inventoryLedgerReportParser.js test/inventoryLedgerReportParser.test.js test/fixtures/inventory-ledger && git commit -m "feat: parse Amazon inventory ledger detail reports"`

### Task 4: Implement pure FIFO reconstruction from normalized events

**Files:**
- Create: `src/services/inventoryProvisionLedgerRebuilder.js`
- Create: `test/inventoryProvisionLedgerRebuilder.test.js`
- Modify: `src/services/inventoryProvisionService.js` only to export or reuse the shared historical age helper if the new module cannot import it without a cycle.

- [ ] **Step 1: Write deterministic FIFO tests.** Use two months of events for `SID-1/MSKU-1`: an October beginning balance of 10, October receipt of 5, October shipment of 7, November receipt of 3, and November shipment of 4. Assert October cohorts are 8 from the opening cohort and November cohorts are 4 opening, 3 October receipt, and 2 November receipt after FIFO consumption. Assert a negative/unknown event type fails with `INVENTORY_LEDGER_EVENT_TYPE_UNSUPPORTED`. Assert rows with zero ending quantity are omitted and fractional quantities are retained without rounding to integers.

- [ ] **Step 2: Run the reconstruction tests to verify they fail.**

Run: `node --test test/inventoryProvisionLedgerRebuilder.test.js`

Expected: FAIL because the pure rebuilder does not exist.

- [ ] **Step 3: Implement the rebuilder.** Export:

```js
rebuildInventoryProvisionHistory({
  records,
  targetMonths,
  sellers,
  baseRowsByKey,
  nowText,
}) => ({
  entries: [{ month, data }],
  summary: { recordCount, rowCount, metadataFallbackRows, matchedRows },
});
```

Group records by `sellerId|marketplaceId|msku`, sort by date then `sourceRow`, and apply an explicit event map: `BeginningBalance` creates an opening cohort; `Receipts`, `CustomerReturns`, `WarehouseTransferIn`, and `Found` add stock; `CustomerShipments`, `WarehouseTransferOut`, `Lost`, `Damaged`, and `Disposed` consume oldest cohorts; `Other` uses the signed quantity and rejects zero/ambiguous values. Reject every non-empty event type outside this map instead of treating it as a receipt. At each target month end, snapshot positive cohorts and assign `cohortMonth`, `quantity`, and the existing six age-day values (`15/45/75/120/210/300`) using month distance.

For row metadata, first use the same-month cached row keyed by seller/MSKU, then the merged non-empty metadata from any target-month cache. Preserve `purchaseCost`, `firstLegCost`, `skuName`, and `listingOwner`; for a raw key with no cached metadata, use the report title if present, `listingOwner: "-"`, and record `metadataFallbackRows` in the summary. Do not call Listing, product-management, or any external API from this pure module. Attach `source: "amazon-inventory-ledger-raw"`, `rawCount`, `ledgerCount`, `reportStartDate`, `reportEndDate`, and `inventoryLedgerRebuiltAt` to each cache data object.

- [ ] **Step 4: Run the reconstruction tests to verify they pass.**

Run: `node --test test/inventoryProvisionLedgerRebuilder.test.js test/inventoryProvisionService.test.js`

Expected: new FIFO tests and all existing inventory-provision tests pass.

- [ ] **Step 5: Commit the pure reconstruction layer.**

Run: `git add src/services/inventoryProvisionLedgerRebuilder.js src/services/inventoryProvisionService.js test/inventoryProvisionLedgerRebuilder.test.js && git commit -m "feat: rebuild inventory provision cohorts from ledger events"`

### Task 5: Orchestrate monthly export, archival, validation, and rebuild

**Files:**
- Create: `src/services/inventoryLedgerRawReportService.js`
- Create: `test/inventoryLedgerRawReportService.test.js`

- [ ] **Step 1: Write service tests with injected dependencies.** Inject a fake adapter, seller-directory function, raw store, parser, rebuilder, and clock. Cover:

  - `targetMonths("2026-08")` returns `2025-10` through `2026-07`.
  - A missing month creates a task with `GET_LEDGER_DETAIL_VIEW_DATA`, exact month UTC bounds, one marketplace ID, and the correct `na/eu/fe` region.
  - `IN_QUEUE` then `IN_PROGRESS` then `DONE` polls until done, archives the bytes, parses once, and records a manifest.
  - A `DONE` response without a URL calls the renewal endpoint once and then downloads the renewed URL.
  - A fatal task, timeout, bad parser, or missing month stops before `commitInventoryProvisionHistoryBatch`; the old cache remains untouched.
  - A second non-force run reuses successful manifests and performs no export calls; `force: true` requests every target month again.
  - Two sellers with the same month produce two scoped files and their events do not merge.

- [ ] **Step 2: Run service tests to verify they fail.**

Run: `node --test test/inventoryLedgerRawReportService.test.js`

Expected: FAIL because the orchestration service does not exist.

- [ ] **Step 3: Implement target-month and seller-scope planning.** Use the approved fixed start month `2025-10`; derive the previous month from the injected `now` in `Asia/Shanghai`; reject a current-month target. Read the seller directory with `forceRefresh: true`, filter core sellers, and require a non-empty `seller_id`, `marketplaceId`, and country-to-region mapping (`US/CA -> na`, `DE -> eu`, `AU -> fe`). Do not infer a missing marketplace ID or seller ID from a store name.

- [ ] **Step 4: Implement task creation, polling, renewal, and archival.** For each seller/month scope, call:

```js
adapter.createReportExportTask({
  seller_id: seller.seller_id,
  report_type: "GET_LEDGER_DETAIL_VIEW_DATA",
  data_start_time: `${month}-01T00:00:00Z`,
  data_end_time: `${lastDay(month)}T23:59:59Z`,
  marketplace_ids: [seller.marketplaceId],
  region,
});
```

Poll every 5 seconds for at most 15 minutes. Accept only `IN_QUEUE`, `IN_PROGRESS`, and `DONE`; `FATAL`, `CANCELLED`, `UNKNOWN`, timeout, or malformed result throws an error with `runId`, month, seller ID, and stage. If `DONE` has no URL, call `renewReportExportTask` once with its document ID. Save the compressed bytes and manifest through the raw store, compute SHA-256 before writing, and parse immediately to record `parsedRowCount`. Log counts and durations but never report URLs, tokens, or full payloads.

- [ ] **Step 5: Implement all-month validation and atomic rebuild.** Load every target scope's successful manifest and parsed records; require one successful file for every seller/month pair, reject empty files, and reject records outside their manifest month. Read existing target history caches only as metadata sources, call `rebuildInventoryProvisionHistory`, then pass every generated entry to `commitInventoryProvisionHistoryBatch` in one call. Return `{ ok, runId, targetMonths, sellerCount, reportCount, parsedRowCount, rebuiltRowCount, committedMonths, fetchedAt, rebuiltAt }`.

- [ ] **Step 6: Add status and structured failure state.** Keep in-memory last-run data for the process and expose `getInventoryLedgerRawRebuildStatus()` with safe fields only. On failure, attach `stage`, `month`, `sellerId`, `runId`, and a short error message, rethrow, and leave old caches and successful manifests intact. Do not turn a failed report into a successful empty cache.

- [ ] **Step 7: Run service tests to verify they pass.**

Run: `node --test test/inventoryLedgerRawReportService.test.js`

Expected: all orchestration tests pass.

- [ ] **Step 8: Commit the orchestration service.**

Run: `git add src/services/inventoryLedgerRawReportService.js test/inventoryLedgerRawReportService.test.js && git commit -m "feat: archive and rebuild inventory ledger history"`

### Task 6: Add the monthly calendar job and maintenance command

**Files:**
- Create: `src/jobs/inventoryLedgerRawRebuildJob.js`
- Create: `scripts/rebuild-inventory-ledger.js`
- Create: `test/inventoryLedgerRawRebuildJob.test.js`
- Modify: `src/config/index.js`

- [ ] **Step 1: Write calendar and retry tests.** Assert with injected dates that Shanghai 2026-08-09 does not run, 2026-08-10 at 01:59 does not run, 02:00 runs for period `2026-07`, and a state with `lastSuccessfulPeriod: "2026-07"` skips. Assert a failed run persists `lastAttemptPeriod`, `lastStatus: "failed"`, and `lastError`, while the next call retries. Assert `withJobLock` prevents a concurrent second run.

- [ ] **Step 2: Run job tests to verify they fail.**

Run: `node --test test/inventoryLedgerRawRebuildJob.test.js`

Expected: FAIL because the job module and config option do not exist.

- [ ] **Step 3: Implement the job and config.** Add `inventoryLedgerRebuildAt: readEnv("INVENTORY_LEDGER_REBUILD_AT", "02:00")` to `getConfig()`. Export:

```js
shouldRunInventoryLedgerRawRebuild({ now, state, runAt })
runInventoryLedgerRawRebuildIfNeeded({ force, now, runAt, rebuild, readState, writeState, lockRunner })
startInventoryLedgerRawRebuildScheduler({ intervalMs: 5 * 60 * 1000, runAt })
```

Use `Asia/Shanghai`, `withJobLock("inventory-ledger-raw-rebuild", ..., { ttlMs: 6 * 60 * 60 * 1000 })`, and `data-cache/inventory-ledger-raw/job-state.json`. Startup performs one calendar check; the timer repeats every five minutes. A successful period is keyed by the previous month, so a restart after success does not redownload it.

- [ ] **Step 4: Implement the explicit command.** `scripts/rebuild-inventory-ledger.js` imports the service and job lock, invokes `runInventoryLedgerRawRebuild({ force: process.argv.includes("--force") })`, prints the safe JSON summary, and sets `process.exitCode = 1` on failure. It must not start the HTTP server or expose a download path.

- [ ] **Step 5: Run job tests and syntax checks.**

Run: `node --test test/inventoryLedgerRawRebuildJob.test.js && node --check scripts/rebuild-inventory-ledger.js`

Expected: all job tests pass and the command parses.

- [ ] **Step 6: Commit the job and command.**

Run: `git add src/jobs/inventoryLedgerRawRebuildJob.js scripts/rebuild-inventory-ledger.js src/config/index.js test/inventoryLedgerRawRebuildJob.test.js && git commit -m "feat: schedule monthly inventory ledger rebuilds"`

### Task 7: Wire the scheduler and protected status route

**Files:**
- Modify: `routes/admin.js`
- Modify: `routes/index.js`
- Modify: `server.js`
- Modify: `test/serverRoutesStructure.test.js`

- [ ] **Step 1: Add route and wiring tests.** Assert `GET /api/admin/inventory-ledger/rebuild-status` has `admin` auth and calls the injected status function. Assert `server.js` imports and calls `startInventoryLedgerRawRebuildScheduler()` and passes the status dependency to `buildApiRoutes`. Assert no route contains a raw report file path or download handler.

- [ ] **Step 2: Run route tests to verify they fail.**

Run: `node --test test/serverRoutesStructure.test.js`

Expected: FAIL because the status route and scheduler wiring are absent.

- [ ] **Step 3: Implement the protected read-only route.** Add one `GET` admin route that returns `sendJson(res, 200, await getInventoryLedgerRawRebuildStatus())`. Wire the service import and scheduler start beside the other background jobs. Do not add a frontend fetch, button, or static file mapping.

- [ ] **Step 4: Run route tests and static checks.**

Run: `node --test test/serverRoutesStructure.test.js && npm run check:js`

Expected: route assertions and JavaScript syntax checks pass.

- [ ] **Step 5: Commit integration wiring.**

Run: `git add routes/admin.js routes/index.js server.js test/serverRoutesStructure.test.js && git commit -m "feat: expose inventory ledger rebuild status"`

### Task 8: Regression verification and local fixture run

**Files:**
- Modify: `README.md` only if the operational command or schedule needs documentation.
- Modify: `AGENTS.md` only if the new scheduled data-source contract changes repository guidance.

- [ ] **Step 1: Run focused tests.**

Run: `node --test test/lingxingAdapter.test.js test/inventoryLedgerRawStore.test.js test/inventoryLedgerReportParser.test.js test/inventoryProvisionLedgerRebuilder.test.js test/inventoryLedgerRawReportService.test.js test/inventoryLedgerRawRebuildJob.test.js test/inventoryProvisionService.test.js test/serverRoutesStructure.test.js`

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the complete test and check suites.**

Run: `npm test && npm run check && git diff --check`

Expected: the full repository test suite, CSS/browser verification, JavaScript/CSS checks, and whitespace checks pass.

- [ ] **Step 3: Run a local no-network fixture rebuild.** Use the service's injected fake adapter/store/parser against the October-November fixtures and assert the summary reports two committed months, the expected FIFO quantities, and a source timestamp distinct from any cost-refresh timestamp. Do not call a real Lingxing export task during tests or exploratory debugging.

- [ ] **Step 4: Review production preconditions without writing production data.** Confirm the deployed runtime has `better-sqlite3` installed, Lingxing credentials configured, writable `/opt/tanjia-bi/data-cache`, and the existing deployment guard. Do not execute the production rebuild or cost-refresh API in this verification step.

- [ ] **Step 5: Commit documentation and final verification.**

Run: `git status --short --branch && git log --oneline -8`

Expected: only the intended commits are present, the worktree is clean, and the final handoff can identify the exact commit before any package/deploy action.


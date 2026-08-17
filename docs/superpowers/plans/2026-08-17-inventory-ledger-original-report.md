# Inventory Ledger Exported Original Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild inventory-provision history only from Lingxing-exported Amazon inventory-ledger original report files, with no automatic JSON-API fallback.

**Architecture:** The adapter owns the export protocol and download. The raw-report service owns the report-task state machine, file-first archival and full atomic rebuild; the parser only accepts binary report files. A raw-report manifest proves source, integrity and lineage before the FIFO rebuilder sees events.

**Tech Stack:** Node.js ESM, `node:test`, `node:zlib`, existing atomic file helpers, Lingxing signed APIs.

---

## File map

- Modify `src/adapters/lingxingAdapter.js`: retain and test export-task creation, status query, document renewal and binary download.
- Modify `src/services/inventoryLedgerRawReportService.js`: replace direct detail-API fetch with the strict report-task state machine.
- Modify `src/services/inventoryLedgerReportParser.js`: make raw-file parsing the service input and remove JSON-API parsing from production composition.
- Modify `src/services/inventoryLedgerRawReportStore.js`: verify raw-file hash before reuse and persist file-source manifest metadata.
- Modify `test/lingxingAdapter.test.js`, `test/inventoryLedgerRawReportService.test.js`, `test/inventoryLedgerReportParser.test.js`, `test/inventoryLedgerRawReportStore.test.js`: regression coverage.
- Modify `docs/superpowers/specs/2026-08-16-inventory-ledger-raw-rebuild-design.md` and `AGENTS.md`: replace stale statement that the formal input is the detail API.

Do not modify `inventoryProvisionCostRefreshService`, Listing lookup code, frontend modules, `styles.css`, or historical cache files during implementation.

### Task 1: Lock the export state machine with failing tests

- [ ] Add a raw-rebuild service test with an adapter stub returning a task id, then `IN_QUEUE`, `IN_PROGRESS`, and `DONE` with a download URL. Assert report bytes are parsed as TSV, saved as `.tsv`/`.tsv.gz`, the manifest source equals `lingxing-exported-inventory-ledger-report`, and `fetchAllInventoryLedgerDetails` is never called.
- [ ] Run `node --test test/inventoryLedgerRawReportService.test.js`; verify the new test fails because current code calls the detail API.
- [ ] Add a second test in the same file where status is `UNKNOWN`; assert the operation rejects with seller/month/task context, commits no history cache, and does not call the detail API.
- [ ] Add a third test where `DONE` has no URL but includes `report_document_id`; assert `renewReportExportTask` supplies the URL before the binary download.

### Task 2: Implement only the tested export workflow

- [ ] In `src/services/inventoryLedgerRawReportService.js`, restore an explicit `fetchOrReuseReport` state machine: create `GET_LEDGER_DETAIL_VIEW_DATA`; poll only `IN_QUEUE`/`IN_PROGRESS`; accept only `DONE`; use the task URL or renewed document URL; download bytes; parse via `parseInventoryLedgerReport`; then archive.
- [ ] Ensure error messages include phase (`create`, `poll`, `renew`, `download`, `parse`, `archive`), month, seller and task id when known, but never report URL/token.
- [ ] Keep a source manifest reusable only when the source is `lingxing-exported-inventory-ledger-report`, its raw file exists and SHA-256 matches. JSON detail-API manifests must not be reused.
- [ ] Run `node --test test/inventoryLedgerRawReportService.test.js`; verify all focused raw-rebuild tests pass.

### Task 3: Make the parser and archive file-first

- [ ] Add a parser test asserting `parseInventoryLedgerReport` handles the exported TSV fixture and reports `eventTypeDescription` only when its source header exists.
- [ ] Run `node --test test/inventoryLedgerReportParser.test.js`; verify it fails before the parser change.
- [ ] Remove `parseInventoryLedgerApiRecords` from raw-rebuild imports/composition. Retain it only if another live feature imports it; otherwise remove the dead function and its test.
- [ ] In `inventoryLedgerRawReportStore`, add a test that modifies an archived file after its manifest is saved; reuse must fail with SHA-256 mismatch rather than parse changed bytes.
- [ ] Run `node --test test/inventoryLedgerReportParser.test.js test/inventoryLedgerRawReportStore.test.js`; verify it passes.

### Task 4: Update documentation and validate in a safe real run

- [ ] Update the previous raw-rebuild design, README/AGENTS source statements and date-rule references so they identify exported original report files as the formal source and direct detail API as diagnostics only.
- [ ] Run `node --test test/lingxingAdapter.test.js test/inventoryLedgerRawReportService.test.js test/inventoryLedgerReportParser.test.js test/inventoryLedgerRawReportStore.test.js` and `npm run check`.
- [ ] Run `git diff --check` and `npm test`.
- [ ] Commit only the implementation, tests and matching documentation.
- [ ] After deploy approval, execute one real `dryRun` export range. Do not call a JSON inventory endpoint for opening inventory and do not run the cache-writing full rebuild until the dry-run has returned a parseable original report file and the user separately authorizes writing the history cache.

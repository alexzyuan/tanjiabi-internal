# Inventory Provision Shipping Cost Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether caches written before `e2c4da5` incorrectly treated Lingxing `shipping_cost` as first-leg cost, and correct only a cache proven to be contaminated.

**Architecture:** Treat the historical inventory-provision cache and the daily clearance MSKU cache as separate data products. Historical inventory rows derive first-leg cost from FBA inventory-history/logistics or product-management cost fields; clearance recent-sales rows derive first-leg cost from normalized OrderProfit records. Audit both persisted stores without mutating them. If contamination is found, use the authoritative raw-ledger rebuild or the existing cache-version boundary with a verified backup; never delete or overwrite an unverified cache.

**Tech Stack:** Node.js 22+, existing JSON cache stores, Lingxing raw-ledger rebuild service, PM2 production runtime, SHA-256 deployment snapshots.

**Spec:** `AGENTS.md` Inventory Ledger Raw Rebuild and 店铺经营月报币种口径 rules; `docs/superpowers/plans/2026-08-22-production-hardening.md` Goal G0.

## Global Constraints

- `shipping_cost` is buyer shipping and must never populate `firstLegCost`.
- Historical rebuild input is the complete Lingxing `GET_LEDGER_DETAIL_VIEW_DATA` export; `/cost/center/ods/detail/query` is not a formal rebuild fallback.
- A dry-run performs the same retrieval, parsing, and FIFO validation as a commit and must not write caches.
- Any cache rewrite must preserve a verified backup and use an atomic, all-or-nothing commit.
- No production cache file is deleted or manually edited.

---

### Task 1: Trace the affected data paths

**Files:**
- Read: `src/adapters/lingxingAdapter.js`
- Read: `src/services/inventoryProvisionService.js`
- Read: `src/services/inventoryProvisionLedgerRebuilder.js`
- Read: `src/utils/cacheStore.js`

**Interfaces:**
- Confirm the shipping mapping boundary in `LingxingAdapter.normalizeMskuOrderProfitRecords`.
- Confirm the provenance of `inventory-provision-history/*` and `msku-detail/*` first-leg values.

- [x] Verify the production mapping fix is present at commit `e2c4da5`.
- [x] Verify historical inventory rows do not accept `shipping_cost` or `shippingCost` as cache fields.
- [x] Verify the clearance cache path is the only persisted consumer of recent OrderProfit first-leg aggregates.

### Task 2: Audit production cache contents read-only

**Files:**
- Read: `/opt/tanjia-bi/data-cache/inventory-provision-history/*.json`
- Read: `/opt/tanjia-bi/data-cache/msku-detail/*.json`

**Interfaces:**
- Produce counts of `shipping_cost`/`shippingCost` fields, first-leg provenance fields, row counts, and cache timestamps.

- [x] Count target fields recursively without logging business rows or credentials.
- [x] Confirm whether any historical cache row contains a buyer-shipping field.
- [x] Confirm whether any MSKU cache entry contains `recent30FirstLegCost`, `averageFirstLegCost`, or `landedUnitCost` from the pre-fix path.

### Task 3: Apply the smallest safe correction

**Files:**
- Modify only a cache or cache-version boundary if Task 2 proves contamination.
- Use `src/services/inventoryLedgerRawReportService.js` and `src/services/inventoryLedgerRawReportStore.js` for an authoritative historical rebuild.

**Interfaces:**
- Clean audit: leave runtime caches unchanged and record `rebuildRequired=false`.
- Contaminated audit: create a backup, run the authoritative rebuild, verify the replacement manifest, then atomically commit the new cache.

- [x] Do not run a forced full raw-ledger rebuild when the audit proves no contamination.
- [x] Do not use the selected-month `/cost/center/ods/detail/query` refresh as a substitute for the formal raw export workflow.

### Task 4: Verify and record the outcome

**Files:**
- Create: `docs/superpowers/reports/2026-08-22-s0-shipping-cost-audit.md`

- [x] Record the exact production commit, audit timestamp, cache counts, and rebuild decision.
- [x] Re-run the recursive audit after the read-only decision and assert zero buyer-shipping fields in inventory history.
- [x] Run the focused shipping-mapping and inventory-cache tests; no runtime code changes were required.

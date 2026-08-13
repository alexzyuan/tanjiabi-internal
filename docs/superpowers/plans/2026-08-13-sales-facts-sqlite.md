# Sales Facts SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the independent `sales-facts-v1.sqlite` stage so OrderProfit is stored as trusted daily facts, custom fees remain monthly facts, historical Listing ownership is effective-dated, and sales-weekly/monthly-report consumers share atomic, observable 12-hour cache semantics.

**Architecture:** Add a sales-facts metric/identity boundary, SQLite schema/repository, read-only upstream preflight, effective-dated owner history, atomic sync/query services, and revision-aware derived cache. Keep Lingxing as source of truth, perform all network work before short SQLite transactions, shadow-compare before consumer cutover, then switch sales weekly and the monthly report in separate reviewed commits. Product catalog and inventory snapshot code remain untouched except generic health/deploy composition where explicitly listed.

**Tech Stack:** Node.js `>=22.19.0 <25`, ES modules, `better-sqlite3@13.0.3`, SQLite WAL, Node test runner, native HTML/CSS/JavaScript, PM2 package deployment.

---

## Global Constraints

- Execute only in `/Users/maclex/Documents/Codex/2026-04-29/bi-erp/.worktrees/sales-facts-sqlite` on `codex/sales-facts-sqlite`; never implement on `main`.
- Follow `docs/superpowers/specs/2026-08-13-sales-facts-sqlite-design.md` and `CONTEXT.md`; if code reality conflicts, stop and amend the spec before changing behavior.
- Database path is `data-cache/sales-facts/sales-facts-v1.sqlite`. Do not add sales tables to product catalog SQLite.
- Facts are keyed by Pacific business date, runtime SID, normalized MSKU, and `CNY|ORIGINAL`. `ORIGINAL` requires a single-country scope.
- Financial values are fixed-point integers declared by the canonical metric registry. Do not persist facts in `REAL` columns and do not persist raw payload JSON.
- Every complete empty upstream result writes coverage. Missing coverage is not zero sales.
- Current month coverage expires after 12 hours; previous month after 24 hours; older months are frozen and never auto-fetch.
- Expired refresh failures are returned as failures. Never serve stale JSON or stale SQLite as a successful fallback.
- Listing owner is a separate effective-dated dimension. It is never part of the OrderProfit fact key.
- All upstream calls and validation complete before a write transaction begins. Range replacement, coverage, custom fees, and revision updates commit or roll back together.
- Existing OrderProfit/sales-weekly JSON is read-only for shadow reconciliation and is never imported into canonical facts.
- `server.js` remains composition only. Feature-specific routes, serializers, state, and logs stay in focused modules.
- Automated tests and browser checks must not call Lingxing production endpoints. Use injected adapters. The one explicit real preflight is read-only, separately approved, rate-limited, and produces a redacted report.
- Do not run narrow-screen tests. If frontend wiring changes, verify desktop only, plus request bodies, keyboard interaction, error state, and console.
- Every task follows RED → GREEN → cleanup → targeted verification → focused commit. Do not combine product catalog, inventory snapshot, or unrelated refactors.

## File and Interface Map

### New core files

- `src/services/salesFactsIdentity.js`: dates, scope, currency mode, request IDs, typed errors, range key.
- `src/services/salesFactsMetrics.js`: canonical OrderProfit whitelist, aliases, nullable rules, fixed-point scales, encode/decode.
- `src/services/salesFactsSchema.js`: v1 DDL, checksum migration, schema validation.
- `src/services/salesFactsRepository.js`: WAL connection, prepared reads, atomic range replacement, owner periods, revisions, derived cache, health.
- `src/services/salesFactsOrderProfitValidator.js`: raw-record-to-canonical validation and monthly-vs-daily comparison.
- `src/services/listingOwnerHistoryService.js`: full Listing scan, unique owner parsing, preflight report, effective-period updates.
- `src/services/salesFactsSyncService.js`: TTL/frozen policy, monthly/daily fetch mode, retry, exact-scope single-flight, OrderProfit/custom-fee atomic commit.
- `src/services/salesFactsQueryService.js`: coverage checks, refresh orchestration, fact reads, owner-at-date join, safe meta.
- `src/services/salesDerivedCacheService.js`: revision/mapper-version/TTL cache for sales weekly results.
- `src/services/salesFactsShadowService.js`: old/new reconciliation only; never supplies runtime results.
- `routes/sales-facts.js`: authenticated refresh/preflight route descriptors and fail-closed serializer.
- `scripts/audit-sales-facts-preflight.js`: read-only Listing-owner and OrderProfit grain report.
- `scripts/sales-facts-sqlite-smoke.js`: disposable WAL/CRUD/rollback/integrity smoke.

### New tests

- `test/salesFactsIdentity.test.js`
- `test/salesFactsMetrics.test.js`
- `test/salesFactsRepository.test.js`
- `test/salesFactsOrderProfitValidator.test.js`
- `test/listingOwnerHistoryService.test.js`
- `test/salesFactsSyncService.test.js`
- `test/salesFactsQueryService.test.js`
- `test/salesDerivedCacheService.test.js`
- `test/salesFactsShadowService.test.js`
- `test/salesFactsRoutes.test.js`
- `test/salesFactsDeploy.test.js`

### Existing files changed only in their named cutover task

- `src/adapters/lingxingAdapter.js`: expose uncached canonical OrderProfit/custom-fee loaders; remove runtime JSON cache ownership only after consumers cut over.
- `src/services/dashboardService.js`: sales-weekly consumer of facts/derived cache; remove runtime legacy fallback.
- `src/services/storeOperatingMonthlyReportService.js`: monthly fact query and atomic custom-fee refresh.
- `src/services/lingxingDashboardMapper.js`, `src/services/storeOperatingMonthlyReportMapper.js`: consume canonical fact names without upstream aliases; mapper versions exported.
- `src/utils/cacheStore.js`: deprecate/remove OrderProfit and sales-weekly runtime writes after cutover; retain explicit read-only reconciliation helpers.
- `routes/sales.js`, `routes/finance-purchase.js`, `routes/index.js`, `routes/core.js`, `server.js`: route and health dependency wiring.
- `assets/js/features/sales-dashboard.js`, `assets/js/features/store-operating-monthly-report.js`, `index.html`: add explicit current-filter force-refresh controls; no CSS expected.
- `scripts/package-deploy.js`, `scripts/deploy-integrity.js`, `deploy.sh`, `package.json`: package/smoke/preflight/health guard.
- `AGENTS.md`, `README.md`, `SERVER_DEPLOYMENT.md`: cutover and operations truth.

### Stable interfaces produced

```js
normalizeSalesFactsScope({ startDate, endDate, sids, currencyMode, sellerDirectory, now })
// => { startDate, endDate, dates, sids, currencyMode, countryCode, rangeKey, monthClasses }

normalizeOrderProfitRows(rawRows, { factDate, currencyMode, sellers })
// => [{ factDate, sid, msku, mskuKey, currencyMode, actualCurrencyCode,
//      metrics: Map<registeredMetricName, bigint|null> }]

createSalesFactsRepository({ databasePath, logger, now })
// => {
//   getSchemaInfo(), getHealth(), getRevisions(), readCoverage(scope), readFacts(scope),
//   replaceOrderProfitScope(batch), replaceMonthlyReportScope(batch),
//   readOwnerPeriods(scope), applyOwnerSnapshot(snapshot),
//   readDerivedCache(key), writeDerivedCache(entry), close()
// }

refreshOrderProfitScope(scope, options)
// => { facts, meta: { source, cacheState, updatedAt, ageSeconds,
//      revision, requestId, scopeCount, fetchMode, timings } }

refreshMonthlyReportScope(scope, options)
// => same meta plus customFeeCount and unknownFeeTypeCount

getSalesFacts(scope, options)
// => { records, meta: { source, cacheState, updatedAt, ageSeconds,
//      revision, ownerRevision, requestId, scopeCount } }

syncListingOwnerHistory(options)
// => { changed, ownerRevision, counts: { assigned, unassigned, multiple, malformed } }
```

## Delivery Gates

1. **Gate A — Read-only truth:** Listing owner scan and OrderProfit month-vs-day validation run safely and produce an approved redacted report. No database consumer cutover.
2. **Gate B — Foundation and shadow:** schema/repository/sync/query/owner history run behind injected services; shadow comparisons pass. Existing pages still read the old path.
3. **Gate C — Sales weekly:** weekly dashboard uses facts and revision-aware derived cache; old fallback cannot serve runtime traffic.
4. **Gate D — Monthly report:** OrderProfit and custom fees use one atomic monthly refresh and existing approved mapper tree.
5. **Gate E — Deployment:** package, SQLite smoke, schema/preflight, nested health, desktop verification, and production observation pass.

Do not begin the next gate until the previous gate has a focused review verdict of APPROVED.

---

### Task 0: Pre-implementation full Listing owner audit

**Files:**
- Create: `src/services/listingOwnerHistoryService.js`
- Create: `scripts/audit-sales-facts-preflight.js`
- Create: `test/listingOwnerHistoryService.test.js`
- Create: `test/salesFactsPreflightCli.test.js`
- Modify: `src/services/lingxingCatalogLookupService.js`
- Modify: `package.json`

**Purpose:** Answer the user's required question before any sales-facts schema or runtime implementation: which active `SID + MSKU` Listings return multiple distinct owners?

- [ ] **Step 1: Write parser and pagination RED tests**

```js
test("classifies one owner, explicit empty, malformed, and multiple owners", () => {
  assert.equal(parseListingOwnerRecord(singleOwner).status, "assigned");
  assert.equal(parseListingOwnerRecord(explicitEmpty).status, "unassigned");
  assert.throws(() => parseListingOwnerRecord(missingOwnerField), /负责人字段缺失/);
  assert.throws(() => parseListingOwnerRecord(twoDifferentOwners),
    (error) => error.code === "LISTING_MULTIPLE_OWNERS");
});

test("full scan rejects a truncated Listing total", async () => {
  await assert.rejects(scanAllListingOwners({ sellers, adapter: truncatedAdapter }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE");
});
```

- [ ] **Step 2: Write CLI RED tests**

The CLI must obtain every active SID from `getSellerDirectory({ forceRefresh: true })`, scan all non-deleted Listing pages, write no SQLite/JSON, emit counts plus a redacted anomaly report, and return nonzero when `multiple > 0`, `malformed > 0`, a SID fails, or pagination is incomplete. Logs may contain SID, MSKU, owner count, hashed owner identities, requestId, page count, and row count; never names, IDs, raw payload, token, or signatures.

- [ ] **Step 3: Run RED**

Run: `node --test test/listingOwnerHistoryService.test.js test/salesFactsPreflightCli.test.js`

Expected: FAIL with missing audit module/script.

- [ ] **Step 4: Implement the read-only owner scanner**

Add package command:

```json
"sales-facts:owners:audit": "node scripts/audit-sales-facts-preflight.js --owners"
```

Extend `fetchLingxingListingRecords` so a declared upstream total beyond the configured scan limit throws instead of returning a partial success. Implement owner identity exactly as approved: person ID first, normalized-name fallback, explicit empty as `unassigned`, multiple distinct identities as an anomaly.

- [ ] **Step 5: Run local GREEN**

Run: `node --test test/listingOwnerHistoryService.test.js test/salesFactsPreflightCli.test.js test/lingxingCatalogLookupService.test.js`

If `test/lingxingCatalogLookupService.test.js` does not yet exist, create it in this task with complete/truncated pagination cases.

Expected: PASS with injected adapters and zero external calls.

- [ ] **Step 6: Commit the audit tool**

```bash
git add package.json src/services/lingxingCatalogLookupService.js src/services/listingOwnerHistoryService.js scripts/audit-sales-facts-preflight.js test/listingOwnerHistoryService.test.js test/salesFactsPreflightCli.test.js test/lingxingCatalogLookupService.test.js
git commit -m "feat(sales-facts): audit listing owner uniqueness"
```

- [ ] **Step 7: Run the approved real read-only audit before Task 1**

Run from the isolated worktree with production-configured Lingxing credentials but no database path override:

```bash
npm run sales-facts:owners:audit
```

Expected approval gate: all active SIDs scanned, `multiple=0`, `malformed=0`, `failedSidCount=0`, `paginationIncomplete=0`. Save only the redacted report under ignored `.superpowers/sdd/2026-08-13-sales-facts-sqlite/preflight-owner-report.json`.

If the command reports any anomaly, stop the plan immediately and present the SID/MSKU anomaly list to the user. Do not begin Task 1, select a first owner, or weaken the parser.

---

### Task 1: Canonical scope, errors, metrics, and fixed-point values

**Files:**
- Create: `src/services/salesFactsIdentity.js`
- Create: `src/services/salesFactsMetrics.js`
- Create: `test/salesFactsIdentity.test.js`
- Create: `test/salesFactsMetrics.test.js`

**Produces:** scope normalization, typed 400/409/422/502/503 errors, Pacific date expansion, range keys, metric registry, raw aliases, fixed-point encode/decode.

- [ ] **Step 1: Write failing identity tests**

```js
test("normalizes a Pacific inclusive range and stable SID/currency scope", () => {
  const scope = normalizeSalesFactsScope({
    startDate: "2026-08-01", endDate: "2026-08-03",
    sids: [8709, 8708, 8708], currencyMode: "CNY",
    sellerDirectory: sellers,
    now: new Date("2026-08-13T08:00:00Z"),
  });
  assert.deepEqual(scope.dates, ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.deepEqual(scope.sids, [8708, 8709]);
  assert.equal(scope.rangeKey, "2026-08-01|2026-08-03|8708,8709|CNY");
});

test("rejects cross-country ORIGINAL and unknown runtime SIDs", () => {
  assert.throws(() => normalizeSalesFactsScope({
    startDate: "2026-08-01", endDate: "2026-08-02",
    sids: [8708, 8709], currencyMode: "ORIGINAL", sellerDirectory: crossCountrySellers,
  }), (error) => error.statusCode === 422 && error.code === "SALES_FACTS_ORIGINAL_SCOPE_INVALID");
});
```

- [ ] **Step 2: Write failing metric tests**

```js
test("registry encodes money as fixed-point integers and preserves null/zero", () => {
  assert.equal(encodeSalesMetric("totalSalesAmount", "12.3456"), 123456n);
  assert.equal(decodeSalesMetric("totalSalesAmount", 123456n), 12.3456);
  assert.equal(encodeSalesMetric("totalSalesRefunds", 0), 0n);
  assert.equal(encodeSalesMetric("totalSalesRefunds", null), null);
  assert.throws(() => encodeSalesMetric("unknownField", 1), /未注册/);
});

test("canonical normalization returns only registry fields and never raw", () => {
  const fact = normalizeOrderProfitMetricValues({ amount: "10.50", volume: 2, token: "secret" });
  assert.deepEqual(fact, { totalSalesAmount: 105000n, totalSalesQuantity: 20000n });
  assert.equal("token" in fact, false);
});
```

- [ ] **Step 3: Run RED**

Run: `node --test test/salesFactsIdentity.test.js test/salesFactsMetrics.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the two new modules.

- [ ] **Step 4: Implement the typed boundary and registry**

Use these exact public constants and helpers:

```js
export const SALES_FACTS_CURRENCY_MODES = Object.freeze(["CNY", "ORIGINAL"]);
export class SalesFactsError extends Error {
  constructor(message, { name = "SalesFactsError", statusCode = 500, code, details = null, cause } = {}) {
    super(message, { cause });
    this.name = name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
export class SalesFactsInputError extends SalesFactsError {
  constructor(message, options = {}) {
    super(message, { ...options, name: "SalesFactsInputError", statusCode: 400 });
  }
}
export class SalesFactsContractError extends SalesFactsError {
  constructor(message, options = {}) {
    super(message, { ...options, name: "SalesFactsContractError", statusCode: 422 });
  }
}
export class SalesFactsUpstreamError extends SalesFactsError {
  constructor(message = "销售事实上游服务失败。", options = {}) {
    super(message, { ...options, name: "SalesFactsUpstreamError", statusCode: options.statusCode || 502 });
  }
}
export class SalesFactsDatabaseError extends SalesFactsError {
  constructor(message = "销售事实数据库不可用。", options = {}) {
    super(message, { ...options, name: "SalesFactsDatabaseError", statusCode: 503 });
  }
}

export const SALES_FACT_METRICS = Object.freeze({
  totalSalesQuantity: { aliases: ["volume", "totalSalesQuantity"], scale: 4, kind: "quantity" },
  multiChannelSalesQuantity: { aliases: ["multi_channel_volume", "multiChannelSalesQuantity"], scale: 4, kind: "quantity" },
  totalAdsSales: { aliases: ["ad_sales_amount", "totalAdsSales"], scale: 4, kind: "money" },
  totalAdsSalesQuantity: { aliases: ["ad_volume", "totalAdsSalesQuantity"], scale: 4, kind: "quantity" },
  totalSalesAmount: { aliases: ["amount", "totalSalesAmount"], scale: 4, kind: "money" },
  netSalesAmount: { aliases: ["net_amount", "netSalesAmount"], scale: 4, kind: "money" },
  grossProfit: { aliases: ["gross_profit", "grossProfit"], scale: 4, kind: "money" },
  salesProfit: { aliases: ["profit", "profit_amount", "salesProfit"], scale: 4, kind: "money" },
  buyerShippingFee: { aliases: ["shipping_cost", "buyerShippingFee"], scale: 4, kind: "money" },
  promotionDiscount: { aliases: ["promotion_discount", "promotionDiscount"], scale: 4, kind: "money" },
  totalSalesRefunds: { aliases: ["refund_amount", "totalSalesRefunds"], scale: 4, kind: "money" },
  returnQuantity: { aliases: ["return_quantity", "returnQuantity"], scale: 4, kind: "quantity" },
  refundsQuantity: { aliases: ["refund_quantity", "refundsQuantity"], scale: 4, kind: "quantity" },
  fbaInventoryCompensation: { aliases: ["inventory_credit", "fbaInventoryCompensation"], scale: 4, kind: "money" },
  otherIncome: { aliases: ["total_other_granted", "otherIncome"], scale: 4, kind: "money" },
  platformFee: { aliases: ["selling_fee", "platform_fee", "platformFee"], scale: 4, kind: "money" },
  fbaDeliveryFee: { aliases: ["fulfillment_fee", "fbaDeliveryFee"], scale: 4, kind: "money" },
  otherOrderFee: { aliases: ["other_order_fee", "otherOrderFee"], scale: 4, kind: "money" },
  storageFee: { aliases: ["total_stock_fee", "storageFee"], scale: 4, kind: "money" },
  totalAdsCost: { aliases: ["spend", "totalAdsCost"], scale: 4, kind: "money" },
  promotionFee: { aliases: ["promotion_fee", "promotionFee"], scale: 4, kind: "money" },
  fbaInternationalShippingFee: { aliases: ["shared_fba_international_inbound_fee"], scale: 4, kind: "money" },
  inboundPlacementFee: { aliases: ["shared_fba_inbound_convenience_fee"], scale: 4, kind: "money" },
  adjustmentFee: { aliases: ["adjustments", "adjustmentFee"], scale: 4, kind: "money" },
  otherPlatformFee: { aliases: ["total_platform_other_fee", "otherPlatformFee"], scale: 4, kind: "money" },
  purchaseCost: { aliases: ["purchase_costs", "purchaseCost"], scale: 4, kind: "money" },
  firstLegCost: { aliases: ["logistics_costs", "firstLegCost"], scale: 4, kind: "money" },
  otherProductCost: { aliases: ["other_product_cost", "otherProductCost"], scale: 4, kind: "money" },
  purchaseUnitCost: { aliases: ["cgUnitPrice", "purchaseUnitCost"], scale: 4, kind: "money" },
  firstLegUnitCost: { aliases: ["cgTransportUnitCosts", "firstLegUnitCost"], scale: 4, kind: "money" },
  storageFeeRate: { aliases: ["total_stock_fee_rate", "storageFeeRate"], scale: 6, kind: "rate" },
  platformFeeRate: { aliases: ["selling_fee_rate", "platformFeeRate"], scale: 6, kind: "rate" },
  fbaDeliveryFeeRate: { aliases: ["fulfillment_fee_rate", "fbaDeliveryFeeRate"], scale: 6, kind: "rate" },
  purchaseCostRate: { aliases: ["proportionOfCg", "purchaseCostRate"], scale: 6, kind: "rate" },
  firstLegCostRate: { aliases: ["proportionOfCgTransport", "firstLegCostRate"], scale: 6, kind: "rate" },
});
```

Only preserve the five upstream rate fields already used by `preferApiRate`; all other report rates remain derived from stored numerators/denominators. Add a compatibility test proving current sales-weekly and monthly mapper inputs can be reconstructed entirely from the registry without `...record`.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsIdentity.test.js test/salesFactsMetrics.test.js`

Expected: PASS.

```bash
git add src/services/salesFactsIdentity.js src/services/salesFactsMetrics.js test/salesFactsIdentity.test.js test/salesFactsMetrics.test.js
git commit -m "feat(sales-facts): define canonical facts and scope"
```

---

### Task 2: SQLite v1 schema, repository, coverage, revisions, and health

**Files:**
- Create: `src/services/salesFactsSchema.js`
- Create: `src/services/salesFactsRepository.js`
- Create: `test/salesFactsRepository.test.js`

**Consumes:** Task 1 identity/metric helpers. **Does not consume:** Lingxing adapter or legacy JSON.

- [ ] **Step 1: Write repository RED tests**

Cover exact tables/pragmas, integer metric columns, zero-row coverage, atomic rollback, range delete/insert, custom-fee replacement, non-overlapping owner periods, global revisions, derived cache, checksum mismatch, readonly health, close, and safe requestId logs.

```js
test("replaces facts and coverage atomically while preserving zero", () => {
  const before = repository.getRevisions();
  const result = repository.replaceOrderProfitScope({
    scope, facts: [fact({ totalSalesAmount: 0n })], coverage: [coverage()],
    requestId: "facts-test-1", refreshedAtMs: 1000,
  });
  assert.equal(result.salesFactsRevision, before.salesFactsRevision + 1);
  assert.equal(repository.readFacts(scope)[0].metrics.totalSalesAmount, 0n);
  assert.equal(repository.readCoverage(scope).length, 1);
});

test("a failed range replacement leaves facts coverage and revision unchanged", () => {
  const snapshot = repository.debugSnapshotForTest();
  assert.throws(() => repository.replaceOrderProfitScope(invalidDuplicateCurrencyBatch), /实际币种/);
  assert.deepEqual(repository.debugSnapshotForTest(), snapshot);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsRepository.test.js`

Expected: FAIL because schema/repository modules do not exist.

- [ ] **Step 3: Implement schema with these exact tables**

```sql
schema_migrations(version INTEGER PRIMARY KEY, name TEXT UNIQUE, checksum TEXT, applied_at_ms INTEGER)
sales_facts_metadata(key TEXT PRIMARY KEY, value TEXT, updated_at_ms INTEGER)
order_profit_daily(fact_date TEXT, sid INTEGER, msku_key TEXT, msku TEXT,
  currency_mode TEXT, actual_currency_code TEXT, <registry metric INTEGER columns>,
  source_updated_at_ms INTEGER, refreshed_at_ms INTEGER, refresh_batch_id TEXT,
  PRIMARY KEY(fact_date,sid,msku_key,currency_mode))
fact_coverage_daily(fact_date TEXT,sid INTEGER,currency_mode TEXT,
  source_updated_at_ms INTEGER,refreshed_at_ms INTEGER,row_count INTEGER,page_count INTEGER,
  refresh_batch_id TEXT,revision INTEGER,PRIMARY KEY(fact_date,sid,currency_mode))
custom_fee_monthly(natural_month TEXT,sid INTEGER,fee_type_id TEXT,currency_mode TEXT,
  fee_name TEXT,fee_amount INTEGER,actual_currency_code TEXT,recognized INTEGER,
  source_updated_at_ms INTEGER,refreshed_at_ms INTEGER,refresh_batch_id TEXT,
  PRIMARY KEY(natural_month,sid,fee_type_id,currency_mode))
custom_fee_coverage_monthly(natural_month TEXT,sid INTEGER,currency_mode TEXT,
  refreshed_at_ms INTEGER,row_count INTEGER,refresh_batch_id TEXT,revision INTEGER,
  PRIMARY KEY(natural_month,sid,currency_mode))
listing_owner_period(sid INTEGER,msku_key TEXT,msku TEXT,effective_from TEXT,effective_to TEXT,
  owner_identity TEXT,owner_person_id TEXT,owner_name_snapshot TEXT,identity_source TEXT,status TEXT,
  updated_at_ms INTEGER,PRIMARY KEY(sid,msku_key,effective_from))
sales_derived_cache(cache_key TEXT PRIMARY KEY,payload_json TEXT,sales_facts_revision INTEGER,
  owner_revision INTEGER,mapper_version TEXT,generated_at_ms INTEGER,expires_at_ms INTEGER)
```

Add indexes for fact date/SID, MSKU/date, owner lookup, coverage freshness, and derived expiry. Metadata initializes `sales_facts_revision=0`, `owner_revision=0`, and no fetch mode until preflight approval.

Open the connection with `database.defaultSafeIntegers(true)` so fixed-point `INTEGER` columns round-trip as BigInt. IDs, counts, timestamps, and revisions must be converted through explicit bounded helpers; do not globally coerce every BigInt to Number.

- [ ] **Step 4: Implement repository operations**

Public methods must match the File and Interface Map. `replaceOrderProfitScope` and `replaceMonthlyReportScope` validate full batch shapes before `db.transaction()`, delete only the explicit scope, insert canonical facts/coverage, and increment revision once. `applyOwnerSnapshot` rejects overlaps and increments owner revision only when rows change. `getHealth()` sanitizes quick-check diagnostics with the shared helper.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsIdentity.test.js test/salesFactsMetrics.test.js test/salesFactsRepository.test.js`

Expected: PASS.

```bash
git add src/services/salesFactsSchema.js src/services/salesFactsRepository.js test/salesFactsRepository.test.js
git commit -m "feat(sales-facts): add sqlite repository"
```

---

### Task 3: Read-only OrderProfit month/day validation gate

**Files:**
- Create: `src/services/salesFactsOrderProfitValidator.js`
- Modify: `scripts/audit-sales-facts-preflight.js`
- Create: `test/salesFactsOrderProfitValidator.test.js`
- Modify: `test/salesFactsPreflightCli.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write RED for real-date enforcement and comparisons**

```js
test("rejects monthly rows whose date exists only through reportDate fallback", () => {
  assert.throws(() => normalizeOrderProfitRows([{ sid: 8708, msku: "A", amount: 10 }], {
    requestedDateRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
    allowRequestedDateFallback: false,
  }), (error) => error.code === "SALES_FACTS_DATE_MISSING");
});

test("approves monthly mode only when every daily metric reconciles", () => {
  const report = compareMonthlyAndDailyFacts({ monthlyRows, dailyRows });
  assert.equal(report.approvedFetchMode, "monthly");
  assert.equal(report.metricMismatchCount, 0);
});
```

- [ ] **Step 2: Write CLI RED**

Inject fake seller/listing/OrderProfit loaders. Assert the CLI is read-only, emits only counts/hash prefixes, sets nonzero exitCode on any incomplete page/mismatch, and writes no SQLite/JSON.

- [ ] **Step 3: Run RED**

Run: `node --test test/salesFactsOrderProfitValidator.test.js test/salesFactsPreflightCli.test.js`

Expected: FAIL with missing modules/scripts.

- [ ] **Step 4: Implement validator and CLI**

The CLI command is:

```json
"sales-facts:preflight": "node scripts/audit-sales-facts-preflight.js"
```

Required explicit inputs:

```text
SALES_FACTS_PREFLIGHT_START_DATE=YYYY-MM-01
SALES_FACTS_PREFLIGHT_END_DATE=YYYY-MM-DD
SALES_FACTS_PREFLIGHT_SIDS=8708,8709
SALES_FACTS_PREFLIGHT_CURRENCY_MODE=CNY|ORIGINAL
```

It fetches one complete month and each day serially, compares quantity exactly and fixed-point money within one storage unit (`0.0001`), records page/row/mismatch counts, and recommends `monthly` only on complete equality. It never silently changes mode.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsOrderProfitValidator.test.js test/salesFactsPreflightCli.test.js`

Expected: PASS.

```bash
git add package.json src/services/salesFactsOrderProfitValidator.js scripts/audit-sales-facts-preflight.js test/salesFactsOrderProfitValidator.test.js test/salesFactsPreflightCli.test.js
git commit -m "feat(sales-facts): add order profit grain preflight"
```

---

### Task 4: Effective-dated Listing owner persistence

**Files:**
- Modify: `src/services/listingOwnerHistoryService.js`
- Modify: `test/listingOwnerHistoryService.test.js`
- Modify: `src/services/salesFactsRepository.js`
- Modify: `test/salesFactsRepository.test.js`
- Modify: `scripts/audit-sales-facts-preflight.js`
- Modify: `test/salesFactsPreflightCli.test.js`

- [ ] **Step 1: Write RED for effective-dated persistence**

```js
test("a detected change starts tomorrow and never rewrites prior history", () => {
  const result = buildOwnerPeriodChange(existing, snapshot, { detectedDate: "2026-08-13" });
  assert.equal(result.closed[0].effectiveTo, "2026-08-13");
  assert.equal(result.opened[0].effectiveFrom, "2026-08-14");
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/listingOwnerHistoryService.test.js test/salesFactsPreflightCli.test.js`

Expected: FAIL because owner history module is absent.

- [ ] **Step 3: Reuse the approved complete Listing scan**

Reuse Task 0's runtime seller directory scan for each SID with `is_delete=0`, complete pagination, and no MSKU subset. Do not add another Listing parser or request path. Owner identity rows entering persistence remain:

```js
{ status: "assigned", ownerIdentity: `id:${personId}`, ownerPersonId: personId,
  ownerNameSnapshot: name, identitySource: "lingxing-person-id" }
{ status: "assigned", ownerIdentity: `name:${normalizeName(name)}`, ownerPersonId: null,
  ownerNameSnapshot: name, identitySource: "name-fallback" }
{ status: "unassigned", ownerIdentity: null, ownerPersonId: null,
  ownerNameSnapshot: null, identitySource: "lingxing-explicit-empty" }
```

Different owners in one Listing throw. Duplicate representations of the same ID do not.

- [ ] **Step 4: Add persistence without weakening the read-only audit**

The Task 0/3 preflight remains read-only and still requires `multiple=0` and `malformed=0`. Separately add `syncListingOwnerHistory({ repository, sellers, adapter, detectedDate, requestId })`; all scans finish before one owner transaction. First cutover creates `historical-unknown` before cutover and snapshot state on cutover date. Later changes start next day.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/listingOwnerHistoryService.test.js test/salesFactsPreflightCli.test.js test/salesFactsRepository.test.js`

Expected: PASS.

```bash
git add src/services/listingOwnerHistoryService.js src/services/salesFactsRepository.js scripts/audit-sales-facts-preflight.js test/listingOwnerHistoryService.test.js test/salesFactsRepository.test.js test/salesFactsPreflightCli.test.js
git commit -m "feat(sales-facts): track listing owner history"
```

**Gate A checkpoint:** run the real read-only preflight only after reviewing its exact SID/month inputs and rate limit. If any multiple owner or monthly mismatch exists, stop and present the redacted report; do not continue by choosing an owner or fetch mode.

---

### Task 5: Uncached upstream loaders and safe retries

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Create: `src/services/salesFactsUpstreamService.js`
- Create: `test/salesFactsUpstreamService.test.js`
- Modify: `test/lingxingAdapter.test.js`

- [ ] **Step 1: Write RED for pagination, modes, and retry policy**

Tests must prove: inclusive end date; CNY explicitly sent; ORIGINAL omits conversion but records actual currency; serial daily mode; complete pagination; retry only timeout/429/known temporary Lingxing limit; maximum 3 total attempts; no retry for contract errors; safe logs; custom fees from seller report only.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsUpstreamService.test.js test/lingxingAdapter.test.js`

Expected: FAIL because the upstream service is absent.

- [ ] **Step 3: Implement uncached loaders**

```js
loadOrderProfitRange({ startDate, endDate, sids, currencyMode, fetchMode, requestId })
loadCustomFeesByMonth({ naturalMonths, sids, currencyMode, requestId })
```

Monthly mode requires validated real row dates. Daily mode requests each inclusive day serially. Network sleeps happen outside transactions. Preserve adapter compatibility methods for old consumers until Gate C/D, but the new service must never call `fetchMskuOrderProfitCached` or cacheStore.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesFactsUpstreamService.test.js test/lingxingAdapter.test.js test/lingxingAdapterFailFast.test.js`

Expected: PASS.

```bash
git add src/adapters/lingxingAdapter.js src/services/salesFactsUpstreamService.js test/salesFactsUpstreamService.test.js test/lingxingAdapter.test.js
git commit -m "feat(sales-facts): load uncached upstream facts"
```

---

### Task 6: TTL/frozen policy, atomic sync, and exact-scope single-flight

**Files:**
- Create: `src/services/salesFactsSyncService.js`
- Create: `test/salesFactsSyncService.test.js`

- [ ] **Step 1: Write policy and transaction RED tests**

Cover current month 12h, previous month 24h, frozen older months, missing frozen coverage requiring force, mixed-range stale partitions, zero rows, range replacement, monthly dual-source rollback, same-key single-flight, different-key isolation, retry failure cleanup, and no network inside repository transaction.

```js
test("monthly refresh commits OrderProfit and custom fees once or not at all", async () => {
  const before = repository.debugSnapshotForTest();
  await assert.rejects(refreshMonthlyReportScope(scope, { loadCustomFees: failingFees }));
  assert.deepEqual(repository.debugSnapshotForTest(), before);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsSyncService.test.js`

Expected: FAIL with missing sync service.

- [ ] **Step 3: Implement policy and orchestration**

Implement pure `classifyCoveragePartition({ naturalMonth, refreshedAtMs, nowPacific })` returning `fresh|stale|frozen|missing`. `refreshOrderProfitScope` and `refreshMonthlyReportScope` acquire an exact `rangeKey+operation` in-flight key, fetch/validate outside transaction, call one repository replacement, and clear in-flight in `finally`.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesFactsSyncService.test.js test/salesFactsRepository.test.js test/salesFactsUpstreamService.test.js`

Expected: PASS.

```bash
git add src/services/salesFactsSyncService.js test/salesFactsSyncService.test.js
git commit -m "feat(sales-facts): add atomic refresh policy"
```

---

### Task 7: Query service, owner-at-date join, and safe response metadata

**Files:**
- Create: `src/services/salesFactsQueryService.js`
- Create: `test/salesFactsQueryService.test.js`

- [ ] **Step 1: Write RED for reads and joins**

Tests must prove: fresh SQLite zero-call; stale synchronous refresh; refresh error is returned not stale; frozen history returns `cacheState=frozen`; missing frozen coverage is 422 until force; owner joins by fact date; historical unknown remains unknown; owner filter is post-join and never changes range key; CNY/ORIGINAL isolation; safe meta fields.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsQueryService.test.js`

Expected: FAIL with missing query service.

- [ ] **Step 3: Implement query contract**

```js
getSalesFacts(scopeInput, {
  repository, getSellerDirectory, refreshOrderProfitScope,
  forceRefresh = false, listingOwner = "", requestId, now,
})
```

Return decoded numeric records with canonical names and no raw aliases. Meta must include `source`, `cacheState`, ISO `updatedAt`, integer `ageSeconds`, `revision`, `ownerRevision`, `requestId`, `scopeCount`, and phase timings.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesFactsQueryService.test.js test/salesFactsSyncService.test.js test/listingOwnerHistoryService.test.js`

Expected: PASS.

```bash
git add src/services/salesFactsQueryService.js test/salesFactsQueryService.test.js
git commit -m "feat(sales-facts): query facts with owner history"
```

---

### Task 8: Revision-aware derived cache

**Files:**
- Create: `src/services/salesDerivedCacheService.js`
- Create: `test/salesDerivedCacheService.test.js`

- [ ] **Step 1: Write RED**

Cover 12-hour hit, expiry recompute without unnecessary upstream refresh, sales revision invalidation, owner revision invalidation, mapper version invalidation, malformed payload fail-fast, exact-key single-flight, and no owner filter in the base key.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesDerivedCacheService.test.js`

Expected: FAIL with missing derived cache service.

- [ ] **Step 3: Implement**

```js
getOrBuildSalesDerived({ scope, mapperVersion, repository, build, now, requestId })
// reads current revisions, accepts cache only when all versions and expiresAt match,
// builds once, whitelist-validates payload, then writes it.
```

Do not store upstream records in `payload_json`; store only the dashboard DTO needed by the consumer. The build callback must return JSON-safe decoded numbers/strings/nulls, and the service must reject BigInt, functions, prototypes, or unregistered object keys before serialization.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesDerivedCacheService.test.js test/salesFactsRepository.test.js`

Expected: PASS.

```bash
git add src/services/salesDerivedCacheService.js test/salesDerivedCacheService.test.js
git commit -m "feat(sales-facts): cache revisioned sales results"
```

---

### Task 9: Shadow dual-read reconciliation

**Files:**
- Create: `src/services/salesFactsShadowService.js`
- Create: `test/salesFactsShadowService.test.js`
- Modify: `src/services/dashboardService.js`
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Modify: tests for both services

- [ ] **Step 1: Write RED for non-authoritative shadow behavior**

Prove the current response remains byte-for-byte from the old path, new facts are queried only when `SALES_FACTS_SHADOW_READ=1`, differences are logged as counts/fixed-point deltas, new failures are observable but cannot replace old success, and old JSON cannot repair new facts.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsShadowService.test.js test/salesWeeklySourceCache.test.js test/storeOperatingMonthlyReportService.test.js`

Expected: FAIL because shadow service/wiring does not exist.

- [ ] **Step 3: Implement shadow comparator**

Compare canonical totals by date/SID/MSKU/currency mode for quantity, sales, refund, fees, and profit. Hash MSKU in logs; do not log values or owner names. Add timings and mismatch counts to a dedicated `[sales-facts-shadow]` event.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesFactsShadowService.test.js test/salesWeeklySourceCache.test.js test/storeOperatingMonthlyReportService.test.js`

Expected: PASS with old consumer contract unchanged.

```bash
git add src/services/salesFactsShadowService.js src/services/dashboardService.js src/services/storeOperatingMonthlyReportService.js test/salesFactsShadowService.test.js test/salesWeeklySourceCache.test.js test/storeOperatingMonthlyReportService.test.js
git commit -m "feat(sales-facts): add shadow reconciliation"
```

**Gate B checkpoint:** seed a temporary SQLite repository, run shadow comparisons over approved ranges, and obtain focused Standards + Spec review. Do not switch consumers if mismatches are unexplained.

---

### Task 10: Authenticated sales-facts routes and nested health

**Files:**
- Create: `routes/sales-facts.js`
- Create: `test/salesFactsRoutes.test.js`
- Modify: `routes/index.js`
- Modify: `routes/core.js`
- Modify: `server.js`
- Modify: `test/serverRoutesStructure.test.js`
- Modify: `test/deployIntegrity.test.js`

- [ ] **Step 1: Write route RED**

Add tests for exact descriptors:

```text
POST /api/sales-facts/order-profit/refresh   auth=session
POST /api/sales-facts/monthly-report/refresh auth=finance
POST /api/sales-facts/owners/sync            auth=admin
```

Request body cap is 256 KiB. Bodies contain only date range, SID list, currency mode, and `forceRefresh:true`; serializer allows controlled 400/409/413/422/502/503/504 and redacted requestId/operation/code/counts. Nested `/api/health.salesFacts` remains root HTTP 200 and redacts path/SQL/stack.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsRoutes.test.js test/serverRoutesStructure.test.js test/deployIntegrity.test.js`

Expected: FAIL with missing route/health descriptor.

- [ ] **Step 3: Implement focused route and generic composition**

Use the existing generic `routes/api-dispatch.js`; do not add sales-specific policy to `server.js`. `server.js` only imports/wires repository service functions. Extend `routes/core.js` with a generic safe sales health sanitizer or move both SQLite health sanitizers into a shared utility if duplication would otherwise grow.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/salesFactsRoutes.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js test/deployIntegrity.test.js`

Expected: PASS.

```bash
git add routes/sales-facts.js routes/index.js routes/core.js server.js test/salesFactsRoutes.test.js test/serverRoutesStructure.test.js test/deployIntegrity.test.js
git commit -m "feat(sales-facts): expose refresh and health routes"
```

---

### Task 11: Cut sales weekly to facts and remove runtime legacy fallback

**Files:**
- Modify: `src/services/dashboardService.js`
- Modify: `src/services/lingxingDashboardMapper.js`
- Modify: `src/utils/cacheStore.js`
- Modify: `routes/sales.js`
- Modify: `assets/js/features/sales-dashboard.js`
- Modify: `index.html`
- Modify: `test/salesWeeklySourceCache.test.js`
- Create: `test/salesFactsWeeklyConsumer.test.js`
- Modify: `test/salesReview30dRefundRate.test.js`
- Modify: `test/salesDashboardFeature.test.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write consumer RED**

Prove weekly dashboard reads facts once, different owner filters reuse the same facts/derived base, mapper version invalidates cache, the explicit refresh button POSTs the current date/SID/currency scope without owner, keyboard activation works through native button semantics, busy state prevents duplicates, 30-day refund still works, old dashboard/source JSON is never read or written on runtime success/failure, and response meta contains unified fields.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsWeeklyConsumer.test.js test/salesWeeklySourceCache.test.js test/salesReview30dRefundRate.test.js`

Expected: FAIL because dashboard still owns JSON source cache.

- [ ] **Step 3: Export mapper version and switch service**

```js
export const SALES_WEEKLY_MAPPER_VERSION = "sales-weekly-facts-v1";
```

`getSalesWeeklyDashboard` obtains facts through `getSalesFacts`, builds/reuses derived DTO through `getOrBuildSalesDerived`, then applies the owner filter without changing the base range key. Preserve public dashboard fields and existing rate/null semantics.

Add `#sales-facts-force-refresh` to the existing sales filter action area using `secondary-button`. `sales-dashboard.js` owns POST `/api/sales-facts/order-profit/refresh`, safe error rendering, button busy/restore, then one normal dashboard reload. Do not bind this flow in `app.js` and do not add CSS.

- [ ] **Step 4: Remove runtime cache calls**

Delete imports/calls to `readSalesDashboardCache`, `readSalesWeeklySourceCache`, `saveSalesDashboardCache`, and `saveSalesWeeklySourceCache` from dashboard runtime paths. Keep explicitly named read-only reconciliation helpers in `cacheStore.js` until retirement; mark old generic writes deprecated and prove no runtime references with structure tests.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsWeeklyConsumer.test.js test/salesWeeklySourceCache.test.js test/salesReview30dRefundRate.test.js test/salesDashboardFeature.test.js`

Expected: PASS.

```bash
git add src/services/dashboardService.js src/services/lingxingDashboardMapper.js src/utils/cacheStore.js routes/sales.js assets/js/features/sales-dashboard.js index.html test/salesFactsWeeklyConsumer.test.js test/salesWeeklySourceCache.test.js test/salesReview30dRefundRate.test.js test/salesDashboardFeature.test.js test/frontendStructure.test.js
git commit -m "refactor(sales): read weekly reports from sales facts"
```

**Gate C checkpoint:** review sales totals, owner history, refund rates, no-stale failure, and JSON writer removal before proceeding to monthly report.

---

### Task 12: Cut store operating monthly report to atomic facts/custom fees

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Modify: `src/services/storeOperatingMonthlyReportMapper.js`
- Modify: `routes/finance-purchase.js`
- Modify: `assets/js/features/store-operating-monthly-report.js`
- Modify: `index.html`
- Modify: `test/storeOperatingMonthlyReportService.test.js`
- Modify: `test/storeOperatingMonthlyReportMapper.test.js`
- Modify: `test/storeOperatingMonthlyReportRoutes.test.js`
- Modify: `test/storeOperatingMonthlyReportFeature.test.js`
- Create: `test/salesFactsMonthlyConsumer.test.js`

- [ ] **Step 1: Write monthly RED**

Cover multi-month query aggregation, current 12h/previous 24h/frozen policy, CNY and single-country ORIGINAL, custom fee facts by month/type, unknown types in meta, OrderProfit+fee atomic force refresh, source failure zero-write, unchanged approved field tree/order/formulas, and the explicit refresh control's exact POST/busy/reload/partial-failure behavior.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsMonthlyConsumer.test.js test/storeOperatingMonthlyReportService.test.js test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportRoutes.test.js`

Expected: FAIL because monthly service still calls cached adapter and live fee endpoint independently.

- [ ] **Step 3: Switch monthly service**

Export `STORE_OPERATING_MONTHLY_MAPPER_VERSION = "store-operating-facts-v1"`. Query day facts aggregated per requested natural month and merge `custom_fee_monthly`. Remove the `fetchMskuOrderProfitCached` compatibility fallback and direct custom-fee request from the consumer; those calls belong only to `salesFactsSyncService`.

- [ ] **Step 4: Wire explicit finance refresh**

The existing query GET remains read/TTL-aware. Add `#store-operating-report-force-refresh` beside the existing query/reset controls with `secondary-button`; it POSTs the exact current range/store-derived SIDs/currency to the sales-facts monthly refresh route, disables only itself while pending, then performs one normal report reload after commit. Keep all state/error logic in `assets/js/features/store-operating-monthly-report.js`; add no CSS.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsMonthlyConsumer.test.js test/storeOperatingMonthlyReportService.test.js test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportRoutes.test.js test/storeOperatingMonthlyReportFeature.test.js`

Expected: PASS.

```bash
git add src/services/storeOperatingMonthlyReportService.js src/services/storeOperatingMonthlyReportMapper.js routes/finance-purchase.js assets/js/features/store-operating-monthly-report.js index.html test/salesFactsMonthlyConsumer.test.js test/storeOperatingMonthlyReportService.test.js test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportRoutes.test.js test/storeOperatingMonthlyReportFeature.test.js
git commit -m "refactor(finance): build monthly report from sales facts"
```

---

### Task 13: Remove adapter JSON ownership after both consumers cut over

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Modify: `src/utils/cacheStore.js`
- Modify: `src/services/syncService.js`
- Modify: `test/lingxingAdapterFailFast.test.js`
- Modify: `test/cacheStore.test.js`
- Modify: `test/syncService.test.js`
- Modify: `test/frontendStructure.test.js`

- [ ] **Step 1: Write structure RED**

Assert no runtime import/call of `readOrderProfitCache`, `saveOrderProfitCache`, `readSalesWeeklySourceCache`, `saveSalesWeeklySourceCache`, or `saveSalesDashboardCache` outside reconciliation/retirement helpers. Assert scheduled/manual sync uses facts service and reports revision/cacheState.

- [ ] **Step 2: Run RED**

Run: `node --test test/lingxingAdapterFailFast.test.js test/cacheStore.test.js test/syncService.test.js test/frontendStructure.test.js`

Expected: FAIL on old adapter/sync cache ownership.

- [ ] **Step 3: Remove runtime ownership**

Delete `fetchMskuOrderProfitCached` and its in-flight map from the adapter. Preserve uncached `fetchMskuOrderProfit`. Rename old cacheStore reads to `readLegacyOrderProfitForReconciliation` / `readLegacySalesWeeklyForReconciliation`, make them read-only, and remove save exports once no runtime caller remains.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/lingxingAdapterFailFast.test.js test/cacheStore.test.js test/syncService.test.js test/frontendStructure.test.js test/salesFactsWeeklyConsumer.test.js test/salesFactsMonthlyConsumer.test.js`

Expected: PASS.

```bash
git add src/adapters/lingxingAdapter.js src/utils/cacheStore.js src/services/syncService.js test/lingxingAdapterFailFast.test.js test/cacheStore.test.js test/syncService.test.js test/frontendStructure.test.js
git commit -m "refactor(sales-facts): retire runtime json cache ownership"
```

---

### Task 14: Disposable SQLite smoke, deploy ordering, package capability, and integrity

**Files:**
- Create: `scripts/sales-facts-sqlite-smoke.js`
- Create: `test/salesFactsDeploy.test.js`
- Modify: `scripts/package-deploy.js`
- Modify: `scripts/deploy-integrity.js`
- Modify: `deploy.sh`
- Modify: `package.json`
- Modify: `test/deployGuardStructure.test.js`
- Modify: `test/deployIntegrity.test.js`

- [ ] **Step 1: Write deploy RED**

Tests require package capability `sales-facts-sqlite-v1`, explicit smoke entry, order `npm ci → product smoke → sales smoke → sales schema validation + approved preflight artifact check → PM2`, nested healthy salesFacts diagnostics, and cleanup on every smoke failure.

- [ ] **Step 2: Run RED**

Run: `node --test test/salesFactsDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js`

Expected: FAIL with missing smoke/capability/order.

- [ ] **Step 3: Implement reusable full SQLite smoke**

Smoke must verify and report: native module load, `sqlite_version()`, WAL, foreign keys, busy timeout, synchronous FULL, INSERT/SELECT, UPDATE, DELETE, committed transaction, forced rollback, `quick_check`, `integrity_check`, and all-settled cleanup of DB/WAL/SHM/temp directory. Use injected fs/database seams for failure tests and never touch `data-cache`.

- [ ] **Step 4: Update deploy guard**

Package the new script, add capability, and run sales smoke before PM2. Deployment must not call real Lingxing preflight automatically unless an operator supplies an already approved preflight artifact/hash; schema bootstrap and health are automatic, network preflight remains an explicit guarded operation to avoid surprise rate limits.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/salesFactsDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js`

Expected: PASS.

```bash
git add scripts/sales-facts-sqlite-smoke.js scripts/package-deploy.js scripts/deploy-integrity.js deploy.sh package.json test/salesFactsDeploy.test.js test/deployGuardStructure.test.js test/deployIntegrity.test.js
git commit -m "build: guard sales facts sqlite deployment"
```

---

### Task 15: Living docs, complete verification, desktop browser check, and review

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `SERVER_DEPLOYMENT.md`
- Modify: `docs/superpowers/specs/2026-08-13-sales-facts-sqlite-design.md` only after the user approves a discovered contract clarification
- Create: `.superpowers/sdd/2026-08-13-sales-facts-sqlite/final-report.md` (ignored working evidence)

- [ ] **Step 1: Update operational truth**

Document database path, schemas, TTL/frozen semantics, owner history, preflight command and approved artifact, force routes, health fields, rollback boundary, no JSON fallback, and old-file read-only state. Do not claim old JSON is deleted.

- [ ] **Step 2: Run focused suites by gate**

```bash
node --test test/salesFactsIdentity.test.js test/salesFactsMetrics.test.js \
  test/salesFactsRepository.test.js test/salesFactsOrderProfitValidator.test.js \
  test/salesFactsPreflightCli.test.js test/listingOwnerHistoryService.test.js

node --test test/salesFactsUpstreamService.test.js test/salesFactsSyncService.test.js \
  test/salesFactsQueryService.test.js test/salesDerivedCacheService.test.js \
  test/salesFactsShadowService.test.js test/salesFactsRoutes.test.js

node --test test/salesFactsWeeklyConsumer.test.js test/salesFactsMonthlyConsumer.test.js \
  test/salesWeeklySourceCache.test.js test/storeOperatingMonthlyReportService.test.js \
  test/storeOperatingMonthlyReportMapper.test.js test/salesReview30dRefundRate.test.js

node --test test/salesFactsDeploy.test.js test/deployGuardStructure.test.js \
  test/deployIntegrity.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js
```

Expected: all PASS.

- [ ] **Step 3: Run complete non-narrow verification**

```bash
node --test test/*.test.js
npm run check
git diff --check
```

Do not run `npm test` if its browser script contains narrow viewport assertions. Run the pure Node suite and desktop-only browser verification separately.

- [ ] **Step 4: Desktop browser verification only**

At a desktop viewport, verify sales weekly and monthly report render without console errors; query and explicit force requests contain exact date/SID/currency fields; busy state prevents duplicate submit; controlled 502/503 does not expose secrets; successful response shows source/cacheState/updatedAt. Do not execute narrow-screen checks or responsive assertions.

- [ ] **Step 5: Run package dry guard without production deploy**

From a clean committed feature branch use only non-production packaging with explicit branch confirmation, inspect the manifest/archive for the sales smoke/capability, then delete the temporary archive. Do not SSH, PM2 restart, or call production during implementation review.

- [ ] **Step 6: Request two-axis code review**

Review since the design commit `1e88b3a` along Standards and Spec axes. Resolve every Critical/Important finding with new RED tests and separate fix commits. Re-run affected focused suites and the complete pure Node suite.

- [ ] **Step 7: Commit documentation**

```bash
git add AGENTS.md README.md SERVER_DEPLOYMENT.md
git commit -m "docs: document sales facts sqlite operations"
```

## Final Merge and Production Gate

Only after all task reviews are APPROVED:

1. Confirm feature branch clean and based on current `origin/main`; rerun pure Node/full checks after merge in a main worktree.
2. Push `main`, fetch, and assert `HEAD == origin/main`.
3. Generate the default package from clean `main` with `DEPLOY_CONFIRM_BRANCH=main`. Do not include CSS unless an actual CSS change was reviewed; this plan expects none.
4. Inspect manifest branch/commit/clean/capabilities and archive contents.
5. Deploy through `deploy.sh`; never hand-copy runtime files.
6. Require both productCatalog and salesFacts nested health healthy, SQLite quick/integrity checks, schema/revision/counts, PM2 stability, and deployed integrity.
7. Observe logs for rate limits, database locks, contract mismatches, owner anomalies, stale fallbacks, and uncaught errors. Roll back the application explicitly on failure; do not rewrite SQLite manually.

## Plan Completion Criteria

- Gate A preflight approved with zero multiple owners and an explicit `monthly|daily` fetch mode.
- Facts/coverage/custom fees/owners/revisions have repository and rollback tests.
- Weekly and monthly consumers share facts and no runtime JSON fallback remains.
- Current/previous/frozen month policies and CNY/ORIGINAL isolation are executable tests.
- Owner history is joined by fact date and current owners never overwrite history.
- All errors are fail-closed, redacted, and observable with requestId/operation/code/timings.
- Deployment smoke and nested health guard the new SQLite before PM2 success.
- Pure Node full suite, checks, desktop verification, package inspection, and two-axis review pass.
- No narrow-screen test is run.

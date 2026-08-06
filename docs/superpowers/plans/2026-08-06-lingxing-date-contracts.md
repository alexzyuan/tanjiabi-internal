# 领星日期契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lingxing date handling endpoint-specific so only officially documented left-closed/right-open APIs receive an exclusive end-date conversion, while all other APIs preserve the user-selected end date.

**Architecture:** Keep the shared date parser and date arithmetic in `src/utils/lingxingDateRange.js`, add an immutable endpoint contract registry there, and require adapter methods to pass their endpoint into the shared request-date builder. Record the official contract matrix in `docs/lingxing-date-rules.md` and mirror the policy in `AGENTS.md`; no frontend date state or unrelated business-date calculations change.

**Tech Stack:** Native JavaScript ES modules, Node `node:test`, Markdown project documentation.

---

### Task 1: Replace the global exclusive helper with endpoint contracts

**Files:**
- Modify: `src/utils/lingxingDateRange.js`
- Test: `test/lingxingDateRange.test.js`

- [x] **Step 1: Write failing contract tests**

Add tests that import `LINGXING_DATE_CONTRACTS`, `getLingxingDateContract`, and `withLingxingDateContract` and assert:

```js
test("only documented exclusive endpoints add one day", () => {
  assert.equal(withLingxingDateContract("/erp/sc/data/mws/orders", {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  }).end_date, "2026-08-01");
  assert.equal(withLingxingDateContract("/bd/profit/report/open/report/seller/list", {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).endDate, "2026-07-31");
  assert.equal(withLingxingDateContract("/unknown", {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  }).end_date, "2026-07-31");
});
```

Also assert the FBA extra date key is converted, the OrderProfit month end is unchanged, invalid dates throw, and the input object is not mutated.

- [x] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
node --test test/lingxingDateRange.test.js
```

Expected: FAIL because the contract registry and endpoint-aware helper do not exist yet.

- [x] **Step 3: Implement the endpoint registry and shared builder**

In `src/utils/lingxingDateRange.js`:

1. Keep `addDaysToDateText` and `lingxingExclusiveEndDate` for the arithmetic primitive.
2. Add frozen entries for the current adapter endpoints:
   - `exclusive`: `/erp/sc/data/mws/orders`, `/erp/sc/data/fba_report/shipmentList`, with `end_date` and FBA `end_extra_date`.
   - `inclusive`: seller profit statistics, seller profit report, OrderProfit MSKU, order profit order view, product performance, purchase orders, inventory ledger, all three documented payable pools, and store sales if registered by the adapter.
   - `undocumented`: listings, ad portfolios, return analysis, Review, settlement summary.
3. Add `getLingxingDateContract(endpoint)` returning the registered contract or a frozen undocumented default.
4. Add `withLingxingDateContract(endpoint, params)` that clones `params`, converts only keys declared by an `exclusive` contract, and emits a debug-level `console.debug` record containing endpoint, boundary, visible end and API end. Do not log auth data.
5. Keep `withLingxingExclusiveEndDate` as a compatibility wrapper only if existing consumers require it; make it require an explicit endpoint or remove all consumers in Task 2 before deleting it.

- [x] **Step 4: Run the focused tests and refactor only after green**

Run:

```bash
node --test test/lingxingDateRange.test.js
```

Expected: PASS with all existing validation tests and the new contract tests.

### Task 2: Route every adapter date call through the contract registry

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Test: `test/lingxingAdapter.test.js`

- [x] **Step 1: Update adapter tests to express endpoint-specific behavior**

Change tests that currently expect generic exclusive behavior so they assert:

```js
assert.equal(calls[0].params.end_date, "2026-07-15"); // orders/FBA
assert.equal(calls[0].params.endDate, "2026-07-14"); // seller profit/order profit/product performance
assert.equal(calls[0].params.end_date, "2026-07-14"); // inclusive snake-case endpoints
```

Add one test per affected adapter method for seller profit statistics, product performance, return analysis, Review, settlement summary, purchase orders, and inventory ledger. Keep the existing OrderProfit regression test asserting `2026-07-14` is sent unchanged.

- [x] **Step 2: Run the focused adapter tests and verify they fail**

Run:

```bash
node --test test/lingxingAdapter.test.js
```

Expected: FAIL only on assertions that still observe the old global `+1` behavior.

- [x] **Step 3: Replace the adapter helper with explicit endpoint calls**

Change the local helper to accept an endpoint and delegate to `withLingxingDateContract(endpoint, params)`. Update each date-bearing method to pass its exact endpoint. Use plain params for methods that have no documented date-range contract.

For the three payable pool methods, send the official fields expected by their documents:

- purchase/prepay: `start_time`, `end_time`, `time_field`;
- logistics: `start_time`, `end_time`, `search_field_time`;
- custom fee: `start_time`, `end_time`, `search_field_time`.

Do not send the old `created_start_time`/`created_end_time` aliases from the adapter. Keep pagination and response handling unchanged.

- [x] **Step 4: Run the focused adapter tests and verify they pass**

Run:

```bash
node --test test/lingxingAdapter.test.js
```

Expected: PASS, including no mutation of UI filters and no `+1` for inclusive/undocumented endpoints.

### Task 3: Update payable-service request construction and contract documentation

**Files:**
- Modify: `src/services/payablesService.js`
- Test: `test/payablesService.test.js`
- Create: `docs/lingxing-date-rules.md`
- Modify: `AGENTS.md`

- [x] **Step 1: Add a request-shape regression test**

Extend `test/payablesService.test.js` with an injected Lingxing adapter that captures the request from all three pool methods. Assert the visible range remains `2026-07-01` through `2026-07-31` and the adapter receives the official date parameter names without the legacy `created_*` fields.

- [x] **Step 2: Run the payable-service test and verify it fails**

Run:

```bash
node --test test/payablesService.test.js
```

Expected: FAIL because `buildRequestParams` currently creates multiple legacy date aliases.

- [x] **Step 3: Simplify `buildRequestParams` to the official field set**

Make `buildRequestParams` accept the pool kind and produce only the documented fields for that kind. Preserve offset, length, keyword search fields, and status filters. Do not add one day in the service; date normalization remains user-facing and the adapter contract owns API conversion.

- [x] **Step 4: Write the official contract matrix**

Create `docs/lingxing-date-rules.md` with one table per boundary type. Each row must include endpoint, adapter method, date parameter names, official doc link, and whether the API end date is transformed. Include the rule that unknown endpoints default to `undocumented`/no conversion and list the OrderProfit MSKU official double-closed rule.

- [x] **Step 5: Update `AGENTS.md` as the living source-of-truth pointer**

Replace the current generic “all left-closed/right-open APIs” paragraph with the endpoint-contract policy, link to `docs/lingxing-date-rules.md`, and explicitly state that no adapter may hand-roll `+1` or pass legacy payable date aliases.

- [x] **Step 6: Run focused tests**

Run:

```bash
node --test test/payablesService.test.js test/lingxingDateRange.test.js test/lingxingAdapter.test.js
```

Expected: PASS.

### Task 4: Full verification and review checkpoint

**Files:**
- No additional production files unless verification exposes a direct regression.

- [x] **Step 1: Run syntax and full tests**

Run:

```bash
npm run check
npm test
```

Expected: exit code 0, zero failed tests, and browser CSS verification still completes.

- [x] **Step 2: Audit remaining date conversions**

Run:

```bash
rg -n "withLingxingExclusiveEndDate|lingxingExclusiveEndDate|endDate.*\+|end_date.*\+|created_end_time" src routes assets test
```

Expected: only the shared date utility and tests/documentation mention conversion; no feature service or adapter method hand-rolls a date increment.

- [x] **Step 3: Review the diff and deployment status**

Run:

```bash
git diff --check
git status --short --branch
```

Do not deploy in this task because the user requested the shared rule implementation, not a production release. If the user later requests deployment, package only from a clean committed worktree through the guarded deployment scripts.

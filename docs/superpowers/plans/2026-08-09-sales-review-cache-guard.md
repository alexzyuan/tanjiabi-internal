# Sales Review Cache Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject incomplete sales-review source caches and require an authenticated post-deploy response to expose `refundRate30d`.

**Architecture:** `dashboardService` owns a versioned source-cache contract and rejects entries that cannot support the 30-day refund metric. `deploy-integrity` authenticates through the existing local password endpoint using runtime-only environment configuration, then validates the sales-review response contract.

**Tech Stack:** Node.js ESM, node:test, native `fetch`, existing deployment shell script.

---

### Task 1: Guard the source-cache contract

**Files:**
- Modify: `src/services/dashboardService.js`
- Modify: `test/salesWeeklySourceCache.test.js`

- [ ] **Step 1: Write a failing cache-contract regression test**

Add a test that creates a source cache scoped to `sales-weekly-source-v3` but omits `recent30OrderProfitRecords` and `raw.recent30`, then asserts the exported validator rejects it with both missing-field reasons.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/salesWeeklySourceCache.test.js`

Expected: the new assertion fails because no cache-contract validator exists.

- [ ] **Step 3: Implement the minimal contract**

Set the cache scope version to `sales-weekly-source-v3`. Export a validator that requires the matching scope version, an array `recent30OrderProfitRecords`, and `raw.recent30` with valid dates and a non-negative numeric `recordCount`. In `getSalesWeeklyDashboard`, log and discard invalid entries before any cache-hit mapping.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/salesWeeklySourceCache.test.js`

Expected: all sales-weekly source-cache tests pass.

### Task 2: Guard deployment with an authenticated sales-review request

**Files:**
- Modify: `scripts/deploy-integrity.js`
- Modify: `test/deployIntegrity.test.js`
- Modify: `.env.example`

- [ ] **Step 1: Write a failing deployment-smoke test**

Add a test for an exported sales-review verifier with mocked login and dashboard responses. Assert it rejects a detail row that omits `refundRate30d`, and accepts a row declaring it as `null` or a number.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/deployIntegrity.test.js`

Expected: the new test fails because the sales-review verifier does not exist.

- [ ] **Step 3: Implement the minimal authenticated verifier**

Read `DEPLOY_SALES_REVIEW_SMOKE_USERNAME` and `DEPLOY_SALES_REVIEW_SMOKE_PASSWORD`, falling back to `AUTH_USERNAME` and `AUTH_PASSWORD` via the shared configuration reader. Log in at `/api/auth/password/login`, retain only the session cookie in memory, request `/api/dashboard/sales-weekly` for explicit CNY dates, and append a deployment error when login, response shape, or the `refundRate30d` property is invalid. Add documented `.env.example` entries without values.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/deployIntegrity.test.js`

Expected: all deployment-integrity tests pass.

### Task 3: Verify and publish

**Files:**
- Verify only: `src/services/dashboardService.js`, `scripts/deploy-integrity.js`, tests, deployment package

- [ ] **Step 1: Run the complete project checks**

Run: `npm run check && npm test`

Expected: all checks pass with zero test failures.

- [ ] **Step 2: Commit the implementation**

Run: `git add src/services/dashboardService.js scripts/deploy-integrity.js .env.example test/salesWeeklySourceCache.test.js test/deployIntegrity.test.js docs/superpowers/plans/2026-08-09-sales-review-cache-guard.md && git commit -m "fix: guard sales review cache and deploy smoke"

- [ ] **Step 3: Merge and deploy only from clean main**

Fast-forward `main`, push it, run `DEPLOY_CONFIRM_BRANCH=main npm run package:deploy`, then use `deploy.sh` on the server. The deployment must fail if the authenticated smoke request cannot validate the metric contract.

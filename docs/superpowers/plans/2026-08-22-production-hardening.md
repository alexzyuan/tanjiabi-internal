# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four highest-value production risks found in the repository review while keeping every change independently testable and reversible.

**Architecture:** Keep authentication persistence in `authUserService`, runtime policy in `src/config`, HTTP proxy safeguards in a focused image-cache service, and route authorization in the route table. Each goal follows a red-green test cycle and receives its own commit.

**Tech Stack:** Node.js 22+, native ES modules, `node:test`, native `fetch`, existing JSON atomic-store utilities, PM2 deployment scripts.

**Spec:** `AGENTS.md` and the approved review goals in Codex task `01a023b4-f9f3-7e03-8cf5-04198b350bc7`.

## Global Constraints

- Errors never pass silently; only `ENOENT` may represent a missing optional JSON store.
- Do not return mock BI data in production.
- Do not expose raw upstream financial records, credentials, tokens, or error payloads.
- Keep API routing and authorization in route modules or `server.js`; keep reusable network logic in `src/services`.
- Write a failing behavior test before each production behavior change.
- Keep commits scoped to one goal and run `git diff --check` before every commit.

---

### Goal G0: Correct buyer shipping mapping

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Modify: `src/services/lingxingDashboardMapper.js`
- Test: `test/shippingCostMapping.test.js`

**Interfaces:**
- Consumes: Lingxing `shipping_cost`, `logistics_costs`, and `cgTransportCostsTotal` fields.
- Produces: `shipping_cost` remains buyer shipping; only documented first-leg fields populate `firstLegCost`.

- [x] Add regression tests proving `shipping_cost` and `shippingCost` do not contribute to first-leg cost.
- [x] Remove the two buyer-shipping aliases from first-leg normalization.
- [x] Run the mapping, adapter, and monthly-report tests.
- [x] Commit as `fix: separate buyer shipping from first-leg cost` (`e2c4da5`).

### Goal G1: Make authentication storage fail closed

**Files:**
- Modify: `src/services/authUserService.js`
- Modify: `src/config/index.js`
- Modify: `server.js`
- Test: `test/authUserService.test.js`
- Test: `test/serverSecurity.test.js`

**Interfaces:**
- Consumes: `data-cache/auth-users.json`, `data-cache/dingtalk-auth-users.json`, `AUTH_ENABLED`, and the selected runtime provider.
- Produces: validated account arrays, atomic account writes, and an authentication policy independent of parsed account-file contents.

- [x] Add a failing service test that writes malformed JSON and expects list/login/create operations to reject without overwriting the file.
- [x] Add a failing server test proving a malformed managed-user file cannot make a protected route public.
- [x] Replace catch-all reads with strict JSON reads; validate that the root is an object and `users` is an array.
- [x] Replace direct account-file writes with `writeJsonAtomic(path, { users })`.
- [x] Add startup validation for existing account stores and make production authentication default enabled.
- [x] Remove `hasManagedAuthUsers()` from the `isAuthEnabled()` security decision.
- [x] Run `node --test test/authUserService.test.js test/serverSecurity.test.js` and commit `fix: fail closed on damaged auth stores` (`520ddb0`).

### Goal G2: Prevent production mock-data fallback

**Files:**
- Modify: `src/config/index.js`
- Modify: `routes/core.js`
- Modify: `scripts/deploy-integrity.js`
- Modify: `deploy.sh`
- Modify: `.env.example`
- Test: `test/configProduction.test.js`
- Test: `test/deployIntegrity.test.js`

**Interfaces:**
- Consumes: `NODE_ENV`, `DATA_PROVIDER`, `LINGXING_APP_KEY`, and `LINGXING_APP_SECRET`.
- Produces: a validated runtime provider and health metadata that deployment verification can enforce.

- [x] Add failing configuration tests for production with missing `DATA_PROVIDER`, `DATA_PROVIDER=mock`, and incomplete Lingxing credentials.
- [x] Add a failing deployment-integrity test for `health.provider !== "lingxing"` or a non-explicit production provider.
- [x] Resolve the provider with this policy:

```js
if (production && explicitProvider !== "lingxing") throw configurationError;
if (production && provider === "lingxing" && (!appKey || !appSecret)) throw configurationError;
if (!production && !explicitProvider) provider = "mock";
```

- [x] Expose only safe runtime policy fields in `/api/health`: environment, provider, and explicit-provider status.
- [x] Export `NODE_ENV=production` in `deploy.sh` before PM2 restart and integrity checks.
- [x] Update `.env.example` so production instructions require `DATA_PROVIDER=lingxing` while local examples explicitly use `mock`.
- [x] Run configuration and deployment tests, then commit `fix: reject mock provider in production` (`70b030a`).

### Goal G3: Harden the image cache proxy

**Files:**
- Create: `src/services/imageCacheProxyService.js`
- Modify: `server.js`
- Test: `test/imageCacheProxyService.test.js`
- Test: `test/serverSecurity.test.js`

**Interfaces:**
- Consumes: an HTTP(S) image URL and injected `fetch`/DNS dependencies for tests.
- Produces: a validated image response or a controlled error without accessing private networks or consuming unbounded resources.

- [x] Add failing tests for a public URL redirecting to loopback, excessive redirects, timeout, misleading `Content-Length`, and streamed bytes over the limit.
- [x] Implement manual redirect traversal with a maximum of three hops and validate protocol plus DNS/IP on every hop.
- [x] Fetch with `redirect: "manual"` and an abort timeout; reject missing/invalid redirect locations.
- [x] Reject responses larger than 8 MiB using both `Content-Length` and streamed byte counting.
- [x] Stream to a unique temporary file and atomically rename only after content-type and byte-count validation.
- [x] Keep error responses controlled and ensure temporary files are removed after failure.
- [x] Run image proxy and server security tests, then commit `fix: constrain image cache proxy requests` (`3da1c72`).

### Goal G4: Lock down financial debug APIs

**Files:**
- Modify: `src/config/index.js`
- Modify: `routes/debug-knowledge.js`
- Modify: `src/adapters/lingxingAdapter.js`
- Modify: `.env.example`
- Test: `test/debugKnowledgeRoutes.test.js`
- Test: `test/lingxingAdapter.test.js`

**Interfaces:**
- Consumes: authenticated administrator identity, `LINGXING_FINANCE_DEBUG_ENABLED`, and safe date filters.
- Produces: rate-limited diagnostic metadata containing counts and field names but no upstream records or raw error details.

- [x] Add failing route tests proving ordinary sessions cannot access financial debug endpoints and disabled endpoints are not registered.
- [x] Add failing adapter tests with embedded secrets and assert diagnostic results contain no `sample`, `details`, raw message, token, or password value.
- [x] Register the two financial debug routes only when `LINGXING_FINANCE_DEBUG_ENABLED=true` and mark them `auth: "admin"`.
- [x] Limit each actor to five financial debug requests per minute and return controlled HTTP 429 after the limit.
- [x] Log actor, endpoint, date range, result state, and duration without request/response payloads.
- [x] Return only endpoint, request variant name, status, row count, totals, top-level keys, and sample field names.
- [x] Run route and adapter tests, then commit `fix: lock down Lingxing finance diagnostics` (`20377d6`).

### Goal G5: Final verification and delivery

**Files:**
- Review all files changed since `e2c4da5^`.

**Interfaces:**
- Consumes: the completed G0-G4 commits.
- Produces: fresh verification evidence, a clean review summary, and deployment handoff status.

- [x] Run focused security tests for every goal (104/104 passed before the final image hardening follow-ups).
- [x] Run `npm test` and confirm zero failures (1267/1267 Node tests plus browser CSS verification).
- [x] Run `npm run check` and confirm zero failures.
- [x] Run `git diff --check` and inspect `git diff main...HEAD` for secrets and unrelated changes.
- [x] Confirm the worktree is committed before considering a deployment package; package creation must still satisfy the repository deployment guard.
- [x] Mark the Codex goal complete only after all required work and verification are finished.

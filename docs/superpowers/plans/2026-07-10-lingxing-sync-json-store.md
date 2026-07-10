# Lingxing Sync JSON Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Lingxing request primitives out of the monolithic adapter, persist sync job history, and add JSON-store-backed job locking without changing current API shapes or UI.

**Architecture:** Keep `src/adapters/lingxingAdapter.js` as the compatible facade. New `src/adapters/lingxing/*` modules own auth, signing, request error normalization, pagination, and request execution. New `src/utils/jsonStore.js`, `src/repositories/syncJobRepository.js`, and `src/jobs/jobLock.js` provide the storage boundary for sync history and lock state.

**Tech Stack:** Node.js ESM, native `node:test`, JSON files under `data-cache/`, existing native HTML/CSS/JS frontend unchanged.

---

## File Structure

- Create `src/adapters/lingxing/errors.js`: redact sensitive values and normalize HTTP/network/API errors.
- Create `src/adapters/lingxing/sign.js`: build signed Lingxing request parameters with the existing signature helper.
- Create `src/adapters/lingxing/auth.js`: shared token state, token fetch, token refresh, expiry handling.
- Create `src/adapters/lingxing/pagination.js`: offset/page/cursor pagination helper around adapter calls.
- Create `src/adapters/lingxing/client.js`: request timeout, retry, JSON parsing, normalized errors, token injection.
- Create `src/adapters/lingxing/index.js`: public exports for the new Lingxing primitives.
- Modify `src/adapters/lingxingAdapter.js`: delegate token/sign/request responsibilities to new modules while keeping current method names.
- Create `src/utils/jsonStore.js`: atomic JSON read/write/update/backup/recovery primitives.
- Create `src/repositories/syncJobRepository.js`: file paths and persistence for sync job history.
- Create `src/jobs/jobLock.js`: TTL lock acquire/release/with wrapper.
- Modify `src/services/syncService.js`: record manual/scheduled/startup job history and use job lock.
- Modify `routes/core.js`: expose recent sync history through `/api/sync/status` without removing existing fields.
- Modify `server.js`: pass the new async sync status dependency if needed.
- Test files: `test/lingxingClient.test.js`, `test/jsonStore.test.js`, `test/jobLock.test.js`, `test/syncJobRepository.test.js`, and extend `test/syncService.test.js`.

## Tasks

### Task 1: Lingxing Client Primitives

**Files:**
- Create: `test/lingxingClient.test.js`
- Create: `src/adapters/lingxing/errors.js`
- Create: `src/adapters/lingxing/sign.js`
- Create: `src/adapters/lingxing/auth.js`
- Create: `src/adapters/lingxing/pagination.js`
- Create: `src/adapters/lingxing/client.js`
- Create: `src/adapters/lingxing/index.js`
- Modify: `src/adapters/lingxingAdapter.js`

- [ ] Write failing tests for redaction, timeout classification, retry attempts, API error normalization, and offset pagination.
- [ ] Run `node --test test/lingxingClient.test.js` and confirm failures are missing exports or missing behavior.
- [ ] Implement the modules with no fallback swallowing: failed token/request errors throw normalized errors.
- [ ] Delegate `LingxingAdapter.fetchToken`, `refreshToken`, `ensureAccessToken`, `performSignedRequest`, and `signedRequest` to the new primitives.
- [ ] Run `node --test test/lingxingClient.test.js test/lingxingAdapter.test.js`.

### Task 2: JSON Store

**Files:**
- Create: `test/jsonStore.test.js`
- Create: `src/utils/jsonStore.js`

- [ ] Write failing tests for fallback reads, atomic writes preserving old content after stringify failure, parse failure classification, recovery from `.bak`, and sequential `updateJsonAtomic`.
- [ ] Run `node --test test/jsonStore.test.js` and confirm missing module failures.
- [ ] Implement `readJson`, `writeJsonAtomic`, `updateJsonAtomic`, `backupJson`, and `readJsonWithRecovery`.
- [ ] Run `node --test test/jsonStore.test.js`.

### Task 3: Sync Job Repository

**Files:**
- Create: `test/syncJobRepository.test.js`
- Create: `src/repositories/syncJobRepository.js`

- [ ] Write failing tests for start, finish success, finish failed, skipped records, and recent-history ordering.
- [ ] Run `node --test test/syncJobRepository.test.js` and confirm missing module failures.
- [ ] Implement the repository using `jsonStore` only; do not let services write raw JSON.
- [ ] Run `node --test test/syncJobRepository.test.js`.

### Task 4: Job Lock

**Files:**
- Create: `test/jobLock.test.js`
- Create: `src/jobs/jobLock.js`

- [ ] Write failing tests for successful acquire/release, failed duplicate acquire, expired lock takeover, `withJobLock` release on success, and `withJobLock` release on throw.
- [ ] Run `node --test test/jobLock.test.js` and confirm missing module failures.
- [ ] Implement TTL lock storage with atomic repository updates.
- [ ] Run `node --test test/jobLock.test.js`.

### Task 5: Sync Service Integration

**Files:**
- Modify: `test/syncService.test.js`
- Modify: `src/services/syncService.js`
- Modify: `routes/core.js`
- Modify: `server.js` only if dependency wiring requires it

- [ ] Write failing tests that manual sync records success, duplicate sync records skipped, failures record `errorSummary`, and startup/scheduled trigger types are distinguishable.
- [ ] Run `node --test test/syncService.test.js` and confirm the expected failures.
- [ ] Add `runSync({ triggerType, triggeredBy })`, keep `runManualSync()` compatible, and make scheduler use `startup` then `scheduled`.
- [ ] Add async recent-history support to sync status without removing existing top-level status fields.
- [ ] Run `node --test test/syncService.test.js test/serverRoutesStructure.test.js test/serverSecurity.test.js`.

### Task 6: Documentation And Verification

**Files:**
- Modify: `PROJECT_STRUCTURE.md`
- Modify: `README.md` only if operational commands change

- [ ] Document current JSON persistence strategy, repository boundary, sync job history, and local lock TTL limitations.
- [ ] Run `npm run check:js`.
- [ ] Run `node scripts/build-styles.js --check`.
- [ ] Run `npm test`; classify existing CSS structure failures separately if they remain.

## Self-Review

- Round 2 coverage: new Lingxing client/auth/sign/pagination/errors modules, compatible facade, job history, API-accessible history, tests.
- Round 3 coverage: `jsonStore`, repository boundary for sync jobs, job lock, sync integration, docs.
- Intentional gap: bulk migration of every high-value service repository is deferred to smaller follow-up slices to avoid unbounded business-risk changes in this copied non-git workspace.
- Git gap: this workspace has no `.git`, so branch creation and commits cannot be performed here.

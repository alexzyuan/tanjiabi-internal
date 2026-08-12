# Legacy Product Catalog Cache Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-fast, read-only-by-default CLI that proves the two legacy product-catalog JSON directories are safe to retire and can create a verified external archive without moving or deleting production data.

**Architecture:** A focused retirement service owns manifest reuse, release-capability validation, SQLite health checks, archive construction and verification. The CLI only validates arguments, builds dependencies and emits redacted structured results. The deploy package manifest advertises the SQLite capability so the retirement gate can require three retained compatible releases.

**Tech Stack:** Node.js ES modules, `better-sqlite3`, core `fs/crypto/child_process`, system `tar`, Node test runner.

---

## File structure

- Create `src/services/productCatalogLegacyRetirementService.js`: retirement eligibility, stable legacy scan, archive manifest, archive verification and operation lock.
- Create `scripts/retire-product-catalog-legacy-cache.js`: `--dry-run`/`--archive` CLI and controlled output.
- Create `test/productCatalogLegacyRetirement.test.js`: hermetic service and CLI behavior.
- Modify `src/services/productCatalogLegacyMigrationService.js`: export stable manifest read metadata needed by retirement; keep one hash algorithm.
- Modify `scripts/package-deploy.js`: advertise `product-catalog-sqlite-v1` in future deployment manifests.
- Modify `test/productCatalogDeploy.test.js`: characterize deploy capability metadata.
- Modify `package.json`: add explicit dry-run and archive npm commands.
- Modify `README.md`, `SERVER_DEPLOYMENT.md`, and `AGENTS.md`: document that retirement is manual and archive-only in phase one.

### Task 1: Reusable manifest and eligibility boundary

**Files:**
- Create: `src/services/productCatalogLegacyRetirementService.js`
- Modify: `src/services/productCatalogLegacyMigrationService.js`
- Test: `test/productCatalogLegacyRetirement.test.js`

- [ ] **Step 1: Write failing tests for stable manifest details and eligibility**

Create temporary shared/supplier JSON directories and a temporary repository. Assert that `inspectLegacyProductCatalogRetirement()` returns `eligible: true` only when:

```js
assert.equal(result.manifestHash, repository.getMetadata("legacy_manifest_hash"));
assert.equal(result.fileCount, 2);
assert.equal(result.releaseCount, 3);
assert.equal(result.checks.every((check) => check.ok), true);
```

Add table-driven failures for unhealthy SQLite, manifest mismatch, a file newer than migration, fewer than three compatible releases, less than 30 stable days, unexpected files and symbolic links. Every failed check must reject with a typed `ProductCatalogLegacyRetirementError` containing a fixed `code` and no file contents.

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogLegacyRetirement.test.js`

Expected: FAIL with missing retirement module/export.

- [ ] **Step 3: Export the existing manifest entry builder without changing its hash**

In `productCatalogLegacyMigrationService.js`, export the deterministic manifest builder and include stable public entry fields only:

```js
{
  source,
  name,
  filePath,
  size,
  mtimeMs,
}
```

The retirement service must call this helper before and after its read-only inspection and require equal hashes. It must not implement a second manifest hash format.

- [ ] **Step 4: Implement retirement inspection**

Implement:

```js
export async function inspectLegacyProductCatalogRetirement({
  repository,
  sharedDir,
  supplierDir,
  releasesDir,
  firstSqliteLiveAtMs,
  now = Date.now,
  minimumStableDays = 30,
  minimumCompatibleReleases = 3,
  buildManifest = buildLegacyProductCatalogManifest,
} = {})
```

Validate fixed roots, regular `.json` files, no symlinks/unexpected entries, healthy SQLite, matching metadata hash, maximum mtime not newer than migration, stable double scan, stable duration and compatible release manifests. Return a whitelist report; throw on any failed prerequisite.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/productCatalogLegacyRetirement.test.js test/productCatalogLegacyMigration.test.js`

Expected: PASS.

Commit: `feat: inspect legacy product cache retirement`

### Task 2: Deployment capability evidence

**Files:**
- Modify: `scripts/package-deploy.js`
- Modify: `test/productCatalogDeploy.test.js`
- Test: `test/productCatalogLegacyRetirement.test.js`

- [ ] **Step 1: Write failing capability tests**

Assert newly generated `.deploy-manifest.json` contains:

```js
capabilities: ["product-catalog-sqlite-v1"]
```

Create three release directories with valid manifests and assert inspection succeeds. Missing, malformed, duplicate or capability-free manifests must fail with a controlled release eligibility code.

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogDeploy.test.js test/productCatalogLegacyRetirement.test.js`

Expected: FAIL because deploy manifests do not advertise the capability.

- [ ] **Step 3: Add capability to generated manifests**

Add one stable capability array in `scripts/package-deploy.js`. Do not change deployment guards, archive inclusions, CSS rules or branch validation.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/productCatalogDeploy.test.js test/deployGuardStructure.test.js test/productCatalogLegacyRetirement.test.js`

Expected: PASS.

Commit: `build: advertise product catalog sqlite capability`

### Task 3: Verified archive and operation lock

**Files:**
- Modify: `src/services/productCatalogLegacyRetirementService.js`
- Modify: `test/productCatalogLegacyRetirement.test.js`

- [ ] **Step 1: Write failing archive tests**

Assert `archiveLegacyProductCatalog()`:

- runs inspection before writing;
- archives only the two fixed relative directories;
- records per-file relative path, size, mtime and SHA-256;
- verifies archive members and extracted bytes;
- publishes `legacy-product-catalog.tar.gz` and `retirement-manifest.json` atomically;
- leaves both source directories byte-identical;
- returns the same result for an already-valid retirement ID;
- rejects conflicting existing archives;
- always removes temporary files and releases its lock;
- exposes both operation and cleanup failures with `AggregateError`.

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogLegacyRetirement.test.js`

Expected: FAIL with missing archive function.

- [ ] **Step 3: Implement archive construction and verification**

Implement:

```js
export async function archiveLegacyProductCatalog({
  archiveRoot,
  ...inspectionOptions
} = {})
```

Use `spawnFile("tar", args)` or injected process seam with argument arrays, never a shell command string. Hash source files, create the archive in a temporary directory, list and extract members for verification, hash the final archive, write the manifest atomically, then rename the completed directory. Reject unsafe member names and any member outside the two fixed roots.

- [ ] **Step 4: Implement exclusive lock and cleanup**

Use `open(lockPath, "wx")`; record a safe operation ID and PID. Do not auto-delete existing locks. On every path close handles and remove only the lock created by this process. Use all-settled cleanup and aggregate failures.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/productCatalogLegacyRetirement.test.js`

Expected: PASS.

Commit: `feat: archive legacy product catalog caches`

### Task 4: CLI, npm scripts and safe observability

**Files:**
- Create: `scripts/retire-product-catalog-legacy-cache.js`
- Modify: `package.json`
- Modify: `test/productCatalogLegacyRetirement.test.js`

- [ ] **Step 1: Write failing CLI tests**

Run the CLI in child processes with temporary app/archive/release paths. Cover:

```text
--dry-run
--archive
unknown argument
missing first SQLite live timestamp
failed eligibility
archive path inside APP_DIR
```

Success stdout must be parseable JSON and contain only safe counts/hashes/timestamps. Failures must exit nonzero and stderr must not include JSON contents, credentials or absolute legacy file paths.

- [ ] **Step 2: Run RED**

Run: `node --test test/productCatalogLegacyRetirement.test.js`

Expected: FAIL because the CLI is missing.

- [ ] **Step 3: Implement CLI and package commands**

Add:

```json
"catalog:legacy:dry-run": "node scripts/retire-product-catalog-legacy-cache.js --dry-run",
"catalog:legacy:archive": "node scripts/retire-product-catalog-legacy-cache.js --archive"
```

The CLI accepts explicit app/archive/releases/first-live inputs through reviewed environment variables, defaults to `/opt/tanjia-bi` only outside tests, creates a repository read boundary, prints one JSON result, closes the repository in `finally`, and sets `process.exitCode=1` on failure.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/productCatalogLegacyRetirement.test.js`

Expected: PASS.

Commit: `feat: add legacy product cache retirement cli`

### Task 5: Living documentation and complete verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `SERVER_DEPLOYMENT.md`
- Test: relevant catalog/deploy suites

- [ ] **Step 1: Document the phase-one boundary**

Document that only dry-run/archive exist, old source directories remain in place, archive root must be outside the app, production cleanup is not automatic, and quarantine/purge require a later approved phase. Explicitly state that SQLite, WAL/SHM, Listing XLSX and other caches are never targets.

- [ ] **Step 2: Run targeted verification**

Run:

```bash
node --test \
  test/productCatalogLegacyRetirement.test.js \
  test/productCatalogLegacyMigration.test.js \
  test/productCatalogRepository.test.js \
  test/productCatalogDeploy.test.js \
  test/deployGuardStructure.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: Node suite and existing browser CSS verification pass. No narrow viewport test is added or run for this backend-only task.

- [ ] **Step 4: Commit documentation and final cleanup**

Commit: `docs: document legacy product cache retirement`

Verify `git status --short --branch` is clean.

### Task 6: Deliver a safe source archive

**Files:**
- No tracked source changes.

- [ ] **Step 1: Create source archive from committed HEAD**

Use `git archive`, not the production deploy package, so the deliverable contains the complete committed source tree but no `.git`, `node_modules`, ignored `data-cache`, uploads, `.env`, SQLite/WAL/SHM files or local reports:

```bash
git archive --format=tar.gz \
  --prefix=bi-erp-legacy-product-cache-retirement/ \
  -o /Users/maclex/Documents/Codex/2026-04-29/bi-erp-legacy-product-cache-retirement-<short-sha>.tar.gz \
  HEAD
```

- [ ] **Step 2: Verify archive policy**

List every member and fail if it contains `.git`, `node_modules`, `data-cache`, `uploads`, `.env`, `*.sqlite`, `*-wal`, `*-shm` or nested archives. Confirm the design, plan, source, tests and package manifest are present.

- [ ] **Step 3: Compute checksum and report**

Run `shasum -a 256 <archive>` and report the absolute archive path, byte size, SHA-256, branch and commit.

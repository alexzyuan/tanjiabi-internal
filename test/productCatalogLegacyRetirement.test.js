import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import { buildLegacyProductCatalogManifest } from "../src/services/productCatalogLegacyMigrationService.js";
import {
  archiveLegacyProductCatalog,
  ProductCatalogLegacyRetirementError,
  inspectLegacyProductCatalogRetirement,
} from "../src/services/productCatalogLegacyRetirementService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 7, 12, 6, 0, 0);
const MIGRATED_AT_MS = NOW_MS - 35 * DAY_MS;
const FIRST_LIVE_AT_MS = NOW_MS - 40 * DAY_MS;
const CAPABILITY = "product-catalog-sqlite-v1";
const retirementCliPath = path.resolve(new URL("../scripts/retire-product-catalog-legacy-cache.js", import.meta.url).pathname);

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [retirementCliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function createFixture(t, { releaseCount = 3 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "legacy-retirement-"));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "legacy-retirement-archives-"));
  const sharedDir = path.join(root, "data-cache", "shared-product-catalog");
  const supplierDir = path.join(root, "data-cache", "supplier-board-product-map");
  const releasesDir = path.join(root, "releases");
  await Promise.all([
    mkdir(sharedDir, { recursive: true }),
    mkdir(supplierDir, { recursive: true }),
    mkdir(releasesDir, { recursive: true }),
  ]);
  async function writeLegacy(directory, name, value = {}) {
    const filePath = path.join(directory, name);
    await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
    await utimes(filePath, (MIGRATED_AT_MS - DAY_MS) / 1000, (MIGRATED_AT_MS - DAY_MS) / 1000);
    return filePath;
  }
  await writeLegacy(sharedDir, "shared.json", { data: { records: [] } });
  await writeLegacy(supplierDir, "supplier.json", { data: { records: [] } });
  for (let index = 1; index <= releaseCount; index += 1) {
    const releaseDir = path.join(releasesDir, `2026080${index}-120000`);
    await mkdir(releaseDir, { recursive: true });
    await writeFile(path.join(releaseDir, ".deploy-manifest.json"), JSON.stringify({
      app: "tanjia-bi",
      branch: "main",
      commit: `commit-${index}`,
      clean: true,
      confirmedBranch: "main",
      capabilities: [CAPABILITY],
    }), "utf8");
  }
  const repository = createProductCatalogRepository({
    databasePath: path.join(root, "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
    now: () => NOW_MS,
    logger: { info() {}, warn() {}, error() {} },
  });
  const manifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
  repository.upsertCatalog({
    operation: "test-metadata",
    metadata: {
      legacy_manifest_hash: manifest.hash,
      legacy_migrated_at_ms: MIGRATED_AT_MS,
    },
  });
  t.after(async () => {
    repository.close();
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(archiveRoot, { recursive: true, force: true }),
    ]);
  });
  return {
    root,
    archiveRoot,
    sharedDir,
    supplierDir,
    releasesDir,
    repository,
    manifest,
    writeLegacy,
    options: {
      repository,
      sharedDir,
      supplierDir,
      releasesDir,
      firstSqliteLiveAtMs: FIRST_LIVE_AT_MS,
      now: () => NOW_MS,
    },
  };
}

test("retirement inspection proves stable migrated JSON and three SQLite-capable releases", async (t) => {
  const fixture = await createFixture(t);
  const result = await inspectLegacyProductCatalogRetirement(fixture.options);
  assert.equal(result.eligible, true);
  assert.equal(result.manifestHash, fixture.manifest.hash);
  assert.equal(result.fileCount, 2);
  assert.equal(result.releaseCount, 3);
  assert.equal(result.checks.every((check) => check.ok), true);
  assert.equal(Object.hasOwn(result, "files"), false);
});

test("retirement inspection fails fast when prerequisites are not satisfied", async (t) => {
  const cases = [
    {
      code: "LEGACY_MANIFEST_MISMATCH",
      mutate: async (fixture) => fixture.repository.upsertCatalog({
        operation: "test-metadata",
        metadata: { legacy_manifest_hash: "0".repeat(64) },
      }),
    },
    {
      code: "SQLITE_STABILITY_WINDOW_INCOMPLETE",
      mutate: async (fixture) => { fixture.options.firstSqliteLiveAtMs = NOW_MS - 2 * DAY_MS; },
    },
    {
      code: "LEGACY_FILE_NEWER_THAN_MIGRATION",
      mutate: async (fixture) => {
        const filePath = path.join(fixture.sharedDir, "shared.json");
        await utimes(filePath, (MIGRATED_AT_MS + DAY_MS) / 1000, (MIGRATED_AT_MS + DAY_MS) / 1000);
        const manifest = await buildLegacyProductCatalogManifest(fixture);
        fixture.repository.upsertCatalog({
          operation: "test-metadata",
          metadata: { legacy_manifest_hash: manifest.hash },
        });
      },
    },
    {
      code: "LEGACY_DIRECTORY_POLICY_VIOLATION",
      mutate: async (fixture) => writeFile(path.join(fixture.sharedDir, "unexpected.txt"), "x", "utf8"),
    },
  ];
  for (const entry of cases) {
    await t.test(entry.code, async (child) => {
      const fixture = await createFixture(child);
      await entry.mutate(fixture);
      await assert.rejects(
        inspectLegacyProductCatalogRetirement(fixture.options),
        (error) => error instanceof ProductCatalogLegacyRetirementError && error.code === entry.code,
      );
    });
  }
});

test("retirement inspection rejects insufficient releases and symbolic links", async (t) => {
  await t.test("release count", async (child) => {
    const fixture = await createFixture(child, { releaseCount: 2 });
    await assert.rejects(
      inspectLegacyProductCatalogRetirement(fixture.options),
      (error) => error.code === "SQLITE_RELEASE_EVIDENCE_INSUFFICIENT",
    );
  });
  await t.test("symlink", async (child) => {
    const fixture = await createFixture(child);
    await symlink(path.join(fixture.sharedDir, "shared.json"), path.join(fixture.sharedDir, "linked.json"));
    await assert.rejects(
      inspectLegacyProductCatalogRetirement(fixture.options),
      (error) => error.code === "LEGACY_DIRECTORY_POLICY_VIOLATION",
    );
  });
});

test("retirement inspection retries a changing manifest up to three scans", async (t) => {
  const fixture = await createFixture(t);
  let calls = 0;
  const buildManifest = async (options) => {
    calls += 1;
    const manifest = await buildLegacyProductCatalogManifest(options);
    if (calls === 2) return { ...manifest, hash: "f".repeat(64) };
    return manifest;
  };
  const result = await inspectLegacyProductCatalogRetirement({
    ...fixture.options,
    buildManifest,
  });
  assert.equal(result.eligible, true);
  assert.equal(calls, 4);

  calls = 0;
  await assert.rejects(
    inspectLegacyProductCatalogRetirement({
      ...fixture.options,
      buildManifest: async (options) => {
        calls += 1;
        const manifest = await buildLegacyProductCatalogManifest(options);
        return calls % 2 === 0 ? { ...manifest, hash: `${calls}`.padStart(64, "0") } : manifest;
      },
    }),
    (error) => error.code === "LEGACY_MANIFEST_UNSTABLE",
  );
  assert.equal(calls, 6);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("verified archive contains only legacy JSON and preserves source bytes", async (t) => {
  const fixture = await createFixture(t);
  const sourceBefore = {
    shared: await readFile(path.join(fixture.sharedDir, "shared.json")),
    supplier: await readFile(path.join(fixture.supplierDir, "supplier.json")),
  };

  const result = await archiveLegacyProductCatalog({
    ...fixture.options,
    archiveRoot: fixture.archiveRoot,
  });

  assert.equal(result.archived, true);
  assert.match(result.retirementId, /^\d{8}T\d{6}Z-[a-f0-9]{12}$/);
  assert.equal(result.manifestHash, fixture.manifest.hash);
  assert.equal(result.fileCount, 2);
  assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.deepEqual(manifest.files.map((file) => file.path), [
    "shared-product-catalog/shared.json",
    "supplier-board-product-map/supplier.json",
  ]);
  assert.deepEqual(manifest.files.map((file) => file.sha256), [
    sha256(sourceBefore.shared),
    sha256(sourceBefore.supplier),
  ]);
  assert.equal(manifest.archiveSha256, result.archiveSha256);
  assert.equal(manifest.toolVersion, "0.1.0");
  assert.deepEqual(await readFile(path.join(fixture.sharedDir, "shared.json")), sourceBefore.shared);
  assert.deepEqual(await readFile(path.join(fixture.supplierDir, "supplier.json")), sourceBefore.supplier);
  assert.deepEqual((await readdir(fixture.archiveRoot)).sort(), [result.retirementId]);

  const repeated = await archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot });
  assert.equal(repeated.archiveSha256, result.archiveSha256);
  assert.equal(repeated.retirementId, result.retirementId);
});

test("archive lock and unsafe archive roots fail before touching legacy files", async (t) => {
  const fixture = await createFixture(t);
  const lockPath = `${fixture.repository.databasePath}.legacy-retirement.lock`;
  await writeFile(lockPath, "active", "utf8");
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot }),
    (error) => error.code === "RETIREMENT_LOCKED",
  );
  await rm(lockPath);
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      archiveRoot: path.join(fixture.root, "data-cache", "archives"),
    }),
    (error) => error.code === "ARCHIVE_ROOT_UNSAFE",
  );
  assert.deepEqual((await readdir(fixture.sharedDir)).sort(), ["shared.json"]);
  assert.deepEqual((await readdir(fixture.supplierDir)).sort(), ["supplier.json"]);
});

test("archive operation failure cleans temporary output and releases its lock", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      archiveRoot: fixture.archiveRoot,
      runTar: async () => { throw new Error("fixture tar failure"); },
    }),
    /fixture tar failure/,
  );
  assert.deepEqual(await readdir(fixture.archiveRoot), []);
  await assert.rejects(readFile(`${fixture.repository.databasePath}.legacy-retirement.lock`, "utf8"), {
    code: "ENOENT",
  });
});

test("retirement CLI exposes safe dry-run JSON and archive output", async (t) => {
  const fixture = await createFixture(t);
  const env = {
    PRODUCT_CATALOG_APP_DIR: fixture.root,
    PRODUCT_CATALOG_DATABASE_PATH: fixture.repository.databasePath,
    PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT: fixture.archiveRoot,
    PRODUCT_CATALOG_RELEASES_DIR: fixture.releasesDir,
    PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS: String(FIRST_LIVE_AT_MS),
    PRODUCT_CATALOG_RETIREMENT_NOW_MS: String(NOW_MS),
  };
  const dryRun = await runCli(["--dry-run"], env);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  const inspected = JSON.parse(dryRun.stdout);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.operation, "dry-run");
  assert.equal(inspected.fileCount, 2);
  assert.equal(Object.hasOwn(inspected, "archivePath"), false);
  assert.doesNotMatch(dryRun.stdout, /shared\.json|supplier\.json|data-cache/u);

  const archive = await runCli(["--archive"], env);
  assert.equal(archive.code, 0, archive.stderr);
  const archived = JSON.parse(archive.stdout);
  assert.equal(archived.ok, true);
  assert.equal(archived.operation, "archive");
  assert.match(archived.archiveSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(archive.stdout, /data-cache|shared\.json|supplier\.json/u);
});

test("retirement CLI rejects unsafe arguments without leaking paths or payloads", async (t) => {
  const fixture = await createFixture(t);
  const baseEnv = {
    PRODUCT_CATALOG_APP_DIR: fixture.root,
    PRODUCT_CATALOG_DATABASE_PATH: fixture.repository.databasePath,
    PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT: fixture.archiveRoot,
    PRODUCT_CATALOG_RELEASES_DIR: fixture.releasesDir,
    PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS: String(FIRST_LIVE_AT_MS),
    PRODUCT_CATALOG_RETIREMENT_NOW_MS: String(NOW_MS),
  };
  for (const args of [["--unknown"], ["--dry-run", "--archive"]]) {
    const result = await runCli(args, baseEnv);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /RETIREMENT_ARGUMENT_INVALID/u);
    assert.doesNotMatch(result.stderr, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  const missingTime = await runCli(["--dry-run"], {
    ...baseEnv,
    PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS: "",
  });
  assert.notEqual(missingTime.code, 0);
  assert.match(missingTime.stderr, /SQLITE_FIRST_LIVE_TIME_INVALID/u);
});

test("retirement CLI does not create a missing SQLite database during inspection", async (t) => {
  const fixture = await createFixture(t);
  const missingDatabase = path.join(fixture.root, "missing", "catalog.sqlite");
  const result = await runCli(["--dry-run"], {
    PRODUCT_CATALOG_APP_DIR: fixture.root,
    PRODUCT_CATALOG_DATABASE_PATH: missingDatabase,
    PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT: fixture.archiveRoot,
    PRODUCT_CATALOG_RELEASES_DIR: fixture.releasesDir,
    PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS: String(FIRST_LIVE_AT_MS),
    PRODUCT_CATALOG_RETIREMENT_NOW_MS: String(NOW_MS),
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SQLITE_DATABASE_MISSING/u);
  await assert.rejects(readFile(missingDatabase), { code: "ENOENT" });
});

test("retirement CLI opens the existing catalog in readonly mode", async () => {
  const source = await readFile(retirementCliPath, "utf8");
  assert.match(source, /createProductCatalogRepository\(\{[\s\S]*?readonly:\s*true/u);
});

test("retirement rejects symlinked roots and noncanonical legacy directory names", async (t) => {
  const fixture = await createFixture(t);
  const linkedRoot = `${fixture.archiveRoot}-link`;
  await symlink(fixture.archiveRoot, linkedRoot);
  t.after(() => rm(linkedRoot, { force: true }));
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: linkedRoot }),
    (error) => error.code === "ARCHIVE_ROOT_UNSAFE",
  );
  await assert.rejects(
    inspectLegacyProductCatalogRetirement({
      ...fixture.options,
      sharedDir: path.join(fixture.root, "data-cache", "not-the-shared-cache"),
    }),
    (error) => error.code === "LEGACY_DIRECTORY_INVALID",
  );
  await rm(fixture.sharedDir, { recursive: true, force: true });
  await assert.rejects(
    inspectLegacyProductCatalogRetirement(fixture.options),
    (error) => error.code === "LEGACY_DIRECTORY_INVALID",
  );
});

test("archive performs the complete eligibility check before creating an output root", async (t) => {
  const fixture = await createFixture(t);
  const missingArchiveRoot = `${fixture.archiveRoot}-not-created`;
  t.after(() => rm(missingArchiveRoot, { recursive: true, force: true }));
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      firstSqliteLiveAtMs: NOW_MS - 2 * DAY_MS,
      archiveRoot: missingArchiveRoot,
    }),
    (error) => error.code === "SQLITE_STABILITY_WINDOW_INCOMPLETE",
  );
  await assert.rejects(lstat(missingArchiveRoot), { code: "ENOENT" });
});

test("archive root validation leaves no directory through an external parent symlink", async (t) => {
  const fixture = await createFixture(t);
  const linkedParent = `${fixture.archiveRoot}-parent-link`;
  const escapedTarget = path.join(fixture.root, "data-cache", "retirement-archive");
  await symlink(path.join(fixture.root, "data-cache"), linkedParent);
  t.after(() => rm(linkedParent, { force: true }));
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      archiveRoot: path.join(linkedParent, "retirement-archive"),
    }),
    (error) => error.code === "ARCHIVE_ROOT_UNSAFE",
  );
  await assert.rejects(lstat(escapedTarget), { code: "ENOENT" });
});

test("archive detects source content replacement during copy", async (t) => {
  const fixture = await createFixture(t);
  let copies = 0;
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      archiveRoot: fixture.archiveRoot,
      copySourceFile: async (source, target) => {
        const bytes = await readFile(source);
        await writeFile(target, bytes);
        copies += 1;
        if (copies === 1) await writeFile(source, Buffer.alloc(bytes.length, 120));
      },
    }),
    (error) => error.code === "LEGACY_SOURCE_CHANGED",
  );
  assert.deepEqual(await readdir(fixture.archiveRoot), []);
});

test("retirement requires every retained release to be compatible and commits to be distinct", async (t) => {
  const fixture = await createFixture(t);
  const manifests = (await readdir(fixture.releasesDir)).sort();
  const lastManifest = path.join(fixture.releasesDir, manifests.at(-1), ".deploy-manifest.json");
  const first = JSON.parse(await readFile(path.join(fixture.releasesDir, manifests[0], ".deploy-manifest.json"), "utf8"));
  await writeFile(lastManifest, JSON.stringify({ ...first }), "utf8");
  await assert.rejects(
    inspectLegacyProductCatalogRetirement(fixture.options),
    (error) => error.code === "SQLITE_RELEASE_EVIDENCE_INVALID",
  );

  const externalManifest = path.join(fixture.root, "external-release-manifest.json");
  await writeFile(externalManifest, JSON.stringify({ ...first, commit: "external" }), "utf8");
  await rm(lastManifest);
  await symlink(externalManifest, lastManifest);
  await assert.rejects(
    inspectLegacyProductCatalogRetirement(fixture.options),
    (error) => error.code === "SQLITE_RELEASE_EVIDENCE_INVALID",
  );
  await writeFile(lastManifest, JSON.stringify({ ...first, commit: "unique", capabilities: [] }), "utf8");
  await assert.rejects(
    inspectLegacyProductCatalogRetirement(fixture.options),
    (error) => error.code === "SQLITE_RELEASE_EVIDENCE_INVALID",
  );
});

test("archive never removes a preexisting temporary directory or replacement lock", async (t) => {
  const fixture = await createFixture(t);
  const retirementId = `${new Date(MIGRATED_AT_MS).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z")}-${fixture.manifest.hash.slice(0, 12)}`;
  const tempDir = path.join(fixture.archiveRoot, `.${retirementId}.tmp-${process.pid}`);
  await mkdir(tempDir);
  await writeFile(path.join(tempDir, "owned-by-other"), "keep", "utf8");
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot }),
    (error) => error.code === "RETIREMENT_TEMP_CONFLICT",
  );
  assert.equal(await readFile(path.join(tempDir, "owned-by-other"), "utf8"), "keep");

  await rm(tempDir, { recursive: true, force: true });
  const lockPath = `${fixture.repository.databasePath}.legacy-retirement.lock`;
  let replaced = false;
  await assert.rejects(
    archiveLegacyProductCatalog({
      ...fixture.options,
      archiveRoot: fixture.archiveRoot,
      runTar: async () => {
        if (!replaced) {
          replaced = true;
          await rm(lockPath, { force: true });
          await writeFile(lockPath, "replacement-lock", "utf8");
        }
        throw new Error("fixture tar failure");
      },
    }),
    AggregateError,
  );
  assert.equal(await readFile(lockPath, "utf8"), "replacement-lock");
  await rm(lockPath, { force: true });
});

test("existing archive is re-extracted and each member hash is verified", async (t) => {
  const fixture = await createFixture(t);
  const first = await archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot });
  const manifest = JSON.parse(await readFile(first.manifestPath, "utf8"));
  const originalManifest = structuredClone(manifest);
  manifest.files[0].sha256 = "0".repeat(64);
  await writeFile(first.manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot }),
    (error) => error.code === "ARCHIVE_CONFLICT",
  );

  await writeFile(first.manifestPath, JSON.stringify(originalManifest), "utf8");
  const externalManifestPath = path.join(fixture.root, "external-retirement-manifest.json");
  await writeFile(externalManifestPath, await readFile(first.manifestPath));
  await rm(first.manifestPath);
  await symlink(externalManifestPath, first.manifestPath);
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot }),
    (error) => error.code === "ARCHIVE_CONFLICT",
  );
});

test("a partial deterministic archive directory fails as a conflict", async (t) => {
  const fixture = await createFixture(t);
  const retirementId = `${new Date(MIGRATED_AT_MS).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z")}-${fixture.manifest.hash.slice(0, 12)}`;
  const partialDir = path.join(fixture.archiveRoot, retirementId);
  await mkdir(partialDir);
  await writeFile(path.join(partialDir, "partial"), "do-not-replace", "utf8");
  await assert.rejects(
    archiveLegacyProductCatalog({ ...fixture.options, archiveRoot: fixture.archiveRoot }),
    (error) => error.code === "ARCHIVE_CONFLICT",
  );
  assert.equal(await readFile(path.join(partialDir, "partial"), "utf8"), "do-not-replace");
});

test("CLI success and failure include controlled audit diagnostics", async (t) => {
  const fixture = await createFixture(t);
  const env = {
    PRODUCT_CATALOG_APP_DIR: fixture.root,
    PRODUCT_CATALOG_DATABASE_PATH: fixture.repository.databasePath,
    PRODUCT_CATALOG_RELEASES_DIR: fixture.releasesDir,
    PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS: String(FIRST_LIVE_AT_MS),
    PRODUCT_CATALOG_RETIREMENT_NOW_MS: String(NOW_MS),
  };
  const success = JSON.parse((await runCli(["--dry-run"], env)).stdout);
  for (const key of ["checks", "maxMtimeMs", "migratedAtMs", "stableDays", "elapsedMs"]) {
    assert.equal(Object.hasOwn(success, key), true, key);
  }
  const failure = JSON.parse((await runCli(["--archive"], {
    ...env,
    PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT: path.join(fixture.root, "unsafe"),
  })).stderr);
  assert.equal(failure.operation, "archive");
  assert.equal(failure.code, "ARCHIVE_ROOT_UNSAFE");
  assert.equal(Number.isFinite(failure.elapsedMs), true);

  const binDir = await mkdtemp(path.join(os.tmpdir(), "legacy-retirement-bin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const tarPath = path.join(binDir, "tar");
  await writeFile(tarPath, "#!/bin/sh\nexit 7\n", "utf8");
  await chmod(tarPath, 0o700);
  const tarFailureResult = await runCli(["--archive"], {
    ...env,
    PATH: binDir,
    PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT: fixture.archiveRoot,
  });
  const tarFailure = JSON.parse(tarFailureResult.stderr);
  assert.equal(tarFailure.code, "LEGACY_RETIREMENT_FAILED");
  assert.equal(tarFailure.operation, "archive");
  assert.equal(tarFailure.causeCount >= 1, true);
  assert.equal(Array.isArray(tarFailure.causes), true);
  assert.doesNotMatch(tarFailureResult.stderr, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

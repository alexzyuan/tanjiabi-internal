import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import { buildLegacyProductCatalogManifest } from "../src/services/productCatalogLegacyMigrationService.js";
import {
  ProductCatalogLegacyRetirementError,
  inspectLegacyProductCatalogRetirement,
} from "../src/services/productCatalogLegacyRetirementService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 7, 12, 6, 0, 0);
const MIGRATED_AT_MS = NOW_MS - 35 * DAY_MS;
const FIRST_LIVE_AT_MS = NOW_MS - 40 * DAY_MS;
const CAPABILITY = "product-catalog-sqlite-v1";

async function createFixture(t, { releaseCount = 3 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "legacy-retirement-"));
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
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
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

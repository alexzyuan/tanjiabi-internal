import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { buildLegacyProductCatalogManifest } from "./productCatalogLegacyMigrationService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SQLITE_CAPABILITY = "product-catalog-sqlite-v1";
const DEPLOY_MANIFEST = ".deploy-manifest.json";

export class ProductCatalogLegacyRetirementError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProductCatalogLegacyRetirementError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProductCatalogLegacyRetirementError(code, message, details);
}

function positiveTimestamp(value, code, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(code, `${label}无效。`);
  return number;
}

async function assertLegacyDirectoryPolicy(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    if (!info.isFile() || info.isSymbolicLink() || !entry.name.endsWith(".json")) {
      fail("LEGACY_DIRECTORY_POLICY_VIOLATION", "旧商品缓存目录包含不允许的条目。", {
        entryType: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file",
      });
    }
  }
}

function validReleaseManifest(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.app === "tanjia-bi"
    && typeof value.commit === "string"
    && value.commit.trim()
    && value.clean === true
    && typeof value.branch === "string"
    && value.confirmedBranch === value.branch
    && Array.isArray(value.capabilities)
    && value.capabilities.includes(SQLITE_CAPABILITY),
  );
}

async function readCompatibleReleases(releasesDir) {
  let entries;
  try {
    entries = await readdir(releasesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const releases = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(releasesDir, entry.name, DEPLOY_MANIFEST), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail("SQLITE_RELEASE_EVIDENCE_INVALID", "生产 release manifest 无法验证。", {
        errorName: error?.name || "Error",
      });
    }
    if (validReleaseManifest(manifest)) releases.push({ name: entry.name, commit: manifest.commit });
  }
  return releases;
}

function assertRepository(repository) {
  if (!repository || typeof repository.getHealth !== "function" || typeof repository.getMetadata !== "function") {
    fail("RETIREMENT_REPOSITORY_INVALID", "旧商品缓存退役需要只读 SQLite repository。 ");
  }
}

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
} = {}) {
  assertRepository(repository);
  if (!path.isAbsolute(String(sharedDir || "")) || !path.isAbsolute(String(supplierDir || ""))) {
    fail("LEGACY_DIRECTORY_INVALID", "旧商品缓存目录必须是绝对路径。 ");
  }
  if (!path.isAbsolute(String(releasesDir || ""))) {
    fail("RELEASE_DIRECTORY_INVALID", "release 目录必须是绝对路径。 ");
  }
  const clock = typeof now === "function" ? Number(now()) : Number(now);
  if (!Number.isFinite(clock) || clock <= 0) fail("RETIREMENT_CLOCK_INVALID", "退役检查时间无效。 ");
  if (!Number.isInteger(minimumStableDays) || minimumStableDays < 1) {
    fail("RETIREMENT_POLICY_INVALID", "minimumStableDays 必须是正整数。 ");
  }
  if (!Number.isInteger(minimumCompatibleReleases) || minimumCompatibleReleases < 1) {
    fail("RETIREMENT_POLICY_INVALID", "minimumCompatibleReleases 必须是正整数。 ");
  }

  await Promise.all([
    assertLegacyDirectoryPolicy(sharedDir),
    assertLegacyDirectoryPolicy(supplierDir),
  ]);
  const initialManifest = await buildManifest({ sharedDir, supplierDir });
  if (!initialManifest || typeof initialManifest.hash !== "string" || !Array.isArray(initialManifest.files)) {
    fail("LEGACY_MANIFEST_INVALID", "旧商品缓存 manifest 无效。 ");
  }

  const health = repository.getHealth({ requestId: `retirement:${initialManifest.hash.slice(0, 12)}` });
  if (!health?.ok || health.quickCheck !== "ok") {
    fail("SQLITE_HEALTH_CHECK_FAILED", "SQLite 商品目录健康检查未通过。", {
      quickCheck: health?.quickCheck || "unavailable",
    });
  }
  const storedHash = String(repository.getMetadata("legacy_manifest_hash") || "");
  const migratedAtMs = positiveTimestamp(
    repository.getMetadata("legacy_migrated_at_ms"),
    "LEGACY_MIGRATION_METADATA_INVALID",
    "legacy_migrated_at_ms",
  );
  if (storedHash !== initialManifest.hash) {
    fail("LEGACY_MANIFEST_MISMATCH", "旧商品缓存 manifest 与 SQLite 迁移记录不一致。", {
      manifestHashPrefix: initialManifest.hash.slice(0, 12),
      storedHashPrefix: storedHash.slice(0, 12),
    });
  }
  const maxMtimeMs = initialManifest.files.reduce((maximum, file) => Math.max(maximum, Number(file.mtimeMs) || 0), 0);
  if (maxMtimeMs > migratedAtMs) {
    fail("LEGACY_FILE_NEWER_THAN_MIGRATION", "旧商品缓存存在晚于迁移时间的文件。 ");
  }
  const liveAtMs = positiveTimestamp(
    firstSqliteLiveAtMs,
    "SQLITE_FIRST_LIVE_TIME_INVALID",
    "SQLite 首次上线时间",
  );
  if (clock - liveAtMs < minimumStableDays * DAY_MS) {
    fail("SQLITE_STABILITY_WINDOW_INCOMPLETE", "SQLite 商品目录稳定观察期尚未完成。", {
      requiredDays: minimumStableDays,
      observedDays: Math.max(0, Math.floor((clock - liveAtMs) / DAY_MS)),
    });
  }
  const compatibleReleases = await readCompatibleReleases(releasesDir);
  if (compatibleReleases.length < minimumCompatibleReleases) {
    fail("SQLITE_RELEASE_EVIDENCE_INSUFFICIENT", "支持 SQLite 商品目录的 release 数量不足。", {
      requiredCount: minimumCompatibleReleases,
      actualCount: compatibleReleases.length,
    });
  }
  const finalManifest = await buildManifest({ sharedDir, supplierDir });
  if (finalManifest.hash !== initialManifest.hash) {
    fail("LEGACY_MANIFEST_UNSTABLE", "旧商品缓存检查期间发生变化。 ");
  }

  const totalBytes = initialManifest.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  return {
    eligible: true,
    checks: [
      { code: "sqlite-health", ok: true },
      { code: "manifest-match", ok: true },
      { code: "file-mtime", ok: true },
      { code: "stability-window", ok: true },
      { code: "compatible-releases", ok: true },
      { code: "stable-scan", ok: true },
    ],
    manifestHash: initialManifest.hash,
    manifestHashPrefix: initialManifest.hash.slice(0, 12),
    fileCount: initialManifest.files.length,
    totalBytes,
    maxMtimeMs,
    migratedAtMs,
    firstSqliteLiveAtMs: liveAtMs,
    stableDays: Math.floor((clock - liveAtMs) / DAY_MS),
    releaseCount: compatibleReleases.length,
    sqliteRevision: health.revision,
    sqliteCounts: {
      listing: health.listingCount,
      product: health.productCount,
      alias: health.aliasCount,
    },
  };
}

export const PRODUCT_CATALOG_SQLITE_CAPABILITY = SQLITE_CAPABILITY;

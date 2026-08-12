import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { buildLegacyProductCatalogManifest } from "./productCatalogLegacyMigrationService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SQLITE_CAPABILITY = "product-catalog-sqlite-v1";
const DEPLOY_MANIFEST = ".deploy-manifest.json";
const ARCHIVE_NAME = "legacy-product-catalog.tar.gz";
const RETIREMENT_MANIFEST = "retirement-manifest.json";
const execFileAsync = promisify(execFile);

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

async function readStableManifest({ buildManifest, sharedDir, supplierDir, maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const initial = await buildManifest({ sharedDir, supplierDir });
    const final = await buildManifest({ sharedDir, supplierDir });
    if (initial?.hash && initial.hash === final?.hash) return initial;
  }
  fail("LEGACY_MANIFEST_UNSTABLE", `旧商品缓存连续 ${maxAttempts} 次检查均发生变化。 `);
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
  const initialManifest = await readStableManifest({ buildManifest, sharedDir, supplierDir });
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

function pathIsInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function retirementIdFor(nowMs, manifestHash) {
  const timestamp = new Date(nowMs).toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `${timestamp}-${manifestHash.slice(0, 12)}`;
}

async function fileSha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function archiveRelativePath(file) {
  const root = file.source === "shared-product-catalog"
    ? "shared-product-catalog"
    : file.source === "supplier-board-product-map"
      ? "supplier-board-product-map"
      : null;
  if (!root || path.basename(file.name) !== file.name || !file.name.endsWith(".json")) {
    fail("LEGACY_MANIFEST_INVALID", "旧商品缓存 manifest 包含非法条目。 ");
  }
  return `${root}/${file.name}`;
}

async function defaultRunTar(args, options) {
  return execFileAsync("tar", args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function safeArchiveMembers(stdout) {
  return String(stdout || "").split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
}

async function readExistingArchiveResult(finalDir, inspection) {
  try {
    const manifestPath = path.join(finalDir, RETIREMENT_MANIFEST);
    const archivePath = path.join(finalDir, ARCHIVE_NAME);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      manifest?.manifestHash !== inspection.manifestHash
      || manifest?.archiveSha256 !== await fileSha256(archivePath)
      || !Array.isArray(manifest.files)
      || manifest.files.length !== inspection.fileCount
    ) {
      fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档与当前检查结果冲突。 ");
    }
    return {
      archived: true,
      retirementId: manifest.retirementId,
      manifestHash: manifest.manifestHash,
      archiveSha256: manifest.archiveSha256,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      archivePath,
      manifestPath,
      idempotent: true,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ProductCatalogLegacyRetirementError) throw error;
    fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档无法验证。", {
      errorName: error?.name || "Error",
    });
  }
}

async function acquireLock(lockPath, operationId) {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ operation: "archive", operationId, pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return handle;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error?.code === "EEXIST") fail("RETIREMENT_LOCKED", "旧商品缓存退役操作已有活动锁。 ");
    throw error;
  }
}

async function cleanupArchiveOperation({ lockHandle, lockPath, temporaryDir }) {
  const tasks = [];
  if (lockHandle) tasks.push(Promise.resolve().then(() => lockHandle.close()));
  if (temporaryDir) tasks.push(Promise.resolve().then(() => rm(temporaryDir, { recursive: true, force: true })));
  if (lockPath) tasks.push(Promise.resolve().then(() => rm(lockPath, { force: true })));
  const results = await Promise.allSettled(tasks);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  return errors.length ? new AggregateError(errors, "旧商品缓存归档清理失败。") : null;
}

export async function archiveLegacyProductCatalog({
  archiveRoot,
  runTar = defaultRunTar,
  ...inspectionOptions
} = {}) {
  const resolvedArchiveRoot = path.resolve(String(archiveRoot || ""));
  const sharedDir = path.resolve(String(inspectionOptions.sharedDir || ""));
  const supplierDir = path.resolve(String(inspectionOptions.supplierDir || ""));
  const dataCacheDir = path.dirname(sharedDir);
  const appDir = path.dirname(dataCacheDir);
  if (!path.isAbsolute(String(archiveRoot || "")) || pathIsInside(appDir, resolvedArchiveRoot)) {
    fail("ARCHIVE_ROOT_UNSAFE", "归档目录必须位于应用目录之外。 ");
  }
  if (path.dirname(supplierDir) !== dataCacheDir) {
    fail("LEGACY_DIRECTORY_INVALID", "旧商品缓存目录不属于同一 data-cache。 ");
  }
  if (typeof runTar !== "function") fail("ARCHIVE_TOOL_INVALID", "tar 执行边界无效。 ");

  const inspection = await inspectLegacyProductCatalogRetirement({
    ...inspectionOptions,
    sharedDir,
    supplierDir,
  });
  const nowValue = typeof inspectionOptions.now === "function"
    ? Number(inspectionOptions.now())
    : Number(inspectionOptions.now ?? Date.now());
  const retirementId = retirementIdFor(nowValue, inspection.manifestHash);
  const finalDir = path.join(resolvedArchiveRoot, retirementId);
  const temporaryDir = path.join(resolvedArchiveRoot, `.${retirementId}.tmp-${process.pid}`);
  const lockPath = `${inspectionOptions.repository.databasePath}.legacy-retirement.lock`;
  await mkdir(resolvedArchiveRoot, { recursive: true });
  const existing = await readExistingArchiveResult(finalDir, inspection);
  if (existing) return existing;

  let lockHandle = null;
  let operationError = null;
  let result = null;
  try {
    lockHandle = await acquireLock(lockPath, retirementId);
    await mkdir(temporaryDir, { recursive: false });
    const stagingDir = path.join(temporaryDir, "staging");
    const verificationDir = path.join(temporaryDir, "verification");
    await Promise.all([
      mkdir(path.join(stagingDir, "shared-product-catalog"), { recursive: true }),
      mkdir(path.join(stagingDir, "supplier-board-product-map"), { recursive: true }),
      mkdir(verificationDir, { recursive: true }),
    ]);
    const currentManifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
    if (currentManifest.hash !== inspection.manifestHash) {
      fail("LEGACY_MANIFEST_UNSTABLE", "归档开始前旧商品缓存发生变化。 ");
    }
    const files = [];
    for (const file of currentManifest.files) {
      const relativePath = archiveRelativePath(file);
      const targetPath = path.join(stagingDir, ...relativePath.split("/"));
      await copyFile(file.filePath, targetPath);
      const copiedStat = await stat(targetPath);
      files.push({
        path: relativePath,
        size: copiedStat.size,
        mtimeMs: Number(file.mtimeMs),
        sha256: await fileSha256(targetPath),
      });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    const archivePath = path.join(temporaryDir, ARCHIVE_NAME);
    await runTar(["-czf", archivePath, "shared-product-catalog", "supplier-board-product-map"], { cwd: stagingDir });
    const listed = await runTar(["-tzf", archivePath], { cwd: stagingDir });
    const members = safeArchiveMembers(listed?.stdout).filter((member) => !member.endsWith("/"));
    if (members.some((member) => member.startsWith("/") || member.includes(".."))
      || members.sort().join("\n") !== files.map((file) => file.path).sort().join("\n")) {
      fail("ARCHIVE_VERIFICATION_FAILED", "旧商品缓存归档成员验证失败。 ");
    }
    await runTar(["-xzf", archivePath, "-C", verificationDir], { cwd: stagingDir });
    for (const file of files) {
      if (await fileSha256(path.join(verificationDir, ...file.path.split("/"))) !== file.sha256) {
        fail("ARCHIVE_VERIFICATION_FAILED", "旧商品缓存归档内容校验失败。 ");
      }
    }
    const finalArchiveSha256 = await fileSha256(archivePath);
    const retirementManifest = {
      version: 1,
      retirementId,
      manifestHash: inspection.manifestHash,
      archiveSha256: finalArchiveSha256,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      createdAt: new Date(nowValue).toISOString(),
      migratedAtMs: inspection.migratedAtMs,
      sqliteRevision: inspection.sqliteRevision,
      files,
    };
    const manifestPath = path.join(temporaryDir, RETIREMENT_MANIFEST);
    await writeFile(manifestPath, `${JSON.stringify(retirementManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rm(stagingDir, { recursive: true, force: true });
    await rm(verificationDir, { recursive: true, force: true });
    await rename(temporaryDir, finalDir);
    result = {
      archived: true,
      retirementId,
      manifestHash: inspection.manifestHash,
      archiveSha256: finalArchiveSha256,
      fileCount: retirementManifest.fileCount,
      totalBytes: retirementManifest.totalBytes,
      archivePath: path.join(finalDir, ARCHIVE_NAME),
      manifestPath: path.join(finalDir, RETIREMENT_MANIFEST),
      idempotent: false,
    };
  } catch (error) {
    operationError = error;
  }
  const cleanupError = await cleanupArchiveOperation({
    lockHandle,
    lockPath: lockHandle ? lockPath : null,
    temporaryDir,
  });
  if (operationError && cleanupError) {
    const aggregate = new AggregateError([operationError, cleanupError], `${operationError.message}；归档清理也失败。`, {
      cause: operationError,
    });
    aggregate.cleanupError = cleanupError;
    throw aggregate;
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return result;
}

export const PRODUCT_CATALOG_SQLITE_CAPABILITY = SQLITE_CAPABILITY;

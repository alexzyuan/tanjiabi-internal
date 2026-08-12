import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
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
const RETIREMENT_TOOL_VERSION = "0.1.0";
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

async function assertCanonicalLegacyDirectories(sharedDir, supplierDir) {
  if (path.basename(sharedDir) !== "shared-product-catalog"
    || path.basename(supplierDir) !== "supplier-board-product-map"
    || path.dirname(sharedDir) !== path.dirname(supplierDir)) {
    fail("LEGACY_DIRECTORY_INVALID", "旧商品缓存目录不符合固定白名单。 ");
  }
  const realDirectories = [];
  for (const directory of [sharedDir, supplierDir]) {
    const info = await lstat(directory).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      fail("LEGACY_DIRECTORY_INVALID", "旧商品缓存目录必须是非符号链接真实目录。 ");
    }
    realDirectories.push(info ? await realpath(directory) : null);
  }
  const existingRealDirectories = realDirectories.filter(Boolean);
  if (existingRealDirectories.some((directory, index) => (
    path.basename(directory) !== (index === 0 ? "shared-product-catalog" : "supplier-board-product-map")
  )) || (existingRealDirectories.length === 2
    && path.dirname(existingRealDirectories[0]) !== path.dirname(existingRealDirectories[1]))) {
    fail("LEGACY_DIRECTORY_INVALID", "旧商品缓存真实目录不符合固定白名单。 ");
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
    const releaseDir = path.join(releasesDir, entry.name);
    const releaseInfo = await lstat(releaseDir);
    const manifestPath = path.join(releaseDir, DEPLOY_MANIFEST);
    const manifestInfo = await lstat(manifestPath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!releaseInfo.isDirectory() || releaseInfo.isSymbolicLink()
      || !manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) {
      fail("SQLITE_RELEASE_EVIDENCE_INVALID", "生产 release manifest 必须是固定目录中的普通文件。 ");
    }
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      fail("SQLITE_RELEASE_EVIDENCE_INVALID", "生产 release manifest 无法验证。", {
        errorName: error?.name || "Error",
      });
    }
    if (!validReleaseManifest(manifest)) {
      fail("SQLITE_RELEASE_EVIDENCE_INVALID", "当前保留的 release 不支持 SQLite 商品目录。 ");
    }
    releases.push({ name: entry.name, commit: manifest.commit });
  }
  if (new Set(releases.map(({ commit }) => commit)).size !== releases.length) {
    fail("SQLITE_RELEASE_EVIDENCE_INVALID", "生产 release commit 证据重复。 ");
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
    assertCanonicalLegacyDirectories(sharedDir, supplierDir),
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

async function prospectiveRealPath(targetPath) {
  const missingNames = [];
  let candidate = targetPath;
  while (true) {
    try {
      const existingRealPath = await realpath(candidate);
      return path.join(existingRealPath, ...missingNames.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missingNames.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

function retirementIdFor(migratedAtMs, manifestHash) {
  const timestamp = new Date(migratedAtMs).toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `${timestamp}-${manifestHash.slice(0, 12)}`;
}

async function fileSha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function sameFileIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
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

async function snapshotLegacyFiles(manifest) {
  const snapshots = [];
  for (const file of manifest.files) {
    const info = await lstat(file.filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail("LEGACY_SOURCE_CHANGED", "旧商品缓存源文件身份发生变化。 ");
    }
    snapshots.push({
      filePath: file.filePath,
      path: archiveRelativePath(file),
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: Math.trunc(info.mtimeMs),
      sha256: await fileSha256(file.filePath),
    });
  }
  return snapshots.sort((left, right) => left.path.localeCompare(right.path));
}

async function assertSourceSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.filePath).catch(() => null);
    if (!current || !current.isFile() || current.isSymbolicLink()
      || current.dev !== snapshot.dev || current.ino !== snapshot.ino
      || current.size !== snapshot.size || Math.trunc(current.mtimeMs) !== snapshot.mtimeMs
      || await fileSha256(snapshot.filePath) !== snapshot.sha256) {
      fail("LEGACY_SOURCE_CHANGED", "旧商品缓存源文件在归档期间发生变化。 ");
    }
  }
}

function assertRetirementManifestShape(manifest, inspection, sourceSnapshots, expectedRetirementId) {
  if (
    !manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.version !== 1
    || manifest.toolVersion !== RETIREMENT_TOOL_VERSION
    || manifest.retirementId !== expectedRetirementId
    || manifest.manifestHash !== inspection.manifestHash
    || manifest.migratedAtMs !== inspection.migratedAtMs
    || manifest.sqliteRevision !== inspection.sqliteRevision
    || !Array.isArray(manifest.files)
    || manifest.files.length !== inspection.fileCount
    || manifest.fileCount !== manifest.files.length
    || manifest.totalBytes !== manifest.files.reduce((sum, file) => sum + Number(file?.size || 0), 0)
    || manifest.files.some((file) => (
      !file || typeof file !== "object" || Array.isArray(file)
      || typeof file.path !== "string" || typeof file.sha256 !== "string"
    ))
  ) {
    fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档 manifest 无法验证。 ");
  }
  const actual = manifest.files.map((file) => ({
    path: file.path,
    size: file.size,
    mtimeMs: Math.trunc(Number(file.mtimeMs)),
    sha256: file.sha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const expected = sourceSnapshots.map((file) => ({
    path: file.path,
    size: file.size,
    mtimeMs: file.mtimeMs,
    sha256: file.sha256,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档与当前源文件不一致。 ");
  }
}

async function readExistingArchiveResult(finalDir, inspection, {
  sharedDir,
  supplierDir,
  runTar,
}) {
  try {
    const manifestPath = path.join(finalDir, RETIREMENT_MANIFEST);
    const archivePath = path.join(finalDir, ARCHIVE_NAME);
    const [finalInfo, manifestInfo, archiveInfo] = await Promise.all([
      lstat(finalDir),
      lstat(manifestPath),
      lstat(archivePath),
    ]);
    if (!finalInfo.isDirectory() || finalInfo.isSymbolicLink()
      || !manifestInfo.isFile() || manifestInfo.isSymbolicLink()
      || !archiveInfo.isFile() || archiveInfo.isSymbolicLink()) {
      fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档包含不安全条目。 ");
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const sourceManifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
    if (sourceManifest.hash !== inspection.manifestHash) {
      fail("ARCHIVE_CONFLICT", "既有归档复核期间旧商品缓存发生变化。 ");
    }
    const sourceSnapshots = await snapshotLegacyFiles(sourceManifest);
    assertRetirementManifestShape(manifest, inspection, sourceSnapshots, path.basename(finalDir));
    if (
      manifest.archiveSha256 !== await fileSha256(archivePath)
    ) {
      fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档与当前检查结果冲突。 ");
    }
    await verifyArchiveContents({ archivePath, manifest, runTar });
    await assertSourceSnapshotsUnchanged(sourceSnapshots);
    const finalSourceManifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
    if (finalSourceManifest.hash !== inspection.manifestHash) {
      fail("ARCHIVE_CONFLICT", "既有归档复核后旧商品缓存 manifest 发生变化。 ");
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
      checks: inspection.checks,
      maxMtimeMs: inspection.maxMtimeMs,
      migratedAtMs: inspection.migratedAtMs,
      stableDays: inspection.stableDays,
      releaseCount: inspection.releaseCount,
      sqliteRevision: inspection.sqliteRevision,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ProductCatalogLegacyRetirementError) throw error;
    fail("ARCHIVE_CONFLICT", "已存在的旧商品缓存归档无法验证。", {
      errorName: error?.name || "Error",
    });
  }
}

async function verifyArchiveContents({ archivePath, manifest, runTar = defaultRunTar }) {
  const verifyDir = `${archivePath}.verify-${process.pid}-${randomUUID()}`;
  let operationError = null;
  try {
    await mkdir(verifyDir, { recursive: false });
    const listed = await runTar(["-tzf", archivePath], { cwd: path.dirname(archivePath) });
    const members = safeArchiveMembers(listed?.stdout).filter((member) => !member.endsWith("/"));
    const expected = manifest.files.map(({ path: member }) => member).sort();
    if (members.some((member) => member.startsWith("/") || member.split("/").includes(".."))
      || members.sort().join("\n") !== expected.join("\n")) {
      fail("ARCHIVE_CONFLICT", "已有归档成员无法验证。 ");
    }
    await runTar(["-xzf", archivePath, "-C", verifyDir], { cwd: path.dirname(archivePath) });
    for (const file of manifest.files) {
      if (await fileSha256(path.join(verifyDir, ...file.path.split("/"))) !== file.sha256) {
        fail("ARCHIVE_CONFLICT", "已有归档逐文件校验失败。 ");
      }
    }
  } catch (error) {
    operationError = error;
  }
  const cleanup = await Promise.allSettled([rm(verifyDir, { recursive: true, force: true })]);
  const cleanupErrors = cleanup.filter(({ status }) => status === "rejected").map(({ reason }) => reason);
  if (operationError && cleanupErrors.length) throw new AggregateError([operationError, ...cleanupErrors], "归档验证和清理均失败。", { cause: operationError });
  if (operationError) throw operationError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "归档验证清理失败。 ");
}

async function acquireLock(lockPath, operationId) {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ operation: "archive", operationId, pid: process.pid, hostname: process.env.HOSTNAME || "unknown", startedAt: new Date().toISOString() })}\n`, "utf8");
    await handle.sync();
    return handle;
  } catch (error) {
    const cleanupErrors = [];
    if (handle) {
      const owned = await handle.stat().catch(() => null);
      await handle.close().catch((closeError) => cleanupErrors.push(closeError));
      if (owned) {
        await removeOwnedPath(lockPath, owned, { recursive: false }).catch((cleanupError) => cleanupErrors.push(cleanupError));
      }
    }
    if (error?.code === "EEXIST") fail("RETIREMENT_LOCKED", "旧商品缓存退役操作已有活动锁。 ");
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], "退役锁初始化和清理均失败。", { cause: error });
    }
    throw error;
  }
}

async function removeOwnedPath(targetPath, identity, { recursive }) {
  const cleanupPath = `${targetPath}.cleanup-${process.pid}-${randomUUID()}`;
  try {
    await rename(targetPath, cleanupPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const moved = await lstat(cleanupPath);
  if (!sameFileIdentity(moved, identity)) {
    let restoreError = null;
    try {
      await rename(cleanupPath, targetPath);
    } catch (error) {
      restoreError = error;
    }
    const ownershipError = new ProductCatalogLegacyRetirementError(
      "RETIREMENT_CLEANUP_OWNERSHIP_CHANGED",
      "旧商品缓存归档清理目标所有权发生变化。",
    );
    if (restoreError) {
      throw new AggregateError([ownershipError, restoreError], "清理目标所有权变化且恢复失败。", {
        cause: ownershipError,
      });
    }
    throw ownershipError;
  }
  await rm(cleanupPath, { recursive, force: true });
}

async function cleanupArchiveOperation({
  lockHandle,
  lockPath,
  lockIdentity,
  temporaryDir,
  temporaryIdentity,
  ownsTemporaryDir,
}) {
  const tasks = [];
  if (ownsTemporaryDir && temporaryDir && temporaryIdentity) {
    tasks.push(removeOwnedPath(temporaryDir, temporaryIdentity, { recursive: true }));
  }
  if (lockHandle) tasks.push(lockHandle.close());
  const results = await Promise.allSettled(tasks);
  if (lockPath && lockIdentity) results.push(...await Promise.allSettled([
    removeOwnedPath(lockPath, lockIdentity, { recursive: false }),
  ]));
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  return errors.length ? new AggregateError(errors, "旧商品缓存归档清理失败。") : null;
}

export async function archiveLegacyProductCatalog({
  archiveRoot,
  runTar = defaultRunTar,
  copySourceFile = copyFile,
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
  const archiveInfo = await lstat(resolvedArchiveRoot).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (archiveInfo && (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink())) {
    fail("ARCHIVE_ROOT_UNSAFE", "归档目录必须是非符号链接目录。 ");
  }
  const realAppDir = await realpath(appDir);
  const prospectiveArchiveRoot = await prospectiveRealPath(resolvedArchiveRoot);
  if (pathIsInside(realAppDir, prospectiveArchiveRoot)) {
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
  await mkdir(resolvedArchiveRoot, { recursive: true });
  const archiveRootIdentity = await lstat(resolvedArchiveRoot);
  if (!archiveRootIdentity.isDirectory() || archiveRootIdentity.isSymbolicLink()) {
    fail("ARCHIVE_ROOT_UNSAFE", "归档目录必须是非符号链接目录。 ");
  }
  const realArchiveRoot = await realpath(resolvedArchiveRoot);
  if (pathIsInside(realAppDir, realArchiveRoot)) {
    fail("ARCHIVE_ROOT_UNSAFE", "归档目录必须位于应用目录之外。 ");
  }
  const nowValue = typeof inspectionOptions.now === "function"
    ? Number(inspectionOptions.now())
    : Number(inspectionOptions.now ?? Date.now());
  const retirementId = retirementIdFor(inspection.migratedAtMs, inspection.manifestHash);
  const finalDir = path.join(resolvedArchiveRoot, retirementId);
  const temporaryDir = path.join(resolvedArchiveRoot, `.${retirementId}.tmp-${process.pid}`);
  const lockPath = `${inspectionOptions.repository.databasePath}.legacy-retirement.lock`;
  const rootBeforeExistingCheck = await lstat(resolvedArchiveRoot);
  if (!sameFileIdentity(rootBeforeExistingCheck, archiveRootIdentity)) {
    fail("ARCHIVE_ROOT_UNSAFE", "归档目录身份在操作期间发生变化。 ");
  }
  const existing = await readExistingArchiveResult(finalDir, inspection, {
    sharedDir,
    supplierDir,
    runTar,
  });
  if (existing) return existing;
  const finalInfo = await lstat(finalDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (finalInfo) fail("ARCHIVE_CONFLICT", "已存在状态不明的旧商品缓存归档任务。 ");

  let lockHandle = null;
  let lockIdentity = null;
  let ownsTemporaryDir = false;
  let temporaryIdentity = null;
  let operationError = null;
  let result = null;
  try {
    lockHandle = await acquireLock(lockPath, retirementId);
    lockIdentity = await lockHandle.stat();
    try {
      await mkdir(temporaryDir, { recursive: false });
      ownsTemporaryDir = true;
      temporaryIdentity = await lstat(temporaryDir);
    } catch (error) {
      if (error?.code === "EEXIST") fail("RETIREMENT_TEMP_CONFLICT", "旧商品缓存归档临时目录已存在。 ");
      throw error;
    }
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
    const sourceSnapshots = await snapshotLegacyFiles(currentManifest);
    const files = [];
    for (const snapshot of sourceSnapshots) {
      const relativePath = snapshot.path;
      const targetPath = path.join(stagingDir, ...relativePath.split("/"));
      await copySourceFile(snapshot.filePath, targetPath);
      await assertSourceSnapshotsUnchanged([snapshot]);
      const copiedStat = await stat(targetPath);
      const copiedHash = await fileSha256(targetPath);
      if (copiedHash !== snapshot.sha256) fail("LEGACY_SOURCE_CHANGED", "旧商品缓存复制内容无法验证。 ");
      files.push({
        path: relativePath,
        size: copiedStat.size,
        mtimeMs: snapshot.mtimeMs,
        sha256: copiedHash,
      });
    }
    await assertSourceSnapshotsUnchanged(sourceSnapshots);
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
    await assertSourceSnapshotsUnchanged(sourceSnapshots);
    const finalSourceManifest = await buildLegacyProductCatalogManifest({ sharedDir, supplierDir });
    if (finalSourceManifest.hash !== inspection.manifestHash) {
      fail("LEGACY_MANIFEST_UNSTABLE", "归档验证后旧商品缓存 manifest 发生变化。 ");
    }
    const finalArchiveSha256 = await fileSha256(archivePath);
    const retirementManifest = {
      version: 1,
      toolVersion: RETIREMENT_TOOL_VERSION,
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
    const rootBeforePublish = await lstat(resolvedArchiveRoot);
    if (!sameFileIdentity(rootBeforePublish, archiveRootIdentity)) {
      fail("ARCHIVE_ROOT_UNSAFE", "归档目录身份在发布前发生变化。 ");
    }
    const finalBeforePublish = await lstat(finalDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (finalBeforePublish) fail("ARCHIVE_CONFLICT", "归档发布目标已存在。 ");
    await rename(temporaryDir, finalDir);
    ownsTemporaryDir = false;
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
      checks: inspection.checks,
      maxMtimeMs: inspection.maxMtimeMs,
      migratedAtMs: inspection.migratedAtMs,
      stableDays: inspection.stableDays,
      releaseCount: inspection.releaseCount,
      sqliteRevision: inspection.sqliteRevision,
    };
  } catch (error) {
    operationError = error;
  }
  const cleanupError = await cleanupArchiveOperation({
    lockHandle,
    lockPath: lockHandle ? lockPath : null,
    lockIdentity,
    temporaryDir,
    temporaryIdentity,
    ownsTemporaryDir,
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

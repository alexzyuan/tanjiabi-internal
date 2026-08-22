import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const fileOperationQueues = new Map();
const uncertainCommits = new Map();
let tempSequence = 0;

export class JsonStoreError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "JsonStoreError";
    Object.assign(this, fields);
  }
}

function hasFallbackValue(args) {
  return args.length >= 2;
}

function jsonParseError(filePath, error) {
  return new JsonStoreError(`JSON parse failed: ${filePath}`, {
    code: "JSON_PARSE_FAILED",
    filePath,
    cause: error,
  });
}

const unsupportedDirectorySyncCodes = new Set(["EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "ENOTTY"]);

function isUnsupportedDirectorySyncError(error) {
  return unsupportedDirectorySyncCodes.has(error?.code);
}

function directorySyncError(dir, error) {
  return new JsonStoreError(`Directory fsync failed: ${dir}`, {
    code: "DIRECTORY_FSYNC_FAILED",
    filePath: dir,
    cause: error,
  });
}

function jsonCommitUncertainError(filePath, dir, error) {
  return new JsonStoreError(`JSON commit durability is uncertain: ${filePath}`, {
    code: "DIRECTORY_FSYNC_FAILED",
    filePath,
    directory: dir,
    cause: error,
    causeCode: error?.cause?.code || error?.code || "UNKNOWN",
    commitState: "unknown",
    targetMayContainNewValue: true,
    requiresReconciliation: true,
    markerPath: uncertaintyMarkerPath(filePath),
    markerStatus: "pending",
    markerPersisted: false,
    retryable: false,
  });
}

function registerUncertainCommit(filePath, dir, cause, {
  targetMayContainNewValue = true,
  markerPersisted = false,
  markerPersistenceErrorCode,
} = {}) {
  const uncertain = jsonCommitUncertainError(filePath, dir, cause);
  uncertain.targetMayContainNewValue = targetMayContainNewValue;
  uncertain.markerPersisted = markerPersisted;
  if (markerPersistenceErrorCode) uncertain.markerPersistenceErrorCode = markerPersistenceErrorCode;
  uncertainCommits.set(path.resolve(filePath), uncertain);
  return uncertain;
}

function uncertaintyMarkerPath(filePath) {
  return `${filePath}.uncertain`;
}

function persistedCommitUncertainty(filePath) {
  const markerPath = uncertaintyMarkerPath(filePath);
  if (!existsSync(markerPath)) return null;
  let markerStatus = "unknown";
  try {
    markerStatus = JSON.parse(readFileSync(markerPath, "utf8")).status || "unknown";
  } catch {
    markerStatus = "invalid";
  }
  if (markerStatus === "cleared") return null;
  return new JsonStoreError(`JSON commit requires reconciliation: ${filePath}`, {
    code: "JSON_COMMIT_UNCERTAIN",
    filePath,
    markerPath,
    markerStatus,
    commitState: "unknown",
    targetMayContainNewValue: true,
    requiresReconciliation: true,
    markerPersisted: true,
    retryable: false,
  });
}

function unresolvedCommit(filePath) {
  return uncertainCommits.get(path.resolve(filePath)) || persistedCommitUncertainty(filePath);
}

function publicCommitStatus(error) {
  if (!error) return null;
  return {
    code: error.code,
    filePath: error.filePath,
    directory: error.directory,
    causeCode: error.causeCode,
    commitState: error.commitState,
    targetMayContainNewValue: error.targetMayContainNewValue === true,
    requiresReconciliation: error.requiresReconciliation === true,
    markerPath: error.markerPath,
    markerStatus: error.markerStatus,
    markerPersisted: error.markerPersisted === true,
    markerPersistenceErrorCode: error.markerPersistenceErrorCode,
    retryable: typeof error.retryable === "boolean" ? error.retryable : null,
  };
}

export function getJsonStoreCommitUncertainty(filePath) {
  return publicCommitStatus(unresolvedCommit(filePath));
}

async function removeUncertaintyMarker(filePath) {
  try {
    await unlink(uncertaintyMarkerPath(filePath));
    await fsyncDirectory(path.dirname(filePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

// Internal cleanup primitive. Operators must use reconcileJsonStoreCommit,
// which verifies the current JSON and SHA-256 before calling this function.
async function clearJsonStoreCommitUncertainty(filePath) {
  const removedMarker = await removeUncertaintyMarker(filePath);
  const removedMemory = uncertainCommits.delete(path.resolve(filePath));
  return removedMemory || removedMarker;
}

function enqueueJsonStoreReconciliation(filePath, operation) {
  const queueKey = path.resolve(filePath);
  const previous = fileOperationQueues.get(queueKey) || Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(operation);
  fileOperationQueues.set(queueKey, run);
  return run.finally(() => {
    if (fileOperationQueues.get(queueKey) === run) {
      fileOperationQueues.delete(queueKey);
    }
  });
}

export async function reconcileJsonStoreCommit(filePath, { expectedSha256 = "" } = {}) {
  const expected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expected)) {
    throw new JsonStoreError(`A SHA-256 value is required to reconcile: ${filePath}`, {
      code: "RECONCILIATION_HASH_INVALID",
      filePath,
      statusCode: 400,
    });
  }
  return enqueueJsonStoreReconciliation(filePath, async () => {
    const pending = unresolvedCommit(filePath);
    if (!pending) return { ok: true, status: "clear", filePath: path.resolve(filePath) };
    const content = await readFile(filePath, "utf8");
    try {
      JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) throw jsonParseError(filePath, error);
      throw error;
    }
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) {
      throw new JsonStoreError(`JSON commit reconciliation hash mismatch: ${filePath}`, {
        code: "RECONCILIATION_HASH_MISMATCH",
        filePath,
        expectedSha256: expected,
        actualSha256: actual,
        statusCode: 409,
      });
    }
    await clearJsonStoreCommitUncertainty(filePath);
    return { ok: true, status: "cleared", filePath: path.resolve(filePath), sha256: actual };
  });
}

function enqueueJsonStoreOperation(filePath, operation) {
  const queueKey = path.resolve(filePath);
  const previous = fileOperationQueues.get(queueKey) || Promise.resolve();
  const run = previous
    .catch((error) => {
      // A post-rename directory fsync failure means the target may already
      // contain the new value. Do not automatically apply another operation
      // until an operator reconciles that uncertain commit.
      if (error?.commitState === "unknown") throw error;
      return undefined;
    })
    .then(async () => {
      const unresolved = unresolvedCommit(filePath);
      if (unresolved) throw unresolved;
      return operation();
    });
  fileOperationQueues.set(queueKey, run);
  return run.finally(() => {
    if (fileOperationQueues.get(queueKey) === run) {
      fileOperationQueues.delete(queueKey);
    }
  });
}

async function fsyncFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(dir) {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isUnsupportedDirectorySyncError(error)) return;
    throw directorySyncError(dir, error);
  }
}

async function writeUncertaintyMarker(filePath, dir, status, cause = null, {
  syncDirectory = fsyncDirectory,
  syncFile = fsyncFile,
} = {}) {
  const markerPath = uncertaintyMarkerPath(filePath);
  const markerTemp = path.join(dir, `.${path.basename(markerPath)}.${process.pid}.${Date.now()}.${++tempSequence}.tmp`);
  let markerCommitted = false;
  try {
    await writeFile(markerTemp, `${JSON.stringify({
      version: 1,
      filePath: path.resolve(filePath),
      createdAt: new Date().toISOString(),
      status,
      causeCode: cause?.cause?.code || cause?.code || null,
    })}\n`, "utf8");
    await syncFile(markerTemp);
    await rename(markerTemp, markerPath);
    markerCommitted = true;
    await syncDirectory(dir);
    return true;
  } finally {
    if (!markerCommitted) {
      try {
        await unlink(markerTemp);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

async function removeUncertaintyMarkerAfterCommit(filePath, dir, { syncDirectory = fsyncDirectory } = {}) {
  await unlink(uncertaintyMarkerPath(filePath));
  await syncDirectory(dir);
}

export async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT" && hasFallbackValue(arguments)) return fallback;
    if (error instanceof SyntaxError) throw jsonParseError(filePath, error);
    throw error;
  }
}

async function writeJsonAtomicUnlocked(filePath, data, {
  syncDirectory = fsyncDirectory,
  syncMarkerDirectory = fsyncDirectory,
  syncMarkerFile = fsyncFile,
} = {}) {
  const dir = path.dirname(filePath);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(dir, { recursive: true });
  const tempFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++tempSequence}.tmp`);
  await writeFile(tempFile, json, "utf8");
  await fsyncFile(tempFile);
  let markerReady = false;
  let targetRenamed = false;
  try {
    try {
      await writeUncertaintyMarker(filePath, dir, "pending", null, {
        syncDirectory: syncMarkerDirectory,
        syncFile: syncMarkerFile,
      });
      markerReady = true;
    } catch (markerError) {
      const markerCode = markerError?.cause?.code || markerError?.code || "UNKNOWN";
      throw registerUncertainCommit(filePath, dir, markerError, {
        targetMayContainNewValue: false,
        markerPersisted: existsSync(uncertaintyMarkerPath(filePath)),
        markerPersistenceErrorCode: markerCode,
      });
    }

    await rename(tempFile, filePath);
    targetRenamed = true;

    let targetSyncError = null;
    try {
      await syncDirectory(dir);
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error)) {
        targetSyncError = error?.code === "DIRECTORY_FSYNC_FAILED" ? error : directorySyncError(dir, error);
      }
    }
    if (targetSyncError) {
      // The write-ahead marker was durably committed before the target
      // rename, so it remains available after a process restart.
      throw registerUncertainCommit(filePath, dir, targetSyncError, {
        markerPersisted: true,
      });
    }

    try {
      await writeUncertaintyMarker(filePath, dir, "cleared", null, {
        syncDirectory: syncMarkerDirectory,
        syncFile: syncMarkerFile,
      });
      await removeUncertaintyMarkerAfterCommit(filePath, dir, { syncDirectory: syncMarkerDirectory });
    } catch (markerError) {
      const markerCode = markerError?.cause?.code || markerError?.code || "UNKNOWN";
      throw registerUncertainCommit(filePath, dir, markerError, {
        markerPersisted: existsSync(uncertaintyMarkerPath(filePath)),
        markerPersistenceErrorCode: markerCode,
      });
    }
    return data;
  } catch (error) {
    if (error?.commitState === "unknown") throw error;
    if (markerReady) {
      throw registerUncertainCommit(filePath, dir, error, {
        targetMayContainNewValue: targetRenamed,
        markerPersisted: existsSync(uncertaintyMarkerPath(filePath)),
      });
    }
    throw error;
  } finally {
    if (!targetRenamed) {
      try {
        await unlink(tempFile);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

export function writeJsonAtomic(filePath, data, writeOptions = {}) {
  return enqueueJsonStoreOperation(filePath, () => writeJsonAtomicUnlocked(filePath, data, writeOptions));
}

export function updateJsonAtomic(filePath, updater, fallback, writeOptions = {}) {
  if (typeof updater !== "function") throw new Error("updateJsonAtomic requires an updater function.");
  return enqueueJsonStoreOperation(filePath, async () => {
    const current = await readJson(filePath, fallback);
    const next = await updater(current);
    await writeJsonAtomicUnlocked(filePath, next, writeOptions);
    return next;
  });
}

export async function backupJson(filePath) {
  await stat(filePath);
  const backupFile = `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  await copyFile(filePath, backupFile);
  return backupFile;
}

async function latestBackup(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const candidates = names
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak"))
    .sort()
    .reverse();
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

export async function readJsonWithRecovery(filePath, fallback) {
  try {
    return await readJson(filePath, fallback);
  } catch (error) {
    if (error.code !== "JSON_PARSE_FAILED") throw error;
    const backupFile = await latestBackup(filePath);
    if (!backupFile) throw error;
    const backupValue = await readJson(backupFile);
    await writeJsonAtomic(filePath, backupValue);
    return backupValue;
  }
}

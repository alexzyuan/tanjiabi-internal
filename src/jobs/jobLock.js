import os from "node:os";
import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_STATE = { locks: {} };

function cacheDir(dataDir = process.cwd()) {
  return path.basename(dataDir) === "data-cache" ? dataDir : path.join(dataDir, "data-cache");
}

export function jobLockFile(dataDir = process.cwd()) {
  return path.join(cacheDir(dataDir), "job-locks.json");
}

function nowMs() {
  return Date.now();
}

function createLockId(jobName) {
  return `${jobName}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeState(current) {
  return {
    ...DEFAULT_STATE,
    ...(current && typeof current === "object" ? current : {}),
    locks: current?.locks && typeof current.locks === "object" ? current.locks : {},
  };
}

function isExpired(lock, currentTime = nowMs()) {
  return !lock?.expiresAt || new Date(lock.expiresAt).getTime() <= currentTime;
}

export async function readJobLocks({ dataDir = process.cwd() } = {}) {
  return normalizeState(await readJson(jobLockFile(dataDir), DEFAULT_STATE));
}

export async function acquireJobLock(jobName, {
  dataDir = process.cwd(),
  ttlMs = DEFAULT_TTL_MS,
  owner = `${os.hostname()}:${process.pid}`,
  metadata = {},
} = {}) {
  if (!jobName) throw new Error("acquireJobLock requires jobName.");
  const currentTime = nowMs();
  const acquiredAt = new Date(currentTime).toISOString();
  const lock = {
    jobName,
    lockId: createLockId(jobName),
    acquiredAt,
    expiresAt: new Date(currentTime + Number(ttlMs || DEFAULT_TTL_MS)).toISOString(),
    owner,
    metadata,
  };
  let result = null;
  await updateJsonAtomic(jobLockFile(dataDir), (current) => {
    const state = normalizeState(current);
    const existing = state.locks[jobName];
    if (existing && !isExpired(existing, currentTime)) {
      result = {
        acquired: false,
        reason: `Job ${jobName} is already running.`,
        existing,
      };
      return state;
    }
    result = { acquired: true, ...lock };
    return { ...state, locks: { ...state.locks, [jobName]: lock } };
  }, DEFAULT_STATE);
  return result;
}

export async function releaseJobLock(lock, { dataDir = process.cwd() } = {}) {
  if (!lock?.jobName || !lock?.lockId) return false;
  let released = false;
  await updateJsonAtomic(jobLockFile(dataDir), (current) => {
    const state = normalizeState(current);
    const existing = state.locks[lock.jobName];
    if (!existing || existing.lockId !== lock.lockId) return state;
    const locks = { ...state.locks };
    delete locks[lock.jobName];
    released = true;
    return { ...state, locks };
  }, DEFAULT_STATE);
  return released;
}

export async function withJobLock(jobName, fn, options = {}) {
  const lock = await acquireJobLock(jobName, options);
  if (!lock.acquired) return lock;
  let originalError = null;
  try {
    return await fn(lock);
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    try {
      await releaseJobLock(lock, options);
    } catch (releaseError) {
      console.error("[job-lock] release failed", {
        jobName,
        lockId: lock.lockId,
        error: releaseError.message,
      });
      if (!originalError) throw releaseError;
    }
  }
}

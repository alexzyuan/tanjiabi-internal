import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";
import { redactSensitive } from "../adapters/lingxing/index.js";

const DEFAULT_LIMIT = 20;
const DEFAULT_STATE = { jobs: [] };

function nowIso() {
  return new Date().toISOString();
}

function cacheDir(dataDir = process.cwd()) {
  return path.basename(dataDir) === "data-cache" ? dataDir : path.join(dataDir, "data-cache");
}

export function syncJobHistoryFile(dataDir = process.cwd()) {
  return path.join(cacheDir(dataDir), "sync-job-history.json");
}

function createJobId(jobName) {
  return `${jobName || "job"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeSummary(value) {
  return String(redactSensitive(String(value || ""))).slice(0, 1000);
}

function normalizeCounts(job = {}) {
  return {
    fetchedCount: Number(job.fetchedCount || 0),
    processedCount: Number(job.processedCount || 0),
    failedCount: Number(job.failedCount || 0),
  };
}

function normalizeJob(job = {}) {
  const startedAt = job.startedAt || nowIso();
  const finishedAt = job.finishedAt || null;
  return {
    jobId: job.jobId || createJobId(job.jobName),
    jobName: job.jobName || "sync",
    triggerType: job.triggerType || "manual",
    triggeredBy: job.triggeredBy || "",
    startedAt,
    finishedAt,
    status: job.status || "running",
    ...normalizeCounts(job),
    errorSummary: safeSummary(job.errorSummary),
    durationMs: Number(job.durationMs || (finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : 0)),
    metadata: job.metadata && typeof job.metadata === "object" ? redactSensitive(job.metadata) : {},
  };
}

async function updateHistory(dataDir, updater) {
  const file = syncJobHistoryFile(dataDir);
  return updateJsonAtomic(file, (current = DEFAULT_STATE) => {
    const state = {
      ...DEFAULT_STATE,
      ...(current && typeof current === "object" ? current : {}),
      jobs: Array.isArray(current?.jobs) ? current.jobs : [],
    };
    return updater(state);
  }, DEFAULT_STATE);
}

export async function startSyncJob({ dataDir = process.cwd(), ...job } = {}) {
  const record = normalizeJob({ ...job, status: "running", startedAt: job.startedAt || nowIso() });
  await updateHistory(dataDir, (state) => ({ ...state, jobs: [...state.jobs, record] }));
  return record;
}

export async function finishSyncJob({ dataDir = process.cwd(), jobId, status = "success", ...updates } = {}) {
  if (!jobId) throw new Error("finishSyncJob requires jobId.");
  const finishedAt = updates.finishedAt || nowIso();
  let finished = null;
  await updateHistory(dataDir, (state) => {
    const jobs = state.jobs.map((job) => {
      if (job.jobId !== jobId) return job;
      finished = normalizeJob({
        ...job,
        ...updates,
        status,
        finishedAt,
        durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(job.startedAt).getTime()),
      });
      return finished;
    });
    if (!finished) throw new Error(`Sync job not found: ${jobId}`);
    return { ...state, jobs };
  });
  return finished;
}

export async function appendSkippedSyncJob({ dataDir = process.cwd(), ...job } = {}) {
  const startedAt = job.startedAt || nowIso();
  const record = normalizeJob({
    ...job,
    status: "skipped",
    startedAt,
    finishedAt: job.finishedAt || startedAt,
  });
  await updateHistory(dataDir, (state) => ({ ...state, jobs: [...state.jobs, record] }));
  return record;
}

export async function listRecentSyncJobs({ dataDir = process.cwd(), limit = DEFAULT_LIMIT } = {}) {
  const state = await readJson(syncJobHistoryFile(dataDir), DEFAULT_STATE);
  return (Array.isArray(state.jobs) ? state.jobs : [])
    .slice()
    .sort((a, b) => String(b.finishedAt || b.startedAt || "").localeCompare(String(a.finishedAt || a.startedAt || "")))
    .slice(0, Math.max(0, Number(limit || DEFAULT_LIMIT)));
}

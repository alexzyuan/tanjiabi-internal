import path from "node:path";
import { withJobLock } from "../jobs/jobLock.js";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";
import { getInventoryProvisionDashboard } from "./inventoryProvisionService.js";
import { getSalesForecastDashboard } from "./salesForecastService.js";
import { getSupplierBoardDashboard } from "./supplierBoardService.js";

const WARMUP_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_RUN_AT = process.env.DEFAULT_DASHBOARD_WARMUP_AT || "08:35";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const WARMUP_STATE_FILE = path.join(process.cwd(), "data-cache", "default-dashboard-warmup.json");
const WARMUP_LOCK_TTL_MS = 3 * 60 * 60 * 1000;

let warmupTimer = null;
let warmupRunning = false;

function shanghaiClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: WARMUP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function validRunAt(value) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : DEFAULT_RUN_AT;
}

function summarizeWarmupResult(name, startedAt, result = {}) {
  return {
    name,
    durationMs: Date.now() - startedAt,
    rowCount: Array.isArray(result.rows) ? result.rows.length : 0,
    cacheHit: result.meta?.cacheHit === undefined ? null : Boolean(result.meta.cacheHit),
    syncStatus: result.meta?.syncStatus || "",
    updatedAt: result.meta?.updatedAt || "",
  };
}

async function readWarmupState() {
  return readJson(WARMUP_STATE_FILE, {});
}

async function writeWarmupState(state) {
  return writeJsonAtomic(WARMUP_STATE_FILE, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function shouldRunDefaultDashboardWarmup({ now = new Date(), state = {}, runAt = DEFAULT_RUN_AT } = {}) {
  const clock = shanghaiClock(now);
  if (state?.lastRunDate === clock.date) return false;
  return clock.time >= validRunAt(runAt);
}

export function buildDefaultDashboardWarmupJobs() {
  return [
    { name: "sales-forecast", filters: { force: true }, run: getSalesForecastDashboard },
    { name: "inventory-provision", filters: {}, run: getInventoryProvisionDashboard },
    { name: "supplier-board", filters: { dimension: "month", forceRefresh: true }, run: getSupplierBoardDashboard },
  ];
}

export async function runDefaultDashboardWarmupIfNeeded({
  force = false,
  now = new Date(),
  runAt = DEFAULT_RUN_AT,
  jobs = buildDefaultDashboardWarmupJobs(),
  readState = readWarmupState,
  writeState = writeWarmupState,
  lockRunner = withJobLock,
} = {}) {
  if (warmupRunning) return { ok: true, skipped: true, reason: "warmup already running" };
  const state = await readState();
  if (!force && !shouldRunDefaultDashboardWarmup({ now, state, runAt })) {
    return { ok: true, skipped: true, reason: "not scheduled" };
  }

  warmupRunning = true;
  const clock = shanghaiClock(now);
  const results = [];
  try {
    return await lockRunner("default-dashboard-warmup", async () => {
      const latestState = await readState();
      if (!force && !shouldRunDefaultDashboardWarmup({ now, state: latestState, runAt })) {
        return { ok: true, skipped: true, reason: "already warmed" };
      }

      console.info("[default-dashboard-warmup] started", {
        date: clock.date,
        runAt: validRunAt(runAt),
        jobs: jobs.map((job) => job.name),
      });

      try {
        for (const job of jobs) {
          const startedAt = Date.now();
          console.info("[default-dashboard-warmup] job started", { name: job.name, filters: job.filters });
          const result = await job.run(job.filters);
          const summary = summarizeWarmupResult(job.name, startedAt, result);
          results.push(summary);
          console.info("[default-dashboard-warmup] job finished", summary);
        }

        const nextState = {
          lastRunDate: clock.date,
          lastRunAt: new Date().toISOString(),
          lastStatus: "success",
          lastResult: { jobs: results },
        };
        await writeState(nextState);
        console.info("[default-dashboard-warmup] finished", nextState.lastResult);
        return { ok: true, warmed: true, jobs: results };
      } catch (error) {
        await writeState({
          ...latestState,
          lastAttemptDate: clock.date,
          lastAttemptAt: new Date().toISOString(),
          lastStatus: "failed",
          lastError: error.message || String(error),
          lastResult: { jobs: results },
        });
        throw error;
      }
    }, {
      ttlMs: WARMUP_LOCK_TTL_MS,
      metadata: { date: clock.date, runAt: validRunAt(runAt) },
    });
  } finally {
    warmupRunning = false;
  }
}

export function startDefaultDashboardWarmupScheduler({
  intervalMs = DEFAULT_POLL_MS,
  runAt = DEFAULT_RUN_AT,
} = {}) {
  if (warmupTimer) clearInterval(warmupTimer);
  runDefaultDashboardWarmupIfNeeded({ runAt }).catch((error) => {
    console.error("[default-dashboard-warmup] startup check failed", error);
  });
  warmupTimer = setInterval(() => {
    runDefaultDashboardWarmupIfNeeded({ runAt }).catch((error) => {
      console.error("[default-dashboard-warmup] scheduled run failed", error);
    });
  }, intervalMs);
}

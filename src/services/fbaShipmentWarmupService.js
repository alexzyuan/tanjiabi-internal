import path from "node:path";
import { withJobLock } from "../jobs/jobLock.js";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";
import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";

const WARMUP_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_RUN_AT = process.env.FBA_SHIPMENT_WARMUP_AT || "08:05";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const WARMUP_STATE_FILE = path.join(process.cwd(), "data-cache", "fba-shipment-warmup.json");
const WARMUP_LOCK_TTL_MS = 30 * 60 * 1000;

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

function defaultWarmupFilters(date = new Date()) {
  const clock = shanghaiClock(date);
  return {
    startDate: `${clock.date.slice(0, 8)}01`,
    endDate: clock.date,
    length: "500",
    forceRefresh: true,
  };
}

export function shouldRunFbaShipmentWarmup({ now = new Date(), state = {}, runAt = DEFAULT_RUN_AT } = {}) {
  const clock = shanghaiClock(now);
  if (state?.lastRunDate === clock.date) return false;
  return clock.time >= validRunAt(runAt);
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

export async function runFbaShipmentWarmupIfNeeded({
  force = false,
  now = new Date(),
  runAt = DEFAULT_RUN_AT,
  warmCache = getFbaShipmentCandidates,
} = {}) {
  if (warmupRunning) return { ok: true, skipped: true, reason: "warmup already running" };
  const state = await readWarmupState();
  if (!force && !shouldRunFbaShipmentWarmup({ now, state, runAt })) {
    return { ok: true, skipped: true, reason: "not scheduled" };
  }

  warmupRunning = true;
  try {
    const clock = shanghaiClock(now);
    return await withJobLock("fba-shipment-warmup", async () => {
      const latestState = await readWarmupState();
      if (!force && !shouldRunFbaShipmentWarmup({ now, state: latestState, runAt })) {
        return { ok: true, skipped: true, reason: "already warmed" };
      }

      const filters = defaultWarmupFilters(now);
      console.info("[fba-shipment-warmup] started", { date: clock.date, runAt: validRunAt(runAt), filters });
      try {
        const result = await warmCache(filters);
        const nextState = {
          lastRunDate: clock.date,
          lastRunAt: new Date().toISOString(),
          lastStatus: "success",
          lastResult: {
            total: result.total,
            rowCount: result.rows?.length || 0,
            cacheKey: result.cache?.key || "",
            fetchedAt: result.fetchedAt || "",
          },
        };
        await writeWarmupState(nextState);
        console.info("[fba-shipment-warmup] finished", nextState.lastResult);
        return { ok: true, warmed: true, ...nextState.lastResult };
      } catch (error) {
        await writeWarmupState({
          ...latestState,
          lastAttemptDate: clock.date,
          lastAttemptAt: new Date().toISOString(),
          lastStatus: "failed",
          lastError: error.message || String(error),
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

export function startFbaShipmentWarmupScheduler({
  intervalMs = DEFAULT_POLL_MS,
  runAt = DEFAULT_RUN_AT,
} = {}) {
  if (warmupTimer) clearInterval(warmupTimer);
  runFbaShipmentWarmupIfNeeded({ runAt }).catch((error) => {
    console.error("[fba-shipment-warmup] startup check failed", error);
  });
  warmupTimer = setInterval(() => {
    runFbaShipmentWarmupIfNeeded({ runAt }).catch((error) => {
      console.error("[fba-shipment-warmup] scheduled run failed", error);
    });
  }, intervalMs);
}

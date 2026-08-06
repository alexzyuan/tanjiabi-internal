import path from "node:path";
import { withJobLock } from "../jobs/jobLock.js";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";
import { warmFactoryInventoryCache } from "./factoryInventoryService.js";

const WARMUP_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_RUN_AT = process.env.FACTORY_INVENTORY_WARMUP_AT || "08:20";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const WARMUP_STATE_FILE = path.join(process.cwd(), "data-cache", "factory-inventory-warmup.json");
const WARMUP_LOCK_TTL_MS = 2 * 60 * 60 * 1000;

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

export function shouldRunFactoryInventoryWarmup({ now = new Date(), state = {}, runAt = DEFAULT_RUN_AT } = {}) {
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

export async function runFactoryInventoryWarmupIfNeeded({
  force = false,
  now = new Date(),
  runAt = DEFAULT_RUN_AT,
  warmCache = warmFactoryInventoryCache,
} = {}) {
  if (warmupRunning) return { ok: true, skipped: true, reason: "warmup already running" };
  const state = await readWarmupState();
  if (!force && !shouldRunFactoryInventoryWarmup({ now, state, runAt })) {
    return { ok: true, skipped: true, reason: "not scheduled" };
  }

  warmupRunning = true;
  try {
    const clock = shanghaiClock(now);
    return await withJobLock("factory-inventory-warmup", async () => {
      const latestState = await readWarmupState();
      if (!force && !shouldRunFactoryInventoryWarmup({ now, state: latestState, runAt })) {
        return { ok: true, skipped: true, reason: "already warmed" };
      }

      console.info("[factory-inventory-warmup] started", { date: clock.date, runAt: validRunAt(runAt) });
      try {
        const result = await warmCache();
        const nextState = {
          lastRunDate: clock.date,
          lastRunAt: new Date().toISOString(),
          lastStatus: "success",
          lastResult: result,
        };
        await writeWarmupState(nextState);
        console.info("[factory-inventory-warmup] finished", result);
        return { ok: true, warmed: true, ...result };
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

export function startFactoryInventoryWarmupScheduler({
  intervalMs = DEFAULT_POLL_MS,
  runAt = DEFAULT_RUN_AT,
} = {}) {
  if (warmupTimer) clearInterval(warmupTimer);
  runFactoryInventoryWarmupIfNeeded({ runAt }).catch((error) => {
    console.error("[factory-inventory-warmup] startup check failed", error);
  });
  warmupTimer = setInterval(() => {
    runFactoryInventoryWarmupIfNeeded({ runAt }).catch((error) => {
      console.error("[factory-inventory-warmup] scheduled run failed", error);
    });
  }, intervalMs);
}

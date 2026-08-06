import path from "node:path";
import { withJobLock } from "./jobLock.js";
import { getSlowMovingRiskDashboard, completedWeeklyRange } from "../services/slowMovingRiskService.js";
import { createSlowMovingRiskSnapshotStore } from "../services/slowMovingRiskSnapshotStore.js";
import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";

const TIME_ZONE = "Asia/Shanghai";
const DEFAULT_RUN_AT = "09:00";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 3 * 60 * 60 * 1000;
const STATE_FILE = path.join(process.cwd(), "data-cache", "slow-moving-risk-weekly-job.json");

let timer = null;
let running = false;

function shanghaiClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    time: `${parts.hour}:${parts.minute}`,
    weekday: new Date(`${date}T00:00:00.000Z`).getUTCDay(),
  };
}

function validRunAt(value) {
  return /^\d{2}:\d{2}$/u.test(String(value || "")) ? String(value) : DEFAULT_RUN_AT;
}

async function readState() {
  return readJson(STATE_FILE, {});
}

async function writeState(state) {
  return writeJsonAtomic(STATE_FILE, { ...state, updatedAt: new Date().toISOString() });
}

export function shouldRunSlowMovingRiskWeeklyJob({ now = new Date(), state = {}, runAt = DEFAULT_RUN_AT } = {}) {
  const clock = shanghaiClock(now);
  const reportKey = completedWeeklyRange(now).reportKey;
  return clock.weekday === 2
    && clock.time >= validRunAt(runAt)
    && state.lastSuccessfulReportKey !== reportKey;
}

export async function runSlowMovingRiskWeeklyJobIfNeeded({
  force = false,
  now = new Date(),
  runAt = DEFAULT_RUN_AT,
  reportService = { getDashboard: getSlowMovingRiskDashboard },
  snapshotStore = createSlowMovingRiskSnapshotStore(),
  readState: readStateImpl = readState,
  writeState: writeStateImpl = writeState,
  lockRunner = withJobLock,
} = {}) {
  const dateRange = completedWeeklyRange(now);
  if (running) return { ok: true, skipped: true, reason: "already running", reportKey: dateRange.reportKey };
  const state = await readStateImpl();
  if (!force && !shouldRunSlowMovingRiskWeeklyJob({ now, state, runAt })) {
    return { ok: true, skipped: true, reason: "not scheduled", reportKey: dateRange.reportKey };
  }

  running = true;
  try {
    return await lockRunner("slow-moving-risk-weekly-report", async () => {
      const latestState = await readStateImpl();
      if (!force && !shouldRunSlowMovingRiskWeeklyJob({ now, state: latestState, runAt })) {
        return { ok: true, skipped: true, reason: "already generated", reportKey: dateRange.reportKey };
      }
      const existing = await snapshotStore.read(dateRange.reportKey);
      if (existing?.status === "success") {
        return { ok: true, skipped: true, reason: "snapshot exists", reportKey: dateRange.reportKey };
      }

      const startedAt = Date.now();
      console.info("[slow-moving-risk-weekly-job] started", { reportKey: dateRange.reportKey, dateRange, runAt: validRunAt(runAt) });
      try {
        const dashboard = await reportService.getDashboard({ dateRange });
        await snapshotStore.saveSuccess({ reportKey: dateRange.reportKey, dashboard });
        const nextState = {
          lastSuccessfulReportKey: dateRange.reportKey,
          lastRunAt: new Date().toISOString(),
          lastStatus: "success",
          lastResult: {
            reportKey: dateRange.reportKey,
            durationMs: Date.now() - startedAt,
            rowCount: Array.isArray(dashboard.rows) ? dashboard.rows.length : 0,
            dataSources: dashboard.meta?.dataSources || {},
          },
        };
        await writeStateImpl(nextState);
        console.info("[slow-moving-risk-weekly-job] finished", nextState.lastResult);
        return { ok: true, generated: true, reportKey: dateRange.reportKey, dashboard };
      } catch (error) {
        const observability = {
          durationMs: Date.now() - startedAt,
          dateRange,
          source: error?.source || "unknown",
        };
        await snapshotStore.saveFailure({ reportKey: dateRange.reportKey, error, observability });
        await writeStateImpl({
          ...latestState,
          lastAttemptReportKey: dateRange.reportKey,
          lastAttemptAt: new Date().toISOString(),
          lastStatus: "failed",
          lastError: error?.message || String(error),
          lastResult: observability,
        });
        console.error("[slow-moving-risk-weekly-job] failed", { reportKey: dateRange.reportKey, ...observability, error: error?.message || String(error) });
        throw error;
      }
    }, {
      ttlMs: LOCK_TTL_MS,
      metadata: { reportKey: dateRange.reportKey, runAt: validRunAt(runAt) },
    });
  } finally {
    running = false;
  }
}

export function startSlowMovingRiskWeeklyScheduler({ intervalMs = DEFAULT_POLL_MS, runAt = DEFAULT_RUN_AT } = {}) {
  if (timer) clearInterval(timer);
  runSlowMovingRiskWeeklyJobIfNeeded({ runAt }).catch((error) => {
    console.error("[slow-moving-risk-weekly-job] startup check failed", error);
  });
  timer = setInterval(() => {
    runSlowMovingRiskWeeklyJobIfNeeded({ runAt }).catch((error) => {
      console.error("[slow-moving-risk-weekly-job] scheduled run failed", error);
    });
  }, intervalMs);
}

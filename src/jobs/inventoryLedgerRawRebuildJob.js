import { getConfig } from "../config/index.js";
import { withJobLock } from "./jobLock.js";
import { createInventoryLedgerRawReportStore } from "../services/inventoryLedgerRawReportStore.js";
import { runInventoryLedgerRawRebuild } from "../services/inventoryLedgerRawReportService.js";

const TIME_ZONE = "Asia/Shanghai";
const DEFAULT_RUN_AT = "02:00";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 6 * 60 * 60 * 1000;
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
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function priorMonth(now) {
  const { date } = shanghaiClock(now);
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const previous = new Date(year, month - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}

function validRunAt(value) {
  return /^\d{2}:\d{2}$/u.test(String(value || "")) ? String(value) : DEFAULT_RUN_AT;
}

export function shouldRunInventoryLedgerRawRebuild({ now = new Date(), state = {}, runAt = DEFAULT_RUN_AT } = {}) {
  const clock = shanghaiClock(now);
  if (Number(clock.date.slice(-2)) < 10) return false;
  if (clock.time < validRunAt(runAt)) return false;
  if (state?.lastAttemptPeriod === priorMonth(now) && state?.lastAttemptDate === clock.date) return false;
  return state?.lastSuccessfulPeriod !== priorMonth(now);
}

export async function runInventoryLedgerRawRebuildIfNeeded({
  force = false,
  now = new Date(),
  runAt = getConfig().inventoryLedgerRebuildAt,
  rebuild = runInventoryLedgerRawRebuild,
  store = createInventoryLedgerRawReportStore(),
  readState = () => store.readJobState(),
  writeState = (state) => store.writeJobState(state),
  lockRunner = withJobLock,
  logger = console,
} = {}) {
  const period = priorMonth(now);
  if (running) return { ok: true, skipped: true, reason: "already running", period };
  const state = await readState();
  if (!force && !shouldRunInventoryLedgerRawRebuild({ now, state, runAt })) {
    return { ok: true, skipped: true, reason: "not scheduled", period };
  }
  running = true;
  try {
    return await lockRunner("inventory-ledger-raw-rebuild", async () => {
      const latestState = await readState();
      if (!force && !shouldRunInventoryLedgerRawRebuild({ now, state: latestState, runAt })) {
        return { ok: true, skipped: true, reason: "already completed", period };
      }
      const startedAt = Date.now();
      logger.info?.("[inventory-ledger-raw-rebuild-job] started", { period, runAt: validRunAt(runAt), force });
      try {
        const result = await rebuild({ force, now });
        const nextState = {
          lastSuccessfulPeriod: period,
          lastRunAt: new Date().toISOString(),
          lastStatus: "success",
          lastResult: {
            committedMonths: result.committedMonths || [],
            rebuiltRowCount: Number(result.rebuiltRowCount || 0),
            durationMs: Date.now() - startedAt,
          },
        };
        await writeState(nextState);
        logger.info?.("[inventory-ledger-raw-rebuild-job] completed", { period, ...nextState.lastResult });
        return { ok: true, rebuilt: true, period, result };
      } catch (error) {
        await writeState({
          ...latestState,
          lastAttemptPeriod: period,
          lastAttemptAt: new Date().toISOString(),
          lastAttemptDate: shanghaiClock(now).date,
          lastStatus: "failed",
          lastError: error.message || String(error),
          lastFailure: {
            stage: error.stage || "unknown",
            month: error.month || "",
            sellerId: error.sellerId || "",
            taskId: error.taskId || "",
            taskStatus: error.taskStatus || "",
          },
          lastResult: { durationMs: Date.now() - startedAt, stage: error.stage || "unknown" },
        });
        logger.error?.("[inventory-ledger-raw-rebuild-job] failed", { period, error: error.message || String(error) });
        throw error;
      }
    }, { ttlMs: LOCK_TTL_MS, metadata: { period, runAt: validRunAt(runAt) } });
  } finally {
    running = false;
  }
}

export function startInventoryLedgerRawRebuildScheduler({
  intervalMs = DEFAULT_POLL_MS,
  runAt = getConfig().inventoryLedgerRebuildAt,
} = {}) {
  if (timer) clearInterval(timer);
  runInventoryLedgerRawRebuildIfNeeded({ runAt }).catch((error) => {
    console.error("[inventory-ledger-raw-rebuild-job] startup check failed", { error: error.message });
  });
  timer = setInterval(() => {
    runInventoryLedgerRawRebuildIfNeeded({ runAt }).catch((error) => {
      console.error("[inventory-ledger-raw-rebuild-job] scheduled run failed", { error: error.message });
    });
  }, intervalMs);
}

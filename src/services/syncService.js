import { getConfig } from "../config/index.js";
import { addSalesFactsDateDays, normalizeSalesFactsScope, normalizeSalesFactsRequestId } from "./salesFactsIdentity.js";
import { SALES_WEEKLY_SOURCE_CACHE_VERSION } from "./salesWeeklySourceCache.js";
import { captureInventoryProvisionSnapshot } from "./inventoryProvisionService.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { getPacificTodayText } from "../utils/pacificDate.js";
import { acquireJobLock, releaseJobLock } from "../jobs/jobLock.js";
import {
  appendSkippedSyncJob,
  finishSyncJob,
  listRecentSyncJobs,
  startSyncJob,
} from "../repositories/syncJobRepository.js";

const config = getConfig();
const syncState = {
  provider: config.dataProvider,
  intervalHours: config.syncIntervalHours,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastStatus: "等待首次同步",
  lastError: null,
  running: false,
};

let timer = null;
const SYNC_JOB_NAME = "lingxing-sync";
let salesFactsRuntime = null;

export function configureSalesFactsSyncService({
  refreshOrderProfitScope,
  getSellerDirectory: resolveSellerDirectory,
  now = Date.now,
  captureInventorySnapshot = captureInventoryProvisionSnapshot,
  logger = console,
} = {}) {
  if (typeof refreshOrderProfitScope !== "function") {
    throw new Error("销售事实同步运行时缺少 refreshOrderProfitScope。");
  }
  if (typeof resolveSellerDirectory !== "function") {
    throw new Error("销售事实同步运行时缺少 seller directory。");
  }
  if (typeof now !== "function" && !Number.isFinite(Number(now))) {
    throw new Error("销售事实同步运行时 now 无效。");
  }
  if (typeof captureInventorySnapshot !== "function") {
    throw new Error("销售事实同步运行时库存快照依赖无效。");
  }
  salesFactsRuntime = {
    refreshOrderProfitScope,
    getSellerDirectory: resolveSellerDirectory,
    now,
    captureInventorySnapshot,
    logger,
  };
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function syncFromMock() {
  return {
    ok: true,
    provider: "mock",
    message: "模拟同步完成，正式接入后这里会写入领星数据。",
    rows: 0,
  };
}

export function buildSalesWeeklySyncSource(data = {}, budgetTargets = {}, listingOwnerRows = []) {
  return {
    cacheScope: {
      version: SALES_WEEKLY_SOURCE_CACHE_VERSION,
      startDate: data.range?.startDate || "",
      endDate: data.range?.endDate || "",
      currencyCode: data.currencyCode || "CNY",
      sids: [],
    },
    sellers: data.sellers || [],
    sellerProfitRecords: data.sellerProfitRecords || [],
    orderProfitRecords: data.orderProfitRecords || [],
    recent30OrderProfitRecords: data.recent30OrderProfitRecords || [],
    dailyProfitRecords: data.dailyProfitRecords || [],
    inventoryRecords: data.inventoryRecords || [],
    listingOwnerRows,
    budgetTargets,
    range: data.range,
    currencyCode: data.currencyCode || "CNY",
    raw: data.raw || {},
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
}

export async function syncFromLingxing() {
  if (!salesFactsRuntime) {
    throw new Error("销售事实同步运行时未配置，拒绝回退到旧 OrderProfit/周报缓存。");
  }
  const currentMs = Number(typeof salesFactsRuntime.now === "function" ? salesFactsRuntime.now() : salesFactsRuntime.now);
  if (!Number.isSafeInteger(currentMs) || currentMs < 0) {
    throw new Error("销售事实同步当前时间无效。");
  }
  // The scheduled facts sync is the authoritative runtime refresh boundary.
  // Do not let an older seven-store seller cache silently narrow the active SID scope.
  const directoryResult = await salesFactsRuntime.getSellerDirectory({ forceRefresh: true });
  const sellers = Array.isArray(directoryResult) ? directoryResult : directoryResult?.sellers;
  if (!Array.isArray(sellers) || !sellers.length) {
    throw new Error("销售事实同步 seller directory 为空。");
  }
  const activeSellers = sellers.filter((seller) => {
    const status = seller?.status;
    return status === undefined || status === null || status === "" || Number(status) === 1
      || ["active", "enabled", "正常", "启用"].includes(String(status).trim().toLocaleLowerCase("en-US"));
  });
  const sids = activeSellers.map((seller) => Number(seller?.sid ?? seller?.seller_id ?? seller?.sellerId));
  if (!sids.length || sids.some((sid) => !Number.isSafeInteger(sid) || sid <= 0)) {
    throw new Error("销售事实同步 seller directory 不包含有效 SID。");
  }
  const endDate = getPacificTodayText(new Date(currentMs));
  const startDate = addSalesFactsDateDays(endDate, -29);
  const scope = normalizeSalesFactsScope({
    startDate,
    endDate,
    sids,
    currencyMode: "CNY",
    sellerDirectory: sellers,
    now: new Date(currentMs),
  });
  const requestId = normalizeSalesFactsRequestId("sync-sales-facts", { fallback: "sync-sales-facts" });
  salesFactsRuntime.logger?.info?.("[sync] sales facts refresh start", {
    requestId,
    rangeKey: scope.rangeKey,
    dayCount: scope.dates.length,
    sidCount: scope.sids.length,
  });
  const factsResult = await salesFactsRuntime.refreshOrderProfitScope(scope, {
    forceRefresh: false,
    requestId,
  });
  let inventorySnapshotMessage = "";
  try {
    const inventorySnapshot = await salesFactsRuntime.captureInventorySnapshot({ sellers });
    inventorySnapshotMessage = `，库存快照 ${inventorySnapshot.date} 共 ${inventorySnapshot.rowCount} 条`;
  } catch (error) {
    inventorySnapshotMessage = `，库存快照失败：${error.message}`;
  }
  const meta = factsResult?.meta || {};
  const factCount = Array.isArray(factsResult?.facts) ? factsResult.facts.length : 0;
  salesFactsRuntime.logger?.info?.("[sync] sales facts refresh complete", {
    requestId,
    rangeKey: scope.rangeKey,
    cacheState: meta.cacheState || "unknown",
    revision: Number.isSafeInteger(meta.revision) ? meta.revision : null,
    factCount,
  });
  return {
    ok: true,
    provider: "lingxing",
    message: `领星同步完成：店铺 ${sellers.length} 个，销售事实 ${factCount} 条${inventorySnapshotMessage}。`,
    rows: factCount,
    cacheState: meta.cacheState || "unknown",
    revision: Number.isSafeInteger(meta.revision) ? meta.revision : null,
    updatedAt: meta.updatedAt || null,
    ageSeconds: Number.isFinite(Number(meta.ageSeconds)) ? Number(meta.ageSeconds) : null,
    rangeKey: scope.rangeKey,
  };
}

export async function getLingxingShops() {
  const { sellers, meta } = await getSellerDirectory();
  return {
    sellers,
    ...meta,
  };
}

export function getSyncState() {
  return { ...syncState };
}

export async function getSyncStatus({ limit = 20 } = {}) {
  return {
    ...getSyncState(),
    history: await listRecentSyncJobs({ limit }),
  };
}

function defaultSyncExecutor() {
  return config.dataProvider === "lingxing" ? syncFromLingxing() : syncFromMock();
}

function updateStateStarted() {
  syncState.running = true;
  syncState.lastStartedAt = nowText();
  syncState.lastStatus = "同步中";
  syncState.lastError = null;
}

function updateStateSuccess(result) {
  syncState.lastFinishedAt = nowText();
  syncState.lastSuccessAt = syncState.lastFinishedAt;
  syncState.lastStatus = result.message;
}

function updateStateFailure(error) {
  syncState.lastFinishedAt = nowText();
  syncState.lastStatus = "同步失败";
  syncState.lastError = error.message;
}

async function recordSkipped({ triggerType, triggeredBy, reason }) {
  await appendSkippedSyncJob({
    jobName: SYNC_JOB_NAME,
    triggerType,
    triggeredBy,
    errorSummary: reason,
    metadata: { provider: config.dataProvider },
  });
}

export async function runSync({
  triggerType = "manual",
  triggeredBy = "",
  executeSync = defaultSyncExecutor,
} = {}) {
  if (syncState.running) {
    await recordSkipped({
      triggerType,
      triggeredBy,
      reason: "已有同步任务正在运行，请稍后再试。",
    });
    return { ok: false, message: "已有同步任务正在运行，请稍后再试。", state: getSyncState() };
  }

  updateStateStarted();
  const lock = await acquireJobLock(SYNC_JOB_NAME, {
    ttlMs: Math.max(1, config.syncIntervalHours) * 60 * 60 * 1000,
    metadata: { triggerType, provider: config.dataProvider },
  });

  if (!lock.acquired) {
    const reason = lock.reason || "已有同步任务正在运行，请稍后再试。";
    await recordSkipped({ triggerType, triggeredBy, reason });
    syncState.running = false;
    syncState.lastFinishedAt = nowText();
    syncState.lastStatus = "同步跳过";
    syncState.lastError = reason;
    return { ok: false, message: "已有同步任务正在运行，请稍后再试。", state: getSyncState() };
  }

  const job = await startSyncJob({
    jobName: SYNC_JOB_NAME,
    triggerType,
    triggeredBy,
    metadata: { provider: config.dataProvider },
  });

  try {
    const result = await executeSync();
    updateStateSuccess(result);
    await finishSyncJob({
      jobId: job.jobId,
      status: "success",
      fetchedCount: result.rows || 0,
      processedCount: result.rows || 0,
      failedCount: 0,
      metadata: { provider: result.provider || config.dataProvider },
    });
    return { ...result, state: getSyncState() };
  } catch (error) {
    updateStateFailure(error);
    await finishSyncJob({
      jobId: job.jobId,
      status: "failed",
      failedCount: 1,
      errorSummary: error.message,
      metadata: { provider: config.dataProvider },
    });
    return { ok: false, message: error.message, state: getSyncState() };
  } finally {
    try {
      await releaseJobLock(lock);
    } catch (releaseError) {
      console.error("[sync] release job lock failed", { error: releaseError.message });
    } finally {
      syncState.running = false;
    }
  }
}

export async function runManualSync() {
  return runSync({ triggerType: "manual" });
}

export function startSyncScheduler() {
  const intervalMs = config.syncIntervalHours * 60 * 60 * 1000;
  if (timer) clearInterval(timer);

  // 启动时先跑一次，让状态从“等待”变成“已就绪”。
  runSync({ triggerType: "startup", triggeredBy: "scheduler" });
  timer = setInterval(() => {
    runSync({ triggerType: "scheduled", triggeredBy: "scheduler" });
  }, intervalMs);
}

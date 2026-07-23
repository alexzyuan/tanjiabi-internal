import { getConfig } from "../config/index.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { mapLingxingToSalesDashboard } from "./lingxingDashboardMapper.js";
import {
  readLingxingSellersCache,
  saveLingxingSellersCache,
  saveSalesDashboardCache,
  saveSalesWeeklySourceCache,
} from "../utils/cacheStore.js";
import { getBudgetTargetContext } from "./budgetTargetService.js";
import { fetchListingOwnerRows, ownerLookupRowsFromRecords } from "./listingOwnerService.js";
import { captureInventoryProvisionSnapshot } from "./inventoryProvisionService.js";
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

async function syncFromLingxing() {
  const adapter = getLingxingAdapter();
  const data = await adapter.fetchSalesWeeklyData();
  const budgetTargets = await getBudgetTargetContext(data.range);
  let listingOwnerRows = [];
  try {
    listingOwnerRows = await fetchListingOwnerRows(adapter, ownerLookupRowsFromRecords(data.orderProfitRecords || data.sellerProfitRecords || []));
  } catch {
    listingOwnerRows = [];
  }
  const source = {
    cacheScope: {
      version: "sales-weekly-source-v1",
      startDate: data.range?.startDate || "",
      endDate: data.range?.endDate || "",
      currencyCode: data.currencyCode || "ORIGINAL",
      sids: [],
    },
    sellers: data.sellers || [],
    sellerProfitRecords: data.sellerProfitRecords || [],
    orderProfitRecords: data.orderProfitRecords || [],
    dailyProfitRecords: data.dailyProfitRecords || [],
    inventoryRecords: data.inventoryRecords || [],
    listingOwnerRows,
    budgetTargets,
    range: data.range,
    currencyCode: data.currencyCode || "ORIGINAL",
    raw: data.raw || {},
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  const dashboard = mapLingxingToSalesDashboard({ ...source, filters: {} });
  const sourceCacheKey = JSON.stringify(source.cacheScope);
  await saveSalesWeeklySourceCache(sourceCacheKey, source);
  await saveSalesDashboardCache(dashboard);
  await saveLingxingSellersCache(data.sellers);
  let inventorySnapshotMessage = "";
  try {
    const inventorySnapshot = await captureInventoryProvisionSnapshot({ sellers: data.sellers });
    inventorySnapshotMessage = `，库存快照 ${inventorySnapshot.date} 共 ${inventorySnapshot.rowCount} 条`;
  } catch (error) {
    inventorySnapshotMessage = `，库存快照失败：${error.message}`;
  }
  return {
    ok: true,
    provider: "lingxing",
    message: `领星同步完成：店铺 ${data.sellers.length} 个，订单利润 ${data.orderProfitRecords.length} 条${inventorySnapshotMessage}。`,
    rows: data.orderProfitRecords.length,
  };
}

export async function getLingxingShops() {
  const cached = await readLingxingSellersCache();
  return {
    ...cached,
    sellers: filterCoreSellers(cached.sellers || []),
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

import { randomUUID } from "node:crypto";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { readInventoryProvisionHistoryCache } from "../utils/cacheStore.js";
import { createInventoryLedgerRawReportStore } from "./inventoryLedgerRawReportStore.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { parseInventoryLedgerReport } from "./inventoryLedgerReportParser.js";
import { rebuildInventoryProvisionHistory } from "./inventoryProvisionLedgerRebuilder.js";

const DEFAULT_START_MONTH = "2025-10";
const REPORT_TYPE = "GET_LEDGER_DETAIL_VIEW_DATA";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 180;
let lastStatus = { status: "idle", updatedAt: "" };

function shanghaiMonth(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}

function shiftMonth(month, delta) {
  const [year, value] = String(month).split("-").map(Number);
  const date = new Date(year, value - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lastDay(month) {
  const [year, value] = String(month).split("-").map(Number);
  return String(new Date(year, value, 0).getDate()).padStart(2, "0");
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function regionForSeller(seller) {
  const country = String(seller.countryCode || seller.country || "").trim().toUpperCase();
  if (["US", "CA", "MX", "BR"].includes(country) || /美国|加拿大/u.test(String(seller.country || ""))) return "na";
  if (["DE", "ES", "UK", "FR", "BE", "NL", "IT", "SE", "PL"].includes(country) || /德国/u.test(String(seller.country || ""))) return "eu";
  if (["AU", "JP", "SG"].includes(country) || /澳洲|澳大利亚/u.test(String(seller.country || ""))) return "fe";
  throw new Error(`库存分类账无法识别店铺区域：${seller.name || seller.seller_id || "-"}`);
}

function scopeForSeller(seller) {
  const sellerId = String(seller.seller_id || seller.sellerId || "").trim();
  const marketplaceId = String(seller.marketplaceId || seller.marketplace_id || "").trim();
  if (!sellerId) throw new Error(`库存分类账店铺缺少 seller_id：${seller.name || seller.sid || "-"}`);
  if (!marketplaceId) throw new Error(`库存分类账店铺缺少 marketplaceId：${seller.name || sellerId}`);
  const region = regionForSeller(seller);
  return {
    seller,
    sellerId,
    marketplaceId,
    region,
    scopeKey: `${sellerId}|${region}|${marketplaceId}`,
  };
}

function extensionForCompression(compression) {
  const value = String(compression || "NONE").trim().toUpperCase();
  if (value === "GZIP") return "tsv.gz";
  if (value === "NONE") return "tsv";
  throw new Error(`库存分类账不支持的压缩方式：${value}`);
}

function requireTaskId(payload, context) {
  const taskId = String(payload?.data?.task_id || "").trim();
  if (!taskId) throw new Error(`库存分类账创建导出任务未返回 task_id：${context.month} / ${context.sellerId}`);
  return taskId;
}

function safeError(error, details = {}) {
  const result = new Error(error?.message || String(error));
  result.stage = details.stage || error?.stage || "unknown";
  result.month = details.month || error?.month || "";
  result.sellerId = details.sellerId || error?.sellerId || "";
  result.runId = details.runId || error?.runId || "";
  return result;
}

function baseRowsFromCaches(caches, sellers) {
  const result = new Map();
  for (const seller of sellers) {
    const sellerId = String(seller.seller_id || seller.sellerId || "");
    const marketplaceId = String(seller.marketplaceId || seller.marketplace_id || "");
    for (const cached of caches) {
      for (const row of cached?.data?.rows || []) {
        if (String(row.sellerId || "") !== sellerId || !String(row.msku || "").trim()) continue;
        const key = `${sellerId}|${marketplaceId}|${String(row.msku).trim()}`;
        const current = result.get(key) || {};
        result.set(key, {
          ...current,
          ...Object.fromEntries(Object.entries({
            sid: row.sid,
            sellerId: row.sellerId,
            countryCode: row.countryCode,
            storeName: row.storeName,
            country: row.country,
            msku: row.msku,
            skuName: row.skuName,
            listingOwner: row.listingOwner,
            purchaseCost: row.purchaseCost,
            firstLegCost: row.firstLegCost,
          }).filter(([, value]) => value !== undefined && value !== null && value !== "")),
        });
      }
    }
  }
  return result;
}

async function parseSavedReport({ store, manifest, scope, month, parser }) {
  const bytes = await store.readReport({ month, scopeKey: scope.scopeKey, extension: manifest.extension });
  if (!bytes?.length) throw new Error(`库存分类账原始文件缺失或为空：${month} / ${scope.sellerId}`);
  return parser(bytes, {
    compressionAlgorithm: manifest.compressionAlgorithm,
    expectedMonth: month,
    sellerId: scope.sellerId,
    marketplaceId: scope.marketplaceId,
    scopeKey: scope.scopeKey,
  });
}

async function pollReportTask({ adapter, taskId, scope, month, sleep, pollIntervalMs, maxPollAttempts }) {
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const payload = await adapter.queryReportExportTask({ seller_id: scope.sellerId, task_id: taskId, region: scope.region });
    const data = payload?.data || {};
    const status = String(data.progress_status || "").trim().toUpperCase();
    if (status === "DONE") return data;
    if (["FATAL", "CANCELLED", "UNKNOWN"].includes(status)) {
      throw new Error(`库存分类账导出失败：${status}（${month} / ${scope.sellerId}）。`);
    }
    if (!["IN_QUEUE", "IN_PROGRESS"].includes(status)) {
      throw new Error(`库存分类账导出状态无效：${status || "空"}（${month} / ${scope.sellerId}）。`);
    }
    if (attempt < maxPollAttempts) await sleep(pollIntervalMs);
  }
  throw new Error(`库存分类账导出超时：${month} / ${scope.sellerId}`);
}

async function fetchOrReuseReport({ adapter, store, parser, scope, month, force, sleep, pollIntervalMs, maxPollAttempts, runId }) {
  let manifest = !force ? await store.readManifest(month, scope.scopeKey) : null;
  if (manifest?.status === "success") {
    const parsed = await parseSavedReport({ store, manifest, scope, month, parser });
    return { manifest, parsed, reused: true };
  }

  let stage = "create";
  try {
    const createPayload = await adapter.createReportExportTask({
      seller_id: scope.sellerId,
      report_type: REPORT_TYPE,
      data_start_time: `${month}-01T00:00:00Z`,
      data_end_time: `${month}-${lastDay(month)}T23:59:59Z`,
      marketplace_ids: [scope.marketplaceId],
      region: scope.region,
    });
    const taskId = requireTaskId(createPayload, { month, sellerId: scope.sellerId });
    stage = "poll";
    const task = await pollReportTask({ adapter, taskId, scope, month, sleep, pollIntervalMs, maxPollAttempts });
    const reportDocumentId = String(task.report_document_id || "").trim();
    let url = String(task.url || "").trim();
    if (!url) {
      if (!reportDocumentId) throw new Error(`库存分类账完成任务缺少 report_document_id：${month} / ${scope.sellerId}`);
      stage = "renew";
      const renewed = await adapter.renewReportExportTask({ seller_id: scope.sellerId, report_document_id: reportDocumentId, region: scope.region });
      url = String(renewed?.data?.url || "").trim();
      if (!url) throw new Error(`库存分类账下载链接续期未返回 URL：${month} / ${scope.sellerId}`);
    }
    stage = "download";
    const bytes = await adapter.downloadReportDocument(url);
    const compressionAlgorithm = String(task.compression_algorithm || "NONE").trim().toUpperCase();
    const extension = extensionForCompression(compressionAlgorithm);
    stage = "parse";
    const parsed = parser(bytes, {
      compressionAlgorithm,
      expectedMonth: month,
      sellerId: scope.sellerId,
      marketplaceId: scope.marketplaceId,
      scopeKey: scope.scopeKey,
    });
    stage = "archive";
    manifest = await store.saveReport({
      month,
      scopeKey: scope.scopeKey,
      extension,
      bytes,
      manifest: {
        status: "success",
        sellerId: scope.sellerId,
        marketplaceId: scope.marketplaceId,
        region: scope.region,
        reportType: REPORT_TYPE,
        taskId,
        reportDocumentId,
        compressionAlgorithm,
        fetchedAt: new Date().toISOString(),
        parsedRowCount: parsed.meta.rowCount,
      },
    });
    return { manifest, parsed, reused: false };
  } catch (error) {
    throw safeError(error, { stage, month, sellerId: scope.sellerId, runId });
  }
}

export function buildInventoryLedgerTargetMonths({ now = new Date(), startMonth = DEFAULT_START_MONTH } = {}) {
  if (!/^\d{4}-\d{2}$/u.test(String(startMonth || ""))) throw new Error("库存分类账重建起始月份无效。");
  const endMonth = shiftMonth(shanghaiMonth(now), -1);
  if (startMonth > endMonth) throw new Error(`库存分类账重建起始月份 ${startMonth} 晚于上个月 ${endMonth}。`);
  const months = [];
  for (let month = startMonth; month <= endMonth; month = shiftMonth(month, 1)) months.push(month);
  return months;
}

export function getInventoryLedgerRawRebuildStatus() {
  return { ...lastStatus };
}

export async function runInventoryLedgerRawRebuild({
  force = false,
  now = new Date(),
  startMonth = DEFAULT_START_MONTH,
  adapter = getLingxingAdapter(),
  store = createInventoryLedgerRawReportStore(),
  getSellers = getSellerDirectory,
  parser = parseInventoryLedgerReport,
  rebuilder = rebuildInventoryProvisionHistory,
  readHistoryCache = readInventoryProvisionHistoryCache,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollIntervalMs = POLL_INTERVAL_MS,
  maxPollAttempts = MAX_POLL_ATTEMPTS,
  logger = console,
} = {}) {
  const runId = `inventory-ledger-raw-rebuild-${randomUUID()}`;
  const startedAt = Date.now();
  const targetMonths = buildInventoryLedgerTargetMonths({ now, startMonth });
  lastStatus = { status: "running", runId, targetMonths, startedAt: new Date().toISOString() };
  try {
    const directory = await getSellers({ adapter, forceRefresh: true });
    const sellers = filterCoreSellers(directory?.sellers || directory || []);
    if (!sellers.length) throw new Error("库存分类账重建店铺目录为空。");
    const scopes = sellers.map(scopeForSeller);
    const parsedReports = [];
    let reusedReportCount = 0;
    logger.info?.("[inventory-ledger-raw-rebuild] started", { runId, targetMonths, sellerCount: sellers.length, force });
    for (const month of targetMonths) {
      for (const scope of scopes) {
        const result = await fetchOrReuseReport({ adapter, store, parser, scope, month, force, sleep, pollIntervalMs, maxPollAttempts, runId });
        parsedReports.push(result.parsed);
        if (result.reused) reusedReportCount += 1;
      }
    }
    const caches = await Promise.all(targetMonths.map((month) => readHistoryCache(month)));
    const baseRowsByKey = baseRowsFromCaches(caches, sellers);
    const records = parsedReports.flatMap((result) => result.records);
    const rebuilt = rebuilder({ records, targetMonths, sellers, baseRowsByKey });
    const committed = await store.commitInventoryProvisionHistoryBatch({ entries: rebuilt.entries, targetMonths });
    const result = {
      ok: true,
      runId,
      targetMonths,
      sellerCount: sellers.length,
      reportCount: parsedReports.length,
      reusedReportCount,
      parsedRowCount: records.length,
      rebuiltRowCount: rebuilt.summary.rowCount,
      metadataFallbackRows: rebuilt.summary.metadataFallbackRows,
      committedMonths: committed.committedMonths,
      fetchedAt: new Date().toISOString(),
      rebuiltAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
    lastStatus = { status: "success", ...result };
    logger.info?.("[inventory-ledger-raw-rebuild] completed", result);
    return result;
  } catch (error) {
    const failed = safeError(error, { runId });
    lastStatus = {
      status: "failed",
      runId,
      stage: failed.stage,
      month: failed.month,
      sellerId: failed.sellerId,
      error: failed.message,
      failedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
    logger.error?.("[inventory-ledger-raw-rebuild] failed", lastStatus);
    throw failed;
  }
}

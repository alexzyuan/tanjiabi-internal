import { randomUUID } from "node:crypto";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { readInventoryProvisionHistoryCache } from "../utils/cacheStore.js";
import { createInventoryLedgerRawReportStore } from "./inventoryLedgerRawReportStore.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { parseInventoryLedgerApiRecords } from "./inventoryLedgerReportParser.js";
import { rebuildInventoryProvisionHistory } from "./inventoryProvisionLedgerRebuilder.js";

const DEFAULT_START_MONTH = "2025-10";
const DEFAULT_LEDGER_SEED_MONTH = "2024-10";
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
    location: countryCodeForSeller(seller),
    scopeKey: `${sellerId}|${region}|${marketplaceId}`,
  };
}

function countryCodeForSeller(seller) {
  const explicit = String(seller.countryCode || "").trim().toUpperCase();
  if (explicit) return explicit;
  const country = String(seller.country || "").trim();
  const known = new Map([["美国", "US"], ["加拿大", "CA"], ["德国", "DE"], ["澳洲", "AU"], ["澳大利亚", "AU"]]);
  const code = known.get(country);
  if (!code) throw new Error(`库存分类账无法识别店铺国家编码：${seller.name || seller.seller_id || "-"}`);
  return code;
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
  let sourceRecords;
  try {
    sourceRecords = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`库存分类账归档 JSON 无法解析：${month} / ${scope.sellerId}。${error.message}`);
  }
  return parser(sourceRecords, {
    expectedMonth: month,
    sellerId: scope.sellerId,
    marketplaceId: scope.marketplaceId,
    scopeKey: scope.scopeKey,
  });
}

async function fetchOrReuseReport({ adapter, store, parser, scope, month, force, dryRun, runId }) {
  let manifest = !force && !dryRun ? await store.readManifest(month, scope.scopeKey) : null;
  if (manifest?.status === "success" && manifest.source === "lingxing-inventory-ledger-detail-api") {
    const parsed = await parseSavedReport({ store, manifest, scope, month, parser });
    return { manifest, parsed, reused: true };
  }

  let stage = "fetch";
  try {
    const sourceRecords = await adapter.fetchAllInventoryLedgerDetails({
      sellerIds: [scope.sellerId],
      startDate: `${month}-01`,
      endDate: `${month}-${lastDay(month)}`,
      disposition: "01",
      locations: [scope.location],
    });
    stage = "parse";
    const parsed = parser(sourceRecords, {
      expectedMonth: month,
      sellerId: scope.sellerId,
      marketplaceId: scope.marketplaceId,
      scopeKey: scope.scopeKey,
    });
    if (dryRun) return { manifest: null, parsed, reused: false };
    stage = "archive";
    const bytes = Buffer.from(JSON.stringify(sourceRecords));
    manifest = await store.saveReport({
      month,
      scopeKey: scope.scopeKey,
      extension: "json",
      bytes,
      manifest: {
        status: "success",
        source: "lingxing-inventory-ledger-detail-api",
        sellerId: scope.sellerId,
        marketplaceId: scope.marketplaceId,
        region: scope.region,
        startDate: `${month}-01`,
        endDate: `${month}-${lastDay(month)}`,
        disposition: "01",
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

function buildInventoryLedgerSourceMonths({ targetMonths, ledgerSeedMonth }) {
  if (!/^\d{4}-\d{2}$/u.test(String(ledgerSeedMonth || ""))) throw new Error("库存分类账 FIFO 种子月份无效。 ");
  const lastMonth = targetMonths.at(-1);
  if (ledgerSeedMonth > lastMonth) throw new Error("库存分类账 FIFO 种子月份晚于重建结束月份。 ");
  const months = [];
  for (let month = ledgerSeedMonth; month <= lastMonth; month = shiftMonth(month, 1)) months.push(month);
  return months;
}

export function getInventoryLedgerRawRebuildStatus() {
  return { ...lastStatus };
}

export async function runInventoryLedgerRawRebuild({
  force = false,
  dryRun = false,
  now = new Date(),
  startMonth = DEFAULT_START_MONTH,
  ledgerSeedMonth = DEFAULT_LEDGER_SEED_MONTH,
  adapter = getLingxingAdapter(),
  store = createInventoryLedgerRawReportStore(),
  getSellers = getSellerDirectory,
  parser = parseInventoryLedgerApiRecords,
  rebuilder = rebuildInventoryProvisionHistory,
  readHistoryCache = readInventoryProvisionHistoryCache,
  logger = console,
} = {}) {
  const runId = `inventory-ledger-raw-rebuild-${randomUUID()}`;
  const startedAt = Date.now();
  const targetMonths = buildInventoryLedgerTargetMonths({ now, startMonth });
  const sourceMonths = buildInventoryLedgerSourceMonths({ targetMonths, ledgerSeedMonth });
  lastStatus = { status: "running", runId, targetMonths, sourceMonths, startedAt: new Date().toISOString() };
  try {
    const directory = await getSellers({ adapter, forceRefresh: true });
    const sellers = filterCoreSellers(directory?.sellers || directory || []);
    if (!sellers.length) throw new Error("库存分类账重建店铺目录为空。");
    const scopes = sellers.map(scopeForSeller);
    const parsedReports = [];
    let reusedReportCount = 0;
    logger.info?.("[inventory-ledger-raw-rebuild] started", { runId, targetMonths, sellerCount: sellers.length, force });
    for (const month of sourceMonths) {
      for (const scope of scopes) {
        const result = await fetchOrReuseReport({ adapter, store, parser, scope, month, force, dryRun, runId });
        parsedReports.push(result.parsed);
        if (result.reused) reusedReportCount += 1;
      }
    }
    const caches = await Promise.all(targetMonths.map((month) => readHistoryCache(month)));
    const baseRowsByKey = baseRowsFromCaches(caches, sellers);
    const records = parsedReports.flatMap((result) => result.records);
    const rebuilt = rebuilder({ records, targetMonths, sellers, baseRowsByKey });
    const committed = dryRun
      ? { committedMonths: [] }
      : await store.commitInventoryProvisionHistoryBatch({ entries: rebuilt.entries, targetMonths });
    const result = {
      ok: true,
      dryRun,
      runId,
      targetMonths,
      sourceMonths,
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

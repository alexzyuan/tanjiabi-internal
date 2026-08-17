import { cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readJsonWithRecovery, writeJsonAtomic } from "./jsonStore.js";

const cacheDir = path.join(process.cwd(), "data-cache");
const salesDashboardFile = path.join(cacheDir, "sales-weekly-dashboard.json");
const salesWeeklySourceDir = path.join(cacheDir, "sales-weekly-source");
const lingxingSellersFile = path.join(cacheDir, "lingxing-sellers.json");
const mskuDetailDir = path.join(cacheDir, "msku-detail");
const orderProfitDir = path.join(cacheDir, "order-profit");
const supplierBoardDir = path.join(cacheDir, "supplier-board");
const supplierBoardProductDir = path.join(cacheDir, "supplier-board-product-map");
const sharedProductCatalogDir = path.join(cacheDir, "shared-product-catalog");
const factoryInventoryDir = path.join(cacheDir, "factory-inventory");
const inventoryProvisionSnapshotDir = path.join(cacheDir, "inventory-provision");
const inventoryProvisionHistoryDir = path.join(cacheDir, "inventory-provision-history");
const inventoryLedgerRawDir = path.join(cacheDir, "inventory-ledger-raw");
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const supplierBoardCachePolicy = { maxBytes: 300 * MB, maxAgeMs: 180 * DAY_MS };
const supplierBoardProductCachePolicy = { maxBytes: 100 * MB, maxAgeMs: 14 * DAY_MS };
const sharedProductCatalogCachePolicy = { maxBytes: 200 * MB, maxAgeMs: 30 * DAY_MS };
const factoryInventoryCachePolicy = { maxBytes: 300 * MB, maxAgeMs: 180 * DAY_MS };

/**
 * Return the legacy product-cache directories without exposing any mutating
 * filesystem operation.  The migration entry point is the only consumer that
 * should read these directories after the SQLite cutover.
 */
export function getLegacyProductCatalogDirectories() {
  return { sharedProductCatalogDir, supplierBoardProductDir };
}

function hashKey(key) {
  return crypto.createHash("sha1").update(String(key)).digest("hex");
}

function safeMonth(month) {
  const value = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/u.test(value)) throw new Error(`库存分类账月份格式无效：${month}`);
  return value;
}

function safeScopeKey(scopeKey) {
  const value = String(scopeKey || "").trim();
  if (!value) throw new Error("库存分类账 scopeKey 不能为空。");
  return value;
}

async function writeBufferAtomic(filePath, buffer) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempFile, buffer);
  await rename(tempFile, filePath);
  return filePath;
}

function inventoryLedgerRawScopeFile(dir, month, scopeKey, extension) {
  return path.join(dir, safeMonth(month), `${hashKey(safeScopeKey(scopeKey))}.${String(extension || "bin").replace(/[^a-z0-9]+/giu, "") || "bin"}`);
}

function inventoryLedgerRawManifestFile(dir, month, scopeKey) {
  return path.join(dir, safeMonth(month), `${hashKey(safeScopeKey(scopeKey))}.manifest.json`);
}

export function createInventoryLedgerRawReportStore({ dataDir = cacheDir } = {}) {
  const rootDir = path.resolve(dataDir);
  const rawDir = path.join(rootDir, "inventory-ledger-raw");
  const historyDir = path.join(rootDir, "inventory-provision-history");
  const jobStateFile = path.join(rawDir, "job-state.json");

  async function readManifest(month, scopeKey) {
    return readJsonWithRecovery(inventoryLedgerRawManifestFile(rawDir, month, scopeKey), null);
  }

  async function saveReport({ month, scopeKey, extension = "bin", bytes, manifest = {} } = {}) {
    const normalizedBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!normalizedBytes.length) throw new Error("库存分类账原始文件为空，拒绝留档。");
    const reportPath = inventoryLedgerRawScopeFile(rawDir, month, scopeKey, extension);
    const manifestPath = inventoryLedgerRawManifestFile(rawDir, month, scopeKey);
    const digest = crypto.createHash("sha256").update(normalizedBytes).digest("hex");
    await writeBufferAtomic(reportPath, normalizedBytes);
    await writeJsonAtomic(manifestPath, {
      ...manifest,
      month: safeMonth(month),
      scopeKey: safeScopeKey(scopeKey),
      extension: String(extension || "bin").toLowerCase(),
      byteCount: normalizedBytes.length,
      sha256: digest,
      rawFile: path.relative(rootDir, reportPath),
    });
    return { ...manifest, month: safeMonth(month), scopeKey: safeScopeKey(scopeKey), extension, byteCount: normalizedBytes.length, sha256: digest, rawFile: path.relative(rootDir, reportPath) };
  }

  async function readReport({ month, scopeKey, extension = "bin" } = {}) {
    const filePath = inventoryLedgerRawScopeFile(rawDir, month, scopeKey, extension);
    try {
      return await readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function listManifests(months = []) {
    const targetMonths = months.map(safeMonth);
    const result = [];
    for (const month of targetMonths) {
      let names;
      try {
        names = await readdir(path.join(rawDir, month));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const name of names.filter((entry) => entry.endsWith(".manifest.json"))) {
        result.push(await readJsonWithRecovery(path.join(rawDir, month, name), null));
      }
    }
    return result.filter(Boolean);
  }

  async function readJobState() {
    return readJsonWithRecovery(jobStateFile, {});
  }

  async function writeJobState(state = {}) {
    return writeJsonAtomic(jobStateFile, state);
  }

  async function commitInventoryProvisionHistoryBatch({ entries = [], targetMonths = [] } = {}) {
    const months = [...new Set(targetMonths.map(safeMonth))].sort();
    if (!months.length) throw new Error("库存计提原子提交缺少目标月份。");
    const byMonth = new Map(entries.map((entry) => [safeMonth(entry?.month), entry?.data]));
    for (const month of months) {
      const data = byMonth.get(month);
      if (!data || !Array.isArray(data.rows)) throw new Error(`库存计提原子提交缺少月份 ${month} 的有效 rows。`);
    }

    const stagingDir = `${historyDir}.staging-${process.pid}-${Date.now()}`;
    const backupDir = `${historyDir}.backup-${process.pid}-${Date.now()}`;
    let movedLive = false;
    let installed = false;
    try {
      await rm(stagingDir, { recursive: true, force: true });
      await mkdir(path.dirname(historyDir), { recursive: true });
      try {
        await cp(historyDir, stagingDir, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await mkdir(stagingDir, { recursive: true });
      }
      for (const month of months) {
        const filePath = path.join(stagingDir, `${hashKey(month)}.json`);
        await writeJsonAtomic(filePath, {
          updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          updatedAtMs: Date.now(),
          data: byMonth.get(month),
        });
      }
      await rm(backupDir, { recursive: true, force: true });
      try {
        await rename(historyDir, backupDir);
        movedLive = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rename(stagingDir, historyDir);
      installed = true;
      if (movedLive) await rm(backupDir, { recursive: true, force: true });
      return { committedMonths: months };
    } catch (error) {
      if (!installed && movedLive) {
        try {
          await rm(historyDir, { recursive: true, force: true });
          await rename(backupDir, historyDir);
        } catch (restoreError) {
          error.restoreError = restoreError.message;
        }
      }
      throw error;
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
      if (installed) await rm(backupDir, { recursive: true, force: true });
    }
  }

  return {
    rootDir,
    rawDir,
    historyDir,
    readManifest,
    saveReport,
    readReport,
    listManifests,
    readJobState,
    writeJobState,
    commitInventoryProvisionHistoryBatch,
  };
}

function normalizedSnapshotDate(date) {
  const value = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * Read legacy sales-weekly JSON only for an explicit reconciliation/retirement
 * workflow.  The optional key selects the keyed source snapshot; omitting it
 * reads the old dashboard snapshot.  There is intentionally no write partner.
 */
export async function readLegacySalesWeeklyForReconciliation(key = null, ttlMs = 6 * 60 * 60 * 1000) {
  if (key && typeof key === "object") {
    ttlMs = key.ttlMs ?? ttlMs;
    key = key.key ?? null;
  }
  return key
    ? readNamedCache(salesWeeklySourceDir, key, ttlMs)
    : readJsonWithRecovery(salesDashboardFile, null);
}

export async function saveLingxingSellersCache(data) {
  await writeJsonAtomic(lingxingSellersFile, {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    sellers: data,
  });
}

export async function readLingxingSellersCache() {
  return readJsonWithRecovery(lingxingSellersFile, { updatedAt: null, sellers: [] });
}

export async function saveMskuDetailCache(key, data) {
  await writeJsonAtomic(path.join(mskuDetailDir, `${hashKey(key)}.json`), {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    updatedAtMs: Date.now(),
    data,
  });
}

export async function readMskuDetailCache(key, ttlMs = 6 * 60 * 60 * 1000) {
  const cached = await readJsonWithRecovery(path.join(mskuDetailDir, `${hashKey(key)}.json`), null);
  if (!cached || !cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs) return null;
  return cached;
}

/** Read legacy OrderProfit JSON for reconciliation only; never write it. */
export async function readLegacyOrderProfitForReconciliation(key, ttlMs = 30 * 60 * 1000) {
  const cached = await readJsonWithRecovery(path.join(orderProfitDir, `${hashKey(key)}.json`), null);
  if (!cached || !cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs) return null;
  return cached;
}

export async function saveInventoryProvisionSnapshot(date, data) {
  const snapshotDate = normalizedSnapshotDate(date);
  if (!snapshotDate) throw new Error("库存计提快照日期格式无效");
  await writeJsonAtomic(path.join(inventoryProvisionSnapshotDir, `${snapshotDate}.json`), {
    snapshotDate,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    updatedAtMs: Date.now(),
    data,
  });
}

export async function readInventoryProvisionSnapshot(date) {
  const snapshotDate = normalizedSnapshotDate(date);
  if (!snapshotDate) return null;
  return readJsonWithRecovery(path.join(inventoryProvisionSnapshotDir, `${snapshotDate}.json`), null);
}

export async function listInventoryProvisionSnapshots() {
  try {
    const names = await readdir(inventoryProvisionSnapshotDir);
    return names
      .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1] || "")
      .filter(Boolean)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function unlinkCacheFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}

async function readCacheDirEntries(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function cacheFileInfo(filePath) {
  const info = await stat(filePath);
  return { size: info.size, mtimeMs: info.mtimeMs };
}

async function cacheEntries(dir) {
  const names = await readCacheDirEntries(dir);
  if (!names) {
    return [];
  }
  return Promise.all(names
    .filter((name) => name.endsWith(".json"))
    .map(async (name) => {
      const filePath = path.join(dir, name);
      return { name, filePath, ...(await cacheFileInfo(filePath)) };
    }));
}

export async function saveInventoryProvisionHistoryCache(month, data) {
  await saveNamedCache(inventoryProvisionHistoryDir, month, data);
}

export async function readInventoryProvisionHistoryCache(month) {
  return readNamedCache(inventoryProvisionHistoryDir, month, Infinity);
}

async function saveNamedCache(dir, key, data) {
  await writeJsonAtomic(path.join(dir, `${hashKey(key)}.json`), {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    updatedAtMs: Date.now(),
    data,
  });
}

async function cleanupCacheDir(dir, { maxBytes = Infinity, maxAgeMs = Infinity } = {}) {
  const entries = await cacheEntries(dir);

  const now = Date.now();
  const remaining = [];
  for (const entry of entries) {
    if (maxAgeMs !== Infinity && now - entry.mtimeMs > maxAgeMs) {
      await unlinkCacheFile(entry.filePath);
    } else {
      remaining.push(entry);
    }
  }

  if (maxBytes === Infinity) return;
  let totalBytes = remaining.reduce((total, entry) => total + entry.size, 0);
  if (totalBytes <= maxBytes) return;

  remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of remaining) {
    if (totalBytes <= maxBytes) break;
    await unlinkCacheFile(entry.filePath);
    totalBytes -= entry.size;
  }
}

async function readNamedCache(dir, key, ttlMs) {
  const cached = await readJsonWithRecovery(path.join(dir, `${hashKey(key)}.json`), null);
  if (!cached || (ttlMs !== Infinity && (!cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs))) return null;
  return cached;
}

export async function saveSupplierBoardCache(key, data) {
  await saveNamedCache(supplierBoardDir, key, data);
  await cleanupCacheDir(supplierBoardDir, supplierBoardCachePolicy);
}

export async function readSupplierBoardCache(key, ttlMs = Infinity) {
  return readNamedCache(supplierBoardDir, key, ttlMs);
}

/** @deprecated Product catalog callers must use the SQLite repository. Kept only for rollback tooling. */
export async function saveSupplierBoardProductMapCache(key, data) {
  await saveNamedCache(supplierBoardProductDir, key, data);
  await cleanupCacheDir(supplierBoardProductDir, supplierBoardProductCachePolicy);
}

/** @deprecated Legacy supplier product-map reader retained for migration observation. */
export async function readSupplierBoardProductMapCache(key, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  return readNamedCache(supplierBoardProductDir, key, ttlMs);
}

/** @deprecated Product catalog callers must use the SQLite repository. Kept only for rollback tooling. */
export async function saveSharedProductCatalogCache(key, data) {
  await saveNamedCache(sharedProductCatalogDir, key, data);
  await cleanupCacheDir(sharedProductCatalogDir, sharedProductCatalogCachePolicy);
}

/** @deprecated Legacy shared product-map reader retained for migration observation. */
export async function readSharedProductCatalogCache(key, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  return readNamedCache(sharedProductCatalogDir, key, ttlMs);
}

export async function saveFactoryInventoryCache(key, data) {
  await saveNamedCache(factoryInventoryDir, key, data);
  await cleanupCacheDir(factoryInventoryDir, factoryInventoryCachePolicy);
}

export async function readFactoryInventoryCache(key, ttlMs = Infinity) {
  return readNamedCache(factoryInventoryDir, key, ttlMs);
}

import { readdir, stat, unlink } from "node:fs/promises";
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
const inventoryProvisionHistoryBackupDir = path.join(cacheDir, "inventory-provision-history-backups");
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

async function cleanupInventoryProvisionHistoryBackups(dir, maxEntries) {
  const entries = await cacheEntries(dir);
  if (entries.length <= maxEntries) return;
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const entry of entries.slice(maxEntries)) await unlinkCacheFile(entry.filePath);
}

export async function saveInventoryProvisionHistoryCache(month, data) {
  await saveNamedCache(inventoryProvisionHistoryDir, month, data);
}

export async function readInventoryProvisionHistoryCache(month) {
  return readNamedCache(inventoryProvisionHistoryDir, month, Infinity);
}

export async function backupInventoryProvisionHistoryCache(month, { operationId = "" } = {}) {
  const cached = await readInventoryProvisionHistoryCache(month);
  if (!cached) return { created: false, month, operationId, cached: null };

  const monthBackupDir = path.join(inventoryProvisionHistoryBackupDir, hashKey(month));
  const backup = {
    month,
    operationId,
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    previousCacheUpdatedAt: cached.updatedAt || "",
    cached,
  };
  const backupPath = path.join(monthBackupDir, `${Date.now()}-${hashKey(operationId || "manual")}.json`);
  await writeJsonAtomic(backupPath, backup);
  await cleanupInventoryProvisionHistoryBackups(monthBackupDir, 5);
  return {
    created: true,
    month,
    operationId,
    previousCacheUpdatedAt: backup.previousCacheUpdatedAt,
    cached,
  };
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

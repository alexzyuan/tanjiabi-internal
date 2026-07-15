import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const cacheDir = path.join(process.cwd(), "data-cache");
const salesDashboardFile = path.join(cacheDir, "sales-weekly-dashboard.json");
const lingxingSellersFile = path.join(cacheDir, "lingxing-sellers.json");
const mskuDetailDir = path.join(cacheDir, "msku-detail");
const orderProfitDir = path.join(cacheDir, "order-profit");
const supplierBoardDir = path.join(cacheDir, "supplier-board");
const supplierBoardProductDir = path.join(cacheDir, "supplier-board-product-map");
const sharedProductCatalogDir = path.join(cacheDir, "shared-product-catalog");
const factoryInventoryDir = path.join(cacheDir, "factory-inventory");
const inventoryProvisionSnapshotDir = path.join(cacheDir, "inventory-provision");
const inventoryProvisionHistoryDir = path.join(cacheDir, "inventory-provision-history");
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const supplierBoardCachePolicy = { maxBytes: 300 * MB, maxAgeMs: 180 * DAY_MS };
const supplierBoardProductCachePolicy = { maxBytes: 100 * MB, maxAgeMs: 14 * DAY_MS };
const sharedProductCatalogCachePolicy = { maxBytes: 200 * MB, maxAgeMs: 30 * DAY_MS };
const factoryInventoryCachePolicy = { maxBytes: 300 * MB, maxAgeMs: 180 * DAY_MS };

function hashKey(key) {
  return crypto.createHash("sha1").update(String(key)).digest("hex");
}

function normalizedSnapshotDate(date) {
  const value = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function saveSalesDashboardCache(data) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(salesDashboardFile, JSON.stringify(data, null, 2), "utf8");
}

export async function readSalesDashboardCache() {
  try {
    const content = await readFile(salesDashboardFile, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveLingxingSellersCache(data) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    lingxingSellersFile,
    JSON.stringify(
      {
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        sellers: data,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function readLingxingSellersCache() {
  try {
    const content = await readFile(lingxingSellersFile, "utf8");
    return JSON.parse(content);
  } catch {
    return { updatedAt: null, sellers: [] };
  }
}

export async function saveMskuDetailCache(key, data) {
  await mkdir(mskuDetailDir, { recursive: true });
  await writeFile(
    path.join(mskuDetailDir, `${hashKey(key)}.json`),
    JSON.stringify(
      {
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        updatedAtMs: Date.now(),
        data,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function readMskuDetailCache(key, ttlMs = 6 * 60 * 60 * 1000) {
  try {
    const content = await readFile(path.join(mskuDetailDir, `${hashKey(key)}.json`), "utf8");
    const cached = JSON.parse(content);
    if (!cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs) return null;
    return cached;
  } catch {
    return null;
  }
}

export async function saveOrderProfitCache(key, data) {
  await mkdir(orderProfitDir, { recursive: true });
  await writeFile(
    path.join(orderProfitDir, `${hashKey(key)}.json`),
    JSON.stringify(
      {
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        updatedAtMs: Date.now(),
        data,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function readOrderProfitCache(key, ttlMs = 30 * 60 * 1000) {
  try {
    const content = await readFile(path.join(orderProfitDir, `${hashKey(key)}.json`), "utf8");
    const cached = JSON.parse(content);
    if (!cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs) return null;
    return cached;
  } catch {
    return null;
  }
}

export async function saveInventoryProvisionSnapshot(date, data) {
  const snapshotDate = normalizedSnapshotDate(date);
  if (!snapshotDate) throw new Error("库存计提快照日期格式无效");
  await mkdir(inventoryProvisionSnapshotDir, { recursive: true });
  await writeFile(
    path.join(inventoryProvisionSnapshotDir, `${snapshotDate}.json`),
    JSON.stringify(
      {
        snapshotDate,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        updatedAtMs: Date.now(),
        data,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function readInventoryProvisionSnapshot(date) {
  const snapshotDate = normalizedSnapshotDate(date);
  if (!snapshotDate) return null;
  try {
    const content = await readFile(path.join(inventoryProvisionSnapshotDir, `${snapshotDate}.json`), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function listInventoryProvisionSnapshots() {
  try {
    const names = await readdir(inventoryProvisionSnapshotDir);
    return names
      .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1] || "")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

export async function saveInventoryProvisionHistoryCache(month, data) {
  await saveNamedCache(inventoryProvisionHistoryDir, month, data);
}

export async function readInventoryProvisionHistoryCache(month) {
  return readNamedCache(inventoryProvisionHistoryDir, month, Infinity);
}

async function saveNamedCache(dir, key, data) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${hashKey(key)}.json`),
    JSON.stringify(
      {
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        updatedAtMs: Date.now(),
        data,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function cleanupCacheDir(dir, { maxBytes = Infinity, maxAgeMs = Infinity } = {}) {
  let entries = [];
  try {
    const names = await readdir(dir);
    entries = await Promise.all(names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        const info = await stat(filePath);
        return { name, filePath, size: info.size, mtimeMs: info.mtimeMs };
      }));
  } catch {
    return;
  }

  const now = Date.now();
  const remaining = [];
  for (const entry of entries) {
    if (maxAgeMs !== Infinity && now - entry.mtimeMs > maxAgeMs) {
      await unlink(entry.filePath).catch(() => {});
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
    await unlink(entry.filePath).catch(() => {});
    totalBytes -= entry.size;
  }
}

async function readNamedCache(dir, key, ttlMs) {
  try {
    const content = await readFile(path.join(dir, `${hashKey(key)}.json`), "utf8");
    const cached = JSON.parse(content);
    if (ttlMs !== Infinity && (!cached.updatedAtMs || Date.now() - cached.updatedAtMs > ttlMs)) return null;
    return cached;
  } catch {
    return null;
  }
}

export async function saveSupplierBoardCache(key, data) {
  await saveNamedCache(supplierBoardDir, key, data);
  await cleanupCacheDir(supplierBoardDir, supplierBoardCachePolicy);
}

export async function readSupplierBoardCache(key, ttlMs = Infinity) {
  return readNamedCache(supplierBoardDir, key, ttlMs);
}

export async function saveSupplierBoardProductMapCache(key, data) {
  await saveNamedCache(supplierBoardProductDir, key, data);
  await cleanupCacheDir(supplierBoardProductDir, supplierBoardProductCachePolicy);
}

export async function readSupplierBoardProductMapCache(key, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  return readNamedCache(supplierBoardProductDir, key, ttlMs);
}

export async function saveSharedProductCatalogCache(key, data) {
  await saveNamedCache(sharedProductCatalogDir, key, data);
  await cleanupCacheDir(sharedProductCatalogDir, sharedProductCatalogCachePolicy);
}

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

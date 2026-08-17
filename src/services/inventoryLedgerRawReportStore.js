import crypto from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJsonWithRecovery, writeJsonAtomic } from "../utils/jsonStore.js";

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

function reportFile(rawDir, month, scopeKey, extension) {
  const suffix = String(extension || "bin").replace(/[^a-z0-9]+/giu, "") || "bin";
  return path.join(rawDir, safeMonth(month), `${hashKey(safeScopeKey(scopeKey))}.${suffix}`);
}

function manifestFile(rawDir, month, scopeKey) {
  return path.join(rawDir, safeMonth(month), `${hashKey(safeScopeKey(scopeKey))}.manifest.json`);
}

function requiredSha256(value) {
  const sha256 = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("库存分类账原始文件完整性校验缺少有效的 manifest SHA-256。");
  }
  return sha256;
}

async function writeBufferAtomic(filePath, bytes) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const temporaryPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

export function createInventoryLedgerRawReportStore({ dataDir = path.join(process.cwd(), "data-cache") } = {}) {
  const rootDir = path.resolve(dataDir);
  const rawDir = path.join(rootDir, "inventory-ledger-raw");
  const historyDir = path.join(rootDir, "inventory-provision-history");
  const jobStateFile = path.join(rawDir, "job-state.json");

  async function readManifest(month, scopeKey) {
    return readJsonWithRecovery(manifestFile(rawDir, month, scopeKey), null);
  }

  async function saveReport({ month, scopeKey, extension = "bin", bytes, manifest = {} } = {}) {
    const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!content.length) throw new Error("库存分类账原始文件为空，拒绝留档。");
    const filePath = reportFile(rawDir, month, scopeKey, extension);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    await writeBufferAtomic(filePath, content);
    const stored = {
      ...manifest,
      month: safeMonth(month),
      scopeKey: safeScopeKey(scopeKey),
      extension: String(extension || "bin").toLowerCase(),
      byteCount: content.length,
      sha256,
      rawFile: path.relative(rootDir, filePath),
    };
    await writeJsonAtomic(manifestFile(rawDir, month, scopeKey), stored);
    return stored;
  }

  async function readReport({ month, scopeKey, extension = "bin" } = {}) {
    try {
      return await readFile(reportFile(rawDir, month, scopeKey, extension));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function verifyReport({ month, scopeKey, extension = "bin", expectedSha256 } = {}) {
    const expected = requiredSha256(expectedSha256);
    const filePath = reportFile(rawDir, month, scopeKey, extension);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`库存分类账原始文件缺失，无法通过 manifest 完整性校验：${safeMonth(month)} / ${safeScopeKey(scopeKey)}。`);
      }
      throw error;
    }
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== expected) {
      throw new Error(`库存分类账原始文件 SHA-256 不匹配：${safeMonth(month)} / ${safeScopeKey(scopeKey)}（manifest ${expected}，实际 ${sha256}）。`);
    }
    return { bytes, byteCount: bytes.length, sha256 };
  }

  async function listManifests(months = []) {
    const result = [];
    for (const month of months.map(safeMonth)) {
      let files;
      try {
        files = await readdir(path.join(rawDir, month));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const file of files.filter((entry) => entry.endsWith(".manifest.json"))) {
        const manifest = await readJsonWithRecovery(path.join(rawDir, month, file), null);
        if (manifest) result.push(manifest);
      }
    }
    return result;
  }

  async function commitInventoryProvisionHistoryBatch({ entries = [], targetMonths = [] } = {}) {
    const months = [...new Set(targetMonths.map(safeMonth))].sort();
    if (!months.length) throw new Error("库存计提原子提交缺少目标月份。");
    const dataByMonth = new Map(entries.map((entry) => [safeMonth(entry?.month), entry?.data]));
    for (const month of months) {
      if (!Array.isArray(dataByMonth.get(month)?.rows)) throw new Error(`库存计提原子提交缺少月份 ${month} 的有效 rows。`);
    }
    const stagingDir = `${historyDir}.staging-${process.pid}-${Date.now()}`;
    const backupDir = `${historyDir}.backup-${process.pid}-${Date.now()}`;
    let movedCurrent = false;
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
        await writeJsonAtomic(path.join(stagingDir, `${hashKey(month)}.json`), {
          updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          updatedAtMs: Date.now(),
          data: dataByMonth.get(month),
        });
      }
      await rm(backupDir, { recursive: true, force: true });
      try {
        await rename(historyDir, backupDir);
        movedCurrent = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rename(stagingDir, historyDir);
      installed = true;
      if (movedCurrent) await rm(backupDir, { recursive: true, force: true });
      return { committedMonths: months };
    } catch (error) {
      if (!installed && movedCurrent) {
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
    verifyReport,
    listManifests,
    readJobState: () => readJsonWithRecovery(jobStateFile, {}),
    writeJobState: (state = {}) => writeJsonAtomic(jobStateFile, state),
    commitInventoryProvisionHistoryBatch,
  };
}

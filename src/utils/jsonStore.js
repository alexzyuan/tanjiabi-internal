import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const fileUpdateQueues = new Map();

export class JsonStoreError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "JsonStoreError";
    Object.assign(this, fields);
  }
}

function hasFallbackValue(args) {
  return args.length >= 2;
}

function jsonParseError(filePath, error) {
  return new JsonStoreError(`JSON parse failed: ${filePath}`, {
    code: "JSON_PARSE_FAILED",
    filePath,
    cause: error,
  });
}

async function fsyncFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(dir) {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some platforms/filesystems do not support directory fsync. File fsync + rename still preserves the old file on write failure.
  }
}

export async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT" && hasFallbackValue(arguments)) return fallback;
    if (error instanceof SyntaxError) throw jsonParseError(filePath, error);
    throw error;
  }
}

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(dir, { recursive: true });
  const tempFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempFile, json, "utf8");
  await fsyncFile(tempFile);
  await rename(tempFile, filePath);
  await fsyncDirectory(dir);
  return data;
}

export async function updateJsonAtomic(filePath, updater, fallback) {
  if (typeof updater !== "function") throw new Error("updateJsonAtomic requires an updater function.");
  const queueKey = path.resolve(filePath);
  const previous = fileUpdateQueues.get(queueKey) || Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readJson(filePath, fallback);
      const next = await updater(current);
      await writeJsonAtomic(filePath, next);
      return next;
    });
  fileUpdateQueues.set(queueKey, run);
  try {
    return await run;
  } finally {
    if (fileUpdateQueues.get(queueKey) === run) {
      fileUpdateQueues.delete(queueKey);
    }
  }
}

export async function backupJson(filePath) {
  await stat(filePath);
  const backupFile = `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  await copyFile(filePath, backupFile);
  return backupFile;
}

async function latestBackup(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const candidates = names
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".bak"))
    .sort()
    .reverse();
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

export async function readJsonWithRecovery(filePath, fallback) {
  try {
    return await readJson(filePath, fallback);
  } catch (error) {
    if (error.code !== "JSON_PARSE_FAILED") throw error;
    const backupFile = await latestBackup(filePath);
    if (!backupFile) throw error;
    const backupValue = await readJson(backupFile);
    await writeJsonAtomic(filePath, backupValue);
    return backupValue;
  }
}

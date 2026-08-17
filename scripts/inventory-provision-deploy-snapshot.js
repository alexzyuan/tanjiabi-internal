#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const PROTECTED_DIRECTORIES = ["inventory-provision-history", "inventory-ledger-raw"];
const MANIFEST_FILE = "inventory-provision-deploy-snapshot.json";

function fail(message) {
  throw new Error(`库存计提部署保护失败：${message}`);
}

function resolveDirectory(value, label) {
  const directory = String(value || "").trim();
  if (!directory) fail(`缺少 ${label}。`);
  return path.resolve(directory);
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function collectFiles(root, relativePath = "") {
  const directory = path.join(root, relativePath);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryRelativePath = path.join(relativePath, entry.name);
    const entryPath = path.join(root, entryRelativePath);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) fail(`不允许保护目录包含符号链接：${entryRelativePath}`);
    if (entryStat.isDirectory()) files.push(...await collectFiles(root, entryRelativePath));
    else if (entryStat.isFile()) files.push({ path: entryRelativePath, byteCount: entryStat.size, sha256: await sha256(entryPath) });
    else fail(`不支持的保护目录条目：${entryRelativePath}`);
  }
  return files;
}

async function buildEntries(snapshotDataDir) {
  const entries = [];
  for (const name of PROTECTED_DIRECTORIES) {
    const directory = path.join(snapshotDataDir, name);
    try {
      const info = await stat(directory);
      if (!info.isDirectory()) fail(`保护目录不是目录：${directory}`);
    } catch (error) {
      if (error?.code === "ENOENT" && name === "inventory-ledger-raw") {
        entries.push({ name, missing: true, files: [] });
        continue;
      }
      if (error?.code === "ENOENT") fail(`保护目录不存在：${directory}`);
      throw error;
    }
    entries.push({ name, missing: false, files: await collectFiles(snapshotDataDir, name) });
  }
  return entries;
}

async function writeManifest(snapshotDataDir, entries) {
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    protectedDirectories: PROTECTED_DIRECTORIES,
    entries,
  };
  await writeFile(path.join(snapshotDataDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function verifyInventoryProvisionDeploySnapshot({ snapshotDataDir } = {}) {
  const snapshotDir = resolveDirectory(snapshotDataDir, "snapshotDataDir");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(snapshotDir, MANIFEST_FILE), "utf8"));
  } catch (error) {
    fail(`无法读取保护 manifest：${error.message}`);
  }
  if (manifest?.version !== 1 || !Array.isArray(manifest.entries)) fail("保护 manifest 格式无效。");
  for (const name of PROTECTED_DIRECTORIES) {
    const entry = manifest.entries.find((item) => item?.name === name);
    if (!entry || !Array.isArray(entry.files)) fail(`保护 manifest 缺少目录：${name}`);
    if (entry.missing) {
      if (name !== "inventory-ledger-raw" || entry.files.length) fail(`保护 manifest 的缺失目录标记无效：${name}`);
      continue;
    }
    for (const file of entry.files) {
      const relativePath = String(file?.path || "");
      if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) fail(`保护 manifest 含非法文件路径：${relativePath}`);
      const filePath = path.join(snapshotDir, relativePath);
      let info;
      try {
        info = await lstat(filePath);
      } catch (error) {
        fail(`保护快照文件缺失：${relativePath}`);
      }
      if (!info.isFile() || info.isSymbolicLink()) fail(`保护快照文件类型无效：${relativePath}`);
      const actualSha256 = await sha256(filePath);
      if (actualSha256 !== file.sha256) fail(`保护快照 SHA-256 不匹配：${relativePath}`);
      if (info.size !== file.byteCount) fail(`保护快照字节数不匹配：${relativePath}`);
    }
  }
  return manifest;
}

export async function createInventoryProvisionDeploySnapshot({ sourceDataDir, snapshotDataDir } = {}) {
  const sourceDir = resolveDirectory(sourceDataDir, "sourceDataDir");
  const snapshotDir = resolveDirectory(snapshotDataDir, "snapshotDataDir");
  await rm(snapshotDir, { recursive: true, force: true });
  await mkdir(snapshotDir, { recursive: true });
  for (const name of PROTECTED_DIRECTORIES) {
    const sourcePath = path.join(sourceDir, name);
    try {
      const info = await lstat(sourcePath);
      if (!info.isDirectory() || info.isSymbolicLink()) fail(`保护目录无效：${sourcePath}`);
      await cp(sourcePath, path.join(snapshotDir, name), { recursive: true, dereference: false, errorOnExist: true });
    } catch (error) {
      if (error?.code === "ENOENT" && name === "inventory-ledger-raw") continue;
      throw error;
    }
  }
  const manifest = await writeManifest(snapshotDir, await buildEntries(snapshotDir));
  await verifyInventoryProvisionDeploySnapshot({ snapshotDataDir: snapshotDir });
  return manifest;
}

export async function restoreInventoryProvisionDeploySnapshot({ snapshotDataDir, targetDataDir } = {}) {
  const snapshotDir = resolveDirectory(snapshotDataDir, "snapshotDataDir");
  const targetDir = resolveDirectory(targetDataDir, "targetDataDir");
  const manifest = await verifyInventoryProvisionDeploySnapshot({ snapshotDataDir: snapshotDir });
  for (const name of PROTECTED_DIRECTORIES) {
    const entry = manifest.entries.find((item) => item.name === name);
    const targetPath = path.join(targetDir, name);
    await rm(targetPath, { recursive: true, force: true });
    if (!entry.missing) await cp(path.join(snapshotDir, name), targetPath, { recursive: true, dereference: false, errorOnExist: true });
  }
  return verifyInventoryProvisionDeploySnapshot({ snapshotDataDir: snapshotDir });
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || String(value).startsWith("--")) fail(`参数 ${name} 缺少目录。`);
  return value;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const sourceDataDir = optionValue(args, "--source-data-dir");
  const snapshotDataDir = optionValue(args, "--snapshot-data-dir");
  if (command === "snapshot") {
    const result = await createInventoryProvisionDeploySnapshot({ sourceDataDir, snapshotDataDir });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "verify") {
    const result = await verifyInventoryProvisionDeploySnapshot({ snapshotDataDir });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "restore") {
    const result = await restoreInventoryProvisionDeploySnapshot({ snapshotDataDir, targetDataDir: sourceDataDir });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    fail("用法：snapshot|verify|restore --source-data-dir <data-cache> --snapshot-data-dir <保护快照目录>。");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

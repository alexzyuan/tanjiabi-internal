#!/usr/bin/env node
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeOptions({ releasesDir, keepReleases, protectedRelease }) {
  const normalizedReleasesDir = path.resolve(String(releasesDir || ""));
  const normalizedProtectedRelease = path.resolve(String(protectedRelease || ""));
  const normalizedKeepReleases = Number(keepReleases);

  if (path.basename(normalizedReleasesDir) !== "releases") {
    throw new Error(`部署备份目录必须以 releases 结尾：${normalizedReleasesDir}`);
  }
  if (!Number.isInteger(normalizedKeepReleases) || normalizedKeepReleases < 1) {
    throw new Error(`保留数量必须是大于等于 1 的整数：${keepReleases}`);
  }
  if (path.dirname(normalizedProtectedRelease) !== normalizedReleasesDir) {
    throw new Error(`受保护备份必须是 releases 的直接子目录：${normalizedProtectedRelease}`);
  }

  return {
    releasesDir: normalizedReleasesDir,
    keepReleases: normalizedKeepReleases,
    protectedRelease: normalizedProtectedRelease,
  };
}

export async function pruneDeployReleases(options) {
  const { releasesDir, keepReleases, protectedRelease } = normalizeOptions(options);
  const dirents = await readdir(releasesDir, { withFileTypes: true });
  const releasePaths = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(releasesDir, entry.name));

  if (!releasePaths.includes(protectedRelease)) {
    throw new Error(`本次部署备份不存在，拒绝清理：${protectedRelease}`);
  }

  const releases = await Promise.all(releasePaths.map(async (releasePath) => ({
    path: releasePath,
    mtimeMs: (await lstat(releasePath)).mtimeMs,
  })));
  releases.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));

  const kept = new Set([protectedRelease]);
  for (const release of releases) {
    if (kept.size >= keepReleases) {
      break;
    }
    kept.add(release.path);
  }

  const removed = releases.filter((release) => !kept.has(release.path)).map((release) => release.path);
  for (const releasePath of removed) {
    await rm(releasePath, { recursive: true });
  }

  return {
    kept: releases.filter((release) => kept.has(release.path)).map((release) => release.path),
    removed,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`参数缺少值：${flag || "<empty>"}`);
    }
    if (flag === "--releases-dir") {
      options.releasesDir = value;
    } else if (flag === "--keep") {
      options.keepReleases = value;
    } else if (flag === "--protect") {
      options.protectedRelease = value;
    } else {
      throw new Error(`未知参数：${flag}`);
    }
  }
  return options;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const result = await pruneDeployReleases(parseCliArgs(process.argv.slice(2)));
    for (const releasePath of result.removed) {
      console.log(`删除旧备份：${releasePath}`);
    }
  } catch (error) {
    console.error(`部署备份清理失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

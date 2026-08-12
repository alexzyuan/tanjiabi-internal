#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";

import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import {
  archiveLegacyProductCatalog,
  inspectLegacyProductCatalogRetirement,
  ProductCatalogLegacyRetirementError,
} from "../src/services/productCatalogLegacyRetirementService.js";

const MODES = new Set(["--dry-run", "--archive"]);

function argumentError(message) {
  return new ProductCatalogLegacyRetirementError("RETIREMENT_ARGUMENT_INVALID", message);
}

function requiredAbsolutePath(value, label) {
  const text = String(value || "").trim();
  if (!text || !path.isAbsolute(text)) throw argumentError(`${label}必须是绝对路径。`);
  return path.resolve(text);
}

function requiredTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new ProductCatalogLegacyRetirementError(
      "SQLITE_FIRST_LIVE_TIME_INVALID",
      "必须提供有效的 SQLite 首次上线时间。",
    );
  }
  return number;
}

async function requireExistingDatabase(databasePath) {
  try {
    const info = await stat(databasePath);
    if (!info.isFile()) throw new Error("not-file");
  } catch (error) {
    throw new ProductCatalogLegacyRetirementError(
      "SQLITE_DATABASE_MISSING",
      "SQLite 商品目录数据库不存在或不是普通文件。",
      { errorName: error?.name || "Error" },
    );
  }
}

function parseMode(args) {
  if (args.length !== 1 || !MODES.has(args[0])) {
    throw argumentError("必须且只能指定 --dry-run 或 --archive。 ");
  }
  return args[0] === "--archive" ? "archive" : "dry-run";
}

function safeSuccess(operation, result, elapsedMs) {
  return {
    ok: true,
    operation,
    eligible: operation === "dry-run" ? result.eligible : true,
    manifestHash: result.manifestHash,
    manifestHashPrefix: String(result.manifestHash || "").slice(0, 12),
    fileCount: result.fileCount,
    totalBytes: result.totalBytes,
    elapsedMs,
    ...(Array.isArray(result.checks) ? { checks: result.checks } : {}),
    ...(Number.isFinite(result.maxMtimeMs) ? { maxMtimeMs: result.maxMtimeMs } : {}),
    ...(Number.isFinite(result.migratedAtMs) ? { migratedAtMs: result.migratedAtMs } : {}),
    ...(Number.isInteger(result.stableDays) ? { stableDays: result.stableDays } : {}),
    ...(Number.isInteger(result.releaseCount) ? { releaseCount: result.releaseCount } : {}),
    ...(Number.isInteger(result.sqliteRevision) ? { sqliteRevision: result.sqliteRevision } : {}),
    ...(result.retirementId ? { retirementId: result.retirementId } : {}),
    ...(result.archiveSha256 ? { archiveSha256: result.archiveSha256 } : {}),
    ...(typeof result.idempotent === "boolean" ? { idempotent: result.idempotent } : {}),
  };
}

function safeErrorCode(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(text)
    && !/(token|secret|password|payload|raw|body)/iu.test(text)
    ? text
    : null;
}

function safeCauseSummaries(error) {
  const queue = error instanceof AggregateError ? [...error.errors] : [error];
  const summaries = [];
  while (queue.length && summaries.length < 8) {
    const current = queue.shift();
    if (current instanceof AggregateError) {
      queue.push(...current.errors);
      continue;
    }
    const code = safeErrorCode(current?.code);
    summaries.push({
      errorName: String(current?.name || "Error").slice(0, 80),
      ...(code ? { code } : {}),
    });
  }
  return summaries;
}

function safeFailure(error, operation, elapsedMs) {
  const causes = safeCauseSummaries(error);
  return {
    ok: false,
    operation,
    code: error instanceof ProductCatalogLegacyRetirementError
      ? error.code
      : "LEGACY_RETIREMENT_FAILED",
    errorName: error?.name || "Error",
    elapsedMs,
    causeCount: causes.length,
    causes,
    cleanupFailed: Boolean(error?.cleanupError),
    message: error instanceof ProductCatalogLegacyRetirementError
      ? error.message
      : "旧商品缓存退役操作失败。",
  };
}

export async function runLegacyProductCatalogRetirementCli({
  args = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let repository = null;
  let mode = "unknown";
  const startedAt = Date.now();
  try {
    mode = parseMode(args);
    const appDir = requiredAbsolutePath(env.PRODUCT_CATALOG_APP_DIR || "/opt/tanjia-bi", "应用目录");
    const databasePath = requiredAbsolutePath(
      env.PRODUCT_CATALOG_DATABASE_PATH
        || path.join(appDir, "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
      "SQLite 路径",
    );
    const releasesDir = requiredAbsolutePath(
      env.PRODUCT_CATALOG_RELEASES_DIR || path.join(appDir, "releases"),
      "release 目录",
    );
    const archiveRoot = mode === "archive"
      ? requiredAbsolutePath(
        env.PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT || "/opt/tanjia-bi-archives/product-catalog",
        "归档目录",
      )
      : null;
    const firstSqliteLiveAtMs = requiredTimestamp(env.PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS);
    const injectedNow = String(env.PRODUCT_CATALOG_RETIREMENT_NOW_MS || "").trim();
    const now = injectedNow ? requiredTimestamp(injectedNow) : Date.now();
    await requireExistingDatabase(databasePath);
    repository = createProductCatalogRepository({
      databasePath,
      readonly: true,
      logger: { info() {}, warn() {}, error() {} },
      requestId: `legacy-retirement-${mode}`,
    });
    const options = {
      repository,
      sharedDir: path.join(appDir, "data-cache", "shared-product-catalog"),
      supplierDir: path.join(appDir, "data-cache", "supplier-board-product-map"),
      releasesDir,
      firstSqliteLiveAtMs,
      now: () => now,
    };
    const result = mode === "archive"
      ? await archiveLegacyProductCatalog({ ...options, archiveRoot })
      : await inspectLegacyProductCatalogRetirement(options);
    stdout.write(`${JSON.stringify(safeSuccess(mode, result, Date.now() - startedAt))}\n`);
    return result;
  } catch (error) {
    stderr.write(`${JSON.stringify(safeFailure(error, mode, Date.now() - startedAt))}\n`);
    process.exitCode = 1;
    return null;
  } finally {
    if (repository) {
      try {
        repository.close({ requestId: `legacy-retirement-${mode}` });
      } catch (error) {
        stderr.write(`${JSON.stringify({
          ok: false,
          operation: "close",
          code: "LEGACY_RETIREMENT_CLOSE_FAILED",
          errorName: error?.name || "Error",
          message: "旧商品缓存退役 SQLite 连接关闭失败。",
        })}\n`);
        process.exitCode = 1;
      }
    }
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  await runLegacyProductCatalogRetirementCli();
}

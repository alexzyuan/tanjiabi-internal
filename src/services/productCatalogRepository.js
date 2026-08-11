import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  applyProductCatalogSchema,
  PRODUCT_CATALOG_SCHEMA_VERSION,
} from "./productCatalogSchema.js";

function writeLog(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[product-catalog-repository]", details);
}

function bootstrapErrorDetails(error) {
  return {
    operation: "bootstrap",
    errorName: error?.name || "Error",
    errorMessage: String(error?.message || "未知错误").slice(0, 300),
  };
}

function readPragmas(db) {
  return {
    journalMode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),
    foreignKeys: Number(db.pragma("foreign_keys", { simple: true })),
    busyTimeout: Number(db.pragma("busy_timeout", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
  };
}

function configurePragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  const actual = readPragmas(db);
  const expected = [
    ["journal_mode", "journalMode", "wal"],
    ["foreign_keys", "foreignKeys", 1],
    ["busy_timeout", "busyTimeout", 5000],
    ["synchronous", "synchronous", 2],
  ];
  for (const [pragmaName, name, value] of expected) {
    if (actual[name] !== value) {
      throw new Error(`商品目录数据库 pragma ${pragmaName} 必须为 ${value}，实际为 ${actual[name]}。`);
    }
  }
  return actual;
}

export function createProductCatalogRepository({
  databasePath = path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
  logger = console,
  now = Date.now,
} = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  let db;
  try {
    db = new Database(databasePath);
    configurePragmas(db);
    applyProductCatalogSchema(db, { now });
  } catch (error) {
    try {
      writeLog(logger, "error", bootstrapErrorDetails(error));
    } finally {
      if (db) db.close();
    }
    throw error;
  }

  function getSchemaInfo() {
    return {
      version: PRODUCT_CATALOG_SCHEMA_VERSION,
      ...readPragmas(db),
    };
  }

  return {
    databasePath,
    getSchemaInfo,
    close: () => db.close(),
  };
}

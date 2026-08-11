import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  applyProductCatalogSchema,
  PRODUCT_CATALOG_SCHEMA_VERSION,
} from "./productCatalogSchema.js";

export function createProductCatalogRepository({
  databasePath = path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
  logger = console,
  now = Date.now,
} = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  applyProductCatalogSchema(db, { now });

  function getSchemaInfo() {
    return {
      version: PRODUCT_CATALOG_SCHEMA_VERSION,
      journalMode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),
      foreignKeys: Number(db.pragma("foreign_keys", { simple: true })),
      busyTimeout: Number(db.pragma("busy_timeout", { simple: true })),
      synchronous: Number(db.pragma("synchronous", { simple: true })),
    };
  }

  void logger;
  return {
    databasePath,
    getSchemaInfo,
    close: () => db.close(),
  };
}

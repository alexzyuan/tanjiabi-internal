import { createHash } from "node:crypto";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;
export const PRODUCT_CATALOG_SCHEMA_NAME = "product-catalog-v1";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL, applied_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_metadata (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS product_master (
  internal_sku_key TEXT PRIMARY KEY, internal_sku TEXT NOT NULL,
  product_name TEXT, image_url TEXT, supplier TEXT, purchase_price REAL,
  model TEXT, brand TEXT, material TEXT, purpose TEXT, customs_code TEXT,
  is_battery TEXT, unit TEXT, declared_value REAL, pack_quantity REAL,
  box_length REAL, box_width REAL, box_height REAL, box_dimension_unit TEXT,
  box_weight REAL, box_weight_unit TEXT, product_id TEXT, sku_identifier TEXT,
  source TEXT NOT NULL, source_updated_at_ms INTEGER NOT NULL,
  refreshed_at_ms INTEGER NOT NULL, data_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_identity (
  sid INTEGER NOT NULL CHECK (sid > 0), msku_key TEXT NOT NULL, msku TEXT NOT NULL,
  internal_sku_key TEXT, internal_sku TEXT, listing_sku TEXT, asin TEXT,
  store_name TEXT, country TEXT, source TEXT NOT NULL,
  source_updated_at_ms INTEGER NOT NULL, refreshed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (sid, msku_key)
);
CREATE INDEX IF NOT EXISTS listing_identity_internal_sku_idx
  ON listing_identity (internal_sku_key);
CREATE TABLE IF NOT EXISTS product_alias (
  alias_type TEXT NOT NULL CHECK (alias_type IN ('sku_identifier','product_id','listing_sku')),
  alias_key TEXT NOT NULL, alias_value TEXT NOT NULL,
  internal_sku_key TEXT NOT NULL REFERENCES product_master(internal_sku_key) ON DELETE CASCADE,
  source TEXT NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (alias_type, alias_key)
);`;

const SCHEMA_CHECKSUM = createHash("sha256").update(SCHEMA_SQL).digest("hex");

function resolveNow(now) {
  return typeof now === "function" ? now() : Number(now);
}

function readExistingMigrations(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  if (!table) return [];
  return db.prepare(
    "SELECT version, name, checksum, applied_at_ms FROM schema_migrations ORDER BY version",
  ).all();
}

function validateExistingMigrations(migrations) {
  const unknown = migrations.find(({ version }) => version > PRODUCT_CATALOG_SCHEMA_VERSION);
  if (unknown) {
    throw new Error(`商品目录数据库包含未知的更高 schema 版本 ${unknown.version}。`);
  }
  const current = migrations.find(({ version }) => version === PRODUCT_CATALOG_SCHEMA_VERSION);
  if (current && (current.name !== PRODUCT_CATALOG_SCHEMA_NAME || current.checksum !== SCHEMA_CHECKSUM)) {
    throw new Error("商品目录数据库 schema checksum 与当前实现不一致。");
  }
}

export function applyProductCatalogSchema(db, { now = Date.now } = {}) {
  const existingMigrations = readExistingMigrations(db);
  validateExistingMigrations(existingMigrations);
  const appliedAtMs = resolveNow(now);

  const apply = db.transaction(() => {
    db.exec(SCHEMA_SQL);
    const current = db.prepare(
      "SELECT version, name, checksum FROM schema_migrations WHERE version = ?",
    ).get(PRODUCT_CATALOG_SCHEMA_VERSION);
    if (current && (current.name !== PRODUCT_CATALOG_SCHEMA_NAME || current.checksum !== SCHEMA_CHECKSUM)) {
      throw new Error("商品目录数据库 schema checksum 与当前实现不一致。");
    }
    if (!current) {
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at_ms) VALUES (?, ?, ?, ?)",
      ).run(PRODUCT_CATALOG_SCHEMA_VERSION, PRODUCT_CATALOG_SCHEMA_NAME, SCHEMA_CHECKSUM, appliedAtMs);
    }
    db.prepare(
      "INSERT OR IGNORE INTO catalog_metadata (key, value, updated_at_ms) VALUES (?, ?, ?)",
    ).run("catalog_revision", "0", appliedAtMs);
  });
  apply();
  return {
    version: PRODUCT_CATALOG_SCHEMA_VERSION,
    name: PRODUCT_CATALOG_SCHEMA_NAME,
    checksum: SCHEMA_CHECKSUM,
  };
}

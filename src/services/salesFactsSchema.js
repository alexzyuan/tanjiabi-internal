import { createHash } from "node:crypto";

import { SALES_FACT_METRICS } from "./salesFactsMetrics.js";

export const SALES_FACTS_SCHEMA_VERSION = 1;
export const SALES_FACTS_SCHEMA_NAME = "sales-facts-v1";

export function salesMetricColumnName(metricName) {
  return String(metricName).replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

export const SALES_FACT_METRIC_COLUMNS = Object.freeze(Object.fromEntries(
  Object.keys(SALES_FACT_METRICS).map((metricName) => [metricName, salesMetricColumnName(metricName)]),
));

const metricSql = Object.values(SALES_FACT_METRIC_COLUMNS).map((column) => `${column} INTEGER`).join(",\n  ");

export const SALES_FACTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL, applied_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_facts_metadata (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_profit_daily (
  fact_date TEXT NOT NULL, sid INTEGER NOT NULL CHECK (sid > 0),
  msku_key TEXT NOT NULL, msku TEXT NOT NULL,
  currency_mode TEXT NOT NULL CHECK (currency_mode IN ('CNY','ORIGINAL')),
  actual_currency_code TEXT NOT NULL,
  ${metricSql},
  source_updated_at_ms INTEGER NOT NULL, refreshed_at_ms INTEGER NOT NULL,
  refresh_batch_id TEXT NOT NULL,
  PRIMARY KEY (fact_date, sid, msku_key, currency_mode)
);
CREATE INDEX IF NOT EXISTS order_profit_daily_sid_date_idx ON order_profit_daily (sid, fact_date);
CREATE INDEX IF NOT EXISTS order_profit_daily_msku_date_idx ON order_profit_daily (msku_key, fact_date);
CREATE TABLE IF NOT EXISTS fact_coverage_daily (
  fact_date TEXT NOT NULL, sid INTEGER NOT NULL CHECK (sid > 0),
  currency_mode TEXT NOT NULL CHECK (currency_mode IN ('CNY','ORIGINAL')),
  source_updated_at_ms INTEGER NOT NULL, refreshed_at_ms INTEGER NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0), page_count INTEGER NOT NULL CHECK (page_count >= 0),
  refresh_batch_id TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY (fact_date, sid, currency_mode)
);
CREATE INDEX IF NOT EXISTS fact_coverage_freshness_idx ON fact_coverage_daily (currency_mode, refreshed_at_ms);
CREATE TABLE IF NOT EXISTS custom_fee_monthly (
  natural_month TEXT NOT NULL, sid INTEGER NOT NULL CHECK (sid > 0), fee_type_id TEXT NOT NULL,
  currency_mode TEXT NOT NULL CHECK (currency_mode IN ('CNY','ORIGINAL')),
  fee_name TEXT NOT NULL, fee_amount INTEGER NOT NULL, actual_currency_code TEXT NOT NULL,
  recognized INTEGER NOT NULL CHECK (recognized IN (0,1)),
  source_updated_at_ms INTEGER NOT NULL, refreshed_at_ms INTEGER NOT NULL,
  refresh_batch_id TEXT NOT NULL,
  PRIMARY KEY (natural_month, sid, fee_type_id, currency_mode)
);
CREATE TABLE IF NOT EXISTS custom_fee_coverage_monthly (
  natural_month TEXT NOT NULL, sid INTEGER NOT NULL CHECK (sid > 0),
  currency_mode TEXT NOT NULL CHECK (currency_mode IN ('CNY','ORIGINAL')),
  refreshed_at_ms INTEGER NOT NULL, row_count INTEGER NOT NULL CHECK (row_count >= 0),
  refresh_batch_id TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY (natural_month, sid, currency_mode)
);
CREATE INDEX IF NOT EXISTS custom_fee_coverage_freshness_idx ON custom_fee_coverage_monthly (currency_mode, refreshed_at_ms);
CREATE TABLE IF NOT EXISTS listing_owner_period (
  sid INTEGER NOT NULL CHECK (sid > 0), msku_key TEXT NOT NULL, msku TEXT NOT NULL,
  effective_from TEXT NOT NULL, effective_to TEXT,
  owner_identity TEXT, owner_person_id TEXT, owner_name_snapshot TEXT,
  identity_source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assigned','unassigned','historical-unknown')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (sid, msku_key, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS listing_owner_lookup_idx ON listing_owner_period (sid, msku_key, effective_from, effective_to);
CREATE UNIQUE INDEX IF NOT EXISTS listing_owner_open_idx ON listing_owner_period (sid, msku_key) WHERE effective_to IS NULL;
CREATE TABLE IF NOT EXISTS sales_derived_cache (
  cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL,
  sales_facts_revision INTEGER NOT NULL, owner_revision INTEGER NOT NULL,
  mapper_version TEXT NOT NULL, generated_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_derived_expiry_idx ON sales_derived_cache (expires_at_ms);
`;

export const SALES_FACTS_SCHEMA_CHECKSUM = createHash("sha256").update(SALES_FACTS_SCHEMA_SQL).digest("hex");

function existingMigrations(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  return table ? db.prepare("SELECT version,name,checksum,applied_at_ms FROM schema_migrations ORDER BY version").all() : [];
}

function validateMigrations(rows) {
  const unknown = rows.find(({ version }) => Number(version) > SALES_FACTS_SCHEMA_VERSION);
  if (unknown) throw new Error(`销售事实数据库包含未知的更高 schema 版本 ${unknown.version}。`);
  const current = rows.find(({ version }) => Number(version) === SALES_FACTS_SCHEMA_VERSION);
  if (current && (current.name !== SALES_FACTS_SCHEMA_NAME || current.checksum !== SALES_FACTS_SCHEMA_CHECKSUM)) {
    throw new Error("销售事实数据库 schema checksum 与当前实现不一致。");
  }
}

export function applySalesFactsSchema(db, { now = Date.now } = {}) {
  validateMigrations(existingMigrations(db));
  const appliedAtMs = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(appliedAtMs) || appliedAtMs < 0) throw new TypeError("销售事实 schema 时间无效。");
  db.transaction(() => {
    db.exec(SALES_FACTS_SCHEMA_SQL);
    const current = db.prepare("SELECT version,name,checksum FROM schema_migrations WHERE version=?").get(SALES_FACTS_SCHEMA_VERSION);
    if (current && (current.name !== SALES_FACTS_SCHEMA_NAME || current.checksum !== SALES_FACTS_SCHEMA_CHECKSUM)) {
      throw new Error("销售事实数据库 schema checksum 与当前实现不一致。");
    }
    if (!current) db.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at_ms) VALUES(?,?,?,?)")
      .run(SALES_FACTS_SCHEMA_VERSION, SALES_FACTS_SCHEMA_NAME, SALES_FACTS_SCHEMA_CHECKSUM, appliedAtMs);
    const insertMetadata = db.prepare("INSERT OR IGNORE INTO sales_facts_metadata(key,value,updated_at_ms) VALUES(?,?,?)");
    insertMetadata.run("sales_facts_revision", "0", appliedAtMs);
    insertMetadata.run("owner_revision", "0", appliedAtMs);
  })();
  return { version: SALES_FACTS_SCHEMA_VERSION, name: SALES_FACTS_SCHEMA_NAME, checksum: SALES_FACTS_SCHEMA_CHECKSUM };
}

export function validateSalesFactsSchema(db) {
  const rows = existingMigrations(db);
  validateMigrations(rows);
  if (!rows.some(({ version }) => Number(version) === SALES_FACTS_SCHEMA_VERSION)) {
    throw new Error("销售事实数据库 schema 尚未初始化。");
  }
  return { version: SALES_FACTS_SCHEMA_VERSION, name: SALES_FACTS_SCHEMA_NAME, checksum: SALES_FACTS_SCHEMA_CHECKSUM };
}

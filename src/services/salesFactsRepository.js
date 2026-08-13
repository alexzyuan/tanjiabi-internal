import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { safeQuickCheckDiagnostic } from "../utils/safeQuickCheckDiagnostic.js";
import {
  SalesFactsConflictError,
  SalesFactsDatabaseError,
  SalesFactsInputError,
} from "./salesFactsIdentity.js";
import { SALES_FACT_METRICS } from "./salesFactsMetrics.js";
import {
  applySalesFactsSchema,
  SALES_FACT_METRIC_COLUMNS,
  SALES_FACTS_SCHEMA_VERSION,
  validateSalesFactsSchema,
} from "./salesFactsSchema.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const CURRENCY_MODES = new Set(["CNY", "ORIGINAL"]);

function text(value, message) {
  const result = String(value ?? "").trim();
  if (!result) throw new SalesFactsInputError(message, { code: "SALES_FACTS_INPUT_INVALID" });
  return result;
}

function positiveSid(value) {
  const sid = Number(value);
  if (!Number.isInteger(sid) || sid <= 0) throw new SalesFactsInputError("销售事实 SID 无效。", { code: "SALES_FACTS_SID_INVALID" });
  return sid;
}

function integer(value, message, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new SalesFactsInputError(message, { code: "SALES_FACTS_INTEGER_INVALID" });
  return number;
}

function date(value, message = "销售事实日期无效。") {
  const result = text(value, message);
  if (!DATE_PATTERN.test(result)) throw new SalesFactsInputError(message, { code: "SALES_FACTS_DATE_INVALID" });
  return result;
}

function month(value) {
  const result = text(value, "销售事实自然月无效。");
  if (!MONTH_PATTERN.test(result)) throw new SalesFactsInputError("销售事实自然月无效。", { code: "SALES_FACTS_MONTH_INVALID" });
  return result;
}

function mode(value) {
  const result = text(value, "销售事实币种模式无效。").toUpperCase();
  if (!CURRENCY_MODES.has(result)) throw new SalesFactsInputError("销售事实币种模式无效。", { code: "SALES_FACTS_CURRENCY_MODE_INVALID" });
  return result;
}

function mskuKey(value) {
  return text(value, "销售事实 MSKU key 无效。").toLocaleLowerCase("en-US");
}

function safeNow(now) {
  const value = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(value) || value < 0) throw new SalesFactsInputError("销售事实时间无效。", { code: "SALES_FACTS_TIME_INVALID" });
  return value;
}

function dbError(error, operation, requestId) {
  if (error instanceof SalesFactsInputError || error instanceof SalesFactsConflictError || error instanceof SalesFactsDatabaseError) return error;
  const code = /^SQLITE_[A-Z0-9_]+$/u.test(String(error?.code || "")) ? error.code : undefined;
  return new SalesFactsDatabaseError(undefined, { code, details: { operation, requestId }, cause: error });
}

function log(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[sales-facts-repository]", details);
}

function operate(logger, operation, requestId, callback) {
  try {
    return callback();
  } catch (error) {
    const normalized = dbError(error, operation, requestId);
    log(logger, "error", { operation, requestId, code: normalized.code || null, errorName: normalized.name, statusCode: normalized.statusCode });
    throw normalized;
  }
}

function configure(db, readonly) {
  if (!readonly) db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!readonly) db.pragma("synchronous = FULL");
  else db.pragma("query_only = ON");
  const result = {
    journalMode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),
    foreignKeys: Number(db.pragma("foreign_keys", { simple: true })),
    busyTimeout: Number(db.pragma("busy_timeout", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
  };
  if (result.journalMode !== "wal" || result.foreignKeys !== 1 || result.busyTimeout !== 5000 || (!readonly && result.synchronous !== 2)) {
    throw new Error("销售事实数据库 pragma 配置不符合要求。");
  }
  return result;
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new SalesFactsInputError("销售事实范围无效。");
  const dates = [...new Set((scope.dates || []).map((value) => date(value)))];
  const sids = [...new Set((scope.sids || []).map(positiveSid))].sort((a, b) => a - b);
  if (!dates.length || !sids.length) throw new SalesFactsInputError("销售事实范围不能为空。", { code: "SALES_FACTS_SCOPE_EMPTY" });
  return { ...scope, dates, sids, currencyMode: mode(scope.currencyMode) };
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new SalesFactsInputError("销售事实指标无效。");
  const result = {};
  for (const [name, value] of Object.entries(metrics)) {
    if (!Object.hasOwn(SALES_FACT_METRICS, name)) throw new SalesFactsInputError(`销售事实指标未注册：${name}`);
    if (value !== null && typeof value !== "bigint") throw new SalesFactsInputError(`销售事实指标必须是定点整数：${name}`);
    result[name] = value;
  }
  return result;
}

function assertInScope(item, scope, itemDate) {
  if (!scope.dates.includes(itemDate) || !scope.sids.includes(item.sid) || item.currencyMode !== scope.currencyMode) {
    throw new SalesFactsInputError("销售事实写入行超出明确范围。", { code: "SALES_FACTS_SCOPE_MISMATCH" });
  }
}

function normalizeFact(input, scope, refreshedAtMs, refreshBatchId) {
  const fact = {
    factDate: date(input?.factDate),
    sid: positiveSid(input?.sid),
    mskuKey: mskuKey(input?.mskuKey),
    msku: text(input?.msku, "销售事实 MSKU 无效。"),
    currencyMode: mode(input?.currencyMode),
    actualCurrencyCode: text(input?.actualCurrencyCode, "销售事实实际币种缺失。").toUpperCase(),
    metrics: normalizeMetrics(input?.metrics),
    sourceUpdatedAtMs: integer(input?.sourceUpdatedAtMs, "销售事实来源时间无效。"),
    refreshedAtMs,
    refreshBatchId,
  };
  assertInScope(fact, scope, fact.factDate);
  if (fact.currencyMode === "CNY" && fact.actualCurrencyCode !== "CNY") {
    throw new SalesFactsConflictError("CNY 事实的实际币种必须为 CNY。", { code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT" });
  }
  return fact;
}

function normalizeCoverage(input, scope, refreshedAtMs, refreshBatchId, revision) {
  const row = {
    factDate: date(input?.factDate), sid: positiveSid(input?.sid), currencyMode: mode(input?.currencyMode),
    sourceUpdatedAtMs: integer(input?.sourceUpdatedAtMs, "coverage 来源时间无效。"),
    refreshedAtMs, rowCount: integer(input?.rowCount, "coverage 行数无效。"),
    pageCount: integer(input?.pageCount, "coverage 页数无效。"), refreshBatchId, revision,
  };
  assertInScope(row, scope, row.factDate);
  return row;
}

function validateUniqueFacts(facts) {
  const currencies = new Map();
  const seen = new Set();
  for (const fact of facts) {
    const key = `${fact.factDate}|${fact.sid}|${fact.mskuKey}|${fact.currencyMode}`;
    if (seen.has(key)) {
      const previous = currencies.get(key);
      if (previous !== fact.actualCurrencyCode) {
        throw new SalesFactsConflictError("同一销售事实身份出现多个实际币种。", { code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT" });
      }
      throw new SalesFactsConflictError("销售事实批次包含重复身份。", { code: "SALES_FACTS_DUPLICATE_FACT" });
    }
    seen.add(key);
    currencies.set(key, fact.actualCurrencyCode);
  }
}

function normalizeFee(input, scope, refreshedAtMs, refreshBatchId) {
  const row = {
    naturalMonth: month(input?.naturalMonth), sid: positiveSid(input?.sid), feeTypeId: text(input?.feeTypeId, "费用类型 ID 缺失。"),
    currencyMode: mode(input?.currencyMode), feeName: text(input?.feeName, "费用名称缺失。"),
    feeAmount: input?.feeAmount, actualCurrencyCode: text(input?.actualCurrencyCode, "费用实际币种缺失。").toUpperCase(),
    recognized: input?.recognized === true, sourceUpdatedAtMs: integer(input?.sourceUpdatedAtMs, "费用来源时间无效。"),
    refreshedAtMs, refreshBatchId,
  };
  if (typeof row.feeAmount !== "bigint") throw new SalesFactsInputError("费用金额必须是定点整数。");
  if (!scope.sids.includes(row.sid) || row.currencyMode !== scope.currencyMode || !scope.dates.some((value) => value.startsWith(row.naturalMonth))) {
    throw new SalesFactsInputError("月度费用超出明确范围。", { code: "SALES_FACTS_SCOPE_MISMATCH" });
  }
  return row;
}

function normalizeFeeCoverage(input, scope, refreshedAtMs, refreshBatchId, revision) {
  const row = { naturalMonth: month(input?.naturalMonth), sid: positiveSid(input?.sid), currencyMode: mode(input?.currencyMode), refreshedAtMs, rowCount: integer(input?.rowCount, "费用 coverage 行数无效。"), refreshBatchId, revision };
  if (!scope.sids.includes(row.sid) || row.currencyMode !== scope.currencyMode || !scope.dates.some((value) => value.startsWith(row.naturalMonth))) throw new SalesFactsInputError("费用 coverage 超出明确范围。");
  return row;
}

function normalizePeriod(input) {
  const status = text(input?.status, "负责人状态缺失。");
  if (!["assigned", "unassigned", "historical-unknown"].includes(status)) throw new SalesFactsInputError("负责人状态无效。");
  const row = {
    sid: positiveSid(input?.sid), mskuKey: mskuKey(input?.mskuKey), msku: text(input?.msku, "负责人 MSKU 缺失。"),
    effectiveFrom: date(input?.effectiveFrom), effectiveTo: input?.effectiveTo === null ? null : date(input?.effectiveTo),
    ownerIdentity: input?.ownerIdentity === null ? null : text(input?.ownerIdentity, "负责人身份无效。"),
    ownerPersonId: input?.ownerPersonId === null ? null : String(input.ownerPersonId),
    ownerNameSnapshot: input?.ownerNameSnapshot === null ? null : String(input.ownerNameSnapshot),
    identitySource: text(input?.identitySource, "负责人身份来源缺失。"), status,
    updatedAtMs: integer(input?.updatedAtMs, "负责人更新时间无效。"),
  };
  if (row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom) throw new SalesFactsInputError("负责人有效期无效。");
  if (status === "assigned" && !row.ownerIdentity) throw new SalesFactsInputError("已分配负责人缺少身份。");
  if (status !== "assigned" && row.ownerIdentity !== null) throw new SalesFactsInputError("非分配负责人不能包含身份。");
  return row;
}

function validatePeriods(periods) {
  const byIdentity = new Map();
  for (const period of periods) {
    const key = `${period.sid}|${period.mskuKey}`;
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(period);
  }
  for (const rows of byIdentity.values()) {
    rows.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      if (previous.effectiveTo === null || previous.effectiveTo >= rows[index].effectiveFrom) {
        throw new SalesFactsConflictError("Listing 负责人有效期重叠。", { code: "SALES_FACTS_OWNER_PERIOD_OVERLAP" });
      }
    }
  }
}

function sortPeriods(periods) {
  return periods.sort((left, right) => left.sid - right.sid
    || left.mskuKey.localeCompare(right.mskuKey)
    || left.effectiveFrom.localeCompare(right.effectiveFrom));
}

function fileSize(filePath) {
  try { return statSync(filePath).size; } catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
}

export function createSalesFactsRepository({
  databasePath = path.join(process.cwd(), "data-cache", "sales-facts", "sales-facts-v1.sqlite"),
  logger = console,
  now = Date.now,
  readonly = false,
  requestId,
} = {}) {
  if (!readonly) mkdirSync(path.dirname(databasePath), { recursive: true });
  let db;
  let pragmas;
  try {
    db = new Database(databasePath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    db.defaultSafeIntegers(true);
    pragmas = configure(db, readonly);
    if (readonly) validateSalesFactsSchema(db); else applySalesFactsSchema(db, { now });
  } catch (error) {
    try { db?.close(); } finally { throw dbError(error, "bootstrap", requestId); }
  }

  const metricNames = Object.keys(SALES_FACT_METRICS);
  const metricColumns = metricNames.map((name) => SALES_FACT_METRIC_COLUMNS[name]);
  const readMetadata = db.prepare("SELECT value FROM sales_facts_metadata WHERE key=?");
  const writeMetadata = db.prepare("INSERT INTO sales_facts_metadata(key,value,updated_at_ms) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at_ms=excluded.updated_at_ms");
  const revision = (key) => integer(readMetadata.get(key)?.value ?? 0, `销售事实 ${key} 无效。`);
  const factInsert = db.prepare(`INSERT INTO order_profit_daily(fact_date,sid,msku_key,msku,currency_mode,actual_currency_code,${metricColumns.join(",")},source_updated_at_ms,refreshed_at_ms,refresh_batch_id) VALUES(@factDate,@sid,@mskuKey,@msku,@currencyMode,@actualCurrencyCode,${metricNames.map((name) => `@${name}`).join(",")},@sourceUpdatedAtMs,@refreshedAtMs,@refreshBatchId)`);
  const coverageInsert = db.prepare("INSERT INTO fact_coverage_daily(fact_date,sid,currency_mode,source_updated_at_ms,refreshed_at_ms,row_count,page_count,refresh_batch_id,revision) VALUES(@factDate,@sid,@currencyMode,@sourceUpdatedAtMs,@refreshedAtMs,@rowCount,@pageCount,@refreshBatchId,@revision)");
  const feeInsert = db.prepare("INSERT INTO custom_fee_monthly(natural_month,sid,fee_type_id,currency_mode,fee_name,fee_amount,actual_currency_code,recognized,source_updated_at_ms,refreshed_at_ms,refresh_batch_id) VALUES(@naturalMonth,@sid,@feeTypeId,@currencyMode,@feeName,@feeAmount,@actualCurrencyCode,@recognized,@sourceUpdatedAtMs,@refreshedAtMs,@refreshBatchId)");
  const feeCoverageInsert = db.prepare("INSERT INTO custom_fee_coverage_monthly(natural_month,sid,currency_mode,refreshed_at_ms,row_count,refresh_batch_id,revision) VALUES(@naturalMonth,@sid,@currencyMode,@refreshedAtMs,@rowCount,@refreshBatchId,@revision)");

  const replaceTransaction = db.transaction(({ scope, facts, coverage, fees, feeCoverage, refreshedAtMs, refreshBatchId }) => {
    const nextRevision = revision("sales_facts_revision") + 1;
    for (const factDate of scope.dates) for (const sid of scope.sids) {
      db.prepare("DELETE FROM order_profit_daily WHERE fact_date=? AND sid=? AND currency_mode=?").run(factDate, sid, scope.currencyMode);
      db.prepare("DELETE FROM fact_coverage_daily WHERE fact_date=? AND sid=? AND currency_mode=?").run(factDate, sid, scope.currencyMode);
    }
    if (fees !== null) {
      const months = [...new Set(scope.dates.map((value) => value.slice(0, 7)))];
      for (const naturalMonth of months) for (const sid of scope.sids) {
        db.prepare("DELETE FROM custom_fee_monthly WHERE natural_month=? AND sid=? AND currency_mode=?").run(naturalMonth, sid, scope.currencyMode);
        db.prepare("DELETE FROM custom_fee_coverage_monthly WHERE natural_month=? AND sid=? AND currency_mode=?").run(naturalMonth, sid, scope.currencyMode);
      }
    }
    for (const item of facts) factInsert.run({ ...Object.fromEntries(metricNames.map((name) => [name, null])), ...item, ...item.metrics });
    for (const item of coverage) coverageInsert.run({ ...item, revision: nextRevision });
    if (fees !== null) for (const item of fees) feeInsert.run({ ...item, recognized: item.recognized ? 1 : 0 });
    if (feeCoverage !== null) for (const item of feeCoverage) feeCoverageInsert.run({ ...item, revision: nextRevision });
    writeMetadata.run("sales_facts_revision", String(nextRevision), refreshedAtMs);
    return { salesFactsRevision: nextRevision, factCount: facts.length, coverageCount: coverage.length, customFeeCount: fees?.length || 0 };
  });

  function preparedBatch(input, includeFees) {
    if (readonly) throw new SalesFactsInputError("销售事实只读仓储禁止写入。", { code: "SALES_FACTS_READONLY" });
    const scope = normalizeScope(input?.scope);
    const refreshedAtMs = integer(input?.refreshedAtMs, "销售事实刷新时间无效。");
    const refreshBatchId = text(input?.refreshBatchId, "销售事实批次 ID 缺失。");
    const nextRevision = revision("sales_facts_revision") + 1;
    const facts = (input?.facts || []).map((item) => normalizeFact(item, scope, refreshedAtMs, refreshBatchId));
    validateUniqueFacts(facts);
    const coverage = (input?.coverage || []).map((item) => normalizeCoverage(item, scope, refreshedAtMs, refreshBatchId, nextRevision));
    const fees = includeFees ? (input?.customFees || []).map((item) => normalizeFee(item, scope, refreshedAtMs, refreshBatchId)) : null;
    const feeCoverage = includeFees ? (input?.customFeeCoverage || []).map((item) => normalizeFeeCoverage(item, scope, refreshedAtMs, refreshBatchId, nextRevision)) : null;
    return { scope, facts, coverage, fees, feeCoverage, refreshedAtMs, refreshBatchId };
  }

  function replaceOrderProfitScope(input = {}) {
    return operate(logger, "replace-order-profit", input.requestId, () => replaceTransaction(preparedBatch(input, false)));
  }

  function replaceMonthlyReportScope(input = {}) {
    return operate(logger, "replace-monthly-report", input.requestId, () => replaceTransaction(preparedBatch(input, true)));
  }

  function readFacts(scopeInput, options = {}) {
    return operate(logger, "read-facts", options.requestId, () => {
      const scope = normalizeScope(scopeInput);
      const rows = db.prepare(`SELECT * FROM order_profit_daily WHERE fact_date BETWEEN ? AND ? AND currency_mode=? AND sid IN (${scope.sids.map(() => "?").join(",")}) ORDER BY fact_date,sid,msku_key`).all(scope.dates[0], scope.dates.at(-1), scope.currencyMode, ...scope.sids);
      return rows.map((row) => ({
        factDate: row.fact_date, sid: Number(row.sid), mskuKey: row.msku_key, msku: row.msku,
        currencyMode: row.currency_mode, actualCurrencyCode: row.actual_currency_code,
        metrics: Object.fromEntries(metricNames.filter((name) => row[SALES_FACT_METRIC_COLUMNS[name]] !== null).map((name) => [name, row[SALES_FACT_METRIC_COLUMNS[name]]])),
        sourceUpdatedAtMs: Number(row.source_updated_at_ms), refreshedAtMs: Number(row.refreshed_at_ms), refreshBatchId: row.refresh_batch_id,
      }));
    });
  }

  function readCoverage(scopeInput, options = {}) {
    return operate(logger, "read-coverage", options.requestId, () => {
      const scope = normalizeScope(scopeInput);
      return db.prepare(`SELECT * FROM fact_coverage_daily WHERE fact_date BETWEEN ? AND ? AND currency_mode=? AND sid IN (${scope.sids.map(() => "?").join(",")}) ORDER BY fact_date,sid`).all(scope.dates[0], scope.dates.at(-1), scope.currencyMode, ...scope.sids).map((row) => ({ factDate: row.fact_date, sid: Number(row.sid), currencyMode: row.currency_mode, sourceUpdatedAtMs: Number(row.source_updated_at_ms), refreshedAtMs: Number(row.refreshed_at_ms), rowCount: Number(row.row_count), pageCount: Number(row.page_count), refreshBatchId: row.refresh_batch_id, revision: Number(row.revision) }));
    });
  }

  function readCustomFees(scopeInput, options = {}) {
    return operate(logger, "read-custom-fees", options.requestId, () => {
      const scope = normalizeScope(scopeInput);
      const months = [...new Set(scope.dates.map((value) => value.slice(0, 7)))];
      return db.prepare(`SELECT * FROM custom_fee_monthly WHERE natural_month IN (${months.map(() => "?").join(",")}) AND currency_mode=? AND sid IN (${scope.sids.map(() => "?").join(",")}) ORDER BY natural_month,sid,fee_type_id`).all(...months, scope.currencyMode, ...scope.sids).map((row) => ({ naturalMonth: row.natural_month, sid: Number(row.sid), feeTypeId: row.fee_type_id, currencyMode: row.currency_mode, feeName: row.fee_name, feeAmount: row.fee_amount, actualCurrencyCode: row.actual_currency_code, recognized: Number(row.recognized) === 1, sourceUpdatedAtMs: Number(row.source_updated_at_ms), refreshedAtMs: Number(row.refreshed_at_ms), refreshBatchId: row.refresh_batch_id }));
    });
  }

  const ownerInsert = db.prepare("INSERT INTO listing_owner_period(sid,msku_key,msku,effective_from,effective_to,owner_identity,owner_person_id,owner_name_snapshot,identity_source,status,updated_at_ms) VALUES(@sid,@mskuKey,@msku,@effectiveFrom,@effectiveTo,@ownerIdentity,@ownerPersonId,@ownerNameSnapshot,@identitySource,@status,@updatedAtMs)");
  const mapOwnerPeriod = (row) => ({ sid: Number(row.sid), mskuKey: row.msku_key, msku: row.msku, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, ownerIdentity: row.owner_identity, ownerPersonId: row.owner_person_id, ownerNameSnapshot: row.owner_name_snapshot, identitySource: row.identity_source, status: row.status, updatedAtMs: Number(row.updated_at_ms) });
  const selectAllOwnerPeriods = () => db.prepare("SELECT * FROM listing_owner_period ORDER BY sid,msku_key,effective_from").all().map(mapOwnerPeriod);
  const readOwnerStateTransaction = db.transaction(() => ({
    periods: selectAllOwnerPeriods(),
    ownerRevision: revision("owner_revision"),
  }));
  const applyOwnerTransaction = db.transaction(({ periods, expectedOwnerRevision }) => {
    const actualOwnerRevision = revision("owner_revision");
    if (actualOwnerRevision !== expectedOwnerRevision) {
      throw new SalesFactsConflictError("Listing 负责人 revision 已变化。", {
        code: "SALES_FACTS_OWNER_REVISION_CONFLICT",
        details: { expectedOwnerRevision, actualOwnerRevision },
      });
    }
    validatePeriods(periods);
    const current = selectAllOwnerPeriods();
    if (JSON.stringify(current) === JSON.stringify(periods)) return { changed: false, ownerRevision: actualOwnerRevision };
    db.prepare("DELETE FROM listing_owner_period").run();
    for (const period of periods) ownerInsert.run(period);
    const next = actualOwnerRevision + 1;
    writeMetadata.run("owner_revision", String(next), safeNow(now));
    return { changed: true, ownerRevision: next };
  });

  function readOwnerPeriods(scopeInput = null, options = {}) {
    return operate(logger, "read-owner-periods", options.requestId, () => {
      let rows;
      if (scopeInput) {
        const scope = normalizeScope(scopeInput);
        rows = db.prepare(`SELECT * FROM listing_owner_period WHERE sid IN (${scope.sids.map(() => "?").join(",")}) ORDER BY sid,msku_key,effective_from`).all(...scope.sids);
      } else return selectAllOwnerPeriods();
      return rows.map(mapOwnerPeriod);
    });
  }

  function readOwnerState(options = {}) {
    return operate(logger, "read-owner-state", options.requestId, () => readOwnerStateTransaction());
  }

  function applyOwnerSnapshot(input = {}) {
    return operate(logger, "apply-owner-snapshot", input.requestId, () => {
      if (readonly) throw new SalesFactsInputError("销售事实只读仓储禁止写入。", { code: "SALES_FACTS_READONLY" });
      if (!Object.hasOwn(input, "periods") || !Array.isArray(input.periods)) {
        throw new SalesFactsInputError("Listing 负责人期间必须是显式数组。", { code: "SALES_FACTS_OWNER_PERIODS_INVALID" });
      }
      if (!Object.hasOwn(input, "expectedOwnerRevision")) {
        throw new SalesFactsInputError("Listing 负责人 expected revision 缺失。", { code: "SALES_FACTS_OWNER_REVISION_INVALID" });
      }
      const expectedOwnerRevision = integer(input.expectedOwnerRevision, "Listing 负责人 expected revision 无效。");
      const periods = sortPeriods(input.periods.map(normalizePeriod));
      return applyOwnerTransaction({ periods, expectedOwnerRevision });
    });
  }

  function writeDerivedCache(input = {}) {
    return operate(logger, "write-derived-cache", input.requestId, () => {
      if (readonly) throw new SalesFactsInputError("销售事实只读仓储禁止写入。", { code: "SALES_FACTS_READONLY" });
      const row = { cacheKey: text(input.cacheKey, "派生缓存 key 缺失。"), payloadJson: JSON.stringify(input.payload), salesFactsRevision: integer(input.salesFactsRevision, "事实 revision 无效。"), ownerRevision: integer(input.ownerRevision, "负责人 revision 无效。"), mapperVersion: text(input.mapperVersion, "mapper version 缺失。"), generatedAtMs: integer(input.generatedAtMs, "生成时间无效。"), expiresAtMs: integer(input.expiresAtMs, "过期时间无效。") };
      db.prepare("INSERT INTO sales_derived_cache(cache_key,payload_json,sales_facts_revision,owner_revision,mapper_version,generated_at_ms,expires_at_ms) VALUES(@cacheKey,@payloadJson,@salesFactsRevision,@ownerRevision,@mapperVersion,@generatedAtMs,@expiresAtMs) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,sales_facts_revision=excluded.sales_facts_revision,owner_revision=excluded.owner_revision,mapper_version=excluded.mapper_version,generated_at_ms=excluded.generated_at_ms,expires_at_ms=excluded.expires_at_ms").run(row);
      return { written: true };
    });
  }

  function readDerivedCache(cacheKey, options = {}) {
    return operate(logger, "read-derived-cache", options.requestId, () => {
      const row = db.prepare("SELECT * FROM sales_derived_cache WHERE cache_key=?").get(text(cacheKey, "派生缓存 key 缺失。"));
      return row ? { cacheKey: row.cache_key, payload: JSON.parse(row.payload_json), salesFactsRevision: Number(row.sales_facts_revision), ownerRevision: Number(row.owner_revision), mapperVersion: row.mapper_version, generatedAtMs: Number(row.generated_at_ms), expiresAtMs: Number(row.expires_at_ms) } : null;
    });
  }

  function getRevisions(options = {}) {
    return operate(logger, "get-revisions", options.requestId, () => ({ salesFactsRevision: revision("sales_facts_revision"), ownerRevision: revision("owner_revision") }));
  }

  function getHealth(options = {}) {
    return operate(logger, "health", options.requestId, () => {
      const quickCheck = safeQuickCheckDiagnostic(db.pragma("quick_check", { simple: true }));
      const counts = Object.fromEntries([["dailyFactCount", "order_profit_daily"], ["factCoverageCount", "fact_coverage_daily"], ["customFeeCount", "custom_fee_monthly"], ["customFeeCoverageCount", "custom_fee_coverage_monthly"], ["ownerPeriodCount", "listing_owner_period"], ["derivedCacheCount", "sales_derived_cache"]].map(([key, table]) => [key, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
      return { ok: quickCheck === "ok", status: quickCheck === "ok" ? "healthy" : "degraded", schemaVersion: SALES_FACTS_SCHEMA_VERSION, quickCheck, ...getRevisions(), ...counts, schemaMigrationCount: Number(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count), databaseBytes: fileSize(databasePath), walBytes: fileSize(`${databasePath}-wal`) };
    });
  }

  function debugSnapshotForTest() {
    return { facts: readFacts({ dates: db.prepare("SELECT DISTINCT fact_date FROM order_profit_daily ORDER BY fact_date").all().map((row) => row.fact_date), sids: db.prepare("SELECT DISTINCT sid FROM order_profit_daily ORDER BY sid").all().map((row) => Number(row.sid)), currencyMode: "CNY" }), coverage: db.prepare("SELECT * FROM fact_coverage_daily ORDER BY fact_date,sid,currency_mode").all(), revisions: getRevisions() };
  }

  return {
    databasePath,
    getSchemaInfo: () => ({ version: SALES_FACTS_SCHEMA_VERSION, ...pragmas }),
    getHealth,
    getRevisions,
    readCoverage,
    readFacts,
    replaceOrderProfitScope,
    replaceMonthlyReportScope,
    readCustomFees,
    readOwnerPeriods,
    readOwnerState,
    applyOwnerSnapshot,
    readDerivedCache,
    writeDerivedCache,
    debugSnapshotForTest,
    close: () => { if (db?.open) db.close(); },
  };
}

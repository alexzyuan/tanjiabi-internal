import { performance } from "node:perf_hooks";

import {
  normalizeSalesFactsRequestId,
  normalizeSalesFactsScope,
  SalesFactsConflictError,
  SalesFactsContractError,
  SalesFactsInputError,
} from "./salesFactsIdentity.js";
import { reconstructSalesFactMapperRecord, SALES_FACT_METRICS } from "./salesFactsMetrics.js";
import { classifyCoveragePartition } from "./salesFactsSyncService.js";

const STATUS_RANK = Object.freeze({ fresh: 0, frozen: 1, stale: 2, missing: 3 });
const SAFE_OWNER_FILTER_MAX_LENGTH = 160;

function safeNow(now) {
  const value = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SalesFactsInputError("销售事实查询时间无效。", { code: "SALES_FACTS_QUERY_NOW_INVALID" });
  }
  return value;
}

function log(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, `[sales-facts-query] ${event}`, details);
}

function ensureRepository(repository) {
  if (!repository
    || typeof repository.readCoverage !== "function"
    || typeof repository.readFacts !== "function"
    || typeof repository.readOwnerPeriods !== "function"
    || typeof repository.getRevisions !== "function") {
    throw new SalesFactsInputError("销售事实查询仓储接口无效。", { code: "SALES_FACTS_QUERY_REPOSITORY_INVALID" });
  }
}

function ensureRefresh(refreshOrderProfitScope) {
  if (typeof refreshOrderProfitScope !== "function") {
    throw new SalesFactsInputError("销售事实查询缺少刷新接口。", { code: "SALES_FACTS_QUERY_REFRESH_INVALID" });
  }
}

function normalizeDirectory(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.sellers)) return value.sellers;
  if (Array.isArray(value?.rows)) return value.rows;
  throw new SalesFactsInputError("销售事实 seller directory 结果无效。", { code: "SALES_FACTS_QUERY_SELLER_DIRECTORY_INVALID" });
}

async function resolveScope(scopeInput, { getSellerDirectory, sellerDirectory, now }) {
  if (!scopeInput || typeof scopeInput !== "object" || Array.isArray(scopeInput)) {
    throw new SalesFactsInputError("销售事实查询范围无效。", { code: "SALES_FACTS_QUERY_SCOPE_INVALID" });
  }
  const dates = Array.isArray(scopeInput.dates) ? scopeInput.dates : [];
  const directory = sellerDirectory
    || (typeof getSellerDirectory === "function" ? await getSellerDirectory() : null);
  if (!directory) {
    throw new SalesFactsInputError("销售事实查询缺少 seller directory。", { code: "SALES_FACTS_QUERY_SELLER_DIRECTORY_INVALID" });
  }
  return normalizeSalesFactsScope({
    ...scopeInput,
    startDate: scopeInput.startDate || dates[0],
    endDate: scopeInput.endDate || dates.at(-1),
    sellerDirectory: normalizeDirectory(directory),
    now,
  });
}

function ownerFilter(value) {
  const result = String(value ?? "").trim();
  if (result.length > SAFE_OWNER_FILTER_MAX_LENGTH) {
    throw new SalesFactsInputError("负责人筛选条件过长。", { code: "SALES_FACTS_QUERY_OWNER_FILTER_INVALID" });
  }
  return result;
}

function monthOfDate(value) {
  return String(value || "").slice(0, 7);
}

function previousMonthOfCurrent(nowMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = Number(parts.find(({ type }) => type === "year")?.value);
  const month = Number(parts.find(({ type }) => type === "month")?.value);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function currentMonthOf(nowMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(nowMs));
  return `${parts.find(({ type }) => type === "year")?.value}-${parts.find(({ type }) => type === "month")?.value}`;
}

function coverageKey(row) {
  return `${row?.factDate}|${Number(row?.sid)}|${String(row?.currencyMode || "").toUpperCase()}`;
}

function expectedCoverageKey(date, sid, currencyMode) {
  return `${date}|${sid}|${currencyMode}`;
}

function coverageState(scope, rows, currentMs) {
  if (!Array.isArray(rows)) {
    throw new SalesFactsContractError("销售事实 coverage 读取结果无效。", { code: "SALES_FACTS_QUERY_COVERAGE_INVALID" });
  }
  const expected = new Set();
  for (const factDate of scope.dates) {
    for (const sid of scope.sids) expected.add(expectedCoverageKey(factDate, sid, scope.currencyMode));
  }
  const byKey = new Map();
  for (const row of rows) {
    const key = coverageKey(row);
    if (!expected.has(key) || byKey.has(key)) {
      throw new SalesFactsContractError("销售事实 coverage 超出范围或重复。", { code: "SALES_FACTS_QUERY_COVERAGE_INVALID" });
    }
    byKey.set(key, row);
  }
  const byDate = new Map();
  for (const factDate of scope.dates) {
    let status = "fresh";
    for (const sid of scope.sids) {
      const row = byKey.get(expectedCoverageKey(factDate, sid, scope.currencyMode));
      const rowStatus = row
        ? classifyCoveragePartition({ naturalMonth: monthOfDate(factDate), refreshedAtMs: row.refreshedAtMs, nowPacific: currentMs })
        : "missing";
      if (STATUS_RANK[rowStatus] > STATUS_RANK[status]) status = rowStatus;
    }
    byDate.set(factDate, status);
  }
  return { byKey, byDate };
}

function frozenMissingDates(scope, byDate, currentMs) {
  const current = currentMonthOf(currentMs);
  const previous = previousMonthOfCurrent(currentMs);
  return scope.dates.filter((factDate) => byDate.get(factDate) === "missing"
    && monthOfDate(factDate) !== current
    && monthOfDate(factDate) !== previous);
}

function latestCoverageTimestamp(rows) {
  return rows.reduce((latest, row) => {
    const value = Number(row?.refreshedAtMs);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SalesFactsContractError("销售事实 coverage 刷新时间无效。", { code: "SALES_FACTS_QUERY_COVERAGE_TIMESTAMP_INVALID" });
    }
    return latest === null ? value : Math.max(latest, value);
  }, null);
}

function periodMatches(period, fact) {
  if (Number(period?.sid) !== Number(fact?.sid) || String(period?.mskuKey || "").toLocaleLowerCase("en-US") !== String(fact?.mskuKey || "").toLocaleLowerCase("en-US")) return false;
  if (String(period?.effectiveFrom || "") > String(fact?.factDate || "")) return false;
  return period.effectiveTo === null || period.effectiveTo === undefined || String(period.effectiveTo) >= String(fact.factDate);
}

function ownerForFact(periods, fact) {
  const matches = periods.filter((period) => periodMatches(period, fact));
  if (matches.length > 1) {
    throw new SalesFactsConflictError("销售事实负责人有效期重叠。", { code: "SALES_FACTS_OWNER_PERIOD_OVERLAP" });
  }
  const period = matches[0] || {
    status: "historical-unknown",
    ownerIdentity: null,
    ownerPersonId: null,
    ownerNameSnapshot: null,
    identitySource: "query-no-effective-period",
  };
  return {
    listingOwner: period.status === "assigned" ? period.ownerNameSnapshot : null,
    listingOwnerStatus: period.status,
    listingOwnerIdentity: period.ownerIdentity,
    listingOwnerPersonId: period.ownerPersonId,
    listingOwnerIdentitySource: period.identitySource,
  };
}

function decodeFact(fact, periods) {
  return {
    factDate: fact.factDate,
    sid: Number(fact.sid),
    msku: fact.msku,
    mskuKey: fact.mskuKey,
    currencyMode: fact.currencyMode,
    actualCurrencyCode: fact.actualCurrencyCode,
    metrics: reconstructSalesFactMapperRecord(fact.metrics),
    ...ownerForFact(periods, fact),
  };
}

function validateFacts(scope, facts) {
  if (!Array.isArray(facts)) {
    throw new SalesFactsContractError("销售事实读取结果无效。", { code: "SALES_FACTS_QUERY_FACTS_INVALID" });
  }
  const dateSet = new Set(scope.dates);
  const sidSet = new Set(scope.sids);
  const seen = new Set();
  for (const fact of facts) {
    const factDate = String(fact?.factDate || "");
    const sid = Number(fact?.sid);
    const currencyMode = String(fact?.currencyMode || "").toUpperCase();
    const mskuKey = String(fact?.mskuKey || "").trim().toLocaleLowerCase("en-US");
    const actualCurrencyCode = String(fact?.actualCurrencyCode || "").trim().toUpperCase();
    if (!dateSet.has(factDate) || !sidSet.has(sid) || currencyMode !== scope.currencyMode || !mskuKey || !String(fact?.msku || "").trim() || !actualCurrencyCode) {
      throw new SalesFactsContractError("销售事实读取行超出明确范围或身份缺失。", { code: "SALES_FACTS_QUERY_SCOPE_MISMATCH" });
    }
    if (scope.currencyMode === "CNY" && actualCurrencyCode !== "CNY") {
      throw new SalesFactsConflictError("CNY 销售事实返回非 CNY 实际币种。", { code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT" });
    }
    if (!fact?.metrics || typeof fact.metrics !== "object" || Array.isArray(fact.metrics)) {
      throw new SalesFactsContractError("销售事实指标结构无效。", { code: "SALES_FACTS_QUERY_METRICS_INVALID" });
    }
    for (const [metricName, value] of Object.entries(fact.metrics)) {
      if (!Object.hasOwn(SALES_FACT_METRICS, metricName) || (value !== null && typeof value !== "bigint")) {
        throw new SalesFactsContractError("销售事实指标包含未注册或非定点值。", { code: "SALES_FACTS_QUERY_METRICS_INVALID" });
      }
    }
    const key = `${factDate}|${sid}|${mskuKey}|${currencyMode}`;
    if (seen.has(key)) {
      throw new SalesFactsConflictError("销售事实读取结果包含重复身份。", { code: "SALES_FACTS_QUERY_DUPLICATE_FACT" });
    }
    seen.add(key);
  }
}

function timings(start, phases) {
  return {
    ...Object.fromEntries(Object.entries(phases).map(([key, value]) => [key, Math.max(0, Math.round(value))])),
    totalMs: Math.max(0, Math.round(performance.now() - start)),
  };
}

function safeLogDetails(scope, requestId, meta) {
  return {
    requestId,
    startDate: scope.startDate,
    endDate: scope.endDate,
    sidCount: scope.sids.length,
    currencyMode: scope.currencyMode,
    cacheState: meta.cacheState,
    recordCount: meta.recordCount,
    ownerRevision: meta.ownerRevision,
  };
}

async function getSalesFactsInternal(scopeInput, {
  repository,
  getSellerDirectory,
  sellerDirectory,
  refreshOrderProfitScope,
  forceRefresh = false,
  listingOwner = "",
  requestId: requestedRequestId,
  now = Date.now,
  logger = console,
} = {}) {
  ensureRepository(repository);
  ensureRefresh(refreshOrderProfitScope);
  const started = performance.now();
  const currentMs = safeNow(now);
  const requestId = normalizeSalesFactsRequestId(requestedRequestId, { fallback: "sales-facts-query" });
  const normalizationStart = performance.now();
  const scope = await resolveScope(scopeInput, { getSellerDirectory, sellerDirectory, now: currentMs });
  const selectedOwner = ownerFilter(listingOwner);
  const phase = { networkMs: 0, normalizationMs: 0, validationMs: 0, queryMs: 0, ownerJoinMs: 0, derivedMapMs: 0 };
  phase.normalizationMs = performance.now() - normalizationStart;

  const coverageStart = performance.now();
  let coverageRows = repository.readCoverage(scope, { requestId });
  let plan = coverageState(scope, coverageRows, currentMs);
  phase.queryMs += performance.now() - coverageStart;
  const missingFrozen = frozenMissingDates(scope, plan.byDate, currentMs);
  if (missingFrozen.length && !forceRefresh) {
    const error = new SalesFactsContractError("历史冻结月份 coverage 缺失，必须显式强制刷新。", {
      code: "SALES_FACTS_FROZEN_COVERAGE_MISSING",
      details: { dateCount: missingFrozen.length, sidCount: scope.sids.length },
    });
    error.statusCode = 422;
    throw error;
  }

  const shouldRefresh = forceRefresh || [...plan.byDate.values()].some((status) => ["stale", "missing"].includes(status));
  let cacheState = "hit";
  let singleFlight = null;
  if (shouldRefresh) {
    const refreshStart = performance.now();
    const refreshed = await refreshOrderProfitScope(scope, { forceRefresh, requestId });
    phase.networkMs += performance.now() - refreshStart;
    cacheState = refreshed?.meta?.singleFlight === "joiner" ? "inflight" : "refreshed";
    singleFlight = refreshed?.meta?.singleFlight || null;
    coverageRows = repository.readCoverage(scope, { requestId });
    plan = coverageState(scope, coverageRows, currentMs);
    if ([...plan.byDate.values()].some((status) => status === "missing" || status === "stale")) {
      throw new SalesFactsContractError("销售事实刷新后 coverage 仍不可用。", { code: "SALES_FACTS_QUERY_COVERAGE_STALE" });
    }
  } else if ([...plan.byDate.values()].every((status) => status === "frozen")) {
    cacheState = "frozen";
  }

  const queryStart = performance.now();
  const facts = repository.readFacts(scope, { requestId });
  const periods = repository.readOwnerPeriods(scope, { requestId });
  const revisions = repository.getRevisions({ requestId });
  phase.queryMs += performance.now() - queryStart;
  if (!Array.isArray(periods) || !revisions || typeof revisions !== "object") {
    throw new SalesFactsContractError("销售事实查询结果结构无效。", { code: "SALES_FACTS_QUERY_RESULT_INVALID" });
  }
  const validationStart = performance.now();
  validateFacts(scope, facts);
  phase.validationMs += performance.now() - validationStart;
  const ownerStart = performance.now();
  const decoded = facts.map((factRow) => decodeFact(factRow, periods));
  const filteredRecords = selectedOwner
    ? decoded.filter((record) => record.listingOwner === selectedOwner)
    : decoded;
  phase.ownerJoinMs += performance.now() - ownerStart;
  const latest = latestCoverageTimestamp(coverageRows);
  const ageSeconds = latest === null ? null : Math.max(0, Math.floor((currentMs - latest) / 1000));
  const meta = {
    source: "sales-facts-sqlite",
    cacheState,
    updatedAt: latest ? new Date(latest).toISOString() : null,
    ageSeconds,
    revision: Number(revisions.salesFactsRevision),
    ownerRevision: Number(revisions.ownerRevision),
    requestId,
    startDate: scope.startDate,
    endDate: scope.endDate,
    currencyMode: scope.currencyMode,
    scopeCount: { dates: scope.dates.length, sids: scope.sids.length },
    recordCount: filteredRecords.length,
    coverageCount: coverageRows.length,
    ownerJoinedCount: decoded.length,
    filteredByOwner: selectedOwner ? decoded.length - filteredRecords.length : 0,
    ...(singleFlight ? { singleFlight } : {}),
    timings: timings(started, phase),
  };
  log(logger, "info", "success", safeLogDetails(scope, requestId, meta));
  return { records: filteredRecords, meta };
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  return /^SALES_FACTS_[A-Z0-9_]+$/u.test(code) ? code : "SALES_FACTS_QUERY_FAILED";
}

function safeErrorName(error) {
  const name = String(error?.name || "");
  return /^(?:SalesFacts|ListingOwner)[A-Za-z]+Error$/u.test(name) ? name : "Error";
}

export async function getSalesFacts(scopeInput, options = {}) {
  const requestId = normalizeSalesFactsRequestId(options.requestId, { fallback: "sales-facts-query" });
  try {
    return await getSalesFactsInternal(scopeInput, options);
  } catch (error) {
    log(options.logger || console, "error", "failure", {
      requestId,
      errorName: safeErrorName(error),
      errorCode: safeErrorCode(error),
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
    });
    throw error;
  }
}

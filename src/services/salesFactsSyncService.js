import {
  normalizeSalesFactsRequestId,
  SalesFactsContractError,
  SalesFactsInputError,
} from "./salesFactsIdentity.js";

const HOUR_MS = 60 * 60 * 1000;
const CURRENT_TTL_MS = 12 * HOUR_MS;
const PREVIOUS_TTL_MS = 24 * HOUR_MS;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const STATUS_RANK = Object.freeze({ fresh: 0, frozen: 1, stale: 2, missing: 3 });

function log(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, `[sales-facts-sync] ${event}`, details);
}

function nowMs(now) {
  const value = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SalesFactsInputError("销售事实同步时间无效。", { code: "SALES_FACTS_SYNC_NOW_INVALID" });
  }
  return value;
}

function dateText(value, field = "销售事实日期") {
  const text = String(value || "").trim();
  if (!DATE_PATTERN.test(text)) throw new SalesFactsInputError(`${field}无效。`, { code: "SALES_FACTS_DATE_INVALID" });
  return text;
}

function monthText(value) {
  const text = String(value || "").trim();
  const match = MONTH_PATTERN.exec(text);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) {
    throw new SalesFactsInputError("销售事实自然月无效。", { code: "SALES_FACTS_MONTH_INVALID" });
  }
  return text;
}

function monthOfDate(value) {
  return dateText(value).slice(0, 7);
}

function pacificMonth(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new SalesFactsInputError("销售事实当前时间无效。", { code: "SALES_FACTS_SYNC_NOW_INVALID" });
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find(({ type }) => type === "year")?.value),
    month: Number(parts.find(({ type }) => type === "month")?.value),
  };
}

function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Classify one coverage timestamp using the Pacific business month.
 * A timestamp at the TTL boundary is still fresh; missing timestamps are not zero.
 */
export function classifyCoveragePartition({ naturalMonth, refreshedAtMs, nowPacific, now } = {}) {
  const month = monthText(naturalMonth);
  const currentNow = nowPacific ?? now;
  const currentMs = nowMs(currentNow);
  const current = monthKey(pacificMonth(currentMs));
  const previous = monthKey(previousMonth(pacificMonth(currentMs)));
  if (refreshedAtMs === null || refreshedAtMs === undefined || refreshedAtMs === "") return "missing";
  const refreshed = Number(refreshedAtMs);
  if (!Number.isSafeInteger(refreshed) || refreshed < 0) {
    throw new SalesFactsContractError("销售事实 coverage 刷新时间无效。", { code: "SALES_FACTS_COVERAGE_TIMESTAMP_INVALID" });
  }
  if (month !== current && month !== previous) return "frozen";
  const ttl = month === current ? CURRENT_TTL_MS : PREVIOUS_TTL_MS;
  return currentMs - refreshed <= ttl ? "fresh" : "stale";
}

function ensureScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)
    || !Array.isArray(scope.dates) || !scope.dates.length
    || !Array.isArray(scope.sids) || !scope.sids.length
    || !scope.rangeKey || !scope.currencyMode) {
    throw new SalesFactsInputError("销售事实同步范围无效。", { code: "SALES_FACTS_SCOPE_INVALID" });
  }
  const dates = scope.dates.map((value) => dateText(value));
  const sids = scope.sids.map((value) => Number(value));
  if (sids.some((sid) => !Number.isSafeInteger(sid) || sid <= 0)) {
    throw new SalesFactsInputError("销售事实同步 SID 无效。", { code: "SALES_FACTS_SCOPE_INVALID" });
  }
  return { ...scope, dates, sids, currencyMode: String(scope.currencyMode).toUpperCase() };
}

function nextDate(value) {
  const date = new Date(`${dateText(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function makeSegments(dates) {
  const segments = [];
  for (const date of dates) {
    const previous = segments.at(-1);
    if (previous && nextDate(previous.endDate) === date) previous.endDate = date;
    else segments.push({ startDate: date, endDate: date, dates: [date] });
    if (previous && previous.endDate === date) previous.dates.push(date);
  }
  return segments;
}

function statusForRows({ scope, date, rows, now }) {
  const rowsBySid = new Map(rows.filter((row) => row?.factDate === date).map((row) => [Number(row.sid), row]));
  if (scope.sids.some((sid) => !rowsBySid.has(sid))) return "missing";
  return scope.sids.reduce((worst, sid) => {
    const row = rowsBySid.get(sid);
    const status = classifyCoveragePartition({ naturalMonth: monthOfDate(date), refreshedAtMs: row.refreshedAtMs, nowPacific: now });
    return STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst;
  }, "fresh");
}

function coveragePlan(scope, repository, currentMs, requestId) {
  const rows = repository.readCoverage(scope, { requestId });
  const byDate = new Map(scope.dates.map((date) => [date, statusForRows({ scope, date, rows, now: currentMs })]));
  return { rows, byDate };
}

function feeCoveragePlan(scope, repository, currentMs, requestId) {
  if (typeof repository.readCustomFeeCoverage !== "function") return null;
  const months = [...new Set(scope.dates.map(monthOfDate))].sort();
  const rows = repository.readCustomFeeCoverage(scope, { requestId });
  const byMonth = new Map();
  for (const naturalMonth of months) {
    const monthRows = rows.filter((row) => row?.naturalMonth === naturalMonth);
    const rowsBySid = new Map(monthRows.map((row) => [Number(row.sid), row]));
    if (scope.sids.some((sid) => !rowsBySid.has(sid))) {
      byMonth.set(naturalMonth, "missing");
      continue;
    }
    byMonth.set(naturalMonth, scope.sids.reduce((worst, sid) => {
      const status = classifyCoveragePartition({
        naturalMonth,
        refreshedAtMs: rowsBySid.get(sid).refreshedAtMs,
        nowPacific: currentMs,
      });
      return STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst;
    }, "fresh"));
  }
  return { rows, byMonth };
}

function validateOrderResult(result, scope, dates) {
  if (!result || typeof result !== "object" || Array.isArray(result)
    || !Array.isArray(result.facts) || !Array.isArray(result.coverage)) {
    throw new SalesFactsContractError("OrderProfit 同步结果结构无效。", { code: "SALES_FACTS_SYNC_ORDER_RESULT_INVALID" });
  }
  const dateSet = new Set(dates);
  const sidSet = new Set(scope.sids);
  const expected = new Set();
  for (const date of dates) for (const sid of scope.sids) expected.add(`${date}|${sid}`);
  for (const fact of result.facts) {
    if (!dateSet.has(String(fact?.factDate)) || !sidSet.has(Number(fact?.sid)) || String(fact?.currencyMode).toUpperCase() !== scope.currencyMode) {
      throw new SalesFactsContractError("OrderProfit 事实超出请求范围。", { code: "SALES_FACTS_SCOPE_MISMATCH" });
    }
  }
  const seenCoverage = new Set();
  for (const row of result.coverage) {
    const key = `${String(row?.factDate)}|${Number(row?.sid)}`;
    if (!expected.has(key) || String(row?.currencyMode).toUpperCase() !== scope.currencyMode || seenCoverage.has(key)) {
      throw new SalesFactsContractError("OrderProfit coverage 超出请求范围或重复。", { code: "SALES_FACTS_SYNC_COVERAGE_INVALID" });
    }
    seenCoverage.add(key);
  }
  if (seenCoverage.size !== expected.size) {
    throw new SalesFactsContractError("OrderProfit coverage 不完整。", { code: "SALES_FACTS_SYNC_COVERAGE_INCOMPLETE" });
  }
  return { facts: result.facts, coverage: result.coverage, meta: result.meta || null };
}

function validateFeeResult(result, scope, naturalMonths) {
  if (!result || typeof result !== "object" || Array.isArray(result)
    || !Array.isArray(result.rows) || !Array.isArray(result.coverage)) {
    throw new SalesFactsContractError("自定义费用同步结果结构无效。", { code: "SALES_FACTS_SYNC_FEE_RESULT_INVALID" });
  }
  const monthSet = new Set(naturalMonths);
  const sidSet = new Set(scope.sids);
  const expected = new Set();
  for (const naturalMonth of naturalMonths) for (const sid of scope.sids) expected.add(`${naturalMonth}|${sid}`);
  const seen = new Set();
  for (const row of result.rows) {
    const key = `${String(row?.naturalMonth)}|${Number(row?.sid)}`;
    if (!monthSet.has(String(row?.naturalMonth)) || !sidSet.has(Number(row?.sid)) || String(row?.currencyMode).toUpperCase() !== scope.currencyMode) {
      throw new SalesFactsContractError("自定义费用超出请求范围。", { code: "SALES_FACTS_SCOPE_MISMATCH" });
    }
    const identity = `${key}|${String(row?.feeTypeId)}`;
    if (seen.has(identity)) throw new SalesFactsContractError("自定义费用身份重复。", { code: "SALES_FACTS_CUSTOM_FEE_DUPLICATE" });
    seen.add(identity);
  }
  const seenCoverage = new Set();
  for (const row of result.coverage) {
    const key = `${String(row?.naturalMonth)}|${Number(row?.sid)}`;
    if (!expected.has(key) || String(row?.currencyMode).toUpperCase() !== scope.currencyMode || seenCoverage.has(key)) {
      throw new SalesFactsContractError("自定义费用 coverage 超出请求范围或重复。", { code: "SALES_FACTS_SYNC_FEE_COVERAGE_INVALID" });
    }
    seenCoverage.add(key);
  }
  if (seenCoverage.size !== expected.size) {
    throw new SalesFactsContractError("自定义费用 coverage 不完整。", { code: "SALES_FACTS_SYNC_FEE_COVERAGE_INCOMPLETE" });
  }
  return { rows: result.rows, coverage: result.coverage, meta: result.meta || null };
}

function dedupeBy(items, keyOf) {
  const map = new Map();
  for (const item of items) map.set(keyOf(item), item);
  return [...map.values()];
}

function stampSourceTimestamp(items, fallbackMs, field = "sourceUpdatedAtMs") {
  return items.map((item) => ({
    ...item,
    [field]: item?.[field] !== null && item?.[field] !== undefined && item?.[field] !== ""
      && Number.isSafeInteger(Number(item[field])) ? Number(item[field]) : fallbackMs,
  }));
}

function factKey(item) {
  return `${item.factDate}|${Number(item.sid)}|${String(item.mskuKey).toLocaleLowerCase("en-US")}|${String(item.currencyMode).toUpperCase()}`;
}

function coverageKey(item) {
  return `${item.factDate}|${Number(item.sid)}|${String(item.currencyMode).toUpperCase()}`;
}

function feeKey(item) {
  return `${item.naturalMonth}|${Number(item.sid)}|${item.feeTypeId}|${String(item.currencyMode).toUpperCase()}`;
}

function makeBatchId(requestId, currentMs, sequence) {
  return `${requestId}-${currentMs.toString(36)}-${sequence}`;
}

function stateResult({ repository, scope, requestId, cacheState, currentMs, refreshedPartitionCount = 0, refreshedRangeCount = 0, revision = null, singleFlight = null }) {
  const facts = repository.readFacts(scope, { requestId });
  const coverage = repository.readCoverage(scope, { requestId });
  const latest = coverage.reduce((value, row) => Math.max(value, Number(row.refreshedAtMs) || 0), 0);
  const resolvedRevision = revision ?? repository.getRevisions({ requestId }).salesFactsRevision;
  return {
    facts,
    coverage,
    meta: {
      source: "sales-facts-sqlite",
      cacheState,
      updatedAt: latest ? new Date(latest).toISOString() : null,
      ageSeconds: latest && Number.isSafeInteger(currentMs) ? Math.max(0, Math.floor((currentMs - latest) / 1000)) : null,
      revision: resolvedRevision,
      requestId,
      scopeCount: { dates: scope.dates.length, sids: scope.sids.length },
      refreshedPartitionCount,
      refreshedRangeCount,
      ...(singleFlight ? { singleFlight } : {}),
    },
  };
}

export function createSalesFactsSyncService({ repository, upstream, now = Date.now, logger = console } = {}) {
  if (!repository
    || typeof repository.readCoverage !== "function"
    || typeof repository.readFacts !== "function"
    || typeof repository.getRevisions !== "function"
    || typeof repository.replaceOrderProfitScope !== "function") {
    throw new SalesFactsInputError("销售事实同步仓储接口无效。", { code: "SALES_FACTS_SYNC_REPOSITORY_INVALID" });
  }
  if (!upstream || typeof upstream.loadOrderProfitRange !== "function") {
    throw new SalesFactsInputError("销售事实上游接口无效。", { code: "SALES_FACTS_SYNC_UPSTREAM_INVALID" });
  }
  const inFlight = new Map();
  let sequence = 0;

  function runSingleFlight(scope, operation, requestId, callback) {
    const key = `${scope.rangeKey}|${operation}`;
    const existing = inFlight.get(key);
    if (existing) return existing.then((result) => ({ ...result, meta: { ...result.meta, singleFlight: "joiner", requestId } }));
    const promise = Promise.resolve().then(callback);
    inFlight.set(key, promise);
    promise.finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }).catch(() => {});
    return promise.then((result) => ({ ...result, meta: { ...result.meta, singleFlight: "owner", requestId } }));
  }

  async function refreshOrderProfitScope(inputScope, options = {}) {
    const scope = ensureScope(inputScope);
    const requestId = normalizeSalesFactsRequestId(options.requestId, { fallback: "sales-facts-order-profit" });
    return runSingleFlight(scope, "order-profit", requestId, async () => {
      const currentMs = nowMs(now);
      const force = options.force === true || options.forceRefresh === true;
      const plan = coveragePlan(scope, repository, currentMs, requestId);
      const staleDates = force
        ? [...scope.dates]
        : scope.dates.filter((date) => ["stale", "missing"].includes(plan.byDate.get(date)));
      const frozenMissing = scope.dates.filter((date) => plan.byDate.get(date) === "missing"
        && monthOfDate(date) !== monthKey(pacificMonth(currentMs))
        && monthOfDate(date) !== monthKey(previousMonth(pacificMonth(currentMs))));
      if (frozenMissing.length && !force) {
        const error = new SalesFactsContractError("历史冻结月份 coverage 缺失，必须显式强制刷新。", {
          code: "SALES_FACTS_FROZEN_COVERAGE_MISSING",
          details: { dateCount: frozenMissing.length, sidCount: scope.sids.length },
        });
        error.statusCode = 422;
        throw error;
      }
      if (!staleDates.length) {
        const frozen = [...plan.byDate.values()].every((status) => status === "frozen");
        const result = stateResult({ repository, scope, requestId, currentMs, cacheState: frozen ? "frozen" : "hit", revision: null });
        return result;
      }

      const segments = force ? [{ startDate: scope.dates[0], endDate: scope.dates.at(-1), dates: [...scope.dates] }] : makeSegments(staleDates);
      const fetchedFacts = [];
      const fetchedCoverage = [];
      for (const segment of segments) {
        log(logger, "info", "order-profit-fetch-start", { requestId, operation: "order-profit", dayCount: segment.dates.length, sidCount: scope.sids.length });
        const loaded = await (options.loadOrderProfitRange || upstream.loadOrderProfitRange)({
          startDate: segment.startDate,
          endDate: segment.endDate,
          sids: scope.sids,
          currencyMode: scope.currencyMode,
          requestId,
        });
        const validated = validateOrderResult(loaded, scope, segment.dates);
        const fetchedAtMs = nowMs(now);
        fetchedFacts.push(...stampSourceTimestamp(validated.facts, fetchedAtMs));
        fetchedCoverage.push(...stampSourceTimestamp(validated.coverage, fetchedAtMs));
      }
      const refreshedDateSet = new Set(staleDates);
      const existingFacts = repository.readFacts(scope, { requestId }).filter((item) => !refreshedDateSet.has(item.factDate));
      const existingCoverage = repository.readCoverage(scope, { requestId }).filter((item) => !refreshedDateSet.has(item.factDate));
      const facts = dedupeBy([...existingFacts, ...fetchedFacts], factKey);
      const coverage = dedupeBy([...existingCoverage, ...fetchedCoverage], coverageKey);
      const expectedCoverage = scope.dates.length * scope.sids.length;
      if (coverage.length !== expectedCoverage) {
        throw new SalesFactsContractError("销售事实范围 coverage 合并后不完整。", { code: "SALES_FACTS_SYNC_COVERAGE_INCOMPLETE" });
      }
      const refreshedAtMs = nowMs(now);
      const refreshBatchId = makeBatchId(requestId, refreshedAtMs, ++sequence);
      log(logger, "info", "order-profit-commit-start", { requestId, operation: "order-profit", refreshedPartitionCount: staleDates.length, sidCount: scope.sids.length });
      const commit = repository.replaceOrderProfitScope({ scope, facts, coverage, refreshedAtMs, refreshBatchId, requestId });
      log(logger, "info", "order-profit-commit-success", { requestId, operation: "order-profit", refreshedPartitionCount: staleDates.length, revision: commit?.salesFactsRevision ?? null });
      const result = stateResult({ repository, scope, requestId, currentMs: refreshedAtMs, cacheState: "refreshed", refreshedPartitionCount: staleDates.length, refreshedRangeCount: segments.length, revision: commit?.salesFactsRevision ?? null });
      return result;
    });
  }

  async function refreshMonthlyReportScope(inputScope, options = {}) {
    const scope = ensureScope(inputScope);
    if (typeof repository.replaceMonthlyReportScope !== "function"
      || typeof repository.readCustomFees !== "function"
      || typeof repository.readCustomFeeCoverage !== "function"
      || (typeof options.loadCustomFees !== "function" && typeof upstream.loadCustomFeesByMonth !== "function")) {
      throw new SalesFactsInputError("销售事实月报同步接口不完整。", { code: "SALES_FACTS_SYNC_MONTHLY_INTERFACE_INVALID" });
    }
    const requestId = normalizeSalesFactsRequestId(options.requestId, { fallback: "sales-facts-monthly" });
    return runSingleFlight(scope, "monthly-report", requestId, async () => {
      const currentMs = nowMs(now);
      const force = options.force === true || options.forceRefresh === true;
      const plan = coveragePlan(scope, repository, currentMs, requestId);
      const feePlan = feeCoveragePlan(scope, repository, currentMs, requestId);
      const staleDates = force ? [...scope.dates] : scope.dates.filter((date) => ["stale", "missing"].includes(plan.byDate.get(date)));
      const feeMonths = [...new Set(scope.dates.map(monthOfDate))].sort();
      const staleFeeMonths = force || !feePlan
        ? (staleDates.length ? [...new Set(staleDates.map(monthOfDate))] : [])
        : feeMonths.filter((naturalMonth) => ["stale", "missing"].includes(feePlan.byMonth.get(naturalMonth)));
      const frozenMissing = scope.dates.filter((date) => plan.byDate.get(date) === "missing"
        && monthOfDate(date) !== monthKey(pacificMonth(currentMs))
        && monthOfDate(date) !== monthKey(previousMonth(pacificMonth(currentMs))));
      const frozenFeeMissing = feePlan
        ? feeMonths.filter((naturalMonth) => feePlan.byMonth.get(naturalMonth) === "missing"
          && naturalMonth !== monthKey(pacificMonth(currentMs))
          && naturalMonth !== monthKey(previousMonth(pacificMonth(currentMs))))
        : [];
      if ((frozenMissing.length || frozenFeeMissing.length) && !force) {
        throw new SalesFactsContractError("历史冻结月份 coverage 缺失，必须显式强制刷新。", {
          code: "SALES_FACTS_FROZEN_COVERAGE_MISSING",
          details: { dateCount: frozenMissing.length, monthCount: frozenFeeMissing.length, sidCount: scope.sids.length },
        });
      }
      if (!staleDates.length && !staleFeeMonths.length) {
        const frozen = [...plan.byDate.values()].every((status) => status === "frozen")
          && (!feePlan || [...feePlan.byMonth.values()].every((status) => status === "frozen"));
        const order = stateResult({ repository, scope, requestId, currentMs, cacheState: frozen ? "frozen" : "hit", revision: null });
        return {
          ...order,
          customFees: repository.readCustomFees(scope, { requestId }),
          customFeeCoverage: feePlan?.rows || [],
          meta: { ...order.meta, operation: "monthly-report" },
        };
      }
      const segments = force ? [{ startDate: scope.dates[0], endDate: scope.dates.at(-1), dates: [...scope.dates] }] : makeSegments(staleDates);
      const fetchedFacts = [];
      const fetchedCoverage = [];
      for (const segment of segments) {
        const loaded = await (options.loadOrderProfitRange || upstream.loadOrderProfitRange)({
          startDate: segment.startDate,
          endDate: segment.endDate,
          sids: scope.sids,
          currencyMode: scope.currencyMode,
          requestId,
        });
        const validated = validateOrderResult(loaded, scope, segment.dates);
        const fetchedAtMs = nowMs(now);
        fetchedFacts.push(...stampSourceTimestamp(validated.facts, fetchedAtMs));
        fetchedCoverage.push(...stampSourceTimestamp(validated.coverage, fetchedAtMs));
      }
      const monthsToFetch = [...new Set(staleFeeMonths)].sort();
      const feeResult = monthsToFetch.length
        ? validateFeeResult(
          await (options.loadCustomFees || upstream.loadCustomFeesByMonth)({
            naturalMonths: monthsToFetch,
            sids: scope.sids,
            currencyMode: scope.currencyMode,
            requestId,
          }),
          scope,
          monthsToFetch,
        )
        : { rows: [], coverage: [], meta: null };
      const fetchedAtMs = nowMs(now);
      const stampedFeeRows = stampSourceTimestamp(feeResult.rows, fetchedAtMs);
      const refreshedDateSet = new Set(staleDates);
      const existingFacts = repository.readFacts(scope, { requestId }).filter((item) => !refreshedDateSet.has(item.factDate));
      const existingCoverage = repository.readCoverage(scope, { requestId }).filter((item) => !refreshedDateSet.has(item.factDate));
      const facts = dedupeBy([...existingFacts, ...fetchedFacts], factKey);
      const coverage = dedupeBy([...existingCoverage, ...fetchedCoverage], coverageKey);
      const existingFees = repository.readCustomFees(scope, { requestId }).filter((item) => !monthsToFetch.includes(item.naturalMonth));
      const customFees = dedupeBy([...existingFees, ...stampedFeeRows], feeKey);
      const existingFeeCoverage = feePlan?.rows.filter((item) => !monthsToFetch.includes(item.naturalMonth)) || [];
      const customFeeCoverage = dedupeBy([...existingFeeCoverage, ...feeResult.coverage], (item) => `${item.naturalMonth}|${Number(item.sid)}|${String(item.currencyMode).toUpperCase()}`);
      if (feePlan && customFeeCoverage.length !== feeMonths.length * scope.sids.length) {
        throw new SalesFactsContractError("月报自定义费用 coverage 合并后不完整。", { code: "SALES_FACTS_SYNC_FEE_COVERAGE_INCOMPLETE" });
      }
      if (!feePlan && monthsToFetch.length !== feeMonths.length) {
        throw new SalesFactsContractError("月报缺少自定义费用 coverage 读取能力，无法安全合并范围。", { code: "SALES_FACTS_SYNC_FEE_COVERAGE_INTERFACE_INVALID" });
      }
      if (coverage.length !== scope.dates.length * scope.sids.length) {
        throw new SalesFactsContractError("月报销售事实 coverage 合并后不完整。", { code: "SALES_FACTS_SYNC_COVERAGE_INCOMPLETE" });
      }
      const refreshedAtMs = nowMs(now);
      const refreshBatchId = makeBatchId(requestId, refreshedAtMs, ++sequence);
      const commit = repository.replaceMonthlyReportScope({
        scope,
        facts,
        coverage,
        customFees,
        customFeeCoverage,
        refreshedAtMs,
        refreshBatchId,
        requestId,
      });
      const base = stateResult({ repository, scope, requestId, currentMs: refreshedAtMs, cacheState: "refreshed", refreshedPartitionCount: staleDates.length, refreshedRangeCount: segments.length, revision: commit?.salesFactsRevision ?? null });
      return {
        ...base,
        customFees: repository.readCustomFees(scope, { requestId }),
        customFeeCoverage: repository.readCustomFeeCoverage(scope, { requestId }),
        meta: { ...base.meta, operation: "monthly-report" },
      };
    });
  }

  return { refreshOrderProfitScope, refreshMonthlyReportScope };
}

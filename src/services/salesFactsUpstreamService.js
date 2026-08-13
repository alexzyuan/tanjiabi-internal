import {
  normalizeSalesFactsScope,
  normalizeSalesFactsRequestId,
  SalesFactsConflictError,
  SalesFactsContractError,
  SalesFactsInputError,
  SalesFactsUpstreamError,
} from "./salesFactsIdentity.js";
import { normalizeOrderProfitRows } from "./salesFactsOrderProfitValidator.js";

const ORDER_PROFIT_ENDPOINT = "/basicOpen/finance/mreport/OrderProfit";
const SELLER_PROFIT_ENDPOINT = "/bd/profit/report/open/report/seller/list";
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const TEMPORARY_NETWORK_CODES = new Set(["TIMEOUT", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);
const TEMPORARY_RATE_LIMIT_CODES = new Set(["LIMIT", "RATE_LIMIT", "TOO_MANY_REQUESTS", "REQUEST_TOO_FREQUENT"]);
const SAFE_CONTROLLED_CODE_PATTERN = /^(?:SALES_FACTS|SELLER_PROFIT)_[A-Z0-9_]+$/u;
const SENSITIVE_CODE_PATTERN = /(?:AUTHORIZATION|BODY|COOKIE|CREDENTIAL|PASSWORD|PAYLOAD|SECRET|SIGNATURE|TOKEN)/u;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/u;

function log(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, `[sales-facts-upstream] ${event}`, details);
}

function safeNow(now) {
  const value = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SalesFactsInputError("销售事实上游时间无效。", { code: "SALES_FACTS_UPSTREAM_NOW_INVALID" });
  }
  return value;
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (TEMPORARY_NETWORK_CODES.has(code) || TEMPORARY_RATE_LIMIT_CODES.has(code)) return code;
  if (SAFE_CONTROLLED_CODE_PATTERN.test(code) && !SENSITIVE_CODE_PATTERN.test(code)) return code;
  const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
  return status === 429 ? "HTTP_429" : "UPSTREAM_REQUEST_FAILED";
}

function safeErrorName(error) {
  if (error instanceof SalesFactsInputError) return "SalesFactsInputError";
  if (error instanceof SalesFactsContractError) return "SalesFactsContractError";
  if (error instanceof SalesFactsConflictError) return "SalesFactsConflictError";
  return "SalesFactsUpstreamError";
}

function isTemporaryFailure(error) {
  if (error instanceof SalesFactsInputError
    || error instanceof SalesFactsContractError
    || error instanceof SalesFactsConflictError) return false;
  const code = String(error?.code || "").trim().toUpperCase();
  const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
  return TEMPORARY_NETWORK_CODES.has(code) || TEMPORARY_RATE_LIMIT_CODES.has(code) || status === 429;
}

function retryAfterHeader(error) {
  const headers = error?.response?.headers || error?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get("retry-after");
  return headers["retry-after"] ?? headers["Retry-After"];
}

function retryAfterDelay(error, nowMs) {
  const explicit = Number(error?.retryAfterMs);
  if (Number.isSafeInteger(explicit) && explicit >= 0) return Math.min(explicit, MAX_RETRY_DELAY_MS);
  const header = retryAfterHeader(error);
  if (header === undefined || header === null || String(header).trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_DELAY_MS);
  const dateMs = Date.parse(String(header));
  return Number.isFinite(dateMs) ? Math.min(Math.max(0, dateMs - nowMs), MAX_RETRY_DELAY_MS) : null;
}

function backoffDelay(attempt, random) {
  const base = 200 * (2 ** (attempt - 1));
  const randomValue = Number(typeof random === "function" ? random() : 0);
  const jitter = Number.isFinite(randomValue) && randomValue >= 0 && randomValue <= 1
    ? Math.floor(base * 0.25 * randomValue)
    : 0;
  return Math.min(base + jitter, MAX_RETRY_DELAY_MS);
}

async function withRetry({ operation, endpoint, requestId, date, logger, sleep, random, now }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTemporaryFailure(error) || attempt >= MAX_ATTEMPTS) throw error;
      const delayMs = retryAfterDelay(error, safeNow(now)) ?? backoffDelay(attempt, random);
      log(logger, "warn", "retry", {
        requestId,
        endpoint,
        attempt,
        delayMs,
        errorCode: safeErrorCode(error),
        date,
      });
      await sleep(delayMs);
    }
  }
  throw new Error("unreachable");
}

function controlledUpstreamError(error, { endpoint, requestId, operation }) {
  if (error instanceof SalesFactsInputError
    || error instanceof SalesFactsContractError
    || error instanceof SalesFactsConflictError
    || error instanceof SalesFactsUpstreamError) return error;
  return new SalesFactsUpstreamError(undefined, {
    code: safeErrorCode(error),
    details: { endpoint, requestId, operation },
    cause: error,
  });
}

function canonicalMonth(value) {
  const text = String(value || "").trim();
  const match = MONTH_PATTERN.exec(text);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || year < 1 || month < 1 || month > 12) {
    throw new SalesFactsInputError("销售事实自然月无效。", { code: "SALES_FACTS_MONTH_INVALID" });
  }
  return text;
}

function monthEnd(naturalMonth) {
  const [year, month] = naturalMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function normalizeScopeInput({ startDate, endDate, sids, currencyMode, sellers, now }) {
  return normalizeSalesFactsScope({
    startDate,
    endDate,
    sids,
    currencyMode,
    sellerDirectory: sellers,
    now: new Date(safeNow(now)),
  });
}

function safePaginationEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new SalesFactsContractError("销售事实分页证据结构无效。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  const integerFields = ["pageIndex", "offset", "pageRowCount", "cumulativeRowCount"];
  if (integerFields.some((key) => !Number.isSafeInteger(Number(evidence[key])) || Number(evidence[key]) < 0)) {
    throw new SalesFactsContractError("销售事实分页证据数值无效。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  const declaredTotal = evidence.declaredTotal === null ? null : Number(evidence.declaredTotal);
  if (declaredTotal !== null && (!Number.isSafeInteger(declaredTotal) || declaredTotal < 0)) {
    throw new SalesFactsContractError("销售事实分页 total 无效。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  return {
    pageIndex: Number(evidence.pageIndex),
    offset: Number(evidence.offset),
    pageRowCount: Number(evidence.pageRowCount),
    cumulativeRowCount: Number(evidence.cumulativeRowCount),
    declaredTotal,
    hasNext: evidence.hasNext === true ? true : evidence.hasNext === false ? false : null,
    terminalReason: evidence.terminalReason === null ? null : String(evidence.terminalReason || ""),
    complete: evidence.complete === true,
    safetyLimitHit: evidence.safetyLimitHit === true,
  };
}

function validatePaginationEvidence(evidenceRows, rawRowCount) {
  if (!evidenceRows.length) {
    throw new SalesFactsContractError("销售事实缺少分页终态证据。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_MISSING" });
  }
  const complete = evidenceRows.filter((row) => row.complete);
  if (complete.length === 0) {
    throw new SalesFactsContractError("销售事实分页未完整结束。", { code: "SALES_FACTS_PAGINATION_INCOMPLETE" });
  }
  if (complete.length !== 1 || complete[0] !== evidenceRows.at(-1)) {
    throw new SalesFactsContractError("销售事实分页终态证据不唯一。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  let expectedOffset = 0;
  let declaredTotal = null;
  for (const [index, row] of evidenceRows.entries()) {
    const isTerminal = index === evidenceRows.length - 1;
    if (row.pageIndex !== index + 1
      || row.offset !== expectedOffset
      || row.cumulativeRowCount !== row.offset + row.pageRowCount
      || (!isTerminal && (row.complete || row.terminalReason || row.safetyLimitHit))) {
      throw new SalesFactsContractError("销售事实分页证据序列无效。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
    }
    if (row.declaredTotal !== null) {
      if (declaredTotal !== null && row.declaredTotal !== declaredTotal) {
        throw new SalesFactsContractError("销售事实分页 total 前后不一致。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
      }
      declaredTotal = row.declaredTotal;
    }
    expectedOffset = row.cumulativeRowCount;
  }
  const terminal = complete[0];
  if (terminal.safetyLimitHit || !terminal.terminalReason) {
    throw new SalesFactsContractError("销售事实分页未完整结束。", { code: "SALES_FACTS_PAGINATION_INCOMPLETE" });
  }
  if (terminal.cumulativeRowCount !== rawRowCount
    || (terminal.declaredTotal !== null && terminal.declaredTotal !== rawRowCount)
    || terminal.hasNext === true) {
    throw new SalesFactsContractError("销售事实分页证据与结果矛盾。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  const terminalValid = (terminal.terminalReason === "total-exhausted"
      && terminal.declaredTotal !== null
      && terminal.cumulativeRowCount === terminal.declaredTotal)
    || (terminal.terminalReason === "has-next-false"
      && terminal.declaredTotal === null
      && terminal.hasNext === false)
    || (terminal.terminalReason === "empty-page"
      && terminal.declaredTotal === null
      && terminal.hasNext === null
      && terminal.pageRowCount === 0)
    || (terminal.terminalReason === "short-page"
      && terminal.declaredTotal === null
      && terminal.hasNext === null
      && terminal.pageRowCount > 0);
  if (!terminalValid) {
    throw new SalesFactsContractError("销售事实分页终止原因与证据矛盾。", { code: "SALES_FACTS_PAGINATION_EVIDENCE_INVALID" });
  }
  return { pageCount: terminal.pageIndex, rowCount: rawRowCount };
}

function extractRows(adapter, payload) {
  if (typeof adapter?.normalizeRecordList !== "function") {
    throw new SalesFactsInputError("领星 adapter 缺少 records normalizer。", { code: "SALES_FACTS_ADAPTER_INVALID" });
  }
  const rows = adapter.normalizeRecordList(payload);
  if (!Array.isArray(rows)) {
    throw new SalesFactsContractError("领星 records 结果无效。", { code: "SALES_FACTS_ROWS_INVALID" });
  }
  return rows;
}

function feeAmountFixed(value) {
  const text = String(value ?? "").trim().replace(/,/gu, "");
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/u.exec(text);
  if (!match) throw new SalesFactsContractError("自定义费用金额无效。", { code: "SALES_FACTS_CUSTOM_FEE_AMOUNT_INVALID" });
  const fraction = match[3] || "";
  if (fraction.replace(/0+$/u, "").length > 4) {
    throw new SalesFactsContractError("自定义费用金额精度超过 4 位。", { code: "SALES_FACTS_CUSTOM_FEE_PRECISION_INVALID" });
  }
  const units = BigInt(match[2]) * 10000n + BigInt(fraction.slice(0, 4).padEnd(4, "0") || "0");
  return match[1] === "-" ? -units : units;
}

function normalizeFeeRows(rows, { naturalMonth, scope }) {
  const sidSet = new Set(scope.sids);
  const normalized = rows.map((row) => {
    const sid = Number(row?.sid);
    if (!Number.isInteger(sid) || !sidSet.has(sid)) {
      throw new SalesFactsContractError("自定义费用引用未知 SID。", { code: "SALES_FACTS_UNKNOWN_SID" });
    }
    const feeTypeId = String(row?.other_fee_type_id ?? "").trim();
    const feeName = String(row?.other_fee_type ?? "").trim();
    if (!feeTypeId || !feeName) {
      throw new SalesFactsContractError("自定义费用类型缺失。", { code: "SALES_FACTS_CUSTOM_FEE_TYPE_MISSING" });
    }
    const sourceCurrency = String(row?.currencyCode || row?.currency_code || "").trim().toUpperCase();
    const actualCurrencyCode = scope.currencyMode === "CNY" ? "CNY" : sourceCurrency;
    if (!actualCurrencyCode) {
      throw new SalesFactsContractError("原币自定义费用缺少实际币种。", { code: "SALES_FACTS_ACTUAL_CURRENCY_MISSING" });
    }
    if (scope.currencyMode === "CNY" && sourceCurrency && sourceCurrency !== "CNY") {
      throw new SalesFactsConflictError("CNY 自定义费用返回非 CNY 币种。", { code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT" });
    }
    return {
      naturalMonth,
      sid,
      feeTypeId,
      feeName,
      feeAmount: feeAmountFixed(row?.fee),
      currencyMode: scope.currencyMode,
      actualCurrencyCode,
    };
  });
  const currencyByIdentity = new Map();
  for (const row of normalized) {
    const key = `${row.naturalMonth}|${row.sid}|${row.feeTypeId}|${row.currencyMode}`;
    const existing = currencyByIdentity.get(key);
    if (existing !== undefined && existing !== row.actualCurrencyCode) {
      throw new SalesFactsConflictError("同一自定义费用身份出现多个实际币种。", { code: "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT" });
    }
    if (existing !== undefined) {
      throw new SalesFactsConflictError("自定义费用批次包含重复身份。", { code: "SALES_FACTS_DUPLICATE_CUSTOM_FEE" });
    }
    currencyByIdentity.set(key, row.actualCurrencyCode);
  }
  return normalized;
}

export function createSalesFactsUpstreamService({
  adapter,
  sellers = [],
  logger = console,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  random = Math.random,
  now = Date.now,
} = {}) {
  if (!adapter || typeof adapter !== "object") {
    throw new SalesFactsInputError("销售事实上游 adapter 无效。", { code: "SALES_FACTS_ADAPTER_INVALID" });
  }

  async function loadOrderProfitRange({
    startDate,
    endDate,
    sids,
    currencyMode = "CNY",
    fetchMode = "daily",
    requestId = "",
  } = {}) {
    requestId = normalizeSalesFactsRequestId(requestId);
    const startedAtMs = safeNow(now);
    try {
      if (fetchMode !== "daily") {
        throw new SalesFactsInputError("销售事实运行时只允许逐日同步。", { code: "SALES_FACTS_RUNTIME_FETCH_MODE_INVALID" });
      }
      if (typeof adapter.fetchMskuOrderProfit !== "function") {
        throw new SalesFactsInputError("领星 adapter 缺少未缓存 OrderProfit loader。", { code: "SALES_FACTS_ADAPTER_INVALID" });
      }
      const scope = normalizeScopeInput({ startDate, endDate, sids, currencyMode, sellers, now });
      log(logger, "info", "order-profit-start", { requestId, endpoint: ORDER_PROFIT_ENDPOINT, dayCount: scope.dates.length, sidCount: scope.sids.length, fetchMode: "daily" });
      const facts = [];
      const coverage = [];
      let pageCount = 0;
      for (const factDate of scope.dates) {
        const attemptResult = await withRetry({
          endpoint: ORDER_PROFIT_ENDPOINT,
          requestId,
          date: factDate,
          logger,
          sleep,
          random,
          now,
          operation: async () => {
            const evidence = [];
            const payload = await adapter.fetchMskuOrderProfit({
              startDate: factDate,
              endDate: factDate,
              sids: scope.sids,
              currencyCode: scope.currencyMode,
            }, {
              onPagination: (row) => evidence.push(safePaginationEvidence(row)),
              retryTokenExpired: false,
            });
            const rawRows = extractRows(adapter, payload);
            const pagination = validatePaginationEvidence(evidence, rawRows.length);
            const dayFacts = normalizeOrderProfitRows(rawRows, {
              requestedDateRange: { startDate: factDate, endDate: factDate },
              currencyMode: scope.currencyMode,
              sellers,
              allowRequestedDateFallback: true,
            });
            const requestedSids = new Set(scope.sids);
            if (dayFacts.some((fact) => !requestedSids.has(fact.sid))) {
              throw new SalesFactsContractError("OrderProfit 行超出请求 SID 范围。", { code: "SALES_FACTS_SCOPE_MISMATCH" });
            }
            return { dayFacts, pagination };
          },
        });
        facts.push(...attemptResult.dayFacts);
        pageCount += attemptResult.pagination.pageCount;
        for (const sid of scope.sids) {
          coverage.push({
            factDate,
            sid,
            currencyMode: scope.currencyMode,
            rowCount: attemptResult.dayFacts.filter((row) => row.sid === sid).length,
            pageCount: attemptResult.pagination.pageCount,
          });
        }
      }
      const meta = { source: "lingxing-order-profit", fetchMode: "daily", requestId, dayCount: scope.dates.length, sidCount: scope.sids.length, factCount: facts.length, pageCount };
      log(logger, "info", "order-profit-success", { ...meta, elapsedMs: Math.max(0, safeNow(now) - startedAtMs) });
      return { facts, coverage, meta };
    } catch (error) {
      const normalized = controlledUpstreamError(error, { endpoint: ORDER_PROFIT_ENDPOINT, requestId, operation: "load-order-profit-range" });
      log(logger, "error", "order-profit-failure", { requestId, endpoint: ORDER_PROFIT_ENDPOINT, errorCode: safeErrorCode(normalized), errorName: safeErrorName(normalized), elapsedMs: Math.max(0, safeNow(now) - startedAtMs) });
      throw normalized;
    }
  }

  async function loadCustomFeesByMonth({
    naturalMonths,
    sids,
    currencyMode = "CNY",
    requestId = "",
  } = {}) {
    requestId = normalizeSalesFactsRequestId(requestId);
    const startedAtMs = safeNow(now);
    try {
      if (typeof adapter.fetchSellerProfitReport !== "function"
        || typeof adapter.normalizeSellerProfitOtherFeeRecords !== "function") {
        throw new SalesFactsInputError("领星 adapter 缺少店铺利润费用 loader。", { code: "SALES_FACTS_ADAPTER_INVALID" });
      }
      const months = [...new Set((Array.isArray(naturalMonths) ? naturalMonths : []).map(canonicalMonth))].sort();
      if (!months.length) throw new SalesFactsInputError("销售事实自然月范围不能为空。", { code: "SALES_FACTS_MONTH_SCOPE_EMPTY" });
      const scope = normalizeScopeInput({
        startDate: `${months[0]}-01`,
        endDate: monthEnd(months.at(-1)),
        sids,
        currencyMode,
        sellers,
        now,
      });
      log(logger, "info", "custom-fees-start", { requestId, endpoint: SELLER_PROFIT_ENDPOINT, monthCount: months.length, sidCount: scope.sids.length });
      const rows = [];
      const coverage = [];
      let pageCount = 0;
      for (const naturalMonth of months) {
        const attemptResult = await withRetry({
          endpoint: SELLER_PROFIT_ENDPOINT,
          requestId,
          date: naturalMonth,
          logger,
          sleep,
          random,
          now,
          operation: async () => {
            const evidence = [];
            const payload = await adapter.fetchSellerProfitReport({
              startDate: naturalMonth,
              endDate: naturalMonth,
              sids: scope.sids,
              currencyCode: scope.currencyMode,
              monthlyQuery: true,
              summaryEnabled: true,
            }, {
              onPagination: (row) => evidence.push(safePaginationEvidence(row)),
              retryTokenExpired: false,
            });
            const rawRows = extractRows(adapter, payload);
            const pagination = validatePaginationEvidence(evidence, rawRows.length);
            const normalizedSourceRows = adapter.normalizeSellerProfitOtherFeeRecords(rawRows, sellers, naturalMonth);
            if (!Array.isArray(normalizedSourceRows)) {
              throw new SalesFactsContractError("店铺利润费用 normalizer 返回无效。", { code: "SALES_FACTS_CUSTOM_FEE_ROWS_INVALID" });
            }
            return { feeRows: normalizeFeeRows(normalizedSourceRows, { naturalMonth, scope }), pagination };
          },
        });
        rows.push(...attemptResult.feeRows);
        pageCount += attemptResult.pagination.pageCount;
        for (const sid of scope.sids) {
          coverage.push({
            naturalMonth,
            sid,
            currencyMode: scope.currencyMode,
            rowCount: attemptResult.feeRows.filter((row) => row.sid === sid).length,
            pageCount: attemptResult.pagination.pageCount,
          });
        }
      }
      const meta = { source: "lingxing-seller-profit-other-fee", requestId, monthCount: months.length, sidCount: scope.sids.length, rowCount: rows.length, pageCount };
      log(logger, "info", "custom-fees-success", { ...meta, elapsedMs: Math.max(0, safeNow(now) - startedAtMs) });
      return { rows, coverage, meta };
    } catch (error) {
      const normalized = controlledUpstreamError(error, { endpoint: SELLER_PROFIT_ENDPOINT, requestId, operation: "load-custom-fees-by-month" });
      log(logger, "error", "custom-fees-failure", { requestId, endpoint: SELLER_PROFIT_ENDPOINT, errorCode: safeErrorCode(normalized), errorName: safeErrorName(normalized), elapsedMs: Math.max(0, safeNow(now) - startedAtMs) });
      throw normalized;
    }
  }

  return { loadOrderProfitRange, loadCustomFeesByMonth };
}

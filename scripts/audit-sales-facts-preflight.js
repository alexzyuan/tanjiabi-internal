import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLingxingAdapter } from "../src/adapters/lingxingAdapter.js";
import { auditAllListingOwners } from "../src/services/listingOwnerHistoryService.js";
import { SalesFactsContractError, normalizeSalesFactsScope } from "../src/services/salesFactsIdentity.js";
import {
  compareMonthlyAndDailyFacts,
  normalizeOrderProfitRows,
} from "../src/services/salesFactsOrderProfitValidator.js";
import { getSellerDirectory } from "../src/services/sellerDirectoryService.js";
import { normalizeRecordList } from "../src/utils/recordAccess.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

function safeRequestId(value) {
  const text = String(value || "").trim();
  return REQUEST_ID_PATTERN.test(text) && !/(token|secret|password|payload|raw|body)/iu.test(text)
    ? text
    : `sales-facts-owner-audit-${randomUUID()}`;
}

function hasAuditFailure(counts = {}) {
  return Number(counts.multiple || 0) > 0
    || Number(counts.malformed || 0) > 0
    || Number(counts.failedSidCount || 0) > 0
    || Number(counts.paginationIncomplete || 0) > 0;
}

function controlledFailure(requestId, code) {
  return {
    ok: false,
    exitCode: 1,
    requestId,
    error: { code },
  };
}

export async function runSalesFactsOwnerAuditCli({
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  auditOwners = auditAllListingOwners,
  requestId: suppliedRequestId = "",
  writeOutput = (text) => process.stdout.write(`${text}\n`),
} = {}) {
  const requestId = safeRequestId(suppliedRequestId);
  let sellers;
  try {
    const directory = await getDirectory({
      adapter,
      forceRefresh: true,
      saveCache: async () => {},
      logger: { info() {}, error() {} },
    });
    sellers = directory.sellers;
  } catch {
    const failure = controlledFailure(requestId, "SELLER_DIRECTORY_FAILED");
    writeOutput(JSON.stringify(failure));
    return failure;
  }

  let audit;
  try {
    audit = await auditOwners({ sellers, adapter, requestId });
  } catch {
    const failure = controlledFailure(requestId, "LISTING_OWNER_AUDIT_FAILED");
    writeOutput(JSON.stringify(failure));
    return failure;
  }
  const failed = hasAuditFailure(audit.counts);
  const report = {
    ok: !failed,
    exitCode: failed ? 1 : 0,
    requestId,
    sellerCount: Number(audit.sellerCount || 0),
    sidCount: Number(audit.sidCount || 0),
    rowCount: Number(audit.rowCount || 0),
    pageCount: Number(audit.pageCount || 0),
    counts: { ...audit.counts },
    anomalies: Array.isArray(audit.anomalies) ? audit.anomalies : [],
    failedSids: Array.isArray(audit.failedSids) ? audit.failedSids : [],
  };
  writeOutput(JSON.stringify(report));
  return report;
}

function requiredPreflightInput(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function listDates(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error("invalid preflight range");
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function isCompleteNaturalMonth(startDate, endDate, dates) {
  if (!/^\d{4}-\d{2}-01$/u.test(startDate) || startDate.slice(0, 7) !== endDate.slice(0, 7)) return false;
  const [year, month] = startDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return endDate === `${startDate.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` && dates.length === lastDay;
}

function preflightInputs(env) {
  const startDate = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_START_DATE");
  const endDate = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_END_DATE");
  const sidTokens = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_SIDS").split(",");
  if (sidTokens.some((token) => !/^[1-9]\d*$/u.test(token.trim()))) throw new Error("invalid preflight SID");
  const sids = sidTokens.map((token) => Number(token.trim()));
  if (sids.some((sid) => !Number.isSafeInteger(sid))) throw new Error("invalid preflight SID");
  const currencyMode = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_CURRENCY_MODE").toUpperCase();
  if (!sids.length || !["CNY", "ORIGINAL"].includes(currencyMode)) throw new Error("invalid preflight scope");
  const dates = listDates(startDate, endDate);
  if (!isCompleteNaturalMonth(startDate, endDate, dates)) throw new Error("preflight range must be a complete natural month");
  return { startDate, endDate, dates, sids: [...new Set(sids)].sort((a, b) => a - b), currencyMode };
}

async function defaultLoadOrderProfitRange({ adapter, startDate, endDate, sids, currencyMode, onPagination }) {
  const payload = await adapter.fetchMskuOrderProfit(
    { startDate, endDate, sids, currencyCode: currencyMode },
    { onPagination },
  );
  return normalizeRecordList(payload);
}

const COMPLETE_PAGINATION_REASONS = new Set([
  "total-exhausted",
  "has-next-false",
  "empty-page",
  "short-page",
]);

function paginationEvidenceError(code) {
  const error = new SalesFactsContractError("OrderProfit 分页证据不完整。", { code });
  error.operation = "order-profit-pagination-validation";
  return error;
}

function safePaginationEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
  }
  const pageIndex = Number(event.pageIndex);
  const offset = Number(event.offset);
  const pageRowCount = Number(event.pageRowCount);
  const cumulativeRowCount = Number(event.cumulativeRowCount);
  const declaredTotal = event.declaredTotal === null ? null : Number(event.declaredTotal);
  const hasNext = event.hasNext === null ? null : event.hasNext;
  const terminalReason = event.terminalReason === null ? null : String(event.terminalReason || "");
  if (!Number.isInteger(pageIndex) || pageIndex < 1
    || !Number.isInteger(offset) || offset < 0
    || !Number.isInteger(pageRowCount) || pageRowCount < 0
    || !Number.isInteger(cumulativeRowCount) || cumulativeRowCount < 0
    || (declaredTotal !== null && (!Number.isInteger(declaredTotal) || declaredTotal < 0))
    || (hasNext !== null && typeof hasNext !== "boolean")
    || typeof event.complete !== "boolean"
    || typeof event.safetyLimitHit !== "boolean") {
    throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
  }
  return {
    pageIndex,
    offset,
    pageRowCount,
    cumulativeRowCount,
    declaredTotal,
    hasNext,
    terminalReason,
    complete: event.complete,
    safetyLimitHit: event.safetyLimitHit,
  };
}

function validatePaginationEvidence(events) {
  if (!events.length) throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_MISSING");
  const final = events.at(-1);
  if (!final.complete || final.safetyLimitHit) {
    throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INCOMPLETE");
  }
  if (!COMPLETE_PAGINATION_REASONS.has(final.terminalReason)
    || events.slice(0, -1).some((event) => event.complete || event.terminalReason !== null || event.safetyLimitHit)) {
    throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
  }
  let cumulative = 0;
  let declaredTotal = null;
  for (const [index, event] of events.entries()) {
    if (event.pageIndex !== index + 1 || event.offset !== cumulative) {
      throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
    }
    cumulative += event.pageRowCount;
    if (event.cumulativeRowCount !== cumulative) {
      throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
    }
    if (event.declaredTotal !== null) {
      if (declaredTotal !== null && event.declaredTotal !== declaredTotal) {
        throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
      }
      declaredTotal = event.declaredTotal;
      if (cumulative > declaredTotal
        || (event.hasNext === false && cumulative < declaredTotal)
        || (event.hasNext === true && cumulative >= declaredTotal)) {
        throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
      }
    }
  }
  if ((final.terminalReason === "total-exhausted"
      && (final.declaredTotal === null || final.cumulativeRowCount !== final.declaredTotal || final.hasNext === true))
    || (final.terminalReason === "has-next-false" && final.hasNext !== false)
    || (final.terminalReason === "empty-page" && final.pageRowCount !== 0)) {
    throw paginationEvidenceError("SALES_FACTS_PAGINATION_EVIDENCE_INVALID");
  }
  return {
    pageCount: events.length,
    hasDeclaredTotal: events.some((event) => event.declaredTotal !== null),
    hasHasNext: events.some((event) => event.hasNext !== null),
    terminalReason: final.terminalReason,
    complete: final.complete,
    safetyLimitHit: final.safetyLimitHit,
  };
}

async function loadRangeWithPaginationEvidence(loadRange, params) {
  const events = [];
  let rows;
  let loadError = null;
  try {
    rows = await loadRange({
      ...params,
      onPagination: (event) => events.push(safePaginationEvent(event)),
    });
  } catch (error) {
    loadError = error;
  }
  if (events.length || !loadError) {
    const evidence = validatePaginationEvidence(events);
    if (loadError) throw loadError;
    return { rows, evidence };
  }
  throw loadError;
}

function aggregatePaginationEvidence(requests) {
  const terminalReasonCounts = {};
  for (const request of requests) {
    terminalReasonCounts[request.terminalReason] = (terminalReasonCounts[request.terminalReason] || 0) + 1;
  }
  return {
    requestCount: requests.length,
    pageCount: requests.reduce((total, request) => total + request.pageCount, 0),
    requestsWithDeclaredTotal: requests.filter((request) => request.hasDeclaredTotal).length,
    requestsWithHasNext: requests.filter((request) => request.hasHasNext).length,
    terminalReasonCounts,
    incompleteRequestCount: requests.filter((request) => !request.complete).length,
    safetyLimitHitCount: requests.filter((request) => request.safetyLimitHit).length,
  };
}

function safePreflightFailure(requestId, code) {
  return { ok: false, exitCode: 1, requestId, error: { code } };
}

function safeValidationFailure(requestId, error, operation = "order-profit-validation") {
  const errorName = String(error?.name || "Error");
  const code = String(error?.code || "");
  const statusCode = Number(error?.statusCode);
  const safeName = /^(?:Error|SalesFacts(?:Input|Contract|Conflict|Upstream)Error)$/u.test(errorName)
    ? errorName
    : "Error";
  const safeCode = /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)
    && !/(TOKEN|SECRET|PASSWORD|PAYLOAD|RAW|BODY)/u.test(code)
    ? code
    : "SALES_FACTS_PREFLIGHT_VALIDATION_FAILED";
  return {
    ok: false,
    exitCode: 1,
    requestId,
    error: {
      operation,
      errorName: safeName,
      code: safeCode,
      statusCode: Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 502,
    },
  };
}

export async function runSalesFactsOrderProfitPreflightCli({
  env = process.env,
  adapter = getLingxingAdapter(),
  getDirectory = getSellerDirectory,
  loadRange = defaultLoadOrderProfitRange,
  requestId: suppliedRequestId = "",
  writeOutput = (text) => process.stdout.write(`${text}\n`),
} = {}) {
  const requestId = safeRequestId(suppliedRequestId);
  let scope;
  try {
    scope = preflightInputs(env);
  } catch {
    const failure = safePreflightFailure(requestId, "SALES_FACTS_PREFLIGHT_INPUT_INVALID");
    writeOutput(JSON.stringify(failure));
    return failure;
  }
  let sellers;
  try {
    ({ sellers } = await getDirectory({ adapter, forceRefresh: true, saveCache: async () => {}, logger: { info() {}, error() {} } }));
  } catch {
    const failure = safePreflightFailure(requestId, "SELLER_DIRECTORY_FAILED");
    writeOutput(JSON.stringify(failure));
    return failure;
  }
  try {
    scope = normalizeSalesFactsScope({
      startDate: scope.startDate,
      endDate: scope.endDate,
      sids: scope.sids,
      currencyMode: scope.currencyMode,
      sellerDirectory: sellers,
    });
  } catch (error) {
    const failure = safeValidationFailure(requestId, error, "sales-facts-scope-validation");
    writeOutput(JSON.stringify(failure));
    return failure;
  }

  try {
    const paginationEvidence = [];
    const monthlyResult = await loadRangeWithPaginationEvidence(loadRange, {
      adapter,
      startDate: scope.startDate,
      endDate: scope.endDate,
      sids: scope.sids,
      currencyMode: scope.currencyMode,
      requestId,
      requestKind: "monthly",
    });
    const monthlyRaw = monthlyResult.rows;
    paginationEvidence.push(monthlyResult.evidence);
    const dailyRaw = [];
    const dailyRows = [];
    for (const factDate of scope.dates) {
      const dayResult = await loadRangeWithPaginationEvidence(loadRange, {
        adapter,
        startDate: factDate,
        endDate: factDate,
        sids: scope.sids,
        currencyMode: scope.currencyMode,
        requestId,
        requestKind: "daily",
      });
      const dayRaw = dayResult.rows;
      paginationEvidence.push(dayResult.evidence);
      dailyRaw.push(...dayRaw);
      try {
        dailyRows.push(...normalizeOrderProfitRows(dayRaw, {
          requestedDateRange: { startDate: factDate, endDate: factDate },
          currencyMode: scope.currencyMode,
          sellers,
          allowRequestedDateFallback: true,
        }));
      } catch (error) {
        const failure = safeValidationFailure(requestId, error, "order-profit-daily-validation");
        writeOutput(JSON.stringify(failure));
        return failure;
      }
    }
    let monthlyRows = [];
    let monthlyValidationCode = null;
    try {
      monthlyRows = normalizeOrderProfitRows(monthlyRaw, {
        requestedDateRange: scope,
        currencyMode: scope.currencyMode,
        sellers,
        allowRequestedDateFallback: false,
      });
    } catch (error) {
      monthlyValidationCode = safeValidationFailure(requestId, error).error.code;
    }
    const comparison = monthlyValidationCode
      ? {
        approvedFetchMode: "daily",
        monthlyFactCount: 0,
        dailyFactCount: dailyRows.length,
        identityCount: 0,
        identityMismatchCount: 0,
        metricMismatchCount: 0,
        mismatches: [],
      }
      : compareMonthlyAndDailyFacts({ monthlyRows, dailyRows });
    const report = {
      ok: true,
      exitCode: 0,
      requestId,
      startDate: scope.startDate,
      endDate: scope.endDate,
      sidCount: scope.sids.length,
      currencyMode: scope.currencyMode,
      monthlyRequestCount: 1,
      dailyRequestCount: scope.dates.length,
      monthlyRowCount: monthlyRaw.length,
      dailyRowCount: dailyRaw.length,
      dailyValidationComplete: true,
      actualPagination: aggregatePaginationEvidence(paginationEvidence),
      ...(monthlyValidationCode ? { monthlyValidationCode } : {}),
      ...comparison,
    };
    writeOutput(JSON.stringify(report));
    return report;
  } catch (error) {
    const failure = safeValidationFailure(requestId, error, error?.operation || "order-profit-fetch");
    writeOutput(JSON.stringify(failure));
    return failure;
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  const result = process.argv.includes("--owners")
    ? await runSalesFactsOwnerAuditCli()
    : await runSalesFactsOrderProfitPreflightCli();
  process.exitCode = result.exitCode;
}

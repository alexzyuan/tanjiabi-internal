import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLingxingAdapter } from "../src/adapters/lingxingAdapter.js";
import { auditAllListingOwners } from "../src/services/listingOwnerHistoryService.js";
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

function preflightInputs(env) {
  const startDate = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_START_DATE");
  const endDate = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_END_DATE");
  const sids = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_SIDS")
    .split(",")
    .map(Number)
    .filter((sid) => Number.isInteger(sid) && sid > 0);
  const currencyMode = requiredPreflightInput(env, "SALES_FACTS_PREFLIGHT_CURRENCY_MODE").toUpperCase();
  if (!sids.length || !["CNY", "ORIGINAL"].includes(currencyMode)) throw new Error("invalid preflight scope");
  const dates = listDates(startDate, endDate);
  return { startDate, endDate, dates, sids: [...new Set(sids)].sort((a, b) => a - b), currencyMode };
}

async function defaultLoadOrderProfitRange({ adapter, startDate, endDate, sids, currencyMode }) {
  const payload = await adapter.fetchMskuOrderProfit({
    startDate,
    endDate,
    sids,
    currencyCode: currencyMode,
  });
  return normalizeRecordList(payload);
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
  if (scope.sids.some((sid) => !sellers.some((seller) => Number(seller.sid) === sid))) {
    const failure = safePreflightFailure(requestId, "SALES_FACTS_PREFLIGHT_UNKNOWN_SID");
    writeOutput(JSON.stringify(failure));
    return failure;
  }

  try {
    const monthlyRaw = await loadRange({
      adapter,
      startDate: scope.startDate,
      endDate: scope.endDate,
      sids: scope.sids,
      currencyMode: scope.currencyMode,
      requestId,
      requestKind: "monthly",
    });
    const dailyRaw = [];
    const dailyRows = [];
    for (const factDate of scope.dates) {
      const dayRaw = await loadRange({
        adapter,
        startDate: factDate,
        endDate: factDate,
        sids: scope.sids,
        currencyMode: scope.currencyMode,
        requestId,
        requestKind: "daily",
      });
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
      ...(monthlyValidationCode ? { monthlyValidationCode } : {}),
      ...comparison,
    };
    writeOutput(JSON.stringify(report));
    return report;
  } catch (error) {
    const failure = safeValidationFailure(requestId, error, "order-profit-fetch");
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

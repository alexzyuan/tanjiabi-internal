import { readFileSync } from "node:fs";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be ${String(expected)}`);
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function requireZero(value, label) {
  if (value !== 0) throw new Error(`${label} must be zero`);
}

/**
 * Validate the exact read-only OrderProfit preflight report accepted by deploy.sh.
 * This is deliberately stricter than a truthy ok/exitCode check: missing evidence
 * must fail closed instead of being interpreted as zero.
 */
export function validateSalesFactsPreflightArtifact(report) {
  if (!isPlainObject(report)) throw new Error("preflight report must be an object");
  requireExact(report.ok, true, "ok");
  requireExact(report.exitCode, 0, "exitCode");
  requireExact(report.approvedFetchMode, "daily", "approved fetch mode");
  requireExact(report.dailyValidationComplete, true, "daily validation completeness");

  const monthlyRequestCount = requireNonNegativeInteger(report.monthlyRequestCount, "monthly request count");
  const dailyRequestCount = requireNonNegativeInteger(report.dailyRequestCount, "daily request count");
  const sidCount = requireNonNegativeInteger(report.sidCount, "SID count");
  if (monthlyRequestCount !== 1) throw new Error("monthly request count must be one");
  if (dailyRequestCount < 1) throw new Error("daily request count must be positive");
  if (sidCount < 1) throw new Error("SID count must be positive");

  requireZero(report.identityMismatchCount, "identity mismatch count");
  requireZero(report.metricMismatchCount, "metric mismatch count");

  if (!isPlainObject(report.actualPagination)) throw new Error("pagination evidence is required");
  const pagination = report.actualPagination;
  const requestCount = requireNonNegativeInteger(pagination.requestCount, "pagination request count");
  requireNonNegativeInteger(pagination.pageCount, "pagination page count");
  requireZero(pagination.incompleteRequestCount, "pagination completeness count");
  requireZero(pagination.safetyLimitHitCount, "pagination safety limit count");
  if (requestCount !== monthlyRequestCount + dailyRequestCount) {
    throw new Error("pagination request count does not match requested modes");
  }
  return true;
}

export function validateSalesFactsPreflightArtifactFile(filePath) {
  let report;
  try {
    report = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("preflight report is not valid JSON");
  }
  return validateSalesFactsPreflightArtifact(report);
}

const scriptPath = process.argv[1] || "";
if (scriptPath.endsWith("validate-sales-facts-preflight-artifact.js")) {
  try {
    const filePath = process.argv[2];
    if (!filePath) throw new Error("preflight report path is required");
    validateSalesFactsPreflightArtifactFile(filePath);
    process.stdout.write(JSON.stringify({ ok: true }) + "\n");
  } catch {
    process.stderr.write("销售事实预检 artifact 未通过结构和零差异门禁。\n");
    process.exitCode = 1;
  }
}

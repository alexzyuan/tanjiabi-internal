import { safeQuickCheckDiagnostic } from "./safeQuickCheckDiagnostic.js";

const SAFE_HEALTH_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SENSITIVE_HEALTH_CODE = /(token|secret|password|payload|raw|body|path|stack|message)/iu;

function safeHealthCode(value) {
  const code = String(value ?? "").trim();
  return SAFE_HEALTH_CODE.test(code) && !SENSITIVE_HEALTH_CODE.test(code)
    ? code
    : "SALES_FACTS_HEALTH_ERROR";
}

function safeHealthNumber(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

export function sanitizeSalesFactsHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: "degraded", schemaVersion: null, quickCheck: "unavailable", error: "SALES_FACTS_HEALTH_INVALID" };
  }
  const ok = value.ok === true && value.status !== "degraded";
  const quickCheck = safeQuickCheckDiagnostic(value.quickCheck);
  const result = { ok, status: ok ? "healthy" : "degraded", schemaVersion: safeHealthNumber(value.schemaVersion), quickCheck };
  if (!ok) result.error = safeHealthCode(value.error);
  for (const field of [
    "salesFactsRevision", "ownerRevision", "dailyFactCount", "factCoverageCount", "customFeeCount",
    "customFeeCoverageCount", "ownerPeriodCount", "derivedCacheCount", "schemaMigrationCount", "databaseBytes", "walBytes",
    "lastOrderProfitSyncAtMs", "lastCustomFeeSyncAtMs", "lastOwnerSyncAtMs",
  ]) {
    const number = safeHealthNumber(value[field]);
    if (number !== null) result[field] = number;
  }
  if (value.fetchMode === "daily") result.fetchMode = "daily";
  return result;
}

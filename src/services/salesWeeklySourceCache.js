import { addDaysToDateText } from "../utils/lingxingDateRange.js";

export const SALES_WEEKLY_SOURCE_CACHE_VERSION = "sales-weekly-source-v3";
const LEGACY_SALES_WEEKLY_SOURCE_CACHE_VERSIONS = new Set(["sales-weekly-source-v2"]);

export function validateSalesWeeklySourceCache(source, expectedScope) {
  const reasons = [];
  if (!source || typeof source !== "object") {
    reasons.push("source cache data is required");
    return { ok: false, reasons };
  }
  if (source.cacheScope?.version !== expectedScope?.version) {
    reasons.push("cache scope version does not match");
  }
  if (!Array.isArray(source.recent30OrderProfitRecords)) {
    reasons.push("recent30OrderProfitRecords must be an array");
  }
  const recent30 = source.raw?.recent30;
  if (!recent30 || typeof recent30 !== "object") {
    reasons.push("raw.recent30 metadata is required");
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recent30.startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(recent30.endDate || ""))) {
      reasons.push("raw.recent30 requires valid date boundaries");
    }
    if (!Number.isFinite(Number(recent30.recordCount)) || Number(recent30.recordCount) < 0) {
      reasons.push("raw.recent30 recordCount must be non-negative");
    }
    const expectedEndDate = expectedScope?.endDate || "";
    const expectedStartDate = expectedEndDate ? addDaysToDateText(expectedEndDate, -29) : "";
    if (recent30.startDate !== expectedStartDate || recent30.endDate !== expectedEndDate) {
      reasons.push("raw.recent30 date range does not match the requested end date");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function migrateSalesWeeklySourceCache(source, expectedScope) {
  const sourceVersion = source?.cacheScope?.version;
  if (!LEGACY_SALES_WEEKLY_SOURCE_CACHE_VERSIONS.has(sourceVersion)) return null;

  const migrated = {
    ...source,
    cacheScope: {
      ...source.cacheScope,
      ...expectedScope,
      version: SALES_WEEKLY_SOURCE_CACHE_VERSION,
    },
  };
  const validation = validateSalesWeeklySourceCache(migrated, expectedScope);
  if (!validation.ok) return null;
  return { data: migrated, migratedFrom: sourceVersion };
}

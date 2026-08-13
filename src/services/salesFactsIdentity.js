export const SALES_FACTS_CURRENCY_MODES = Object.freeze(["CNY", "ORIGINAL"]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

export class SalesFactsError extends Error {
  constructor(message, { name = "SalesFactsError", statusCode = 500, code, details = null, cause } = {}) {
    super(message, { cause });
    this.name = name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class SalesFactsInputError extends SalesFactsError {
  constructor(message, options = {}) {
    super(message, { ...options, name: "SalesFactsInputError", statusCode: 400 });
  }
}

export class SalesFactsConflictError extends SalesFactsError {
  constructor(message, options = {}) {
    super(message, { ...options, name: "SalesFactsConflictError", statusCode: 409 });
  }
}

export class SalesFactsContractError extends SalesFactsError {
  constructor(message, options = {}) {
    super(message, { ...options, name: "SalesFactsContractError", statusCode: 422 });
  }
}

export class SalesFactsUpstreamError extends SalesFactsError {
  constructor(message = "销售事实上游服务失败。", options = {}) {
    super(message, { ...options, name: "SalesFactsUpstreamError", statusCode: options.statusCode || 502 });
  }
}

export class SalesFactsDatabaseError extends SalesFactsError {
  constructor(message = "销售事实数据库不可用。", options = {}) {
    super(message, { ...options, name: "SalesFactsDatabaseError", statusCode: 503 });
  }
}

export function normalizeSalesFactsRequestId(value, { fallback = "sales-facts" } = {}) {
  const text = String(value || "").trim();
  if (REQUEST_ID_PATTERN.test(text) && !/(token|secret|password|payload|raw|body)/iu.test(text)) return text;
  return `${fallback}-${Date.now().toString(36)}`;
}

function parseDateParts(value) {
  const match = DATE_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, date };
}

function dateText(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function inclusiveDates(startDate, endDate) {
  const start = parseDateParts(startDate);
  const end = parseDateParts(endDate);
  if (!start || !end || start.date > end.date) {
    throw new SalesFactsInputError("销售事实日期范围无效。", { code: "SALES_FACTS_DATE_RANGE_INVALID" });
  }
  const dates = [];
  const cursor = new Date(start.date);
  while (cursor <= end.date) {
    dates.push(dateText(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pacificMonth(now) {
  const date = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
  if (Number.isNaN(date.getTime())) {
    throw new SalesFactsInputError("销售事实当前时间无效。", { code: "SALES_FACTS_NOW_INVALID" });
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find(({ type }) => type === "year")?.value);
  const month = Number(parts.find(({ type }) => type === "month")?.value);
  return { year, month };
}

function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function monthText({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthClasses(dates, now) {
  const current = pacificMonth(now);
  const previous = previousMonth(current);
  return [...new Set(dates.map((date) => date.slice(0, 7)))].map((naturalMonth) => ({
    naturalMonth,
    classification: naturalMonth === monthText(current)
      ? "current"
      : naturalMonth === monthText(previous) ? "previous" : "frozen",
  }));
}

function isActiveSeller(seller) {
  const status = seller?.status;
  if (status === undefined || status === null || status === "") return true;
  if (Number(status) === 1) return true;
  return ["active", "enabled", "正常", "启用"].includes(String(status).trim().toLocaleLowerCase("en-US"));
}

function sellerCountryCode(seller) {
  return String(seller?.countryCode ?? seller?.country_code ?? seller?.marketplaceCode ?? seller?.country ?? "")
    .trim()
    .toUpperCase();
}

export function normalizeSalesFactsScope({
  startDate,
  endDate,
  sids,
  currencyMode = "CNY",
  sellerDirectory,
  now,
} = {}) {
  const dates = inclusiveDates(startDate, endDate);
  const normalizedMode = String(currencyMode || "").trim().toUpperCase();
  if (!SALES_FACTS_CURRENCY_MODES.includes(normalizedMode)) {
    throw new SalesFactsInputError("销售事实币种模式无效。", { code: "SALES_FACTS_CURRENCY_MODE_INVALID" });
  }
  const normalizedSids = [...new Set((Array.isArray(sids) ? sids : []).map(Number))]
    .filter((sid) => Number.isInteger(sid) && sid > 0)
    .sort((left, right) => left - right);
  if (!normalizedSids.length) {
    throw new SalesFactsInputError("销售事实范围至少需要一个 SID。", { code: "SALES_FACTS_SCOPE_EMPTY" });
  }
  const sellerBySid = new Map((Array.isArray(sellerDirectory) ? sellerDirectory : [])
    .filter(isActiveSeller)
    .map((seller) => [Number(seller?.sid ?? seller?.seller_id ?? seller?.sellerId), seller])
    .filter(([sid]) => Number.isInteger(sid) && sid > 0));
  const unknownSids = normalizedSids.filter((sid) => !sellerBySid.has(sid));
  if (unknownSids.length) {
    throw new SalesFactsInputError("销售事实范围包含未知或停用 SID。", {
      code: "SALES_FACTS_UNKNOWN_SID",
      details: { unknownSidCount: unknownSids.length },
    });
  }
  const countries = [...new Set(normalizedSids.map((sid) => sellerCountryCode(sellerBySid.get(sid))).filter(Boolean))];
  if (normalizedMode === "ORIGINAL" && countries.length !== 1) {
    throw new SalesFactsContractError("原币模式只允许单一国家范围。", {
      code: "SALES_FACTS_ORIGINAL_SCOPE_INVALID",
      details: { countryCount: countries.length },
    });
  }
  return {
    startDate: dates[0],
    endDate: dates.at(-1),
    dates,
    sids: normalizedSids,
    currencyMode: normalizedMode,
    countryCode: countries.length === 1 ? countries[0] : "",
    rangeKey: `${dates[0]}|${dates.at(-1)}|${normalizedSids.join(",")}|${normalizedMode}`,
    monthClasses: monthClasses(dates, now),
  };
}

export { sanitizeSalesFactsHealth } from "../src/utils/salesFactsHealth.js";

const MAX_BODY_BYTES = 256 * 1024;
const ALLOWED_STATUS_CODES = new Set([400, 409, 413, 422, 502, 503, 504]);
const BODY_FIELDS = new Set(["startDate", "endDate", "sids", "currencyMode", "forceRefresh"]);
const OWNER_BODY_FIELDS = new Set(["detectedDate"]);
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SENSITIVE = /(token|secret|password|payload|raw|body|path|stack|message)/iu;

function requestIdFrom(value, fallback = "sales-facts-route") {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(text) && !SENSITIVE.test(text) ? text : fallback;
}

function requestIdForRequest(req, operation) {
  const headers = req?.headers || {};
  const supplied = headers["x-request-id"] || headers["X-Request-Id"] || "";
  return requestIdFrom(supplied, `sales-facts-${String(operation).replace(/[^A-Za-z0-9]+/gu, "-")}`);
}

function safeCode(value) {
  const text = String(value || "").trim();
  return SAFE_CODE.test(text) && !SENSITIVE.test(text) ? text : "SALES_FACTS_OPERATION_FAILED";
}

function countDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return Object.fromEntries(Object.entries(details)
    .filter(([key, value]) => /count$/iu.test(key) && Number.isSafeInteger(Number(value)) && Number(value) >= 0)
    .map(([key, value]) => [key, Number(value)]));
}

function routeBodyError(message, details = null) {
  const error = new Error(message);
  error.name = "SalesFactsRouteInputError";
  error.statusCode = 400;
  error.code = "SALES_FACTS_ROUTE_BODY_INVALID";
  error.details = details;
  return error;
}

function validateBody(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw routeBodyError("销售事实请求体必须是对象。");
  const unknown = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknown.length) throw routeBodyError("销售事实请求体包含未允许字段。", { unknownFieldCount: unknown.length });
  const result = {};
  for (const key of allowedFields) if (Object.hasOwn(body, key)) result[key] = body[key];
  if (Object.hasOwn(result, "sids") && (!Array.isArray(result.sids) || result.sids.some((sid) => !Number.isSafeInteger(Number(sid)) || Number(sid) <= 0))) {
    throw routeBodyError("销售事实 SID 范围无效。");
  }
  if (Object.hasOwn(result, "forceRefresh") && result.forceRefresh !== true) throw routeBodyError("forceRefresh 只能显式为 true。");
  if (Object.hasOwn(result, "currencyMode") && !["CNY", "ORIGINAL"].includes(String(result.currencyMode).trim().toUpperCase())) throw routeBodyError("销售事实币种无效。");
  return result;
}

export function serializeSalesFactsError(error, endpoint = "sales-facts") {
  const statusCode = ALLOWED_STATUS_CODES.has(Number(error?.statusCode)) ? Number(error.statusCode) : 503;
  const details = error?.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {};
  const requestId = requestIdFrom(details.requestId || error?.requestId);
  const operation = requestIdFrom(details.operation || endpoint, "sales-facts-operation");
  const code = safeCode(error?.code);
  return {
    statusCode,
    payload: {
      ok: false,
      error: "销售事实操作失败。",
      operation,
      code,
      requestId,
      counts: countDetails(details),
    },
    log: {
      endpoint,
      statusCode,
      operation,
      code,
      requestId,
    },
  };
}

async function readBody(readJsonBody, req) {
  if (typeof readJsonBody !== "function") throw new TypeError("sales facts route requires readJsonBody");
  return readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
}

export function createSalesFactsRoutes({
  readJsonBody,
  sendJson,
  refreshOrderProfitScope,
  refreshMonthlyReportScope,
  syncListingOwnerHistory,
} = {}) {
  const run = (operation, allowedFields, service) => ({
    method: "POST",
    path: `/api/sales-facts/${operation}`,
    auth: operation === "monthly-report/refresh" ? "finance" : operation === "owners/sync" ? "admin" : "session",
    serializeError: serializeSalesFactsError,
    handler: async ({ req, res }) => {
      const body = validateBody(await readBody(readJsonBody, req), allowedFields);
      if (typeof service !== "function") throw routeBodyError("销售事实服务未配置。", { operation });
      const result = await service(body, { requestId: requestIdForRequest(req, operation) });
      sendJson(res, 200, { ok: true, operation, result });
    },
  });
  return [
    run("order-profit/refresh", BODY_FIELDS, refreshOrderProfitScope),
    run("monthly-report/refresh", BODY_FIELDS, refreshMonthlyReportScope),
    run("owners/sync", OWNER_BODY_FIELDS, syncListingOwnerHistory),
  ];
}

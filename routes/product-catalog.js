const ALLOWED_REFRESH_FEATURES = new Set([
  "supplier-board",
  "factory-inventory",
  "fba-catalog",
  "fba-freight",
]);

export const PRODUCT_CATALOG_REFRESH_MAX_BODY_BYTES = 256 * 1024;
export const PRODUCT_CATALOG_REFRESH_PATH = "/api/product-catalog/refresh";

const SAFE_META_FIELDS = {
  requestId: "string",
  revision: "number",
  refreshRequestedCount: "number",
  refreshCommittedCount: "number",
  joinedInFlight: "boolean",
  transactionDurationMs: "number",
  listingFetchedCount: "number",
  productFetchedCount: "number",
  listingBatchCount: "number",
  listingRequestCount: "number",
  productLookupBatchCount: "number",
  productInfoRequestCount: "number",
  productFallbackRequestCount: "number",
  listingSharedXlsxCount: "number",
  sharedListingItems: "number",
  migrationCompleted: "boolean",
  catalogRevisionBeforeRefresh: "number",
  elapsedMs: "number",
};

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const SENSITIVE_VALUE_PATTERN = /(token|secret|password|payload|raw|body)/iu;
const SAFE_API_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SAFE_PRODUCT_CATALOG_OPERATIONS = new Set([
  "scope-normalization",
  "seller-directory",
  "legacy-migration",
  "repository-bootstrap",
  "resolution",
  "listing-fetch",
  "listing-shared-xlsx-read",
  "product-fetch",
  "catalog-commit",
  "manual-refresh",
  "initial-fill",
  "catalog-refresh",
]);

function invalidRequest(message = "商品目录刷新请求无效。") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "PRODUCT_CATALOG_INVALID_REQUEST";
  return error;
}

function safeRequestId(value) {
  const candidate = String(value ?? "");
  return SAFE_REQUEST_ID_PATTERN.test(candidate) && !SENSITIVE_VALUE_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

function safeApiCode(value) {
  const code = String(value ?? "");
  return SAFE_API_CODE_PATTERN.test(code) && !SENSITIVE_VALUE_PATTERN.test(code)
    ? code
    : undefined;
}

function safeProductCatalogErrorDetails(error) {
  const source = error?.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? error.details
    : {};
  const details = {};
  const requestId = safeRequestId(source.requestId);
  const code = safeApiCode(error?.code || source.code);
  if (requestId) details.requestId = requestId;
  if (code) details.code = code;
  for (const field of [
    "operation",
    "unknownSidCount",
    "unresolvedCount",
    "conflictCount",
    "refreshRequestedCount",
    "refreshCommittedCount",
    "migrationCompleted",
    "catalogRevisionBeforeRefresh",
  ]) {
    const value = source[field];
    if (field === "operation" && SAFE_PRODUCT_CATALOG_OPERATIONS.has(value)) details[field] = value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) details[field] = value;
    if (typeof value === "boolean") details[field] = value;
  }
  return Object.keys(details).length ? details : null;
}

function validApiStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : null;
}

export function serializeProductCatalogError(error, endpoint = PRODUCT_CATALOG_REFRESH_PATH) {
  const statusCode = validApiStatusCode(error?.statusCode) || 500;
  const errorByStatus = {
    400: "商品目录刷新请求无效。",
    409: "商品目录刷新发生冲突。",
    413: "商品目录刷新请求体过大。",
    422: "商品目录资料未解析。",
    502: "商品目录上游服务失败。",
    503: "商品目录服务暂不可用。",
    504: "商品目录上游服务超时。",
  };
  const details = safeProductCatalogErrorDetails(error);
  return {
    statusCode,
    payload: {
      ok: false,
      error: errorByStatus[statusCode] || "商品目录服务失败。",
      details,
      endpoint: PRODUCT_CATALOG_REFRESH_PATH,
    },
    log: {
      endpoint: PRODUCT_CATALOG_REFRESH_PATH,
      operation: "refresh",
      statusCode,
      errorCode: safeApiCode(error?.code) || "PRODUCT_CATALOG_REFRESH_ERROR",
      ...(details || {}),
    },
  };
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const output = {};
  for (const [field, type] of Object.entries(SAFE_META_FIELDS)) {
    const value = meta[field];
    if (value === undefined || value === null) continue;
    if (type === "string") {
      const requestId = field === "requestId" ? safeRequestId(value) : String(value);
      if (requestId !== undefined && requestId.length <= 128) output[field] = requestId;
      continue;
    }
    if (typeof value === type && (type !== "number" || Number.isFinite(value))) output[field] = value;
  }
  return output;
}

function refreshInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest();
  if (typeof body.feature !== "string" || !ALLOWED_REFRESH_FEATURES.has(body.feature)) {
    throw invalidRequest("商品目录刷新 feature 无效。");
  }
  if (!Array.isArray(body.items)) throw invalidRequest("商品目录刷新 items 无效。");
  return {
    feature: body.feature,
    items: body.items.map((item) => ({
      sid: item?.sid,
      msku: item?.msku,
    })),
  };
}

export function createProductCatalogRoutes({
  readJsonBody,
  sendJson,
  refreshProductCatalogScope,
} = {}) {
  return [
    {
      method: "POST",
      path: PRODUCT_CATALOG_REFRESH_PATH,
      auth: "session",
      serializeError: serializeProductCatalogError,
      handler: async ({ req, res }) => {
        let body;
        try {
          body = await readJsonBody(req, { maxBytes: PRODUCT_CATALOG_REFRESH_MAX_BODY_BYTES });
        } catch (error) {
          if (validApiStatusCode(error?.statusCode)) throw error;
          throw invalidRequest();
        }
        const input = refreshInput(body);
        const result = await refreshProductCatalogScope(input);
        sendJson(res, 200, {
          ok: result?.ok === true,
          meta: safeMeta(result?.meta),
        });
      },
    },
  ];
}

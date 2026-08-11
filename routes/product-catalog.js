const ALLOWED_REFRESH_FEATURES = new Set([
  "supplier-board",
  "factory-inventory",
  "fba-catalog",
  "fba-freight",
]);

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
      path: "/api/product-catalog/refresh",
      auth: "session",
      handler: async ({ req, res }) => {
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
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

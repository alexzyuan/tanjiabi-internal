import { performance } from "node:perf_hooks";

import {
  normalizeSalesFactsDate,
  normalizeSalesFactsRequestId,
  SalesFactsConflictError,
  SalesFactsContractError,
  SalesFactsInputError,
} from "./salesFactsIdentity.js";

const DERIVED_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CURRENCY_MODES = new Set(["CNY", "ORIGINAL"]);

// This registry is deliberately explicit. New dashboard DTO fields must be added here
// (or passed through payloadKeys) before they can be persisted in SQLite.
export const SALES_DERIVED_PAYLOAD_KEYS = Object.freeze(new Set([
  "rows", "summary", "summaryRows", "meta", "insights", "kpis", "siteRows", "miniMetrics",
  "trend", "adTrend", "acosTrend", "returnTrend", "trendLabels", "dailyRows", "storeData", "profitData",
  "detailRows", "filters", "ownerOptions", "source", "syncStatus", "updatedAt", "updatedAtMs", "periodText",
  "currencyText", "recent30", "title", "value", "left", "right", "progress", "tone", "name", "actual",
  "target", "rate", "count", "recordCount", "sid", "msku", "mskuKey", "storeName", "country", "countryCode",
  "listingOwner", "listingOwnerStatus", "listingOwnerIdentity", "listingOwnerPersonId", "listingOwnerIdentitySource",
  "amount", "quantity", "salesAmount", "salesQuantity", "totalSalesAmount", "totalSalesQuantity", "profit",
  "grossProfit", "netSalesAmount", "refundAmount", "refundRate30d", "fbaAvailableDays", "inventoryWarning",
  "inventoryRecordCount", "listingOwnerRecordCount", "cacheHit", "currencyMode", "startDate", "endDate",
  "sourceName", "status", "message", "key", "label", "valueText", "percent", "detail", "date", "day", "factDate", "reportDate", "currencyCode",
  "totalSalesQuantity", "multiChannelSalesQuantity", "totalAdsSales", "totalAdsSalesQuantity", "totalSalesAmount", "netSalesAmount", "grossProfit", "salesProfit", "buyerShippingFee", "promotionDiscount", "totalSalesRefunds", "returnQuantity", "refundsQuantity", "fbaInventoryCompensation", "otherIncome", "platformFee", "fbaDeliveryFee", "otherOrderFee", "storageFee", "totalAdsCost", "promotionFee", "fbaInternationalShippingFee", "inboundPlacementFee", "adjustmentFee", "otherPlatformFee", "purchaseCost", "firstLegCost", "otherProductCost", "purchaseUnitCost", "firstLegUnitCost", "storageFeeRate", "platformFeeRate", "fbaDeliveryFeeRate", "purchaseCostRate", "firstLegCostRate",
]));

function log(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, `[sales-derived-cache] ${event}`, details);
}

function safeNow(now) {
  const value = Number(typeof now === "function" ? now() : now);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SalesFactsInputError("销售派生缓存时间无效。", { code: "SALES_FACTS_DERIVED_NOW_INVALID" });
  }
  return value;
}

function text(value, message, code) {
  const result = String(value ?? "").trim();
  if (!result) throw new SalesFactsInputError(message, { code });
  return result;
}

function integer(value, message, code) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new SalesFactsContractError(message, { code });
  return result;
}

function canonicalScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)
    || !Array.isArray(scope.dates) || !scope.dates.length
    || !Array.isArray(scope.sids) || !scope.sids.length) {
    throw new SalesFactsInputError("销售派生缓存范围无效。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  }
  const dates = scope.dates.map((value) => normalizeSalesFactsDate(text(value, "销售派生缓存日期缺失。", "SALES_FACTS_DERIVED_SCOPE_INVALID")));
  if (dates.some((value) => !DATE_PATTERN.test(value)) || dates.some((value, index) => index > 0 && dates[index - 1] >= value)) {
    throw new SalesFactsInputError("销售派生缓存日期范围无效。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  }
  const sids = [...new Set(scope.sids.map(Number))].sort((left, right) => left - right);
  if (sids.some((sid) => !Number.isSafeInteger(sid) || sid <= 0)) {
    throw new SalesFactsInputError("销售派生缓存 SID 无效。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  }
  const currencyMode = text(scope.currencyMode, "销售派生缓存币种缺失。", "SALES_FACTS_DERIVED_SCOPE_INVALID").toUpperCase();
  if (!CURRENCY_MODES.has(currencyMode)) throw new SalesFactsInputError("销售派生缓存币种无效。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  const startDate = normalizeSalesFactsDate(text(scope.startDate || dates[0], "销售派生缓存起始日期缺失。", "SALES_FACTS_DERIVED_SCOPE_INVALID"));
  const endDate = normalizeSalesFactsDate(text(scope.endDate || dates.at(-1), "销售派生缓存结束日期缺失。", "SALES_FACTS_DERIVED_SCOPE_INVALID"));
  if (startDate !== dates[0] || endDate !== dates.at(-1)) {
    throw new SalesFactsInputError("销售派生缓存日期边界与 dates 不一致。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  }
  const rangeKey = `${startDate}|${endDate}|${sids.join(",")}|${currencyMode}`;
  if (String(scope.rangeKey || "") !== rangeKey) {
    throw new SalesFactsInputError("销售派生缓存 rangeKey 与范围不一致。", { code: "SALES_FACTS_DERIVED_SCOPE_INVALID" });
  }
  return { ...scope, startDate, endDate, dates, sids, currencyMode, rangeKey };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safePayloadError(message, details = null) {
  return new SalesFactsContractError(message, {
    code: "SALES_FACTS_DERIVED_PAYLOAD_INVALID",
    details,
  });
}

function validatePayload(value, { keys, path = "$", seen = new WeakSet() } = {}) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw safePayloadError("派生缓存 payload 包含非有限数字。", { path });
    return value;
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || value === undefined) {
    throw safePayloadError("派生缓存 payload 包含不可序列化值。", { path, type: typeof value });
  }
  if (typeof value !== "object") throw safePayloadError("派生缓存 payload 类型无效。", { path });
  if (seen.has(value)) throw safePayloadError("派生缓存 payload 存在循环引用。", { path });
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) => validatePayload(item, { keys, path: `${path}[${index}]`, seen }));
  } else {
    if (!isPlainObject(value)) throw safePayloadError("派生缓存 payload 禁止自定义 prototype。", { path });
    result = {};
    for (const key of Object.keys(value)) {
      if (!keys.has(key)) throw safePayloadError(`派生缓存 payload 字段未注册：${key}`, { path, key });
      result[key] = validatePayload(value[key], { keys, path: `${path}.${key}`, seen });
    }
  }
  seen.delete(value);
  return result;
}

function payloadKeys(extraKeys) {
  const keys = new Set(SALES_DERIVED_PAYLOAD_KEYS);
  for (const key of extraKeys || []) keys.add(text(key, "派生缓存 payload key 无效。", "SALES_FACTS_DERIVED_PAYLOAD_KEY_INVALID"));
  return keys;
}

function validateCacheEntry(cache, { cacheKey, keys }) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache) || cache.cacheKey !== cacheKey) {
    throw safePayloadError("派生缓存元数据无效。", { cacheKey });
  }
  const salesFactsRevision = integer(cache.salesFactsRevision, "派生缓存事实 revision 无效。", "SALES_FACTS_DERIVED_CACHE_INVALID");
  const ownerRevision = integer(cache.ownerRevision, "派生缓存负责人 revision 无效。", "SALES_FACTS_DERIVED_CACHE_INVALID");
  const generatedAtMs = integer(cache.generatedAtMs, "派生缓存生成时间无效。", "SALES_FACTS_DERIVED_CACHE_INVALID");
  const expiresAtMs = integer(cache.expiresAtMs, "派生缓存过期时间无效。", "SALES_FACTS_DERIVED_CACHE_INVALID");
  const mapperVersion = text(cache.mapperVersion, "派生缓存 mapper version 缺失。", "SALES_FACTS_DERIVED_CACHE_INVALID");
  if (expiresAtMs <= generatedAtMs) throw safePayloadError("派生缓存过期时间无效。", { cacheKey });
  const payload = validatePayload(cache.payload, { keys });
  return { cacheKey, payload, salesFactsRevision, ownerRevision, mapperVersion, generatedAtMs, expiresAtMs };
}

function revisions(repository, requestId) {
  if (typeof repository.getRevisions !== "function") throw new SalesFactsInputError("销售派生缓存缺少 revision 读取接口。", { code: "SALES_FACTS_DERIVED_REPOSITORY_INVALID" });
  const value = repository.getRevisions({ requestId });
  if (!value || typeof value !== "object") throw new SalesFactsContractError("销售事实 revision 结果无效。", { code: "SALES_FACTS_DERIVED_REVISION_INVALID" });
  return {
    salesFactsRevision: integer(value.salesFactsRevision, "事实 revision 无效。", "SALES_FACTS_DERIVED_REVISION_INVALID"),
    ownerRevision: integer(value.ownerRevision, "负责人 revision 无效。", "SALES_FACTS_DERIVED_REVISION_INVALID"),
  };
}

function cacheMeta({ cacheState, cache, revisionsValue, mapperVersion, scope, requestId, nowMs, singleFlight, timings }) {
  const updatedAtMs = cache?.generatedAtMs ?? nowMs;
  return {
    source: "sales-derived-cache",
    cacheState,
    updatedAt: new Date(updatedAtMs).toISOString(),
    ageSeconds: Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000)),
    revision: revisionsValue.salesFactsRevision,
    ownerRevision: revisionsValue.ownerRevision,
    mapperVersion,
    requestId,
    rangeKey: scope.rangeKey,
    startDate: scope.startDate,
    endDate: scope.endDate,
    currencyMode: scope.currencyMode,
    scopeCount: { dates: scope.dates.length, sids: scope.sids.length },
    ...(singleFlight ? { singleFlight } : {}),
    timings,
  };
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  return /^SALES_FACTS_[A-Z0-9_]+$/u.test(code) ? code : "SALES_FACTS_DERIVED_FAILED";
}

function safeErrorName(error) {
  const name = String(error?.name || "");
  return /^SalesFacts[A-Za-z]+Error$/u.test(name) ? name : "Error";
}

export async function getOrBuildSalesDerived({
  scope: inputScope,
  mapperVersion,
  repository,
  build,
  now = Date.now,
  requestId: requestedRequestId,
  logger = console,
  payloadKeys: extraPayloadKeys,
} = {}) {
  const requestId = normalizeSalesFactsRequestId(requestedRequestId, { fallback: "sales-derived" });
  const scope = canonicalScope(inputScope);
  const normalizedMapperVersion = text(mapperVersion, "派生缓存 mapper version 缺失。", "SALES_FACTS_DERIVED_MAPPER_VERSION_INVALID");
  if (!repository || typeof repository.readDerivedCache !== "function" || typeof repository.writeDerivedCache !== "function" || typeof repository.getRevisions !== "function") {
    throw new SalesFactsInputError("销售派生缓存仓储接口无效。", { code: "SALES_FACTS_DERIVED_REPOSITORY_INVALID" });
  }
  if (typeof build !== "function") throw new SalesFactsInputError("销售派生缓存缺少构建函数。", { code: "SALES_FACTS_DERIVED_BUILD_INVALID" });
  const key = `${scope.rangeKey}|${normalizedMapperVersion}`;
  const keys = payloadKeys(extraPayloadKeys);
  const inFlight = getOrBuildSalesDerived.inFlight;
  const existing = inFlight.get(key);
  if (existing) {
    const result = await existing;
    return { ...result, meta: { ...result.meta, cacheState: "inflight", singleFlight: "joiner", requestId } };
  }

  const promise = (async () => {
    const started = performance.now();
    const nowMs = safeNow(now);
    const revisionValue = revisions(repository, requestId);
    const cachedRaw = repository.readDerivedCache(scope.rangeKey, { requestId });
    const cached = cachedRaw ? validateCacheEntry(cachedRaw, { cacheKey: scope.rangeKey, keys }) : null;
    if (cached
      && cached.salesFactsRevision === revisionValue.salesFactsRevision
      && cached.ownerRevision === revisionValue.ownerRevision
      && cached.mapperVersion === normalizedMapperVersion
      && cached.expiresAtMs > nowMs) {
      const timings = { readMs: Math.max(0, Math.round(performance.now() - started)), buildMs: 0, writeMs: 0, totalMs: Math.max(0, Math.round(performance.now() - started)) };
      return {
        payload: cached.payload,
        meta: cacheMeta({ cacheState: "hit", cache: cached, revisionsValue: revisionValue, mapperVersion: normalizedMapperVersion, scope, requestId, nowMs, singleFlight: "owner", timings }),
      };
    }

    const buildStarted = performance.now();
    const payload = await build({
      scope,
      cacheKey: scope.rangeKey,
      salesFactsRevision: revisionValue.salesFactsRevision,
      ownerRevision: revisionValue.ownerRevision,
      requestId,
    });
    const validatedPayload = validatePayload(payload, { keys });
    const buildMs = Math.max(0, Math.round(performance.now() - buildStarted));
    const currentRevision = revisions(repository, requestId);
    if (currentRevision.salesFactsRevision !== revisionValue.salesFactsRevision || currentRevision.ownerRevision !== revisionValue.ownerRevision) {
      throw new SalesFactsConflictError("派生缓存构建期间事实 revision 已变化。", { code: "SALES_FACTS_DERIVED_REVISION_CHANGED" });
    }
    const generatedAtMs = safeNow(now);
    const expiresAtMs = generatedAtMs + DERIVED_CACHE_TTL_MS;
    const writeStarted = performance.now();
    repository.writeDerivedCache({
      cacheKey: scope.rangeKey,
      payload: validatedPayload,
      salesFactsRevision: revisionValue.salesFactsRevision,
      ownerRevision: revisionValue.ownerRevision,
      mapperVersion: normalizedMapperVersion,
      generatedAtMs,
      expiresAtMs,
      requestId,
    });
    const writeMs = Math.max(0, Math.round(performance.now() - writeStarted));
    const timings = { readMs: 0, buildMs, writeMs, totalMs: Math.max(0, Math.round(performance.now() - started)) };
    return {
      payload: validatedPayload,
      meta: cacheMeta({ cacheState: "refreshed", cache: { generatedAtMs }, revisionsValue: revisionValue, mapperVersion: normalizedMapperVersion, scope, requestId, nowMs: generatedAtMs, singleFlight: "owner", timings }),
    };
  })();
  inFlight.set(key, promise);
  promise.finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }).catch(() => {});
  try {
    return await promise;
  } catch (error) {
    log(logger, "error", "failure", { requestId, cacheKey: scope.rangeKey, errorName: safeErrorName(error), errorCode: safeErrorCode(error) });
    throw error;
  }
}

getOrBuildSalesDerived.inFlight = new Map();

export const SALES_DERIVED_CACHE_TTL_MS = DERIVED_CACHE_TTL_MS;

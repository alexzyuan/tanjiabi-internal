import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import {
  applyProductCatalogToFbaFreightShipments,
  fbaFreightSheetTestUtils,
  normalizeFbaFreightShipments,
} from "./fbaFreightSheetService.js";
import { getSellerDirectory } from "./sellerDirectoryService.js";
import { getSharedProductCatalogMap } from "./sharedDataService.js";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const candidateCache = new Map();
const candidateInflightRequests = new Map();

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

async function resolveSellerMappings(adapter, sellers = [], { getDirectory = getSellerDirectory } = {}) {
  if (Array.isArray(sellers) && sellers.length) return sellers;
  if (typeof getDirectory !== "function") throw new Error("FBA 货件候选缺少运行时领星店铺目录加载器。");
  const directory = await getDirectory({ adapter });
  const sellerRows = Array.isArray(directory) ? directory : directory?.sellers;
  if (!Array.isArray(sellerRows) || !sellerRows.length) {
    throw new Error("FBA 货件候选的运行时店铺目录为空，无法继续加载货件。");
  }
  console.info("[fba-shipment-candidates] resolved runtime seller directory", {
    sellerCount: sellerRows.length,
    source: directory?.meta?.source || "injected",
  });
  return sellerRows;
}

function parseSellerSids(filters = {}) {
  const raw = filters.sids ?? filters.sid ?? "";
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const sids = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const sid = Number(text);
    if (!Number.isInteger(sid) || sid <= 0) {
      throw new Error(`FBA 货件筛选包含无效店铺 SID：${text}`);
    }
    if (!sids.includes(sid)) sids.push(sid);
  }
  return sids;
}

function sellerSid(seller = {}) {
  return Number(seller.sid || seller.id || seller.seller_id_local || seller.store_id || seller.storeId || 0);
}

function buildSellerMap(sellers = []) {
  const map = new Map();
  for (const seller of sellers || []) {
    const sid = sellerSid(seller);
    if (!sid) continue;
    map.set(sid, {
      ...map.get(sid),
      ...seller,
      sid,
      seller_id: firstText(seller.seller_id, seller.sellerId),
      marketplace_id: firstText(seller.marketplace_id, seller.marketplaceId),
    });
  }
  return map;
}

export function normalizeFbaShipmentCandidateFilters(filters = {}) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate || filters.start_date || "")
    ? firstText(filters.startDate, filters.start_date)
    : `${yyyy}-${mm}-01`;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate || filters.end_date || "")
    ? firstText(filters.endDate, filters.end_date)
    : today;
  const sids = parseSellerSids(filters);
  return {
    startDate,
    endDate,
    sids,
    shipmentId: firstText(filters.shipmentId, filters.shipment_id),
    shipmentStatus: firstText(filters.shipmentStatus, filters.shipment_status),
    offset: Math.max(0, Number(filters.offset || 0) || 0),
    length: Math.min(500, Math.max(1, Number(filters.length || 100) || 100)),
    forceRefresh: String(filters.forceRefresh || "").toLowerCase() === "true" || filters.forceRefresh === true,
  };
}

export function buildFbaShipmentCandidateCacheKey(filters = {}) {
  return JSON.stringify({
    sid: [...filters.sids].sort((a, b) => a - b),
    start_date: filters.startDate,
    end_date: filters.endDate,
    shipment_id: filters.shipmentId,
    shipment_status: filters.shipmentStatus,
    offset: filters.offset,
    length: filters.length,
  });
}

export function clearFbaShipmentCandidateCache() {
  candidateCache.clear();
  candidateInflightRequests.clear();
}

function rowsHaveSellerMappings(rows = []) {
  return rows.every((row) => firstText(row.sellerId) && firstText(row.marketplaceId));
}

function enrichShipmentWithSeller(row = {}, sellerMap = new Map()) {
  const seller = sellerMap.get(Number(row.sid)) || {};
  return {
    ...row,
    sellerId: firstText(seller.seller_id, seller.sellerId, row.raw?.seller_id),
    marketplaceId: firstText(seller.marketplace_id, seller.marketplaceId, row.raw?.marketplace_id),
    mid: Number(seller.mid || row.raw?.mid || 0),
  };
}

async function enrichProductCatalog(adapter, shipments, {
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
  sellers = [],
  repository = null,
  sharedCatalogOptions = {},
} = {}) {
  const seedRows = shipments.flatMap((shipment) =>
    (shipment.items || []).map((item) => ({
      sid: shipment.sid,
      storeName: shipment.storeName,
      country: shipment.country,
      msku: item.msku,
      sku: item.sku,
      productName: item.productName || item.title,
      imageUrl: item.imageUrl,
    })),
  );
  if (!seedRows.length) return { rows: shipments, status: "" };
  try {
    const catalogOptions = {
      ...sharedCatalogOptions,
      forceRefresh: forceProductCatalogRefresh,
      strict: productCatalogRequired,
      sellers,
    };
    if (repository) catalogOptions.repository = repository;
    const catalogResult = await getSharedProductCatalogMap(adapter, seedRows, catalogOptions);
    return {
      rows: applyProductCatalogToFbaFreightShipments(shipments, catalogResult.map),
      status: catalogResult.status || "",
    };
  } catch (error) {
    console.error("[fba-shipment-candidates] product catalog lookup failed", {
      shipmentCount: shipments.length,
      itemCount: seedRows.length,
      required: productCatalogRequired,
      error: error.message,
    });
    if (productCatalogRequired) throw error;
    return { rows: shipments, status: "failed" };
  }
}

async function fetchFbaShipmentCandidates(normalizedFilters, cacheKey, {
  adapter = getLingxingAdapter(),
  sellerMappings = [],
  now,
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
  productCatalogRepository = null,
  sharedCatalogOptions = {},
} = {}) {
  const params = fbaFreightSheetTestUtils.buildLingxingShipmentParams(normalizedFilters);
  const payload = await adapter.fetchFbaCargoShipments(params);
  const sellerMap = buildSellerMap(sellerMappings);
  const baseRows = normalizeFbaFreightShipments(payload, { sellersBySid: sellerMap })
    .map((row) => enrichShipmentWithSeller(row, sellerMap));
  const catalog = await enrichProductCatalog(adapter, baseRows, {
    productCatalogRequired,
    forceProductCatalogRefresh,
    sellers: sellerMappings,
    repository: productCatalogRepository,
    sharedCatalogOptions,
  });
  const fetchedAt = new Date(now).toISOString();
  const result = {
    ok: true,
    filters: normalizedFilters,
    total: Number(payload?.total || payload?.data?.total || catalog.rows.length || 0),
    rows: catalog.rows,
    imageCatalogStatus: catalog.status || "",
    sourceRequestId: firstText(payload?.request_id, payload?.requestId),
    fetchedAt,
    raw: payload,
  };
  candidateCache.set(cacheKey, { fetchedAtMs: now, result });
  console.info("[fba-shipment-candidates] fetched shipments", {
    shipmentCount: result.rows.length,
    itemCount: result.rows.reduce((sum, row) => sum + (row.items || []).length, 0),
    cacheKey,
    forceRefresh: normalizedFilters.forceRefresh,
    requestId: result.sourceRequestId,
  });
  return { ...result, cache: { hit: false, key: cacheKey, fetchedAt } };
}

export async function getFbaShipmentCandidates(filters = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  getDirectory = getSellerDirectory,
  now = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS,
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
  productCatalogRepository = null,
  sharedCatalogOptions = {},
} = {}) {
  const requestedFilters = normalizeFbaShipmentCandidateFilters(filters);
  const sellerMappings = await resolveSellerMappings(adapter, sellers, { getDirectory });
  const sellerMap = buildSellerMap(sellerMappings);
  if (!sellerMap.size) throw new Error("FBA 货件候选的运行时店铺目录没有有效 SID，无法继续加载货件。");
  const requestedSids = requestedFilters.sids.length
    ? requestedFilters.sids
    : [...sellerMap.keys()];
  const unknownRequestedSids = requestedSids.filter((sid) => !sellerMap.has(sid));
  if (unknownRequestedSids.length) {
    console.error("[fba-shipment-candidates] requested seller SID is absent from runtime directory", {
      sids: unknownRequestedSids,
    });
    throw new Error(`FBA 货件筛选包含未映射店铺 SID：${unknownRequestedSids.join(", ")}`);
  }
  const normalizedFilters = {
    ...requestedFilters,
    sids: requestedSids,
  };
  const cacheKey = buildFbaShipmentCandidateCacheKey(normalizedFilters);
  const cached = candidateCache.get(cacheKey);
  const needsSellerMappings = true;
  const cachedCanSatisfy = !needsSellerMappings || rowsHaveSellerMappings(cached?.result?.rows || []);
  const requiresRefresh = normalizedFilters.forceRefresh || forceProductCatalogRefresh;
  if (!requiresRefresh && cached && now - cached.fetchedAtMs < ttlMs && cachedCanSatisfy) {
    return {
      ...cached.result,
      cache: { hit: true, key: cacheKey, fetchedAt: cached.result.fetchedAt },
    };
  }
  if (!normalizedFilters.forceRefresh && cached && !cachedCanSatisfy) {
    console.info("[fba-shipment-candidates] bypassed cache without seller mappings", { cacheKey });
  }
  if (forceProductCatalogRefresh && cached) {
    console.info("[fba-shipment-candidates] bypassed cache for forced product catalog refresh", { cacheKey });
  }

  const inflightKey = JSON.stringify({
    cacheKey,
    forceRefresh: normalizedFilters.forceRefresh,
    forceProductCatalogRefresh,
  });
  const inflight = candidateInflightRequests.get(inflightKey);
  if (inflight) {
    console.info("[fba-shipment-candidates] joined in-flight request", {
      cacheKey,
      forceRefresh: normalizedFilters.forceRefresh,
      forceProductCatalogRefresh,
    });
    return inflight;
  }

  const request = fetchFbaShipmentCandidates(normalizedFilters, cacheKey, {
    adapter,
    sellerMappings,
    now,
    productCatalogRequired,
    forceProductCatalogRefresh,
    productCatalogRepository,
    sharedCatalogOptions,
  }).finally(() => {
    candidateInflightRequests.delete(inflightKey);
  });
  candidateInflightRequests.set(inflightKey, request);
  return request;
}

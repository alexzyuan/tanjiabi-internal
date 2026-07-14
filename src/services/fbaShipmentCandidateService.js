import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { lingxingShopMap } from "../data/lingxingShopMap.js";
import {
  applyProductCatalogToFbaFreightShipments,
  fbaFreightSheetTestUtils,
  normalizeFbaFreightShipments,
} from "./fbaFreightSheetService.js";
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

function records(payload) {
  const data = payload?.data !== undefined ? payload.data : (payload || {});
  if (Array.isArray(data)) return data;
  return data.list || data.records || data.rows || [];
}

async function resolveSellerMappings(adapter, sellers = [], { autoLoadSellerMappings = false } = {}) {
  if (Array.isArray(sellers) && sellers.length) return sellers;
  if (!autoLoadSellerMappings) return [];
  if (typeof adapter.fetchSellers !== "function") throw new Error("FBA 货件候选缺少领星店铺映射接口 fetchSellers。");
  const payload = await adapter.fetchSellers();
  const sellerRows = records(payload);
  console.info("[fba-shipment-candidates] loaded seller mappings", { sellerCount: sellerRows.length });
  return sellerRows;
}

function uniqueNumbers(values) {
  return [...new Set((values || []).map(Number).filter(Boolean))];
}

function sellerSid(seller = {}) {
  return Number(seller.sid || seller.id || seller.seller_id_local || seller.store_id || seller.storeId || 0);
}

function buildSellerMap(sellers = []) {
  const map = new Map();
  for (const shop of lingxingShopMap) {
    if (Number(shop.sid)) map.set(Number(shop.sid), shop);
  }
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
  const sids = uniqueNumbers(String(filters.sids || filters.sid || "")
    .split(",")
    .map((value) => value.trim()));
  return {
    startDate,
    endDate,
    sids: sids.length ? sids : lingxingShopMap.map((shop) => Number(shop.sid)).filter(Boolean),
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
} = {}) {
  const seedRows = shipments.flatMap((shipment) =>
    (shipment.items || []).map((item) => ({
      sid: shipment.sid,
      msku: item.msku,
      sku: item.sku,
      productName: item.productName || item.title,
      imageUrl: item.imageUrl,
    })),
  );
  if (!seedRows.length) return { rows: shipments, status: "" };
  try {
    const catalogResult = await getSharedProductCatalogMap(adapter, seedRows, {
      forceRefresh: forceProductCatalogRefresh,
      strict: productCatalogRequired,
    });
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
  sellers = [],
  autoLoadSellerMappings,
  now,
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
} = {}) {
  const params = fbaFreightSheetTestUtils.buildLingxingShipmentParams(normalizedFilters);
  const [payload, sellerMappings] = await Promise.all([
    adapter.fetchFbaCargoShipments(params),
    resolveSellerMappings(adapter, sellers, { autoLoadSellerMappings }),
  ]);
  const sellerMap = buildSellerMap(sellerMappings);
  const baseRows = normalizeFbaFreightShipments(payload, { sellersBySid: sellerMap })
    .map((row) => enrichShipmentWithSeller(row, sellerMap));
  const catalog = await enrichProductCatalog(adapter, baseRows, { productCatalogRequired, forceProductCatalogRefresh });
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
  autoLoadSellerMappings = false,
  now = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS,
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
} = {}) {
  const normalizedFilters = normalizeFbaShipmentCandidateFilters(filters);
  const cacheKey = buildFbaShipmentCandidateCacheKey(normalizedFilters);
  const cached = candidateCache.get(cacheKey);
  const needsSellerMappings = autoLoadSellerMappings || (Array.isArray(sellers) && sellers.length > 0);
  const cachedCanSatisfy = !needsSellerMappings || rowsHaveSellerMappings(cached?.result?.rows || []);
  if (!normalizedFilters.forceRefresh && cached && now - cached.fetchedAtMs < ttlMs && cachedCanSatisfy) {
    return {
      ...cached.result,
      cache: { hit: true, key: cacheKey, fetchedAt: cached.result.fetchedAt },
    };
  }
  if (!normalizedFilters.forceRefresh && cached && !cachedCanSatisfy) {
    console.info("[fba-shipment-candidates] bypassed cache without seller mappings", { cacheKey });
  }

  const inflight = candidateInflightRequests.get(cacheKey);
  if (inflight) {
    console.info("[fba-shipment-candidates] joined in-flight request", {
      cacheKey,
      forceRefresh: normalizedFilters.forceRefresh,
    });
    return inflight;
  }

  const request = fetchFbaShipmentCandidates(normalizedFilters, cacheKey, {
    adapter,
    sellers,
    autoLoadSellerMappings,
    now,
    productCatalogRequired,
    forceProductCatalogRefresh,
  }).finally(() => {
    candidateInflightRequests.delete(cacheKey);
  });
  candidateInflightRequests.set(cacheKey, request);
  return request;
}

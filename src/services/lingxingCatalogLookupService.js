import { normalizeRecordList } from "../utils/recordAccess.js";

function totalCountOf(payload) {
  const data = payload?.data || payload || {};
  const value = data.total ?? data.count ?? data.totalCount ?? payload?.total;
  if (value === undefined || value === null || value === "") return null;
  const total = Number(value);
  return Number.isInteger(total) && total >= 0 ? total : null;
}

function uniqueText(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function paginationIncompleteError({ declaredTotal, rowCount, maxOffset, pageSize, reason }) {
  const error = new Error("ERP Listing 分页不完整。");
  error.name = "LingxingListingPaginationError";
  error.code = "LISTING_PAGINATION_INCOMPLETE";
  error.statusCode = 502;
  error.details = { declaredTotal, rowCount, maxOffset, pageSize, reason };
  return error;
}

export async function fetchLingxingListingRecords(adapter, baseParams, {
  pageSize = 1000,
  maxOffset = 5000,
  normalize = normalizeRecordList,
  metrics = null,
  pagination = null,
  requireTotal = false,
} = {}) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new TypeError("Listing pageSize 必须是正整数。");
  if (!Number.isInteger(maxOffset) || maxOffset <= 0) throw new TypeError("Listing maxOffset 必须是正整数。");
  const records = [];
  let offset = 0;
  let pageCount = 0;
  let declaredTotal = null;
  while (offset < maxOffset) {
    metrics?.increment?.("lingxingListingRequests");
    const payload = await adapter.fetchListings({ ...baseParams, offset, length: pageSize });
    const pageRows = normalize(payload);
    pageCount += 1;
    const pageTotal = totalCountOf(payload);
    if (requireTotal && pageTotal === null) {
      throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "total-missing" });
    }
    if (pageTotal !== null && declaredTotal !== null && pageTotal !== declaredTotal) {
      throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "total-changed" });
    }
    if (pageTotal !== null) declaredTotal = pageTotal;
    records.push(...pageRows);
    if (declaredTotal !== null && records.length > declaredTotal) {
      throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "rows-exceed-total" });
    }
    if (!pageRows.length) {
      if (declaredTotal !== null && records.length < declaredTotal) {
        throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "empty-before-total" });
      }
      break;
    }
    if (declaredTotal !== null && records.length >= declaredTotal) break;
    if (pageRows.length < pageSize) {
      if (declaredTotal !== null && records.length < declaredTotal) {
        throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "short-before-total" });
      }
      break;
    }
    offset += pageSize;
  }
  if (pagination && typeof pagination === "object") {
    pagination.pageCount = pageCount;
    pagination.rowCount = records.length;
    pagination.declaredTotal = declaredTotal;
  }
  if (declaredTotal !== null && records.length < declaredTotal) {
    throw paginationIncompleteError({ declaredTotal, rowCount: records.length, maxOffset, pageSize, reason: "scan-limit" });
  }
  return records;
}

export function lingxingSidVariants(sid) {
  return [{ sid }, { sids: [sid] }, { seller_id: sid }, { sellerId: sid }];
}

export async function fetchLingxingListingsBySidMskus(adapter, sid, mskus = [], {
  batchSize = 50,
  sidVariants = lingxingSidVariants(sid),
  normalize = normalizeRecordList,
  strict = false,
  metrics = null,
  includeDeletedListings = false,
  includeUnpairedListings = false,
  exactOnly = false,
} = {}) {
  const records = [];
  for (const batch of chunkArray(uniqueText(mskus), batchSize)) {
    const baseParams = {
      ...(includeUnpairedListings ? {} : { is_pair: 1 }),
      ...(includeDeletedListings ? {} : { is_delete: 0 }),
      search_field: "seller_sku",
      search_value: batch,
      exact_search: 1,
    };
    let batchRecords = [];
    let lastError = null;
    for (const variant of sidVariants) {
      try {
        batchRecords = await fetchLingxingListingRecords(adapter, { ...baseParams, ...variant }, { normalize, metrics });
        if (!batchRecords.length && !exactOnly) {
          batchRecords = await fetchLingxingListingRecords(adapter, { ...baseParams, exact_search: 0, ...variant }, { normalize, metrics });
        }
        if (batchRecords.length) break;
      } catch (error) {
        lastError = error;
        batchRecords = [];
      }
    }
    if (!batchRecords.length && !exactOnly && batch.length > 1) {
      for (const msku of batch) {
        const singleParams = { ...baseParams, search_value: [msku], exact_search: 1 };
        for (const variant of sidVariants) {
          try {
            const singleRecords = await fetchLingxingListingRecords(adapter, { ...singleParams, ...variant }, { normalize, metrics });
            if (singleRecords.length) {
              batchRecords.push(...singleRecords);
              break;
            }
          } catch {
            // Try the next supported Listing parameter shape.
          }
        }
      }
    }
    if (strict && !batchRecords.length && lastError) {
      throw new Error(`ERP Listing 查询失败，SID ${sid}，MSKU ${batch.join(", ")}：${lastError.message}`);
    }
    records.push(...batchRecords);
  }
  return records;
}

export async function fetchLingxingProductRecords(adapter, params, fallbackParams = null, { strict = false, metrics = null } = {}) {
  try {
    metrics?.increment?.("lingxingProductInfoRequests");
    return normalizeRecordList(await adapter.fetchLocalProductInfos(params));
  } catch (error) {
    if (!fallbackParams) {
      if (strict) throw error;
      return [];
    }
    try {
      metrics?.increment?.("lingxingProductFallbackRequests");
      return normalizeRecordList(await adapter.fetchLocalProducts(fallbackParams));
    } catch (fallbackError) {
      if (strict) {
        throw new Error(`ERP 产品管理查询失败：${error.message}; fallback: ${fallbackError.message}`);
      }
      return [];
    }
  }
}

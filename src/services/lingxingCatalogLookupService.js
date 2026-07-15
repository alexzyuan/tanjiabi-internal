import { normalizeRecordList } from "../utils/recordAccess.js";

function totalCountOf(payload, recordsLength = 0) {
  const data = payload?.data || payload || {};
  return Number(data.total ?? data.count ?? data.totalCount ?? payload?.total ?? recordsLength) || recordsLength;
}

function uniqueText(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export async function fetchLingxingListingRecords(adapter, baseParams, {
  pageSize = 1000,
  maxOffset = 5000,
  normalize = normalizeRecordList,
} = {}) {
  const records = [];
  let offset = 0;
  while (offset < maxOffset) {
    const payload = await adapter.fetchListings({ ...baseParams, offset, length: pageSize });
    const pageRows = normalize(payload);
    records.push(...pageRows);
    const total = totalCountOf(payload, records.length);
    if (!pageRows.length || pageRows.length < pageSize || records.length >= total) break;
    offset += pageSize;
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
} = {}) {
  const records = [];
  for (const batch of chunkArray(uniqueText(mskus), batchSize)) {
    const baseParams = {
      is_pair: 1,
      is_delete: 0,
      search_field: "seller_sku",
      search_value: batch,
      exact_search: 1,
    };
    let batchRecords = [];
    let lastError = null;
    for (const variant of sidVariants) {
      try {
        batchRecords = await fetchLingxingListingRecords(adapter, { ...baseParams, ...variant }, { normalize });
        if (!batchRecords.length) {
          batchRecords = await fetchLingxingListingRecords(adapter, { ...baseParams, exact_search: 0, ...variant }, { normalize });
        }
        if (batchRecords.length) break;
      } catch (error) {
        lastError = error;
        batchRecords = [];
      }
    }
    if (!batchRecords.length && batch.length > 1) {
      for (const msku of batch) {
        const singleParams = { ...baseParams, search_value: [msku], exact_search: 1 };
        for (const variant of sidVariants) {
          try {
            const singleRecords = await fetchLingxingListingRecords(adapter, { ...singleParams, ...variant }, { normalize });
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

export async function fetchLingxingProductRecords(adapter, params, fallbackParams = null, { strict = false } = {}) {
  try {
    return normalizeRecordList(await adapter.fetchLocalProductInfos(params));
  } catch (error) {
    if (!fallbackParams) {
      if (strict) throw error;
      return [];
    }
    try {
      return normalizeRecordList(await adapter.fetchLocalProducts(fallbackParams));
    } catch (fallbackError) {
      if (strict) {
        throw new Error(`ERP 产品管理查询失败：${error.message}; fallback: ${fallbackError.message}`);
      }
      return [];
    }
  }
}

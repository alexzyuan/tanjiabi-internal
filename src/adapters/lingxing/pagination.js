export function normalizeRecordList(payload = {}) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.list)) return payload.list;
  return [];
}

export async function collectPaginatedRecords({
  fetchPage,
  offset = 0,
  length = 200,
  maxRows = 2000,
  params = {},
  recordsFromPayload = normalizeRecordList,
} = {}) {
  if (typeof fetchPage !== "function") throw new Error("collectPaginatedRecords requires fetchPage.");
  const rows = [];
  for (let currentOffset = offset; currentOffset < maxRows; currentOffset += length) {
    const payload = await fetchPage({ ...params, offset: currentOffset, length });
    const records = recordsFromPayload(payload);
    rows.push(...records);
    const total = Number(payload?.data?.total || payload?.total || 0);
    const hasNext = payload?.data?.hasNext ?? payload?.hasNext;
    if (!records.length || records.length < length || (total && rows.length >= total) || hasNext === false) break;
  }
  return rows.slice(0, maxRows);
}

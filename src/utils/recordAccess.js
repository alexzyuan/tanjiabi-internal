export function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

export function readDeepFirst(item, keys, maxDepth = 4) {
  const stack = [{ value: item, depth: 0 }];
  const seen = new Set();
  while (stack.length) {
    const { value, depth } = stack.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const direct = readFirst(value, keys);
    if (direct !== "") return direct;
    if (depth >= maxDepth) continue;
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
    });
  }
  return "";
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

export function normalizeRecordList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  const data = payload?.data || payload || {};
  const records = data.records || data.list || data.rows || data.data || data.items || data.result || data;
  return Array.isArray(records) ? records : [];
}

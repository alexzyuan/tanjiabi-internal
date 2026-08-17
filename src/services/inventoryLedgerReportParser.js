import { gunzipSync } from "node:zlib";

const REQUIRED_HEADERS = {
  date: ["eventdate", "date", "transactiondate"],
  msku: ["msku", "sellersku", "merchantsku", "skumerchant"],
  eventType: ["eventtype", "transactiontype", "type"],
  quantity: ["quantity", "qty"],
  fulfillmentCenter: ["fulfillmentcenter", "fulfillmentcentre", "fulfillmentcenterid", "warehouse"],
  disposition: ["disposition", "detaileddisposition", "condition"],
  referenceId: ["referenceid", "reference", "orderid"],
  reason: ["reason", "eventreason"],
};

const OPTIONAL_HEADERS = {
  title: ["title", "productname", "producttitle"],
};

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/u, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseTsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const nonEmptyLines = lines.filter((line) => line.trim());
  if (nonEmptyLines.length < 2) throw new Error("库存分类账原始报表为空或只有表头。");
  const delimiter = nonEmptyLines[0].includes("\t") ? "\t" : ",";
  return nonEmptyLines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

function headerIndex(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function parseDate(value, sourceRow) {
  const text = normalizeText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`库存分类账第 ${sourceRow} 行日期无效：${value}`);
  }
  return text;
}

function parseQuantity(value, sourceRow) {
  const text = normalizeText(value).replace(/,/gu, "");
  if (!text) throw new Error(`库存分类账第 ${sourceRow} 行数量无效：为空。`);
  const quantity = Number(text);
  if (!Number.isFinite(quantity)) throw new Error(`库存分类账第 ${sourceRow} 行数量无效：${value}`);
  return quantity;
}

function decodeReport(bytes, compressionAlgorithm) {
  const compression = String(compressionAlgorithm || "NONE").trim().toUpperCase();
  if (compression === "GZIP") return gunzipSync(bytes).toString("utf8");
  if (compression === "" || compression === "NONE") return Buffer.from(bytes).toString("utf8");
  throw new Error(`库存分类账不支持的压缩方式：${compression}`);
}

export function parseInventoryLedgerReport(bytes, {
  compressionAlgorithm = "NONE",
  expectedMonth,
  sellerId,
  marketplaceId,
  scopeKey,
} = {}) {
  if (!/^\d{4}-\d{2}$/u.test(String(expectedMonth || ""))) throw new Error("库存分类账 expectedMonth 无效。");
  if (!normalizeText(sellerId) || !normalizeText(marketplaceId) || !normalizeText(scopeKey)) {
    throw new Error("库存分类账解析缺少 sellerId、marketplaceId 或 scopeKey。 ");
  }
  const rows = parseTsv(decodeReport(bytes, compressionAlgorithm));
  const normalizedHeaders = rows[0].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.entries(REQUIRED_HEADERS).map(([key, aliases]) => [key, headerIndex(normalizedHeaders, aliases)]));
  const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([key]) => key);
  if (missing.length) throw new Error(`库存分类账缺少必需列：${missing.join(", ")}`);
  const optionalIndexes = Object.fromEntries(Object.entries(OPTIONAL_HEADERS).map(([key, aliases]) => [key, headerIndex(normalizedHeaders, aliases)]));

  const records = rows.slice(1).map((row, index) => {
    const sourceRow = index + 2;
    const date = parseDate(row[indexes.date], sourceRow);
    if (!date.startsWith(`${expectedMonth}-`)) {
      throw new Error(`库存分类账第 ${sourceRow} 行日期 ${date} 不属于目标月份 ${expectedMonth}。`);
    }
    const msku = normalizeText(row[indexes.msku]);
    const eventType = normalizeText(row[indexes.eventType]);
    if (!msku) throw new Error(`库存分类账第 ${sourceRow} 行 MSKU 为空。`);
    if (!eventType) throw new Error(`库存分类账第 ${sourceRow} 行事件类型为空。`);
    return {
      date,
      msku,
      eventType,
      quantity: parseQuantity(row[indexes.quantity], sourceRow),
      fulfillmentCenter: normalizeText(row[indexes.fulfillmentCenter]),
      disposition: normalizeText(row[indexes.disposition]),
      referenceId: normalizeText(row[indexes.referenceId]),
      reason: normalizeText(row[indexes.reason]),
      title: optionalIndexes.title >= 0 ? normalizeText(row[optionalIndexes.title]) : "",
      sellerId: normalizeText(sellerId),
      marketplaceId: normalizeText(marketplaceId),
      scopeKey: normalizeText(scopeKey),
      sourceRow,
    };
  });
  return {
    records,
    meta: {
      rowCount: records.length,
      expectedMonth,
      sellerId: normalizeText(sellerId),
      marketplaceId: normalizeText(marketplaceId),
      scopeKey: normalizeText(scopeKey),
    },
  };
}

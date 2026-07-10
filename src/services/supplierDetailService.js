import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const storeDir = path.join(process.cwd(), "data-cache");
const storeFile = path.join(storeDir, "supplier-details.json");

const supplierDetailColumns = [
  { key: "supplier", label: "供应商", aliases: ["供应商", "供应商名称", "工厂", "工厂名称"] },
  { key: "qualification", label: "供应商资质", aliases: ["供应商资质", "资质", "纳税人资质"] },
  { key: "paymentTermType", label: "账期类型", aliases: ["账期类型", "账期", "付款账期"] },
  { key: "invoiceType", label: "开票类型", aliases: ["开票类型", "发票类型", "票种"] },
  { key: "taxRate", label: "税率", aliases: ["税率", "税点", "普票税点", "专票税点"] },
];

function nowText() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "");
}

function parseTaxRate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const number = Number(text.replace(/%/g, "").replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return number > 1 ? Number((number / 100).toFixed(6)) : Number(number.toFixed(6));
}

function formatTaxRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "";
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storeFile, "utf8"));
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

async function writeStore(rows) {
  await mkdir(storeDir, { recursive: true });
  await writeFile(storeFile, `${JSON.stringify({ rows }, null, 2)}\n`, "utf8");
}

function normalizeRow(input = {}, existing = {}) {
  const supplier = normalizeText(input.supplier ?? existing.supplier);
  if (!supplier) throw new Error("供应商不能为空。");
  return {
    id: existing.id || normalizeText(input.id) || makeId(),
    supplier,
    qualification: normalizeText(input.qualification ?? existing.qualification),
    paymentTermType: normalizeText(input.paymentTermType ?? existing.paymentTermType),
    invoiceType: normalizeText(input.invoiceType ?? existing.invoiceType),
    taxRate: parseTaxRate(input.taxRate ?? existing.taxRate),
    source: normalizeText(input.source ?? existing.source) || "manual",
    createdAt: existing.createdAt || nowText(),
    updatedAt: nowText(),
  };
}

function filterRows(rows, filters = {}) {
  const keyword = normalizeKey(filters.keyword);
  const qualification = normalizeKey(filters.qualification);
  const paymentTermType = normalizeKey(filters.paymentTermType);
  const invoiceType = normalizeKey(filters.invoiceType);
  return rows.filter((row) => {
    const haystack = normalizeKey(`${row.supplier} ${row.qualification} ${row.paymentTermType} ${row.invoiceType} ${formatTaxRate(row.taxRate)}`);
    if (keyword && !haystack.includes(keyword)) return false;
    if (qualification && normalizeKey(row.qualification) !== qualification) return false;
    if (paymentTermType && normalizeKey(row.paymentTermType) !== paymentTermType) return false;
    if (invoiceType && normalizeKey(row.invoiceType) !== invoiceType) return false;
    return true;
  });
}

function summarize(rows) {
  const supplierCount = new Set(rows.map((row) => row.supplier).filter(Boolean)).size;
  return {
    supplierCount,
    qualificationCount: new Set(rows.map((row) => row.qualification).filter(Boolean)).size,
    paymentTermCount: new Set(rows.map((row) => row.paymentTermType).filter(Boolean)).size,
    invoiceTypeCount: new Set(rows.map((row) => row.invoiceType).filter(Boolean)).size,
  };
}

function optionValues(rows, key) {
  return [...new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export async function listSupplierDetails(filters = {}) {
  const allRows = await readStore();
  const rows = filterRows(allRows, filters).sort((a, b) => a.supplier.localeCompare(b.supplier, "zh-Hans-CN"));
  return {
    meta: {
      source: "本地供应商明细",
      updatedAt: nowText(),
      total: allRows.length,
    },
    summary: summarize(rows),
    rows,
    options: {
      qualifications: optionValues(allRows, "qualification"),
      paymentTermTypes: optionValues(allRows, "paymentTermType"),
      invoiceTypes: optionValues(allRows, "invoiceType"),
    },
  };
}

export async function saveSupplierDetail(payload = {}) {
  const rows = await readStore();
  const index = rows.findIndex((row) => row.id === payload.id);
  const existing = index >= 0 ? rows[index] : {};
  const normalized = normalizeRow(payload, existing);
  if (index >= 0) {
    rows[index] = normalized;
  } else {
    rows.push(normalized);
  }
  await writeStore(rows);
  return normalized;
}

export async function deleteSupplierDetail(id) {
  const rows = await readStore();
  const nextRows = rows.filter((row) => row.id !== id);
  if (nextRows.length === rows.length) throw new Error("供应商明细不存在。");
  await writeStore(nextRows);
  return { id };
}

function mapHeaderIndexes(headerRow = []) {
  const normalizedHeaders = headerRow.map((cell) => normalizeKey(cell));
  return Object.fromEntries(supplierDetailColumns.map((column) => {
    const aliases = column.aliases.map(normalizeKey);
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    return [column.key, index];
  }));
}

export async function importSupplierDetails(payload = {}) {
  const content = Buffer.from(String(payload.contentBase64 || ""), "base64");
  if (!content.length) throw new Error("导入文件不能为空。");
  const module = await import("xlsx");
  const XLSX = module.default || module;
  const workbook = XLSX.read(content, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("导入文件没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const header = rows.find((row) => row.some((cell) => normalizeText(cell)));
  if (!header) throw new Error("导入文件没有表头。");
  const headerIndex = mapHeaderIndexes(header);
  if (headerIndex.supplier < 0) throw new Error("导入文件必须包含“供应商”列。");
  const existingRows = await readStore();
  const rowsBySupplier = new Map(existingRows.map((row) => [normalizeKey(row.supplier), row]));
  let imported = 0;
  let skipped = 0;
  rows.slice(rows.indexOf(header) + 1).forEach((rawRow) => {
    const supplier = normalizeText(rawRow[headerIndex.supplier]);
    if (!supplier) {
      skipped += 1;
      return;
    }
    const key = normalizeKey(supplier);
    const existing = rowsBySupplier.get(key) || {};
    const normalized = normalizeRow({
      supplier,
      qualification: headerIndex.qualification >= 0 ? rawRow[headerIndex.qualification] : "",
      paymentTermType: headerIndex.paymentTermType >= 0 ? rawRow[headerIndex.paymentTermType] : "",
      invoiceType: headerIndex.invoiceType >= 0 ? rawRow[headerIndex.invoiceType] : "",
      taxRate: headerIndex.taxRate >= 0 ? rawRow[headerIndex.taxRate] : "",
      source: "import",
    }, existing);
    rowsBySupplier.set(key, normalized);
    imported += 1;
  });
  const nextRows = [...rowsBySupplier.values()].sort((a, b) => a.supplier.localeCompare(b.supplier, "zh-Hans-CN"));
  await writeStore(nextRows);
  return { imported, skipped, total: nextRows.length };
}

export { supplierDetailColumns, formatTaxRate };

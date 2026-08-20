import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const LEDGER_FILE_NAME = "product-certificates-v1.json";
const TEMPLATE_HEADERS = ["国家", "产品SKU", "证书类型", "证书编号", "签发日期", "过期日期"];
const DAY_MS = 86_400_000;

function normalizeText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizedKeyPart(value) {
  return normalizeText(value).toLocaleLowerCase("en-US");
}

function certificateKey(row) {
  return [row.country, row.productSku, row.certificateType, row.certificateNumber]
    .map(normalizedKeyPart)
    .join("\u0001");
}

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "PRODUCT_CERTIFICATE_INVALID_INPUT";
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = "PRODUCT_CERTIFICATE_CONFLICT";
  return error;
}

function requiredText(value, label) {
  const text = normalizeText(value);
  if (!text) throw invalidInput(`${label}不能为空。`);
  return text;
}

function parseDateParts(value, label, { required = false } = {}) {
  const text = normalizeText(value);
  if (!text) {
    if (required) throw invalidInput(`${label}不能为空。`);
    return "";
  }
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!matched) throw invalidInput(`${label}必须为 YYYY-MM-DD。`);
  const [, yearText, monthText, dayText] = matched;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) throw invalidInput(`${label}不是有效日期。`);
  return text;
}

function dateEpoch(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function shanghaiDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function expiryStatus(expiryDate, currentDate) {
  const days = Math.floor((dateEpoch(expiryDate) - dateEpoch(shanghaiDate(currentDate))) / DAY_MS);
  if (days < 0) return "已过期";
  if (days <= 30) return "预警";
  if (days <= 60) return "注意";
  return "有效";
}

function normalizeRecord(input = {}, id = crypto.randomUUID()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidInput("证书记录必须是对象。");
  const issuedDate = parseDateParts(input.issuedDate, "签发日期");
  const expiryDate = parseDateParts(input.expiryDate, "过期日期", { required: true });
  if (issuedDate && dateEpoch(expiryDate) < dateEpoch(issuedDate)) {
    throw invalidInput("过期日期不得早于签发日期。");
  }
  return {
    id,
    country: requiredText(input.country, "国家"),
    productSku: requiredText(input.productSku, "产品SKU"),
    certificateType: requiredText(input.certificateType, "证书类型"),
    certificateNumber: requiredText(input.certificateNumber, "证书编号"),
    issuedDate,
    expiryDate,
  };
}

function decorateRecord(row, now) {
  return { ...row, status: expiryStatus(row.expiryDate, now) };
}

function summarize(rows) {
  const summary = { valid: 0, warning: 0, attention: 0, expired: 0, total: rows.length };
  for (const row of rows) {
    if (row.status === "有效") summary.valid += 1;
    if (row.status === "预警") summary.warning += 1;
    if (row.status === "注意") summary.attention += 1;
    if (row.status === "已过期") summary.expired += 1;
  }
  return summary;
}

function validLedger(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.rows);
}

function base64Buffer(value) {
  const text = normalizeText(value);
  if (!text) throw invalidInput("上传文件内容为空。");
  const cleaned = text.includes(",") ? text.split(",").pop() : text;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(cleaned) || cleaned.length % 4 !== 0) {
    throw invalidInput("上传文件内容无效。");
  }
  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length) throw invalidInput("上传文件内容为空。");
  return buffer;
}

async function xlsxModule() {
  const module = await import("xlsx");
  return module.default || module;
}

function normalizedImportRows(values) {
  if (!Array.isArray(values) || !values.length) throw invalidInput("导入表格不能为空。");
  const headers = values[0].map((value) => normalizeText(value));
  if (headers.length !== TEMPLATE_HEADERS.length || headers.some((header, index) => header !== TEMPLATE_HEADERS[index])) {
    throw invalidInput(`导入表头必须依次为：${TEMPLATE_HEADERS.join("、")}。`);
  }
  const rows = [];
  const keys = new Set();
  for (let index = 1; index < values.length; index += 1) {
    const source = values[index] || [];
    if (source.every((value) => !normalizeText(value))) continue;
    try {
      const row = normalizeRecord({
        country: source[0], productSku: source[1], certificateType: source[2], certificateNumber: source[3], issuedDate: source[4], expiryDate: source[5],
      });
      const key = certificateKey(row);
      if (keys.has(key)) throw invalidInput("导入文件内存在重复的证书业务键。");
      keys.add(key);
      rows.push(row);
    } catch (error) {
      if (error?.statusCode) throw invalidInput(`第${index + 1}行：${error.message}`);
      throw error;
    }
  }
  if (!rows.length) throw invalidInput("导入表格没有可用记录。");
  return rows;
}

export function createProductCertificateService({
  directory = path.join(process.cwd(), "data-cache", "product-certificates"),
  now = () => new Date(),
  logger = console,
} = {}) {
  const ledgerPath = path.join(directory, LEDGER_FILE_NAME);

  async function readLedger() {
    try {
      const parsed = JSON.parse(await readFile(ledgerPath, "utf8"));
      if (!validLedger(parsed)) throw new Error("产品证书台账文件结构无效。");
      return { version: 1, rows: parsed.rows.map((row) => normalizeRecord(row, row.id)) };
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, rows: [] };
      throw error;
    }
  }

  async function writeLedger(rows) {
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${LEDGER_FILE_NAME}.${crypto.randomUUID()}.tmp`);
    const body = JSON.stringify({ version: 1, rows }, null, 2);
    await writeFile(temporaryPath, body, "utf8");
    await rename(temporaryPath, ledgerPath);
  }

  function listResult(rows, filters = {}) {
    const currentDate = now();
    if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) throw new Error("证书状态计算时间无效。");
    let resultRows = rows.map((row) => decorateRecord(row, currentDate));
    const country = normalizeText(filters.country);
    const certificateType = normalizeText(filters.certificateType);
    const status = normalizeText(filters.status);
    const keyword = normalizeText(filters.keyword).toLocaleLowerCase("en-US");
    if (country) resultRows = resultRows.filter((row) => row.country === country);
    if (certificateType) resultRows = resultRows.filter((row) => row.certificateType === certificateType);
    if (status) resultRows = resultRows.filter((row) => row.status === status);
    if (keyword) resultRows = resultRows.filter((row) => [row.productSku, row.certificateNumber].some((value) => value.toLocaleLowerCase("en-US").includes(keyword)));
    return {
      rows: resultRows,
      summary: summarize(resultRows),
      filters: {
        countries: [...new Set(rows.map((row) => row.country))].sort((left, right) => left.localeCompare(right, "zh-CN")),
        certificateTypes: [...new Set(rows.map((row) => row.certificateType))].sort((left, right) => left.localeCompare(right, "zh-CN")),
      },
    };
  }

  async function listCertificates(filters = {}) {
    return listResult((await readLedger()).rows, filters);
  }

  async function saveCertificate(input) {
    const ledger = await readLedger();
    const row = normalizeRecord(input);
    if (ledger.rows.some((candidate) => certificateKey(candidate) === certificateKey(row))) {
      throw conflict("相同国家、产品SKU、证书类型和证书编号的记录已存在。");
    }
    const rows = [...ledger.rows, row];
    await writeLedger(rows);
    logger.info?.({ operation: "product-certificate-save", recordCount: rows.length });
    return decorateRecord(row, now());
  }

  async function updateCertificate(id, input) {
    const recordId = requiredText(id, "证书记录ID");
    const ledger = await readLedger();
    const index = ledger.rows.findIndex((row) => row.id === recordId);
    if (index === -1) throw invalidInput("证书记录不存在。");
    const updated = normalizeRecord(input, recordId);
    if (ledger.rows.some((candidate, candidateIndex) => candidateIndex !== index && certificateKey(candidate) === certificateKey(updated))) {
      throw conflict("相同国家、产品SKU、证书类型和证书编号的记录已存在。");
    }
    const rows = ledger.rows.toSpliced(index, 1, updated);
    await writeLedger(rows);
    logger.info?.({ operation: "product-certificate-update", recordCount: rows.length });
    return decorateRecord(updated, now());
  }

  async function deleteCertificate(id) {
    const recordId = requiredText(id, "证书记录ID");
    const ledger = await readLedger();
    const index = ledger.rows.findIndex((row) => row.id === recordId);
    if (index === -1) throw invalidInput("证书记录不存在。");
    const [deleted] = ledger.rows.splice(index, 1);
    await writeLedger(ledger.rows);
    logger.info?.({ operation: "product-certificate-delete", recordCount: ledger.rows.length });
    return decorateRecord(deleted, now());
  }

  async function importCertificates(payload = {}) {
    const fileName = requiredText(payload.fileName, "上传文件名");
    if (path.extname(fileName).toLocaleLowerCase("en-US") !== ".xlsx") throw invalidInput("只支持导入 .xlsx 文件。");
    const XLSX = await xlsxModule();
    const workbook = XLSX.read(base64Buffer(payload.base64), { type: "buffer", cellDates: false, raw: false, dateNF: "yyyy-mm-dd" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw invalidInput("导入表格没有工作表。");
    const importedRows = normalizedImportRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" }));
    const ledger = await readLedger();
    const existingByKey = new Map(ledger.rows.map((row) => [certificateKey(row), row]));
    let updatedCount = 0;
    for (const imported of importedRows) {
      const key = certificateKey(imported);
      const existing = existingByKey.get(key);
      if (existing) {
        existingByKey.set(key, { ...imported, id: existing.id });
        updatedCount += 1;
      } else {
        existingByKey.set(key, imported);
      }
    }
    const rows = [...existingByKey.values()];
    await writeLedger(rows);
    logger.info?.({ operation: "product-certificate-import", importedCount: importedRows.length, updatedCount, totalCount: rows.length });
    return { importedCount: importedRows.length, updatedCount, totalCount: rows.length };
  }

  async function createCertificateImportTemplate() {
    const XLSX = await xlsxModule();
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["美国", "SKU-100", "FCC", "FCC-2026-001", "2026-01-01", "2027-01-01"],
    ]);
    sheet["!cols"] = [12, 18, 16, 22, 14, 14].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, "证书有效期台账");
    return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  }

  return {
    listCertificates,
    saveCertificate,
    updateCertificate,
    deleteCertificate,
    importCertificates,
    createCertificateImportTemplate,
  };
}

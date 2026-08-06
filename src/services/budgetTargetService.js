import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const uploadDir = path.join(process.cwd(), "uploads", "budget-targets");
const summaryDir = path.join(process.cwd(), "data-cache", "budget-targets");
const allowedExt = ".xlsx";
const BUDGET_SUMMARY_SCHEMA_VERSION = 2;

function isAppleDoubleFile(name = "") {
  return path.basename(String(name || "")).startsWith("._");
}

function safeFileName(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  if (ext !== allowedExt) {
    throw new Error("只支持上传 .xlsx 预算模板");
  }

  const baseName = path
    .basename(fileName, ext)
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return `${baseName || "budget-target"}${ext}`;
}

function decodeBase64File(base64) {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("上传文件内容为空");
  }

  const cleaned = base64.includes(",") ? base64.split(",").pop() : base64;
  return Buffer.from(cleaned, "base64");
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .toLowerCase();
}

const headerAliases = {
  MSKU: ["MSKU", "MSKU/FNSKU", "卖家SKU", "SellerSKU"],
  ASIN: ["ASIN"],
  产品名称: ["产品名称", "产品名", "商品名称", "品名", "SKU名称", "本地品名", "产品中文名", "LocalName"],
  SKU负责人: ["SKU负责人", "Listing负责人", "listing负责人", "负责人", "销售员"],
  "销售价($)": ["销售价($)", "售价($)", "单价($)", "销售单价($)"],
  销售数量: ["销售数量", "本月销量", "销量", "销售量", "月销量"],
  发货数量: ["发货数量", "本月发货", "发货量"],
  "销额($)": ["销额($)", "销额(原币)", "销售额($)", "销售额(原币)", "销售目标($)", "销售目标(原币)", "销售收入($)", "销售收入(原币)", "目标销售额($)", "销售额"],
  "单个折扣($)": ["单个折扣($)", "单个折扣(原币)", "单件折扣($)", "单件折扣(原币)", "折扣($)"],
  "折扣总额($)": ["折扣总额($)", "折扣总额(原币)", "折扣金额($)", "折扣金额(原币)", "优惠折扣($)"],
  "退款金额($)": ["退款金额($)", "退款金额(原币)", "退款目标($)", "退款目标(原币)", "退款($)", "退货退款($)"],
  "广告费用($)": ["广告费用($)", "广告费用(原币)", "广告预算($)", "广告预算(原币)", "广告花费($)", "广告花费(原币)", "广告费($)"],
  "FBA配送费($)": ["FBA配送费($)", "FBA配送费(原币)", "FBA费($)", "FBA费(原币)", "配送费($)"],
  "总成本($)": ["总成本($)", "总成本（$）", "总成本(原币)", "采购成本($)", "采购成本(原币)", "货品成本($)"],
  "总头程费用($)": ["总头程费用($)", "总头程费用（$）", "总头程费用(原币)", "头程费用($)", "头程费用(原币)", "头程费($)"],
  "仓储费（$）": ["仓储费($)", "仓储费（$）", "仓储费(原币)", "仓库费用(月仓储费)", "仓库费用（月仓储费）"],
  "长期仓储费（$）": ["长期仓储费($)", "长期仓储费（$）", "长期仓储费(原币)", "仓库费用(长期仓储费)", "仓库费用（长期仓储费）"],
  "优惠券佣金（$）": ["优惠券佣金($)", "优惠券佣金（$）", "优惠券佣金(原币)", "Coupon佣金($)"],
  汇率: ["汇率", "ExchangeRate"],
};

function normalizeMetricName(value) {
  return normalizeText(value)
    .replace(/[：:]/g, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseYearFromFileName(fileName) {
  const matched = String(fileName || "").match(/(\d{4})年\d{1,2}月/);
  return matched ? Number(matched[1]) : new Date().getFullYear();
}

function parseYearMonthValue(value, fallbackYear) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }

  const text = normalizeText(value);
  if (!text) return "";

  const fullMatch = text.match(/(\d{4})\s*[年/-]\s*(\d{1,2})/);
  if (fullMatch) return `${fullMatch[1]}-${String(fullMatch[2]).padStart(2, "0")}`;

  const monthMatch = text.match(/^(\d{1,2})(?:月)?$/);
  if (monthMatch) {
    const month = Number(monthMatch[1]);
    if (month >= 1 && month <= 12) return `${fallbackYear}-${String(month).padStart(2, "0")}`;
  }

  return "";
}

function findWorkbookMonth(summaryRows, fallbackYear) {
  for (let rowIndex = 0; rowIndex < Math.min(summaryRows.length, 12); rowIndex += 1) {
    const row = summaryRows[rowIndex] || [];
    for (let colIndex = 0; colIndex < Math.min(row.length, 8); colIndex += 1) {
      const label = normalizeText(row[colIndex]);
      if (!/预算.*月份|预算月|月份/.test(label)) continue;

      const candidates = [row[colIndex + 1], row[colIndex + 2], summaryRows[rowIndex + 1]?.[colIndex]];
      for (const candidate of candidates) {
        const parsed = parseYearMonthValue(candidate, fallbackYear);
        if (parsed) return parsed;
      }
    }
  }

  return "";
}

function normalizeBudgetMonth(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const matched = text.match(/^(\d{4})-(\d{1,2})$/);
  if (!matched) return "";
  const month = Number(matched[2]);
  if (month < 1 || month > 12) return "";
  return `${matched[1]}-${String(month).padStart(2, "0")}`;
}

function inferBudgetMonth(range = {}) {
  return (
    normalizeBudgetMonth(range.budgetMonth) ||
    normalizeBudgetMonth(String(range.endDate || "").slice(0, 7)) ||
    normalizeBudgetMonth(String(range.startDate || "").slice(0, 7))
  );
}

function normalizeRequestedBudgetMonth(value) {
  const month = normalizeBudgetMonth(value);
  if (!month) throw new Error("预算月份必须为 YYYY-MM");
  return month;
}

function normalizeRequestedTextList(values, label, normalizer = normalizeText) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${label}必须是数组`);
  }
  return new Set(values.map(normalizer).filter(Boolean));
}

function normalizeBudgetCountryKey(value) {
  const country = normalizeText(value).replace(/站$/, "");
  return country === "澳大利亚" ? "澳洲" : country;
}

function normalizeBudgetContextMonths(range = {}) {
  if (range.months !== undefined) {
    if (!Array.isArray(range.months)) {
      throw new TypeError("months必须是数组");
    }
    return new Set(range.months.map(normalizeRequestedBudgetMonth));
  }

  const hasLegacyMonthInput = [range.budgetMonth, range.startDate, range.endDate]
    .some((value) => normalizeText(value));
  if (!hasLegacyMonthInput) return new Set();

  const month = inferBudgetMonth(range);
  if (!month) throw new Error("预算月份必须为 YYYY-MM");
  return new Set([month]);
}

function summarizeBudgetTargetRows(rows = []) {
  const sumMetric = (field) => {
    if (!rows.length) return 0;
    const values = rows.map((row) => parseOptionalNumber(row[field]));
    return values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
  };
  const totals = {
    storeCount: rows.length,
    skuCount: rows.reduce((sum, row) => sum + (parseOptionalNumber(row.skuCount) ?? 0), 0),
    salesTarget: sumMetric("salesTarget"),
    adBudget: sumMetric("adBudget"),
    refundTarget: sumMetric("refundTarget"),
    profitTarget: sumMetric("profitTarget"),
  };

  totals.acosTarget = totals.salesTarget && totals.adBudget !== null ? totals.adBudget / totals.salesTarget : null;
  totals.profitRateTarget = totals.salesTarget && totals.profitTarget !== null ? totals.profitTarget / totals.salesTarget : null;
  return totals;
}

function parseMonth(fileName, summaryRows, selectedMonth = "") {
  const normalizedSelectedMonth = normalizeBudgetMonth(selectedMonth);
  if (normalizedSelectedMonth) return normalizedSelectedMonth;

  const fallbackYear = parseYearFromFileName(fileName);
  const workbookMonth = findWorkbookMonth(summaryRows, fallbackYear);
  if (workbookMonth) return workbookMonth;

  const matched = String(fileName || "").match(/(\d{4})年(\d{1,2})月/);
  if (matched) return `${matched[1]}-${String(matched[2]).padStart(2, "0")}`;

  return "";
}

function inferStoreName(fileName, title) {
  const fromName = fileName.replace(/-\d{4}年\d{1,2}月.*$/, "").replace(/\.xlsx$/i, "");
  if (fromName) return fromName;
  return normalizeText(title).replace("店铺预算报表", "") || "未命名店铺";
}

function inferSite(storeName) {
  if (storeName.includes("美国")) return "美国站";
  if (storeName.includes("加拿大")) return "加拿大站";
  if (storeName.includes("澳洲") || storeName.includes("澳大利亚")) return "澳洲站";
  if (storeName.includes("英国")) return "英国站";
  if (storeName.includes("德国")) return "德国站";
  return storeName;
}

function sumByHeader(rows, headerMap, headerName, formulaFallback) {
  const index = headerMap.get(headerName);
  if (index == null) {
    return typeof formulaFallback === "function" ? rows.reduce((sum, row) => sum + parseNumber(formulaFallback(row)), 0) : 0;
  }
  return rows.reduce((sum, row) => sum + parseNumber(row[index] ?? formulaFallback?.(row)), 0);
}

function sumByHeaderOptional(rows, headerMap, headerName, formulaFallback) {
  const index = headerMap.get(headerName);
  const values = rows.map((row) => {
    const direct = index == null ? null : parseOptionalNumber(row[index]);
    if (direct !== null) return direct;
    return typeof formulaFallback === "function" ? parseOptionalNumber(formulaFallback(row)) : null;
  });
  return values.length && values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function readByHeader(row, headerMap, headerName) {
  const index = headerMap.get(headerName);
  return index == null ? "" : row[index];
}

function buildHeaderMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const key = normalizeText(header);
    if (key) map.set(key, index);

    const normalizedKey = normalizeHeader(header);
    Object.entries(headerAliases).forEach(([canonicalName, aliases]) => {
      if (map.has(canonicalName)) return;
      const matched = aliases.some((alias) => normalizeHeader(alias) === normalizedKey);
      if (matched) map.set(canonicalName, index);
    });
  });
  return map;
}

function findHeaderRowIndex(rows) {
  const maxRows = Math.min(rows.length, 16);
  for (let index = 0; index < maxRows; index += 1) {
    const headerMap = buildHeaderMap(rows[index] || []);
    if (headerMap.has("MSKU") && (headerMap.has("销售数量") || headerMap.has("销额($)") || headerMap.has("销售价($)"))) {
      return index;
    }
    if (headerMap.has("ASIN") && (headerMap.has("MSKU") || headerMap.has("销售数量") || headerMap.has("销额($)"))) {
      return index;
    }
  }
  return -1;
}

function readSheetRows(workbook, XLSX, sheetName) {
  if (!sheetName || !workbook.Sheets[sheetName]) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
}

function findBudgetRows(workbook, XLSX) {
  const secondSheetRows = readSheetRows(workbook, XLSX, workbook.SheetNames[1]);
  if (findHeaderRowIndex(secondSheetRows) !== -1) return secondSheetRows;

  const preferredRows = readSheetRows(workbook, XLSX, "销售预算");
  if (findHeaderRowIndex(preferredRows) !== -1) return preferredRows;

  for (const sheetName of workbook.SheetNames) {
    const rows = readSheetRows(workbook, XLSX, sheetName);
    if (findHeaderRowIndex(rows) !== -1) return rows;
  }

  return preferredRows;
}

function readSummaryOriginalValue(rows, labels) {
  const normalizedLabels = labels.map(normalizeMetricName);
  for (const target of normalizedLabels) {
    for (const row of rows) {
      if (normalizeMetricName(row?.[0]) !== target) continue;
      return parseOptionalNumber(row?.[1]);
    }
  }

  for (const target of normalizedLabels) {
    for (const row of rows) {
      const metricName = normalizeMetricName(row?.[0]);
      if (metricName && metricName.includes(target)) return parseOptionalNumber(row?.[1]);
    }
  }

  return null;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined) ?? null;
}

function normalizeBudgetCurrencyCode(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return "";
  if (["$", "US$", "美元", "美金"].includes(text)) return "USD";
  const matched = text.match(/\b[A-Z]{3}\b/);
  return matched ? matched[0] : "";
}

function findExplicitBudgetCurrencyCode(summaryRows, headers) {
  for (const row of summaryRows.slice(0, 12)) {
    for (let index = 0; index < Math.min(row.length, 8); index += 1) {
      if (!/币种|currency/i.test(normalizeText(row[index]))) continue;
      const code = normalizeBudgetCurrencyCode(row[index + 1]);
      if (code) return code;
    }
  }
  for (const header of headers) {
    const text = normalizeText(header);
    const parenthesized = text.match(/[（(]([A-Za-z]{3})[）)]/);
    if (parenthesized) return parenthesized[1].toUpperCase();
  }
  return "";
}

function buildStoreSummaryTargets(summaryRows, fallback = {}) {
  const salesTarget = firstPresent(readSummaryOriginalValue(summaryRows, ["销售收入"]), readSummaryOriginalValue(summaryRows, ["销售收入净额"]), fallback.salesTarget);
  const adBudget = firstPresent(readSummaryOriginalValue(summaryRows, ["广告费用"]), fallback.adBudget);
  const refundTarget = firstPresent(readSummaryOriginalValue(summaryRows, ["退款金额"]), fallback.refundTarget);
  const purchaseCost = firstPresent(readSummaryOriginalValue(summaryRows, ["商品采购成本"]), fallback.purchaseCost);
  const shippingCost = firstPresent(readSummaryOriginalValue(summaryRows, ["头程运费"]), fallback.shippingCost);
  const profitTarget = firstPresent(readSummaryOriginalValue(summaryRows, ["营业利润"]), fallback.profitTarget);
  const netSales = readSummaryOriginalValue(summaryRows, ["销售收入净额"]);
  const platformFee = readSummaryOriginalValue(summaryRows, ["平台费用合计"]);
  const domesticExpense = readSummaryOriginalValue(summaryRows, ["国内支出费用合计"]);

  return {
    salesTarget,
    adBudget,
    refundTarget,
    purchaseCost,
    shippingCost,
    profitTarget,
    netSales,
    platformFee,
    domesticExpense,
    acosTarget: salesTarget && adBudget !== null ? adBudget / salesTarget : null,
    profitRateTarget: salesTarget && profitTarget !== null ? profitTarget / salesTarget : null,
  };
}

async function parseBudgetWorkbook(filePath, fileName, storedName, selectedMonth = "") {
  let XLSX;
  try {
    const module = await import("xlsx");
    XLSX = module.default || module;
  } catch {
    return {
      fileName,
      storedName,
      status: "已上传，等待安装解析依赖",
      parseError: "服务器需要先执行 npm install，安装 Excel 解析依赖。",
    };
  }

  const workbookContent = await readFile(filePath);
  const workbook = XLSX.read(workbookContent, { type: "buffer", cellDates: false });
  const summarySheetName = workbook.SheetNames.find((name) => !["销售预算", "Sheet1", "销量预估", "出货"].includes(name)) || workbook.SheetNames[0];
  const summaryRows = readSheetRows(workbook, XLSX, summarySheetName);
  const budgetRows = findBudgetRows(workbook, XLSX);

  const headerRowIndex = findHeaderRowIndex(budgetRows);
  const headers = headerRowIndex >= 0 ? budgetRows[headerRowIndex] || [] : [];
  const headerMap = buildHeaderMap(headers);
  const dataRows = budgetRows
    .slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 1)
    .filter((row) => normalizeText(row[headerMap.get("MSKU")]) || normalizeText(row[headerMap.get("ASIN")]));

  if (headerRowIndex < 0) {
    return {
      fileName,
      storedName,
      status: "解析异常",
      parseError: "未找到销售预算明细表头，请确认文件中包含 MSKU/ASIN、销售数量或销售额等列。",
    };
  }

  if (!dataRows.length) {
    return {
      fileName,
      storedName,
      status: "解析异常",
      parseError: "未找到有效的 MSKU/ASIN 明细行，请确认预算明细不是空表，且 MSKU/ASIN 列有内容。",
    };
  }
  const priceIndex = headerMap.get("销售价($)");
  const qtyIndex = headerMap.get("销售数量");
  const discountIndex = headerMap.get("单个折扣($)");

  const optionalSalesTarget = sumByHeaderOptional(dataRows, headerMap, "销额($)", (row) => {
    const price = parseOptionalNumber(row[priceIndex]);
    const quantity = parseOptionalNumber(row[qtyIndex]);
    return price === null || quantity === null ? null : price * quantity;
  });
  const optionalRefundTarget = sumByHeaderOptional(dataRows, headerMap, "退款金额($)");
  const optionalAdBudget = sumByHeaderOptional(dataRows, headerMap, "广告费用($)");
  const optionalDiscountTarget = sumByHeaderOptional(dataRows, headerMap, "折扣总额($)", (row) => {
    const discount = parseOptionalNumber(row[discountIndex]);
    const quantity = parseOptionalNumber(row[qtyIndex]);
    return discount === null || quantity === null ? null : discount * quantity;
  });
  const optionalFbaFee = sumByHeaderOptional(dataRows, headerMap, "FBA配送费($)");
  const optionalPurchaseCost = sumByHeaderOptional(dataRows, headerMap, "总成本($)");
  const optionalShippingCost = sumByHeaderOptional(dataRows, headerMap, "总头程费用($)");
  const optionalStorageFee = sumByHeaderOptional(dataRows, headerMap, "仓储费（$）");
  const optionalLongTermStorageFee = sumByHeaderOptional(dataRows, headerMap, "长期仓储费（$）");
  const optionalCouponCommission = sumByHeaderOptional(dataRows, headerMap, "优惠券佣金（$）");

  const salesTarget = sumByHeader(dataRows, headerMap, "销额($)", (row) => parseNumber(row[priceIndex]) * parseNumber(row[qtyIndex]));
  const discountTarget = sumByHeader(dataRows, headerMap, "折扣总额($)", (row) => parseNumber(row[discountIndex]) * parseNumber(row[qtyIndex]));
  const refundTarget = sumByHeader(dataRows, headerMap, "退款金额($)");
  const adBudget = sumByHeader(dataRows, headerMap, "广告费用($)");
  const fbaFee = sumByHeader(dataRows, headerMap, "FBA配送费($)");
  const purchaseCost = sumByHeader(dataRows, headerMap, "总成本（$）") || sumByHeader(dataRows, headerMap, "总成本($)");
  const shippingCost = sumByHeader(dataRows, headerMap, "总头程费用（$）") || sumByHeader(dataRows, headerMap, "总头程费用($)");
  const storageFee = sumByHeader(dataRows, headerMap, "仓储费（$）") + sumByHeader(dataRows, headerMap, "长期仓储费（$）");
  const couponCommission = sumByHeader(dataRows, headerMap, "优惠券佣金（$）");
  const shipmentQty = sumByHeader(dataRows, headerMap, "发货数量");
  const salesQty = sumByHeader(dataRows, headerMap, "销售数量");
  const exchangeRate = parseNumber(summaryRows[1]?.[3]) || parseNumber(dataRows.find((row) => parseNumber(row[headerMap.get("汇率")]))?.[headerMap.get("汇率")]) || 1;
  const title = summaryRows[0]?.[0];
  const storeName = inferStoreName(fileName, title);
  const netSales = salesTarget - discountTarget - refundTarget + salesTarget * 0.0025;
  const platformFee = adBudget + couponCommission + salesTarget * 0.15 + fbaFee + storageFee;
  const profitTarget = netSales - purchaseCost - platformFee - shippingCost;
  const profitDependencies = [
    optionalSalesTarget,
    optionalDiscountTarget,
    optionalRefundTarget,
    optionalAdBudget,
    optionalFbaFee,
    optionalPurchaseCost,
    optionalShippingCost,
    optionalStorageFee,
    optionalLongTermStorageFee,
    optionalCouponCommission,
  ];
  const storeTargets = buildStoreSummaryTargets(summaryRows, {
    salesTarget: optionalSalesTarget,
    adBudget: optionalAdBudget,
    refundTarget: optionalRefundTarget,
    purchaseCost,
    shippingCost,
    profitTarget: profitDependencies.every((value) => value !== null) ? profitTarget : null,
  });
  const month = parseMonth(fileName, summaryRows, selectedMonth);
  const platform = storeName.includes("Tik Tok") ? "Tik Tok" : "Amazon";
  const site = inferSite(storeName);
  const currencyCode = findExplicitBudgetCurrencyCode(summaryRows, headers);
  const mskuRows = dataRows.map((row) => {
    const rowSalesTarget = parseNumber(readByHeader(row, headerMap, "销额($)")) || parseNumber(row[priceIndex]) * parseNumber(row[qtyIndex]);
    const rowDiscountTarget = parseNumber(readByHeader(row, headerMap, "折扣总额($)")) || parseNumber(readByHeader(row, headerMap, "单个折扣($)")) * parseNumber(row[qtyIndex]);
    const rowRefundTarget = parseNumber(readByHeader(row, headerMap, "退款金额($)"));
    const rowAdBudget = parseNumber(readByHeader(row, headerMap, "广告费用($)"));
    const rowFbaFee = parseNumber(readByHeader(row, headerMap, "FBA配送费($)"));
    const rowStorageFee = parseNumber(readByHeader(row, headerMap, "仓储费（$）")) + parseNumber(readByHeader(row, headerMap, "长期仓储费（$）"));
    const rowCouponCommission = parseNumber(readByHeader(row, headerMap, "优惠券佣金（$）"));
    const rowPurchaseCost = parseNumber(readByHeader(row, headerMap, "总成本（$）")) || parseNumber(readByHeader(row, headerMap, "总成本($)"));
    const rowShippingCost = parseNumber(readByHeader(row, headerMap, "总头程费用（$）")) || parseNumber(readByHeader(row, headerMap, "总头程费用($)"));
    const rowNetSales = rowSalesTarget - rowDiscountTarget - rowRefundTarget + rowSalesTarget * 0.0025;
    const rowPlatformFee = rowAdBudget + rowCouponCommission + rowSalesTarget * 0.15 + rowFbaFee + rowStorageFee;
    const rowProfitTarget = rowNetSales - rowPurchaseCost - rowPlatformFee - rowShippingCost;

    return {
      fileName,
      storedName,
      status: "已解析",
      month,
      platform,
      storeName,
      site,
      currencyCode,
      skuOwner: normalizeText(readByHeader(row, headerMap, "SKU负责人")),
      msku: normalizeText(readByHeader(row, headerMap, "MSKU")),
      asin: normalizeText(readByHeader(row, headerMap, "ASIN")),
      productName: normalizeText(readByHeader(row, headerMap, "产品名称")),
      salesQty: parseNumber(readByHeader(row, headerMap, "销售数量")),
      shipmentQty: parseNumber(readByHeader(row, headerMap, "发货数量")),
      salesTarget: rowSalesTarget,
      adBudget: rowAdBudget,
      refundTarget: rowRefundTarget,
      fbaFee: rowFbaFee,
      storageFee: rowStorageFee,
      couponCommission: rowCouponCommission,
      purchaseCost: rowPurchaseCost,
      shippingCost: rowShippingCost,
      platformFee: rowPlatformFee,
      profitTarget: rowProfitTarget,
      acosTarget: rowSalesTarget ? rowAdBudget / rowSalesTarget : 0,
      profitRateTarget: rowSalesTarget ? rowProfitTarget / rowSalesTarget : 0,
    };
  });

  return {
    fileName,
    storedName,
    status: "已解析",
    month,
    platform,
    storeName,
    site,
    currencyCode,
    skuCount: dataRows.length,
    salesQty,
    shipmentQty,
    exchangeRate,
    salesTarget: storeTargets.salesTarget,
    adBudget: storeTargets.adBudget,
    refundTarget: storeTargets.refundTarget,
    purchaseCost: storeTargets.purchaseCost,
    shippingCost: storeTargets.shippingCost,
    profitTarget: storeTargets.profitTarget,
    netSales: storeTargets.netSales,
    platformFee: storeTargets.platformFee,
    domesticExpense: storeTargets.domesticExpense,
    acosTarget: storeTargets.acosTarget,
    profitRateTarget: storeTargets.profitRateTarget,
    mskuRows,
    parsedAt: new Date().toISOString(),
    schemaVersion: BUDGET_SUMMARY_SCHEMA_VERSION,
  };
}

async function summaryPath(storedName) {
  await mkdir(summaryDir, { recursive: true });
  return path.join(summaryDir, `${storedName}.json`);
}

async function saveSummary(summary) {
  const filePath = await summaryPath(summary.storedName);
  await writeFile(filePath, JSON.stringify(summary, null, 2));
  return summary;
}

async function readSummary(storedName) {
  try {
    const filePath = await summaryPath(storedName);
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function parseAndSaveBudgetUpload(upload) {
  const filePath = path.join(uploadDir, upload.storedName);
  const summary = await parseBudgetWorkbook(filePath, upload.fileName, upload.storedName, upload.budgetMonth);
  return saveSummary(summary);
}

async function removeFileIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function findDuplicateBudgetSummaries(summary) {
  let names = [];
  try {
    names = await readdir(summaryDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const duplicates = [];
  await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const storedName = name.replace(/\.json$/, "");
        if (storedName === summary.storedName) return;
        try {
          const existing = JSON.parse(await readFile(path.join(summaryDir, name), "utf8"));
          if (existing?.month === summary.month && existing?.storeName === summary.storeName) {
            duplicates.push({
              storedName,
              fileName: existing.fileName || storedName,
              month: existing.month,
              storeName: existing.storeName,
            });
          }
        } catch {
          // Skip broken historical summaries; they will not participate in active budget totals.
        }
      }),
  );
  return duplicates;
}

async function replaceDuplicateBudgetUploads(summary) {
  const duplicates = await findDuplicateBudgetSummaries(summary);
  await Promise.all(
    duplicates.map((item) => Promise.all([
      removeFileIfExists(path.join(uploadDir, item.storedName)),
      removeFileIfExists(path.join(summaryDir, `${item.storedName}.json`)),
    ])),
  );
  return duplicates;
}

export async function saveBudgetUpload(payload) {
  const fileName = safeFileName(payload.fileName);
  const budgetMonth = normalizeBudgetMonth(payload.budgetMonth);
  if (!budgetMonth) {
    throw new Error("请先选择预算月份");
  }
  const content = decodeBase64File(payload.base64);

  if (content.length === 0) {
    throw new Error("上传文件内容为空");
  }

  await mkdir(uploadDir, { recursive: true });
  const uploadedAt = new Date().toISOString();
  const storedName = `${uploadedAt.replace(/[:.]/g, "-")}-${fileName}`;
  const filePath = path.join(uploadDir, storedName);
  await writeFile(filePath, content);

  const upload = {
    fileName,
    storedName,
    size: content.length,
    uploadedAt,
    budgetMonth,
    status: "已上传，等待解析",
  };

  const summary = await parseBudgetWorkbook(filePath, upload.fileName, upload.storedName, upload.budgetMonth);
  const replacedUploads = summary.status === "已解析" ? await replaceDuplicateBudgetUploads(summary) : [];
  const finalSummary = await saveSummary({
    ...summary,
    replacedCount: replacedUploads.length,
    replacedUploads,
    replaceMessage: replacedUploads.length ? "已覆盖旧预算" : "",
  });
  return {
    ...upload,
    status: replacedUploads.length ? "已覆盖旧预算" : finalSummary.status,
    replacedCount: replacedUploads.length,
    summary: finalSummary,
  };
}

export async function listBudgetUploads() {
  try {
    const names = await readdir(uploadDir);
    const rows = await Promise.all(
      names
        .filter((name) => !isAppleDoubleFile(name) && path.extname(name).toLowerCase() === allowedExt)
        .map(async (name) => {
          const filePath = path.join(uploadDir, name);
          const info = await stat(filePath);
          const upload = {
            storedName: name,
            fileName: name.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-/, ""),
            size: info.size,
            uploadedAt: info.mtime.toISOString(),
            status: "已上传，等待解析",
          };

          let summary = await readSummary(name);
          if (!summary
            || summary.status !== "已解析"
            || !Array.isArray(summary.mskuRows)
            || summary.schemaVersion !== BUDGET_SUMMARY_SCHEMA_VERSION
            || !Object.hasOwn(summary, "currencyCode")) {
            summary = await parseAndSaveBudgetUpload(upload);
          }
          return {
            ...upload,
            status: summary.replaceMessage || summary.status,
            summary,
          };
        }),
    );

    return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function listBudgetTargets() {
  const uploads = await listBudgetUploads();
  const rows = uploads.map((upload) => upload.summary).filter((summary) => summary && summary.status === "已解析");
  const mskuRows = rows.flatMap((row) => row.mskuRows || []);
  const totals = summarizeBudgetTargetRows(rows);

  return { rows, mskuRows, totals };
}

export async function getBudgetTargetContext(range = {}) {
  if (!range || typeof range !== "object" || Array.isArray(range)) {
    throw new TypeError("预算筛选条件必须是对象");
  }
  const monthSet = normalizeBudgetContextMonths(range);
  const storeSet = normalizeRequestedTextList(range.storeNames ?? [], "storeNames");
  const countrySet = normalizeRequestedTextList(range.countries ?? [], "countries", normalizeBudgetCountryKey);
  const targets = await listBudgetTargets();
  const rows = targets.rows.filter((row) =>
    (!monthSet.size || monthSet.has(normalizeBudgetMonth(row.month)))
    && (!storeSet.size || storeSet.has(normalizeText(row.storeName)))
    && (!countrySet.size || countrySet.has(normalizeBudgetCountryKey(row.site))),
  );

  return {
    month: monthSet.size === 1 ? [...monthSet][0] : "",
    months: [...monthSet],
    rows,
    totals: summarizeBudgetTargetRows(rows),
    matched: rows.length > 0,
  };
}

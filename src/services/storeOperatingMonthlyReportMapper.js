const METRICS = [
  ["sales-income", "销售收入", "totalSalesAmount", "revenue"],
  ["sales-discount", "销售折扣", "promotionDiscount", "revenue"],
  ["refunds", "退款金额", "totalSalesRefunds", "revenue"],
  ["net-sales", "销售收入净额", "netSalesAmount", "revenue"],
  ["purchase-cost", "商品采购成本", "purchaseCost", "sales-cost"],
  ["first-leg-cost", "头程费用", "firstLegCost", "logistics"],
  ["storage-fee", "平台仓储费用", "storageFee", "storage"],
  ["ad-spend", "推广费用", "totalAdsCost", "advertising"],
  ["platform-fee", "平台费用", "platformFee", "platform"],
  ["fba-delivery-fee", "FBA 配送费", "fbaDeliveryFee", "logistics"],
  ["sales-profit", "销售利润", "grossProfit", "sales-profit-category"],
];

const BUDGET_METRICS = new Set(["net-sales", "ad-spend", "refunds", "sales-profit"]);

const BUDGET_FIELDS = [
  ["net-sales", "salesTarget"],
  ["ad-spend", "adBudget"],
  ["refunds", "refundTarget"],
  ["sales-profit", "profitTarget"],
];

const CATEGORIES = [
  ["revenue", "销售收入"],
  ["sales-cost", "销售成本"],
  ["gross-profit", "销售毛利"],
  ["storage", "平台仓储"],
  ["advertising", "推广费用"],
  ["logistics", "物流费用"],
  ["platform", "平台费用"],
  ["operations", "运营费用"],
  ["management", "管理费用"],
  ["labor", "人力费用"],
  ["asset-impairment", "资产减值"],
  ["non-operating", "营业外收支"],
  ["non-operating-income", "营业外收入"],
  ["non-operating-expense", "营业外支出"],
  ["sales-profit-category", "销售利润"],
];

function isPresent(value) {
  return value !== "" && value !== null && value !== undefined;
}

function readText(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (isPresent(value) && String(value).trim()) return String(value).trim();
  }
  return "";
}

function readValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (isPresent(value)) return value;
  }
  return "";
}

function toFiniteNumber(value, field) {
  const isFiniteNumber = typeof value === "number" && Number.isFinite(value);
  const isNumericString = typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
  if (!isFiniteNumber && !isNumericString) {
    throw new Error(`${field} 必须是有限数字`);
  }
  return Number(value);
}

function sumPresent(records, field) {
  if (records.length === 0) return null;
  const values = records.map((row) => row[field]).filter(isPresent);
  if (values.length !== records.length) return null;
  return values.reduce((sum, value) => sum + toFiniteNumber(value, `订单利润字段 ${field}`), 0);
}

function readBudget(budgetByMetric, key) {
  if (!BUDGET_METRICS.has(key) || !Object.hasOwn(budgetByMetric, key) || !isPresent(budgetByMetric[key])) {
    return null;
  }
  return toFiniteNumber(budgetByMetric[key], `预算科目 ${key}`);
}

function deriveFromRequiredChildren(actualByKey, children, calculate) {
  const values = children.map((key) => actualByKey.get(key));
  return values.every((value) => value !== null && value !== undefined) ? calculate(values) : null;
}

function createRow({ key, category, name, level, actual, budget = null, children = [] }, netSales) {
  const available = actual !== null;
  return {
    key,
    category,
    name,
    level,
    actual,
    budget,
    share: available && netSales !== null && netSales !== 0 ? actual / netSales : null,
    achievement: available && budget !== null && budget !== 0 ? actual / budget : null,
    available,
    children,
  };
}

export function mapStoreOperatingBudgetMetrics(totals = {}) {
  if (totals === null || typeof totals !== "object" || Array.isArray(totals)) {
    throw new Error("预算汇总必须是对象");
  }
  return Object.fromEntries(BUDGET_FIELDS.flatMap(([metric, field]) => {
    if (!Object.hasOwn(totals, field) || !isPresent(totals[field])) return [];
    return [[metric, toFiniteNumber(totals[field], `预算字段 ${field}`)]];
  }));
}

export function normalizeStoreOperatingCountryKey(value) {
  const country = String(value ?? "").trim().replace(/站$/, "");
  return country === "澳大利亚" ? "澳洲" : country;
}

export function mapStoreOperatingSellerScope(seller = {}) {
  return {
    sid: readValue(seller, ["sid", "seller_id", "sellerId", "store_id", "storeId"]),
    name: readText(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]),
    country: normalizeStoreOperatingCountryKey(readText(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName"])),
  };
}

export function mapStoreOperatingOrderProfitBudgetScope(record = {}) {
  return {
    month: readText(record, ["reportDate", "report_date", "date"]).slice(0, 7),
    storeName: readText(record, ["storeName", "store_name"]),
    country: normalizeStoreOperatingCountryKey(readText(record, ["country", "countryName", "country_name"])),
  };
}

export function mapStoreOperatingBudgetRowScope(row = {}) {
  return {
    month: readText(row, ["month", "budgetMonth"]).slice(0, 7),
    storeName: readText(row, ["storeName", "store_name"]),
    country: normalizeStoreOperatingCountryKey(readText(row, ["site", "country", "countryName"])),
  };
}

export function readStoreOperatingBudgetCurrencyCode(row = {}) {
  return readText(row, ["currencyCode", "currency_code", "currency"]);
}

export function buildStoreOperatingReportRows({ records, budgetByMetric = {}, currencyCode } = {}) {
  if (!Array.isArray(records)) {
    throw new Error("订单利润 records 必须是数组");
  }
  if (budgetByMetric === null || typeof budgetByMetric !== "object" || Array.isArray(budgetByMetric)) {
    throw new Error("预算科目必须是对象");
  }
  if (currencyCode !== undefined && typeof currencyCode !== "string") {
    throw new Error("币种代码必须是字符串");
  }

  const metricActuals = new Map(METRICS.map(([key, _name, field]) => [key, sumPresent(records, field)]));
  const netSales = metricActuals.get("net-sales");
  const metricsByCategory = new Map(CATEGORIES.map(([key]) => [key, []]));
  const metricRows = METRICS.map(([key, name, _field, category]) => {
    metricsByCategory.get(category).push(key);
    return createRow({
      key,
      category: CATEGORIES.find(([categoryKey]) => categoryKey === category)[1],
      name,
      level: 2,
      actual: metricActuals.get(key),
      budget: readBudget(budgetByMetric, key),
    }, netSales);
  });

  const actualByKey = new Map(metricRows.map((row) => [row.key, row.actual]));
  actualByKey.set("revenue", actualByKey.get("net-sales"));
  actualByKey.set("sales-cost", actualByKey.get("purchase-cost"));
  const grossProfitChildren = ["revenue", "sales-cost"];
  actualByKey.set("gross-profit", deriveFromRequiredChildren(
    actualByKey,
    grossProfitChildren,
    ([revenue, salesCost]) => revenue - salesCost,
  ));

  const categoryRows = CATEGORIES.map(([key, name]) => createRow({
    key,
    category: name,
    name,
    level: 1,
    actual: actualByKey.get(key) ?? null,
    children: key === "gross-profit" ? grossProfitChildren : metricsByCategory.get(key),
  }, netSales));
  const overview = createRow({
    key: "overview",
    category: "总概",
    name: "总概",
    level: 0,
    actual: null,
    children: CATEGORIES.map(([key]) => key),
  }, netSales);
  const rows = [overview, ...categoryRows.flatMap((category) => [
    category,
    ...metricRows.filter((metric) => metric.category === category.name),
  ])];

  return {
    rows,
    unavailableMetrics: rows.filter((row) => !row.available && row.level === 2).map((row) => row.key),
  };
}

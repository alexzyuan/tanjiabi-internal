const METRIC_DEFINITIONS = [
  { key: "sales-income", name: "销售收入", fields: ["totalSalesAmount", "salesAmount", "sales_amount", "amount"], category: "platform-income" },
  { key: "sales-discount", name: "销售折扣", fields: ["promotionDiscount", "promotion_discount", "discount_amount"], category: "platform-income", magnitude: true },
  { key: "refunds", name: "退款金额", fields: ["totalSalesRefunds", "refunds", "refund_amount", "refundAmount"], category: "platform-income", magnitude: true },
  { key: "purchase-cost", name: "销售成本", fields: ["purchaseCost", "purchase_costs", "purchase_cost", "goods_cost"], category: "product-cost-expense", magnitude: true },
  { key: "first-leg-cost", name: "头程费用", fields: ["firstLegCost", "logistics_costs", "shipping_cost"], category: "product-cost-expense", magnitude: true },
  { key: "storage-fee", name: "平台仓储费用", fields: ["storageFee", "total_stock_fee", "storage_fee"], category: "platform-expense", magnitude: true },
  { key: "ad-spend", name: "推广费用", fields: ["totalAdsCost", "adsCost", "ads_cost", "spend"], category: "platform-expense", magnitude: true },
  { key: "platform-fee", name: "平台费用", fields: ["platformFee", "platform_fee", "selling_fee"], category: "platform-expense", magnitude: true },
  { key: "fba-delivery-fee", name: "FBA 配送费", fields: ["fbaDeliveryFee", "fulfillment_fee", "fba_fulfillment_fee"], category: "platform-expense", magnitude: true },
  { key: "operations", name: "运营费用", fields: ["operationsCost", "operations_cost", "operating_cost", "operating_expense"], category: "custom-expense", magnitude: true },
  { key: "management", name: "管理费用", fields: ["managementCost", "management_cost", "management_expense"], category: "custom-expense", magnitude: true },
  { key: "labor", name: "人力费用", fields: ["laborCost", "labor_cost", "labor_expense"], category: "custom-expense", magnitude: true },
  { key: "asset-impairment", name: "资产减值", fields: ["assetImpairment", "asset_impairment", "impairment_loss"], category: "custom-expense", magnitude: true },
  { key: "non-operating-income", name: "营业外收入", fields: ["nonOperatingIncome", "non_operating_income"], category: "custom-expense" },
  { key: "non-operating-expense", name: "营业外支出", fields: ["nonOperatingExpense", "non_operating_expense"], category: "custom-expense", magnitude: true },
  { key: "net-sales", name: "销售收入净额", category: "platform-income", derived: true },
  { key: "return-cost", name: "退货成本", category: "product-cost-expense", derived: true },
  { key: "net-sales-cost", name: "销售成本净额", category: "product-cost-expense", derived: true },
  { key: "gross-profit", name: "销售毛利", category: "profit", derived: true },
  { key: "platform-sales-profit", name: "平台销售利润", category: "profit", derived: true },
  { key: "sales-profit", name: "公司净利润", category: "profit", derived: true },
];

const BUDGET_METRICS = new Set(["net-sales", "ad-spend", "refunds", "sales-profit"]);

const BUDGET_FIELDS = [
  ["net-sales", "salesTarget"],
  ["ad-spend", "adBudget"],
  ["refunds", "refundTarget"],
  ["sales-profit", "profitTarget"],
];

const CATEGORIES = [
  ["platform-income", "平台收入"],
  ["platform-expense", "平台支出"],
  ["product-cost-expense", "商品成本支出"],
  ["custom-expense", "自定义费用"],
  ["profit", "利润"],
];

const RETURN_COST_FIELDS = ["returnCost", "return_cost", "return_goods_cost", "return_goods_cost_amount"];
const UNSALEABLE_RETURN_QUANTITY_FIELDS = [
  "unsaleableReturnQuantity",
  "fbaReturnsUnsaleableQuantity",
  "fba_returns_unsaleable_quantity",
];
const PURCHASE_UNIT_COST_FIELDS = ["purchaseUnitCost", "cgUnitPrice", "cg_unit_price"];
const FIRST_LEG_UNIT_COST_FIELDS = ["firstLegUnitCost", "cgTransportUnitCosts", "cg_transport_unit_costs"];
const NET_SALES_FIELDS = ["netSalesAmount", "net_sales_amount", "net_amount"];

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

function sumPresent(records, fields, magnitude = false, label = fields.join("/") || "字段") {
  if (records.length === 0) return null;
  const values = records.map((row) => readValue(row, fields));
  if (values.some((value) => !isPresent(value))) return null;
  return values.reduce((sum, value) => {
    const number = toFiniteNumber(value, `订单利润字段 ${label}`);
    return sum + (magnitude ? Math.abs(number) : number);
  }, 0);
}

function sumReturnCosts(records) {
  if (records.length === 0) return null;
  const values = records.map((record) => {
    const directValue = readValue(record, RETURN_COST_FIELDS);
    if (isPresent(directValue)) return Math.abs(toFiniteNumber(directValue, "订单利润字段 returnCost"));
    const returned = readValue(record, UNSALEABLE_RETURN_QUANTITY_FIELDS);
    const purchaseUnitCost = readValue(record, PURCHASE_UNIT_COST_FIELDS);
    const firstLegUnitCost = readValue(record, FIRST_LEG_UNIT_COST_FIELDS);
    if (![returned, purchaseUnitCost, firstLegUnitCost].every(isPresent)) return null;
    const quantity = Math.abs(toFiniteNumber(returned, "订单利润字段 fbaReturnsUnsaleableQuantity"));
    const purchase = Math.abs(toFiniteNumber(purchaseUnitCost, "订单利润字段 cgUnitPrice"));
    const firstLeg = Math.abs(toFiniteNumber(firstLegUnitCost, "订单利润字段 cgTransportUnitCosts"));
    return quantity * (purchase + firstLeg);
  });
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function deriveFromRequiredChildren(actualByKey, children, calculate) {
  const values = children.map((key) => actualByKey.get(key));
  return values.every((value) => value !== null && value !== undefined) ? calculate(values) : null;
}

function createRow({ key, category, name, level, actual, budget = null, children = [] }, salesIncome) {
  const available = actual !== null;
  return {
    key,
    category,
    name,
    level,
    actual,
    budget,
    share: available && salesIncome !== null && salesIncome !== 0 ? actual / salesIncome : null,
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
  if (!Array.isArray(records)) throw new Error("订单利润 records 必须是数组");
  if (budgetByMetric === null || typeof budgetByMetric !== "object" || Array.isArray(budgetByMetric)) {
    throw new Error("预算科目必须是对象");
  }
  if (currencyCode !== undefined && typeof currencyCode !== "string") throw new Error("币种代码必须是字符串");

  const actualByKey = new Map();
  METRIC_DEFINITIONS.filter((metric) => !metric.derived).forEach((metric) => {
    actualByKey.set(metric.key, sumPresent(records, metric.fields, metric.magnitude, metric.fields[0]));
  });

  const rawNetSales = sumPresent(records, NET_SALES_FIELDS, false, "netSalesAmount");
  const salesIncome = actualByKey.get("sales-income");
  const netSales = deriveFromRequiredChildren(actualByKey, ["sales-income", "sales-discount", "refunds"], ([income, discount, refunds]) => income - discount - refunds) ?? rawNetSales;
  actualByKey.set("net-sales", netSales);
  actualByKey.set("return-cost", sumReturnCosts(records));
  actualByKey.set("net-sales-cost", deriveFromRequiredChildren(actualByKey, ["purchase-cost", "return-cost"], ([purchaseCost, returnCost]) => purchaseCost - returnCost));
  actualByKey.set("gross-profit", deriveFromRequiredChildren(actualByKey, ["net-sales", "net-sales-cost"], ([net, cost]) => net - cost));
  actualByKey.set("platform-sales-profit", deriveFromRequiredChildren(
    actualByKey,
    ["gross-profit", "storage-fee", "ad-spend", "first-leg-cost", "platform-fee", "fba-delivery-fee"],
    ([grossProfit, storage, ads, firstLeg, platform, delivery]) => grossProfit - storage - ads - firstLeg - platform - delivery,
  ));
  actualByKey.set("sales-profit", deriveFromRequiredChildren(
    actualByKey,
    ["platform-sales-profit", "operations", "management", "labor", "asset-impairment", "non-operating-income", "non-operating-expense"],
    ([platformProfit, operations, management, labor, impairment, nonOperatingIncome, nonOperatingExpense]) => platformProfit - operations - management - labor - impairment + nonOperatingIncome - nonOperatingExpense,
  ));

  const metricsByCategory = new Map(CATEGORIES.map(([key]) => [key, []]));
  const metricRows = METRIC_DEFINITIONS.map((metric) => {
    metricsByCategory.get(metric.category).push(metric.key);
    return createRow({
      key: metric.key,
      category: CATEGORIES.find(([categoryKey]) => categoryKey === metric.category)[1],
      name: metric.name,
      level: 2,
      actual: actualByKey.get(metric.key) ?? null,
      budget: BUDGET_METRICS.has(metric.key) ? (isPresent(budgetByMetric[metric.key]) ? toFiniteNumber(budgetByMetric[metric.key], `预算科目 ${metric.key}`) : null) : null,
    }, salesIncome);
  });

  const categoryChildren = new Map(metricsByCategory);
  const categoryActuals = new Map([
    ["platform-income", actualByKey.get("net-sales")],
    ["platform-expense", deriveFromRequiredChildren(
      actualByKey,
      ["storage-fee", "ad-spend", "platform-fee", "fba-delivery-fee"],
      (values) => values.reduce((sum, value) => sum + value, 0),
    )],
    ["product-cost-expense", deriveFromRequiredChildren(
      actualByKey,
      ["net-sales-cost", "first-leg-cost"],
      ([netCost, firstLeg]) => netCost + firstLeg,
    )],
    ["custom-expense", deriveFromRequiredChildren(
      actualByKey,
      ["operations", "management", "labor", "asset-impairment", "non-operating-income", "non-operating-expense"],
      ([operations, management, labor, impairment, income, expense]) => operations + management + labor + impairment + expense - income,
    )],
    ["profit", actualByKey.get("sales-profit")],
  ]);
  CATEGORIES.forEach(([key]) => {
    if (!categoryActuals.has(key)) categoryActuals.set(key, actualByKey.get(key) ?? null);
  });
  const categoryRows = CATEGORIES.map(([key, name]) => createRow({
    key,
    category: name,
    name,
    level: 1,
    actual: categoryActuals.get(key) ?? null,
    children: categoryChildren.get(key) || [],
  }, salesIncome));
  const overview = createRow({
    key: "overview",
    category: "总概",
    name: "总概",
    level: 0,
    actual: null,
    children: CATEGORIES.map(([key]) => key),
  }, salesIncome);
  const rows = [overview, ...categoryRows.flatMap((category) => [
    category,
    ...metricRows.filter((metric) => metric.category === category.name),
  ])];

  return {
    rows,
    unavailableMetrics: rows.filter((row) => !row.available && row.level === 2).map((row) => row.key),
  };
}

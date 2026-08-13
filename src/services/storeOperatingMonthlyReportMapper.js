export const STORE_OPERATING_MONTHLY_MAPPER_VERSION = "store-operating-facts-v1";

const METRIC_DEFINITIONS = [
  { key: "sales-volume", name: "销量", fields: ["totalSalesQuantity", "salesQuantity", "sales_quantity", "volume", "qty"], category: "platform-income", magnitude: true },
  { key: "average-daily-sales", name: "平均日销", category: "platform-income", derived: true },
  { key: "multi-channel-sales-volume", name: "多渠道销量", fields: ["multiChannelSalesQuantity", "multi_channel_sales_quantity", "multiChannelVolume", "multi_channel_volume", "multi_channel_qty"], category: "platform-income", magnitude: true },
  { key: "ads-sales-amount", name: "广告销售额", fields: ["totalAdsSales", "adsSales", "ad_sales_amount", "adSales", "ad_sales"], category: "platform-income", magnitude: true },
  { key: "ads-volume", name: "广告销量", fields: ["totalAdsSalesQuantity", "adsSalesQuantity", "ad_volume", "adVolume", "ad_qty"], category: "platform-income", magnitude: true },
  { key: "sales-income", name: "销售额", fields: ["totalSalesAmount", "salesAmount", "sales_amount", "amount"], category: "platform-income" },
  { key: "net-sales", name: "净销售额", fields: ["netSalesAmount", "net_sales_amount", "net_amount"], category: "platform-income", derived: true },
  { key: "buyer-shipping-fee", name: "买家运费", fields: ["buyerShippingFee", "buyer_shipping_fee", "shippingFee", "shipping_fee", "buyerShipping", "shipping_cost"], category: "platform-income", magnitude: true },
  { key: "sales-discount", name: "促销折扣", fields: ["promotionDiscount", "promotion_discount", "discount_amount"], category: "platform-income", magnitude: true },
  { key: "refunds", name: "退款金额", fields: ["totalSalesRefunds", "refunds", "refund_amount", "refundAmount"], category: "platform-income", magnitude: true },
  { key: "return-volume", name: "退货量", fields: ["returnQuantity", "return_quantity", "return_qty", "returnQty"], category: "platform-income", magnitude: true },
  { key: "refund-volume", name: "退款量", fields: ["refundsQuantity", "refund_quantity", "refund_qty", "refundQty"], category: "platform-income", magnitude: true },
  { key: "fba-inventory-compensation", name: "FBA库存赔偿", fields: ["fbaInventoryCompensation", "fba_inventory_compensation", "inventoryCompensation", "inventory_compensation", "inventory_credit"], category: "platform-income", magnitude: true },
  { key: "other-income", name: "其它收入", fields: ["otherIncome", "other_income", "otherIncomeAmount", "other_income_amount", "total_other_granted"], category: "platform-income" },

  { key: "platform-fee", name: "平台费", fields: ["platformFee", "platform_fee", "selling_fee"], category: "platform-expense", magnitude: true },
  { key: "fba-delivery-fee", name: "FBA发货费", fields: ["fbaDeliveryFee", "fulfillment_fee", "fba_fulfillment_fee"], category: "platform-expense", magnitude: true },
  { key: "other-order-fee", name: "其他订单费用", fields: ["otherOrderFee", "other_order_fee", "other_order_fees", "orderOtherFee"], category: "platform-expense", magnitude: true },
  { key: "storage-fee", name: "仓储费", fields: ["storageFee", "total_stock_fee", "storage_fee"], category: "platform-expense", magnitude: true },
  { key: "ad-fee", name: "广告费", fields: ["totalAdsCost", "total_ads_cost"], category: "platform-expense", magnitude: true },
  { key: "ad-spend", name: "推广费", fields: ["promotionFee", "promotion_fee"], category: "platform-expense", magnitude: true },
  { key: "fba-international-shipping-fee", name: "FBA国际物流运费", fields: ["sharedFbaIntegerernationalInboundFee", "sharedFbaInternationalInboundFee", "shared_fba_international_inbound_fee"], category: "platform-expense", magnitude: true },
  { key: "inbound-placement-fee", name: "入库配置费", fields: ["sharedFbaInboundConvenienceFee", "shared_fba_inbound_convenience_fee"], category: "platform-expense", magnitude: true },
  { key: "adjustment-fee", name: "调整费", fields: ["adjustments", "adjustments_fee"], category: "platform-expense", magnitude: true },
  { key: "other-platform-fee", name: "平台其它费", fields: ["totalPlatformOtherFee", "total_platform_other_fee", "sellingOtherFee", "selling_other_fee"], category: "platform-expense", magnitude: true },

  { key: "purchase-cost", name: "采购成本", fields: ["purchaseCost", "purchase_costs", "purchase_cost", "goods_cost"], category: "product-cost-expense", magnitude: true },
  { key: "first-leg-cost", name: "头程成本", fields: ["firstLegCost", "logistics_costs"], category: "product-cost-expense", magnitude: true },
  { key: "other-product-cost", name: "其它成本", fields: ["otherProductCost", "other_product_cost", "otherCost", "other_cost"], category: "product-cost-expense", magnitude: true },

  { key: "offsite-ad-spend", name: "站外推广费", fields: ["offsiteAdSpend", "offsite_ad_spend", "offsiteAdvertisingFee", "offsite_advertising_fee", "customOrderFeePrincipal", "customOrderFeeCommission", "custom_order_fee_principal", "custom_order_fee_commission"], category: "custom-expense", magnitude: true },
  { key: "office-expense", name: "办公费用", fields: ["officeExpense", "office_expense"], category: "custom-expense", magnitude: true },
  { key: "office-rent", name: "办公费用-租金", fields: ["officeRent", "office_rent", "rentExpense", "rent_expense"], category: "custom-expense", magnitude: true },
  { key: "certification-testing-fee", name: "认证检测费", fields: ["certificationTestingFee", "certification_testing_fee", "testingFee", "testing_fee"], category: "custom-expense", magnitude: true },
  { key: "office-supplies", name: "办公用品", fields: ["officeSupplies", "office_supplies"], category: "custom-expense", magnitude: true },
  { key: "store-insurance-fee", name: "店铺保险费", fields: ["storeInsuranceFee", "store_insurance_fee", "insuranceFee", "insurance_fee"], category: "custom-expense", magnitude: true },
  { key: "software-fee", name: "软件费用", fields: ["softwareFee", "software_fee"], category: "custom-expense", magnitude: true },
  { key: "product-appearance-design-fee", name: "产品外观设计费", fields: ["productAppearanceDesignFee", "product_appearance_design_fee"], category: "custom-expense", magnitude: true },
  { key: "product-graphic-design-fee", name: "产品平面设计费", fields: ["productGraphicDesignFee", "product_graphic_design_fee"], category: "custom-expense", magnitude: true },
  { key: "service-provider-fee", name: "服务商费用", fields: ["serviceProviderFee", "service_provider_fee"], category: "custom-expense", magnitude: true },
  { key: "office-courier-fee", name: "办公费用-快递费", fields: ["officeCourierFee", "office_courier_fee", "courierFee", "courier_fee"], category: "custom-expense", magnitude: true },
  { key: "office-utility-fee", name: "办公费用-水电费", fields: ["officeUtilityFee", "office_utility_fee", "utilityFee", "utility_fee"], category: "custom-expense", magnitude: true },
  { key: "credit-card-ad-fee", name: "信用卡广告费", fields: ["creditCardAdFee", "credit_card_ad_fee"], category: "custom-expense", magnitude: true },
  { key: "office-telecom-fee", name: "办公费用-店铺通讯费", fields: ["officeTelecomFee", "office_telecom_fee", "telecomFee", "telecom_fee"], category: "custom-expense", magnitude: true },
  { key: "sample-fee", name: "样品费", fields: ["sampleFee", "sample_fee"], category: "custom-expense", magnitude: true },
  { key: "test-order-commission", name: "送测佣金（刷单）", fields: ["testOrderCommission", "test_order_commission", "刷单佣金"], category: "custom-expense", magnitude: true },
  { key: "travel-expense", name: "差旅费", fields: ["travelExpense", "travel_expense"], category: "custom-expense", magnitude: true },
  { key: "employee-welfare-fee", name: "员工福利费", fields: ["employeeWelfareFee", "employee_welfare_fee", "welfareFee", "welfare_fee"], category: "custom-expense", magnitude: true },

  { key: "gross-profit", name: "毛利润", category: "profit", derived: true },
  { key: "gross-rate", name: "毛利率", category: "profit", derived: true, valueType: "rate" },
  { key: "net-gross-rate", name: "净毛利率", category: "profit", derived: true, valueType: "rate" },
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
const SALES_NET_KEY = "sales-net";
const SALES_NET_NAME = "销售净额";

export function listStoreOperatingMonthlyReportMetricDefinitions() {
  const categoryNames = new Map(CATEGORIES);
  return METRIC_DEFINITIONS.map(({ key, name, category }) => Object.freeze({
    key,
    name,
    category,
    categoryName: categoryNames.get(category) || category,
  }));
}

const OTHER_FEE_TYPE_METRICS = [
  ["办公费用-租金", "office-rent"],
  ["租金", "office-rent"],
  ["认证检测", "certification-testing-fee"],
  ["办公用品", "office-supplies"],
  ["店铺保险", "store-insurance-fee"],
  ["软件", "software-fee"],
  ["产品外观设计", "product-appearance-design-fee"],
  ["产品平面设计", "product-graphic-design-fee"],
  ["服务商", "service-provider-fee"],
  ["办公费用-快递", "office-courier-fee"],
  ["快递", "office-courier-fee"],
  ["办公费用-水电", "office-utility-fee"],
  ["水电", "office-utility-fee"],
  ["信用卡广告", "credit-card-ad-fee"],
  ["办公费用-店铺通讯", "office-telecom-fee"],
  ["通讯", "office-telecom-fee"],
  ["样品", "sample-fee"],
  ["送测佣金", "test-order-commission"],
  ["刷单", "test-order-commission"],
  ["差旅", "travel-expense"],
  ["员工福利", "employee-welfare-fee"],
  ["福利", "employee-welfare-fee"],
  ["站外推广", "offsite-ad-spend"],
  ["办公费用", "office-expense"],
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
const DIRECT_GROSS_PROFIT_FIELDS = ["grossProfit", "gross_profit", "orderProfit", "order_profit"];
const DIRECT_SALES_PROFIT_FIELDS = ["profit", "profitAmount", "profit_amount", "sellerProfit", "seller_profit", "salesProfit", "sales_profit", "netProfit", "net_profit"];
const DERIVED_METRIC_DEPENDENCIES = new Map([
  ["average-daily-sales", ["sales-volume"]],
  ["net-sales", ["sales-income", "sales-discount", "refunds"]],
  ["gross-profit", ["net-sales", "net-sales-cost"]],
  ["gross-rate", ["gross-profit", "sales-income"]],
  ["net-gross-rate", ["sales-profit", "sales-income"]],
]);

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

function normalizeFeeType(value) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function metricForOtherFeeType(value) {
  const type = normalizeFeeType(value);
  if (!type) return "";
  return OTHER_FEE_TYPE_METRICS.find(([label]) => type.includes(label))?.[1] || "";
}

function readOtherFeeType(record) {
  const value = readValue(record, [
    "other_fee_type_name",
    "otherFeeTypeName",
    "fee_type_name",
    "feeTypeName",
    "fee_name",
    "feeName",
    "type_name",
    "typeName",
    "other_fee_type",
    "otherFeeType",
    "fee_type",
    "feeType",
  ]);
  if (value && typeof value === "object") {
    return readText(value, ["name", "label", "value", "title", "name_cn", "nameCn"]);
  }
  return isPresent(value) ? String(value).trim() : "";
}

function feeAmount(record) {
  const direct = readValue(record, ["fee", "amount", "other_fee", "otherFee"]);
  if (isPresent(direct)) return toFiniteNumber(direct, "费用明细 fee");
  if (!Array.isArray(record?.details)) return null;
  const values = record.details.map((detail) => readValue(detail, ["fee", "amount", "other_fee", "otherFee"]));
  if (values.some((value) => !isPresent(value))) return null;
  return values.reduce((sum, value) => sum + toFiniteNumber(value, "费用明细 details.fee"), 0);
}

function expandStoreOperatingOtherFeeRecords(feeRecords) {
  return feeRecords.flatMap((feeRecord) => {
    if (!Array.isArray(feeRecord?.details) || feeRecord.details.length === 0) return [feeRecord];
    const { details, ...baseRecord } = feeRecord;
    return details.map((detail) => {
      const storeInfo = Array.isArray(detail?.store_infos) ? detail.store_infos[0] : null;
      const detailSid = readValue(detail, [
        "sid",
        "seller_id",
        "sellerId",
        "store_id",
        "storeId",
        "dimension_value",
      ]);
      const sid = isPresent(detailSid)
        ? detailSid
        : readValue(storeInfo, ["id", "sid", "seller_id", "sellerId"]);
      const storeName = readText(detail, [
        "storeName",
        "store_name",
        "sellerName",
        "seller_name",
      ]) || readText(storeInfo, ["name", "storeName", "store_name", "sellerName", "seller_name"]);
      const amount = readValue(detail, ["fee", "amount", "other_fee", "otherFee"]);
      return {
        ...baseRecord,
        ...detail,
        details: undefined,
        sid,
        storeName,
        fee: amount,
      };
    });
  });
}

export function mergeStoreOperatingCustomFeeRecords(records = [], feeRecords = [], sellers = []) {
  if (!Array.isArray(records)) throw new Error("店铺利润 records 必须是数组");
  if (!Array.isArray(feeRecords)) throw new Error("自定义费用 records 必须是数组");
  const sellerBySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]));
  const merged = records.map((record) => ({ ...record }));
  const recordBySid = new Map(merged
    .map((record) => [Number(readValue(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"])), record])
    .filter(([sid]) => Number.isFinite(sid) && sid > 0));
  const unmapped = [];
  const applied = [];
  expandStoreOperatingOtherFeeRecords(feeRecords).forEach((feeRecord) => {
    const sid = Number(readValue(feeRecord, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
    const hasValidSid = Number.isFinite(sid) && sid > 0;
    const storeName = readText(feeRecord, ["storeName", "store_name", "sellerName", "seller_name"]);
    const type = readOtherFeeType(feeRecord);
    const metricKey = metricForOtherFeeType(type);
    const amount = feeAmount(feeRecord);
    if (!metricKey || amount === null) {
      unmapped.push({ sid: Number.isFinite(sid) ? sid : null, storeName, type, reason: !metricKey ? "未识别费用类型" : "费用金额缺失" });
      return;
    }
    let target = hasValidSid ? recordBySid.get(sid) : null;
    if (!target && !hasValidSid && storeName) target = merged.find((record) => readText(record, ["storeName", "store_name", "sellerName", "seller_name"]) === storeName);
    if (!target) {
      const seller = sellerBySid.get(sid) || {};
      if (!seller.name && !Number.isFinite(sid) && !storeName) {
        unmapped.push({ sid: null, storeName, type, reason: "无法匹配店铺" });
        return;
      }
      if (!seller.name && !storeName) {
        unmapped.push({ sid: Number.isFinite(sid) ? sid : null, storeName, type, reason: "无法匹配店铺" });
        return;
      }
      target = {
        sid,
        storeName: storeName || seller.name || "",
        country: seller.country || "",
        currencyCode: feeRecord.currencyCode || feeRecord.currency_code || "",
      };
      merged.push(target);
      if (Number.isFinite(sid) && sid > 0) recordBySid.set(sid, target);
    }
    const metric = METRIC_DEFINITIONS.find((definition) => definition.key === metricKey);
    const metricField = metric?.fields?.[0] || metricKey;
    target[metricField] = Number(target[metricField] || 0) + amount;
    applied.push({ sid: Number.isFinite(sid) ? sid : null, type, metricKey, amount });
  });
  return { records: merged, applied, unmapped };
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

function sumAvailable(records, fields, magnitude = false, label = fields.join("/") || "字段") {
  if (records.length === 0) return null;
  const values = records.map((row) => readValue(row, fields)).filter(isPresent);
  if (!values.length) return null;
  return values.reduce((sum, value) => {
    const number = toFiniteNumber(value, `订单利润字段 ${label}`);
    return sum + (magnitude ? Math.abs(number) : number);
  }, 0);
}

function sumCompositeFields(records, fieldGroups, magnitude = false, label = "字段") {
  if (records.length === 0) return null;
  const values = records.map((row) => fieldGroups.map((fields) => readValue(row, fields)).filter(isPresent));
  if (values.some((groups) => groups.length === 0)) return null;
  return values.reduce((total, groups) => total + groups.reduce((sum, value) => {
    const number = toFiniteNumber(value, `订单利润字段 ${label}`);
    return sum + (magnitude ? Math.abs(number) : number);
  }, 0), 0);
}

function weightedRate(records, rateFields, weightFields, label) {
  if (records.length === 0) return null;
  const values = records.map((record) => ({
    rate: readValue(record, rateFields),
    weight: readValue(record, weightFields),
  }));
  if (values.some(({ rate, weight }) => !isPresent(rate) || !isPresent(weight))) return null;
  const { weightedTotal, weightTotal } = values.reduce((totals, { rate, weight }) => {
    const numericRate = toFiniteNumber(rate, `订单利润字段 ${label}`);
    const numericWeight = toFiniteNumber(weight, `订单利润字段 ${weightFields[0]}`);
    return {
      weightedTotal: totals.weightedTotal + numericRate * numericWeight,
      weightTotal: totals.weightTotal + numericWeight,
    };
  }, { weightedTotal: 0, weightTotal: 0 });
  return weightTotal === 0 ? null : weightedTotal / weightTotal;
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

function createRow({ key, category, name, level, actual, budget = null, children = [], valueType = "number" }, salesIncome) {
  const available = actual !== null;
  const isRate = valueType === "rate";
  const isNumeric = valueType === "number";
  return {
    key,
    category,
    name,
    level,
    actual,
    budget,
    share: isNumeric && available && salesIncome !== null && salesIncome !== 0 ? actual / salesIncome : null,
    achievement: isNumeric && available && budget !== null && budget !== 0 ? actual / budget : null,
    available,
    children,
    valueType,
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

const LEGACY_CUSTOM_METRIC_DEFINITIONS = [
  ["operations", ["operationsCost", "operations_cost", "operating_cost", "operating_expense"]],
  ["management", ["managementCost", "management_cost", "management_expense"]],
  ["labor", ["laborCost", "labor_cost", "labor_expense"]],
  ["asset-impairment", ["assetImpairment", "asset_impairment", "impairment_loss"]],
  ["non-operating-income", ["nonOperatingIncome", "non_operating_income"]],
  ["non-operating-expense", ["nonOperatingExpense", "non_operating_expense"]],
];

const CUSTOM_EXPENSE_KEYS = METRIC_DEFINITIONS
  .filter((metric) => metric.category === "custom-expense")
  .map((metric) => metric.key);
const PLATFORM_CORE_EXPENSE_KEYS = ["platform-fee", "fba-delivery-fee", "storage-fee", "ad-fee", "ad-spend"];
const PLATFORM_EXPENSE_KEYS = METRIC_DEFINITIONS
  .filter((metric) => metric.category === "platform-expense" && !metric.derived)
  .map((metric) => metric.key);
const PRODUCT_COST_KEYS = METRIC_DEFINITIONS
  .filter((metric) => metric.category === "product-cost-expense" && !metric.derived)
  .map((metric) => metric.key);

function sumRequiredKeys(actualByKey, keys) {
  return deriveFromRequiredChildren(actualByKey, keys, (values) => values.reduce((sum, value) => sum + value, 0));
}

function sumAvailableKeys(actualByKey, keys) {
  const values = keys.map((key) => actualByKey.get(key)).filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function ratioFromKeys(actualByKey, numeratorKey, denominatorKey) {
  return deriveFromRequiredChildren(actualByKey, [numeratorKey, denominatorKey], ([numerator, denominator]) => (
    denominator === 0 ? null : numerator / denominator
  ));
}

export function buildStoreOperatingReportRows({ records, budgetByMetric = {}, currencyCode, storeName = "", country = "", periodDays } = {}) {
  if (!Array.isArray(records)) throw new Error("订单利润 records 必须是数组");
  if (budgetByMetric === null || typeof budgetByMetric !== "object" || Array.isArray(budgetByMetric)) {
    throw new Error("预算科目必须是对象");
  }
  if (currencyCode !== undefined && typeof currencyCode !== "string") throw new Error("币种代码必须是字符串");

  const actualByKey = new Map();
  METRIC_DEFINITIONS.filter((metric) => !metric.derived).forEach((metric) => {
    const sumMetric = metric.category === "custom-expense" ? sumAvailable : sumPresent;
    const actual = metric.key === "offsite-ad-spend"
      ? (sumCompositeFields(records, [["customOrderFeePrincipal", "custom_order_fee_principal"], ["customOrderFeeCommission", "custom_order_fee_commission"]], metric.magnitude, "customOrderFeePrincipal/customOrderFeeCommission")
        ?? sumMetric(records, metric.fields, metric.magnitude, metric.fields[0]))
      : sumMetric(records, metric.fields, metric.magnitude, metric.fields[0]);
    actualByKey.set(metric.key, actual);
  });
  LEGACY_CUSTOM_METRIC_DEFINITIONS.forEach(([key, fields]) => {
    if (!actualByKey.has(key)) actualByKey.set(key, sumAvailable(records, fields, key !== "non-operating-income", fields[0]));
  });

  const rawNetSales = sumPresent(records, NET_SALES_FIELDS, false, "netSalesAmount");
  const salesIncome = actualByKey.get("sales-income");
  const salesVolume = actualByKey.get("sales-volume");
  const netSales = rawNetSales ?? deriveFromRequiredChildren(actualByKey, ["sales-income", "sales-discount", "refunds"], ([income, discount, refunds]) => income - discount - refunds);
  actualByKey.set("net-sales", netSales);
  actualByKey.set(SALES_NET_KEY, deriveFromRequiredChildren(
    actualByKey,
    ["net-sales", "buyer-shipping-fee", "refunds", "fba-inventory-compensation", "other-income"],
    ([net, buyerShipping, refunds, inventoryCompensation, otherIncome]) => net + buyerShipping - refunds + inventoryCompensation + otherIncome,
  ));
  actualByKey.set("average-daily-sales", periodDays > 0 && salesVolume !== null ? salesVolume / periodDays : null);
  actualByKey.set("return-cost", sumReturnCosts(records));
  actualByKey.set("net-sales-cost", deriveFromRequiredChildren(actualByKey, ["purchase-cost", "return-cost"], ([purchaseCost, returnCost]) => purchaseCost - returnCost));
  const directGrossProfit = sumPresent(records, DIRECT_GROSS_PROFIT_FIELDS, false, "grossProfit");
  actualByKey.set("gross-profit", directGrossProfit ?? deriveFromRequiredChildren(actualByKey, ["net-sales", "net-sales-cost"], ([net, cost]) => net - cost));
  actualByKey.set("platform-sales-profit", deriveFromRequiredChildren(
    actualByKey,
    ["gross-profit", "storage-fee", "ad-fee", "ad-spend", "first-leg-cost", "platform-fee", "fba-delivery-fee"],
    ([grossProfit, storage, adFee, adSpend, firstLeg, platform, delivery]) => grossProfit - storage - adFee - adSpend - firstLeg - platform - delivery,
  ));
  const legacySalesProfit = deriveFromRequiredChildren(
    actualByKey,
    ["platform-sales-profit", "operations", "management", "labor", "asset-impairment", "non-operating-income", "non-operating-expense"],
    ([platformProfit, operations, management, labor, impairment, nonOperatingIncome, nonOperatingExpense]) => platformProfit - operations - management - labor - impairment + nonOperatingIncome - nonOperatingExpense,
  );
  const newCustomExpense = sumAvailableKeys(actualByKey, CUSTOM_EXPENSE_KEYS);
  const completeCustomExpense = sumRequiredKeys(actualByKey, CUSTOM_EXPENSE_KEYS);
  const legacyCustomExpense = sumAvailableKeys(actualByKey, ["operations", "management", "labor", "asset-impairment", "non-operating-income", "non-operating-expense"]);
  actualByKey.set("custom-expense", completeCustomExpense);
  const newSalesProfit = deriveFromRequiredChildren(
    actualByKey,
    ["gross-profit", ...PLATFORM_CORE_EXPENSE_KEYS, "first-leg-cost", "custom-expense"],
    ([grossProfit, ...expenses]) => grossProfit - expenses.reduce((sum, value) => sum + value, 0),
  );
  const directSalesProfit = sumPresent(records, DIRECT_SALES_PROFIT_FIELDS, false, "profit");
  actualByKey.set("sales-profit", directSalesProfit ?? legacySalesProfit ?? newSalesProfit);
  actualByKey.set("gross-rate", ratioFromKeys(actualByKey, "gross-profit", "sales-income"));
  const directNetGrossRate = weightedRate(
    records,
    ["netGrossMargin", "net_gross_margin"],
    ["totalSalesAmount", "salesAmount", "sales_amount", "amount"],
    "netGrossMargin",
  );
  actualByKey.set("net-gross-rate", directNetGrossRate ?? ratioFromKeys(actualByKey, "sales-profit", "sales-income"));

  const metricsByCategory = new Map(CATEGORIES.map(([key]) => [key, []]));
  const categoryNames = new Map(CATEGORIES);
  const metricRows = METRIC_DEFINITIONS.map((metric) => {
    metricsByCategory.get(metric.category).push(metric.key);
    return createRow({
      key: metric.key,
      category: categoryNames.get(metric.category),
      name: metric.name,
      level: 2,
      actual: actualByKey.get(metric.key) ?? null,
      valueType: metric.valueType || "number",
      budget: BUDGET_METRICS.has(metric.key) ? (isPresent(budgetByMetric[metric.key]) ? toFiniteNumber(budgetByMetric[metric.key], `预算科目 ${metric.key}`) : null) : null,
    }, salesIncome);
  });
  const categoryChildren = new Map(metricsByCategory);
  const productCostSubtotal = actualByKey.get("net-sales-cost") !== null && actualByKey.get("first-leg-cost") !== null
    ? actualByKey.get("net-sales-cost") + actualByKey.get("first-leg-cost")
    : sumAvailableKeys(actualByKey, PRODUCT_COST_KEYS);
  const categoryActuals = new Map([
    ["platform-income", salesIncome],
    ["platform-expense", sumAvailableKeys(actualByKey, PLATFORM_EXPENSE_KEYS)],
    ["product-cost-expense", productCostSubtotal],
    ["custom-expense", newCustomExpense ?? legacyCustomExpense],
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
    budget: key === "profit" && isPresent(budgetByMetric["sales-profit"])
      ? toFiniteNumber(budgetByMetric["sales-profit"], "预算科目 sales-profit")
      : null,
  }, salesIncome));
  const salesNetRow = createRow({
    key: SALES_NET_KEY,
    category: SALES_NET_NAME,
    name: SALES_NET_NAME,
    level: 1,
    actual: actualByKey.get(SALES_NET_KEY) ?? null,
    children: [],
    budget: null,
  }, salesIncome);
  const overviewChildren = CATEGORIES.flatMap(([key]) => (
    key === "platform-income" ? [key, SALES_NET_KEY] : [key]
  ));
  const overview = createRow({
    key: "overview",
    category: "总概",
    name: "总概",
    level: 0,
    actual: null,
    children: overviewChildren,
  }, salesIncome);
  const rows = [overview, ...categoryRows.flatMap((category) => [
    category,
    ...metricRows.filter((metric) => metric.category === category.name),
    ...(category.key === "platform-income" ? [salesNetRow] : []),
  ])];

  const metricByKey = new Map(METRIC_DEFINITIONS.map((metric) => [metric.key, metric]));
  const unavailableMetricDetails = rows
    .filter((row) => !row.available && row.level === 2)
    .map((row) => {
      const metric = metricByKey.get(row.key);
      if (metric?.fields?.length) {
        return {
          key: row.key,
          name: row.name,
          category: metric.category,
          reason: metric.category === "custom-expense"
            ? (metric.key === "offsite-ad-spend"
              ? "订单利润 API 未返回对应字段"
              : "店铺利润报表未返回对应费用科目")
            : "订单利润 API 未返回对应字段",
          fields: metric.fields,
        };
      }
      return {
        key: row.key,
        name: row.name,
        category: row.category,
        reason: "依赖科目不可用",
        dependencies: DERIVED_METRIC_DEPENDENCIES.get(row.key) || [],
      };
    });

  return {
    rows,
    unavailableMetrics: rows.filter((row) => !row.available && row.level === 2).map((row) => row.key),
    unavailableMetricDetails,
  };
}

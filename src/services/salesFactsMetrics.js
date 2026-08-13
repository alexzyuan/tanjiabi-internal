import { SalesFactsContractError, SalesFactsInputError } from "./salesFactsIdentity.js";

export const SALES_FACT_METRICS = Object.freeze({
  totalSalesQuantity: { aliases: ["volume", "totalSalesQuantity"], scale: 4, kind: "quantity" },
  multiChannelSalesQuantity: { aliases: ["multi_channel_volume", "multiChannelSalesQuantity"], scale: 4, kind: "quantity" },
  totalAdsSales: { aliases: ["ad_sales_amount", "totalAdsSales"], scale: 4, kind: "money" },
  totalAdsSalesQuantity: { aliases: ["ad_volume", "totalAdsSalesQuantity"], scale: 4, kind: "quantity" },
  totalSalesAmount: { aliases: ["amount", "totalSalesAmount"], scale: 4, kind: "money" },
  netSalesAmount: { aliases: ["net_amount", "netSalesAmount"], scale: 4, kind: "money" },
  grossProfit: { aliases: ["gross_profit", "grossProfit"], scale: 4, kind: "money" },
  salesProfit: { aliases: ["profit", "profit_amount", "salesProfit"], scale: 4, kind: "money" },
  buyerShippingFee: { aliases: ["shipping_cost", "buyerShippingFee"], scale: 4, kind: "money" },
  promotionDiscount: { aliases: ["promotion_discount", "promotionDiscount"], scale: 4, kind: "money" },
  totalSalesRefunds: { aliases: ["refund_amount", "totalSalesRefunds"], scale: 4, kind: "money" },
  returnQuantity: { aliases: ["return_quantity", "returnQuantity"], scale: 4, kind: "quantity" },
  refundsQuantity: { aliases: ["refund_quantity", "refundsQuantity"], scale: 4, kind: "quantity" },
  fbaInventoryCompensation: { aliases: ["inventory_credit", "fbaInventoryCompensation"], scale: 4, kind: "money" },
  otherIncome: { aliases: ["total_other_granted", "otherIncome"], scale: 4, kind: "money" },
  platformFee: { aliases: ["selling_fee", "platform_fee", "platformFee"], scale: 4, kind: "money" },
  fbaDeliveryFee: { aliases: ["fulfillment_fee", "fbaDeliveryFee"], scale: 4, kind: "money" },
  otherOrderFee: { aliases: ["other_order_fee", "otherOrderFee"], scale: 4, kind: "money" },
  storageFee: { aliases: ["total_stock_fee", "storageFee"], scale: 4, kind: "money" },
  totalAdsCost: { aliases: ["spend", "totalAdsCost"], scale: 4, kind: "money" },
  promotionFee: { aliases: ["promotion_fee", "promotionFee"], scale: 4, kind: "money" },
  fbaInternationalShippingFee: { aliases: ["shared_fba_international_inbound_fee", "sharedFbaInternationalInboundFee"], scale: 4, kind: "money" },
  inboundPlacementFee: { aliases: ["shared_fba_inbound_convenience_fee", "sharedFbaInboundConvenienceFee"], scale: 4, kind: "money" },
  adjustmentFee: { aliases: ["adjustments", "adjustmentFee"], scale: 4, kind: "money" },
  otherPlatformFee: { aliases: ["total_platform_other_fee", "otherPlatformFee"], scale: 4, kind: "money" },
  purchaseCost: { aliases: ["purchase_costs", "purchaseCost"], scale: 4, kind: "money" },
  firstLegCost: { aliases: ["logistics_costs", "firstLegCost"], scale: 4, kind: "money" },
  otherProductCost: { aliases: ["other_product_cost", "otherProductCost"], scale: 4, kind: "money" },
  purchaseUnitCost: { aliases: ["cgUnitPrice", "purchaseUnitCost"], scale: 4, kind: "money" },
  firstLegUnitCost: { aliases: ["cgTransportUnitCosts", "firstLegUnitCost"], scale: 4, kind: "money" },
  storageFeeRate: { aliases: ["total_stock_fee_rate", "storageFeeRate"], scale: 6, kind: "rate" },
  platformFeeRate: { aliases: ["selling_fee_rate", "platformFeeRate"], scale: 6, kind: "rate" },
  fbaDeliveryFeeRate: { aliases: ["fulfillment_fee_rate", "fbaDeliveryFeeRate"], scale: 6, kind: "rate" },
  purchaseCostRate: { aliases: ["proportionOfCg", "purchaseCostRate"], scale: 6, kind: "rate" },
  firstLegCostRate: { aliases: ["proportionOfCgTransport", "firstLegCostRate"], scale: 6, kind: "rate" },
});

function metricDefinition(metricName) {
  const definition = SALES_FACT_METRICS[metricName];
  if (!definition) {
    throw new SalesFactsInputError(`销售事实指标未注册：${metricName}`, { code: "SALES_FACTS_METRIC_UNREGISTERED" });
  }
  return definition;
}

function expandDecimal(value) {
  if (typeof value === "bigint") return `${value}`;
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  const text = String(value).trim().replace(/,/gu, "");
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(text);
  if (!match) return "";
  const sign = match[1] === "-" ? "-" : "";
  const digits = `${match[2]}${match[3] || ""}`;
  const decimalIndex = match[2].length + Number(match[4] || 0);
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function fixedPoint(value, scale, metricName) {
  const expanded = expandDecimal(value);
  if (!expanded) {
    throw new SalesFactsContractError(`销售事实指标数字无效：${metricName}`, { code: "SALES_FACTS_METRIC_INVALID" });
  }
  const negative = expanded.startsWith("-");
  const unsigned = negative ? expanded.slice(1) : expanded;
  const [integerPart, rawFraction = ""] = unsigned.split(".");
  const trimmedFraction = rawFraction.replace(/0+$/u, "");
  if (trimmedFraction.length > scale) {
    throw new SalesFactsContractError(`销售事实指标精度超出 ${scale} 位：${metricName}`, {
      code: "SALES_FACTS_METRIC_PRECISION_INVALID",
    });
  }
  const fraction = rawFraction.slice(0, scale).padEnd(scale, "0");
  const encoded = BigInt(integerPart || "0") * (10n ** BigInt(scale)) + BigInt(fraction || "0");
  return negative ? -encoded : encoded;
}

export function encodeSalesMetric(metricName, value) {
  const definition = metricDefinition(metricName);
  if (value === null) return null;
  if (value === undefined || value === "") {
    throw new SalesFactsContractError(`销售事实指标数字无效：${metricName}`, { code: "SALES_FACTS_METRIC_INVALID" });
  }
  return fixedPoint(value, definition.scale, metricName);
}

export function decodeSalesMetric(metricName, value) {
  const definition = metricDefinition(metricName);
  if (value === null) return null;
  if (typeof value !== "bigint") {
    throw new SalesFactsContractError(`销售事实指标存储值无效：${metricName}`, { code: "SALES_FACTS_METRIC_STORAGE_INVALID" });
  }
  const factor = 10 ** definition.scale;
  const number = Number(value) / factor;
  if (!Number.isFinite(number)) {
    throw new SalesFactsContractError(`销售事实指标超出安全输出范围：${metricName}`, {
      code: "SALES_FACTS_METRIC_OUTPUT_OVERFLOW",
    });
  }
  return number;
}

function presentAliases(record, aliases) {
  return aliases.filter((alias) => Object.hasOwn(record, alias) && record[alias] !== undefined && record[alias] !== "");
}

export function normalizeOrderProfitMetricValues(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new SalesFactsContractError("OrderProfit 指标记录结构无效。", { code: "SALES_FACTS_METRIC_RECORD_INVALID" });
  }
  const normalized = {};
  for (const [metricName, definition] of Object.entries(SALES_FACT_METRICS)) {
    const aliases = presentAliases(record, definition.aliases);
    if (!aliases.length) continue;
    const values = aliases.map((alias) => encodeSalesMetric(metricName, record[alias]));
    if (values.some((value) => value !== values[0])) {
      throw new SalesFactsContractError(`销售事实指标别名值冲突：${metricName}`, {
        code: "SALES_FACTS_METRIC_ALIAS_CONFLICT",
        details: { metricName, aliasCount: aliases.length },
      });
    }
    normalized[metricName] = values[0];
  }
  return normalized;
}

export function reconstructSalesFactMapperRecord(storedMetrics = {}) {
  if (!storedMetrics || typeof storedMetrics !== "object" || Array.isArray(storedMetrics)) {
    throw new SalesFactsContractError("销售事实存储指标结构无效。", { code: "SALES_FACTS_METRIC_STORAGE_INVALID" });
  }
  const output = {};
  for (const metricName of Object.keys(SALES_FACT_METRICS)) {
    if (Object.hasOwn(storedMetrics, metricName)) output[metricName] = decodeSalesMetric(metricName, storedMetrics[metricName]);
  }
  return output;
}

import { mockDashboard } from "../data/mockDashboard.js";
import { lingxingShopMap } from "../data/lingxingShopMap.js";
import { buildListingOwnerMap, findListingOwner, normalizeInventoryOwnerRows, ownerOptionsFromRows } from "./listingOwnerService.js";

function toNumber(value) {
  if (typeof value === "string") {
    value = value.replace(/,/g, "").replace(/%/g, "");
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percent(value) {
  return `${(toNumber(value) * 100).toFixed(2)}%`;
}

function amount(value) {
  return toNumber(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildTimeProgress(range) {
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  if (!start || !end) return { percent: 0, detail: "按筛选周期" };

  const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
  const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  const totalDays = monthEnd.getDate();
  const elapsedDays = Math.min(Math.max(end.getDate(), 1), totalDays);
  return {
    percent: Number(((elapsedDays / totalDays) * 100).toFixed(2)),
    detail: `本月 ${elapsedDays}/${totalDays} 天`,
    startText: `开始：${range.startDate}`,
    endText: `结束：${range.endDate}`,
  };
}

function kpi(title, value, left, right, progress, tone = "blue") {
  return { title, value, left, right, progress: Math.max(0, Math.min(Number(progress || 0), 200)), tone };
}

function rateText(value) {
  return `${(toNumber(value) * 100).toFixed(2)}%`;
}

function costRateAchievement(targetRate, actualRate) {
  if (targetRate <= 0 && actualRate <= 0) return 100;
  if (targetRate <= 0) return 200;
  if (actualRate <= 0) return 0;
  return (actualRate / targetRate) * 100;
}

function getCurrencyLabel(currencyCode) {
  return currencyCode === "ORIGINAL" ? "站点原币" : currencyCode || "CNY";
}

function groupBy(records, keyFn) {
  return records.reduce((acc, item) => {
    const key = keyFn(item) || "未分组";
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function sumBy(records, valueFn) {
  return records.reduce((total, item) => total + valueFn(item), 0);
}

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function sumFields(records, keys) {
  return records.reduce((total, item) => total + toNumber(readFirst(item, keys)), 0);
}

const fieldMap = {
  sales: [
    "salesAmount",
    "sales_amount",
    "totalSalesAmount",
    "total_sales_amount",
    "principal",
    "principalAmount",
    "principal_amount",
    "itemPrice",
    "item_price",
    "productSales",
    "product_sales",
    "totalSales",
    "total_sales",
    "orderAmount",
    "order_amount",
    "amount",
  ],
  adsCost: ["adsCost", "ads_cost", "advertisingCost", "advertising_cost", "totalAdsCost", "total_ads_cost", "adCost", "ad_cost", "spend"],
  adsSales: ["adsSales", "ads_sales", "advertisingSales", "advertising_sales", "totalAdsSales", "total_ads_sales", "adSales", "ad_sales", "ad_sales_amount"],
  refund: ["salesRefunds", "sales_refunds", "totalSalesRefunds", "total_sales_refunds", "refundAmount", "refund_amount", "refunds", "refund_amount"],
  netSales: ["netSalesAmount", "net_sales_amount", "totalNetSalesAmount", "total_net_sales_amount", "netSales", "net_sales", "net_amount"],
  promotionDiscount: [
    "promotionDiscount",
    "promotion_discount",
    "promotionDiscountAmount",
    "promotion_discount_amount",
    "promotionalDiscount",
    "promotional_discount",
    "promoDiscount",
    "promo_discount",
    "salesPromotion",
    "sales_promotion",
    "salesPromotionDiscount",
    "sales_promotion_discount",
    "discountAmount",
    "discount_amount",
    "couponDiscount",
    "coupon_discount",
    "itemPromotionDiscount",
    "item_promotion_discount",
    "shippingPromotionDiscount",
    "shipping_promotion_discount",
  ],
  profit: [
    "orderProfit",
    "order_profit",
    "profit",
    "profitAmount",
    "profit_amount",
    "grossProfit",
    "gross_profit",
    "netProfit",
    "net_profit",
    "sellerProfit",
    "seller_profit",
    "totalProfit",
    "total_profit",
  ],
  quantity: ["quantity", "qty", "salesQuantity", "sales_quantity", "totalSalesQuantity", "total_sales_quantity", "orderQuantity", "order_quantity", "volume"],
  storageFee: [
    "totalStockFee",
    "total_stock_fee",
    "storageFee",
    "storage_fee",
    "storageFeeAmount",
    "storage_fee_amount",
    "storageAmount",
    "storage_amount",
    "warehouseFee",
    "warehouse_fee",
    "warehouseStorageFee",
    "warehouse_storage_fee",
    "warehousingFee",
    "warehousing_fee",
    "inventoryStorageFee",
    "inventory_storage_fee",
    "monthlyStorageFee",
    "monthly_storage_fee",
    "monthlyStorageFeeAmount",
    "monthly_storage_fee_amount",
    "longTermStorageFee",
    "long_term_storage_fee",
    "longTermStorageFeeAmount",
    "long_term_storage_fee_amount",
    "fbaStorageFee",
    "fba_storage_fee",
    "sharedFbaStorageFee",
    "shared_fba_storage_fee",
    "sharedAwdStorageFee",
    "shared_awd_storage_fee",
    "sharedStarStorageFee",
    "shared_star_storage_fee",
    "sharedFbaInboundDefectFee",
    "shared_fba_inbound_defect_fee",
    "sharedFbaOverageFee",
    "shared_fba_overage_fee",
    "sharedOtherFbaInventoryFees",
    "shared_other_fba_inventory_fees",
  ],
  platformFee: [
    "platformFee",
    "platform_fee",
    "platformFeeAmount",
    "platform_fee_amount",
    "platformAmount",
    "platform_amount",
    "platformCost",
    "platform_cost",
    "platformCostAmount",
    "platform_cost_amount",
    "platformFeeTotal",
    "platform_fee_total",
    "totalPlatformFee",
    "total_platform_fee",
    "sellingFee",
    "selling_fee",
    "sellingFeeAmount",
    "selling_fee_amount",
    "amazonFeeTotal",
    "amazon_fee_total",
    "amazonFees",
    "amazon_fees",
    "commission",
    "commissionAmount",
    "commission_amount",
    "commissionFee",
    "commission_fee",
    "referralFee",
    "referral_fee",
    "referralFeeAmount",
    "referral_fee_amount",
    "amazonFee",
    "amazon_fee",
  ],
  fbaDeliveryFee: [
    "fbaDeliveryFee",
    "fba_delivery_fee",
    "fbaDeliveryFeeAmount",
    "fba_delivery_fee_amount",
    "fbaDeliveryAmount",
    "fba_delivery_amount",
    "fbaFee",
    "fba_fee",
    "fbaFeeAmount",
    "fba_fee_amount",
    "fbaShippingFee",
    "fba_shipping_fee",
    "fulfillmentFee",
    "fulfillment_fee",
    "fulfillmentFeeAmount",
    "fulfillment_fee_amount",
    "fbaFulfillmentFee",
    "fba_fulfillment_fee",
    "fbaFulfillmentFeeAmount",
    "fba_fulfillment_fee_amount",
    "deliveryFee",
    "delivery_fee",
  ],
  purchaseCost: [
    "purchaseCosts",
    "purchase_costs",
    "purchaseCost",
    "purchase_cost",
    "purchaseCostAmount",
    "purchase_cost_amount",
    "productCost",
    "product_cost",
    "productCostAmount",
    "product_cost_amount",
    "goodsCost",
    "goods_cost",
    "goodsCostAmount",
    "goods_cost_amount",
    "costOfGoods",
    "cost_of_goods",
    "costOfGoodsSold",
    "cost_of_goods_sold",
    "cogs",
    "totalCost",
    "total_cost",
    "purchaseAmount",
    "purchase_amount",
    "itemCost",
    "item_cost",
    "cgPriceTotal",
    "cgPriceAbsTotal",
  ],
  firstLegCost: [
    "logisticsCosts",
    "logistics_costs",
    "firstLegCost",
    "first_leg_cost",
    "firstLegCostAmount",
    "first_leg_cost_amount",
    "firstLegFee",
    "first_leg_fee",
    "firstLegFeeAmount",
    "first_leg_fee_amount",
    "firstShippingFee",
    "first_shipping_fee",
    "firstShippingCost",
    "first_shipping_cost",
    "headShippingCost",
    "head_shipping_cost",
    "headShippingFee",
    "head_shipping_fee",
    "headFreight",
    "head_freight",
    "firstLogisticsFee",
    "first_logistics_fee",
    "shippingCost",
    "shipping_cost",
    "cgTransportCostsTotal",
  ],
  grossRate: ["grossRate", "gross_rate", "grossMargin", "gross_margin"],
  storageFeeRate: ["storageFeeRate", "storage_fee_rate", "totalStockFeeRate", "total_stock_fee_rate"],
  platformFeeRate: ["platformFeeRate", "platform_fee_rate", "sellingFeeRate", "selling_fee_rate"],
  fbaDeliveryFeeRate: ["fbaDeliveryFeeRate", "fba_delivery_fee_rate", "fulfillmentFeeRate", "fulfillment_fee_rate"],
  purchaseCostRate: ["purchaseCostRate", "purchase_cost_rate", "proportionOfCg", "proportion_of_cg"],
  firstLegCostRate: ["firstLegCostRate", "first_leg_cost_rate", "proportionOfCgTransport", "proportion_of_cg_transport"],
  fbaInventoryDirect: [
    "fbaInventory",
    "fba_inventory",
    "fbaStock",
    "fba_stock",
  ],
  fbaInventoryAvailable: [
    "inventoryAvailable",
    "inventory_available",
    "afn_fulfillable_quantity",
    "total_fulfillable_quantity",
    "available_total",
    "fba_available_quantity",
    "available_quantity",
    "fulfillable_quantity",
    "fulfillableQuantity",
  ],
  fbaInventoryTransfer: [
    "reserved_fc_transfers",
    "reservedFcTransfers",
    "reserved_transfer",
    "reservedTransfer",
    "reserved_transfer_quantity",
    "reservedTransferQuantity",
  ],
  fbaInventoryReserved: [
    "afn_reserved_quantity",
    "afnReservedQuantity",
    "afn_reserved_qty",
    "reserved_quantity",
    "reservedQuantity",
    "reserved_qty",
    "fba_reserved_quantity",
    "fbaReservedQuantity",
    "amazon_quantity_reserved",
    "amazonQuantityReserved",
  ],
};

function getSales(item) {
  return toNumber(readFirst(item, fieldMap.sales));
}

function getNetSales(item) {
  return toNumber(readFirst(item, fieldMap.netSales));
}

function getProfit(item) {
  return toNumber(readFirst(item, fieldMap.profit));
}

function getAdsCost(item) {
  return Math.abs(toNumber(readFirst(item, fieldMap.adsCost)));
}

function getAdsSales(item) {
  return toNumber(readFirst(item, fieldMap.adsSales));
}

function getRefund(item) {
  return Math.abs(toNumber(readFirst(item, fieldMap.refund)));
}

function getQuantity(item) {
  return toNumber(readFirst(item, fieldMap.quantity));
}

function getAbsoluteMetric(item, keys) {
  return Math.abs(toNumber(readFirst(item, keys)));
}

function getOptionalNumberMetric(item, keys) {
  const rawValue = readFirst(item, keys);
  if (rawValue === "") return null;
  const value = toNumber(rawValue);
  return Number.isFinite(value) ? value : null;
}

function getFbaInventoryQuantity(item) {
  const available = getOptionalNumberMetric(item, fieldMap.fbaInventoryAvailable);
  const transfer = getOptionalNumberMetric(item, fieldMap.fbaInventoryTransfer);
  const reserved = getOptionalNumberMetric(item, fieldMap.fbaInventoryReserved);
  if (available !== null || transfer !== null || reserved !== null) {
    return toNumber(available) + toNumber(transfer) + toNumber(reserved);
  }
  return getOptionalNumberMetric(item, fieldMap.fbaInventoryDirect);
}

function getRatioPercent(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function getRatePercentMetric(item, keys) {
  const rawValue = readFirst(item, keys);
  if (rawValue === "") return null;
  const value = toNumber(rawValue);
  if (!Number.isFinite(value)) return null;
  return Number((Math.abs(value) <= 1 ? Math.abs(value) * 100 : Math.abs(value)).toFixed(2));
}

function preferApiRate(apiRate, numerator, denominator) {
  return apiRate == null ? getRatioPercent(numerator, denominator) : apiRate;
}

function getSite(item) {
  return readFirst(item, ["country", "countryName", "country_name", "countryCode", "country_code", "marketplace", "marketplaceName", "site", "siteName", "storeName"]) || "未分组";
}

function getStore(item) {
  return readFirst(item, ["storeName", "store_name", "sellerName", "seller_name", "shopName", "shop_name", "accountName", "account_name", "sid"]) || "-";
}

function getCurrency(item) {
  return readFirst(item, ["currencyCode", "currency_code"]) || "-";
}

function normalizeRawKey(value) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  return text;
}

function normalizeTargetKey(value, { site = false } = {}) {
  const text = normalizeRawKey(value);
  if (!text) return "";
  if (!site) return text;
  if (/美国|unitedstates|usa|\bus\b/.test(text)) return "美国站";
  if (/加拿大|canada|\bca\b/.test(text)) return "加拿大站";
  if (/澳洲|澳大利亚|australia|\bau\b/.test(text)) return "澳洲站";
  if (/英国|unitedkingdom|\buk\b/.test(text)) return "英国站";
  if (/德国|germany|\bde\b/.test(text)) return "德国站";
  return text;
}

function getStoreTargetKeys(value) {
  const rawKey = normalizeRawKey(value);
  if (!rawKey) return [];

  const shop = lingxingShopMap.find((item) => {
    return [item.name, item.displayName, item.sid].some((candidate) => normalizeRawKey(candidate) === rawKey);
  });

  return [
    rawKey,
    normalizeRawKey(shop?.name),
    normalizeRawKey(shop?.displayName),
  ].filter(Boolean).filter((key, index, values) => values.indexOf(key) === index);
}

const forcedActualMskuDetailStores = ["坦蛋伯澳洲", "探嘉澳洲"];
const forcedActualMskuDetailStoreKeys = new Set(forcedActualMskuDetailStores.flatMap((store) => getStoreTargetKeys(store)));

function displayStoreName(value, sid = "") {
  const rawKey = normalizeRawKey(value);
  const normalizedSid = String(sid || "").trim();
  const shop = lingxingShopMap.find((item) => {
    return String(item.sid) === normalizedSid
      || [item.name, item.displayName].some((candidate) => normalizeRawKey(candidate) === rawKey);
  });
  return shop?.displayName || value || "-";
}

function findShopByStore(value, sid = "") {
  const rawKey = normalizeRawKey(value);
  const normalizedSid = String(sid || "").trim();
  return lingxingShopMap.find((item) => {
    return String(item.sid) === normalizedSid
      || [item.name, item.displayName].some((candidate) => normalizeRawKey(candidate) === rawKey);
  }) || null;
}

function resolveBudgetRowSid(row = {}) {
  const rowSid = toNumber(row.sid || row.sellerId || row.seller_id);
  if (rowSid) return rowSid;
  return toNumber(findShopByStore(row.storeName)?.sid);
}

function resolveBudgetRowCountry(row = {}) {
  return row.country || findShopByStore(row.storeName)?.country || row.site || "";
}

function isForcedActualMskuStore(actual = {}) {
  return getStoreTargetKeys(actual.storeName).some((key) => forcedActualMskuDetailStoreKeys.has(key))
    || forcedActualMskuDetailStores.includes(displayStoreName(actual.storeName, actual.sid));
}

function addBudgetRow(map, key, row) {
  if (!key) return;
  const existing = map.get(key) || { salesTarget: 0, profitTarget: 0, adBudget: 0 };
  existing.salesTarget += toNumber(row.salesTarget);
  existing.profitTarget += toNumber(row.profitTarget);
  existing.adBudget += toNumber(row.adBudget);
  map.set(key, existing);
}

function buildBudgetResolver(budgetTargets = {}) {
  const rows = Array.isArray(budgetTargets.rows) ? budgetTargets.rows : [];
  const storeMap = new Map();
  const siteMap = new Map();
  rows.forEach((row) => {
    getStoreTargetKeys(row.storeName).forEach((key) => addBudgetRow(storeMap, key, row));
    addBudgetRow(siteMap, normalizeTargetKey(row.site || row.storeName, { site: true }), row);
  });

  function targetByItems(items, field) {
    const storeMatches = new Set();
    items.forEach((item) => {
      const matchedKey = getStoreTargetKeys(getStore(item)).find((key) => storeMap.has(key));
      if (matchedKey) storeMatches.add(matchedKey);
    });
    if (storeMatches.size) {
      return [...storeMatches].reduce((total, key) => total + toNumber(storeMap.get(key)?.[field]), 0);
    }

    const siteKeys = [...new Set(items.map((item) => normalizeTargetKey(getSite(item), { site: true })).filter(Boolean))];
    const siteMatches = siteKeys.filter((key) => siteMap.has(key));
    if (siteMatches.length) return siteMatches.reduce((total, key) => total + toNumber(siteMap.get(key)?.[field]), 0);

    return null;
  }

  function targetFor(label, items, type, field, fallback) {
    if (!rows.length) return fallback;
    if (type === "total") {
      const matched = items?.length ? targetByItems(items, field) : null;
      return matched == null ? toNumber(budgetTargets.totals?.[field]) : matched;
    }

    const labelKeys = type === "store" ? getStoreTargetKeys(label) : [normalizeTargetKey(label, { site: true })];
    const directMap = type === "store" ? storeMap : siteMap;
    const directKeys = labelKeys.filter((key) => directMap.has(key));
    if (directKeys.length) return toNumber(directMap.get(directKeys[0])?.[field]);

    if (type === "store") return 0;

    const matched = targetByItems(items, field);
    return matched == null ? 0 : matched;
  }

  return {
    hasTargets: rows.length > 0,
    month: budgetTargets.month || "",
    totalSalesTarget: rows.length ? toNumber(budgetTargets.totals?.salesTarget) : null,
    totalProfitTarget: rows.length ? toNumber(budgetTargets.totals?.profitTarget) : null,
    totalAdBudget: rows.length ? toNumber(budgetTargets.totals?.adBudget) : null,
    salesTargetFor: (label, items, type, fallback) => targetFor(label, items, type, "salesTarget", fallback),
    profitTargetFor: (label, items, type, fallback) => targetFor(label, items, type, "profitTarget", fallback),
    adBudgetFor: (label, items, type, fallback) => targetFor(label, items, type, "adBudget", fallback),
  };
}

function getGroupCurrency(items) {
  const currencies = [...new Set(items.map(getCurrency).filter((item) => item && item !== "-"))];
  if (!currencies.length) return "-";
  return currencies.length === 1 ? currencies[0] : "多币种";
}

function buildPerformanceRow(label, items, level = 0, type = "group", budgetResolver = null) {
  const sales = sumFields(items, fieldMap.sales);
  const grossProfit = sumFields(items, fieldMap.profit);
  const adsCost = sumBy(items, getAdsCost);
  const adsSales = sumFields(items, fieldMap.adsSales);
  const fallbackSalesTarget = sales > 0 ? sales / 1.2 : 0;
  const fallbackProfitTarget = grossProfit > 0 ? grossProfit / 1.2 : 0;
  const target = budgetResolver?.salesTargetFor(label, items, type, fallbackSalesTarget) ?? fallbackSalesTarget;
  const profitTarget = budgetResolver?.profitTargetFor(label, items, type, fallbackProfitTarget) ?? fallbackProfitTarget;
  return {
    level,
    type,
    cells: [
      label,
      getGroupCurrency(items),
      Number(target.toFixed(2)),
      Number(sales.toFixed(2)),
      target ? `${((sales / target) * 100).toFixed(1)}%` : "0.0%",
      Number(profitTarget.toFixed(2)),
      Number(grossProfit.toFixed(2)),
      profitTarget ? `${((grossProfit / profitTarget) * 100).toFixed(1)}%` : "0.0%",
      Number(adsCost.toFixed(2)),
      Number(adsSales.toFixed(2)),
      adsSales ? `${((adsCost / adsSales) * 100).toFixed(2)}%` : "0.00%",
      sales ? `${((adsCost / sales) * 100).toFixed(2)}%` : "0.00%",
    ],
  };
}

function buildSiteRows(records, budgetResolver = null) {
  const grouped = groupBy(records, getSite);
  const rows = [];
  Object.entries(grouped).forEach(([site, items]) => {
    rows.push(buildPerformanceRow(site, items, 0, "country", budgetResolver));
    Object.entries(groupBy(items, getStore)).forEach(([store, storeItems]) => {
      rows.push(buildPerformanceRow(store, storeItems, 1, "store", budgetResolver));
    });
  });

  const totalSales = sumFields(records, fieldMap.sales);
  const totalGrossProfit = sumFields(records, fieldMap.profit);
  const totalAdsCost = sumBy(records, getAdsCost);
  const totalAdsSales = sumFields(records, fieldMap.adsSales);
  const fallbackSalesTarget = totalSales > 0 ? totalSales / 1.2 : 0;
  const fallbackProfitTarget = totalGrossProfit > 0 ? totalGrossProfit / 1.2 : 0;
  const totalTarget = budgetResolver?.salesTargetFor("合计", records, "total", fallbackSalesTarget) ?? fallbackSalesTarget;
  const totalProfitTarget = budgetResolver?.profitTargetFor("合计", records, "total", fallbackProfitTarget) ?? fallbackProfitTarget;
  rows.push({
    level: 0,
    type: "total",
    cells: [
      "合计",
      getGroupCurrency(records),
      Number(totalTarget.toFixed(2)),
      Number(totalSales.toFixed(2)),
      totalTarget ? `${((totalSales / totalTarget) * 100).toFixed(1)}%` : "0.0%",
      Number(totalProfitTarget.toFixed(2)),
      Number(totalGrossProfit.toFixed(2)),
      totalProfitTarget ? `${((totalGrossProfit / totalProfitTarget) * 100).toFixed(1)}%` : "0.0%",
      Number(totalAdsCost.toFixed(2)),
      Number(totalAdsSales.toFixed(2)),
      totalAdsSales ? `${((totalAdsCost / totalAdsSales) * 100).toFixed(2)}%` : "0.00%",
      totalSales ? `${((totalAdsCost / totalSales) * 100).toFixed(2)}%` : "0.00%",
    ],
  });
  return rows;
}

function buildStoreData(records, budgetResolver = null) {
  const grouped = groupBy(records, getStore);
  return Object.entries(grouped).slice(0, 8).map(([name, items]) => {
    const actual = sumFields(items, fieldMap.sales);
    const fallbackTarget = actual > 0 ? actual / 1.2 : 0;
    const target = budgetResolver?.salesTargetFor(name, items, "store", fallbackTarget) ?? fallbackTarget;
    return {
      name,
      actual: Number(actual.toFixed(2)),
      target: Number(target.toFixed(2)),
      rate: target ? Number(((actual / target) * 100).toFixed(2)) : 0,
    };
  });
}

function buildProfitData(records, budgetResolver = null) {
  const grouped = groupBy(records, getStore);
  return Object.entries(grouped).slice(0, 8).map(([name, items]) => {
    const actual = sumFields(items, fieldMap.profit);
    const fallbackTarget = actual > 0 ? actual / 1.2 : 0;
    const target = budgetResolver?.profitTargetFor(name, items, "store", fallbackTarget) ?? fallbackTarget;
    return {
      name,
      actual: Number(actual.toFixed(2)),
      target: Number(target.toFixed(2)),
      rate: target ? Number(((actual / target) * 100).toFixed(2)) : 0,
    };
  });
}

export function buildDetailRows(records) {
  return records.slice(0, 30).map((item) => {
    const sales = getSales(item);
    const adsCost = getAdsCost(item);
    const adsSales = getAdsSales(item);
    const grossProfit = getProfit(item);
    return [
      getStore(item),
      readFirst(item, ["msku", "sellerSku", "seller_sku", "sku", "asin"]) || getStore(item),
      getSite(item),
      Math.round(grossProfit),
      sales ? `${((grossProfit / sales) * 100).toFixed(2)}%` : "0.00%",
      Math.round(grossProfit),
      Math.round(sales),
      Math.round(adsCost),
      Math.round(adsSales),
      adsSales ? `${((adsCost / adsSales) * 100).toFixed(2)}%` : "0.00%",
      sales ? `${((adsCost / sales) * 100).toFixed(2)}%` : "0.00%",
      sales ? `${((adsSales / sales) * 100).toFixed(2)}%` : "0.00%",
      sales ? `${((getRefund(item) / sales) * 100).toFixed(2)}%` : "0.00%",
      grossProfit < 0 ? "检查利润结构" : "保持观察",
    ];
  });
}

function getProductName(item) {
  return readFirst(item, ["productName", "product_name", "localName", "local_name", "itemName", "item_name", "title", "skuName", "sku_name"]) || "-";
}

function getMsku(item) {
  return readFirst(item, ["msku", "sellerSku", "seller_sku", "sku", "asin"]) || "";
}

function mskuKey(value) {
  return normalizeRawKey(value).replace(/[._\s-]+/g, "");
}

function buildActualMskuMap(records = []) {
  const map = new Map();

  records.forEach((record) => {
    const msku = mskuKey(getMsku(record));
    if (!msku) return;
    const storeKeys = getStoreTargetKeys(getStore(record));
    const keys = storeKeys.length ? storeKeys : [normalizeRawKey(getStore(record))];
    keys.forEach((storeKey) => {
      if (!storeKey) return;
      const key = `${storeKey}|${msku}`;
      const existing = map.get(key) || {
        quantity: 0,
        sales: 0,
        adsCost: 0,
        profit: 0,
        refund: 0,
        promotionDiscount: 0,
        storageFee: 0,
        platformFee: 0,
        fbaDeliveryFee: 0,
        purchaseCost: 0,
        firstLegCost: 0,
        grossRate: null,
        storageFeeRate: null,
        platformFeeRate: null,
        fbaDeliveryFeeRate: null,
        purchaseCostRate: null,
        firstLegCostRate: null,
        fbaInventory: null,
        sid: getRecordSid(record),
        country: getSite(record),
        countryCode: readFirst(record, ["countryCode", "country_code", "region", "marketplace"]) || "",
        storeName: getStore(record),
        msku: getMsku(record),
        productName: "",
      };
      existing.quantity += getQuantity(record);
      existing.sales += getSales(record);
      existing.adsCost += getAdsCost(record);
      existing.profit += getProfit(record);
      existing.refund += getRefund(record);
      existing.promotionDiscount += getAbsoluteMetric(record, fieldMap.promotionDiscount);
      existing.storageFee += getAbsoluteMetric(record, fieldMap.storageFee);
      existing.platformFee += getAbsoluteMetric(record, fieldMap.platformFee);
      existing.fbaDeliveryFee += getAbsoluteMetric(record, fieldMap.fbaDeliveryFee);
      existing.purchaseCost += getAbsoluteMetric(record, fieldMap.purchaseCost);
      existing.firstLegCost += getAbsoluteMetric(record, fieldMap.firstLegCost);
      existing.grossRate ??= getRatePercentMetric(record, fieldMap.grossRate);
      existing.storageFeeRate ??= getRatePercentMetric(record, fieldMap.storageFeeRate);
      existing.platformFeeRate ??= getRatePercentMetric(record, fieldMap.platformFeeRate);
      existing.fbaDeliveryFeeRate ??= getRatePercentMetric(record, fieldMap.fbaDeliveryFeeRate);
      existing.purchaseCostRate ??= getRatePercentMetric(record, fieldMap.purchaseCostRate);
      existing.firstLegCostRate ??= getRatePercentMetric(record, fieldMap.firstLegCostRate);
      existing.fbaInventory ??= getFbaInventoryQuantity(record);
      existing.productName ||= getProductName(record);
      map.set(key, existing);
    });
  });

  return map;
}

function getRecordSid(record = {}) {
  return toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
}

function sellerStoreName(seller = {}) {
  return readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name", "displayName"]) || "";
}

function buildSellerBySid(sellers = []) {
  return new Map(
    sellers
      .map((seller) => [toNumber(seller.sid || seller.id || seller.seller_id || seller.sellerId), seller])
      .filter(([sid]) => sid > 0),
  );
}

function getInventoryStoreKeys(record, sellerBySid) {
  const names = [
    getStore(record),
    sellerStoreName(sellerBySid.get(getRecordSid(record))),
  ].filter(Boolean);
  return [...new Set(names.flatMap((name) => getStoreTargetKeys(name)).filter(Boolean))];
}

function getInventoryMsku(record) {
  return readFirst(record, ["seller_sku", "sellerSku", "msku", "sku", "local_sku", "localSku"]);
}

function buildFbaInventoryMap(inventoryRecords = [], sellers = []) {
  const map = new Map();
  const sellerBySid = buildSellerBySid(sellers);
  inventoryRecords.forEach((record) => {
    const msku = mskuKey(getInventoryMsku(record));
    if (!msku) return;
    const quantity = getFbaInventoryQuantity(record);
    if (quantity === null) return;
    getInventoryStoreKeys(record, sellerBySid).forEach((storeKey) => {
      const key = `${storeKey}|${msku}`;
      map.set(key, (map.get(key) || 0) + quantity);
    });
  });
  return map;
}

function findActualMsku(actualMap, budgetRow) {
  const keys = getStoreTargetKeys(budgetRow.storeName);
  const msku = mskuKey(budgetRow.msku);
  for (const key of keys) {
    const actual = actualMap.get(`${key}|${msku}`);
    if (actual) return actual;
  }
  return null;
}

function findFbaInventory(inventoryMap, budgetRow) {
  const keys = getStoreTargetKeys(budgetRow.storeName);
  const msku = mskuKey(budgetRow.msku);
  for (const key of keys) {
    const quantity = inventoryMap.get(`${key}|${msku}`);
    if (quantity !== undefined) return quantity;
  }
  return 0;
}

export function buildBudgetMskuDetailRows(records = [], budgetTargets = {}, inventoryRecords = [], sellers = [], ownerRows = [], filters = {}) {
  const budgetRows = (Array.isArray(budgetTargets.rows) ? budgetTargets.rows : [])
    .flatMap((row) => row.mskuRows || [])
    .filter((row) => row?.msku);
  const actualMap = buildActualMskuMap(records);
  const inventoryMap = buildFbaInventoryMap(inventoryRecords, sellers);
  const ownerMap = buildListingOwnerMap([
    ...normalizeInventoryOwnerRows(inventoryRecords, sellers),
    ...ownerRows,
  ]);
  const listingOwnerFilter = String(filters.listingOwner || filters.owner || "").trim();

  const buildDetailRow = (row, suppliedActual = null) => {
    const actual = suppliedActual || findActualMsku(actualMap, row) || {};
    const actualQuantity = toNumber(actual.quantity);
    const sales = toNumber(actual.sales);
    const adsCost = toNumber(actual.adsCost);
    const budgetQuantity = toNumber(row.salesQty);
    const orderProfit = toNumber(actual.profit);
    const fbaInventory = actual.fbaInventory !== null && actual.fbaInventory !== undefined
      ? toNumber(actual.fbaInventory)
      : findFbaInventory(inventoryMap, row);
    const listingOwner = findListingOwner(ownerMap, {
      sid: actual.sid || resolveBudgetRowSid(row),
      country: actual.country || resolveBudgetRowCountry(row),
      countryCode: row.countryCode || "",
      msku: row.msku,
    });

    return {
      budgetStoreName: row.storeName || "-",
      msku: row.msku || "-",
      listingOwner,
      productName: actual.productName || row.productName || row.skuName || row.asin || "-",
      budgetQuantity: Number(budgetQuantity.toFixed(2)),
      actualQuantity: Number(actualQuantity.toFixed(2)),
      fbaInventory: Number(fbaInventory.toFixed(2)),
      quantityAchievement: budgetQuantity ? Number(((actualQuantity / budgetQuantity) * 100).toFixed(2)) : 0,
      orderProfit: Number(orderProfit.toFixed(2)),
      grossRate: getRatioPercent(orderProfit, sales),
      refundRate: getRatioPercent(toNumber(actual.refund), sales),
      adFeeRate: getRatioPercent(adsCost, sales),
      promotionDiscountRate: getRatioPercent(toNumber(actual.promotionDiscount), sales),
      storageFeeRate: preferApiRate(actual.storageFeeRate, toNumber(actual.storageFee), sales),
      platformFeeRate: preferApiRate(actual.platformFeeRate, toNumber(actual.platformFee), sales),
      fbaDeliveryFeeRate: preferApiRate(actual.fbaDeliveryFeeRate, toNumber(actual.fbaDeliveryFee), sales),
      purchaseCostRate: preferApiRate(actual.purchaseCostRate, toNumber(actual.purchaseCost), sales),
      firstLegCostRate: preferApiRate(actual.firstLegCostRate, toNumber(actual.firstLegCost), sales),
    };
  };

  const budgetDetailRows = budgetRows.map((row) => buildDetailRow(row));
  const budgetRowKeys = new Set(
    budgetRows.flatMap((row) => {
      const msku = mskuKey(row.msku);
      return getStoreTargetKeys(row.storeName).map((storeKey) => `${storeKey}|${msku}`);
    }),
  );
  const seenActualRows = new Set();
  const forcedActualRows = Array.from(actualMap.values())
    .filter((actual) => {
      const msku = mskuKey(actual.msku);
      if (!msku || !isForcedActualMskuStore(actual)) return false;
      if (getStoreTargetKeys(actual.storeName).some((storeKey) => budgetRowKeys.has(`${storeKey}|${msku}`))) return false;
      const key = `${actual.sid || normalizeRawKey(actual.storeName)}|${msku}`;
      if (seenActualRows.has(key)) return false;
      seenActualRows.add(key);
      return true;
    })
    .map((actual) => buildDetailRow({
      storeName: displayStoreName(actual.storeName, actual.sid),
      sid: actual.sid,
      country: actual.country,
      countryCode: actual.countryCode,
      msku: actual.msku,
      productName: actual.productName,
      salesQty: 0,
    }, actual));

  return [...budgetDetailRows, ...forcedActualRows]
    .filter((row) => !listingOwnerFilter || row.listingOwner === listingOwnerFilter);
}

function buildDailyRows(records) {
  const grouped = groupBy(records, (item) => item.reportDate || item.postedDateLocale || item.date || "未分组");
  return Object.entries(grouped)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, items]) => {
      const sales = sumFields(items, fieldMap.sales);
      const netSales = sumFields(items, fieldMap.netSales) || sales;
      const grossProfit = sumFields(items, fieldMap.profit);
      const quantity = sumFields(items, fieldMap.quantity);
      const adsSales = sumFields(items, fieldMap.adsSales);
      const adsCost = sumBy(items, getAdsCost);
      const refund = sumBy(items, getRefund);
      return {
        date,
        sales,
        netSales,
        grossProfit,
        grossRate: sales ? (grossProfit / sales) * 100 : 0,
        quantity,
        adsSales,
        adsCost,
        acos: adsSales ? (adsCost / adsSales) * 100 : 0,
        acoas: sales ? (adsCost / sales) * 100 : 0,
        refund,
        refundRate: sales ? (refund / sales) * 100 : 0,
      };
    });
}

function compactDateLabel(date) {
  const parts = String(date || "").split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date;
}

function buildTrendFromDailyRows(dailyRows) {
  return {
    trendLabels: dailyRows.map((item) => compactDateLabel(item.date)),
    trend: dailyRows.map((item) => Number(item.sales.toFixed(2))),
    adTrend: dailyRows.map((item) => Number(item.adsCost.toFixed(2))),
    acosTrend: dailyRows.map((item) => Number(item.acos.toFixed(2))),
    returnTrend: dailyRows.map((item) => Number(item.refundRate.toFixed(2))),
  };
}

function buildDailyTableRows(dailyRows) {
  return dailyRows.map((item) => [
    item.date,
    Math.round(item.quantity).toLocaleString("zh-CN"),
    Math.round(item.sales).toLocaleString("zh-CN"),
    Math.round(item.netSales).toLocaleString("zh-CN"),
    Math.round(item.grossProfit).toLocaleString("zh-CN"),
    `${item.grossRate.toFixed(2)}%`,
    Math.round(item.adsSales).toLocaleString("zh-CN"),
    Math.round(item.adsCost).toLocaleString("zh-CN"),
    `${item.acos.toFixed(2)}%`,
    Math.round(item.refund).toLocaleString("zh-CN"),
    `${item.refundRate.toFixed(2)}%`,
  ]);
}

export function mapLingxingToSalesDashboard({
  sellers = [],
  sellerProfitRecords = [],
  orderProfitRecords = [],
  dailyProfitRecords = [],
  inventoryRecords = [],
  listingOwnerRows = [],
  filters = {},
  range,
  currencyCode = "CNY",
  raw = {},
  budgetTargets = {},
}) {
  const sourceRecords = orderProfitRecords.length ? orderProfitRecords : sellerProfitRecords;
  const sourceName = orderProfitRecords.length ? "订单利润" : raw.sourceName || "利润统计";
  const ownerRows = [
    ...normalizeInventoryOwnerRows(inventoryRecords, sellers),
    ...listingOwnerRows,
  ];
  const ownerMap = buildListingOwnerMap(ownerRows);
  const ownerOptions = ownerOptionsFromRows(ownerRows);
  const listingOwnerFilter = String(filters.listingOwner || filters.owner || "").trim();
  const records = listingOwnerFilter
    ? sourceRecords.filter((record) => findListingOwner(ownerMap, {
      sid: getRecordSid(record),
      country: getSite(record),
      countryCode: readFirst(record, ["countryCode", "country_code", "region", "marketplace"]) || "",
      msku: getMsku(record),
    }) === listingOwnerFilter)
    : sourceRecords;
  const cacheText = raw.cacheState === "hit"
    ? ` · 缓存 ${raw.cacheUpdatedAt || ""}`.trimEnd()
      : raw.cacheState === "stale"
      ? ` · 领星限流，使用缓存 ${raw.cacheUpdatedAt || ""}`.trimEnd()
      : "";
  const budgetResolver = buildBudgetResolver(budgetTargets);
  const budgetText = budgetResolver.hasTargets ? ` · 预算目标 ${budgetResolver.month || "当前月份"} 已对齐` : "";
  if (!records.length) {
    const timeProgress = buildTimeProgress(range);
    const totalSalesTarget = budgetResolver.totalSalesTarget ?? 0;
    const totalProfitTarget = budgetResolver.totalProfitTarget ?? 0;
    const totalAdBudget = budgetResolver.totalAdBudget ?? 0;
    const targetAdFeeRate = totalSalesTarget ? totalAdBudget / totalSalesTarget : 0;
    return {
      ...mockDashboard,
      meta: {
        ...mockDashboard.meta,
        source: "领星 ERP",
        syncStatus: `已连接领星，但当前周期未返回${sourceName}数据${cacheText}${budgetText}`,
        currencyText: getCurrencyLabel(currencyCode),
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        periodText: `销售周会复盘 · ${range.startDate} 至 ${range.endDate}`,
      },
      insights: [],
      kpis: [
        kpi("时间进度", `${timeProgress.percent.toFixed(2)}%`, timeProgress.startText, `${timeProgress.endText} · ${timeProgress.detail}`, timeProgress.percent, "blue"),
        kpi("总销售收入达成率", "0.00%", `目标：${amount(totalSalesTarget)}`, "实际：0.00", 0, "orange"),
        kpi("广告销售占比", "0.00%", "广告销售：0.00", "销售额：0.00", 0, "blue"),
        kpi("店铺利润达成率", "0.00%", `目标：${amount(totalProfitTarget)}`, "实际：0.00", 0, "orange"),
        kpi("广告费率达成率", `${costRateAchievement(targetAdFeeRate, 0).toFixed(2)}%`, `目标费率：${rateText(targetAdFeeRate)}`, "实际费率：0.00%", costRateAchievement(targetAdFeeRate, 0), "green"),
      ],
      siteRows: [{ level: 0, type: "empty", cells: ["暂无店铺统计", getCurrencyLabel(currencyCode), 0, 0, "0.0%", 0, 0, "0.0%", 0, 0, "0.00%", "0.00%"] }],
      miniMetrics: [
        ["销售额", "0.00", "店铺统计无数据", "orange"],
        ["订单退款", "0.00", "店铺统计无数据", "red"],
        ["广告花费", "0.00", "店铺统计无数据", ""],
        ["退货率", "0.00%", "店铺统计无数据", "red"],
        ["ACOS", "0.00%", "店铺统计无数据", ""],
        ["销售毛利", "0.00", "店铺统计无数据", "orange"],
      ],
      summary: [
        ["销售毛利", "0"],
        ["销售毛利率", "0.00%"],
        ["公司净利", "0"],
        ["公司净利率", "0.00%"],
        ["销售额", "0"],
        ["广告花费", "0"],
        ["广告销售额", "0"],
        ["ACOS", "0.00%"],
        ["退款率", "0.00%"],
      ],
      trendLabels: [],
      dailyRows: [],
      storeData: [],
      profitData: [],
      filters: { ownerOptions },
      detailRows: [],
    };
  }

  const totalSales = sumFields(records, fieldMap.sales);
  const totalNetSales = sumFields(records, fieldMap.netSales) || totalSales;
  const totalAdsCost = sumBy(records, getAdsCost);
  const totalAdsSales = sumFields(records, fieldMap.adsSales);
  const totalRefund = sumBy(records, getRefund);
  const totalGrossProfit = sumFields(records, fieldMap.profit);
  const totalQuantity = sumFields(records, fieldMap.quantity);
  const fallbackSalesTarget = totalSales > 0 ? totalSales / 1.2 : 0;
  const fallbackProfitTarget = totalGrossProfit > 0 ? totalGrossProfit / 1.2 : 0;
  const target = budgetResolver.salesTargetFor("合计", records, "total", fallbackSalesTarget) ?? fallbackSalesTarget;
  const profitTarget = budgetResolver.profitTargetFor("合计", records, "total", fallbackProfitTarget) ?? fallbackProfitTarget;
  const adBudgetTarget = budgetResolver.adBudgetFor("合计", records, "total", 0) ?? 0;
  const timeProgress = buildTimeProgress(range);
  const salesRate = target ? (totalSales / target) * 100 : 0;
  const profitTargetRate = profitTarget ? (totalGrossProfit / profitTarget) * 100 : 0;
  const adsSalesRate = totalSales ? (totalAdsSales / totalSales) * 100 : 0;
  const actualAdFeeRate = totalSales ? totalAdsCost / totalSales : 0;
  const targetAdFeeRate = target ? adBudgetTarget / target : 0;
  const adFeeRateAchievement = costRateAchievement(targetAdFeeRate, actualAdFeeRate);
  const profitRate = totalSales ? (totalGrossProfit / totalSales) * 100 : 0;
  const dailyRows = buildDailyRows(dailyProfitRecords.length ? dailyProfitRecords : records);
  const trendData = buildTrendFromDailyRows(dailyRows);

  return {
    ...mockDashboard,
    meta: {
      source: "领星 ERP",
      syncStatus: `已匹配店铺 ${sellers.length} 个，${sourceName} ${records.length} 条 · 订单利润口径${cacheText}${budgetText}`,
      currencyText: getCurrencyLabel(currencyCode),
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      periodText: `销售周会复盘 · ${range.startDate} 至 ${range.endDate}`,
    },
    insights: [],
    kpis: [
      kpi("时间进度", `${timeProgress.percent.toFixed(2)}%`, timeProgress.startText, `${timeProgress.endText} · ${timeProgress.detail}`, timeProgress.percent, "blue"),
      kpi("总销售收入达成率", `${salesRate.toFixed(2)}%`, `目标：${amount(target)}`, `实际：${amount(totalSales)}`, salesRate, salesRate >= timeProgress.percent ? "green" : "orange"),
      kpi("广告销售占比", `${adsSalesRate.toFixed(2)}%`, `广告销售：${amount(totalAdsSales)}`, `销售额：${amount(totalSales)}`, adsSalesRate, adsSalesRate >= 45 ? "orange" : "blue"),
      kpi("店铺利润达成率", `${profitTargetRate.toFixed(2)}%`, `目标：${amount(profitTarget)}`, `实际：${amount(totalGrossProfit)}`, profitTargetRate, profitTargetRate < 0 ? "red" : profitTargetRate < timeProgress.percent ? "orange" : "green"),
      kpi("广告费率达成率", `${adFeeRateAchievement.toFixed(2)}%`, `目标费率：${rateText(targetAdFeeRate)}`, `实际费率：${rateText(actualAdFeeRate)}`, adFeeRateAchievement, adFeeRateAchievement > 100 ? "red" : adFeeRateAchievement >= 80 ? "orange" : "green"),
    ],
    siteRows: buildSiteRows(records, budgetResolver),
    miniMetrics: [
      ["销售额", amount(totalSales), `销量：${Math.round(totalQuantity)}`, "orange"],
      ["订单退款", amount(totalRefund), totalSales ? `退款率：${((totalRefund / totalSales) * 100).toFixed(2)}%` : "退款率：0.00%", "red"],
      ["广告花费", amount(totalAdsCost), totalSales ? `ACOAS：${((totalAdsCost / totalSales) * 100).toFixed(2)}%` : "ACOAS：0.00%", ""],
      ["退货率", totalSales ? `${((totalRefund / totalSales) * 100).toFixed(2)}%` : "0.00%", `领星${sourceName}`, "red"],
      ["ACOS", totalAdsSales ? `${((totalAdsCost / totalAdsSales) * 100).toFixed(2)}%` : "0.00%", `广告销售：${amount(totalAdsSales)}`, ""],
      ["销售毛利", amount(totalGrossProfit), totalSales ? `毛利率：${((totalGrossProfit / totalSales) * 100).toFixed(2)}%` : "毛利率：0.00%", "orange"],
    ],
    summary: [
      ["销售毛利", Math.round(totalGrossProfit).toLocaleString("zh-CN")],
      ["销售毛利率", totalSales ? `${((totalGrossProfit / totalSales) * 100).toFixed(2)}%` : "0.00%"],
      ["公司净利", Math.round(totalGrossProfit).toLocaleString("zh-CN")],
      ["公司净利率", totalSales ? `${((totalGrossProfit / totalSales) * 100).toFixed(2)}%` : "0.00%"],
      ["销售额", Math.round(totalSales).toLocaleString("zh-CN")],
      ["净销售额", Math.round(totalNetSales).toLocaleString("zh-CN")],
      ["广告花费", Math.round(totalAdsCost).toLocaleString("zh-CN")],
      ["广告销售额", Math.round(totalAdsSales).toLocaleString("zh-CN")],
      ["ACOS", totalAdsSales ? `${((totalAdsCost / totalAdsSales) * 100).toFixed(2)}%` : "0.00%"],
      ["退款率", totalSales ? `${((totalRefund / totalSales) * 100).toFixed(2)}%` : "0.00%"],
    ],
    ...trendData,
    dailyRows: buildDailyTableRows(dailyRows),
    storeData: buildStoreData(records, budgetResolver),
    profitData: buildProfitData(records, budgetResolver),
    filters: { ownerOptions },
    detailRows: buildBudgetMskuDetailRows(records, budgetTargets, inventoryRecords, sellers, listingOwnerRows, filters),
  };
}

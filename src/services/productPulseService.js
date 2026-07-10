import { mockDashboard } from "../data/mockDashboard.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getSyncState } from "./syncService.js";
import { readMskuDetailCache, saveMskuDetailCache } from "../utils/cacheStore.js";
import { getPacificTodayText } from "../utils/pacificDate.js";
import { getSharedSellers } from "./sharedDataService.js";

const USD_TO_CNY_RATE = 7.2;
const RULES = {
  rankDropRate: 0.2,
  efficiencyRate: 0.2,
  lossAmountCny: -100,
  noSalesAdCostUsd: 20,
  inventoryDays: 14,
  salesDropRate: -0.3,
};

function toNumber(value) {
  if (typeof value === "string") {
    value = value.replace(/,/g, "").replace(/%/g, "");
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function defaultPulseDate() {
  return getPacificTodayText();
}

function getRecordSid(record) {
  return Number(record.sid || record.seller_id || record.sellerId || record.store_id || record.storeId || 0);
}

function productKey(item) {
  return `${item.sid}:${item.msku}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function stablePulseCacheKey(filters) {
  return JSON.stringify({
    source: "daily-product-pulse-v3",
    date: filters.date || "",
    currencyCode: filters.currencyCode || "ORIGINAL",
    sids: Array.isArray(filters.sids) ? uniqueNumbers(filters.sids).sort((a, b) => a - b) : [],
  });
}

function groupProducts(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const sid = getRecordSid(record);
    const msku = String(readFirst(record, ["msku", "sellerSku", "seller_sku", "sku", "asin"]) || "").trim();
    if (!msku) return;
    const key = `${sid}:${msku}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        sid,
        storeName: readFirst(record, ["storeName", "store_name", "sellerName", "seller_name"]) || "-",
        country: readFirst(record, ["country", "countryName", "country_name", "countryCode", "country_code"]) || "-",
        msku,
        asin: readFirst(record, ["asin", "ASIN"]) || "-",
        sku: readFirst(record, ["sku", "localSku", "local_sku", "localName", "local_name"]) || "-",
        salesUnits: 0,
        salesAmount: 0,
        grossProfit: 0,
        adCost: 0,
        adSales: 0,
        inventoryAvailable: null,
        inventoryTransfer: null,
        inventoryInbound: null,
        dailyAvg14: 0,
        availableDays: null,
        replenishmentMatched: false,
        rank: "",
        previousRank: "",
        rankCategory: "",
      });
    }

    const item = grouped.get(key);
    item.salesUnits += toNumber(readFirst(record, ["totalSalesQuantity", "salesQuantity", "quantity", "volume"]));
    item.salesAmount += toNumber(readFirst(record, ["totalSalesAmount", "salesAmount", "amount", "sales"]));
    item.grossProfit += toNumber(readFirst(record, ["grossProfit", "gross_profit", "profit", "orderProfit"]));
    item.adCost += Math.abs(toNumber(readFirst(record, ["totalAdsCost", "adsCost", "spend", "ad_cost"])));
    item.adSales += toNumber(readFirst(record, ["totalAdsSales", "adsSales", "ad_sales_amount", "adSales"]));

    const available = readFirst(record, ["fbaAvailable", "fba_available", "availableQuantity", "available_quantity", "afnFulfillableQuantity"]);
    const transfer = readFirst(record, ["fbaTransfer", "fba_transfer", "reservedTransferQuantity", "transfer_quantity"]);
    const inbound = readFirst(record, ["fbaInbound", "fba_inbound", "inboundQuantity", "inbound_quantity", "afnInboundShippedQuantity"]);
    if (available !== "") item.inventoryAvailable = toNumber(available);
    if (transfer !== "") item.inventoryTransfer = toNumber(transfer);
    if (inbound !== "") item.inventoryInbound = toNumber(inbound);
    if (available !== "" || transfer !== "" || inbound !== "") item.replenishmentMatched = true;
    item.rank ||= readFirst(record, ["rank", "ranking", "smallRank", "small_rank", "bsr", "bestSellerRank"]);
  });

  return [...grouped.values()].map((item) => ({
    ...item,
    salesUnits: Math.round(item.salesUnits),
    salesAmount: Number(item.salesAmount.toFixed(2)),
    grossProfit: Number(item.grossProfit.toFixed(2)),
    adCost: Number(item.adCost.toFixed(2)),
    adSales: Number(item.adSales.toFixed(2)),
    acos: item.adSales ? item.adCost / item.adSales : 0,
    acoas: item.salesAmount ? item.adCost / item.salesAmount : 0,
    asoas: item.salesAmount ? item.adSales / item.salesAmount : 0,
  }));
}

function normalizeReplenishmentRecord(record, sellerBySid) {
  const basic = record?.basic_info || {};
  const quantity = record?.amazon_quantity_info || {};
  const sales = record?.sales_info || {};
  const suggest = record?.suggest_info || {};
  const mskuList = Array.isArray(basic.msku_fnsku_list) ? basic.msku_fnsku_list : [];
  const msku = String(readFirst(basic, ["msku"]) || mskuList[0]?.msku || readFirst(record, ["msku", "seller_sku"]) || "").trim();
  const sid = Number(basic.sid || record.sid || 0);
  if (!sid || !msku) return null;
  const seller = sellerBySid.get(sid) || {};

  return {
    sid,
    msku,
    storeName: seller.name || seller.seller_name || seller.shop_name || seller.store_name || sid,
    inventoryAvailable: toNumber(quantity.amazon_quantity_valid ?? quantity.afn_fulfillable_quantity),
    inventoryInbound: toNumber(quantity.amazon_quantity_shipping),
    inventoryTransfer: toNumber(quantity.reserved_fc_transfers) + toNumber(quantity.reserved_fc_processing),
    dailyAvg14: toNumber(sales.sales_avg_14),
    availableDays: toNumber(suggest.fba_available_sale_days || suggest.available_sale_days),
    replenishmentMatched: true,
  };
}

function normalizeProductPerformanceRecord(record, sellerBySid) {
  const priceInfo = Array.isArray(record.price_list) ? record.price_list[0] || {} : {};
  const sid = Number(priceInfo.sid || (Array.isArray(record.sids) ? record.sids[0] : 0) || record.sid || 0);
  const msku = String(priceInfo.seller_sku || record.msku || record.seller_sku || "").trim();
  if (!sid || !msku) return null;
  const seller = sellerBySid.get(sid) || {};
  const smallRanks = Array.isArray(record.small_cate_rank) ? record.small_cate_rank : [];
  const primarySmallRank = smallRanks
    .map((item) => ({
      category: readFirst(item, ["category"]) || "",
      rank: toNumber(readFirst(item, ["rank"])),
      previousRank: toNumber(readFirst(item, ["prev_rank", "previous_rank"])),
    }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => a.rank - b.rank)[0];

  return {
    sid,
    msku,
    storeName: seller.name || seller.seller_name || seller.shop_name || seller.store_name || priceInfo.seller_name || sid,
    rank: primarySmallRank?.rank || toNumber(readFirst(record, ["cate_rank"])),
    previousRank: primarySmallRank?.previousRank || toNumber(readFirst(record, ["prev_cate_rank"])),
    rankCategory: primarySmallRank?.category || readFirst(record, ["rank_category"]) || "",
    productImage: readFirst(record, ["small_image_url"]) || priceInfo.small_image_url || "",
    title: readFirst(record, ["item_name", "local_name"]) || priceInfo.local_name || "",
  };
}

async function fetchReplenishmentMap(adapter, { selectedSids, mskus, sellerBySid }) {
  const map = new Map();
  const uniqueMskus = [...new Set(mskus.filter(Boolean))];
  if (!uniqueMskus.length || !selectedSids.length) return map;
  const batches = chunkArray(uniqueMskus, 50);

  for (let index = 0; index < batches.length; index += 1) {
    if (index > 0) await sleep(1200);
    const params = {
      sid_list: selectedSids.map(String),
      data_type: 2,
      offset: 0,
      length: 50,
    };
    if (batches[index].length) params.msku_list = batches[index];
    const payload = await adapter.fetchReplenishmentAdvice(params);
    const records = adapter.normalizeRecordList(payload);
    records
      .map((record) => normalizeReplenishmentRecord(record, sellerBySid))
      .filter(Boolean)
      .forEach((item) => {
        map.set(productKey(item), item);
      });
  }

  return map;
}

async function fetchProductPerformanceMap(adapter, { selectedSids, date, currencyCode, sellerBySid }) {
  if (!selectedSids.length) return new Map();
  const payload = await adapter.fetchProductPerformance({
    sid: selectedSids,
    start_date: date,
    end_date: date,
    currencyCode,
  });
  const map = new Map();
  adapter.normalizeRecordList(payload)
    .map((record) => normalizeProductPerformanceRecord(record, sellerBySid))
    .filter(Boolean)
    .forEach((item) => {
      map.set(productKey(item), item);
    });
  return map;
}

function mergeProductSupplements(rows, replenishmentByKey, performanceByKey) {
  return rows.map((row) => {
    const key = productKey(row);
    const replenishment = replenishmentByKey.get(key) || {};
    const hasReplenishment = replenishmentByKey.has(key);
    const performance = performanceByKey.get(key) || {};
    return {
      ...row,
      inventoryAvailable: replenishment.inventoryAvailable ?? row.inventoryAvailable,
      inventoryTransfer: replenishment.inventoryTransfer ?? row.inventoryTransfer,
      inventoryInbound: replenishment.inventoryInbound ?? row.inventoryInbound,
      dailyAvg14: replenishment.dailyAvg14 ?? row.dailyAvg14,
      availableDays: replenishment.availableDays ?? row.availableDays,
      replenishmentMatched: hasReplenishment || row.replenishmentMatched,
      rank: performance.rank || row.rank,
      previousRank: performance.previousRank || row.previousRank,
      rankCategory: performance.rankCategory || row.rankCategory,
      productImage: performance.productImage || row.productImage,
      title: performance.title || row.title,
    };
  });
}

function compareProducts(todayRows, yesterdayRows) {
  const previousByKey = new Map(yesterdayRows.map((item) => [`${item.sid}:${item.msku}`, item]));
  return todayRows.map((item) => {
    const previous = previousByKey.get(`${item.sid}:${item.msku}`) || {};
    const previousUnits = toNumber(previous.salesUnits);
    const salesChange = previousUnits ? (item.salesUnits - previousUnits) / previousUnits : item.salesUnits > 0 ? 1 : 0;
    const adCostChange = previous.adCost ? (item.adCost - previous.adCost) / previous.adCost : item.adCost > 0 ? 1 : 0;
    return {
      ...item,
      previousSalesUnits: Math.round(previousUnits || 0),
      salesChange,
      adCostChange,
    };
  });
}

function averageRank(items) {
  const ranks = items
    .map((item) => toNumber(item.rank))
    .filter((rank) => rank > 0);
  if (!ranks.length) return 0;
  return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
}

function buildHistoryContext(item, history) {
  const key = productKey(item);
  const day1 = history.day1ByKey.get(key) || {};
  const day2 = history.day2ByKey.get(key) || {};
  const last3Items = [item, day1, day2].filter((row) => row?.msku);
  const last14 = history.last14ByKey.get(key) || {};
  const previousUnits = toNumber(day1.salesUnits);
  const salesChange = previousUnits ? (item.salesUnits - previousUnits) / previousUnits : item.salesUnits > 0 ? 1 : 0;
  const last3Losses = [item, day1, day2].map((row) => toNumber(row.grossProfit));
  const last14AverageDailySales = toNumber(item.dailyAvg14) || toNumber(last14.salesUnits) / 14;
  const rankAverage = toNumber(item.previousRank) || averageRank(last3Items);
  const currentRank = toNumber(item.rank);
  return {
    previousUnits,
    salesChange,
    rankAverage,
    currentRank,
    last3Losses,
    last14AverageDailySales,
  };
}

function adCostNoSalesThreshold(currencyCode) {
  return currencyCode === "CNY" ? RULES.noSalesAdCostUsd * USD_TO_CNY_RATE : RULES.noSalesAdCostUsd;
}

async function fetchOrderProfitSnapshot(adapter, params, label, dataWarnings, options = {}) {
  try {
    return await adapter.fetchMskuOrderProfit(params);
  } catch (error) {
    if (options.required) throw error;
    dataWarnings.push(`${label}读取失败：${error.message}`);
    return { data: [] };
  }
}

function scoreAnomaly(item, context, currencyCode = "CNY") {
  const signals = [];
  let score = 0;

  if (context.currentRank > 0 && context.rankAverage > 0 && context.currentRank >= context.rankAverage * (1 + RULES.rankDropRate)) {
    score += 24;
    signals.push(`商品小类排名较近3天均值下降超过20%`);
  }

  if (item.acos > RULES.efficiencyRate && item.acoas > RULES.efficiencyRate) {
    score += 26;
    signals.push(`ACOS 与 ACOAS 同时超过20%`);
  }

  if (context.last3Losses.length === 3 && context.last3Losses.every((value) => value <= RULES.lossAmountCny)) {
    score += 30;
    signals.push("连续3天毛利亏损超过100人民币");
  }

  const noSalesAdCostThreshold = adCostNoSalesThreshold(currencyCode);
  if (item.adCost > noSalesAdCostThreshold && item.salesUnits === 0) {
    score += 28;
    signals.push("广告花费超过20美金等值且销量为0");
  }

  const fbaSupportQuantity = toNumber(item.inventoryAvailable) + toNumber(item.inventoryTransfer);
  if (item.replenishmentMatched && context.last14AverageDailySales > 0 && fbaSupportQuantity < context.last14AverageDailySales * RULES.inventoryDays) {
    score += 24;
    signals.push("FBA在库+转库低于14天平均日销可支撑量");
  }

  if (context.previousUnits > 0 && context.salesChange <= RULES.salesDropRate) {
    score += 22;
    signals.push(`即时销量较昨日同口径下降${(Math.abs(context.salesChange) * 100).toFixed(0)}%`);
  }

  return {
    score,
    level: score >= 60 ? "高" : score >= 30 ? "中" : score > 0 ? "低" : "正常",
    signals,
    aiSummary: buildRuleAnalysis(item, signals, score),
  };
}

function buildRuleAnalysis(item, signals, score) {
  if (!score) return "未命中异动规则。";
  const first = signals[0] || "命中异动规则";
  return `${first}。请优先复核该MSKU的广告投放、库存、售价和利润结构。`;
}

function buildMockPulse() {
  const baseRows = mockDashboard.detailRows.slice(0, 10).map((row, index) => {
    const salesAmount = toNumber(row[6]);
    const adCost = toNumber(row[7]);
    const adSales = toNumber(row[8]);
    const salesUnits = Math.max(0, Math.round(salesAmount / 120));
    const grossProfit = toNumber(row[3]);
    return {
      sid: 0,
      storeName: row[0],
      country: row[2],
      msku: row[1],
      asin: "-",
      sku: row[1],
      salesUnits,
      previousSalesUnits: Math.max(0, salesUnits + (index % 3 === 0 ? 8 : -2)),
      salesAmount,
      grossProfit,
      adCost,
      adSales,
      acos: adSales ? adCost / adSales : 0,
      acoas: salesAmount ? adCost / salesAmount : 0,
      asoas: salesAmount ? adSales / salesAmount : 0,
      inventoryAvailable: index % 3 === 0 ? 2 : null,
      inventoryTransfer: null,
      inventoryInbound: null,
      dailyAvg14: Math.max(1, Math.round(salesUnits / 2)),
      availableDays: null,
      replenishmentMatched: index % 3 === 0,
      rank: "-",
      previousRank: "",
      rankCategory: "",
    };
  });
  const history = {
    day1ByKey: new Map(baseRows.map((item, index) => [productKey(item), {
      ...item,
      salesUnits: item.previousSalesUnits,
      grossProfit: index % 4 === 0 ? -180 : item.grossProfit,
    }])),
    day2ByKey: new Map(baseRows.map((item, index) => [productKey(item), {
      ...item,
      salesUnits: Math.max(0, item.previousSalesUnits - 2),
      grossProfit: index % 4 === 0 ? -160 : item.grossProfit,
    }])),
    last14ByKey: new Map(baseRows.map((item) => [productKey(item), {
      ...item,
      salesUnits: Math.max(14, item.salesUnits * 14),
    }])),
  };
  return baseRows.map((item) => ({
    ...item,
    salesChange: item.previousSalesUnits ? (item.salesUnits - item.previousSalesUnits) / item.previousSalesUnits : 0,
    adCostChange: 0,
    anomaly: scoreAnomaly(item, buildHistoryContext(item, history), "CNY"),
  }));
}

function summarize(rows, topAnomalies, date, source, cacheHit = false) {
  const totals = rows.reduce(
    (acc, item) => {
      acc.salesUnits += item.salesUnits || 0;
      acc.salesAmount += item.salesAmount || 0;
      acc.adCost += item.adCost || 0;
      acc.adSales += item.adSales || 0;
      acc.grossProfit += item.grossProfit || 0;
      return acc;
    },
    { salesUnits: 0, salesAmount: 0, adCost: 0, adSales: 0, grossProfit: 0 },
  );
  return {
    ok: true,
    source,
    date,
    cacheHit,
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    totals: {
      ...totals,
      acos: totals.adSales ? totals.adCost / totals.adSales : 0,
      acoas: totals.salesAmount ? totals.adCost / totals.salesAmount : 0,
      asoas: totals.salesAmount ? totals.adSales / totals.salesAmount : 0,
    },
    topAnomalies,
    rows,
    aiNote: "当前按固定规则筛选，不接入AI。库存、14天日销和小类排名会在对应接口成功返回后参与判断。",
  };
}

export async function getDailyProductPulse(filters = {}) {
  const date = filters.date || filters.endDate || defaultPulseDate();
  const syncState = getSyncState();
  if (syncState.provider !== "lingxing") {
    const rows = buildMockPulse();
    const topAnomalies = rows.filter((item) => item.anomaly.score > 0).sort((a, b) => b.anomaly.score - a.anomaly.score).slice(0, 10);
    return summarize(rows, topAnomalies, date, "模拟数据");
  }

  const cacheKey = stablePulseCacheKey({ ...filters, date });
  const cached = await readMskuDetailCache(cacheKey, 30 * 60 * 1000);
  if (cached?.data) {
    return { ...cached.data, cacheHit: true, updatedAt: cached.updatedAt || cached.data.updatedAt };
  }

  const adapter = getLingxingAdapter();
  const sellersResult = await getSharedSellers({ adapter });
  const sellerList = filterCoreSellers(sellersResult.sellers || []);
  const activeSids = sellerList
    .filter((seller) => !seller.status || seller.status === 1)
    .map((seller) => seller.sid);
  const uniqueActiveSids = uniqueNumbers(activeSids);
  const allowedSidSet = new Set(uniqueActiveSids);
  const selectedSids = Array.isArray(filters.sids) && filters.sids.length
    ? filters.sids.map(Number).filter((sid) => allowedSidSet.has(sid))
    : uniqueActiveSids;
  const sellerBySid = new Map(
    sellerList
      .map((seller) => [Number(seller.sid), seller])
      .filter(([sid]) => Number.isFinite(sid) && sid > 0),
  );

  const requestBase = {
    currencyCode: filters.currencyCode || "ORIGINAL",
    sids: selectedSids,
  };
  const day1 = addDays(date, -1);
  const day2 = addDays(date, -2);
  const last14Start = addDays(date, -13);
  const dataWarnings = [];
  const todayPayload = await fetchOrderProfitSnapshot(
    adapter,
    { ...requestBase, startDate: date, endDate: date },
    "当天订单利润",
    dataWarnings,
    { required: true },
  );
  await sleep(1200);
  const day1Payload = await fetchOrderProfitSnapshot(
    adapter,
    { ...requestBase, startDate: day1, endDate: day1 },
    "昨日订单利润",
    dataWarnings,
  );
  await sleep(1200);
  const day2Payload = await fetchOrderProfitSnapshot(
    adapter,
    { ...requestBase, startDate: day2, endDate: day2 },
    "前日订单利润",
    dataWarnings,
  );
  await sleep(1200);
  const last14Payload = await fetchOrderProfitSnapshot(
    adapter,
    { ...requestBase, startDate: last14Start, endDate: date },
    "近14天订单利润",
    dataWarnings,
  );
  let todayRows = groupProducts(adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(todayPayload), sellerList, date));
  const previousRows = groupProducts(adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(day1Payload), sellerList, day1));
  const day2Rows = groupProducts(adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(day2Payload), sellerList, day2));
  const last14Rows = groupProducts(adapter.normalizeMskuOrderProfitRecords(adapter.normalizeRecordList(last14Payload), sellerList, last14Start));

  const currentMskus = todayRows.map((item) => item.msku).filter(Boolean);
  let replenishmentByKey = new Map();
  let performanceByKey = new Map();
  try {
    replenishmentByKey = await fetchReplenishmentMap(adapter, {
      selectedSids,
      mskus: currentMskus,
      sellerBySid,
    });
  } catch (error) {
    dataWarnings.push(`补货建议读取失败：${error.message}`);
  }

  try {
    performanceByKey = await fetchProductPerformanceMap(adapter, {
      selectedSids,
      date,
      currencyCode: requestBase.currencyCode,
      sellerBySid,
    });
  } catch (error) {
    dataWarnings.push(`产品表现读取失败：${error.message}`);
  }

  todayRows = mergeProductSupplements(todayRows, replenishmentByKey, performanceByKey);
  const history = {
    day1ByKey: new Map(previousRows.map((item) => [productKey(item), item])),
    day2ByKey: new Map(day2Rows.map((item) => [productKey(item), item])),
    last14ByKey: new Map(last14Rows.map((item) => [productKey(item), item])),
  };
  const rows = compareProducts(todayRows, previousRows)
    .map((item) => ({
      ...item,
      anomaly: scoreAnomaly(item, buildHistoryContext(item, history), requestBase.currencyCode),
    }))
    .sort((a, b) => b.anomaly.score - a.anomaly.score || b.salesAmount - a.salesAmount);
  const topAnomalies = rows.filter((item) => item.anomaly.score > 0).slice(0, 10);
  const data = {
    ...summarize(rows, topAnomalies, date, "领星 ERP · 订单利润+补货建议+产品表现"),
    dataWarnings,
  };
  await saveMskuDetailCache(cacheKey, data);
  return data;
}

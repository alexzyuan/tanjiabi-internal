import { getConfig } from "../config/index.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { readMskuDetailCache, saveMskuDetailCache } from "../utils/cacheStore.js";
import { formatDate, getPacificTodayDate } from "../utils/pacificDate.js";
import { listFilterValues, matchesAnyFilter } from "../utils/filterUtils.js";
import { getSharedSellers } from "./sharedDataService.js";

const RED_THRESHOLD_DAYS = 28;
const ORANGE_THRESHOLD_DAYS = 35;
const YELLOW_THRESHOLD_DAYS = 42;

const mockRows = [
  ["xiamentanjia-US", "美国", "JM-DGC-BLUE", "灯光船蓝色", 383, 738, 2161, 18.6, "本周未收"],
  ["tandanbo-US", "美国", "MD-LEGPINK", "粉色洗碗机", 1076, 609, 398, 55.5, "本周未收"],
  ["xiamentanjia-CA", "加拿大", "JMCA-009Bubble-Pink", "粉色泡泡机", 58, 2, 612, 33.2, "可能产生"],
  ["tandanbo-CA", "加拿大", "CAMD-2Pack Bubble Guns", "双只泡泡枪", 48, 1, 480, 41.8, "可能产生"],
].map(([storeName, country, msku, title, inventoryAvailable, inventoryTransfer, inventoryInbound, amazonHistoricalDays, feeApplied]) => ({
  storeName,
  country,
  msku,
  fnsku: msku,
  productName: title,
  title,
  inventoryAvailable,
  inventoryTransfer,
  inventoryInbound,
  amazonHistoricalDays,
  feeApplied,
}));

function dateText(date = getPacificTodayDate()) {
  return formatDate(date);
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function sellerName(seller) {
  return readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]) || "";
}

function sellerCountry(seller) {
  return readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName"]) || "";
}

function normalizeCountryCode(value) {
  const text = String(value || "").trim();
  const upper = text.toUpperCase();
  if (["US", "USA", "美国"].includes(upper) || text === "美国") return "US";
  if (["CA", "CANADA", "加拿大"].includes(upper) || text === "加拿大") return "CA";
  if (["AU", "AUS", "AUSTRALIA", "澳洲", "澳大利亚"].includes(upper) || text === "澳洲" || text === "澳大利亚") return "AU";
  if (["MX", "MEXICO", "墨西哥"].includes(upper) || text === "墨西哥") return "MX";
  if (["BR", "BRAZIL", "巴西"].includes(upper) || text === "巴西") return "BR";
  return upper;
}

function sellerCountryCode(seller) {
  const explicit = normalizeCountryCode(readFirst(seller, ["countryCode", "country_code", "region", "marketplaceCode"]));
  if (explicit) return explicit;
  const byCountry = normalizeCountryCode(sellerCountry(seller));
  if (byCountry) return byCountry;
  const name = sellerName(seller);
  const match = name.match(/-(US|CA|AU|MX|BR)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function riskLevel(days) {
  if (days < RED_THRESHOLD_DAYS) return "高";
  if (days < ORANGE_THRESHOLD_DAYS) return "中";
  if (days < YELLOW_THRESHOLD_DAYS) return "低";
  return "正常";
}

function feeFlagText(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text;
}

function normalizeInventoryRecord(record, sellerBySid) {
  const sid = toNumber(readFirst(record, ["sid", "seller_id", "sellerId", "store_id", "storeId"]));
  const seller = sellerBySid.get(sid) || {};
  const msku = String(readFirst(record, ["seller_sku", "msku", "sellerSku", "sku"]) || "").trim();
  const fnsku = String(readFirst(record, ["fnsku", "fulfillmentNetworkSku", "fulfillment_network_sku"]) || "").trim();
  if (!sid || !msku) return null;

  const inventoryAvailable = toNumber(readFirst(record, [
    "afn_fulfillable_quantity",
    "total_fulfillable_quantity",
    "available_total",
    "fba_available_quantity",
    "available_quantity",
  ]));
  const inventoryTransfer = toNumber(readFirst(record, ["reserved_fc_transfers"]))
    + toNumber(readFirst(record, ["reserved_fc_processing"]));
  const inventoryInbound = toNumber(readFirst(record, ["afn_inbound_working_quantity"]))
    + toNumber(readFirst(record, ["afn_inbound_shipped_quantity"]))
    + toNumber(readFirst(record, ["afn_inbound_receiving_quantity"]));

  return {
    sid,
    storeName: sellerName(seller) || readFirst(record, ["store_name", "storeName", "seller_name", "sellerName"]) || String(sid),
    country: sellerCountry(seller) || readFirst(record, ["country", "countryName", "country_name", "marketplace"]) || "",
    countryCode: normalizeCountryCode(readFirst(record, ["country", "countryCode", "country_code", "marketplace"]) || sellerCountryCode(seller)),
    msku,
    fnsku,
    productName: readFirst(record, ["product_name", "productName", "local_name", "name", "item_name", "title"]) || "",
    title: readFirst(record, ["product_name", "productName", "local_name", "name", "item_name", "title"]) || "",
    inventoryAvailable,
    inventoryTransfer,
    inventoryInbound,
    amazonHistoricalDays: toNumber(readFirst(record, ["historical_days_of_supply", "historical_days_of_supply_price"])),
    feeApplied: feeFlagText(readFirst(record, ["low_inventory_level_fee_applied"])),
    healthStatus: readFirst(record, ["fba_inventory_level_health_status"]) || "",
  };
}

async function fetchAllInventory(adapter, sids) {
  const rows = [];
  for (let offset = 0; offset < 1200; offset += 200) {
    const payload = await adapter.fetchFbaInventoryDetails({
      sid: sids.join(","),
      offset,
      length: 200,
    });
    const records = adapter.normalizeRecordList(payload);
    rows.push(...records);
    const total = Number(payload?.data?.total || payload?.total || 0);
    if (!records.length || records.length < 200 || (total && rows.length >= total)) break;
  }
  return rows;
}

function buildDashboardFromRows(rows, { source, syncStatus, date, endDate }) {
  const computedRows = rows.map((row) => {
    const historicalDays = toNumber(row.amazonHistoricalDays);
    const amazonFeeEligible = historicalDays > 0 && historicalDays < RED_THRESHOLD_DAYS;
    const eligible = historicalDays > 0 && historicalDays < YELLOW_THRESHOLD_DAYS;
    const level = eligible ? riskLevel(historicalDays || 0) : "正常";
    return {
      ...row,
      amazonHistoricalDays: historicalDays,
      amazonFeeEligible,
      eligible,
      riskLevel: level,
      reason: eligible
        ? `${amazonFeeEligible ? "已进入低库存费区间" : "提前预警"}：亚马逊历史供货天数${historicalDays ? `${historicalDays}天` : "未返回"}`
        : "亚马逊历史供货天数未低于42天",
    };
  });
  const riskRows = computedRows.filter((row) => row.eligible);
  const highRiskRows = computedRows.filter((row) => row.riskLevel === "高");
  const avgHistoricalDays = riskRows.length
    ? round(riskRows.reduce((sum, row) => sum + toNumber(row.amazonHistoricalDays), 0) / riskRows.length)
    : 0;

  return {
    meta: {
      source,
      syncStatus,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      date,
      endDate,
      ruleText: "低库存水平费预警：直接取领星 FBA 库存明细中的亚马逊 Historical days of supply；低于28天红色，低于35天橙色，低于42天浅黄色；领星低库存费标记只展示，不参与风险分档。",
    },
    kpis: {
      mskuCount: computedRows.length,
      riskCount: riskRows.length,
      highRiskCount: highRiskRows.length,
      avgHistoricalDays,
    },
    rows: computedRows
      .sort((a, b) => {
        const riskOrder = { 高: 0, 中: 1, 低: 2, 正常: 3 };
        return (riskOrder[a.riskLevel] ?? 9) - (riskOrder[b.riskLevel] ?? 9)
          || toNumber(a.amazonHistoricalDays) - toNumber(b.amazonHistoricalDays);
      }),
  };
}

function buildMockDashboard() {
  const endDate = dateText();
  return buildDashboardFromRows(mockRows, {
    source: "模拟数据 · 低库存费预警",
    syncStatus: "本地预览数据，部署后读取领星 FBA 库存明细",
    date: endDate,
    endDate,
  });
}

export async function getLowInventoryFeeDashboard(filters = {}) {
  const config = getConfig();
  if (config.dataProvider !== "lingxing") {
    return filterDashboard(buildMockDashboard(), {
      country: listFilterValues(filters.country),
      storeName: listFilterValues(filters.storeName),
      keyword: String(filters.keyword || "").trim().toLowerCase(),
      onlyRisk: String(filters.onlyRisk || "1") !== "0",
    });
  }

  const endDate = filters.date || dateText();
  const country = listFilterValues(filters.country);
  const storeName = listFilterValues(filters.storeName);
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const onlyRisk = String(filters.onlyRisk || "1") !== "0";
  const cacheKey = JSON.stringify({ scope: "low-inventory-fee-fba-detail-v7-historical-days-only", endDate });
  const cached = await readMskuDetailCache(cacheKey, 60 * 60 * 1000);
  if (cached?.data) {
    let data = { ...cached.data, cacheHit: true, updatedAt: cached.updatedAt || cached.data.updatedAt };
    data = filterDashboard(data, { country, storeName, keyword, onlyRisk });
    return data;
  }

  const adapter = getLingxingAdapter();
  const sellers = filterCoreSellers((await getSharedSellers({ adapter })).sellers || []).filter((seller) => !seller.status || seller.status === 1);
  const sellerBySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]).filter(([sid]) => sid));
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const inventoryRecords = await fetchAllInventory(adapter, sids);
  const rows = inventoryRecords
    .map((record) => normalizeInventoryRecord(record, sellerBySid))
    .filter(Boolean);

  const data = buildDashboardFromRows(rows, {
    source: "领星 ERP · FBA库存明细",
    syncStatus: `已读取 FBA 库存明细 ${rows.length} 条`,
    date: endDate,
    endDate,
  });
  await saveMskuDetailCache(cacheKey, data);
  return filterDashboard(data, { country, storeName, keyword, onlyRisk });
}

export async function debugLowInventoryLedgerSource(filters = {}) {
  const endDate = filters.date || dateText();
  const adapter = getLingxingAdapter();
  const sellers = filterCoreSellers((await getSharedSellers({ adapter })).sellers || []).filter((seller) => !seller.status || seller.status === 1);
  const sids = uniqueNumbers(sellers.map((seller) => seller.sid));
  const sampleSids = sids.slice(0, 6);
  if (!sampleSids.length) {
    return {
      ok: false,
      error: "店铺列表未返回 sid，无法读取 FBA 库存明细。",
      sellerSample: sellers.slice(0, 2),
    };
  }
  const payload = await adapter.fetchFbaInventoryDetails({
    sid: sampleSids.join(","),
    offset: 0,
    length: 20,
  });
  const records = adapter.normalizeRecordList(payload);
  const sellerBySid = new Map(sellers.map((seller) => [Number(seller.sid), seller]).filter(([sid]) => sid));
  return {
    ok: true,
    endpoint: "/basicOpen/openapi/storage/fbaWarehouseDetail",
    sellerCount: sellers.length,
    sids: sampleSids,
    requestParams: {
      sid: sampleSids.join(","),
      offset: 0,
      length: 20,
    },
    code: payload.code,
    success: payload.success,
    message: payload.message || payload.msg || "",
    total: payload?.data?.total || payload.total || 0,
    recordCount: records.length,
    sampleKeys: Object.keys(records[0] || {}),
    sample: records[0] || null,
    normalizedSample: records[0] ? normalizeInventoryRecord(records[0], sellerBySid) : null,
  };
}

function filterDashboard(data, { country, storeName, keyword, onlyRisk }) {
  const rows = (data.rows || [])
    .filter((row) => matchesAnyFilter(row.country, country))
    .filter((row) => matchesAnyFilter(row.storeName, storeName))
    .filter((row) => !keyword || `${row.fnsku} ${row.msku} ${row.productName} ${row.title}`.toLowerCase().includes(keyword))
    .filter((row) => !onlyRisk || row.eligible);
  return {
    ...data,
    filters: {
      countryOptions: [...new Set((data.rows || []).map((row) => row.country).filter(Boolean))]
        .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
        .map((name) => ({ name })),
      storeOptions: [...new Set((data.rows || []).map((row) => row.storeName))]
        .map((name) => {
          const match = (data.rows || []).find((row) => row.storeName === name);
          return { name, country: match?.country || "" };
        }),
    },
    rows,
  };
}

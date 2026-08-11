import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { saveInventoryProvisionHistoryCache } from "../utils/cacheStore.js";
import { getPacificTodayText } from "../utils/pacificDate.js";
import { fetchLingxingListingsBySidMskus, fetchLingxingProductRecords } from "./lingxingCatalogLookupService.js";
import { loadHistoricalInventoryRows } from "./inventoryProvisionService.js";
import { getSharedSellers } from "./sharedDataService.js";

const REQUIRED_GERMAN_SID = 17307;
const REQUIRED_GERMAN_STORE = "tanjia-eu-DE";
const FIRST_LEG_COST_KEYS = [
  "unit_first_leg_fee",
  "first_leg_cost",
  "firstLegCost",
  "first_transport_fee",
  "head_cost",
  "unit_head_cost",
  "unit_shipping_cost",
  "freight_cost",
  "cg_transport_costs",
  "unit_cg_transport_costs",
];
const PURCHASE_COST_KEYS = [
  "purchase_price",
  "purchasePrice",
  "purchase_cost",
  "purchaseCost",
  "cg_price",
  "unit_cg_price",
  "unit_purchase_cost",
  "product_purchase_cost",
  "local_purchase_cost",
];

function monthText(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error("成本刷新月份必须是 YYYY-MM 格式。");
  return value;
}

function shiftMonth(month, delta) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function readableValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function readCost(record, keys) {
  for (const key of keys) {
    if (!readableValue(record?.[key])) continue;
    const value = Number(String(record[key]).replace(/,/g, "").replace(/[¥￥]/g, ""));
    if (!Number.isFinite(value)) throw new Error(`产品管理字段 ${key} 不是有效数字。`);
    return { value, field: key };
  }
  return null;
}

function listingMsku(record) {
  return String(record?.seller_sku || record?.sellerSku || record?.msku || record?.m_sku || "").trim();
}

function listingInternalSku(record) {
  return String(record?.local_sku || record?.localSku || record?.sku || record?.product_sku || "").trim();
}

function productSku(record) {
  return String(record?.sku || record?.local_sku || record?.localSku || record?.product_sku || "").trim();
}

function inventoryIdentity(row) {
  return `${Number(row.sid || 0)}|${normalizeKey(row.msku)}`;
}

function diagnosticRow(row, internalSku = "") {
  return `店铺 ${row.storeName || "-"}（SID ${row.sid || "-"}）MSKU ${row.msku || "-"}${internalSku ? `，内部 SKU ${internalSku}` : ""}`;
}

function verifyRefreshMonth(date, todayText) {
  const month = monthText(date);
  const currentMonth = String(todayText() || "").slice(0, 7);
  monthText(currentMonth);
  if (month >= currentMonth) throw new Error("刷新成本仅支持历史月份；当前月使用实时 FBA 成本。");
  if (month < "2026-04") throw new Error("库存计提成本刷新仅支持 2026-04 及之后的月份。");
  return month;
}

export function createInventoryProvisionCostRefreshService({
  adapter = getLingxingAdapter(),
  todayText = getPacificTodayText,
  nowText = () => new Date().toLocaleString("zh-CN", { hour12: false }),
  getSellers = getSharedSellers,
  loadHistoricalRows = loadHistoricalInventoryRows,
  fetchListingsBySidMskus = fetchLingxingListingsBySidMskus,
  fetchProductRecords = fetchLingxingProductRecords,
  saveHistoryCache = saveInventoryProvisionHistoryCache,
  logger = console,
} = {}) {
  async function refresh({ date } = {}) {
    const targetMonth = verifyRefreshMonth(date, todayText);
    const comparisonMonth = shiftMonth(targetMonth, -1);
    const directory = await getSellers({ forceRefresh: true });
    const sellers = filterCoreSellers(directory?.sellers || []);
    if (!sellers.some((seller) => Number(seller.sid) === REQUIRED_GERMAN_SID)) {
      throw new Error(`运行时店铺目录缺少德国店铺 ${REQUIRED_GERMAN_STORE}（SID ${REQUIRED_GERMAN_SID}）。`);
    }

    const months = [comparisonMonth, targetMonth];
    const historicalData = await Promise.all(months.map((month) => loadHistoricalRows(month, {
      adapter,
      sellers,
      forceRefresh: true,
      persist: false,
    })));
    const rows = historicalData.flatMap((data) => data.rows || []);
    const rowsByIdentity = new Map();
    rows.forEach((row) => rowsByIdentity.set(inventoryIdentity(row), row));

    const listingByIdentity = new Map();
    const mskusBySid = new Map();
    rowsByIdentity.forEach((row) => {
      const sid = Number(row.sid || 0);
      if (!sid || !row.msku) throw new Error(`历史库存缺少成本匹配标识：${diagnosticRow(row)}。`);
      if (!mskusBySid.has(sid)) mskusBySid.set(sid, []);
      mskusBySid.get(sid).push(row.msku);
    });
    for (const [sid, mskus] of mskusBySid.entries()) {
      const listingRecords = await fetchListingsBySidMskus(adapter, sid, uniqueText(mskus), { strict: true });
      listingRecords.forEach((record) => {
        const msku = listingMsku(record);
        if (msku) listingByIdentity.set(`${sid}|${normalizeKey(msku)}`, { ...record, sid });
      });
    }

    const internalSkuByIdentity = new Map();
    rowsByIdentity.forEach((row, identity) => {
      const listing = listingByIdentity.get(identity);
      const internalSku = listingInternalSku(listing);
      if (!internalSku) throw new Error(`Listing 未返回内部 SKU：${diagnosticRow(row)}。`);
      internalSkuByIdentity.set(identity, internalSku);
    });

    const productBySku = new Map();
    for (const skus of chunk(uniqueText([...internalSkuByIdentity.values()]), 80)) {
      const records = await fetchProductRecords(adapter, { skus }, { sku_list: skus }, { strict: true });
      records.forEach((record) => {
        const sku = productSku(record);
        if (sku) productBySku.set(normalizeKey(sku), record);
      });
    }

    const refreshedAt = nowText();
    const refreshedByIdentity = new Map();
    rowsByIdentity.forEach((row, identity) => {
      const internalSku = internalSkuByIdentity.get(identity);
      const product = productBySku.get(normalizeKey(internalSku));
      if (!product) throw new Error(`产品管理未返回产品：${diagnosticRow(row, internalSku)}。`);
      const purchase = readCost(product, PURCHASE_COST_KEYS);
      if (!purchase) throw new Error(`产品管理缺少采购成本：${diagnosticRow(row, internalSku)}。`);
      const firstLeg = readCost(product, FIRST_LEG_COST_KEYS);
      if (!firstLeg) throw new Error(`产品管理缺少单位头程成本：${diagnosticRow(row, internalSku)}。`);
      refreshedByIdentity.set(identity, {
        ...row,
        purchaseCost: purchase.value,
        firstLegCost: firstLeg.value,
        costSource: "lingxing-product-management",
        costPurchaseField: purchase.field,
        costFirstLegField: firstLeg.field,
      });
    });

    const prepared = historicalData.map((data, index) => {
      const month = months[index];
      const nextRows = (data.rows || []).map((row) => refreshedByIdentity.get(inventoryIdentity(row)) || row);
      return {
        month,
        data: {
          ...data,
          rows: nextRows,
          costSource: "lingxing-product-management",
          costRefreshedAt: refreshedAt,
          costRefreshMonth: targetMonth,
          costRefreshSummary: {
            updatedRows: nextRows.length,
            listingMatches: nextRows.length,
            productMatches: nextRows.length,
          },
        },
      };
    });

    const writtenMonths = [];
    try {
      for (const entry of prepared) {
        await saveHistoryCache(entry.month, entry.data);
        writtenMonths.push(entry.month);
      }
    } catch (error) {
      error.details = {
        ...(error.details || {}),
        writtenMonths,
        pendingMonths: months.filter((month) => !writtenMonths.includes(month)),
      };
      throw error;
    }

    const result = {
      date: targetMonth,
      comparisonMonth,
      refreshedAt,
      months: prepared.map(({ month, data }) => ({
        month,
        rows: data.rows.length,
        updatedRows: data.rows.length,
        listingMatches: data.rows.length,
        productMatches: data.rows.length,
      })),
      diagnostics: [],
    };
    logger.info?.("[inventory-provision-cost-refresh] completed", {
      date: targetMonth,
      comparisonMonth,
      sellerCount: sellers.length,
      updatedRows: result.months.reduce((total, month) => total + month.updatedRows, 0),
      refreshedAt,
    });
    return result;
  }

  return { refresh };
}

const defaultService = createInventoryProvisionCostRefreshService();

export function refreshInventoryProvisionCosts(input) {
  return defaultService.refresh(input);
}

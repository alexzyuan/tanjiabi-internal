import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import {
  readInventoryProvisionHistoryCache,
  saveInventoryProvisionHistoryCache,
} from "../utils/cacheStore.js";
import { getPacificTodayText } from "../utils/pacificDate.js";
import { fetchLingxingListingsBySidMskus, fetchLingxingProductRecords } from "./lingxingCatalogLookupService.js";
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

function currentYearCompletedMonths(todayText) {
  const today = String(todayText() || "");
  const match = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const monthNumber = Number(match?.[2]);
  if (!match || monthNumber < 1 || monthNumber > 12) throw new Error("成本刷新日期必须是 YYYY-MM-DD 格式。");
  if (monthNumber === 1) throw new Error("本年度暂无已结束月份可刷新。");
  const year = match[1];
  return {
    year,
    months: Array.from({ length: monthNumber - 1 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`),
  };
}

export function createInventoryProvisionCostRefreshService({
  adapter = getLingxingAdapter(),
  todayText = getPacificTodayText,
  nowText = () => new Date().toLocaleString("zh-CN", { hour12: false }),
  getSellers = getSharedSellers,
  readHistoryCache = readInventoryProvisionHistoryCache,
  fetchListingsBySidMskus = fetchLingxingListingsBySidMskus,
  fetchProductRecords = fetchLingxingProductRecords,
  saveHistoryCache = saveInventoryProvisionHistoryCache,
  logger = console,
} = {}) {
  async function refresh() {
    const operationId = `inventory-provision-cost-refresh-${Date.now()}`;
    let year = "";
    let months = [];
    let stage = "initialize";
    let rowCount = 0;
    let listingRequestCount = 0;
    let productRequestCount = 0;
    const stageDurations = {};
    const lookupMetrics = {
      increment(name) {
        if (name === "lingxingListingRequests") listingRequestCount += 1;
        if (name === "lingxingProductInfoRequests" || name === "lingxingProductFallbackRequests") {
          productRequestCount += 1;
        }
      },
    };
    const operationStartedAt = Date.now();
    const markStage = (name, startedAt) => {
      stageDurations[name] = Date.now() - startedAt;
    };

    try {
      ({ year, months } = currentYearCompletedMonths(todayText));

      stage = "seller-directory";
      const sellerStartedAt = Date.now();
      const directory = await getSellers({ forceRefresh: true });
      const sellers = filterCoreSellers(directory?.sellers || []);
      markStage("sellerDirectoryMs", sellerStartedAt);
      if (!sellers.some((seller) => Number(seller.sid) === REQUIRED_GERMAN_SID)) {
        throw new Error(`运行时店铺目录缺少德国店铺 ${REQUIRED_GERMAN_STORE}（SID ${REQUIRED_GERMAN_SID}）。`);
      }

      stage = "history-cache-read";
      const cacheStartedAt = Date.now();
      const historicalData = await Promise.all(months.map(async (month) => {
        const cached = await readHistoryCache(month);
        if (!cached?.data || !Array.isArray(cached.data.rows) || !cached.data.rows.length) {
          throw new Error(`库存计提历史缓存缺失：${month}`);
        }
        return { month, data: cached.data, cacheUpdatedAt: cached.updatedAt || "" };
      }));
      markStage("historyCacheReadMs", cacheStartedAt);

      const rows = historicalData.flatMap(({ data }) => data.rows);
      rowCount = rows.length;
      const rowsByIdentity = new Map();
      rows.forEach((row) => {
        const sid = Number(row.sid || 0);
        if (!sid || !row.msku) throw new Error(`历史库存缺少成本匹配标识：${diagnosticRow(row)}。`);
        rowsByIdentity.set(inventoryIdentity(row), row);
      });

      stage = "listing-lookup";
      const listingStartedAt = Date.now();
      const listingByIdentity = new Map();
      const mskusBySid = new Map();
      rowsByIdentity.forEach((row) => {
        const sid = Number(row.sid);
        if (!mskusBySid.has(sid)) mskusBySid.set(sid, []);
        mskusBySid.get(sid).push(row.msku);
      });
      for (const [sid, mskus] of mskusBySid.entries()) {
        const listingRecords = await fetchListingsBySidMskus(adapter, sid, uniqueText(mskus), {
          strict: true,
          metrics: lookupMetrics,
        });
        listingRecords.forEach((record) => {
          const msku = listingMsku(record);
          if (msku) listingByIdentity.set(`${sid}|${normalizeKey(msku)}`, { ...record, sid });
        });
      }
      markStage("listingLookupMs", listingStartedAt);

      const internalSkuByIdentity = new Map();
      rowsByIdentity.forEach((row, identity) => {
        const listing = listingByIdentity.get(identity);
        const internalSku = listingInternalSku(listing);
        if (!internalSku) throw new Error(`Listing 未返回内部 SKU：${diagnosticRow(row)}。`);
        internalSkuByIdentity.set(identity, internalSku);
      });

      stage = "product-lookup";
      const productStartedAt = Date.now();
      const productBySku = new Map();
      const productSkus = uniqueText([...internalSkuByIdentity.values()]);
      for (const skus of chunk(productSkus, 80)) {
        const records = await fetchProductRecords(adapter, { skus }, { sku_list: skus }, {
          strict: true,
          metrics: lookupMetrics,
        });
        records.forEach((record) => {
          const sku = productSku(record);
          if (sku) productBySku.set(normalizeKey(sku), record);
        });
      }
      markStage("productLookupMs", productStartedAt);

      stage = "cost-validation";
      const validationStartedAt = Date.now();
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
      markStage("costValidationMs", validationStartedAt);

      const prepared = historicalData.map(({ month, data }) => {
        const nextRows = data.rows.map((row) => refreshedByIdentity.get(inventoryIdentity(row)) || row);
        return {
          month,
          data: {
            ...data,
            rows: nextRows,
            costSource: "lingxing-product-management",
            costRefreshedAt: refreshedAt,
            costRefreshYear: year,
            costRefreshMonths: months,
            costRefreshSummary: {
              updatedRows: nextRows.length,
              listingMatches: nextRows.length,
              productMatches: nextRows.length,
            },
          },
        };
      });

      stage = "cache-write";
      const writeStartedAt = Date.now();
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
      } finally {
        markStage("cacheWriteMs", writeStartedAt);
      }

      const result = {
        year,
        months: prepared.map(({ month, data }) => ({
          month,
          rows: data.rows.length,
          updatedRows: data.rows.length,
          listingMatches: data.rows.length,
          productMatches: data.rows.length,
        })),
        totalRows: rows.length,
        updatedRows: rows.length,
        refreshedAt,
        diagnostics: [],
      };
      stageDurations.totalMs = Date.now() - operationStartedAt;
      logger.info?.("[inventory-provision-cost-refresh] completed", {
        operationId,
        year,
        monthCount: months.length,
        rowCount,
        sellerCount: sellers.length,
        listingRequestCount,
        productRequestCount,
        stageDurations,
        refreshedAt,
      });
      return result;
    } catch (error) {
      stageDurations.totalMs = Date.now() - operationStartedAt;
      error.details = {
        ...(error.details || {}),
        stage,
      };
      logger.error?.("[inventory-provision-cost-refresh] failed", {
        operationId,
        year,
        months,
        monthCount: months.length,
        rowCount,
        listingRequestCount,
        productRequestCount,
        stage,
        stageDurations,
        error: error.message,
      });
      throw error;
    }
  }

  return { refresh };
}

const defaultService = createInventoryProvisionCostRefreshService();

export function refreshInventoryProvisionCosts(input) {
  return defaultService.refresh(input);
}

import { randomUUID } from "node:crypto";
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
const STAGE_DURATION_KEYS = {
  initialize: "initializeMs",
  "seller-directory": "sellerDirectoryMs",
  "history-cache-read": "historyCacheReadMs",
  "listing-lookup": "listingLookupMs",
  "product-lookup": "productLookupMs",
  "cost-validation": "costValidationMs",
  "cache-write": "cacheWriteMs",
};
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

function parseCostValue(value, field) {
  const parsed = Number(String(value).replace(/,/g, "").replace(/[¥￥]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`产品管理字段 ${field} 不是有效数字。`);
  return parsed;
}

function readCost(record, keys) {
  for (const key of keys) {
    if (!readableValue(record?.[key])) continue;
    return { value: parseCostValue(record[key], key), field: key };
  }
  return null;
}

function readFirstLegCost(record, countryCode) {
  const country = String(countryCode || "").trim().toUpperCase();
  const relationKey = country ? `${country}_cg_transport_costs` : "";
  if (relationKey && Array.isArray(record?.product_logistics_relation)) {
    for (const relation of record.product_logistics_relation) {
      if (!readableValue(relation?.[relationKey])) continue;
      return {
        value: parseCostValue(relation[relationKey], `product_logistics_relation.${relationKey}`),
        field: `product_logistics_relation.${relationKey}`,
      };
    }
  }
  return readCost(record, FIRST_LEG_COST_KEYS);
}

function listingMsku(record) {
  return String(record?.seller_sku || record?.sellerSku || record?.msku || record?.m_sku || "").trim();
}

function listingInternalSku(record) {
  return String(record?.local_sku || record?.localSku || record?.sku || record?.product_sku || "").trim();
}

function readFirst(record, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function sellerName(seller = {}) {
  return String(readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]) || "").trim();
}

function sellerCountryCode(seller = {}) {
  const direct = String(readFirst(seller, ["countryCode", "country_code", "region", "marketplaceCode"]) || "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/u.test(direct)) return direct;
  const suffix = sellerName(seller).match(/-([A-Z]{2})$/u);
  return suffix ? suffix[1].toUpperCase() : "";
}

function sellerBrandName(value) {
  return String(value || "").trim().replace(/-([A-Z]{2})$/u, "").toLowerCase();
}

function inferMskuCountryCode(msku, sellers = []) {
  const value = String(msku || "").trim().toUpperCase();
  const countryCodes = uniqueText(sellers.map(sellerCountryCode));
  const matches = countryCodes.filter((countryCode) => (
    value.startsWith(countryCode) || value.slice(2, 4) === countryCode
  ));
  return matches.length === 1 ? matches[0] : "";
}

function resolveCountrySeller(sellers, currentSeller, countryCode, currentSid) {
  const candidates = sellers.filter((seller) => (
    Number(seller.sid || seller.seller_id || seller.sellerId) !== Number(currentSid)
      && sellerCountryCode(seller) === countryCode
  ));
  if (!candidates.length) return null;
  const brand = sellerBrandName(sellerName(currentSeller));
  const sameBrand = candidates.filter((seller) => sellerBrandName(sellerName(seller)) === brand);
  if (sameBrand.length === 1) return sameBrand[0];
  return candidates.length === 1 ? candidates[0] : null;
}

function isDeletedListing(record) {
  const value = record?.is_delete ?? record?.isDelete;
  return value === 1 || value === "1" || value === true || String(value || "").trim().toLowerCase() === "true";
}

function pairingWarning(row) {
  return `${diagnosticRow(row)} 需要配对`;
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

function refreshError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function defaultStatusCodeForStage(stage) {
  if (["seller-directory", "listing-lookup", "product-lookup"].includes(stage)) return 502;
  if (["history-cache-read", "cache-write"].includes(stage)) return 500;
  if (stage === "cost-validation") return 422;
  return 400;
}

function currentYearCompletedMonths(todayText) {
  const today = String(todayText() || "");
  const match = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const monthNumber = Number(match?.[2]);
  if (!match || monthNumber < 1 || monthNumber > 12) throw refreshError("成本刷新日期必须是 YYYY-MM-DD 格式。", 400);
  if (monthNumber === 1) throw refreshError("本年度暂无已结束月份可刷新。", 400);
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
  async function executeRefresh() {
    const operationId = `inventory-provision-cost-refresh-${randomUUID()}`;
    let year = "";
    let months = [];
    let stage = "initialize";
    let rowCount = 0;
    let listingRequestCount = 0;
    let productRequestCount = 0;
    const stageDurations = {};
    const operationStartedAt = Date.now();
    let stageStartedAt = operationStartedAt;
    const lookupMetrics = {
      increment(name) {
        if (name === "lingxingListingRequests") listingRequestCount += 1;
        if (name === "lingxingProductInfoRequests" || name === "lingxingProductFallbackRequests") {
          productRequestCount += 1;
        }
      },
    };
    const markStage = (name, startedAt) => {
      stageDurations[name] = Date.now() - startedAt;
    };

    try {
      ({ year, months } = currentYearCompletedMonths(todayText));

      stage = "seller-directory";
      const sellerStartedAt = Date.now();
      stageStartedAt = sellerStartedAt;
      const directory = await getSellers({ forceRefresh: true });
      const sellers = filterCoreSellers(directory?.sellers || []);
      markStage("sellerDirectoryMs", sellerStartedAt);
      if (!sellers.some((seller) => Number(seller.sid) === REQUIRED_GERMAN_SID)) {
        throw refreshError(`运行时店铺目录缺少德国店铺 ${REQUIRED_GERMAN_STORE}（SID ${REQUIRED_GERMAN_SID}）。`, 422);
      }

      stage = "history-cache-read";
      const cacheStartedAt = Date.now();
      stageStartedAt = cacheStartedAt;
      const historicalData = await Promise.all(months.map(async (month) => {
        const cached = await readHistoryCache(month);
        if (!cached?.data || !Array.isArray(cached.data.rows) || !cached.data.rows.length) {
          throw refreshError(`库存计提历史缓存缺失：${month}`, 409);
        }
        return { month, data: cached.data, cacheUpdatedAt: cached.updatedAt || "" };
      }));
      markStage("historyCacheReadMs", cacheStartedAt);

      const rows = historicalData.flatMap(({ data }) => data.rows);
      rowCount = rows.length;
      const rowsByIdentity = new Map();
      const rowStatsByIdentity = new Map();
      historicalData.forEach(({ month, data }) => data.rows.forEach((row) => {
        const sid = Number(row.sid || 0);
        if (!sid || !row.msku) throw refreshError(`历史库存缺少成本匹配标识：${diagnosticRow(row)}。`, 422);
        const identity = inventoryIdentity(row);
        rowsByIdentity.set(identity, row);
        const stats = rowStatsByIdentity.get(identity) || { months: new Set(), rowCount: 0 };
        stats.rowCount += 1;
        stats.months.add(month);
        rowStatsByIdentity.set(identity, stats);
      }));

      stage = "listing-lookup";
      const listingStartedAt = Date.now();
      stageStartedAt = listingStartedAt;
      const listingCandidatesByIdentity = new Map();
      const mskusBySid = new Map();
      rowsByIdentity.forEach((row) => {
        const sid = Number(row.sid);
        if (!mskusBySid.has(sid)) mskusBySid.set(sid, []);
        mskusBySid.get(sid).push(row.msku);
      });
      const sellersBySid = new Map(sellers.map((seller) => [
        Number(seller.sid || seller.seller_id || seller.sellerId),
        seller,
      ]).filter(([sid]) => sid));
      const addListingCandidate = (identity, record, metadata) => {
        if (!listingCandidatesByIdentity.has(identity)) listingCandidatesByIdentity.set(identity, []);
        listingCandidatesByIdentity.get(identity).push({ record, ...metadata });
      };
      for (const [sid, mskus] of mskusBySid.entries()) {
        const listingRecords = await fetchListingsBySidMskus(adapter, sid, uniqueText(mskus), {
          strict: true,
          metrics: lookupMetrics,
          includeDeletedListings: true,
          includeUnpairedListings: true,
          exactOnly: true,
          sidVariants: [{ sid }],
        });
        listingRecords.forEach((record) => {
          const msku = listingMsku(record);
          const identity = `${sid}|${normalizeKey(msku)}`;
          if (msku && rowsByIdentity.has(identity)) {
            const row = rowsByIdentity.get(identity);
            addListingCandidate(identity, { ...record, sid }, {
              source: "lingxing-listing",
              sourceSid: sid,
              costCountryCode: String(row.countryCode || "").trim().toUpperCase(),
            });
          }
        });
      }

      const fallbackGroups = new Map();
      const unresolvedListings = [];
      rowsByIdentity.forEach((row, identity) => {
        if (listingCandidatesByIdentity.has(identity)) return;
        const sid = Number(row.sid);
        const countryCode = inferMskuCountryCode(row.msku, sellers);
        const currentSeller = sellersBySid.get(sid) || { name: row.storeName, countryCode: row.countryCode };
        const fallbackSeller = countryCode
          ? resolveCountrySeller(sellers, currentSeller, countryCode, sid)
          : null;
        if (!fallbackSeller) {
          unresolvedListings.push({
            row,
            reason: countryCode
              ? `未找到历史国家店铺 ${countryCode} 的唯一匹配`
              : "无法根据 MSKU 推断历史国家店铺",
          });
          return;
        }
        const fallbackSid = Number(fallbackSeller.sid || fallbackSeller.seller_id || fallbackSeller.sellerId);
        if (!fallbackGroups.has(fallbackSid)) fallbackGroups.set(fallbackSid, new Map());
        fallbackGroups.get(fallbackSid).set(identity, {
          row,
          fallbackSeller,
          countryCode,
        });
      });

      for (const [fallbackSid, itemsByIdentity] of fallbackGroups.entries()) {
        const fallbackItems = [...itemsByIdentity.values()];
        const fallbackRecords = await fetchListingsBySidMskus(
          adapter,
          fallbackSid,
          uniqueText(fallbackItems.map(({ row }) => row.msku)),
          {
            strict: true,
            metrics: lookupMetrics,
            includeDeletedListings: true,
            includeUnpairedListings: true,
            exactOnly: true,
            sidVariants: [{ sid: fallbackSid }],
          },
        );
        fallbackRecords.forEach((record) => {
          const msku = listingMsku(record);
          if (!msku) return;
          fallbackItems
            .filter(({ row }) => normalizeKey(row.msku) === normalizeKey(msku))
            .forEach(({ row }) => {
              const identity = inventoryIdentity(row);
              addListingCandidate(identity, { ...record, sid: fallbackSid }, {
                source: "lingxing-listing-country-fallback",
                sourceSid: fallbackSid,
                costCountryCode: row.countryCode,
                fallbackCountryCode: sellerCountryCode(itemsByIdentity.get(identity)?.fallbackSeller),
              });
            });
        });
      }
      markStage("listingLookupMs", listingStartedAt);

      const internalSkuByIdentity = new Map();
      const internalSkuSourceByIdentity = new Map();
      const costCountryCodeByIdentity = new Map();
      const skippedRowsByIdentity = new Map();
      rowsByIdentity.forEach((row, identity) => {
        const candidates = listingCandidatesByIdentity.get(identity) || [];
        const candidatesWithSku = candidates.filter(({ record }) => listingInternalSku(record));
        const internalSkus = uniqueText(candidatesWithSku.map(({ record }) => listingInternalSku(record)));
        if (internalSkus.length > 1) {
          unresolvedListings.push({ row, reason: `返回多个内部 SKU：${internalSkus.join(", ")}` });
          return;
        }
        if (!internalSkus.length) {
          if (candidates.some(({ record }) => isDeletedListing(record))) {
            skippedRowsByIdentity.set(identity, {
              row,
              reason: "deleted-listing-needs-pairing",
            });
            return;
          }
          unresolvedListings.push({
            row,
            reason: candidates.length ? "Listing 存在但未返回内部 SKU" : "Listing 未返回，国家店铺回查也未返回",
          });
          return;
        }
        const candidate = candidatesWithSku[0];
        const internalSku = internalSkus[0];
        internalSkuByIdentity.set(identity, internalSku);
        internalSkuSourceByIdentity.set(identity, candidate.source);
        costCountryCodeByIdentity.set(identity, String(candidate.fallbackCountryCode || row.countryCode || "").trim().toUpperCase());
      });
      if (unresolvedListings.length) {
        const descriptions = unresolvedListings.map(({ row, reason }) => `${diagnosticRow(row)}：${reason}`);
        const error = refreshError(`Listing 成本匹配失败：${descriptions.join("；")}。`, 422);
        error.details = {
          unresolvedListings: unresolvedListings.map(({ row, reason }) => ({
            sid: row.sid,
            storeName: row.storeName,
            msku: row.msku,
            reason,
          })),
        };
        throw error;
      }

      stage = "product-lookup";
      const productStartedAt = Date.now();
      stageStartedAt = productStartedAt;
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
      stageStartedAt = validationStartedAt;
      const refreshedAt = nowText();
      const refreshedCostsByIdentity = new Map();
      rowsByIdentity.forEach((row, identity) => {
        if (skippedRowsByIdentity.has(identity)) return;
        const internalSku = internalSkuByIdentity.get(identity);
        const product = productBySku.get(normalizeKey(internalSku));
        if (!product) throw refreshError(`产品管理未返回产品：${diagnosticRow(row, internalSku)}。`, 422);
        const purchase = readCost(product, PURCHASE_COST_KEYS);
        if (!purchase) throw refreshError(`产品管理缺少采购成本：${diagnosticRow(row, internalSku)}。`, 422);
        const costCountryCode = costCountryCodeByIdentity.get(identity) || String(row.countryCode || "").trim().toUpperCase();
        const firstLeg = readFirstLegCost(product, costCountryCode);
        if (!firstLeg) throw refreshError(`产品管理缺少单位头程成本：${diagnosticRow(row, internalSku)}。`, 422);
        refreshedCostsByIdentity.set(identity, {
          purchaseCost: purchase.value,
          firstLegCost: firstLeg.value,
          costSource: "lingxing-product-management",
          costInternalSku: internalSku,
          costInternalSkuSource: internalSkuSourceByIdentity.get(identity) || "lingxing-listing",
          costCountryCode,
          costPurchaseField: purchase.field,
          costFirstLegField: firstLeg.field,
          costRefreshStatus: "refreshed",
          costRefreshWarning: "",
        });
      });
      markStage("costValidationMs", validationStartedAt);

      const skippedRows = [...skippedRowsByIdentity.entries()].map(([identity, skipped]) => {
        const stats = rowStatsByIdentity.get(identity) || { months: new Set(), rowCount: 0 };
        return {
          sid: skipped.row.sid,
          storeName: skipped.row.storeName,
          msku: skipped.row.msku,
          reason: skipped.reason,
          months: [...stats.months].sort(),
          rowCount: stats.rowCount,
        };
      });
      const pairingWarnings = skippedRows.map((row) => pairingWarning(row));
      const prepared = historicalData.map(({ month, data }) => {
        const nextRows = data.rows.map((row) => {
          const identity = inventoryIdentity(row);
          const refreshed = refreshedCostsByIdentity.get(identity);
          if (refreshed) return { ...row, ...refreshed };
          if (skippedRowsByIdentity.has(identity)) {
            return {
              ...row,
              costRefreshStatus: "skipped-needs-listing-pair",
              costRefreshWarning: pairingWarning(row),
            };
          }
          return row;
        });
        const updatedRowCount = data.rows.filter((row) => refreshedCostsByIdentity.has(inventoryIdentity(row))).length;
        const skippedRowCount = data.rows.filter((row) => skippedRowsByIdentity.has(inventoryIdentity(row))).length;
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
              updatedRows: updatedRowCount,
              listingMatches: updatedRowCount + skippedRowCount,
              productMatches: updatedRowCount,
              skippedRows: skippedRowCount,
              warnings: skippedRowCount ? pairingWarnings : [],
            },
          },
        };
      });

      stage = "cache-write";
      const writeStartedAt = Date.now();
      stageStartedAt = writeStartedAt;
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
          updatedRows: data.costRefreshSummary?.updatedRows || 0,
          listingMatches: data.costRefreshSummary?.listingMatches || 0,
          productMatches: data.costRefreshSummary?.productMatches || 0,
          skippedRows: data.costRefreshSummary?.skippedRows || 0,
        })),
        totalRows: rows.length,
        updatedRows: refreshedCostsByIdentity.size
          ? rows.filter((row) => refreshedCostsByIdentity.has(inventoryIdentity(row))).length
          : 0,
        skippedRows,
        warnings: pairingWarnings,
        countryFallbackMatches: [...internalSkuSourceByIdentity.values()]
          .filter((source) => source === "lingxing-listing-country-fallback").length,
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
        skippedRowCount: skippedRows.length,
        countryFallbackMatches: result.countryFallbackMatches,
        stageDurations,
        refreshedAt,
      });
      return result;
    } catch (error) {
      const stageDurationKey = STAGE_DURATION_KEYS[stage];
      if (stageDurationKey && !Object.hasOwn(stageDurations, stageDurationKey)) {
        stageDurations[stageDurationKey] = Date.now() - stageStartedAt;
      }
      stageDurations.totalMs = Date.now() - operationStartedAt;
      if (!Number.isInteger(error.statusCode)) error.statusCode = defaultStatusCodeForStage(stage);
      error.details = {
        ...(error.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {}),
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

  let refreshInFlight = null;
  function refresh() {
    if (refreshInFlight) {
      logger.info?.("[inventory-provision-cost-refresh] join in-flight refresh");
      return refreshInFlight;
    }
    const operation = executeRefresh();
    refreshInFlight = operation.finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  return { refresh };
}

const defaultService = createInventoryProvisionCostRefreshService();

export function refreshInventoryProvisionCosts(input) {
  return defaultService.refresh(input);
}

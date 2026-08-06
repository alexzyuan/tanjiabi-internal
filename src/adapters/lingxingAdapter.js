import { getConfig } from "../config/index.js";
import { getDefaultWeekRange, listDateRange } from "../utils/dateRange.js";
import { withLingxingDateContract } from "../utils/lingxingDateRange.js";
import {
  readOrderProfitCache,
  readProfitReportCache,
  saveOrderProfitCache,
  saveProfitReportCache,
} from "../utils/cacheStore.js";
import { createLingxingAuth, createLingxingClient, createTokenState, tokenConfigKey } from "./lingxing/index.js";

const CORE_COUNTRY_NAMES = new Set(["美国", "加拿大", "澳洲", "澳大利亚", "德国", "US", "CA", "AU", "DE", "USA", "Canada", "Australia", "Germany", "Deutschland"]);
const CORE_COUNTRY_CODES = new Set(["US", "CA", "AU", "DE"]);
const tokenStates = new Map();
const adapterInstances = new Map();
const orderProfitInflight = new Map();
const profitReportInflight = new Map();
let defaultLingxingAdapter = null;
let defaultLingxingAdapterKey = "";

function readFirst(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function readFirstNumber(item, keys) {
  const value = readFirst(item, keys);
  if (!value) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function isCoreSeller(seller) {
  const name = readFirst(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]);
  const country = readFirst(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName"]);
  const countryCode = readFirst(seller, ["countryCode", "country_code", "region", "marketplaceCode"]).toUpperCase();
  if (CORE_COUNTRY_NAMES.has(country) || CORE_COUNTRY_CODES.has(countryCode)) return true;
  return /-(US|CA|AU|DE)\b/i.test(name);
}

export function filterCoreSellers(sellers = []) {
  return sellers.filter(isCoreSeller);
}

function stableOrderProfitCacheKey({ startDate, endDate, sids = [], currencyCode = "CNY" }) {
  return JSON.stringify({
    source: "basicOpen/finance/mreport/OrderProfit",
    startDate,
    endDate,
    currencyCode,
    sids: uniqueNumbers(sids).sort((a, b) => a - b),
  });
}

function stableProfitReportCacheValue(value, key = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => stableProfitReportCacheValue(item));
    return ["sids", "seller_ids", "sellerIds", "store_ids", "storeIds"].includes(key)
      ? normalized.slice().sort((left, right) => String(left).localeCompare(String(right)))
      : normalized;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value)
      .filter((itemKey) => value[itemKey] !== undefined)
      .sort()
      .map((itemKey) => [itemKey, stableProfitReportCacheValue(value[itemKey], itemKey)]));
  }
  return value;
}

function stableProfitReportCacheKey(endpoint, params = {}) {
  return JSON.stringify({
    source: endpoint,
    params: stableProfitReportCacheValue(params),
  });
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lingxingDateRangeParams(endpoint, params = {}) {
  return withLingxingDateContract(endpoint, params);
}

function orderProfitTotal(payload) {
  const candidates = [payload?.data?.total, payload?.data?.totalCount, payload?.total, payload?.totalCount];
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function mergeOrderProfitPayload(firstPayload, records) {
  if (Array.isArray(firstPayload?.data)) return { ...firstPayload, data: records };
  const data = firstPayload?.data && typeof firstPayload.data === "object" ? firstPayload.data : {};
  if (Array.isArray(data.records)) return { ...firstPayload, data: { ...data, records, total: records.length } };
  if (Array.isArray(data.list)) return { ...firstPayload, data: { ...data, list: records, total: records.length } };
  if (Array.isArray(data.rows)) return { ...firstPayload, data: { ...data, rows: records, total: records.length } };
  if (Array.isArray(data.data)) return { ...firstPayload, data: { ...data, data: records, total: records.length } };
  return { ...firstPayload, data: { ...data, records, total: records.length } };
}

function adapterConfigKey(config = {}) {
  return JSON.stringify(Object.keys(config)
    .filter((key) => !["accessToken", "refreshToken"].includes(key))
    .sort()
    .reduce((acc, key) => {
      acc[key] = config[key];
      return acc;
    }, {}));
}

function sharedTokenState(config = {}) {
  const key = tokenConfigKey(config);
  if (!tokenStates.has(key)) tokenStates.set(key, createTokenState(config));
  return tokenStates.get(key);
}

export function getLingxingAdapter(config = getConfig().lingxing) {
  const defaultKey = adapterConfigKey(getConfig().lingxing);
  const key = adapterConfigKey(config);
  if (key === defaultKey) {
    if (!defaultLingxingAdapter || defaultLingxingAdapterKey !== key) {
      defaultLingxingAdapter = new LingxingAdapter(config);
      defaultLingxingAdapterKey = key;
      adapterInstances.set(key, defaultLingxingAdapter);
    }
    return defaultLingxingAdapter;
  }
  if (!adapterInstances.has(key)) adapterInstances.set(key, new LingxingAdapter(config));
  return adapterInstances.get(key);
}

export function resetLingxingAdapterForTest() {
  tokenStates.clear();
  adapterInstances.clear();
  orderProfitInflight.clear();
  profitReportInflight.clear();
  defaultLingxingAdapter = null;
  defaultLingxingAdapterKey = "";
}

export class LingxingAdapter {
  constructor(config = getConfig().lingxing) {
    this.config = { ...config };
    this.tokenState = sharedTokenState(this.config);
    const buildUrl = (endpoint, queryParams = {}) => this.buildUrl(endpoint, queryParams);
    this.auth = createLingxingAuth({ config: this.config, tokenState: this.tokenState, buildUrl });
    this.client = createLingxingClient({ config: this.config, auth: this.auth, buildUrl });
    this.syncTokenConfig();
  }

  isConfigured() {
    return Boolean(this.config.baseUrl && this.config.appKey && this.config.appSecret);
  }

  hasAccessToken() {
    return Boolean(this.tokenState.accessToken);
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error("Lingxing adapter is missing LINGXING_BASE_URL, LINGXING_APP_KEY, or LINGXING_APP_SECRET.");
    }
  }

  buildUrl(endpoint, queryParams = {}) {
    const url = new URL(endpoint, this.config.baseUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url;
  }

  syncTokenConfig() {
    this.auth.syncTokenConfig();
  }

  updateTokenState(data = {}) {
    return this.auth.updateTokenState(data);
  }

  async fetchToken() {
    return this.auth.fetchToken();
  }

  async refreshToken() {
    return this.auth.refreshToken();
  }

  async ensureAccessToken() {
    return this.auth.ensureAccessToken();
  }

  async performSignedRequest(endpoint, options = {}) {
    return this.client.performSignedRequest(endpoint, options);
  }

  async signedRequest(endpoint, options = {}) {
    try {
      return await this.performSignedRequest(endpoint, options);
    } catch (error) {
      if (!error.tokenExpired) throw error;
      await this.refreshToken();
      return this.performSignedRequest(endpoint, options);
    }
  }

  fetchSellers() {
    return this.signedRequest("/erp/sc/data/seller/lists", { method: "GET" });
  }

  fetchListings(params) {
    return this.signedRequest("/erp/sc/data/mws/listing", {
      method: "POST",
      params: {
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams("/erp/sc/data/mws/listing", params),
      },
    });
  }

  fetchLocalProducts(params = {}) {
    return this.signedRequest("/erp/sc/routing/data/local_inventory/productList", {
      method: "POST",
      params: {
        offset: 0,
        length: 1000,
        ...params,
      },
    });
  }

  fetchLocalProductInfos(params = {}) {
    return this.signedRequest("/erp/sc/routing/data/local_inventory/batchGetProductInfo", {
      method: "POST",
      params,
    });
  }

  fetchSalesStat(params = {}, endpoint = "") {
    const targetEndpoint = endpoint || this.config.supplierSalesStatEndpoint || "/basicOpen/platformStatisticsV2/saleStat/pageList";
    return this.signedRequest(targetEndpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams(targetEndpoint, params),
      },
    });
  }

  async fetchAdvertisingAccounts(params = {}) {
    const requestParams = {
      offset: 0,
      length: 500,
      type: "seller",
      ...params,
    };
    return this.signedRequest("/basicOpen/baseData/account/list", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: requestParams,
    });
  }

  fetchAdPortfolios(params = {}) {
    return this.signedRequest("/pb/openapi/newad/portfolios", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams("/pb/openapi/newad/portfolios", params),
      },
    });
  }

  fetchAdCampaigns(endpoint, params = {}) {
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      headers: { "X-API-VERSION": "2" },
      params: {
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchAdCampaignReport(endpoint, params = {}) {
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      headers: { "X-API-VERSION": "2" },
      params: {
        offset: 0,
        length: 1000,
        show_detail: 1,
        target_type: "keyword",
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchAdKeywords(params = {}) {
    return this.signedRequest("/pb/openapi/newad/spKeywords", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      headers: { "X-API-VERSION": "2" },
      params: {
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams("/pb/openapi/newad/spKeywords", params),
      },
    });
  }

  fetchAdKeywordReport(params = {}) {
    return this.signedRequest("/pb/openapi/newad/spKeywordReports", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      headers: { "X-API-VERSION": "2" },
      params: {
        offset: 0,
        length: 1000,
        show_detail: 1,
        ...lingxingDateRangeParams("/pb/openapi/newad/spKeywordReports", params),
      },
    });
  }

  fetchAdSearchWordReport(params = {}) {
    return this.signedRequest("/pb/openapi/newad/queryWordReports", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      headers: { "X-API-VERSION": "2" },
      params: {
        offset: 0,
        length: 1000,
        show_detail: 1,
        ...lingxingDateRangeParams("/pb/openapi/newad/queryWordReports", params),
      },
    });
  }

  fetchOrders(params) {
    return this.signedRequest("/erp/sc/data/mws/orders", {
      method: "POST",
      params: {
        offset: 0,
        length: 1000,
        date_type: 1,
        ...lingxingDateRangeParams("/erp/sc/data/mws/orders", params),
      },
    });
  }

  fetchSellerProfitStatistics(params) {
    const { currencyCode, ...restParams } = params || {};
    const requestParams = {
      offset: 0,
      length: 1000,
      ...lingxingDateRangeParams("/bd/profit/statistics/open/seller/list", restParams),
    };
    if (currencyCode && currencyCode !== "ORIGINAL") {
      requestParams.currencyCode = currencyCode;
    }

    return this.signedRequest("/bd/profit/statistics/open/seller/list", {
      method: "POST",
      params: requestParams,
    });
  }

  fetchSellerProfitReport(params) {
    const {
      startDate: explicitStartDate,
      endDate: explicitEndDate,
      start_date,
      end_date,
      currencyCode,
      sids = [],
      monthlyQuery = true,
      summaryEnabled = true,
      ...restParams
    } = params || {};
    const startDate = explicitStartDate || start_date;
    const endDate = explicitEndDate || end_date;
    const requestParams = {
      offset: 0,
      length: 1000,
      monthlyQuery,
      summaryEnabled,
      startDate,
      endDate,
      sids,
      ...restParams,
    };
    if (currencyCode && currencyCode !== "ORIGINAL") requestParams.currencyCode = currencyCode;
    const apiParams = lingxingDateRangeParams("/bd/profit/report/open/report/seller/list", requestParams);
    return this.signedRequest("/bd/profit/report/open/report/seller/list", {
      method: "POST",
      params: apiParams,
    });
  }

  async fetchOtherFeeList(params = {}) {
    const pageSize = Number(params.length || 1000);
    const maxRows = Number(this.config.otherFeeMaxRows || 10000);
    if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error("otherFee length 必须是正整数");
    if (!Number.isInteger(maxRows) || maxRows < pageSize) throw new Error("otherFeeMaxRows 必须是不小于 length 的整数");
    const rows = [];
    let firstPayload;
    for (let offset = Number(params.offset || 0); ; offset += pageSize) {
      if (offset >= maxRows) {
        const error = new Error(`自定义费用分页达到安全上限 ${maxRows} 条，拒绝返回截断结果`);
        error.endpoint = "/bd/fee/management/open/feeManagement/otherFee/list";
        error.details = { maxRows, pageSize, fetchedRows: rows.length };
        throw error;
      }
      const payload = await this.signedRequest("/bd/fee/management/open/feeManagement/otherFee/list", {
        method: "POST",
        params: {
          offset,
          length: pageSize,
          date_type: "date",
          dimensions: [3],
          ...lingxingDateRangeParams("/bd/fee/management/open/feeManagement/otherFee/list", params),
          offset,
          length: pageSize,
        },
      });
      if (!firstPayload) firstPayload = payload;
      const page = this.normalizeRecordList(payload);
      rows.push(...page);
      const total = Number(payload?.data?.total || payload?.total || 0);
      if (!page.length || page.length < pageSize || (total && rows.length >= total)) break;
    }
    return mergeOrderProfitPayload(firstPayload || { code: 0 }, rows);
  }

  fetchOrderProfitReport(params) {
    return this.signedRequest("/bd/profit/report/open/report/order/list", {
      method: "POST",
      params: {
        offset: 0,
        length: 10000,
        search_date_field: "posted_date_locale",
        ...lingxingDateRangeParams("/bd/profit/report/open/report/order/list", params),
      },
    });
  }

  async fetchMskuOrderProfit(params) {
    const { currencyCode, ...restParams } = params || {};
    const pageSize = 5000;
    const maxRows = Number(this.config.orderProfitMaxRows || 100000);
    if (!Number.isInteger(maxRows) || maxRows < pageSize) {
      throw new Error("orderProfitMaxRows 必须是不小于 5000 的整数");
    }
    const requestParams = lingxingDateRangeParams("/basicOpen/finance/mreport/OrderProfit", restParams);
    if (currencyCode && currencyCode !== "ORIGINAL") {
      requestParams.currencyCode = currencyCode;
    }
    const records = [];
    let firstPayload;
    let pageCount = 0;
    for (let offset = 0; ; ) {
      if (offset >= maxRows) {
        const error = new Error(`订单利润分页达到安全上限 ${maxRows} 条，拒绝返回截断结果`);
        error.endpoint = "/basicOpen/finance/mreport/OrderProfit";
        error.details = { maxRows, pageSize, fetchedRows: records.length };
        throw error;
      }
      const payload = await this.signedRequest("/basicOpen/finance/mreport/OrderProfit", {
        method: "POST",
        params: { ...requestParams, offset, length: pageSize },
      });
      if (!firstPayload) firstPayload = payload;
      const pageRecords = this.normalizeRecordList(payload);
      records.push(...pageRecords);
      pageCount += 1;
      const total = orderProfitTotal(payload);
      const hasNext = payload?.data?.hasNext ?? payload?.hasNext;
      const totalExhausted = total !== null && records.length >= total;
      const upstreamHasMore = hasNext === true || (total !== null && records.length < total);
      if (!pageRecords.length && upstreamHasMore) {
        const error = new Error("订单利润分页返回空页但上游仍声明存在后续数据，拒绝返回不完整结果");
        error.endpoint = "/basicOpen/finance/mreport/OrderProfit";
        error.details = { offset, total, hasNext, fetchedRows: records.length };
        throw error;
      }
      if (!upstreamHasMore && (totalExhausted || hasNext === false || pageRecords.length < pageSize || !pageRecords.length)) break;
      offset += pageRecords.length;
    }
    if (pageCount > 1) {
      console.info("[lingxing-adapter] order profit pagination complete", {
        endpoint: "/basicOpen/finance/mreport/OrderProfit",
        pageCount,
        recordCount: records.length,
      });
    }
    return mergeOrderProfitPayload(firstPayload || { data: [] }, records);
  }

  fetchReplenishmentAdvice(params = {}, endpoint = "") {
    const targetEndpoint = endpoint || this.config.replenishmentAdviceEndpoint || "/erp/sc/routing/restocking/analysis/getSummaryList";
    return this.signedRequest(targetEndpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 50,
        data_type: 2,
        ...lingxingDateRangeParams(targetEndpoint, params),
      },
    });
  }

  fetchProductPerformance(params = {}) {
    const { currencyCode, ...restParams } = params || {};
    const requestParams = {
      offset: 0,
      length: 10000,
      sort_field: "volume",
      sort_type: "desc",
      summary_field: "msku",
      is_recently_enum: true,
      purchase_status: 0,
      ...lingxingDateRangeParams("/bd/productPerformance/openApi/asinList", restParams),
    };
    if (currencyCode && currencyCode !== "ORIGINAL") {
      requestParams.currency_code = currencyCode;
    }

    return this.signedRequest("/bd/productPerformance/openApi/asinList", {
      method: "POST",
      params: requestParams,
    });
  }

  fetchReturnAnalysis(params = {}) {
    return this.signedRequest("/basicOpen/salesAnalysis/returnOrder/analysisLists", {
      method: "POST",
      params: {
        offset: 0,
        length: 20,
        asinType: "msku",
        dateType: 0,
        sortField: "curReturnGoodsCount",
        sortType: "DESC",
        ...lingxingDateRangeParams("/basicOpen/salesAnalysis/returnOrder/analysisLists", params),
      },
    });
  }

  fetchReviewV2(params = {}) {
    return this.signedRequest("/basicOpen/openapi/service/v3/data/mws/reviews", {
      method: "POST",
      params: {
        offset: 0,
        length: 200,
        date_field: "review_time",
        sort_field: "review_date",
        sort_type: "desc",
        ...lingxingDateRangeParams("/basicOpen/openapi/service/v3/data/mws/reviews", params),
      },
    });
  }

  fetchVoiceOfBuyer(params = {}) {
    return this.signedRequest("/basicOpen/customerService/voiceOfBuyer/list", {
      method: "POST",
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams("/basicOpen/customerService/voiceOfBuyer/list", params),
      },
    });
  }

  fetchCustomOpenApi(endpoint, params = {}) {
    if (!endpoint) throw new Error("自定义领星接口路径未配置。");
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchFbaInventoryDetails(params = {}) {
    const endpoint = this.config.fbaInventoryEndpoint || "/basicOpen/openapi/storage/fbaWarehouseDetail";
    return this.signedRequest(endpoint, {
      method: "POST",
      params: {
        offset: 0,
        length: 200,
        is_hide_zero_stock: "1",
        fulfillment_channel_type: "FBA",
        query_fba_storage_quantity_list: true,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchFbaCargoShipments(params = {}) {
    return this.signedRequest("/erp/sc/data/fba_report/shipmentList", {
      method: "POST",
      params: {
        offset: 0,
        length: 100,
        ...lingxingDateRangeParams("/erp/sc/data/fba_report/shipmentList", params),
      },
    });
  }

  fetchFbaCargoShipmentBoxes(params = {}) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/listShipmentBoxes", {
      method: "POST",
      params,
    });
  }

  fetchFbaShipmentBoxInfo(params = {}) {
    return this.signedRequest("/erp/sc/routing/fba/shipment/boxInfo", {
      method: "POST",
      params,
    });
  }

  fetchLocalWarehouses(params = {}) {
    return this.signedRequest("/erp/sc/data/local_inventory/warehouse", {
      method: "POST",
      params: {
        type: 1,
        is_delete: 0,
        offset: 0,
        length: 1000,
        ...params,
      },
    });
  }

  fetchFbaInboundShipmentOrders(params = {}) {
    return this.signedRequest("/erp/sc/routing/storage/shipment/getInboundShipmentList", {
      method: "POST",
      params: {
        offset: 0,
        length: 20,
        is_delete: 0,
        ...lingxingDateRangeParams("/erp/sc/routing/storage/shipment/getInboundShipmentList", params),
      },
    });
  }

  createReadySendFbaShipmentOrder(params = {}) {
    return this.signedRequest("/erp/sc/routing/storage/shipment/createReadySendOrder", {
      method: "POST",
      params,
    });
  }

  async fetchAllFbaInventoryDetails(sids = [], { length = 200, maxRows = 2000, params = {} } = {}) {
    const rows = [];
    for (let offset = 0; offset < maxRows; offset += length) {
      const payload = await this.fetchFbaInventoryDetails({
        ...params,
        sid: Array.isArray(sids) && sids.length ? sids.join(",") : undefined,
        offset,
        length,
      });
      const records = this.normalizeRecordList(payload);
      rows.push(...records);
      const total = Number(payload?.data?.total || payload?.total || 0);
      if (!records.length || records.length < length || (total && rows.length >= total)) break;
    }
    return rows;
  }

  fetchFbaInventoryHistory(params = {}) {
    return this.signedRequest("/cost/center/openApi/fba/detail/query", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 2100,
        ...lingxingDateRangeParams("/cost/center/openApi/fba/detail/query", params),
      },
    });
  }

  fetchFbaStorageFeeMonth(params = {}) {
    return this.signedRequest("/erp/sc/data/fba_report/storageFeeMonth", {
      method: "POST",
      params: {
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams("/erp/sc/data/fba_report/storageFeeMonth", params),
      },
    });
  }

  async fetchAllFbaStorageFeeMonth(sid, month, { length = 1000, maxRows = 10000 } = {}) {
    const rows = [];
    for (let offset = 0; offset < maxRows; offset += length) {
      const payload = await this.fetchFbaStorageFeeMonth({
        sid,
        month,
        offset,
        length,
      });
      const records = this.normalizeRecordList(payload);
      rows.push(...records);
      const total = Number(payload?.total || payload?.data?.total || 0);
      if (!records.length || records.length < length || (total && rows.length >= total)) break;
      await sleep(1100);
    }
    return rows;
  }

  fetchMonthlyInventoryLedgerSummary(params = {}) {
    return this.signedRequest("/cost/center/ods/summary/query", {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        queryType: 1,
        disposition: "01",
        offset: 0,
        length: 1000,
        ...params,
      },
    });
  }

  fetchSettlementSummary(params = {}) {
    return this.signedRequest("/bd/sp/api/open/settlement/summary/list", {
      method: "POST",
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams("/bd/sp/api/open/settlement/summary/list", params),
      },
    });
  }

  fetchPayablePurchasePool(params = {}) {
    const endpoint = this.config.payablePurchaseEndpoint || "/basicOpen/finance/requestFundsPool/purchase/list";
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchPayableFreightPool(params = {}) {
    const endpoint = this.config.payableLogisticsEndpoint || this.config.payableFreightEndpoint || "/basicOpen/finance/requestFundsPool/logistics/list";
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchPayableOtherPool(params = {}) {
    if (!this.config.payableOtherEndpoint) {
      return Promise.resolve({ data: { records: [], total: 0 }, code: 0 });
    }
    return this.signedRequest(this.config.payableOtherEndpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 200,
        ...lingxingDateRangeParams(this.config.payableOtherEndpoint, params),
      },
    });
  }

  fetchPurchaseOrders(params = {}) {
    const endpoint = this.config.purchaseOrderEndpoint || "/erp/sc/routing/data/local_inventory/purchaseOrderList";
    return this.signedRequest(endpoint, {
      method: "POST",
      successCodes: [0, "0", 1, "1", 200, "200"],
      acceptSuccessBoolean: true,
      params: {
        offset: 0,
        length: 500,
        ...lingxingDateRangeParams(endpoint, params),
      },
    });
  }

  fetchInventoryLedgerSummary(params = {}) {
    return this.signedRequest("/cost/center/ods/summary/query", {
      method: "POST",
      successCodes: [0, "0", 1, "1"],
      acceptSuccessBoolean: true,
      params: {
        queryType: 2,
        disposition: "01",
        offset: 0,
        length: 1000,
        ...lingxingDateRangeParams("/cost/center/ods/summary/query", params),
      },
    });
  }

  createReportExportTask(params = {}) {
    return this.signedRequest("/basicOpen/report/create/reportExportTask", {
      method: "POST",
      params,
    });
  }

  queryReportExportTask(params = {}) {
    return this.signedRequest("/basicOpen/report/query/reportExportTask", {
      method: "POST",
      params,
    });
  }

  async fetchOrderProfitReportByOrderDate(params) {
    const variants = [
      { search_date_field: "purchase_date_locale" },
      { search_date_field: "order_date_locale" },
      { search_date_field: "order_time" },
      { search_date_field: "posted_date_locale" },
      {},
    ];
    let lastError = null;

    for (const variant of variants) {
      try {
        const payload = await this.fetchOrderProfitReport({ ...variant, ...params });
        return {
          payload,
          searchDateField: variant.search_date_field || "default",
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async debugOrderProfitReport(params) {
    const variants = [
      { search_date_field: "purchase_date_locale" },
      { search_date_field: "order_date_locale" },
      { search_date_field: "order_time" },
      { search_date_field: "posted_date_locale" },
      {},
    ];

    const results = [];
    for (const variant of variants) {
      const requestParams = { ...variant, ...params };
      try {
        const payload = await this.fetchOrderProfitReport(requestParams);
        const records = this.normalizeRecordList(payload);
        results.push({
          ok: true,
          searchDateField: variant.search_date_field || "default",
          requestParams,
          code: payload.code,
          message: payload.message || payload.msg || "",
          recordCount: records.length,
          dataKeys: Object.keys(payload.data || {}),
          sampleKeys: Object.keys(records[0] || {}),
          sample: records[0] || null,
        });
      } catch (error) {
        results.push({
          ok: false,
          searchDateField: variant.search_date_field || "default",
          requestParams,
          error: error.message,
          details: error.details || null,
        });
      }
    }

    return { results };
  }

  summarizeProfitRecords(records) {
    const readNumber = (item, keys) => {
      for (const key of keys) {
        const value = item?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          const number = Number(String(value).replace(/,/g, "").replace(/%/g, ""));
          return Number.isFinite(number) ? number : 0;
        }
      }
      return 0;
    };
    const sumKeys = (keys) => records.reduce((total, item) => total + readNumber(item, keys), 0);

    return {
      salesAmount: Number(sumKeys([
        "salesAmount",
        "sales_amount",
        "totalSalesAmount",
        "total_sales_amount",
        "orderAmount",
        "order_amount",
        "productSales",
        "product_sales",
        "sales",
        "amount",
      ]).toFixed(2)),
      netSalesAmount: Number(sumKeys([
        "netSalesAmount",
        "net_sales_amount",
        "totalNetSalesAmount",
        "total_net_sales_amount",
        "netSales",
        "net_sales",
        "net_amount",
      ]).toFixed(2)),
      grossProfit: Number(sumKeys([
        "grossProfit",
        "gross_profit",
        "orderProfit",
        "order_profit",
        "profit",
        "profitAmount",
        "profit_amount",
        "sellerProfit",
        "seller_profit",
      ]).toFixed(2)),
      quantity: Number(sumKeys([
        "quantity",
        "qty",
        "salesQuantity",
        "sales_quantity",
        "totalSalesQuantity",
        "total_sales_quantity",
        "orderQuantity",
        "order_quantity",
        "volume",
      ]).toFixed(2)),
      adsSales: Number(sumKeys([
        "adsSales",
        "ads_sales",
        "advertisingSales",
        "advertising_sales",
        "totalAdsSales",
        "total_ads_sales",
        "adSales",
        "ad_sales",
        "ad_sales_amount",
      ]).toFixed(2)),
      adsCost: Number(sumKeys([
        "adsCost",
        "ads_cost",
        "advertisingCost",
        "advertising_cost",
        "totalAdsCost",
        "total_ads_cost",
        "adCost",
        "ad_cost",
        "spend",
      ]).toFixed(2)),
    };
  }

  async debugProfitSources(params) {
    const baseStart = params.startDate || params.start_date;
    const baseEnd = params.endDate || params.end_date;
    const commonVariants = [
      { start_date: baseStart, end_date: baseEnd, search_date_field: "posted_date_locale", currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, search_date_field: "purchase_date", currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, search_date_field: "order_date", currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, search_date_field: "purchase_time", currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, date_type: 1, currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, date_type: 2, currencyCode: "CNY" },
      { startDate: baseStart, endDate: baseEnd, dateType: 1, currencyCode: "CNY" },
      { startDate: baseStart, endDate: baseEnd, dateType: 2, currencyCode: "CNY" },
    ];
    const statisticsVariants = [
      { startDate: baseStart, endDate: baseEnd, currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, currencyCode: "CNY" },
      { startDate: baseStart, endDate: baseEnd, dateType: 1, currencyCode: "CNY" },
      { startDate: baseStart, endDate: baseEnd, dateType: 2, currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, date_type: 1, currencyCode: "CNY" },
      { start_date: baseStart, end_date: baseEnd, date_type: 2, currencyCode: "CNY" },
    ];
    const sources = [
      { name: "订单利润-订单维度", endpoint: "/bd/profit/report/open/report/order/list", call: (requestParams) => this.fetchOrderProfitReport(requestParams), variants: commonVariants },
      { name: "订单利润-店铺维度", endpoint: "/bd/profit/report/open/report/seller/list", call: (requestParams) => this.fetchSellerProfitReport(requestParams), variants: commonVariants },
      { name: "利润统计-店铺维度", endpoint: "/bd/profit/statistics/open/seller/list", call: (requestParams) => this.fetchSellerProfitStatistics(requestParams), variants: statisticsVariants },
      {
        name: "订单利润-MSKU维度",
        endpoint: "/basicOpen/finance/mreport/OrderProfit",
        call: (requestParams) => this.fetchMskuOrderProfit(requestParams),
        variants: [{ startDate: baseStart, endDate: baseEnd, currencyCode: "CNY" }],
      },
    ];

    const results = [];
    for (const source of sources) {
      for (const requestParams of source.variants) {
        try {
          const payload = await source.call(requestParams);
          const records = this.normalizeRecordList(payload);
          results.push({
            ok: true,
            source: source.name,
            endpoint: source.endpoint,
            requestParams,
            code: payload.code,
            message: payload.message || payload.msg || "",
            recordCount: records.length,
            totals: this.summarizeProfitRecords(records),
            dataKeys: Object.keys(payload.data || {}),
            sampleKeys: Object.keys(records[0] || {}),
            sample: records[0] || null,
          });
        } catch (error) {
          results.push({
            ok: false,
            source: source.name,
            endpoint: source.endpoint,
            requestParams,
            error: error.message,
            details: error.details || null,
          });
        }
      }
    }

    return {
      dateRange: { startDate: baseStart, endDate: baseEnd },
      targetFromErpScreenshot: {
        salesAmount: 45434.88,
        grossProfit: 1532.47,
        quantity: 300,
        adsSales: 16153.5,
      },
      results,
    };
  }

  normalizeMskuOrderProfitRecords(records, sellerList = [], reportDate = "") {
    const sellerBySid = new Map(
      sellerList
        .map((seller) => [Number(seller.sid), seller])
        .filter(([sid]) => Number.isFinite(sid) && sid > 0),
    );

    return records.map((record) => {
      const sid = Number((Array.isArray(record.sids) ? record.sids[0] : record.sid) || 0);
      const seller = sellerBySid.get(sid) || {};
      const priceInfo = Array.isArray(record.price_list) ? record.price_list[0] || {} : {};
      const localInfo = Array.isArray(record.local_infos) ? record.local_infos[0] || {} : {};
      const asinInfo = Array.isArray(record.asins) ? record.asins[0] || {} : {};
      const countryInfo = Array.isArray(record.seller_store_countries) ? record.seller_store_countries[0] : {};
      const storeName = seller.name || seller.seller_name || seller.shop_name || seller.store_name || record.store_name || record.storeName || sid || "-";
      const country = countryInfo?.country || seller.country || seller.countryName || seller.country_name || record.country || "";

      return {
        ...record,
        sid,
        reportDate: record.reportDate || record.report_date || record.date || record.posted_date_locale || record.purchase_date_locale || record.order_date || reportDate,
        msku: record.msku || record.seller_sku || priceInfo.seller_sku || "",
        asin: record.asin || priceInfo.asin || asinInfo.asin || "",
        sku: record.local_sku || priceInfo.local_sku || localInfo.local_sku || "",
        localName: record.local_name || priceInfo.local_name || localInfo.local_name || record.item_name || priceInfo.item_name || "",
        storeName,
        country,
        countryCode: seller.country_code || seller.countryCode || record.country_code || record.countryCode || "",
        currencyCode: readFirst(record, ["currency_code", "currencyCode", "currency"]) || record.currencyCode || "",
        cnyAmount: readFirstNumber(record, ["amount_cny", "cny_amount", "total_amount_cny"]),
        exchangeRate: readFirstNumber(record, ["exchange_rate", "exchangeRate", "rate_to_cny"]),
        totalSalesAmount: record.amount ?? record.totalSalesAmount,
        netSalesAmount: record.net_amount ?? record.netSalesAmount,
        grossProfit: record.gross_profit ?? record.grossProfit,
        salesProfit: readFirstNumber(record, [
          "salesProfit",
          "profit",
          "profit_amount",
          "sales_profit",
          "net_profit",
          "netProfit",
        ]),
        averageGrossProfit: readFirst(record, [
          "avg_gross_profit",
          "average_gross_profit",
          "averageGrossProfit",
          "avgGrossProfit",
        ]),
        grossRate: record.gross_margin,
        totalSalesQuantity: record.volume,
        returnQuantity: readFirstNumber(record, ["return_quantity", "returnQuantity", "return_qty", "returnQty"]),
        unsaleableReturnQuantity: readFirstNumber(record, [
          "fbaReturnsUnsaleableQuantity",
          "fba_returns_unsaleable_quantity",
          "unsaleable_return_quantity",
        ]),
        purchaseUnitCost: readFirstNumber(record, ["cgUnitPrice", "cg_unit_price"]),
        firstLegUnitCost: readFirstNumber(record, ["cgTransportUnitCosts", "cg_transport_unit_costs"]),
        totalAdsSales: record.ad_sales_amount,
        totalAdsSalesQuantity: record.ad_volume,
        totalAdsCost: record.spend,
        totalSalesRefunds: record.refund_amount,
        refundsQuantity: record.refund_quantity,
        promotionDiscount: readFirst(record, [
          "promotion_discount",
          "promotion_discount_amount",
          "promotional_discount",
          "promo_discount",
          "sales_promotion",
          "sales_promotion_discount",
          "discount_amount",
          "coupon_discount",
          "item_promotion_discount",
          "shipping_promotion_discount",
        ]),
        storageFee: readFirst(record, [
          "total_stock_fee",
          "storage_fee",
          "storage_fee_amount",
          "storage_amount",
          "warehouse_storage_fee",
          "inventory_storage_fee",
          "monthly_storage_fee",
          "monthly_storage_fee_amount",
          "long_term_storage_fee",
          "long_term_storage_fee_amount",
          "fba_storage_fee",
          "shared_fba_storage_fee",
          "shared_awd_storage_fee",
          "shared_star_storage_fee",
          "shared_fba_inbound_defect_fee",
          "shared_fba_overage_fee",
          "shared_other_fba_inventory_fees",
        ]),
        storageFeeRate: record.total_stock_fee_rate,
        platformFee: readFirst(record, [
          "platform_fee",
          "platform_fee_amount",
          "platform_amount",
          "platform_cost",
          "platform_cost_amount",
          "platform_fee_total",
          "total_platform_fee",
          "selling_fee",
          "selling_fee_amount",
          "amazon_fee_total",
          "amazon_fees",
          "commission",
          "commission_amount",
          "commission_fee",
          "referral_fee",
          "referral_fee_amount",
          "amazon_fee",
        ]),
        platformFeeRate: record.selling_fee_rate,
        fbaDeliveryFee: readFirst(record, [
          "fba_delivery_fee",
          "fba_delivery_fee_amount",
          "fba_delivery_amount",
          "fba_fee",
          "fba_fee_amount",
          "fba_shipping_fee",
          "fulfillment_fee",
          "fulfillment_fee_amount",
          "fba_fulfillment_fee",
          "fba_fulfillment_fee_amount",
          "delivery_fee",
        ]),
        fbaDeliveryFeeRate: record.fulfillment_fee_rate,
        purchaseCost: readFirst(record, [
          "purchase_costs",
          "purchase_cost",
          "purchase_cost_amount",
          "product_cost",
          "product_cost_amount",
          "goods_cost",
          "goods_cost_amount",
          "cost_of_goods",
          "cost_of_goods_sold",
          "cogs",
          "total_cost",
          "purchase_amount",
          "item_cost",
          "cgPriceTotal",
          "cgPriceAbsTotal",
        ]),
        purchaseCostRate: record.proportionOfCg,
        firstLegCost: readFirst(record, [
          "logistics_costs",
          "first_leg_cost",
          "first_leg_cost_amount",
          "first_leg_fee",
          "first_leg_fee_amount",
          "first_shipping_fee",
          "first_shipping_cost",
          "head_shipping_cost",
          "head_shipping_fee",
          "head_freight",
          "first_logistics_fee",
          "shipping_cost",
          "cgTransportCostsTotal",
        ]),
        firstLegCostRate: record.proportionOfCgTransport,
      };
    });
  }

  normalizeSellerProfitRecords(records, sellerList = []) {
    const sellerBySid = new Map(
      sellerList
        .map((seller) => [Number(seller.sid), seller])
        .filter(([sid]) => Number.isFinite(sid) && sid > 0),
    );

    return records.map((record) => {
      const sid = Number(record.sid || record.seller_id || record.sellerId || 0);
      const seller = sellerBySid.get(sid) || {};
      const storeName = record.storeName || record.store_name || record.sellerName || record.seller_name || seller.name || seller.seller_name || seller.shop_name || seller.store_name || sid || "-";
      const country = record.country || record.countryName || record.country_name || seller.country || seller.countryName || seller.country_name || record.countryCode || record.country_code || "";

      return {
        ...record,
        sid,
        reportDate: record.postedDateLocale || record.posted_date_locale || record.reportDate || record.date || "",
        storeName,
        country,
        countryCode: record.countryCode || record.country_code || seller.country_code || seller.countryCode || "",
        currencyCode: record.currencyCode || record.currency_code || "",
      };
    });
  }

  normalizeSellerProfitOtherFeeRecords(records, sellerList = [], reportDate = "") {
    if (!Array.isArray(records)) throw new Error("店铺利润 records 必须是数组");
    return this.normalizeSellerProfitRecords(records, sellerList).flatMap((record) => {
      if (record.otherFeeStr === undefined || record.otherFeeStr === null || record.otherFeeStr === "") return [];
      if (!Array.isArray(record.otherFeeStr)) throw new Error("店铺利润 otherFeeStr 必须是数组");
      return record.otherFeeStr.map((fee) => ({
        sid: record.sid,
        storeName: record.storeName,
        country: record.country,
        currencyCode: record.currencyCode,
        reportDate: record.reportDate || reportDate,
        other_fee_type: readFirst(fee, ["otherFeeName", "other_fee_name", "name"]),
        other_fee_type_id: readFirst(fee, ["otherFeeTypeId", "other_fee_type_id", "id"]),
        fee: readFirstNumber(fee, ["feeAllocation", "fee_allocation", "fee", "amount"]),
      }));
    });
  }

  async fetchMskuOrderProfitCached({
    startDate,
    endDate,
    sids = [],
    currencyCode = "CNY",
    sellerList = [],
    reportDate = endDate,
  } = {}) {
    const selectedSids = uniqueNumbers(sids);
    const selectedSidSet = new Set(selectedSids);
    const cacheKey = stableOrderProfitCacheKey({ startDate, endDate, sids: selectedSids, currencyCode });
    const cached = await readOrderProfitCache(cacheKey);
    if (cached?.data?.orderProfitRecords) {
      const cachedRecords = cached.data.orderProfitRecords;
      const needsNormalization = cachedRecords.some((record) => (
        record?.salesProfit === undefined
        && (record?.profit !== undefined || record?.amount !== undefined || record?.net_amount !== undefined)
      ));
      const records = needsNormalization
        ? this.normalizeMskuOrderProfitRecords(cachedRecords, sellerList, reportDate)
        : cachedRecords;
      console.info("[lingxing-adapter] order profit cache hit", {
        cacheKey,
        startDate,
        endDate,
        currencyCode,
        sidCount: selectedSids.length,
        recordCount: records.length,
      });
      return {
        records,
        cacheKey,
        cacheState: "hit",
        cacheUpdatedAt: cached.updatedAt || "",
      };
    }

    const existing = orderProfitInflight.get(cacheKey);
    if (existing) {
      console.info("[lingxing-adapter] order profit cache joined in-flight request", {
        cacheKey,
        startDate,
        endDate,
        currencyCode,
        sidCount: selectedSids.length,
      });
      const result = await existing;
      return { ...result, cacheState: "inflight" };
    }

    const loadPromise = (async () => {
      const startedAt = Date.now();
      try {
        const payload = await this.fetchMskuOrderProfit({ startDate, endDate, sids: selectedSids, currencyCode });
        const rawRecords = this.normalizeRecordList(payload);
        const records = this.normalizeMskuOrderProfitRecords(rawRecords, sellerList, reportDate).filter((record) => {
          if (!selectedSids.length) return true;
          const recordSid = Number(record.sid || record.seller_id || record.sellerId || record.store_id || record.storeId);
          return recordSid ? selectedSidSet.has(recordSid) : true;
        });
        await saveOrderProfitCache(cacheKey, { orderProfitRecords: records });
        console.info("[lingxing-adapter] order profit cache miss loaded", {
          cacheKey,
          startDate,
          endDate,
          currencyCode,
          sidCount: selectedSids.length,
          recordCount: records.length,
          elapsedMs: Date.now() - startedAt,
        });
        return { records, cacheKey, cacheState: "miss", cacheUpdatedAt: "" };
      } catch (error) {
        console.error("[lingxing-adapter] cached order profit fetch failed", {
          cacheKey,
          startDate,
          endDate,
          currencyCode,
          sidCount: selectedSids.length,
          elapsedMs: Date.now() - startedAt,
          error: error.message,
        });
        throw error;
      }
    })();
    orderProfitInflight.set(cacheKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (orderProfitInflight.get(cacheKey) === loadPromise) orderProfitInflight.delete(cacheKey);
    }
  }

  async fetchProfitReportCachedInternal({ endpoint, requestParams, sellerList = [], reportDate = "", normalize, label }) {
    const cacheKey = stableProfitReportCacheKey(endpoint, requestParams);
    const cached = await readProfitReportCache(cacheKey);
    if (cached?.data?.profitReportRecords) {
      console.info("[lingxing-adapter] profit report cache hit", {
        cacheKey,
        endpoint,
        label,
        recordCount: cached.data.profitReportRecords.length,
      });
      return {
        records: cached.data.profitReportRecords,
        cacheKey,
        cacheState: "hit",
        cacheUpdatedAt: cached.updatedAt || "",
      };
    }

    const existing = profitReportInflight.get(cacheKey);
    if (existing) {
      console.info("[lingxing-adapter] profit report cache joined in-flight request", {
        cacheKey,
        endpoint,
        label,
      });
      const result = await existing;
      return { ...result, cacheState: "inflight" };
    }

    const loadPromise = (async () => {
      const startedAt = Date.now();
      try {
        const payload = await this.fetchProfitReportPayload(endpoint, requestParams);
        const rawRecords = this.normalizeRecordList(payload);
        const records = normalize
          ? normalize.call(this, rawRecords, sellerList, reportDate)
          : rawRecords;
        await saveProfitReportCache(cacheKey, { profitReportRecords: records });
        console.info("[lingxing-adapter] profit report cache miss loaded", {
          cacheKey,
          endpoint,
          label,
          recordCount: records.length,
          elapsedMs: Date.now() - startedAt,
        });
        return { records, cacheKey, cacheState: "miss", cacheUpdatedAt: "" };
      } catch (error) {
        console.error("[lingxing-adapter] cached profit report fetch failed", {
          cacheKey,
          endpoint,
          label,
          elapsedMs: Date.now() - startedAt,
          error: error.message,
        });
        throw error;
      }
    })();
    profitReportInflight.set(cacheKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (profitReportInflight.get(cacheKey) === loadPromise) profitReportInflight.delete(cacheKey);
    }
  }

  async fetchProfitReportPayload(endpoint, requestParams) {
    if (endpoint === "/bd/profit/report/open/report/order/list") {
      return this.fetchOrderProfitReport(requestParams);
    }
    if (endpoint === "/bd/profit/report/open/report/seller/list") {
      return this.fetchSellerProfitReport(requestParams);
    }
    throw new Error(`不支持的利润报表缓存接口：${endpoint}`);
  }

  async fetchOrderProfitReportCached({ sellerList = [], reportDate = "", ...params } = {}) {
    return this.fetchProfitReportCachedInternal({
      endpoint: "/bd/profit/report/open/report/order/list",
      requestParams: params,
      sellerList,
      reportDate,
      label: "订单维度",
    });
  }

  async fetchSellerProfitReportCached({ sellerList = [], reportDate = "", ...params } = {}) {
    return this.fetchProfitReportCachedInternal({
      endpoint: "/bd/profit/report/open/report/seller/list",
      requestParams: params,
      sellerList,
      reportDate,
      label: "店铺维度",
      normalize: this.normalizeSellerProfitRecords,
    });
  }

  async fetchSellerProfitStatisticsChunks({ startDate, endDate, sids = [], currencyCode = "CNY", sellerList = [] }) {
    const dates = listDateRange(startDate, endDate, 31);
    if (!dates.length) return { records: [], payloads: [] };

    const chunks = [];
    for (let index = 0; index < dates.length; index += 7) {
      chunks.push(dates.slice(index, index + 7));
    }

    const payloads = [];
    const records = [];
    for (const chunk of chunks) {
      const payload = await this.fetchSellerProfitStatistics({
        startDate: chunk[0],
        endDate: chunk[chunk.length - 1],
        sids,
        currencyCode,
      });
      payloads.push(payload);
      records.push(...this.normalizeSellerProfitRecords(this.normalizeRecordList(payload), sellerList));
    }

    return { records, payloads };
  }

  createStaTask(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-plan/createInboundPlan", {
      method: "POST",
      params,
    });
  }

  queryStaTaskOperate(params) {
    return this.signedRequest("/amzStaServer/openapi/task-plan/operate", {
      method: "POST",
      params,
    });
  }

  generateStaShipmentPlan(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/generatePlacementOptions", {
      method: "POST",
      params,
    });
  }

  listStaPackingGroupItems(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-packing/listPackingGroupItems", {
      method: "POST",
      params,
    });
  }

  saveStaPackingInformation(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-packing/setLocalPackingInformation", {
      method: "POST",
      params,
    });
  }

  submitStaPackingInformation(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-packing/setPackingInformation", {
      method: "POST",
      params,
    });
  }

  previewStaShipment(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/shipmentPreView", {
      method: "POST",
      params,
      includeParamsInQuery: true,
    });
  }

  confirmStaShipmentPlan(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/confirmPlacementOption", {
      method: "POST",
      params,
    });
  }

  generateStaTransportList(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/generateTransportList", {
      method: "POST",
      params,
    });
  }

  getStaTransportList(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/getTransportList", {
      method: "POST",
      params,
    });
  }

  generateStaDeliveryDateList(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/generateDeliveryDateList", {
      method: "POST",
      params,
    });
  }

  getStaDeliveryDateList(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/getDeliveryDateList", {
      method: "POST",
      params,
    });
  }

  setStaDeliveryService(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-shipment/setDeliveryService", {
      method: "POST",
      params,
    });
  }

  syncStaInboundPlan(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-plan/gatherInboundPlan", {
      method: "POST",
      params,
    });
  }

  cancelStaTask(params) {
    return this.signedRequest("/amzStaServer/openapi/inbound-plan/cancelInboundPlan", {
      method: "POST",
      params,
      includeParamsInQuery: true,
    });
  }

  normalizeRecordList(payload) {
    const data = payload?.data || {};
    const records = data.records || data.list || data.rows || data.data || data;
    return Array.isArray(records) ? records : [];
  }

  async fetchSalesWeeklyData(filters = {}) {
    const sellers = await this.fetchSellers();
    const sellerList = filterCoreSellers(sellers.data || []);
    const defaultRange = getDefaultWeekRange(getConfig().dashboard);
    const range = {
      startDate: filters.startDate || defaultRange.startDate,
      endDate: filters.endDate || defaultRange.endDate,
    };
    const currencyCode = filters.currencyCode || "CNY";
    const activeSids = sellerList
      .filter((seller) => !seller.status || seller.status === 1)
      .map((seller) => seller.sid);
    const uniqueActiveSids = uniqueNumbers(activeSids);
    const allowedSidSet = new Set(uniqueActiveSids);
    const selectedSids = Array.isArray(filters.sids) && filters.sids.length
      ? filters.sids.map(Number).filter((sid) => allowedSidSet.has(sid))
      : uniqueActiveSids;
    let orderProfitRecords = [];
    let inventoryRecords = [];
    let cacheState = "miss";
    let cacheUpdatedAt = "";
    let sourceWarning = "";
    let inventoryWarning = "";

    const orderProfitResult = await this.fetchMskuOrderProfitCached({
      startDate: range.startDate,
      endDate: range.endDate,
      sids: selectedSids,
      currencyCode,
      sellerList,
      reportDate: range.startDate === range.endDate ? range.startDate : range.endDate,
    });
    orderProfitRecords = orderProfitResult.records;
    cacheState = orderProfitResult.cacheState;
    cacheUpdatedAt = orderProfitResult.cacheUpdatedAt;

    try {
      inventoryRecords = await this.fetchAllFbaInventoryDetails(selectedSids);
    } catch (error) {
      inventoryWarning = error.message;
    }

    return {
      range,
      sellers: sellerList,
      sellerProfitRecords: [],
      orderProfitRecords,
      dailyProfitRecords: orderProfitRecords,
      inventoryRecords,
      currencyCode,
      raw: {
        sellers,
        source: "/basicOpen/finance/mreport/OrderProfit",
        sourceName: "订单利润",
        cacheState,
        cacheUpdatedAt,
        sourceWarning,
        inventoryWarning,
      },
    };
  }
}

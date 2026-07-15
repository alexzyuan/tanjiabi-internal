import { getConfig } from "../config/index.js";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { listDateRange } from "../utils/dateRange.js";
import { normalizeRecordList, readFirst, toNumber } from "../utils/recordAccess.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const adTypes = [
  { key: "SP", campaignEndpoint: "/pb/openapi/newad/spCampaigns", reportEndpoint: "/pb/openapi/newad/spCampaignReports" },
  { key: "SB", campaignEndpoint: "/pb/openapi/newad/hsaCampaigns", reportEndpoint: "/pb/openapi/newad/hsaCampaignReports" },
  { key: "SD", campaignEndpoint: "/pb/openapi/newad/sdCampaigns", reportEndpoint: "/pb/openapi/newad/sdCampaignReports" },
];
const spAdType = { key: "SP", campaignEndpoint: "/pb/openapi/newad/spCampaigns", reportEndpoint: "/pb/openapi/newad/spCampaignReports" };
const defaultKeywordAnalysisRules = {
  targetAcos: 0.25,
  minCvr: 0.05,
  maxCpc: 1.5,
};
const adKeywordAnalysisCacheDir = path.join(process.cwd(), "data-cache", "ad-keyword-analysis");
let adKeywordAnalysisTimer = null;
let adKeywordAnalysisRunning = false;

function totalCountOf(payload, recordsLength = 0) {
  const data = payload?.data || payload || {};
  return Number(data.total ?? data.count ?? data.totalCount ?? data.total_count ?? payload?.total ?? recordsLength) || recordsLength;
}

function parseBudget(value) {
  if (!value) return { amount: 0, currency: "" };
  if (typeof value === "object") {
    return {
      amount: toNumber(value.amount ?? value.amout),
      currency: String(value.currencyCode || value.currency_code || value.currency || ""),
      startDate: value.startDate || value.start_date || "",
      endDate: value.endDate || value.end_date || "",
    };
  }
  const text = String(value || "").trim();
  if (text.startsWith("{")) {
    try {
      return parseBudget(JSON.parse(text));
    } catch {
      return { amount: toNumber(text), currency: "" };
    }
  }
  return { amount: toNumber(text), currency: "" };
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = value ? new Date(value) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function normalizeTimestamp(value) {
  if (!value) return "-";
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function normalizeStatus(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const lower = text.toLowerCase();
  if (["enabled", "active", "1", "正常", "启用", "投放中"].includes(lower) || ["正常", "启用", "投放中"].includes(text)) return "启用";
  if (["paused", "suspended", "2", "暂停"].includes(lower) || text === "暂停") return "暂停";
  if (["archived", "deleted", "3", "归档"].includes(lower) || text === "归档") return "归档";
  return text;
}

function normalizeBudgetPolicy(value) {
  if (value === true || value === 1 || value === "1") return "预算内";
  if (value === false || value === 0 || value === "0") return "超预算";
  return String(value || "").trim() || "-";
}

function normalizeAdAccount(row = {}) {
  return {
    profileId: String(readFirst(row, ["profile_id", "profileId", "profileID", "id"]) || ""),
    advertisingAccountId: String(readFirst(row, ["advertising_account_id", "advertisingAccountId", "ad_account_id", "adAccountId", "account_id", "accountId"]) || ""),
    sellerId: String(readFirst(row, ["seller_id", "sellerId", "sid"]) || ""),
    sellerName: String(readFirst(row, ["seller_name", "sellerName", "shop_name", "shopName", "store_name", "storeName", "account_name", "accountName", "name"]) || "-"),
    country: String(readFirst(row, ["country", "country_name", "countryName", "country_code", "countryCode", "marketplace", "marketplace_name", "marketplaceName", "region"]) || "-"),
    type: String(readFirst(row, ["type", "account_type", "accountType"]) || ""),
  };
}

function normalizeAdPortfolioRow(row = {}, account = {}) {
  const budget = parseBudget(readFirst(row, ["budget", "amount", "budget_amount", "budgetAmount", "daily_budget", "dailyBudget"]));
  return {
    id: String(readFirst(row, ["portfolio_id", "portfolioId", "id"]) || ""),
    name: String(readFirst(row, ["portfolio_name", "portfolioName", "name", "portfolio"]) || "-"),
    status: normalizeStatus(readFirst(row, ["state_text", "stateText", "state", "status_text", "statusText", "status"])),
    budget: budget.amount,
    currency: String(readFirst(row, ["currency", "currency_code", "currencyCode"]) || budget.currency || ""),
    budgetPolicy: normalizeBudgetPolicy(readFirst(row, ["in_budget", "inBudget", "budget_policy", "budgetPolicy"])),
    servingStatus: String(readFirst(row, ["serving_status", "servingStatus", "serving_status_text", "servingStatusText"]) || "-"),
    sellerName: String(readFirst(row, ["seller_name", "sellerName", "shop_name", "shopName", "store_name", "storeName", "account_name", "accountName"]) || account.sellerName || "-"),
    country: String(readFirst(row, ["country", "country_name", "countryName", "marketplace", "marketplace_name", "marketplaceName", "region"]) || account.country || "-"),
    profileId: String(readFirst(row, ["profile_id", "profileId", "advertising_account_id", "advertisingAccountId"]) || account.profileId || account.advertisingAccountId || "-"),
    createdAt: normalizeTimestamp(readFirst(row, ["creation_date", "creationDate", "created_at", "createdAt"])),
    startDate: normalizeTimestamp(budget.startDate || readFirst(row, ["start_date", "startDate"])),
    endDate: normalizeTimestamp(budget.endDate || readFirst(row, ["end_date", "endDate"])),
    updatedAt: normalizeTimestamp(readFirst(row, ["last_updated_date", "lastUpdatedDate", "updated_at", "updatedAt", "update_time", "updateTime", "modify_time", "modifyTime"])),
    report: emptyReportMetrics(),
  };
}

function matchesFilters(row, filters) {
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const state = String(filters.state || "").trim();
  if (state && row.status !== state) return false;
  if (!keyword) return true;
  return [row.id, row.name, row.sellerName, row.country, row.profileId]
    .some((value) => String(value || "").toLowerCase().includes(keyword));
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.profileId || ""}:${row.id || row.name || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyReportMetrics() {
  return {
    impressions: 0,
    clicks: 0,
    cost: 0,
    sales: 0,
    sameSales: 0,
    orders: 0,
    sameOrders: 0,
    units: 0,
    sameUnits: 0,
    campaignCount: 0,
  };
}

function addDaysToText(dateText, days) {
  const date = new Date(`${normalizeDateText(dateText)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return normalizeDateText();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function dateWindow(endDateText, days = 7) {
  const lookbackDays = Math.max(1, Math.min(Number(days) || 7, 14));
  const endDate = normalizeDateText(endDateText);
  const startDate = addDaysToText(endDate, -lookbackDays + 1);
  const previousEndDate = addDaysToText(startDate, -1);
  const previousStartDate = addDaysToText(previousEndDate, -lookbackDays + 1);
  return {
    lookbackDays,
    endDate,
    startDate,
    dates: listDateRange(startDate, endDate, lookbackDays),
    previousEndDate,
    previousStartDate,
    previousDates: listDateRange(previousStartDate, previousEndDate, lookbackDays),
  };
}

function analysisDateWindows(endDateText) {
  const endDate = normalizeDateText(endDateText);
  const start7 = addDaysToText(endDate, -6);
  const start30 = addDaysToText(endDate, -29);
  const dates30 = listDateRange(start30, endDate, 30);
  const dates7 = listDateRange(start7, endDate, 7);
  const dates7Set = new Set(dates7);
  return {
    endDate,
    seven: { startDate: start7, endDate, dates: dates7 },
    thirty: { startDate: start30, endDate, dates: dates30 },
    dates7Set,
  };
}

function addReportMetric(target, source = {}) {
  target.impressions += toNumber(source.impressions);
  target.clicks += toNumber(source.clicks);
  target.cost += toNumber(source.cost);
  target.sales += toNumber(source.sales);
  target.sameSales += toNumber(source.same_sales ?? source.sameSales);
  target.orders += toNumber(source.orders);
  target.sameOrders += toNumber(source.same_orders ?? source.sameOrders);
  target.units += toNumber(source.units);
  target.sameUnits += toNumber(source.same_units ?? source.sameUnits);
}

function metricRate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function createKeywordMetrics() {
  return {
    impressions: 0,
    clicks: 0,
    cost: 0,
    sales: 0,
    sameSales: 0,
    orders: 0,
    sameOrders: 0,
    units: 0,
    sameUnits: 0,
  };
}

function metricsWithDerived(metrics = createKeywordMetrics()) {
  return {
    ...metrics,
    acos: metricRate(metrics.cost, metrics.sales),
    cvr: metricRate(metrics.orders, metrics.clicks),
    cpc: metricRate(metrics.cost, metrics.clicks),
    roas: metricRate(metrics.sales, metrics.cost),
  };
}

function addKeywordMetric(target, source = {}) {
  target.impressions += toNumber(source.impressions);
  target.clicks += toNumber(source.clicks);
  target.cost += toNumber(source.cost);
  target.sales += toNumber(source.sales);
  target.sameSales += toNumber(source.same_sales ?? source.sameSales);
  target.orders += toNumber(source.orders);
  target.sameOrders += toNumber(source.same_orders ?? source.sameOrders);
  target.units += toNumber(source.units);
  target.sameUnits += toNumber(source.same_units ?? source.sameUnits);
}

function portfolioKey(profileId, portfolioId) {
  return `${String(profileId || "")}:${String(portfolioId || "")}`;
}

async function fetchCampaignMapForAccount(adapter, account, baseParams, errors) {
  const campaignMap = new Map();
  for (const type of adTypes) {
    for (const candidate of accountCandidates(account)) {
      try {
        const payload = await adapter.fetchAdCampaigns(type.campaignEndpoint, { ...baseParams, ...candidate });
        normalizeRecordList(payload).forEach((row) => {
          const campaignId = String(readFirst(row, ["campaign_id", "campaignId", "id"]) || "");
          const portfolioId = String(readFirst(row, ["portfolio_id", "portfolioId"]) || "");
          const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || "");
          if (!campaignId || !portfolioId) return;
          campaignMap.set(`${type.key}:${campaignId}`, {
            adType: type.key,
            campaignId,
            profileId,
            portfolioId,
          });
        });
        break;
      } catch (error) {
        if (!/参数|param|invalid|参数有误/i.test(error.message || "")) errors.push(`${type.key}活动 ${account.sellerName}：${error.message}`);
      }
    }
  }
  return campaignMap;
}

function accountCandidates(account) {
  const candidates = [];
  if (account.sellerId) candidates.push({ sid: account.sellerId });
  if (account.profileId) candidates.push({ profile_id: account.profileId });
  return candidates;
}

function campaignAnalysisKey(row = {}, account = {}) {
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId", "id"]) || "");
  return `${profileId}:${campaignId}`;
}

function normalizeCampaignBase(row = {}, account = {}) {
  const budget = parseBudget(readFirst(row, ["daily_budget", "dailyBudget", "budget", "campaign_budget", "campaignBudget", "budget_amount", "budgetAmount"]));
  return {
    key: campaignAnalysisKey(row, account),
    campaignId: String(readFirst(row, ["campaign_id", "campaignId", "id"]) || "-"),
    campaignName: String(readFirst(row, ["campaign_name", "campaignName", "name"]) || "-"),
    profileId: String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "-"),
    sellerName: account.sellerName || "-",
    country: account.country || "-",
    adType: "SP",
    state: normalizeStatus(readFirst(row, ["state_text", "stateText", "state", "status_text", "statusText", "status"])),
    dailyBudget: budget.amount,
    currency: String(readFirst(row, ["currency", "currency_code", "currencyCode"]) || budget.currency || ""),
  };
}

function ensureCampaignAnalysis(map, row = {}, account = {}) {
  const key = campaignAnalysisKey(row, account);
  if (!map.has(key)) {
    map.set(key, {
      ...normalizeCampaignBase(row, account),
      seven: createKeywordMetrics(),
      thirty: createKeywordMetrics(),
      budgetFullDays7: 0,
      budgetFullDays30: 0,
      dailyCost: {},
    });
  }
  const target = map.get(key);
  const base = normalizeCampaignBase(row, account);
  Object.entries(base).forEach(([field, value]) => {
    if ((target[field] === "-" || target[field] === "" || target[field] === 0) && value !== "-" && value !== "" && value !== 0) {
      target[field] = value;
    }
  });
  return target;
}

function searchTermAnalysisKey(row = {}, account = {}) {
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId"]) || "");
  const query = String(readFirst(row, ["query", "search_term", "searchTerm", "customer_search_term", "customerSearchTerm"]) || "");
  return `${profileId}:${campaignId}:${query.toLowerCase()}`;
}

function ensureSearchTermAnalysis(map, row = {}, account = {}) {
  const key = searchTermAnalysisKey(row, account);
  if (!map.has(key)) {
    map.set(key, {
      key,
      query: String(readFirst(row, ["query", "search_term", "searchTerm", "customer_search_term", "customerSearchTerm"]) || "-"),
      targetText: String(readFirst(row, ["target_text", "targetText", "keyword_text", "keywordText"]) || "-"),
      campaignId: String(readFirst(row, ["campaign_id", "campaignId"]) || "-"),
      adGroupId: String(readFirst(row, ["ad_group_id", "adGroupId", "adgroup_id", "adgroupId"]) || "-"),
      profileId: String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "-"),
      sellerName: account.sellerName || "-",
      country: account.country || "-",
      seven: createKeywordMetrics(),
      thirty: createKeywordMetrics(),
    });
  }
  return map.get(key);
}

function keywordRowKey(row = {}, account = {}) {
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  const keywordId = String(readFirst(row, ["keyword_id", "keywordId", "target_id", "targetId", "id"]) || "");
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId"]) || "");
  const adGroupId = String(readFirst(row, ["ad_group_id", "adGroupId", "adgroup_id", "adgroupId"]) || "");
  const keywordText = String(readFirst(row, ["keyword_text", "keywordText", "target_text", "targetText", "query"]) || "");
  return `${profileId}:${keywordId || `${campaignId}:${adGroupId}:${keywordText}`}`;
}

function normalizeKeywordBase(row = {}, account = {}) {
  return {
    key: keywordRowKey(row, account),
    keywordId: String(readFirst(row, ["keyword_id", "keywordId", "target_id", "targetId", "id"]) || ""),
    keywordText: String(readFirst(row, ["keyword_text", "keywordText", "target_text", "targetText", "query"]) || "-"),
    matchType: String(readFirst(row, ["match_type", "matchType"]) || "-"),
    campaignId: String(readFirst(row, ["campaign_id", "campaignId"]) || "-"),
    adGroupId: String(readFirst(row, ["ad_group_id", "adGroupId", "adgroup_id", "adgroupId"]) || "-"),
    profileId: String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "-"),
    bid: toNumber(readFirst(row, ["bid", "keyword_bid", "keywordBid", "default_bid", "defaultBid"])),
    state: normalizeStatus(readFirst(row, ["state_text", "stateText", "state", "status_text", "statusText", "status"])),
    servingStatus: String(readFirst(row, ["serving_status", "servingStatus", "serving_status_text", "servingStatusText"]) || "-"),
    sellerName: account.sellerName || "-",
    country: account.country || "-",
  };
}

function ensureKeywordAggregate(map, row = {}, account = {}) {
  const key = keywordRowKey(row, account);
  if (!map.has(key)) {
    map.set(key, {
      ...normalizeKeywordBase(row, account),
      current: createKeywordMetrics(),
      previous: createKeywordMetrics(),
      thirty: createKeywordMetrics(),
    });
  }
  const target = map.get(key);
  const base = normalizeKeywordBase(row, account);
  Object.entries(base).forEach(([field, value]) => {
    if ((target[field] === "-" || target[field] === "" || target[field] === 0) && value !== "-" && value !== "" && value !== 0) {
      target[field] = value;
    }
  });
  return target;
}

function buildKeywordRecommendation(row) {
  const current = row.current || createKeywordMetrics();
  const previous = row.previous || createKeywordMetrics();
  const acos = metricRate(current.cost, current.sales);
  const cvr = metricRate(current.orders, current.clicks);
  const roas = metricRate(current.sales, current.cost);
  const cpc = metricRate(current.cost, current.clicks);
  const impressionChangeRate = previous.impressions ? (current.impressions - previous.impressions) / previous.impressions : null;
  const clickChangeRate = previous.clicks ? (current.clicks - previous.clicks) / previous.clicks : null;
  const losing = (current.cost >= 5 && current.sales === 0)
    || (current.sales > 0 && current.cost > current.sales)
    || (acos !== null && acos >= 0.6);
  const scale = current.clicks >= 8
    && current.orders > 0
    && current.sales > 0
    && (acos === null || acos <= 0.35)
    && (current.orders >= 2 || (cvr !== null && cvr >= 0.08));
  const pause = (current.clicks >= 20 && current.orders === 0)
    || (current.cost >= 20 && current.sales === 0);
  const rankDrop = ((previous.impressions >= 50 && current.impressions <= previous.impressions * 0.65)
    || (previous.clicks >= 8 && current.clicks <= previous.clicks * 0.65))
    && (current.impressions + current.clicks < previous.impressions + previous.clicks);

  let actionCategory = "观察";
  let actionTitle = "继续观察";
  let recommendation = "维持低频观察，等点击和订单样本更充分后再调整。";
  if (pause) {
    actionCategory = "建议暂停";
    actionTitle = "暂停或否定";
    recommendation = "点击或花费已经达到止损线但没有订单，先暂停高价投放；连续无转化则加入否定。";
  } else if (scale) {
    actionCategory = "该加预算";
    actionTitle = "加预算和首页加价";
    recommendation = "有点击、有订单且 ACoS 可控，优先增加预算，并保留或提高首页加价。";
  } else if (losing) {
    actionCategory = "亏钱词";
    actionTitle = current.orders > 0 ? "保留但控费" : "低价观察";
    recommendation = current.orders > 0
      ? "能出单但 ACoS 偏高，保留投放，降低竞价，关闭首页加价并控制每日预算。"
      : "有花费但没有转化，降低竞价和预算，只保留低价测试。";
  } else if (rankDrop) {
    actionCategory = "排名在掉";
    actionTitle = "检查排名和预算";
    recommendation = "领星关键词报表没有自然排名字段，这里按曝光/点击环比下降识别；需要检查竞价、预算耗尽和搜索位。";
  }

  const flags = { losing, scale, pause, rankDrop };
  const priority = (pause ? 400 : 0) + (scale ? 300 : 0) + (losing ? 200 : 0) + (rankDrop ? 100 : 0);
  const riskScore = current.cost + current.clicks * 0.2 + Math.max(0, current.cost - current.sales);
  return {
    ...row,
    current: { ...current, acos, cvr, roas, cpc },
    previous,
    trend: {
      impressionChangeRate,
      clickChangeRate,
      orderChange: current.orders - previous.orders,
      salesChange: current.sales - previous.sales,
    },
    flags,
    actionCategory,
    actionTitle,
    recommendation,
    priority,
    riskScore,
  };
}

async function fetchAdAccounts(adapter) {
  const accountPayloads = [];
  for (const type of ["seller", "vendor"]) {
    try {
      accountPayloads.push(await adapter.fetchAdvertisingAccounts({ type }));
    } catch (error) {
      if (type === "seller") throw error;
    }
  }
  return accountPayloads.flatMap((payload) => normalizeRecordList(payload)).map(normalizeAdAccount)
    .filter((account) => account.profileId || account.advertisingAccountId || account.sellerId);
}

async function fetchReportsForAccount(adapter, account, baseParams, reportDate, campaignMap, errors) {
  const metricsByPortfolio = new Map();
  for (const type of adTypes) {
    for (const candidate of accountCandidates(account)) {
      try {
        const payload = await adapter.fetchAdCampaignReport(type.reportEndpoint, {
          ...baseParams,
          ...candidate,
          report_date: reportDate,
        });
        normalizeRecordList(payload).forEach((row) => {
          const campaignId = String(readFirst(row, ["campaign_id", "campaignId", "id"]) || "");
          const campaign = campaignMap.get(`${type.key}:${campaignId}`);
          if (!campaign) return;
          const key = portfolioKey(campaign.profileId, campaign.portfolioId);
          if (!metricsByPortfolio.has(key)) metricsByPortfolio.set(key, emptyReportMetrics());
          const metric = metricsByPortfolio.get(key);
          addReportMetric(metric, row);
          metric.campaignCount += 1;
        });
        break;
      } catch (error) {
        if (!/参数|param|invalid|参数有误/i.test(error.message || "")) errors.push(`${type.key}报表 ${account.sellerName}：${error.message}`);
      }
    }
  }
  return metricsByPortfolio;
}

async function fetchPortfoliosForAccount(adapter, account, baseParams) {
  const candidates = accountCandidates(account);

  const tried = new Set();
  let lastError = null;
  for (const candidate of candidates) {
    const candidateKey = JSON.stringify(candidate);
    if (tried.has(candidateKey)) continue;
    tried.add(candidateKey);
    try {
      const payload = await adapter.fetchAdPortfolios({ ...baseParams, ...candidate });
      return {
        ok: true,
        payload,
        rows: normalizeRecordList(payload).map((row) => normalizeAdPortfolioRow(row, account)),
      };
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) throw error;
    }
  }

  return {
    ok: false,
    error: lastError?.message || "广告账号缺少可用于读取广告组合的 Profile 参数",
    rows: [],
  };
}

async function fetchKeywordsForAccount(adapter, account, baseParams, aggregateMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdKeywords({ ...baseParams, ...candidate });
      normalizeRecordList(payload).forEach((row) => ensureKeywordAggregate(aggregateMap, row, account));
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`关键词资料 ${account.sellerName || account.profileId}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

async function fetchKeywordReportForDate(adapter, account, baseParams, reportDate, period, aggregateMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdKeywordReport({
        ...baseParams,
        ...candidate,
        report_date: reportDate,
      });
      normalizeRecordList(payload).forEach((row) => {
        const target = ensureKeywordAggregate(aggregateMap, row, account);
        addKeywordMetric(target[period], row);
      });
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`关键词报表 ${account.sellerName || account.profileId} ${reportDate}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

async function fetchCampaignAnalysisBases(adapter, account, baseParams, campaignMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdCampaigns(spAdType.campaignEndpoint, { ...baseParams, ...candidate });
      normalizeRecordList(payload).forEach((row) => ensureCampaignAnalysis(campaignMap, row, account));
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`SP活动资料 ${account.sellerName || account.profileId}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

async function fetchCampaignAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, campaignMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdCampaignReport(spAdType.reportEndpoint, {
        ...baseParams,
        ...candidate,
        report_date: reportDate,
      });
      normalizeRecordList(payload).forEach((row) => {
        const target = ensureCampaignAnalysis(campaignMap, row, account);
        addKeywordMetric(target.thirty, row);
        if (windows.dates7Set.has(reportDate)) addKeywordMetric(target.seven, row);
        const dayCost = toNumber(row.cost);
        target.dailyCost[reportDate] = (target.dailyCost[reportDate] || 0) + dayCost;
        if (target.dailyBudget > 0 && dayCost >= target.dailyBudget * 0.9) {
          target.budgetFullDays30 += 1;
          if (windows.dates7Set.has(reportDate)) target.budgetFullDays7 += 1;
        }
      });
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`SP活动日报 ${account.sellerName || account.profileId} ${reportDate}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

async function fetchSearchTermAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, searchTermMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdSearchWordReport({
        ...baseParams,
        ...candidate,
        report_date: reportDate,
      });
      normalizeRecordList(payload).forEach((row) => {
        const target = ensureSearchTermAnalysis(searchTermMap, row, account);
        addKeywordMetric(target.thirty, row);
        if (windows.dates7Set.has(reportDate)) addKeywordMetric(target.seven, row);
      });
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`搜索词日报 ${account.sellerName || account.profileId} ${reportDate}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

async function fetchKeywordAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, keywordMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdKeywordReport({
        ...baseParams,
        ...candidate,
        report_date: reportDate,
      });
      normalizeRecordList(payload).forEach((row) => {
        const target = ensureKeywordAggregate(keywordMap, row, account);
        addKeywordMetric(target.thirty, row);
        if (windows.dates7Set.has(reportDate)) addKeywordMetric(target.current, row);
      });
      return true;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`关键词日报 ${account.sellerName || account.profileId} ${reportDate}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  return false;
}

function normalizeAnalysisRules(filters = {}) {
  const targetAcos = Number(filters.targetAcos ?? defaultKeywordAnalysisRules.targetAcos);
  const minCvr = Number(filters.minCvr ?? defaultKeywordAnalysisRules.minCvr);
  const maxCpc = Number(filters.maxCpc ?? defaultKeywordAnalysisRules.maxCpc);
  return {
    targetAcos: Number.isFinite(targetAcos) && targetAcos > 0 ? targetAcos : defaultKeywordAnalysisRules.targetAcos,
    minCvr: Number.isFinite(minCvr) && minCvr >= 0 ? minCvr : defaultKeywordAnalysisRules.minCvr,
    maxCpc: Number.isFinite(maxCpc) && maxCpc > 0 ? maxCpc : defaultKeywordAnalysisRules.maxCpc,
  };
}

function adKeywordAnalysisCacheName(endDate, rules) {
  return `${endDate}-${Math.round(rules.targetAcos * 10000)}-${Math.round(rules.minCvr * 10000)}-${String(rules.maxCpc).replace(/[^\d]/g, "_")}.json`;
}

async function readAdKeywordAnalysisCache(endDate, rules) {
  try {
    const content = await readFile(path.join(adKeywordAnalysisCacheDir, adKeywordAnalysisCacheName(endDate, rules)), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveAdKeywordAnalysisCache(endDate, rules, data) {
  await mkdir(adKeywordAnalysisCacheDir, { recursive: true });
  await writeFile(
    path.join(adKeywordAnalysisCacheDir, adKeywordAnalysisCacheName(endDate, rules)),
    JSON.stringify({
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      updatedAtMs: Date.now(),
      data,
    }, null, 2),
    "utf8",
  );
}

function emptyAdKeywordAnalysisResponse({ source = "领星 ERP · 关键词分析", syncStatus, rules, windows }) {
  return {
    source,
    endpoint: "/pb/openapi/newad/queryWordReports",
    syncStatus,
    period: windows,
    rules,
    rows: [],
    insights: [],
    kpis: { highAcosCampaigns: 0, budgetLimitedCampaigns: 0, negativeSearchTerms: 0, stableKeywords: 0 },
  };
}

function enrichCampaignAnalysis(row) {
  return {
    ...row,
    seven: metricsWithDerived(row.seven),
    thirty: metricsWithDerived(row.thirty),
  };
}

function enrichSearchTermAnalysis(row) {
  return {
    ...row,
    seven: metricsWithDerived(row.seven),
    thirty: metricsWithDerived(row.thirty),
  };
}

function enrichStableKeyword(row) {
  return {
    ...row,
    current: metricsWithDerived(row.current),
    thirty: metricsWithDerived(row.thirty),
  };
}

function campaignDisplayName(campaign) {
  return campaign?.campaignName && campaign.campaignName !== "-" ? campaign.campaignName : `Campaign ${campaign?.campaignId || "-"}`;
}

function formatPercentForText(value) {
  if (value === null || value === undefined) return "-";
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function buildAdAnalysisInsights({ campaigns, searchTerms, keywords, rules }) {
  const searchTermsByCampaign = new Map();
  searchTerms.forEach((term) => {
    const key = `${term.profileId}:${term.campaignId}`;
    if (!searchTermsByCampaign.has(key)) searchTermsByCampaign.set(key, []);
    searchTermsByCampaign.get(key).push(term);
  });

  const insights = [];
  campaigns
    .filter((campaign) => campaign.seven.cost > 0 && campaign.seven.acos !== null && campaign.seven.acos > rules.targetAcos)
    .sort((a, b) => (b.seven.cost - b.seven.sales) - (a.seven.cost - a.seven.sales))
    .slice(0, 12)
    .forEach((campaign) => {
      const terms = (searchTermsByCampaign.get(`${campaign.profileId}:${campaign.campaignId}`) || [])
        .filter((term) => term.seven.clicks >= 8 && term.seven.orders === 0 && (term.seven.cpc === null || term.seven.cpc <= rules.maxCpc * 2))
        .sort((a, b) => (b.seven.clicks - a.seven.clicks) || (b.seven.cost - a.seven.cost))
        .slice(0, 3);
      if (!terms.length) return;
      insights.push({
        type: "negative-search-term",
        severity: "high",
        title: `${campaignDisplayName(campaign)} ACoS 高于目标，优先否定无转化搜索词`,
        summary: `最近 7 天 ACoS ${formatPercentForText(campaign.seven.acos)}，高于目标 ${formatPercentForText(rules.targetAcos)}。主要原因是 ${terms.map((term) => term.query).join("、")} 点击多但没有转化。`,
        recommendation: "建议把这些搜索词加入否定关键词，先止住无效点击，再观察活动 ACoS 是否回落。",
        campaign,
        terms,
        metrics: campaign.seven,
      });
    });

  campaigns
    .filter((campaign) => campaign.dailyBudget > 0
      && campaign.budgetFullDays7 >= 2
      && campaign.seven.orders > 0
      && campaign.seven.acos !== null
      && campaign.seven.acos <= rules.targetAcos
      && (campaign.seven.cvr === null || campaign.seven.cvr >= rules.minCvr))
    .sort((a, b) => b.budgetFullDays7 - a.budgetFullDays7 || b.seven.sales - a.seven.sales)
    .slice(0, 10)
    .forEach((campaign) => {
      insights.push({
        type: "increase-budget",
        severity: "medium",
        title: `${campaignDisplayName(campaign)} ACoS 低但预算经常跑满`,
        summary: `最近 7 天 ACoS ${formatPercentForText(campaign.seven.acos)}，低于目标 ${formatPercentForText(rules.targetAcos)}，且 ${campaign.budgetFullDays7} 天花费接近日预算。`,
        recommendation: `建议提高日预算，先从 ${campaign.currency ? `${campaign.currency} ` : ""}${Math.ceil(campaign.dailyBudget * 1.2)} 左右测试，避免可控流量被预算截断。`,
        campaign,
        metrics: campaign.seven,
      });
    });

  keywords
    .filter((keyword) => {
      const thirty = keyword.thirty;
      const seven = keyword.current;
      const text = String(keyword.keywordText || "").trim();
      const match = String(keyword.matchType || "").toLowerCase();
      return text && text !== "-"
        && !["exact", "精准"].includes(match)
        && thirty.orders >= 3
        && thirty.cvr !== null
        && thirty.cvr >= rules.minCvr
        && (thirty.cpc === null || thirty.cpc <= rules.maxCpc)
        && thirty.acos !== null
        && thirty.acos <= rules.targetAcos
        && seven.orders > 0;
    })
    .sort((a, b) => b.thirty.orders - a.thirty.orders || a.thirty.acos - b.thirty.acos)
    .slice(0, 20)
    .forEach((keyword) => {
      insights.push({
        type: "split-exact-keyword",
        severity: "medium",
        title: `${keyword.keywordText} 转化稳定，可以拆精准投放`,
        summary: `过去 30 天订单 ${keyword.thirty.orders}，CVR ${formatPercentForText(keyword.thirty.cvr)}，CPC ${keyword.thirty.cpc === null ? "-" : keyword.thirty.cpc.toFixed(2)}，ACoS ${formatPercentForText(keyword.thirty.acos)}。`,
        recommendation: "建议单独拆出精准匹配活动或广告组，单独控预算、竞价和搜索位，保留原活动低价跑长尾。",
        keyword,
        metrics: keyword.thirty,
      });
    });

  return insights.sort((a, b) => {
    const weight = { high: 3, medium: 2, low: 1 };
    return (weight[b.severity] || 0) - (weight[a.severity] || 0);
  });
}

export async function getAdKeywordAnalysisDashboard(filters = {}) {
  const config = getConfig();
  const rules = normalizeAnalysisRules(filters);
  const windows = analysisDateWindows(filters.endDate || filters.reportDate);
  if (!filters.refresh) {
    const cached = await readAdKeywordAnalysisCache(windows.endDate, rules);
    if (cached?.data) {
      return {
        ...cached.data,
        syncStatus: `${cached.data.syncStatus || "已读取关键词分析快照"} · 快照 ${cached.updatedAt || ""}`,
        cached: true,
        cachedAt: cached.updatedAt || "",
      };
    }
    if (filters.cacheOnly) {
      return emptyAdKeywordAnalysisResponse({
        syncStatus: `还没有 ${windows.endDate} 的关键词分析快照，等待每日任务或点击“刷新分析”。`,
        rules,
        windows,
      });
    }
  }
  if (config.dataProvider !== "lingxing") {
    return {
      source: "接口未连接",
      endpoint: "/pb/openapi/newad/queryWordReports",
      syncStatus: "当前不是 lingxing 数据源，关键词分析未显示模拟数据。",
      rules,
      rows: [],
      insights: [],
      kpis: { highAcosCampaigns: 0, budgetLimitedCampaigns: 0, negativeSearchTerms: 0, stableKeywords: 0 },
    };
  }

  const adapter = getLingxingAdapter(config.lingxing);
  const baseParams = {
    offset: Number(filters.offset || 0) || 0,
    length: Number(filters.length || 1000) || 1000,
  };
  const accounts = await fetchAdAccounts(adapter);
  if (!accounts.length) {
    return emptyAdKeywordAnalysisResponse({
      syncStatus: "未从广告账号列表读取到 sid 或 profile_id，无法拉取关键词分析。",
      rules,
      windows,
    });
  }

  const campaignMap = new Map();
  const searchTermMap = new Map();
  const keywordMap = new Map();
  const errors = [];
  for (const account of accounts) {
    await fetchCampaignAnalysisBases(adapter, account, baseParams, campaignMap, errors);
    await fetchKeywordsForAccount(adapter, account, baseParams, keywordMap, errors);
    for (const reportDate of windows.thirty.dates) {
      await fetchCampaignAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, campaignMap, errors);
      await fetchSearchTermAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, searchTermMap, errors);
      await fetchKeywordAnalysisReportForDate(adapter, account, baseParams, reportDate, windows, keywordMap, errors);
    }
  }

  const campaigns = [...campaignMap.values()]
    .map(enrichCampaignAnalysis)
    .filter((row) => row.seven.impressions || row.seven.clicks || row.seven.cost || row.thirty.cost);
  const searchTerms = [...searchTermMap.values()]
    .map(enrichSearchTermAnalysis)
    .filter((row) => row.seven.clicks || row.thirty.clicks);
  const keywords = [...keywordMap.values()]
    .map(enrichStableKeyword)
    .filter((row) => row.current.clicks || row.thirty.clicks);
  const insights = buildAdAnalysisInsights({ campaigns, searchTerms, keywords, rules });
  const rows = insights.slice(0, Math.max(20, Math.min(Number(filters.limit || 80) || 80, 200)));
  const kpis = {
    highAcosCampaigns: campaigns.filter((row) => row.seven.acos !== null && row.seven.acos > rules.targetAcos).length,
    budgetLimitedCampaigns: campaigns.filter((row) => row.dailyBudget > 0 && row.budgetFullDays7 >= 2 && row.seven.acos !== null && row.seven.acos <= rules.targetAcos).length,
    negativeSearchTerms: searchTerms.filter((row) => row.seven.clicks >= 8 && row.seven.orders === 0).length,
    stableKeywords: keywords.filter((row) => row.thirty.orders >= 3 && row.thirty.cvr !== null && row.thirty.cvr >= rules.minCvr && row.thirty.acos !== null && row.thirty.acos <= rules.targetAcos).length,
  };

  const result = {
    source: "领星 ERP · 关键词分析",
    endpoint: "/pb/openapi/newad/queryWordReports",
    syncStatus: errors.length
      ? `已分析 ${campaigns.length} 个 SP 活动、${searchTerms.length} 个搜索词、${keywords.length} 个关键词，${errors.length} 个请求失败。`
      : `已分析 ${campaigns.length} 个 SP 活动、${searchTerms.length} 个搜索词、${keywords.length} 个关键词。`,
    period: windows,
    rules,
    rows,
    insights: rows,
    kpis,
  };
  await saveAdKeywordAnalysisCache(windows.endDate, rules, result);
  return result;
}

async function runScheduledAdKeywordAnalysis() {
  const config = getConfig();
  if (config.dataProvider !== "lingxing" || adKeywordAnalysisRunning) return;
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
  if (hour < 9) return;

  const rules = { ...defaultKeywordAnalysisRules };
  const endDate = addDaysToText(normalizeDateText(new Date()), -1);
  const cached = await readAdKeywordAnalysisCache(endDate, rules);
  if (cached?.data) return;

  adKeywordAnalysisRunning = true;
  try {
    await getAdKeywordAnalysisDashboard({ endDate, ...rules, refresh: true, limit: 80 });
  } catch (error) {
    console.error("Ad keyword analysis scheduler failed:", error);
  } finally {
    adKeywordAnalysisRunning = false;
  }
}

export function startAdKeywordAnalysisScheduler() {
  if (adKeywordAnalysisTimer) clearInterval(adKeywordAnalysisTimer);
  adKeywordAnalysisTimer = setInterval(() => {
    runScheduledAdKeywordAnalysis().catch((error) => {
      console.error("Ad keyword analysis scheduler tick failed:", error);
    });
  }, 60 * 60 * 1000);
  setTimeout(() => {
    runScheduledAdKeywordAnalysis().catch((error) => {
      console.error("Ad keyword analysis scheduler startup failed:", error);
    });
  }, 30 * 1000);
}

function keywordMatchesFilters(row, filters = {}) {
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const category = String(filters.category || "").trim();
  const categoryMatched = !category
    || (category === "losing" && row.flags?.losing)
    || (category === "scale" && row.flags?.scale)
    || (category === "pause" && row.flags?.pause)
    || (category === "rankDrop" && row.flags?.rankDrop);
  if (!categoryMatched) return false;
  if (!keyword) return true;
  return [row.keywordText, row.keywordId, row.sellerName, row.country, row.campaignId, row.adGroupId, row.profileId]
    .some((value) => String(value || "").toLowerCase().includes(keyword));
}

export async function getAdKeywordDashboard(filters = {}) {
  const config = getConfig();
  if (config.dataProvider !== "lingxing") {
    return {
      source: "接口未连接",
      endpoint: "/pb/openapi/newad/spKeywordReports",
      syncStatus: "当前不是 lingxing 数据源，关键词策略未显示模拟数据。",
      rows: [],
      kpis: { losing: 0, scale: 0, pause: 0, rankDrop: 0 },
    };
  }

  const adapter = getLingxingAdapter(config.lingxing);
  const window = dateWindow(filters.endDate || filters.reportDate, filters.lookbackDays || 7);
  const baseParams = {
    offset: Number(filters.offset || 0) || 0,
    length: Number(filters.length || 1000) || 1000,
  };
  const accounts = await fetchAdAccounts(adapter);
  if (!accounts.length) {
    return {
      source: "领星 ERP · 广告关键词策略",
      endpoint: "/pb/openapi/newad/spKeywordReports",
      syncStatus: "未从广告账号列表读取到 sid 或 profile_id，无法拉取关键词报表。",
      rows: [],
      kpis: { losing: 0, scale: 0, pause: 0, rankDrop: 0 },
      period: window,
    };
  }

  const aggregateMap = new Map();
  const errors = [];
  for (const account of accounts) {
    await fetchKeywordsForAccount(adapter, account, baseParams, aggregateMap, errors);
    for (const reportDate of window.dates) {
      await fetchKeywordReportForDate(adapter, account, baseParams, reportDate, "current", aggregateMap, errors);
    }
    for (const reportDate of window.previousDates) {
      await fetchKeywordReportForDate(adapter, account, baseParams, reportDate, "previous", aggregateMap, errors);
    }
  }

  const allRows = [...aggregateMap.values()]
    .map(buildKeywordRecommendation)
    .filter((row) => row.current.impressions || row.current.clicks || row.current.cost || row.previous.impressions || row.previous.clicks)
    .sort((a, b) => (b.priority - a.priority) || (b.riskScore - a.riskScore));
  const filteredRows = allRows.filter((row) => keywordMatchesFilters(row, filters));
  const maxRows = Math.max(20, Math.min(Number(filters.limit || 300) || 300, 1000));
  const rows = filteredRows.slice(0, maxRows);
  const kpis = allRows.reduce((acc, row) => {
    if (row.flags?.losing) acc.losing += 1;
    if (row.flags?.scale) acc.scale += 1;
    if (row.flags?.pause) acc.pause += 1;
    if (row.flags?.rankDrop) acc.rankDrop += 1;
    return acc;
  }, { losing: 0, scale: 0, pause: 0, rankDrop: 0 });

  return {
    source: "领星 ERP · 广告关键词策略",
    endpoint: "/pb/openapi/newad/spKeywordReports",
    syncStatus: errors.length
      ? `已读取 ${allRows.length} 个关键词，最近 ${window.lookbackDays} 天，${errors.length} 个账号或日报请求失败。`
      : `已读取 ${allRows.length} 个关键词，最近 ${window.lookbackDays} 天，覆盖 ${accounts.length} 个广告账号。`,
    period: window,
    total: filteredRows.length,
    rows,
    kpis,
  };
}

export async function getAdPortfolioDashboard(filters = {}) {
  const config = getConfig();
  if (config.dataProvider !== "lingxing") {
    return {
      source: "接口未连接",
      endpoint: "/pb/openapi/newad/portfolios",
      syncStatus: "当前不是 lingxing 数据源，广告组合未显示模拟数据。",
      total: 0,
      rows: [],
      summary: { active: 0, paused: 0, archived: 0, totalBudget: 0 },
    };
  }

  const adapter = getLingxingAdapter(config.lingxing);
  const baseParams = {
    offset: Number(filters.offset || 0) || 0,
    length: Number(filters.length || 200) || 200,
  };
  const reportDate = normalizeDateText(filters.reportDate);
  const accountPayloads = [];
  for (const type of ["seller", "vendor"]) {
    try {
      accountPayloads.push(await adapter.fetchAdvertisingAccounts({ type }));
    } catch (error) {
      if (type === "seller") throw error;
    }
  }
  const accounts = accountPayloads.flatMap((payload) => normalizeRecordList(payload)).map(normalizeAdAccount)
    .filter((account) => account.profileId || account.advertisingAccountId || account.sellerId);

  if (!accounts.length) {
    return {
      source: "领星 ERP · 广告-广告组合",
      endpoint: "/pb/openapi/newad/portfolios",
      syncStatus: "未从广告账号列表读取到 sid 或 profile_id，无法拉取广告组合。",
      total: 0,
      rows: [],
      summary: { active: 0, paused: 0, archived: 0, totalBudget: 0 },
    };
  }

  const results = [];
  const errors = [];
  for (const account of accounts) {
    const result = await fetchPortfoliosForAccount(adapter, account, baseParams);
    const campaignMap = await fetchCampaignMapForAccount(adapter, account, baseParams, errors);
    const reportMap = await fetchReportsForAccount(adapter, account, baseParams, reportDate, campaignMap, errors);
    results.push(...result.rows.map((row) => ({
      ...row,
      report: reportMap.get(portfolioKey(row.profileId, row.id)) || emptyReportMetrics(),
    })));
    if (!result.ok) errors.push(`${account.sellerName || account.profileId}：${result.error}`);
  }

  const rows = uniqueRows(results).filter((row) => matchesFilters(row, filters));
  const summary = rows.reduce((acc, row) => {
    acc.totalBudget += row.budget || 0;
    if (row.status === "启用") acc.active += 1;
    else if (row.status === "暂停") acc.paused += 1;
    else if (row.status === "归档") acc.archived += 1;
    return acc;
  }, { active: 0, paused: 0, archived: 0, totalBudget: 0 });

  return {
    source: "领星 ERP · 广告-广告组合",
    endpoint: "/pb/openapi/newad/portfolios",
    syncStatus: errors.length
      ? `已读取 ${rows.length} 个广告组合，报表日期 ${reportDate}，${errors.length} 个账号或报表请求失败。`
      : `已读取 ${rows.length} 个广告组合，报表日期 ${reportDate}，覆盖 ${accounts.length} 个广告账号。`,
    reportDate,
    total: rows.length,
    rows,
    summary,
  };
}

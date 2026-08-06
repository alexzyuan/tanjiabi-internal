import { getConfig } from "../config/index.js";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { listDateRange } from "../utils/dateRange.js";
import { normalizeRecordList, readFirst, toNumber } from "../utils/recordAccess.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cacheDir = path.join(process.cwd(), "data-cache", "ad-performance-review");
const maxAnalysisDays = 31;

const metricKeys = {
  impressions: ["impressions", "impression"],
  clicks: ["clicks", "click"],
  cost: ["cost", "spend", "ad_cost", "adCost"],
  sales: ["sales", "sale", "7 Day Total Sales", "seven_day_total_sales", "total_sales", "totalSales"],
  sameSales: ["same_sales", "sameSales", "direct_sales", "directSales"],
  orders: ["orders", "order", "7 Day Total Orders (#)", "seven_day_total_orders", "total_orders", "totalOrders"],
  sameOrders: ["same_orders", "sameOrders", "direct_orders", "directOrders"],
  units: ["units", "unit", "sales_quantity", "salesQuantity"],
};

function normalizeDateText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = value ? new Date(value) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function addDaysToText(dateText, days) {
  const date = new Date(`${normalizeDateText(dateText)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return normalizeDateText();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function daysBetween(startDateText, endDateText) {
  const start = new Date(`${normalizeDateText(startDateText)}T00:00:00`);
  const end = new Date(`${normalizeDateText(endDateText)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end - start) / 86400000) + 1;
}

export function normalizeAdReviewWindow(filters = {}) {
  const endDate = normalizeDateText(filters.endDate);
  const requestedDays = filters.startDate ? daysBetween(filters.startDate, endDate) : Number(filters.analysisDays || 7);
  const analysisDays = Math.max(1, Math.min(requestedDays || 7, maxAnalysisDays));
  const startDate = filters.startDate ? normalizeDateText(filters.startDate) : addDaysToText(endDate, -analysisDays + 1);
  const actualDays = Math.max(1, Math.min(daysBetween(startDate, endDate), maxAnalysisDays));
  const currentStartDate = actualDays === analysisDays ? startDate : addDaysToText(endDate, -actualDays + 1);
  const compareEndDate = filters.compareEndDate ? normalizeDateText(filters.compareEndDate) : addDaysToText(currentStartDate, -1);
  const compareStartDate = filters.compareStartDate ? normalizeDateText(filters.compareStartDate) : addDaysToText(compareEndDate, -actualDays + 1);
  return {
    startDate: currentStartDate,
    endDate,
    compareStartDate,
    compareEndDate,
    analysisDays: actualDays,
    currentDates: listDateRange(currentStartDate, endDate, actualDays),
    compareDates: listDateRange(compareStartDate, compareEndDate, actualDays),
  };
}

function createMetrics() {
  return { impressions: 0, clicks: 0, cost: 0, sales: 0, sameSales: 0, orders: 0, sameOrders: 0, units: 0 };
}

function metricRate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function deriveMetrics(metrics = createMetrics()) {
  return {
    ...metrics,
    ctr: metricRate(metrics.clicks, metrics.impressions),
    cvr: metricRate(metrics.orders, metrics.clicks),
    cpc: metricRate(metrics.cost, metrics.clicks),
    acos: metricRate(metrics.cost, metrics.sales),
    roas: metricRate(metrics.sales, metrics.cost),
  };
}

function addMetrics(target, source = {}) {
  Object.entries(metricKeys).forEach(([field, keys]) => {
    target[field] += toNumber(readFirst(source, keys));
  });
}

function normalizeAdAccount(row = {}) {
  return {
    profileId: String(readFirst(row, ["profile_id", "profileId", "profileID", "id"]) || ""),
    advertisingAccountId: String(readFirst(row, ["advertising_account_id", "advertisingAccountId", "ad_account_id", "adAccountId", "account_id", "accountId"]) || ""),
    sellerId: String(readFirst(row, ["seller_id", "sellerId", "sid"]) || ""),
    sellerName: String(readFirst(row, ["seller_name", "sellerName", "shop_name", "shopName", "store_name", "storeName", "account_name", "accountName", "name"]) || "-"),
    country: String(readFirst(row, ["country", "country_name", "countryName", "country_code", "countryCode", "marketplace", "marketplace_name", "marketplaceName", "region"]) || "-"),
  };
}

function accountCandidates(account) {
  const candidates = [];
  if (account.sellerId) candidates.push({ sid: account.sellerId });
  if (account.profileId) candidates.push({ profile_id: account.profileId });
  return candidates;
}

function normalizeStatus(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (["enabled", "active", "1", "正常", "启用", "投放中"].includes(lower) || ["正常", "启用", "投放中"].includes(text)) return "启用";
  if (["paused", "suspended", "2", "暂停"].includes(lower) || text === "暂停") return "暂停";
  if (["archived", "deleted", "3", "归档"].includes(lower) || text === "归档") return "归档";
  return text || "-";
}

function normalizeCampaignBase(row = {}, account = {}) {
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId", "id"]) || "");
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  return {
    key: `${profileId}:${campaignId}`,
    campaignId: campaignId || "-",
    campaignName: String(readFirst(row, ["campaign_name", "campaignName", "name"]) || "-"),
    profileId: profileId || "-",
    sellerName: account.sellerName || "-",
    country: account.country || "-",
    state: normalizeStatus(readFirst(row, ["state_text", "stateText", "state", "status_text", "statusText", "status"])),
  };
}

function ensureCampaign(map, row = {}, account = {}) {
  const base = normalizeCampaignBase(row, account);
  if (!map.has(base.key)) {
    map.set(base.key, { ...base, current: createMetrics(), compare: createMetrics() });
  }
  return map.get(base.key);
}

function targetIdentity(row = {}, account = {}) {
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId"]) || "");
  const adGroupId = String(readFirst(row, ["ad_group_id", "adGroupId", "adgroup_id", "adgroupId"]) || "");
  const targeting = String(readFirst(row, ["target_text", "targetText", "keyword_text", "keywordText", "targeting", "query"]) || "");
  const matchType = String(readFirst(row, ["match_type", "matchType"]) || "");
  return { profileId, campaignId, adGroupId, targeting, matchType };
}

function normalizeTargetBase(row = {}, account = {}) {
  const id = targetIdentity(row, account);
  return {
    key: `${id.profileId}:${id.campaignId}:${id.adGroupId}:${id.targeting.toLowerCase()}:${id.matchType.toLowerCase()}`,
    keywordId: String(readFirst(row, ["keyword_id", "keywordId", "target_id", "targetId", "id"]) || ""),
    targetText: id.targeting || "-",
    matchType: id.matchType || "-",
    campaignId: id.campaignId || "-",
    campaignName: String(readFirst(row, ["campaign_name", "campaignName"]) || "-"),
    adGroupId: id.adGroupId || "-",
    profileId: id.profileId || "-",
    bid: toNumber(readFirst(row, ["bid", "keyword_bid", "keywordBid", "default_bid", "defaultBid"])),
    state: normalizeStatus(readFirst(row, ["state_text", "stateText", "state", "status_text", "statusText", "status"])),
    sellerName: account.sellerName || "-",
    country: account.country || "-",
    asin: String(readFirst(row, ["asin", "advertised_asin", "advertisedAsin", "ad_asin", "adAsin", "sku_asin", "skuAsin"]) || ""),
    sku: String(readFirst(row, ["sku", "seller_sku", "sellerSku", "msku"]) || ""),
  };
}

function ensureTarget(map, row = {}, account = {}) {
  const base = normalizeTargetBase(row, account);
  if (!map.has(base.key)) {
    map.set(base.key, { ...base, current: createMetrics(), compare: createMetrics() });
  }
  const target = map.get(base.key);
  Object.entries(base).forEach(([field, value]) => {
    if ((target[field] === "-" || target[field] === "" || target[field] === 0) && value !== "-" && value !== "" && value !== 0) {
      target[field] = value;
    }
  });
  return target;
}

function normalizeSearchTermBase(row = {}, account = {}) {
  const profileId = String(readFirst(row, ["profile_id", "profileId"]) || account.profileId || account.advertisingAccountId || "");
  const campaignId = String(readFirst(row, ["campaign_id", "campaignId"]) || "");
  const adGroupId = String(readFirst(row, ["ad_group_id", "adGroupId", "adgroup_id", "adgroupId"]) || "");
  const query = String(readFirst(row, ["query", "search_term", "searchTerm", "customer_search_term", "customerSearchTerm"]) || "");
  return {
    key: `${profileId}:${campaignId}:${adGroupId}:${query.toLowerCase()}`,
    query: query || "-",
    targetText: String(readFirst(row, ["target_text", "targetText", "keyword_text", "keywordText"]) || "-"),
    matchType: String(readFirst(row, ["match_type", "matchType"]) || "-"),
    campaignId: campaignId || "-",
    campaignName: String(readFirst(row, ["campaign_name", "campaignName"]) || "-"),
    adGroupId: adGroupId || "-",
    profileId: profileId || "-",
    sellerName: account.sellerName || "-",
    country: account.country || "-",
    asin: String(readFirst(row, ["asin", "advertised_asin", "advertisedAsin", "ad_asin", "adAsin", "sku_asin", "skuAsin"]) || ""),
  };
}

function ensureSearchTerm(map, row = {}, account = {}) {
  const base = normalizeSearchTermBase(row, account);
  if (!map.has(base.key)) {
    map.set(base.key, { ...base, current: createMetrics(), compare: createMetrics() });
  }
  return map.get(base.key);
}

function matchesScope(row, scope = {}) {
  const store = String(scope.store || "").trim().toLowerCase();
  const country = String(scope.country || "").trim().toLowerCase();
  const asin = String(scope.asin || "").trim().toLowerCase();
  if (store && !String(row.sellerName || "").toLowerCase().includes(store)) return false;
  if (country && !String(row.country || "").toLowerCase().includes(country)) return false;
  if (asin) {
    const haystack = [row.asin, row.sku, row.campaignName, row.targetText, row.query].join(" ").toLowerCase();
    if (!haystack.includes(asin)) return false;
  }
  return true;
}

function addPeriodMetric(target, row, period) {
  addMetrics(target[period], row);
}

function compareMetric(current, compare) {
  if (!compare && !current) return null;
  if (!compare) return current ? 1 : null;
  return (current - compare) / compare;
}

function totalMetrics(rows, period) {
  const total = createMetrics();
  rows.forEach((row) => {
    Object.keys(total).forEach((key) => {
      total[key] += row[period]?.[key] || 0;
    });
  });
  return deriveMetrics(total);
}

function withDerived(row) {
  return {
    ...row,
    current: deriveMetrics(row.current),
    compare: deriveMetrics(row.compare),
  };
}

export function classifyAdTarget(row, rules = {}) {
  const targetAcos = Number(rules.targetAcos || 0.25);
  const avgClicksPerOrder = Math.max(1, Number(rules.avgClicksPerOrder || 7));
  const core = Boolean(row.core);
  const metrics = row.current || {};
  if (!metrics.clicks) {
    return { label: "无点击", tone: "muted", action: "观察", bidChange: "0%", reason: "当前周期无流量，先检查预算、状态和基础出价。" };
  }
  if (!metrics.orders) {
    if (metrics.clicks >= avgClicksPerOrder) {
      return { label: "高点击不出单", tone: "danger", action: "暂停/否定", bidChange: "-20%", reason: `已有 ${Math.round(metrics.clicks)} 次点击但没有订单，优先止损。` };
    }
    return { label: "低点击不出单", tone: "warning", action: "低价观察", bidChange: "-10%", reason: "点击样本还不充分，但已有花费，先降低无效流量成本。" };
  }
  if (metrics.acos !== null && metrics.acos > targetAcos) {
    if (core) {
      return { label: "核心高 ACoS 出单", tone: "warning", action: "保护控费", bidChange: "0%", reason: "这是核心出单流量，不建议直接大幅降价，先看搜索词和预算结构。" };
    }
    const ratio = metrics.acos / targetAcos;
    const pct = ratio <= 1.2 ? -5 : ratio <= 1.5 ? -10 : -15;
    return { label: "高 ACoS 出单", tone: "warning", action: "降价", bidChange: `${pct}%`, reason: `ACoS 高于目标 ${Math.round((ratio - 1) * 100)}%，按偏离幅度控价。` };
  }
  if (core) {
    return { label: "核心低 ACoS 出单", tone: "success", action: "保护", bidChange: "0%", reason: "核心成交流量，维持预算和竞价稳定。" };
  }
  return { label: "低 ACoS 出单", tone: "success", action: "维持/小幅提价", bidChange: "+0~5%", reason: "有订单且 ACoS 可控，可小幅测试放量。" };
}

function addTargetShareAndAction(rows, rules) {
  const totalSales = rows.reduce((sum, row) => sum + (row.current.sales || 0), 0);
  const ranked = rows
    .map((row) => ({ ...row, salesShare: totalSales ? row.current.sales / totalSales : 0 }))
    .sort((a, b) => (b.current.orders - a.current.orders) || (b.current.sales - a.current.sales));
  return ranked.map((row, index) => {
    const core = index < 10 && row.current.orders > 0 || row.salesShare >= Number(rules.coreSalesShare || 0.2);
    const classified = classifyAdTarget({ ...row, core }, rules);
    return {
      ...row,
      rank: index + 1,
      core,
      ...classified,
      trend: {
        salesChangeRate: compareMetric(row.current.sales, row.compare.sales),
        orderChange: row.current.orders - row.compare.orders,
        costChangeRate: compareMetric(row.current.cost, row.compare.cost),
      },
    };
  });
}

function buildSearchTermActions(rows, rules) {
  const avgClicksPerOrder = Math.max(1, Number(rules.avgClicksPerOrder || 7));
  const targetAcos = Number(rules.targetAcos || 0.25);
  return rows
    .map((row) => {
      let action = "观察";
      let tone = "muted";
      let reason = "样本不足，先观察。";
      if (row.current.clicks >= avgClicksPerOrder && row.current.orders === 0) {
        action = "加否定";
        tone = "danger";
        reason = "点击达到止损线但没有订单。";
      } else if (row.current.orders > 0 && row.current.acos !== null && row.current.acos <= targetAcos) {
        action = "沉淀精准";
        tone = "success";
        reason = "搜索词有订单且 ACoS 可控。";
      } else if (row.current.orders > 0 && row.current.acos !== null && row.current.acos > targetAcos) {
        action = "控价观察";
        tone = "warning";
        reason = "能出单但 ACoS 高于目标。";
      }
      return { ...row, action, tone, reason };
    })
    .sort((a, b) => (b.current.cost - a.current.cost) || (b.current.clicks - a.current.clicks));
}

function buildMarkdown({ window, summary, targetRows, searchTermRows }) {
  const pct = (value) => value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
  const num = (value) => Number(value || 0).toFixed(2);
  const lines = [
    `# 广告复盘分析 ${window.startDate} 至 ${window.endDate}`,
    "",
    `对比周期：${window.compareStartDate} 至 ${window.compareEndDate}`,
    "",
    `- 花费：${num(summary.current.cost)}，对比变化 ${pct(summary.delta.cost)}`,
    `- 广告销售额：${num(summary.current.sales)}，对比变化 ${pct(summary.delta.sales)}`,
    `- 订单：${Math.round(summary.current.orders || 0)}，对比变化 ${pct(summary.delta.orders)}`,
    `- ACoS：${pct(summary.current.acos)}，对比期 ${pct(summary.compare.acos)}`,
    `- CTR：${pct(summary.current.ctr)}，CVR：${pct(summary.current.cvr)}，CPC：${summary.current.cpc === null ? "-" : num(summary.current.cpc)}`,
    "",
    "## Targeting 动作优先级",
    ...targetRows.slice(0, 12).map((row, index) => `${index + 1}. ${row.targetText}（${row.matchType}）- ${row.label}，建议：${row.action} ${row.bidChange}。花费 ${num(row.current.cost)}，订单 ${Math.round(row.current.orders || 0)}，ACoS ${pct(row.current.acos)}。`),
    "",
    "## 搜索词动作",
    ...searchTermRows.slice(0, 12).map((row, index) => `${index + 1}. ${row.query} - ${row.action}。点击 ${Math.round(row.current.clicks || 0)}，订单 ${Math.round(row.current.orders || 0)}，花费 ${num(row.current.cost)}。`),
  ];
  return lines.join("\n");
}

export function buildAdPerformanceReviewModel({ campaignRows = [], targetRows = [], searchTermRows = [], window, rules = {}, scope = {}, errors = [], source = "领星 ERP · 广告复盘分析" }) {
  const scopedCampaigns = campaignRows.map(withDerived).filter((row) => matchesScope(row, scope));
  const scopedTargets = targetRows.map(withDerived).filter((row) => matchesScope(row, scope) && (row.current.clicks || row.compare.clicks || row.current.cost || row.compare.cost));
  const scopedSearchTerms = searchTermRows.map(withDerived).filter((row) => matchesScope(row, scope) && (row.current.clicks || row.compare.clicks || row.current.cost || row.compare.cost));
  const current = totalMetrics(scopedTargets.length ? scopedTargets : scopedCampaigns, "current");
  const compare = totalMetrics(scopedTargets.length ? scopedTargets : scopedCampaigns, "compare");
  const summary = {
    current,
    compare,
    delta: {
      impressions: compareMetric(current.impressions, compare.impressions),
      clicks: compareMetric(current.clicks, compare.clicks),
      cost: compareMetric(current.cost, compare.cost),
      sales: compareMetric(current.sales, compare.sales),
      orders: compareMetric(current.orders, compare.orders),
      acos: current.acos !== null && compare.acos !== null ? current.acos - compare.acos : null,
      cvr: current.cvr !== null && compare.cvr !== null ? current.cvr - compare.cvr : null,
      cpc: compareMetric(current.cpc || 0, compare.cpc || 0),
    },
  };
  const targets = addTargetShareAndAction(scopedTargets, rules)
    .sort((a, b) => {
      const weight = { danger: 4, warning: 3, success: 2, muted: 1 };
      return (weight[b.tone] || 0) - (weight[a.tone] || 0) || b.current.cost - a.current.cost;
    });
  const searchTerms = buildSearchTermActions(scopedSearchTerms, rules);
  const campaigns = scopedCampaigns
    .map((row) => ({
      ...row,
      trend: {
        salesChangeRate: compareMetric(row.current.sales, row.compare.sales),
        orderChange: row.current.orders - row.compare.orders,
        costChangeRate: compareMetric(row.current.cost, row.compare.cost),
      },
    }))
    .sort((a, b) => b.current.cost - a.current.cost);
  const kpis = {
    targetCount: targets.length,
    highAcosTargets: targets.filter((row) => row.label.includes("高 ACoS")).length,
    noOrderTargets: targets.filter((row) => row.label.includes("不出单")).length,
    protectedTargets: targets.filter((row) => row.core).length,
    negativeSearchTerms: searchTerms.filter((row) => row.action === "加否定").length,
    exactCandidates: searchTerms.filter((row) => row.action === "沉淀精准").length,
  };
  const markdown = buildMarkdown({ window, summary, targetRows: targets, searchTermRows: searchTerms });
  return {
    source,
    endpoint: "/pb/openapi/newad/spCampaignReports,/pb/openapi/newad/spKeywordReports,/pb/openapi/newad/queryWordReports",
    syncStatus: errors.length
      ? `已生成复盘，Campaign ${campaigns.length} 个、Targeting ${targets.length} 个、搜索词 ${searchTerms.length} 个，${errors.length} 个请求失败。`
      : `已生成复盘，Campaign ${campaigns.length} 个、Targeting ${targets.length} 个、搜索词 ${searchTerms.length} 个。`,
    window,
    rules,
    scope,
    kpis,
    summary,
    campaigns: campaigns.slice(0, 80),
    targets: targets.slice(0, 120),
    searchTerms: searchTerms.slice(0, 120),
    markdown,
    errors: errors.slice(0, 20),
    asinSupport: {
      requested: Boolean(scope.asin),
      matched: !scope.asin || targets.some((row) => matchesScope(row, scope)) || searchTerms.some((row) => matchesScope(row, scope)),
      note: "当前未确认领星开放广告商品报表 endpoint；ASIN 会匹配现有广告报表返回的 ASIN/SKU/Campaign/Targeting 字段。",
    },
  };
}

async function readCache(cacheName) {
  try {
    return JSON.parse(await readFile(path.join(cacheDir, cacheName), "utf8"));
  } catch {
    return null;
  }
}

async function saveCache(cacheName, data) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, cacheName), JSON.stringify({
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    data,
  }, null, 2), "utf8");
}

function cacheName(window, rules, scope) {
  const raw = [
    window.startDate,
    window.endDate,
    window.compareStartDate,
    window.compareEndDate,
    Math.round(Number(rules.targetAcos || 0) * 10000),
    Math.round(Number(rules.avgClicksPerOrder || 0) * 100),
    scope.store || "",
    scope.country || "",
    scope.asin || "",
  ].join("__").replace(/[^\w.-]+/g, "_");
  return `${raw}.json`;
}

async function fetchAdAccounts(adapter) {
  const payloads = [];
  for (const type of ["seller", "vendor"]) {
    try {
      payloads.push(await adapter.fetchAdvertisingAccounts({ type }));
    } catch (error) {
      if (type === "seller") throw error;
    }
  }
  return payloads.flatMap((payload) => normalizeRecordList(payload)).map(normalizeAdAccount)
    .filter((account) => account.profileId || account.advertisingAccountId || account.sellerId);
}

async function fetchCampaignBases(adapter, account, baseParams, campaignMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdCampaigns("/pb/openapi/newad/spCampaigns", { ...baseParams, ...candidate });
      normalizeRecordList(payload).forEach((row) => ensureCampaign(campaignMap, row, account));
      return;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`SP活动资料 ${account.sellerName || account.profileId}：${lastError?.message || "缺少 sid 或 profile_id"}`);
}

async function fetchKeywordBases(adapter, account, baseParams, targetMap, errors) {
  let lastError = null;
  for (const candidate of accountCandidates(account)) {
    try {
      const payload = await adapter.fetchAdKeywords({ ...baseParams, ...candidate });
      normalizeRecordList(payload).forEach((row) => ensureTarget(targetMap, row, account));
      return;
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
    }
  }
  errors.push(`SP关键词资料 ${account.sellerName || account.profileId}：${lastError?.message || "缺少 sid 或 profile_id"}`);
}

async function fetchDailyReports(adapter, account, baseParams, reportDate, period, maps, errors) {
  const candidates = accountCandidates(account);
  async function tryReport(label, call, applyRows) {
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const payload = await call({ ...baseParams, ...candidate, report_date: reportDate });
        applyRows(normalizeRecordList(payload));
        return;
      } catch (error) {
        lastError = error;
        if (!/参数|param|invalid|参数有误/i.test(error.message || "")) break;
      }
    }
    errors.push(`${label} ${account.sellerName || account.profileId} ${reportDate}：${lastError?.message || "缺少 sid 或 profile_id"}`);
  }

  await tryReport("SP活动日报", (params) => adapter.fetchAdCampaignReport("/pb/openapi/newad/spCampaignReports", params), (rows) => {
    rows.forEach((row) => addPeriodMetric(ensureCampaign(maps.campaignMap, row, account), row, period));
  });
  await tryReport("SP关键词日报", (params) => adapter.fetchAdKeywordReport(params), (rows) => {
    rows.forEach((row) => addPeriodMetric(ensureTarget(maps.targetMap, row, account), row, period));
  });
  await tryReport("搜索词日报", (params) => adapter.fetchAdSearchWordReport(params), (rows) => {
    rows.forEach((row) => addPeriodMetric(ensureSearchTerm(maps.searchTermMap, row, account), row, period));
  });
}

export async function getAdPerformanceReview(filters = {}) {
  const config = getConfig();
  const window = normalizeAdReviewWindow(filters);
  const rules = {
    targetAcos: Number(filters.targetAcos || 0.25) || 0.25,
    avgClicksPerOrder: Number(filters.avgClicksPerOrder || 7) || 7,
    coreSalesShare: Number(filters.coreSalesShare || 0.2) || 0.2,
  };
  const scope = {
    store: String(filters.store || "").trim(),
    country: String(filters.country || "").trim(),
    asin: String(filters.asin || "").trim(),
  };
  const name = cacheName(window, rules, scope);
  if (!filters.refresh) {
    const cached = await readCache(name);
    if (cached?.data) {
      return { ...cached.data, cached: true, cachedAt: cached.updatedAt, syncStatus: `${cached.data.syncStatus || "已读取广告复盘"} · 快照 ${cached.updatedAt}` };
    }
  }
  if (config.dataProvider !== "lingxing") {
    return buildAdPerformanceReviewModel({
      window,
      rules,
      scope,
      source: "接口未连接",
      errors: ["当前不是 lingxing 数据源，广告复盘不显示模拟数据。"],
    });
  }

  const adapter = getLingxingAdapter(config.lingxing);
  const baseParams = {
    offset: Number(filters.offset || 0) || 0,
    length: Math.max(100, Math.min(Number(filters.length || 1000) || 1000, 1000)),
  };
  const accounts = await fetchAdAccounts(adapter);
  const campaignMap = new Map();
  const targetMap = new Map();
  const searchTermMap = new Map();
  const errors = [];
  for (const account of accounts) {
    await fetchCampaignBases(adapter, account, baseParams, campaignMap, errors);
    await fetchKeywordBases(adapter, account, baseParams, targetMap, errors);
    for (const date of window.currentDates) {
      await fetchDailyReports(adapter, account, baseParams, date, "current", { campaignMap, targetMap, searchTermMap }, errors);
    }
    for (const date of window.compareDates) {
      await fetchDailyReports(adapter, account, baseParams, date, "compare", { campaignMap, targetMap, searchTermMap }, errors);
    }
  }

  const result = buildAdPerformanceReviewModel({
    campaignRows: [...campaignMap.values()],
    targetRows: [...targetMap.values()],
    searchTermRows: [...searchTermMap.values()],
    window,
    rules,
    scope,
    errors,
  });
  await saveCache(name, result);
  return result;
}

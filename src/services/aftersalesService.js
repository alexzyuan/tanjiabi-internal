import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

function normalizeRange(filters = {}) {
  const fallback = defaultRange();
  return {
    startDate: String(filters.startDate || fallback.startDate).slice(0, 10),
    endDate: String(filters.endDate || fallback.endDate).slice(0, 10),
  };
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function percentDecimal(value) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  const number = numberValue(text);
  if (text.includes("%")) return number / 100;
  return number > 1 ? number / 100 : number;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function firstText(values, keys = []) {
  const list = Array.isArray(values) ? values : [values];
  for (const item of list) {
    if (item && typeof item === "object") {
      for (const key of keys) {
        const value = item[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
      }
    } else if (item !== undefined && item !== null && String(item).trim() !== "") {
      return String(item).trim();
    }
  }
  return "";
}

function uniqueText(values) {
  return [...new Set(asArray(values).flatMap((item) => asArray(item)).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeCountryName(country) {
  const value = String(country || "").trim();
  const map = {
    AU: "澳洲",
    CA: "加拿大",
    CN: "中国",
    DE: "德国",
    FR: "法国",
    IT: "意大利",
    JP: "日本",
    MX: "墨西哥",
    UK: "英国",
    US: "美国",
    USA: "美国",
  };
  return map[value.toUpperCase()] || value || "-";
}

function rowKey(parts) {
  const sid = String(parts.sid || "").trim();
  const msku = String(parts.msku || "").trim().toUpperCase();
  const asin = String(parts.asin || "").trim().toUpperCase();
  if (sid && msku) return `sid:${sid}|msku:${msku}`;
  if (sid && asin) return `sid:${sid}|asin:${asin}`;
  if (msku) return `msku:${msku}`;
  if (asin) return `asin:${asin}`;
  return `unknown:${Math.random().toString(36).slice(2)}`;
}

function totalCountOf(payload, recordsLength = 0) {
  return Number(payload?.data?.total ?? payload?.total ?? recordsLength) || recordsLength;
}

function readableError(error) {
  const message = error?.message || String(error || "未知错误");
  const causeCode = error?.cause?.code || "";
  const causeMessage = error?.cause?.message || "";
  return [message, causeCode, causeMessage].filter(Boolean).join(" / ");
}

async function fetchPaged(call, baseParams = {}, { maxPages = 5, length = 200 } = {}) {
  const rows = [];
  let payload = null;
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * length;
    payload = await call({ ...baseParams, offset, length });
    const records = payload?.data?.records || payload?.data?.list || payload?.data?.rows || payload?.data;
    const pageRows = Array.isArray(records) ? records : [];
    rows.push(...pageRows);
    const total = totalCountOf(payload, rows.length);
    if (pageRows.length < length || rows.length >= total) break;
  }
  return { rows, payload };
}

async function fetchReturnAnalysisPaged(adapter, baseParams = {}) {
  const variants = [
    baseParams,
    { ...baseParams, storeId: undefined },
    { ...baseParams, storeId: undefined, sortField: undefined, sortType: undefined },
  ];
  let lastError = null;
  for (const params of variants) {
    try {
      const cleanParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
      return await fetchPaged((requestParams) => adapter.fetchReturnAnalysis(requestParams), cleanParams, { maxPages: 5, length: 20 });
    } catch (error) {
      lastError = error;
      if (!/参数|param|invalid/i.test(readableError(error))) break;
    }
  }
  throw lastError;
}

function sellerParams(sellers) {
  const sids = sellers.map((seller) => Number(seller.sid)).filter(Boolean);
  return {
    sids,
    sidsText: sids.join(","),
  };
}

function createCombinedRow(seed = {}) {
  return {
    key: seed.key || "",
    sid: seed.sid || "",
    storeName: seed.storeName || "",
    country: seed.country || "",
    msku: seed.msku || "",
    asin: seed.asin || "",
    localSku: seed.localSku || "",
    localName: seed.localName || "",
    imageUrl: seed.imageUrl || "",
    title: seed.title || "",
    returnCount: 0,
    returnOrders: 0,
    salesVolume: 0,
    returnRate: 0,
    returnRateDiff: 0,
    returnReason: "",
    returnBadge: "",
    ncxRate: 0,
    ncxCount: 0,
    orderCount: 0,
    voiceHealth: "",
    reviewCount: 0,
    lowStarReviewCount: 0,
    avgStar: 0,
    pendingReviewCount: 0,
    latestReviewTitle: "",
    latestReviewContent: "",
    sources: {
      returns: 0,
      reviews: 0,
      voice: 0,
    },
    signals: [],
  };
}

function ensureCombinedRow(map, seed) {
  const key = rowKey(seed);
  if (!map.has(key)) map.set(key, createCombinedRow({ ...seed, key }));
  const row = map.get(key);
  for (const keyName of ["sid", "storeName", "country", "msku", "asin", "localSku", "localName", "imageUrl", "title"]) {
    if (!row[keyName] && seed[keyName]) row[keyName] = seed[keyName];
  }
  return row;
}

function normalizeReturnSeed(item = {}) {
  const info = asArray(item.infoDTOList)[0] || {};
  const sellerInfo = asArray(item.sellerInfoList)[0] || {};
  const asinInfo = asArray(item.asinsList)[0] || {};
  const localInfo = asArray(item.localSkuInfoList)[0] || {};
  return {
    sid: item.sid || info.sid || sellerInfo.sid,
    storeName: info.sellerName || sellerInfo.sellerName || "",
    country: normalizeCountryName(info.country || sellerInfo.country || ""),
    msku: item.msku || info.msku || firstText(item.fnskuInfoList, ["msku"]) || firstText(item.selFnskuSkuInfoList, ["msku"]),
    asin: info.asin || asinInfo.asin || "",
    localSku: info.localSku || localInfo.localSku || "",
    localName: info.localName || localInfo.localName || "",
    imageUrl: info.smallImageUrl || "",
    title: info.spuName || "",
  };
}

function applyReturnRow(map, item) {
  const row = ensureCombinedRow(map, normalizeReturnSeed(item));
  row.sources.returns += 1;
  row.returnCount += numberValue(item.curReturnGoodsCount);
  row.returnOrders += numberValue(item.curReturnGoodsItems);
  row.salesVolume += numberValue(item.curVolume);
  row.returnRate = Math.max(row.returnRate, percentDecimal(item.curReturnGoodsVolumeRatio));
  row.returnRateDiff = Math.max(row.returnRateDiff, percentDecimal(item.returnGoodsVolumeRatioDiff));
  row.returnReason = row.returnReason || item.mostCommonReturnReasonBucket || "";
  row.returnBadge = row.returnBadge || item.returnBadge || "";
  row.ncxRate = Math.max(row.ncxRate, percentDecimal(item.ncxRate));
  row.ncxCount = Math.max(row.ncxCount, numberValue(item.ncxCount));
  row.orderCount = Math.max(row.orderCount, numberValue(item.orderCount));
  row.voiceHealth = row.voiceHealth || item.pcxHealth || "";
  if (row.returnCount > 0) row.signals.push(`退货 ${row.returnCount}`);
  if (row.returnRate >= 0.08) row.signals.push(`退货率 ${(row.returnRate * 100).toFixed(1)}%`);
  if (row.returnReason) row.signals.push(`原因 ${row.returnReason}`);
}

function normalizeReviewSeeds(item = {}) {
  const mskus = uniqueText(item.seller_sku);
  const stores = uniqueText(item.seller_name);
  const localInfo = asArray(item.local_info)[0] || {};
  const seedBase = {
    sid: "",
    storeName: stores[0] || "",
    country: normalizeCountryName(item.marketplace),
    asin: item.asin || "",
    localSku: localInfo.local_sku || "",
    localName: localInfo.local_name || "",
    imageUrl: item.small_image_url || "",
    title: firstText(item.item_name) || item.last_title || "",
  };
  return (mskus.length ? mskus : [""]).map((msku) => ({ ...seedBase, msku }));
}

function applyReviewRow(map, item) {
  const star = numberValue(item.last_star);
  normalizeReviewSeeds(item).forEach((seed) => {
    const row = ensureCombinedRow(map, seed);
    row.sources.reviews += 1;
    row.reviewCount += 1;
    row.avgStar = row.reviewCount === 1 ? star : ((row.avgStar * (row.reviewCount - 1)) + star) / row.reviewCount;
    if (star > 0 && star <= 3) {
      row.lowStarReviewCount += 1;
      row.signals.push(`${star}星Review`);
    }
    if (Number(item.status) !== 2) row.pendingReviewCount += 1;
    row.latestReviewTitle = row.latestReviewTitle || item.last_title || "";
    row.latestReviewContent = row.latestReviewContent || item.last_content || "";
  });
}

function normalizeVoiceSeed(item = {}) {
  return {
    sid: item.sid,
    storeName: item.seller_name || "",
    country: normalizeCountryName(item.country),
    msku: item.msku || "",
    asin: item.asin || "",
    localSku: item.sku || "",
    localName: item.product_name || "",
    imageUrl: item.image_url || "",
    title: item.title || "",
  };
}

function applyVoiceRow(map, item) {
  const row = ensureCombinedRow(map, normalizeVoiceSeed(item));
  row.sources.voice += 1;
  row.ncxRate = Math.max(row.ncxRate, percentDecimal(item.ncx_rate));
  row.ncxCount = Math.max(row.ncxCount, numberValue(item.ncx_count));
  row.orderCount = Math.max(row.orderCount, numberValue(item.order_count));
  row.returnReason = row.returnReason || item.most_common_return_reason_bucket || "";
  row.voiceHealth = row.voiceHealth || item.pcx_health_text || "";
  row.returnBadge = row.returnBadge || item.returnBadge || "";
  if (item.returnRate) row.returnRate = Math.max(row.returnRate, percentDecimal(item.returnRate));
  if (row.ncxRate >= 0.03) row.signals.push(`不满意率 ${(row.ncxRate * 100).toFixed(1)}%`);
  if (row.voiceHealth) row.signals.push(`买家之声 ${row.voiceHealth}`);
  if (row.returnBadge) row.signals.push(`退货标记 ${row.returnBadge}`);
}

function riskScore(row) {
  let score = 0;
  score += Math.min(row.returnCount * 2, 40);
  score += row.returnRate >= 0.12 ? 30 : row.returnRate >= 0.08 ? 20 : row.returnRate >= 0.05 ? 10 : 0;
  score += row.lowStarReviewCount * 8;
  score += row.pendingReviewCount * 3;
  score += row.ncxRate >= 0.08 ? 25 : row.ncxRate >= 0.03 ? 15 : 0;
  if (/极差|不合格|差|Poor|At_Risk|Yes/i.test(`${row.voiceHealth} ${row.returnBadge}`)) score += 20;
  if (row.sources.returns && row.sources.reviews && row.sources.voice) score += 12;
  return score;
}

function riskLevel(row) {
  const score = row.riskScore;
  if (score >= 70) return "高风险";
  if (score >= 35) return "需关注";
  return "观察";
}

function actionText(row) {
  if (row.returnReason && row.lowStarReviewCount) return "优先复盘退货原因与差评内容";
  if (row.returnCount > 0) return "核对退货原因并定位批次 / listing";
  if (row.lowStarReviewCount > 0) return "跟进低星 Review 并补充处理记录";
  if (row.ncxCount > 0) return "查看买家之声 NCX 原因";
  return "保持观察";
}

function summarizeRows(rows) {
  return rows.reduce((acc, row) => {
    acc.returnCount += row.returnCount;
    acc.returnOrders += row.returnOrders;
    acc.salesVolume += row.salesVolume;
    acc.reviewCount += row.reviewCount;
    acc.lowStarReviewCount += row.lowStarReviewCount;
    acc.pendingReviewCount += row.pendingReviewCount;
    acc.voiceRiskCount += row.ncxRate >= 0.03 || /极差|不合格|差|Poor|At_Risk|Yes/i.test(`${row.voiceHealth} ${row.returnBadge}`) ? 1 : 0;
    if (row.riskLevel === "高风险") acc.highRiskCount += 1;
    if (row.riskLevel !== "观察") acc.issueProductCount += 1;
    return acc;
  }, {
    returnCount: 0,
    returnOrders: 0,
    salesVolume: 0,
    reviewCount: 0,
    lowStarReviewCount: 0,
    pendingReviewCount: 0,
    voiceRiskCount: 0,
    highRiskCount: 0,
    issueProductCount: 0,
  });
}

function sourceSummary(returnRows, reviewRows, voiceRows) {
  const lowStar = reviewRows.filter((item) => numberValue(item.last_star) > 0 && numberValue(item.last_star) <= 3).length;
  const pending = reviewRows.filter((item) => Number(item.status) !== 2).length;
  const voiceRisk = voiceRows.filter((item) => {
    const ncxRate = percentDecimal(item.ncx_rate);
    return ncxRate >= 0.03 || /极差|不合格|差|Poor|At_Risk|Yes/i.test(`${item.pcx_health_text || ""} ${item.returnBadge || ""}`);
  }).length;
  return [
    {
      key: "returns",
      title: "退货分析",
      count: returnRows.length,
      primary: `${returnRows.reduce((sum, item) => sum + numberValue(item.curReturnGoodsCount), 0)} 件退货`,
      secondary: "按 MSKU 统计退货量、销量、退货率和 Top NCX Reason",
    },
    {
      key: "reviews",
      title: "Review",
      count: reviewRows.length,
      primary: `${lowStar} 条 1-3星`,
      secondary: `${pending} 条未完成处理，按评价时间拉取`,
    },
    {
      key: "voice",
      title: "买家之声",
      count: voiceRows.length,
      primary: `${voiceRisk} 个风险项`,
      secondary: "按 NCX 不满意率、满意度状态和退货标记识别",
    },
  ];
}

function looksLikeAsin(value) {
  return /^B[0-9A-Z]{9}$/i.test(String(value || "").trim());
}

export async function getAftersalesDashboard(filters = {}) {
  const range = normalizeRange(filters);
  const keyword = String(filters.keyword || "").trim();
  const adapter = getLingxingAdapter();

  if (!adapter.isConfigured()) {
    return {
      ok: false,
      rows: [],
      sourceSummary: [],
      kpis: {},
      meta: {
        source: "接口未连接",
        syncStatus: "缺少领星 LINGXING_APP_KEY / LINGXING_APP_SECRET，无法读取售后数据。",
        ...range,
      },
    };
  }

  let sellersPayload = null;
  try {
    sellersPayload = await adapter.fetchSellers();
  } catch (error) {
    return {
      ok: false,
      rows: [],
      sourceSummary: sourceSummary([], [], []),
      kpis: {},
      rawCounts: { returns: 0, reviews: 0, voice: 0 },
      meta: {
        source: "领星 ERP · 退货分析 + Review + 买家之声",
        syncStatus: `店铺列表读取失败：${readableError(error)}`,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        storeCount: 0,
        ...range,
      },
    };
  }
  const sellers = filterCoreSellers(sellersPayload.data || []);
  const { sids, sidsText } = sellerParams(sellers);
  const combined = new Map();
  const dataWarnings = [];

  const returnParams = {
    startDate: range.startDate,
    endDate: range.endDate,
    asinType: "msku",
    dateType: Number(filters.dateType || 0),
    storeId: sids,
  };
  const reviewParams = {
    start_date: range.startDate,
    end_date: range.endDate,
    date_field: filters.reviewDateField || "review_time",
    sids: sidsText,
  };
  const voiceParams = {
    sids,
  };

  if (keyword) {
    returnParams.searchField = looksLikeAsin(keyword) ? "asin" : "msku";
    returnParams.searchValue = [keyword];
    if (looksLikeAsin(keyword)) {
      reviewParams.search_field = "asin";
      reviewParams.search_value = keyword;
    }
    voiceParams.search_field = "msku";
    voiceParams.search_value = [keyword];
  }

  const [returnsResult, reviewsResult, voiceResult] = await Promise.allSettled([
    fetchReturnAnalysisPaged(adapter, returnParams),
    fetchPaged((params) => adapter.fetchReviewV2(params), reviewParams, { maxPages: 5, length: 200 }),
    fetchPaged((params) => adapter.fetchVoiceOfBuyer(params), voiceParams, { maxPages: 5, length: 200 }),
  ]);

  const returnRows = returnsResult.status === "fulfilled" ? returnsResult.value.rows : [];
  const reviewRows = reviewsResult.status === "fulfilled" ? reviewsResult.value.rows : [];
  const voiceRows = voiceResult.status === "fulfilled" ? voiceResult.value.rows : [];

  if (returnsResult.status === "rejected") dataWarnings.push(`退货分析读取失败：${readableError(returnsResult.reason)}`);
  if (reviewsResult.status === "rejected") dataWarnings.push(`Review读取失败：${readableError(reviewsResult.reason)}`);
  if (voiceResult.status === "rejected") dataWarnings.push(`买家之声读取失败：${readableError(voiceResult.reason)}`);

  returnRows.forEach((item) => applyReturnRow(combined, item));
  reviewRows.forEach((item) => applyReviewRow(combined, item));
  voiceRows.forEach((item) => applyVoiceRow(combined, item));

  const rows = [...combined.values()]
    .map((row) => {
      const score = riskScore(row);
      return {
        ...row,
        riskScore: score,
        riskLevel: riskLevel({ ...row, riskScore: score }),
        action: actionText(row),
        signals: [...new Set(row.signals)].slice(0, 6),
      };
    })
    .filter((row) => {
      if (!keyword) return true;
      const text = [row.msku, row.asin, row.localSku, row.localName, row.storeName, row.title].join(" ").toLowerCase();
      return text.includes(keyword.toLowerCase());
    })
    .sort((a, b) => b.riskScore - a.riskScore || b.returnCount - a.returnCount || b.lowStarReviewCount - a.lowStarReviewCount)
    .slice(0, 200);

  const kpis = summarizeRows(rows);
  kpis.returnRate = kpis.salesVolume ? kpis.returnCount / kpis.salesVolume : 0;
  kpis.lowStarRate = kpis.reviewCount ? kpis.lowStarReviewCount / kpis.reviewCount : 0;

  return {
    ok: dataWarnings.length < 3,
    kpis,
    rows,
    sourceSummary: sourceSummary(returnRows, reviewRows, voiceRows),
    rawCounts: {
      returns: returnRows.length,
      reviews: reviewRows.length,
      voice: voiceRows.length,
    },
    meta: {
      source: "领星 ERP · 退货分析 + Review + 买家之声",
      syncStatus: dataWarnings.length ? dataWarnings.join("；") : "已读取三源售后数据",
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      storeCount: sellers.length,
      ...range,
    },
  };
}

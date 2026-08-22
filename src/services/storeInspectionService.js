import path from "node:path";
import { getConfig } from "../config/index.js";
import { filterCoreSellers, getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { sendDingTalkMarkdown, sendDingTalkText } from "./dingtalkService.js";
import { getAftersalesMailInspectionSummary } from "./aftersalesMailService.js";
import { getLowInventoryFeeDashboard } from "./lowInventoryFeeService.js";
import { readLingxingSellersCache, saveLingxingSellersCache } from "../utils/cacheStore.js";
import {
  JsonStoreError,
  getJsonStoreCommitUncertainty,
  readJson,
  reconcileJsonStoreCommit,
  writeJsonAtomic,
} from "../utils/jsonStore.js";

const cacheFile = path.join(process.cwd(), "data-cache", "store-inspection-latest.json");
const historyFile = path.join(process.cwd(), "data-cache", "store-inspection-history.json");
const stateFile = path.join(process.cwd(), "data-cache", "store-inspection-state.json");
const settingsFile = path.join(process.cwd(), "data-cache", "store-inspection-settings.json");
const erpBuyerMessageStatusFile = path.join(process.cwd(), "data-cache", "erp-buyer-message-status.json");
const historyLimit = 30;
const inspectionStateVersion = 1;
const inspectionStateMissing = Symbol("store-inspection-state-missing");
const schedulerPollMs = 30 * 1000;
const scheduleTimeZone = "Asia/Shanghai";
const defaultSellerFeedbackEndpoint = "/erp/sc/cs/feedback/listMws";
const sellerFeedbackReportEndpoint = "/erp/sc/cs/feedbackReport/lists";
const storePerformanceEndpoint = "/basicOpen/customerService/storeTarget/list";
const state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastStatus: "等待首次自动巡检",
  lastError: null,
  lastErrorCode: null,
  lastCommitState: null,
  lastRequiresReconciliation: null,
  lastRetryable: null,
};

let timer = null;

function invalidJsonShape(filePath, expected) {
  return new JsonStoreError(`JSON schema invalid: ${filePath}`, {
    code: "JSON_SCHEMA_INVALID",
    filePath,
    expected,
  });
}

function requireJsonRecord(value, filePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidJsonShape(filePath, "object");
  return value;
}

function requireJsonArray(value, filePath) {
  if (!Array.isArray(value)) throw invalidJsonShape(filePath, "array");
  return value;
}

function requireInspectionState(value, filePath) {
  if (value === inspectionStateMissing) return value;
  const state = requireJsonRecord(value, filePath);
  if (state.version !== inspectionStateVersion) throw invalidJsonShape(filePath, `object(version=${inspectionStateVersion})`);
  return {
    version: inspectionStateVersion,
    latest: state.latest === null ? null : requireJsonRecord(state.latest, filePath),
    history: requireJsonArray(state.history, filePath),
  };
}

function logPersistenceFailure(operation, filePath, error) {
  console.error("[store-inspection-persistence]", {
    operation,
    filePath,
    code: error?.code || "UNKNOWN",
    errorName: error?.name || "Error",
    commitState: error?.commitState || "not-committed",
    targetMayContainNewValue: error?.targetMayContainNewValue === true,
    requiresReconciliation: error?.requiresReconciliation === true,
    markerPersisted: error?.markerPersisted === true,
    markerPersistenceErrorCode: error?.markerPersistenceErrorCode,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
  });
}

async function readInspectionJson(filePath, fallback, operation, validator = null) {
  try {
    const value = await readJson(filePath, fallback);
    return validator ? validator(value, filePath) : value;
  } catch (error) {
    logPersistenceFailure(operation, filePath, error);
    throw error;
  }
}

async function writeInspectionJson(filePath, value, operation) {
  try {
    return await writeJsonAtomic(filePath, value);
  } catch (error) {
    logPersistenceFailure(operation, filePath, error);
    throw error;
  }
}

async function readLegacyInspectionHistory() {
  return readInspectionJson(historyFile, [], "read-history", requireJsonArray);
}

async function readLegacyLatestInspection() {
  return readInspectionJson(cacheFile, null, "read-latest", (value, filePath) => (
    value === null ? null : requireJsonRecord(value, filePath)
  ));
}

async function readStoreInspectionState() {
  const stored = await readInspectionJson(stateFile, inspectionStateMissing, "read-state", requireInspectionState);
  if (stored !== inspectionStateMissing) return stored;
  const [latest, history] = await Promise.all([readLegacyLatestInspection(), readLegacyInspectionHistory()]);
  return { version: inspectionStateVersion, latest, history };
}

function normalizeScheduleTime(value, fallback = "08:30") {
  const time = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
}

function scheduleClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: scheduleTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function nextScheduleText(settings, date = new Date()) {
  if (!settings.enabled) return "已关闭";
  const clock = scheduleClock(date);
  const scheduledToday = new Date(`${clock.date}T${settings.sendTime}:00+08:00`);
  const next = date < scheduledToday ? scheduledToday : new Date(scheduledToday.getTime() + 24 * 60 * 60 * 1000);
  const nextClock = scheduleClock(next);
  return `${nextClock.date} ${settings.sendTime}`;
}

async function readStoreInspectionSettings() {
  const config = getConfig().storeInspection;
  const defaults = {
    enabled: config.enabled !== false,
    sendTime: normalizeScheduleTime(config.sendTime),
    timezone: scheduleTimeZone,
    lastRunDate: "",
    lastRunAt: "",
    updatedAt: "",
  };
  const saved = await readInspectionJson(settingsFile, defaults, "read-settings", requireJsonRecord);
  return {
    ...defaults,
    ...saved,
    enabled: saved.enabled !== false,
    sendTime: normalizeScheduleTime(saved.sendTime, defaults.sendTime),
    timezone: scheduleTimeZone,
  };
}

async function saveStoreInspectionSettings(settings) {
  return writeInspectionJson(settingsFile, settings, "write-settings");
}

async function readErpBuyerMessageStatuses() {
  return readInspectionJson(erpBuyerMessageStatusFile, {}, "read-erp-buyer-message-status", requireJsonRecord);
}

async function writeErpBuyerMessageStatuses(statuses) {
  return writeInspectionJson(erpBuyerMessageStatusFile, statuses, "write-erp-buyer-message-status");
}

export async function getStoreInspectionSettings() {
  const settings = await readStoreInspectionSettings();
  return {
    ...settings,
    nextRunAt: nextScheduleText(settings),
  };
}

export async function updateStoreInspectionSettings(payload = {}) {
  const current = await readStoreInspectionSettings();
  const sendTime = normalizeScheduleTime(payload.sendTime, "");
  if (!sendTime) throw new Error("发送时间格式必须为 HH:mm。");
  const settings = await saveStoreInspectionSettings({
    ...current,
    enabled: payload.enabled !== false,
    sendTime,
    timezone: scheduleTimeZone,
    updatedAt: nowText(),
  });
  state.lastStatus = settings.enabled ? `自动巡检已开启，每日 ${settings.sendTime} 发送` : "店铺自动巡检已关闭";
  return {
    ...settings,
    nextRunAt: nextScheduleText(settings),
  };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function textValue(item, keys = []) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function firstText(value) {
  return asArray(value).map((item) => String(item ?? "").trim()).find(Boolean) || "";
}

function payloadRows(payload) {
  const records = payload?.data?.records || payload?.data?.list || payload?.data?.rows || payload?.data?.data || payload?.records || payload?.list || payload?.data;
  return Array.isArray(records) ? records : [];
}

async function fetchPaged(call, baseParams = {}, { maxPages = 5, length = 200 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await call({ ...baseParams, offset: page * length, length });
    const pageRows = payloadRows(payload);
    rows.push(...pageRows);
    const total = Number(payload?.data?.total ?? payload?.total ?? rows.length) || rows.length;
    if (pageRows.length < length || rows.length >= total) break;
  }
  return rows;
}

function normalizeRange(config = getConfig()) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Number(config.storeInspection.lookbackDays || 1)) + 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

function normalizeBuyerMessageRange(config = getConfig()) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Number(config.lingxing?.buyerMessageRecentDays || 2)) + 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

function sellerSid(seller) {
  return Number(seller?.sid || seller?.seller_id || seller?.sellerId || seller?.id || seller?.store_id || seller?.storeId) || 0;
}

function sellerName(seller) {
  return textValue(seller, ["name", "seller_name", "shop_name", "store_name", "account_name"]) || `SID ${sellerSid(seller)}`;
}

function sellerCountry(seller) {
  return textValue(seller, ["country", "countryName", "country_name", "marketplace", "marketplaceName", "country_code", "countryCode"]) || "-";
}

function sellerMap(sellers) {
  return new Map(sellers.map((seller) => [sellerSid(seller), {
    sid: sellerSid(seller),
    name: sellerName(seller),
    country: sellerCountry(seller),
  }]));
}

async function getSellers(adapter) {
  const cached = await readLingxingSellersCache();
  let sellers = filterCoreSellers(cached.sellers || []);
  if (sellers.length) return sellers;
  const payload = await adapter.fetchSellers();
  sellers = filterCoreSellers(payloadRows(payload));
  if (sellers.length) await saveLingxingSellersCache(sellers);
  return sellers;
}

function lowFeedbackRow(row) {
  const rating = numberValue(textValue(row, ["rating", "star", "stars", "feedback_rating", "score", "last_star"]));
  return rating > 0 && rating < 4;
}

function feedbackSummary(row, fallbackType = "feedback") {
  const rating = numberValue(textValue(row, ["rating", "star", "stars", "feedback_rating", "score", "last_star"]));
  const product = Array.isArray(row?.productList) ? row.productList[0] : null;
  const status = textValue(row, ["status", "feedback_status", "deal_status"]);
  const statusMap = { 0: "待处理", 1: "处理中", 2: "已处理" };
  return {
    type: fallbackType,
    storeName: textValue(row, ["_storeName", "seller_name", "shop_name", "store_name", "account_name", "storeName"]) || "-",
    asin: textValue(row, ["asin", "parent_asin", "child_asin"]) || textValue(product, ["asin"]) || "-",
    msku: textValue(row, ["msku", "seller_sku", "sku"]) || textValue(product, ["msku", "seller_sku", "sku"]) || "-",
    rating: rating || "-",
    content: textValue(row, ["feedback_content", "content", "feedback", "review_content", "comment", "body", "title"]) || "低星 feedback",
    createdAt: textValue(row, ["feedback_date", "feedback_time", "review_time", "review_date", "created_at", "date"]) || "-",
    status: status || "-",
    statusLabel: statusMap[status] || status || "-",
  };
}

function reviewSummary(row) {
  const rating = numberValue(row?.last_star ?? row?.star ?? row?.rating);
  const title = textValue(row, ["last_title", "title"]) || "新增 review";
  const content = textValue(row, ["last_content", "review_content", "content"]);
  return {
    type: "review",
    storeName: firstText(row?.seller_name) || "-",
    asin: textValue(row, ["asin", "parent_asin"]) || firstText(row?.parent_asin) || "-",
    msku: textValue(row, ["msku", "seller_sku", "local_sku", "sku"]) || firstText(row?.seller_sku) || firstText(row?.local_sku) || "-",
    rating: rating || "-",
    title,
    content: content ? `${title}：${content}` : title,
    createdAt: textValue(row, ["review_date", "create_time", "update_time"]) || "-",
    reviewId: textValue(row, ["review_id"]) || "-",
  };
}

function voiceHealthValue(row) {
  const raw = row?.pxc_health ?? row?.pcx_health ?? row?.pxcHealth ?? row?.pcxHealth;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") return numberValue(raw);
  const text = textValue(row, ["pcx_health_text", "pxc_health_text", "health_text"]);
  const map = { 极差: 0, 不合格: 1, 一般: 2, 良好: 3, 极好: 4 };
  return map[text] ?? 4;
}

function riskyVoiceRow(row) {
  const health = voiceHealthValue(row);
  const returnBadge = textValue(row, ["returnBadge", "return_badge"]).toLowerCase();
  const listingExists = row?.listing_exists;
  return health <= 2 || returnBadge === "at_risk" || listingExists === true || listingExists === "true";
}

function voiceSummary(row) {
  const healthText = textValue(row, ["pcx_health_text", "pxc_health_text"]) || String(voiceHealthValue(row));
  const reason = textValue(row, ["most_common_return_reason_bucket", "returnReason", "return_reason"]);
  const ncxRate = textValue(row, ["ncx_rate", "ncxRate"]);
  const ncxCount = textValue(row, ["ncx_count", "ncxCount"]);
  return {
    type: "voiceOfBuyer",
    storeName: textValue(row, ["seller_name", "store_name"]) || "-",
    asin: textValue(row, ["asin"]) || "-",
    msku: textValue(row, ["msku", "sku"]) || "-",
    rating: healthText,
    content: [reason ? `退货原因 ${reason}` : "", ncxRate ? `NCX ${ncxRate}` : "", ncxCount ? `不满意订单 ${ncxCount}` : ""].filter(Boolean).join("；") || "买家之声异常",
    createdAt: textValue(row, ["event_date", "last_action_date"]) || "-",
  };
}

function accountHealthIssue(row) {
  const policyCount = numberValue(row?.commodity_policy_compliance);
  const ahrStatus = textValue(row, ["ahr_status", "ahrStatus"]).toUpperCase();
  const ahrScore = numberValue(row?.ahr_score ?? row?.ahrScore);
  return policyCount > 0 || (ahrStatus && !["GREAT", "HEALTHY", "GOOD", "正常"].includes(ahrStatus)) || (ahrScore > 0 && ahrScore < 200);
}

function accountHealthSummary(row, storesBySid) {
  const sid = numberValue(row?.sid);
  const store = storesBySid.get(sid);
  const policyCount = numberValue(row?.commodity_policy_compliance);
  const score = textValue(row, ["ahr_score", "ahrScore"]) || "-";
  const status = textValue(row, ["ahr_status", "ahrStatus"]) || "-";
  return {
    type: "accountHealth",
    storeName: store?.name || `SID ${sid}`,
    asin: "-",
    rating: `${score} / ${status}`,
    content: policyCount > 0 ? `商品政策合规性 ${policyCount} 项` : `Account Health ${status}`,
    createdAt: textValue(row, ["pull_date", "update_date"]) || "-",
    policyCount,
    score,
    status,
  };
}

function feedbackPending(row) {
  const raw = textValue(row, ["status", "feedback_status", "deal_status"]);
  if (!raw) return true;
  const status = Number(raw);
  if (Number.isFinite(status)) return status !== 2;
  return !["已处理", "已完成", "done", "resolved", "closed"].includes(raw.toLowerCase());
}

function sameStoreName(left = "", right = "") {
  return String(left || "-").trim() === String(right || "-").trim();
}

function normalizeReportText(value) {
  return String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
}

function reportCount(value) {
  const count = Number(value) || 0;
  return count > 0 ? `<strong><font color="#d31510">${count}</font></strong>` : String(count);
}

function reportRowIdentity(row = {}, keys = []) {
  const values = keys.map((key) => normalizeReportText(row[key]).toLowerCase());
  return values.join("|");
}

function newRowsSincePrevious(rows = [], previousRows = [], keys = []) {
  const previousKeys = new Set(previousRows.map((row) => reportRowIdentity(row, keys)));
  return rows.filter((row) => !previousKeys.has(reportRowIdentity(row, keys)));
}

function erpBuyerMessageSummary(row) {
  const subject = textValue(row, ["subject", "title", "mail_subject", "message_subject", "msg_subject"]) || "ERP 售后邮件";
  const content = textValue(row, ["content", "message", "body", "mail_content", "message_content", "msg_content", "last_message"]) || subject;
  const createdAt = textValue(row, ["createdAt", "created_at", "create_time", "createTime", "send_time", "sendTime", "mail_time", "date", "time"]) || "-";
  const from = textValue(row, ["from", "fromName", "from_name", "buyer_name", "buyerName", "customer_name", "customerName", "from_address", "email"]) || "-";
  const replied = row._replyStatus === "replied" || row.replyStatus === "replied";
  return {
    source: "ERP 售后邮件",
    storeName: textValue(row, ["_mappedStoreName", "storeName", "store_name", "seller_name", "shop_name", "account_name", "sellerName", "to_address", "_sourceEmail"]) || "-",
    messageId: textValue(row, ["messageId", "message_id", "webmail_uuid", "webmailUuid", "mail_id", "msg_id", "id", "mid", "uid"]) || reportRowIdentity(row, ["subject", "title", "content", "message", "created_at", "create_time"]),
    type: "新邮件",
    item: subject,
    subject,
    from,
    detail: `${from} · ${normalizeReportText(content).slice(0, 160)}`,
    content: normalizeReportText(content),
    createdAt,
    replyStatus: replied ? "replied" : "pending",
    replyStatusLabel: replied ? "已匹配网易已发送回复" : "待回复",
    replySentAt: row._replySentAt || "",
    level: replied ? "低" : "高",
    action: replied ? "无需提醒" : "进入 ERP 售后邮件查看并回复",
  };
}

function erpBuyerMessageRawId(row = {}) {
  return textValue(row, ["messageId", "message_id", "webmail_uuid", "webmailUuid", "mail_id", "msg_id", "id", "mid", "uid"]);
}

function normalizeEmailText(value = "") {
  const text = String(value || "").trim().toLowerCase();
  return text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || text;
}

function defaultBuyerMessageEmailStoreMap() {
  return {
    "joimew@163.com": "xiamentanjia-US",
    "mxndrl@163.com": "tandanbo-US",
  };
}

function marketplaceCountryHint(row = {}) {
  const text = `${row.from_address || ""} ${row.fromAddress || ""} ${row.subject || ""} ${row.to_address || ""}`.toLowerCase();
  if (text.includes("amazon.com.au") || text.includes(".com.au")) return "AU";
  if (text.includes("amazon.ca") || text.includes(".ca")) return "CA";
  if (text.includes("amazon.de") || text.includes(".de")) return "DE";
  return "US";
}

function inferStoreFromBuyerMessage(row = {}, email = "", mappedStore = "") {
  const country = marketplaceCountryHint(row);
  if (email === "joimew@163.com") {
    if (country === "AU") return "xiamentanjia-AU";
    if (country === "CA") return "xiamentanjia-CA";
    if (country === "DE") return "tanjia-eu-DE";
    return "xiamentanjia-US";
  }
  if (email === "mxndrl@163.com") {
    if (country === "AU") return "tandanbo-AU";
    if (country === "CA") return "tandanbo-CA";
    return "tandanbo-US";
  }
  return mappedStore;
}

function applyErpBuyerMessageStoreMap(rows = [], config = getConfig()) {
  const storeMap = {
    ...defaultBuyerMessageEmailStoreMap(),
    ...(config.lingxing?.buyerMessageEmailStoreMap || {}),
  };
  return rows.map((row) => {
    const email = normalizeEmailText(row.to_address || row.toAddress || row._sourceEmail || row.to_address_all);
    const storeName = inferStoreFromBuyerMessage(row, email, storeMap[email]);
    return storeName ? { ...row, _mappedStoreName: storeName } : row;
  });
}

function applyErpBuyerMessageManualStatuses(rows = [], statuses = {}) {
  return rows.map((row) => {
    const messageId = erpBuyerMessageRawId(row);
    const manual = messageId ? statuses[messageId] : null;
    if (manual?.status !== "replied") return row;
    return {
      ...row,
      _replyStatus: "replied",
      _replySource: "manual",
      _replySentAt: manual.updatedAt || "",
      _replySubject: manual.note || "手动标记已回复",
      _replyMailbox: manual.operator || "BI",
      _manualStatus: manual,
    };
  });
}

function datePart(value) {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function erpBuyerMessageDate(row = {}) {
  return datePart(textValue(row, ["createdAt", "created_at", "create_time", "createTime", "send_time", "sendTime", "mail_time", "date", "time"]));
}

function isErpBuyerStationMessage(row = {}) {
  const type = String(row.type ?? "").trim();
  if (type === "1") return true;
  const fromAddress = textValue(row, ["from_address", "fromAddress", "from", "email"]).toLowerCase();
  const subject = textValue(row, ["subject", "title", "mail_subject", "message_subject", "msg_subject"]).toLowerCase();
  return /@marketplace\.amazon\./i.test(fromAddress)
    || /product details inquiry from amazon customer/i.test(subject)
    || /inquiry from amazon customer/i.test(subject)
    || /message from amazon customer/i.test(subject);
}

function filterErpBuyerMessages(rows = [], options = {}) {
  return rows.filter((row) => {
    if (options.stationMessagesOnly && !isErpBuyerStationMessage(row)) return false;
    if (options.startDate) {
      const rowDate = erpBuyerMessageDate(row);
      if (rowDate && rowDate < options.startDate) return false;
    }
    if (options.endDate) {
      const rowDate = erpBuyerMessageDate(row);
      if (rowDate && rowDate > options.endDate) return false;
    }
    return true;
  });
}

export function buildErpBuyerMessagesInspectionSummary(rows = [], previousRows = [], options = {}) {
  const filteredRows = filterErpBuyerMessages(rows, options);
  const normalizedRows = filteredRows.map(erpBuyerMessageSummary).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const currentMode = options.mode === "current";
  const repliedCount = normalizedRows.filter((row) => row.replyStatus === "replied").length;
  const pendingRows = options.excludeReplied ? normalizedRows.filter((row) => row.replyStatus !== "replied") : normalizedRows;
  const newRows = currentMode
    ? pendingRows
    : newRowsSincePrevious(pendingRows, previousRows, ["storeName", "messageId", "from", "subject", "createdAt", "content"]);
  const recentDays = Math.max(1, Number(options.recentDays || 2));
  const foundText = currentMode && options.stationMessagesOnly
    ? options.excludeReplied
      ? `近 ${recentDays || 2} 天发现 ${normalizedRows.length} 封亚马逊站内信，${repliedCount ? `${repliedCount} 封已匹配网易已发送回复，` : ""}待处理 ${newRows.length} 封。`
      : `近 ${recentDays || 2} 天新增 ${newRows.length} 封亚马逊站内信。`
    : `新增 ${newRows.length} 封 ERP 售后邮件，需及时处理。`;
  const cleanText = currentMode && options.stationMessagesOnly
    ? options.excludeReplied && normalizedRows.length
      ? `近 ${recentDays || 2} 天发现 ${normalizedRows.length} 封亚马逊站内信，均已匹配回复。`
      : `近 ${recentDays || 2} 天未发现新增亚马逊站内信。`
    : `未发现新增 ERP 售后邮件，当前读取 ${normalizedRows.length} 封。`;
  return {
    key: "erpBuyerMessages",
    label: "ERP 售后邮件",
    status: newRows.length ? "risk" : "ok",
    tone: newRows.length ? "warning" : "success",
    count: newRows.length,
    total: normalizedRows.length,
    repliedCount,
    detail: newRows.length
      ? foundText
      : cleanText,
    rows: newRows.slice(0, 20),
    snapshotRows: normalizedRows,
    source: "ERP 售后邮件",
  };
}

function configuredBuyerMessageEmails(config = getConfig()) {
  const emails = Array.isArray(config.lingxing?.buyerMessageEmails) ? config.lingxing.buyerMessageEmails : [];
  return [...new Set([
    ...emails,
    config.lingxing?.buyerMessageEmail,
  ].map((email) => String(email || "").trim()).filter(Boolean))];
}

export function buildErpBuyerMessagesRequestParams(config = getConfig(), range = normalizeRange(config)) {
  const email = configuredBuyerMessageEmails(config)[0] || "";
  return {
    flag: config.lingxing?.buyerMessageFlag || "receive",
    email,
    start_date: range.startDate,
    end_date: range.endDate,
  };
}

export function buildErpBuyerMessagesRequestParamsList(config = getConfig(), range = normalizeRange(config)) {
  return configuredBuyerMessageEmails(config).map((email) => ({
    flag: config.lingxing?.buyerMessageFlag || "receive",
    email,
    start_date: range.startDate,
    end_date: range.endDate,
  }));
}

function feedbackStoreStats(stores, rows, lowRows) {
  return stores.map((store) => {
    const storeRows = rows.filter((row) => Number(row?._sid) === Number(store.sid) || sameStoreName(row?._storeName, store.name));
    const storeLowRows = lowRows.filter((row) => sameStoreName(row.storeName, store.name));
    return {
      storeName: store.name,
      total: storeRows.length,
      lowCount: storeLowRows.length,
      pendingCount: storeRows.filter(feedbackPending).length,
    };
  });
}

function reconcileDeletedFeedback(stores, lowRows, reportRows) {
  const reportByStore = new Map(reportRows.map((row) => [textValue(row, ["seller_name", "store_name"]), row]));
  const activeRows = [];
  const storeStats = stores.map((store) => {
    const storeLowRows = lowRows
      .filter((row) => sameStoreName(row.storeName, store.name))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const report = reportByStore.get(store.name);
    const removedCount = Math.min(storeLowRows.length, numberValue(report?.modified_num));
    const activeLowCount = Math.max(storeLowRows.length - removedCount, 0);
    const storeActiveRows = storeLowRows.slice(0, activeLowCount);
    activeRows.push(...storeActiveRows);
    return {
      storeName: store.name,
      total: numberValue(report?.feedback_num),
      lowCount: activeLowCount,
      pendingCount: storeActiveRows.filter(feedbackPending).length,
      removedCount,
    };
  });
  return {
    activeRows,
    storeStats,
    removedCount: storeStats.reduce((sum, item) => sum + item.removedCount, 0),
  };
}

function reviewStoreStats(stores, rows, lowRows) {
  return stores.map((store) => {
    const storeRows = rows.filter((row) => sameStoreName(firstText(row?.seller_name), store.name));
    const storeLowRows = lowRows.filter((row) => sameStoreName(row.storeName, store.name));
    return {
      storeName: store.name,
      total: storeRows.length,
      lowCount: storeLowRows.length,
    };
  });
}

async function inspectFeedback(adapter, sellers, range, config) {
  const endpoint = config.lingxing.sellerFeedbackEndpoint || defaultSellerFeedbackEndpoint;
  const stores = sellers
    .map((seller) => ({ sid: sellerSid(seller), name: sellerName(seller), country: sellerCountry(seller) }))
    .filter((seller) => seller.sid);
  if (!stores.length) {
    return {
      key: "feedback",
      label: "feedback",
      status: "unavailable",
      tone: "warning",
      count: 0,
      detail: "未读取到可巡检的店铺 sid，无法检查 feedback。",
      rows: [],
      source: "seller feedback",
    };
  }

  const rows = [];
  const errors = [];
  let reportRows = [];
  try {
    reportRows = await fetchPaged((params) => adapter.fetchCustomOpenApi(sellerFeedbackReportEndpoint, params), {
      start_date: range.startDate,
      end_date: range.endDate,
    }, { maxPages: 5, length: 200 });
  } catch (error) {
    errors.push(`feedback 统计：${error.message}`);
  }
  for (const store of stores) {
    try {
      const storeRows = await fetchPaged((params) => adapter.fetchCustomOpenApi(endpoint, params), {
        start_date: range.startDate,
        end_date: range.endDate,
        sid: store.sid,
      }, { maxPages: 10, length: 200 });
      rows.push(...storeRows.map((row) => ({
        ...row,
        _sid: store.sid,
        _storeName: textValue(row, ["seller_name", "shop_name", "store_name", "account_name", "storeName"]) || store.name,
        _storeCountry: textValue(row, ["country"]) || store.country,
      })));
    } catch (error) {
      errors.push(`${store.name}(SID ${store.sid})：${error.message}`);
    }
  }

  if (!rows.length && errors.length) {
    return {
      key: "feedback",
      label: "feedback",
      status: "error",
      tone: "danger",
      count: 0,
      detail: `feedback 接口读取失败：${errors.slice(0, 3).join("；")}`,
      rows: [],
      source: "seller feedback",
      errors,
    };
  }

  const lowRows = rows.filter(lowFeedbackRow).map((row) => feedbackSummary(row, "feedback"));
  const reconciled = reportRows.length
    ? reconcileDeletedFeedback(stores, lowRows, reportRows)
    : {
        activeRows: lowRows,
        storeStats: feedbackStoreStats(stores, rows, lowRows),
        removedCount: 0,
      };
  const activeRows = reconciled.activeRows;
  const removedText = reconciled.removedCount ? `；已排除 ${reconciled.removedCount} 条已删 feedback` : "";
  const partialText = errors.length ? `；${errors.length} 个店铺读取失败，需复核接口权限或店铺授权` : "";
  return {
    key: "feedback",
    label: "feedback",
    status: activeRows.length ? "risk" : errors.length ? "warning" : "ok",
    tone: activeRows.length ? "danger" : errors.length ? "warning" : "success",
    count: activeRows.length,
    total: rows.length,
    pendingCount: activeRows.filter(feedbackPending).length,
    removedCount: reconciled.removedCount,
    detail: activeRows.length
      ? `发现 ${activeRows.length} 条 4 星以下 feedback${removedText}${partialText}。`
      : `未发现待处理的 4 星以下 feedback${removedText}${partialText}。`,
    rows: activeRows.slice(0, 20),
    storeStats: reconciled.storeStats,
    source: "seller feedback",
    errors,
  };
}

async function inspectReview(adapter, sellers, range) {
  const sids = sellers.map(sellerSid).filter(Boolean).join(",");
  if (!sids) {
    return { key: "review", label: "review", status: "unavailable", tone: "warning", count: 0, lowCount: 0, detail: "未读取到可巡检的店铺 sid，无法检查 review。", rows: [], source: "review" };
  }
  const rows = await fetchPaged((params) => adapter.fetchReviewV2(params), {
    start_date: range.startDate,
    end_date: range.endDate,
    date_field: "review_time",
    sids,
  }, { maxPages: 10, length: 200 });
  const lowRows = rows.filter((row) => {
    const star = numberValue(row?.last_star ?? row?.star ?? row?.rating);
    return star > 0 && star < 4;
  }).map(reviewSummary);
  return {
    key: "review",
    label: "review",
    status: lowRows.length ? "risk" : "ok",
    tone: lowRows.length ? "danger" : "success",
    count: rows.length,
    lowCount: lowRows.length,
    detail: lowRows.length ? `新增 ${rows.length} 条 review，其中 ${lowRows.length} 条 4 星以下。` : `新增 ${rows.length} 条 review，未发现 4 星以下。`,
    rows: lowRows.slice(0, 20),
    storeStats: reviewStoreStats(sellers.map((seller) => ({ sid: sellerSid(seller), name: sellerName(seller) })), rows, lowRows),
    source: "review",
  };
}

async function inspectVoiceOfBuyer(adapter, sellers) {
  const sids = sellers.map(sellerSid).filter(Boolean);
  if (!sids.length) {
    return { key: "voiceOfBuyer", label: "买家之声", status: "unavailable", tone: "warning", count: 0, total: 0, detail: "未读取到可巡检的店铺 sid，无法检查买家之声。", rows: [], source: "voice of buyer" };
  }
  const rows = await fetchPaged((params) => adapter.fetchVoiceOfBuyer(params), { sids }, { maxPages: 10, length: 200 });
  const riskyRows = rows.filter(riskyVoiceRow).map(voiceSummary);
  return {
    key: "voiceOfBuyer",
    label: "买家之声",
    status: riskyRows.length ? "risk" : "ok",
    tone: riskyRows.length ? "danger" : "success",
    count: riskyRows.length,
    total: rows.length,
    detail: riskyRows.length ? `发现 ${riskyRows.length} 条买家之声异常。` : `未发现买家之声异常，当前读取 ${rows.length} 条。`,
    rows: riskyRows.slice(0, 20),
    source: "voice of buyer",
  };
}

async function inspectAccountHealth(adapter, sellers) {
  const storesBySid = sellerMap(sellers);
  const sids = [...storesBySid.keys()].filter(Boolean).join(",");
  if (!sids) {
    return { key: "accountHealth", label: "Performance - Account Health", status: "unavailable", tone: "warning", count: 0, total: 0, detail: "未读取到可巡检的店铺 sid，无法检查 Account Health。", rows: [], source: "store performance" };
  }
  const rows = await fetchPaged((params) => adapter.fetchCustomOpenApi(storePerformanceEndpoint, params), { sids }, { maxPages: 5, length: 200 });
  const accountSummaries = rows.map((row) => ({ raw: row, summary: accountHealthSummary(row, storesBySid) }));
  const issueRows = accountSummaries.filter((item) => accountHealthIssue(item.raw)).map((item) => item.summary);
  const storeStats = [...storesBySid.values()].map((store) => {
    const summary = accountSummaries.find((item) => sameStoreName(item.summary.storeName, store.name))?.summary;
    return {
      storeName: store.name,
      policyCount: summary?.policyCount || 0,
      score: summary?.score || "-",
      status: summary?.status || "-",
    };
  });
  const minScore = rows.reduce((min, row) => {
    const score = numberValue(row?.ahr_score ?? row?.ahrScore);
    return score > 0 ? Math.min(min, score) : min;
  }, Infinity);
  const scoreText = Number.isFinite(minScore) ? `最低 AHR ${minScore}` : "未读取到 AHR 分数";
  return {
    key: "accountHealth",
    label: "Performance - Account Health",
    status: issueRows.length ? "risk" : "ok",
    tone: issueRows.length ? "danger" : "success",
    count: issueRows.length,
    total: rows.length,
    detail: issueRows.length ? `${scoreText}；${issueRows.length} 个店铺存在 Account Health / 政策合规风险。` : `${scoreText}；Account Health 正常。`,
    rows: issueRows.slice(0, 20),
    storeStats,
    source: "store performance",
  };
}

async function inspectErpBuyerMessages(adapter, sellers, range, config, previousInspectionResult) {
  const endpoint = config.lingxing.buyerMessageEndpoint;
  const buyerMessageRange = normalizeBuyerMessageRange(config);
  const requestParamsList = buildErpBuyerMessagesRequestParamsList(config, buyerMessageRange);
  if (!endpoint || !requestParamsList.length) {
    return {
      key: "erpBuyerMessages",
      label: "ERP 售后邮件",
      status: "unavailable",
      tone: "warning",
      count: 0,
      total: 0,
      detail: "未配置 LINGXING_BUYER_MESSAGE_ENDPOINT 或 LINGXING_BUYER_MESSAGE_EMAILS，暂未自动巡检 ERP 售后邮件。",
      rows: [],
      snapshotRows: [],
      source: "ERP 售后邮件",
    };
  }
  const rows = [];
  const errors = [];
  for (const requestParams of requestParamsList) {
    try {
      const pageRows = await fetchPaged(
        (params) => adapter.fetchCustomOpenApi(endpoint, params),
        requestParams,
        { maxPages: 10, length: 200 },
      );
      rows.push(...pageRows.map((row) => ({ ...row, _sourceEmail: requestParams.email })));
    } catch (error) {
      const redactedEmail = requestParams.email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
      errors.push(`${redactedEmail}: ${error.message}`);
    }
  }
  if (errors.length && !rows.length) {
    return {
      key: "erpBuyerMessages",
      label: "ERP 售后邮件",
      status: "error",
      tone: "danger",
      count: 0,
      total: 0,
      detail: `ERP 售后邮件读取失败：${errors.join("；")}`,
      rows: [],
      snapshotRows: [],
      source: "ERP 售后邮件",
    };
  }
  const stationMessageRows = applyErpBuyerMessageStoreMap(rows, config);

  const summary = buildErpBuyerMessagesInspectionSummary(
    stationMessageRows,
    previousInspectionResult?.erpBuyerMessages?.snapshotRows || previousInspectionResult?.erpBuyerMessages?.rows || [],
    {
      mode: "current",
      stationMessagesOnly: true,
      startDate: buyerMessageRange.startDate,
      endDate: buyerMessageRange.endDate,
      recentDays: config.lingxing?.buyerMessageRecentDays || 2,
    },
  );
  if (errors.length) {
    return {
      ...summary,
      tone: summary.tone === "success" ? "warning" : summary.tone,
      detail: `${summary.detail} 另有 ${errors.length} 个 ERP 绑定邮箱读取失败。`,
    };
  }
  return summary;
}

export function buildLowInventoryFeeInspectionSummary(dashboard = {}) {
  const rows = (dashboard.rows || [])
    .filter((row) => row?.amazonFeeEligible === true)
    .map((row) => ({
      storeName: String(row.storeName ?? "").trim(),
      country: String(row.country ?? "").trim(),
      msku: String(row.msku ?? "").trim(),
    }))
    .filter((row) => row.storeName && row.msku);
  return {
    key: "lowInventoryFee",
    label: "低库存费 MSKU",
    status: rows.length ? "risk" : "ok",
    tone: rows.length ? "danger" : "success",
    count: rows.length,
    detail: rows.length ? `本周 ${rows.length} 个 MSKU 已进入低库存费区间。` : "本周无 MSKU 进入低库存费区间。",
    rows,
  };
}

export function lowInventoryFeeInspectionError(error) {
  return {
    key: "lowInventoryFee",
    label: "低库存费 MSKU",
    status: "error",
    tone: "danger",
    count: 0,
    detail: error?.message || "低库存费看板读取失败",
    rows: [],
  };
}

function buildChecks(inspection) {
  return [
    inspection.feedback,
    inspection.review,
    inspection.voiceOfBuyer,
    inspection.accountHealth,
    inspection.aftersalesMail,
    inspection.lowInventoryFee,
  ].filter(Boolean).map((item) => ({ ...item, autoConnected: !["unavailable", "error"].includes(item.status) }));
}

function groupRowsByStore(rows = []) {
  return rows.reduce((acc, row) => {
    const storeName = row.storeName || "-";
    acc.set(storeName, (acc.get(storeName) || 0) + 1);
    return acc;
  }, new Map());
}

function normalizeOwnerStoreKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function defaultOwnerForStore(storeName = "") {
  const normalized = normalizeOwnerStoreKey(storeName);
  if (!normalized) return "";
  if (normalized.includes("-au") || normalized.includes("澳洲") || normalized.includes("澳大利亚")) return "黄超";
  if (normalized === "xiamentanjia-us" || normalized === "tanjia-eu-de" || normalized.includes("-de")) return "林芃";
  if (normalized === "xiamentanjia-ca" || normalized === "tandanbo-us" || normalized === "tandanbo-ca") return "熊丹轩";
  return "";
}

function ownerNameForStore(storeName, config = getConfig()) {
  const key = normalizeOwnerStoreKey(storeName);
  return config.storeInspection?.storeOwners?.[key] || defaultOwnerForStore(storeName);
}

function ownerUserIdForStore(storeName, config = getConfig()) {
  const ownerName = ownerNameForStore(storeName, config);
  return ownerName ? config.storeInspection?.dingtalkUsers?.[ownerName] || "" : "";
}

function ownerMentionForStore(storeName, config = getConfig()) {
  const ownerName = ownerNameForStore(storeName, config);
  return ownerName ? `负责人：${ownerName}` : "";
}

function dingtalkUserIdByName(name, config = getConfig()) {
  return config.storeInspection?.dingtalkUsers?.[name] || "";
}

function hasNewAftersalesMail(aftersalesMail = {}) {
  if (Number(aftersalesMail.newCount || 0) > 0) return true;
  return (aftersalesMail.rows || []).some((row) => row?.type === "新邮件" || row?.status === "new" || row?.isNew === true);
}

export function storeInspectionMentionTargets(result = {}, config = getConfig(), previous = null) {
  const stores = new Set();
  [
    ...(result.feedback?.rows || []),
    ...(result.review?.rows || []),
    ...(result.voiceOfBuyer?.rows || []),
    ...(result.accountHealth?.rows || []),
    ...(result.erpBuyerMessages?.rows || []),
  ].forEach((row) => {
    if (row?.storeName) stores.add(row.storeName);
  });
  const targets = [...stores]
    .filter((storeName) => storeHasNewInspectionItems(result, previous, storeName))
    .map((storeName) => ({
      scope: storeName,
      ownerName: ownerNameForStore(storeName, config),
      userId: ownerUserIdForStore(storeName, config),
    }))
    .filter((item) => item.ownerName && item.userId);
  if (hasNewAftersalesMail(result.aftersalesMail)) {
    const aftersalesOwnerUserId = dingtalkUserIdByName("林芃", config);
    if (aftersalesOwnerUserId) {
      targets.push({
        scope: "站外售后邮箱",
        ownerName: "林芃",
        userId: aftersalesOwnerUserId,
      });
    }
  }
  return targets.filter((item, index, list) => (
    list.findIndex((candidate) => candidate.scope === item.scope && candidate.userId === item.userId) === index
  ));
}

export function storeInspectionMentionUserIds(result = {}, config = getConfig(), previous = null) {
  return [...new Set(storeInspectionMentionTargets(result, config, previous).map((item) => item.userId))];
}

export function buildStoreInspectionMentionText(result = {}, config = getConfig(), previous = null) {
  const targets = storeInspectionMentionTargets(result, config, previous);
  if (!targets.length) return "";
  return [
    "店铺巡检负责人提醒",
    "请对应负责人处理新增事项：",
    ...targets.map((item) => `- ${item.scope}：${item.ownerName} @${item.userId}`),
  ].join("\n");
}

export function buildDingTalkContent(result) {
  const riskLines = [];
  if (result.feedback.count) riskLines.push(`- 4星以下 feedback：${result.feedback.count} 条`);
  if (result.review.lowCount) riskLines.push(`- 4星以下 review：${result.review.lowCount} 条`);
  if (result.voiceOfBuyer.count) riskLines.push(`- 买家之声异常：${result.voiceOfBuyer.count} 条`);
  if (result.accountHealth.count) riskLines.push(`- Account Health 风险：${result.accountHealth.count} 个店铺`);
  groupRowsByStore(result.erpBuyerMessages?.rows || []).forEach((count, storeName) => {
    riskLines.push(`- ${storeName}：新增 ${count} 封亚马逊站内信`);
  });
  if (result.aftersalesMail?.newCount) riskLines.push(`- 站外售后邮箱：新增 ${result.aftersalesMail.newCount} 封`);
  else if (result.aftersalesMail?.count) riskLines.push(`- 站外售后邮箱：待回复 ${result.aftersalesMail.count} 封`);
  if (!riskLines.length) riskLines.push("- 未发现 feedback、review、买家之声、Account Health 或售后邮件风险");

  const unavailable = result.checks.filter((item) => item.status === "unavailable").map((item) => item.label);
  const feedbackRows = result.feedback.rows.slice(0, 5).map((item) => `- ${item.storeName} ${item.asin} ${item.rating}星：${item.content}`).join("\n");
  const reviewRows = result.review.rows.slice(0, 5).map((item) => `- ${item.storeName} ${item.asin} ${item.rating}星：${item.title}`).join("\n");
  const voiceRows = result.voiceOfBuyer.rows.slice(0, 5).map((item) => `- ${item.storeName} ${item.asin}/${item.msku}：${item.content}`).join("\n");
  const accountRows = result.accountHealth.rows.slice(0, 5).map((item) => `- ${item.storeName}：${item.content}`).join("\n");
  const mailRows = (result.aftersalesMail?.rows || []).slice(0, 5).map((item) => `- ${item.type}：${item.item}`).join("\n");

  return [
    "【店铺自动巡检】",
    `时间：${result.meta.updatedAt}`,
    `范围：${result.meta.startDate} 至 ${result.meta.endDate}`,
    `店铺数：${result.meta.storeCount}`,
    `结论：${result.overallLabel}`,
    "",
    "重点风险：",
    riskLines.join("\n"),
    feedbackRows ? `\n低星评价明细：\n${feedbackRows}` : "",
    reviewRows ? `\n低星 review 明细：\n${reviewRows}` : "",
    voiceRows ? `\n买家之声明细：\n${voiceRows}` : "",
    accountRows ? `\nAccount Health 明细：\n${accountRows}` : "",
    mailRows ? `\n站外售后邮箱：\n${mailRows}` : "",
    unavailable.length ? `\n未接入自动接口：${unavailable.join("、")}` : "",
  ].filter(Boolean).join("\n");
}

function reportCountryOrder(country = "", storeName = "") {
  const normalized = `${country} ${storeName}`.toLowerCase();
  if (normalized.includes("美国") || normalized.includes("-us") || normalized.includes("usa") || normalized.includes("united states")) return 0;
  if (normalized.includes("加拿大") || normalized.includes("-ca") || normalized.includes("canada")) return 1;
  if (normalized.includes("澳洲") || normalized.includes("澳大利亚") || normalized.includes("-au") || normalized.includes("australia")) return 2;
  if (normalized.includes("德国") || normalized.includes("-de") || normalized.includes("germany") || normalized.includes("deutschland")) return 3;
  return 4;
}

function collectReportStoreNames(result) {
  const names = new Set((result?.meta?.stores || []).map((store) => store.name).filter(Boolean));
  const countryByStore = new Map((result?.meta?.stores || []).map((store) => [store.name, store.country || ""]));
  [
    ...(result?.feedback?.rows || []),
    ...(result?.review?.rows || []),
    ...(result?.voiceOfBuyer?.rows || []),
    ...(result?.accountHealth?.rows || []),
    ...(result?.erpBuyerMessages?.rows || []),
    ...(result?.lowInventoryFee?.rows || []),
    ...(result?.feedback?.storeStats || []),
    ...(result?.review?.storeStats || []),
    ...(result?.accountHealth?.storeStats || []),
  ].forEach((item) => {
    if (item?.storeName) {
      names.add(item.storeName);
      if (!countryByStore.has(item.storeName) && item.country) countryByStore.set(item.storeName, item.country);
    }
  });
  return [...names].sort((left, right) => {
    const countryOrder = reportCountryOrder(countryByStore.get(left), left) - reportCountryOrder(countryByStore.get(right), right);
    return countryOrder || left.localeCompare(right, "zh-Hans-CN");
  });
}

function storeStat(stats = [], storeName) {
  return stats.find((item) => sameStoreName(item.storeName, storeName)) || {};
}

function countRowsForStore(rows = [], storeName) {
  return rows.filter((row) => sameStoreName(row.storeName, storeName)).length;
}

function storeHasInspectionItems(result, storeName) {
  return [
    result?.feedback?.rows,
    result?.review?.rows,
    result?.voiceOfBuyer?.rows,
    result?.accountHealth?.rows,
    result?.erpBuyerMessages?.rows,
    result?.lowInventoryFee?.rows,
  ].some((rows) => countRowsForStore(rows || [], storeName) > 0);
}

function newFeedbackRowsForStore(result, previous, storeName) {
  return newRowsSincePrevious(
    (result?.feedback?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    (previous?.feedback?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    ["storeName", "rating", "createdAt", "content"],
  );
}

function newReviewRowsForStore(result, previous, storeName) {
  return newRowsSincePrevious(
    (result?.review?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    (previous?.review?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    ["storeName", "reviewId", "rating", "createdAt", "content"],
  );
}

function newVoiceRowsForStore(result, previous, storeName) {
  return newRowsSincePrevious(
    (result?.voiceOfBuyer?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    (previous?.voiceOfBuyer?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    ["storeName", "asin", "msku", "rating", "content"],
  );
}

function newAccountPolicyCountForStore(result, previous, storeName) {
  const currentCount = accountPolicyCount(result, storeName);
  const previousCount = previous ? accountPolicyCount(previous, storeName) : currentCount;
  return Math.max(currentCount - previousCount, 0);
}

function storeHasNewInspectionItems(result, previous, storeName) {
  return newFeedbackRowsForStore(result, previous, storeName).length > 0
    || newReviewRowsForStore(result, previous, storeName).length > 0
    || newVoiceRowsForStore(result, previous, storeName).length > 0
    || newAccountPolicyCountForStore(result, previous, storeName) > 0
    || countRowsForStore(result?.erpBuyerMessages?.rows || [], storeName) > 0;
}

function previousInspection(history = [], latest) {
  const latestUpdatedAt = latest?.meta?.updatedAt;
  return history.find((item) => item?.meta?.updatedAt && item.meta.updatedAt !== latestUpdatedAt) || null;
}

function accountPolicyCount(result, storeName) {
  const stat = storeStat(result?.accountHealth?.storeStats || [], storeName);
  if (stat.policyCount !== undefined) return Number(stat.policyCount) || 0;
  return (result?.accountHealth?.rows || [])
    .filter((row) => sameStoreName(row.storeName, storeName))
    .reduce((sum, row) => sum + (Number(row.policyCount) || 0), 0);
}

function buildStoreReportSection(storeName, latest, previous, config = getConfig()) {
  const feedbackStat = storeStat(latest?.feedback?.storeStats || [], storeName);
  const currentFeedbackRows = (latest?.feedback?.rows || []).filter((row) => sameStoreName(row.storeName, storeName));
  const previousFeedbackRows = (previous?.feedback?.rows || []).filter((row) => sameStoreName(row.storeName, storeName));
  const newFeedbackRows = newRowsSincePrevious(currentFeedbackRows, previousFeedbackRows, ["storeName", "rating", "createdAt", "content"]);
  const feedbackPendingCount = feedbackStat.pendingCount ?? countRowsForStore(latest?.feedback?.rows || [], storeName);
  const previousLowReviewRows = (previous?.review?.rows || []).filter((row) => sameStoreName(row.storeName, storeName));
  const lowReviewRows = newRowsSincePrevious(
    (latest?.review?.rows || []).filter((row) => sameStoreName(row.storeName, storeName)),
    previousLowReviewRows,
    ["storeName", "reviewId", "rating", "createdAt", "content"],
  );
  const policyCount = accountPolicyCount(latest, storeName);
  const previousPolicyCount = previous ? accountPolicyCount(previous, storeName) : 0;
  const newPolicyCount = previous ? Math.max(policyCount - previousPolicyCount, 0) : policyCount;
  const stationMessageCount = countRowsForStore(latest?.erpBuyerMessages?.rows || [], storeName);
  const lowInventoryFeeMskus = [...new Set(
    (latest?.lowInventoryFee?.rows || [])
      .filter((row) => sameStoreName(row.storeName, storeName))
      .map((row) => String(row.msku || "").trim())
      .filter(Boolean),
  )];
  const reviewLines = lowReviewRows.length
    ? lowReviewRows.map((row) => `  - ${normalizeReportText(row.rating)} 星，review内容：${normalizeReportText(row.content)}，msku：${normalizeReportText(row.msku)}。`)
    : [];
  const feedbackNeedsAction = newFeedbackRows.length > 0 || feedbackPendingCount > 0;
  const reviewNeedsAction = lowReviewRows.length > 0;
  const ownerMentionLine = storeHasInspectionItems(latest, storeName) ? ownerMentionForStore(storeName, config) : "";
  const feedbackReviewLines = !feedbackNeedsAction && !reviewNeedsAction
    ? ["- feedback 和 review 无待处理。"]
    : [
        feedbackNeedsAction
          ? `- 新增 ${reportCount(newFeedbackRows.length)} 条 feedback，目前还有 ${reportCount(feedbackPendingCount)} 条 feedback 未处理。`
          : "- feedback 无待处理。",
        reviewNeedsAction
          ? `- 新增 ${reportCount(lowReviewRows.length)} 条差评 review。`
          : "- review 无待处理。",
        ...reviewLines,
      ];

  return [
    `## ${storeName}`,
    ownerMentionLine,
    "",
    ...feedbackReviewLines,
    lowInventoryFeeMskus.length ? `- <font color="#D7373F">**本周低库存费 MSKU：${lowInventoryFeeMskus.join("、")}，已产生附加费，请及时关注。**</font>` : "",
    stationMessageCount > 0 ? `- 新增 ${reportCount(stationMessageCount)} 封亚马逊站内信。` : "- 亚马逊站内信无新增。",
    `- 店铺健康，目前 ${reportCount(policyCount)} 条合规性问题待处理，新增 ${reportCount(newPolicyCount)} 条。`,
  ].filter((line, index) => line || index === 2).join("\n");
}

export function buildStoreInspectionMarkdown(latest, history = [], config = getConfig()) {
  const today = formatDate(new Date());
  if (!latest) {
    return [
      `# 店铺巡检日报 - ${today}`,
      "",
      "自动化巡检结果：暂无巡检结果。",
    ].join("\n");
  }

  const stores = collectReportStoreNames(latest);
  const previous = previousInspection(history, latest);
  const rangeText = latest.meta?.startDate && latest.meta?.endDate ? `${latest.meta.startDate} 至 ${latest.meta.endDate}` : "当前巡检周期";
  const sections = stores.length
    ? stores.map((storeName) => buildStoreReportSection(storeName, latest, previous, config))
    : [["## 暂无店铺", "", "- feedback 和 review 无待处理。", "- 店铺健康，目前 0 条合规性问题待处理，新增 0 条。"].join("\n")];
  const aftersalesMailRows = (latest.aftersalesMail?.rows || [])
    .slice(0, 5)
    .map((row) => `- ${normalizeReportText(row.type)}｜${normalizeReportText(row.item)}`);
  const aftersalesOwnerLine = hasNewAftersalesMail(latest.aftersalesMail) && dingtalkUserIdByName("林芃", config) ? "负责人：林芃" : "";
  const lowInventoryFeeFailure = latest.lowInventoryFee?.status === "error"
    ? [
        "",
        "## 低库存费 MSKU 巡检失败",
        "",
        `- 低库存费 MSKU 看板读取失败：${latest.lowInventoryFee.detail || "低库存费看板读取失败"}`,
      ]
    : [];
  return [
    `# 店铺巡检日报 - ${today}`,
    "",
    `自动化巡检结果：共巡检 ${latest.meta?.storeCount ?? stores.length} 个店铺，巡检范围 ${rangeText}，最新巡检时间 ${latest.meta?.updatedAt || "-"}。`,
    "",
    sections.join("\n\n"),
    ...lowInventoryFeeFailure,
    "",
    "## 站外售后邮箱",
    aftersalesOwnerLine,
    "",
    `- ${latest.aftersalesMail?.detail || "暂无站外售后邮箱巡检结果。"}`,
    ...aftersalesMailRows,
  ].filter((line, index, lines) => line || lines[index - 1] !== "## 站外售后邮箱").join("\n");
}

export async function getStoreInspectionMarkdown() {
  const [latest, history] = await Promise.all([readLatestStoreInspection(), readInspectionHistory()]);
  return {
    ok: true,
    markdown: buildStoreInspectionMarkdown(latest, history),
    latest,
  };
}

async function saveInspectionResult(result) {
  const current = await readStoreInspectionState();
  await writeInspectionJson(stateFile, {
    version: inspectionStateVersion,
    latest: result,
    history: [result, ...current.history].slice(0, historyLimit),
  }, "write-state");
}

export async function readInspectionHistory() {
  return (await readStoreInspectionState()).history;
}

export async function readLatestStoreInspection() {
  return (await readStoreInspectionState()).latest;
}

export function getStoreInspectionPersistenceStatus() {
  const uncertainty = getJsonStoreCommitUncertainty(stateFile);
  return {
    ok: !uncertainty,
    status: uncertainty ? "reconciliation_required" : "clear",
    filePath: stateFile,
    uncertainty,
  };
}

export async function reconcileStoreInspectionPersistence({ stateSha256 = "" } = {}) {
  const hash = String(stateSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    const error = new JsonStoreError("需要提供当前巡检状态文件的 SHA-256 才能解除写入阻断。", {
      code: "RECONCILIATION_HASH_INVALID",
      filePath: stateFile,
      statusCode: 400,
    });
    throw error;
  }
  return reconcileJsonStoreCommit(stateFile, { expectedSha256: hash });
}

export function recomputeInspectionOverall(result) {
  const coreChecks = [
    result.feedback,
    result.review,
    result.voiceOfBuyer,
    result.accountHealth,
    result.erpBuyerMessages,
    result.aftersalesMail,
    result.lowInventoryFee,
  ];
  const hasRisk = coreChecks.some((item) => item?.count > 0 || item?.status === "error");
  const hasUnavailable = coreChecks.some((item) => ["warning", "unavailable"].includes(item?.status));
  return {
    ...result,
    overall: hasRisk ? "risk" : hasUnavailable ? "warning" : "ok",
    overallLabel: hasRisk ? "需处理" : hasUnavailable ? "部分接口需复核" : "正常",
  };
}

export async function updateErpBuyerMessageManualStatus(messageId, status = "replied", { operator = "BI", note = "" } = {}) {
  const id = String(messageId || "").trim();
  if (!id) {
    const error = new Error("缺少 ERP 邮件 ID。");
    error.statusCode = 400;
    throw error;
  }
  if (!["replied", "pending"].includes(status)) {
    const error = new Error("ERP 邮件状态无效。");
    error.statusCode = 400;
    throw error;
  }

  const statuses = await readErpBuyerMessageStatuses();
  if (status === "replied") {
    statuses[id] = {
      status: "replied",
      operator,
      note: note || "手动标记已回复",
      updatedAt: nowText(),
    };
  } else {
    delete statuses[id];
  }
  await writeErpBuyerMessageStatuses(statuses);

  const latest = await readLatestStoreInspection();
  if (!latest?.erpBuyerMessages) return { ok: true, messageId: id, status, latest };

  const snapshotRows = applyErpBuyerMessageManualStatuses(latest.erpBuyerMessages.snapshotRows || [], statuses);
  const rows = applyErpBuyerMessageManualStatuses(latest.erpBuyerMessages.rows || [], statuses)
    .map((row) => erpBuyerMessageSummary(row))
    .filter((row) => row.replyStatus !== "replied");
  const repliedCount = snapshotRows.filter((row) => erpBuyerMessageSummary(row).replyStatus === "replied").length;
  const total = Number(latest.erpBuyerMessages.total ?? snapshotRows.length);
  const erpBuyerMessages = {
    ...latest.erpBuyerMessages,
    rows,
    snapshotRows,
    count: rows.length,
    repliedCount,
    status: rows.length ? "risk" : "ok",
    tone: rows.length ? "warning" : "success",
    detail: rows.length
      ? `近 2 天发现 ${total} 封 ERP 站内信，${repliedCount ? `${repliedCount} 封已标记或匹配回复，` : ""}待处理 ${rows.length} 封。`
      : `近 2 天发现 ${total} 封 ERP 站内信，均已标记或匹配回复。`,
  };
  const next = recomputeInspectionOverall({
    ...latest,
    erpBuyerMessages,
  });
  next.checks = buildChecks(next);
  const current = await readStoreInspectionState();
  await writeInspectionJson(stateFile, {
    version: inspectionStateVersion,
    latest: next,
    history: current.history,
  }, "write-state");
  return { ok: true, messageId: id, status, latest: next };
}

export function getStoreInspectionState() {
  return { ...state, config: getConfig().storeInspection };
}

async function runMockInspection({ notify = false } = {}) {
  const range = normalizeRange();
  const aftersalesMail = await getAftersalesMailInspectionSummary({ refresh: true });
  let lowInventoryFee;
  try {
    lowInventoryFee = buildLowInventoryFeeInspectionSummary(await getLowInventoryFeeDashboard({ onlyRisk: "0" }));
  } catch (error) {
    lowInventoryFee = lowInventoryFeeInspectionError(error);
  }
  const result = {
    ok: true,
    provider: "mock",
    overall: "warning",
    overallLabel: "模拟环境，等待真实接口",
    feedback: { key: "feedback", label: "feedback", status: "unavailable", tone: "warning", count: 0, detail: "mock 环境未读取 feedback。", rows: [] },
    review: { key: "review", label: "review", status: "unavailable", tone: "warning", count: 0, lowCount: 0, detail: "mock 环境未读取 review。", rows: [] },
    voiceOfBuyer: { key: "voiceOfBuyer", label: "买家之声", status: "unavailable", tone: "warning", count: 0, total: 0, detail: "mock 环境未读取买家之声。", rows: [] },
    accountHealth: { key: "accountHealth", label: "Performance - Account Health", status: "unavailable", tone: "warning", count: 0, total: 0, detail: "mock 环境未读取 Account Health。", rows: [] },
    erpBuyerMessages: { key: "erpBuyerMessages", label: "ERP 售后邮件", status: "unavailable", tone: "warning", count: 0, total: 0, detail: "mock 环境未读取 ERP 售后邮件。", rows: [], snapshotRows: [] },
    aftersalesMail,
    lowInventoryFee,
    checks: [],
    notification: { ok: false, skipped: true, message: "店铺巡检钉钉推送已关闭。" },
    meta: { updatedAt: nowText(), storeCount: 0, ...range },
  };
  result.checks = buildChecks(result);
  if (notify && getConfig().storeInspection.notifyEnabled) result.notification = await sendDingTalkText(buildDingTalkContent(result));
  await saveInspectionResult(result);
  return result;
}

export async function runStoreInspection({ trigger = "manual", notify = true } = {}) {
  const config = getConfig();
  if (state.running) return { ok: false, skipped: true, message: "店铺巡检正在运行，请稍后查看。", state: getStoreInspectionState() };
  state.running = true;
  state.lastStartedAt = nowText();
  state.lastStatus = "巡检中";
  state.lastError = null;
  state.lastErrorCode = null;
  state.lastCommitState = null;
  state.lastRequiresReconciliation = null;
  state.lastRetryable = null;
  try {
    if (config.dataProvider !== "lingxing") {
      const mockResult = await runMockInspection({ notify: false });
      state.lastFinishedAt = nowText();
      state.lastSuccessAt = state.lastFinishedAt;
      state.lastStatus = "mock 环境已生成巡检占位结果";
      return { ...mockResult, state: getStoreInspectionState() };
    }

    const adapter = getLingxingAdapter();
    const range = normalizeRange(config);
    const sellers = await getSellers(adapter);
    const previousInspectionResult = await readLatestStoreInspection();
    const [feedbackResult, reviewResult, voiceResult, accountHealthResult, erpBuyerMessagesResult, aftersalesMailResult, lowInventoryFeeResult] = await Promise.allSettled([
      inspectFeedback(adapter, sellers, range, config),
      inspectReview(adapter, sellers, range),
      inspectVoiceOfBuyer(adapter, sellers),
      inspectAccountHealth(adapter, sellers),
      inspectErpBuyerMessages(adapter, sellers, range, config, previousInspectionResult),
      getAftersalesMailInspectionSummary({ refresh: true }),
      getLowInventoryFeeDashboard({ onlyRisk: "0" }),
    ]);
    const feedback = feedbackResult.status === "fulfilled"
      ? feedbackResult.value
      : { key: "feedback", label: "feedback", status: "error", tone: "danger", count: 0, detail: feedbackResult.reason?.message || "feedback 读取失败", rows: [] };
    const review = reviewResult.status === "fulfilled"
      ? reviewResult.value
      : { key: "review", label: "review", status: "error", tone: "danger", count: 0, lowCount: 0, detail: reviewResult.reason?.message || "review 读取失败", rows: [] };
    const voiceOfBuyer = voiceResult.status === "fulfilled"
      ? voiceResult.value
      : { key: "voiceOfBuyer", label: "买家之声", status: "error", tone: "danger", count: 0, total: 0, detail: voiceResult.reason?.message || "买家之声读取失败", rows: [] };
    const accountHealth = accountHealthResult.status === "fulfilled"
      ? accountHealthResult.value
      : { key: "accountHealth", label: "Performance - Account Health", status: "error", tone: "danger", count: 0, total: 0, detail: accountHealthResult.reason?.message || "Account Health 读取失败", rows: [] };
    const erpBuyerMessages = erpBuyerMessagesResult.status === "fulfilled"
      ? erpBuyerMessagesResult.value
      : { key: "erpBuyerMessages", label: "ERP 售后邮件", status: "error", tone: "danger", count: 0, total: 0, detail: erpBuyerMessagesResult.reason?.message || "ERP 售后邮件读取失败", rows: [], snapshotRows: [] };
    const aftersalesMail = aftersalesMailResult.status === "fulfilled"
      ? aftersalesMailResult.value
      : { key: "aftersalesMail", label: "站外售后邮箱", status: "error", tone: "danger", count: 0, detail: aftersalesMailResult.reason?.message || "站外售后邮箱读取失败", rows: [] };
    const lowInventoryFee = lowInventoryFeeResult.status === "fulfilled"
      ? buildLowInventoryFeeInspectionSummary(lowInventoryFeeResult.value)
      : lowInventoryFeeInspectionError(lowInventoryFeeResult.reason);
    const coreChecks = [feedback, review, voiceOfBuyer, accountHealth, erpBuyerMessages, aftersalesMail, lowInventoryFee];
    const hasRisk = coreChecks.some((item) => item.count > 0 || item.status === "error");
    const hasUnavailable = coreChecks.some((item) => ["warning", "unavailable"].includes(item.status));
    const result = {
      ok: true,
      provider: "lingxing",
      trigger,
      overall: hasRisk ? "risk" : hasUnavailable ? "warning" : "ok",
      overallLabel: hasRisk ? "需处理" : hasUnavailable ? "部分接口需复核" : "正常",
      feedback,
      review,
      voiceOfBuyer,
      accountHealth,
      erpBuyerMessages,
      aftersalesMail,
      lowInventoryFee,
      checks: [],
      notification: { ok: false, skipped: true, message: "未推送" },
      meta: {
        updatedAt: nowText(),
        storeCount: sellers.length,
        stores: sellers.map((seller) => ({ sid: sellerSid(seller), name: sellerName(seller), country: sellerCountry(seller) })),
        ...range,
      },
    };
    result.checks = buildChecks(result);
    const shouldNotify = config.storeInspection.notifyEnabled && notify && (config.storeInspection.notifyOnClean || result.overall !== "ok");
    if (shouldNotify) {
      const history = await readInspectionHistory();
      const previousForMention = previousInspection(history, result);
      const atUserIds = storeInspectionMentionUserIds(result, config, previousForMention);
      const mentionText = buildStoreInspectionMentionText(result, config, previousForMention);
      const reportNotification = await sendDingTalkMarkdown({
        title: `店铺巡检日报 ${formatDate(new Date())}`,
        text: buildStoreInspectionMarkdown(result, history),
        inheritConfiguredMentions: false,
      });
      const mentionNotification = atUserIds.length
        ? await sendDingTalkText(mentionText, { atUserIds })
        : {
            ok: true,
            skipped: true,
            atUserIds,
            message: "本次无新增店铺事项，未 @ 负责人。",
          };
      result.notification = {
        ok: reportNotification.ok && mentionNotification.ok,
        report: reportNotification,
        mention: mentionNotification,
        atUserIds,
        message: reportNotification.ok && mentionNotification.ok
          ? atUserIds.length
            ? `日报已发送，并已发送负责人 @ 提醒。`
            : "日报已发送，本次无新增店铺事项，未 @ 负责人。"
          : "日报或负责人 @ 提醒发送失败。",
      };
    } else {
      result.notification = { ok: false, skipped: true, message: config.storeInspection.notifyEnabled ? "本次无风险且 STORE_INSPECTION_NOTIFY_ON_CLEAN=false，已跳过推送。" : "店铺巡检钉钉推送已关闭。" };
    }
    await saveInspectionResult(result);
    state.lastFinishedAt = nowText();
    state.lastSuccessAt = state.lastFinishedAt;
    state.lastStatus = `巡检完成：${result.overallLabel}`;
    return { ...result, state: getStoreInspectionState() };
  } catch (error) {
    state.lastFinishedAt = nowText();
    state.lastStatus = "巡检失败";
    state.lastError = error.message;
    state.lastErrorCode = error?.code || "UNKNOWN";
    state.lastCommitState = error?.commitState || null;
    state.lastRequiresReconciliation = error?.requiresReconciliation === true;
    state.lastRetryable = typeof error?.retryable === "boolean" ? error.retryable : null;
    return {
      ok: false,
      error: error.message,
      errorCode: error?.code || "UNKNOWN",
      commitState: error?.commitState || null,
      targetMayContainNewValue: error?.targetMayContainNewValue === true,
      requiresReconciliation: error?.requiresReconciliation === true,
      markerPersisted: error?.markerPersisted === true,
      markerPersistenceErrorCode: error?.markerPersistenceErrorCode,
      retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
      state: getStoreInspectionState(),
    };
  } finally {
    state.running = false;
  }
}

export async function getStoreInspectionDashboard() {
  const [latest, history, schedule] = await Promise.all([
    readLatestStoreInspection(),
    readInspectionHistory(),
    getStoreInspectionSettings(),
  ]);
  return {
    ok: true,
    state: getStoreInspectionState(),
    schedule,
    latest,
    history,
  };
}

async function runScheduledStoreInspection() {
  const settings = await readStoreInspectionSettings();
  if (!settings.enabled) {
    state.lastStatus = "店铺自动巡检已关闭";
    return;
  }
  const clock = scheduleClock();
  if (clock.time < settings.sendTime || settings.lastRunDate === clock.date) return;
  await saveStoreInspectionSettings({
    ...settings,
    lastRunDate: clock.date,
    lastRunAt: nowText(),
  });
  const result = await runStoreInspection({ trigger: "scheduler", notify: true });
  if (!result.ok) console.error("Store inspection scheduled run failed:", result.error || result.message);
}

export function startStoreInspectionScheduler() {
  if (timer) clearInterval(timer);
  runScheduledStoreInspection().catch((error) => {
    console.error("Store inspection scheduler startup check failed:", error);
  });
  timer = setInterval(() => {
    runScheduledStoreInspection().catch((error) => {
      console.error("Store inspection scheduler failed:", error);
    });
  }, schedulerPollMs);
}

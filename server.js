import http from "node:http";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./src/config/index.js";
import { buildApiRoutes } from "./routes/index.js";
import { getLingxingAdapter } from "./src/adapters/lingxingAdapter.js";
import { getMskuDetailDashboard, getSalesWeeklyDashboard } from "./src/services/dashboardService.js";
import { getDailyProductPulse } from "./src/services/productPulseService.js";
import {
  exportSalesForecastEstimateXlsx,
  getSalesForecastDashboard,
  migrateSalesForecastManualDailyRows,
  saveSalesForecastHiddenRow,
  saveSalesForecastManualDailyRow,
} from "./src/services/salesForecastService.js";
import {
  getAdKeywordAnalysisDashboard,
  getAdKeywordDashboard,
  getAdPortfolioDashboard,
} from "./src/services/adPortfolioService.js";
import { getAdPerformanceReview } from "./src/services/adPerformanceReviewService.js";
import { getAftersalesDashboard } from "./src/services/aftersalesService.js";
import {
  getStoreInspectionDashboard,
  getStoreInspectionMarkdown,
  getStoreInspectionSettings,
  runStoreInspection,
  startStoreInspectionScheduler,
  updateErpBuyerMessageManualStatus,
  updateStoreInspectionSettings,
} from "./src/services/storeInspectionService.js";
import {
  generateAftersalesMailSuggestion,
  getAftersalesMailAttachment,
  getAftersalesMailDashboard,
  getAftersalesMailMessage,
  sendAftersalesMailReply,
  syncAftersalesMail,
  updateAftersalesMailStatus,
} from "./src/services/aftersalesMailService.js";
import {
  debugInventoryProvisionSource,
  exportInventoryProvisionDetailXlsx,
  getInventoryProvisionDashboard,
} from "./src/services/inventoryProvisionService.js";
import { getSlowMovingRiskDashboard } from "./src/services/slowMovingRiskService.js";
import { createSlowMovingRiskSnapshotStore } from "./src/services/slowMovingRiskSnapshotStore.js";
import { startSlowMovingRiskWeeklyScheduler } from "./src/jobs/slowMovingRiskWeeklyJob.js";
import { debugLowInventoryLedgerSource, getLowInventoryFeeDashboard } from "./src/services/lowInventoryFeeService.js";
import {
  getPlatformCashflowDashboard,
  runPlatformCashflowCapture,
  startPlatformCashflowScheduler,
} from "./src/services/platformCashflowService.js";
import { getPayablesDashboard } from "./src/services/payablesService.js";
import { getFactoryInventoryDashboard, saveFactoryInventoryShippedQuantity } from "./src/services/factoryInventoryService.js";
import { startFactoryInventoryWarmupScheduler } from "./src/services/factoryInventoryWarmupService.js";
import { startDefaultDashboardWarmupScheduler } from "./src/services/defaultDashboardWarmupService.js";
import { getSupplierBoardDashboard } from "./src/services/supplierBoardService.js";
import {
  deleteSupplierDetail,
  importSupplierDetails,
  listSupplierDetails,
  saveSupplierDetail,
} from "./src/services/supplierDetailService.js";
import { startSyncScheduler, runManualSync, getSyncState, getSyncStatus, getLingxingShops } from "./src/services/syncService.js";
import { listBudgetTargets, listBudgetUploads, saveBudgetUpload } from "./src/services/budgetTargetService.js";
import { runStaWarehouseProbe } from "./src/services/fbaStaService.js";
import { getFbaShopOptions, searchFbaMskus } from "./src/services/fbaCatalogService.js";
import { saveFbaBoxTemplate } from "./src/services/fbaBoxTemplateService.js";
import {
  convertFbaFreightShipmentsToForwarderTemplate,
  exportFbaFreightShipments,
  getFbaFreightShipments,
  listFbaForwarderTemplates,
} from "./src/services/fbaFreightSheetService.js";
import {
  deleteFreightRate,
  exportFreightRateLogsCsv,
  listFreightRates,
  saveFreightRate,
} from "./src/services/freightRateService.js";
import { getFbaShipmentCandidates } from "./src/services/fbaShipmentCandidateService.js";
import { startFbaShipmentWarmupScheduler } from "./src/services/fbaShipmentWarmupService.js";
import {
  createReadySendFbaShipmentOrders,
  listFbaShipmentOrderWarehouses,
} from "./src/services/fbaShipmentOrderService.js";
import {
  createJiufangFbaOrders,
  dryRunJiufangFbaOrders,
  listJiufangChannels,
} from "./src/services/jiufangFbaOrderService.js";
import {
  createFbaStaTasks,
  deleteFbaStaTask,
  getFbaStaAutomationState,
  runFbaStaTaskNow,
  startFbaStaScheduler,
  updateFbaStaAutomation,
  updateFbaStaTask,
} from "./src/services/fbaStaTaskService.js";
import {
  createWebhookTask,
  deleteWebhookTask,
  listWebhookTasks,
  sendWebhookTaskNow,
  startWebhookAssistantScheduler,
  updateWebhookTask,
} from "./src/services/webhookAssistantService.js";
import {
  createAuthUser,
  deleteDingtalkAuthUser,
  deleteAuthUser,
  hasManagedAuthUsers,
  listDingtalkAuthUsers,
  listAuthUsers,
  resolveDingtalkLogin,
  updateDingtalkAuthUser,
  updateAuthUser,
  validatePasswordLogin,
} from "./src/services/authUserService.js";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
} from "./src/services/knowledgeService.js";
import {
  getAiProviderStatus,
  resolveActiveAiProviderConfig,
  testAiProviderConnection,
  updateAiProviderSettings,
} from "./src/services/aiProviderService.js";
import {
  buildCanonicalDingtalkLoginRedirect,
  buildDingtalkLoginUrl,
  exchangeDingtalkCode,
  fetchDingtalkMe,
  isDingtalkLoginConfigured,
} from "./src/services/dingtalkAuthService.js";
import { generateAiListingCopy } from "./src/services/aiListingService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = getConfig();
const slowMovingRiskSnapshotStore = createSlowMovingRiskSnapshotStore();
const sessionCookieName = "tanjia_session";
const oauthStateCookieName = "tanjia_oauth_state";
const sessionTtlMs = 12 * 60 * 60 * 1000;
const oauthStateTtlMs = 10 * 60 * 1000;
const frameLoginTicketTtlMs = 60 * 1000;
const sessions = new Map();
const oauthStates = new Map();
const frameLoginTickets = new Map();
const imageCacheDir = path.join(__dirname, "data-cache", "image-cache");
const resolvedSessionSecret = config.auth.sessionSecret || crypto.randomBytes(32).toString("base64url");
const staticFileCache = new Map();
const staticFileCacheLoads = new Map();
const staticFileCacheMaxBytes = 8 * 1024 * 1024;
let staticFileCacheBytes = 0;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function buildStaticEtag(fileStat) {
  return `W/"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`;
}

function touchStaticCacheEntry(filePath, entry) {
  staticFileCache.delete(filePath);
  staticFileCache.set(filePath, { ...entry, lastAccessedAt: Date.now() });
}

function evictStaticFileCache() {
  while (staticFileCacheBytes > staticFileCacheMaxBytes && staticFileCache.size) {
    const [filePath, entry] = staticFileCache.entries().next().value;
    staticFileCache.delete(filePath);
    staticFileCacheBytes -= entry.content.length;
  }
}

function storeStaticCacheEntry(filePath, entry) {
  if (entry.content.length > staticFileCacheMaxBytes) return entry;
  const previous = staticFileCache.get(filePath);
  if (previous) staticFileCacheBytes -= previous.content.length;
  staticFileCache.set(filePath, { ...entry, lastAccessedAt: Date.now() });
  staticFileCacheBytes += entry.content.length;
  evictStaticFileCache();
  return entry;
}

async function readStaticFileEntry(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    const error = new Error("Not found");
    error.code = "ENOENT";
    throw error;
  }

  const etag = buildStaticEtag(fileStat);
  const cached = staticFileCache.get(filePath);
  if (cached && cached.etag === etag && cached.size === fileStat.size) {
    touchStaticCacheEntry(filePath, cached);
    return cached;
  }

  if (staticFileCacheLoads.has(filePath)) {
    const loading = await staticFileCacheLoads.get(filePath);
    if (loading.etag === etag && loading.size === fileStat.size) return loading;
  }

  let load;
  load = readFile(filePath).then((content) => storeStaticCacheEntry(filePath, {
    content,
    etag,
    modifiedAt: fileStat.mtime.toUTCString(),
    size: fileStat.size,
  })).finally(() => {
    if (staticFileCacheLoads.get(filePath) === load) {
      staticFileCacheLoads.delete(filePath);
    }
  });
  staticFileCacheLoads.set(filePath, load);
  return load;
}

function requestHasEtag(req, etag) {
  return String(req.headers["if-none-match"] || "")
    .split(",")
    .map((item) => item.trim())
    .includes(etag);
}

function staticCacheControl(ext) {
  if ([".html", ".js", ".css"].includes(ext)) return "no-cache, must-revalidate";
  return "public, max-age=3600, must-revalidate";
}

function contentDispositionAttachment(filename) {
  const fallback = String(filename || "download.xlsx").replace(/[^\w.-]+/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || fallback)}`;
}

function imageExtension(contentType = "", imageUrl = "") {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("svg")) return ".svg";
  const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(ext)) return ext;
  return ".jpg";
}

function isImageContentType(contentType = "") {
  return String(contentType || "").trim().toLowerCase().startsWith("image/");
}

function isPrivateIpv4(address) {
  const parts = String(address || "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts;
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized || normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function isBlockedIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function validateImageCacheTarget(parsed) {
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("图片地址不允许指向本机或内网。");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) throw new Error("图片地址不允许指向本机或内网。");
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("图片地址不允许指向本机或内网。");
  }
}

async function sendCachedImage(res, imageUrl) {
  let parsed = null;
  try {
    parsed = new URL(imageUrl);
  } catch {
    sendJson(res, 400, { ok: false, error: "图片地址无效。" });
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    sendJson(res, 400, { ok: false, error: "只支持 http/https 图片。" });
    return;
  }
  try {
    await validateImageCacheTarget(parsed);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "图片地址不允许访问。" });
    return;
  }

  await mkdir(imageCacheDir, { recursive: true });
  const key = crypto.createHash("sha1").update(parsed.href).digest("hex");
  const metaPath = path.join(imageCacheDir, `${key}.json`);
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    if (!isImageContentType(meta.contentType)) throw new Error("Cached content is not an image");
    const cached = await readFile(path.join(imageCacheDir, meta.file));
    res.writeHead(200, {
      "content-type": meta.contentType,
      "cache-control": "public, max-age=604800",
    });
    res.end(cached);
    return;
  } catch {
    // Cache miss; fetch below.
  }

  try {
    const response = await fetch(parsed.href, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      sendJson(res, 502, { ok: false, error: `图片读取失败：${response.status}` });
      return;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!isImageContentType(contentType)) {
      sendJson(res, 502, { ok: false, error: "图片读取失败：返回内容不是图片。" });
      return;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = `${key}${imageExtension(contentType, parsed.href)}`;
    await writeFile(path.join(imageCacheDir, file), bytes);
    await writeFile(metaPath, JSON.stringify({ file, contentType, source: parsed.href }, null, 2), "utf8");
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=604800",
    });
    res.end(bytes);
  } catch (error) {
    sendJson(res, 502, { ok: false, error: `图片读取失败：${error.message}` });
  }
}

function sendRedirect(res, location, cookies = []) {
  const headers = { location };
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sendFrameRedirect(res, location, cookies = []) {
  const safeLocation = JSON.stringify(location);
  const safeHref = escapeHtmlAttribute(location);
  const headers = { "content-type": "text/html; charset=utf-8" };
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(200, headers);
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>钉钉登录跳转</title></head>
  <body>
    <script>
      try {
        window.top.location.replace(${safeLocation});
      } catch (error) {
        window.location.replace(${safeLocation});
      }
    </script>
    <a href="${safeHref}" target="_top">正在进入探嘉 BI...</a>
  </body>
</html>`);
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf("=");
      if (index === -1) return acc;
      acc[decodeURIComponent(item.slice(0, index))] = decodeURIComponent(item.slice(index + 1));
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (config.auth.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name) {
  return serializeCookie(name, "", { maxAge: 0 });
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function sessionSecret() {
  return resolvedSessionSecret;
}

function signSessionBody(body) {
  return crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

function createSessionCookieValue(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionBody(body);
  return `v1.${body}.${signature}`;
}

function readSignedSessionCookie(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, signature] = parts;
  const expected = signSessionBody(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.expiresAt || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function isAuthEnabled() {
  return config.auth.enabled || hasManagedAuthUsers();
}

function isPasswordLoginEnabled() {
  return Boolean(config.auth.local?.username && config.auth.local?.password) || hasManagedAuthUsers();
}

function createSession(user) {
  const payload = {
    user,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionTtlMs,
  };
  const sessionId = createSessionCookieValue(payload);
  sessions.set(sessionId, payload);
  return sessionId;
}

function cleanupAuthStores() {
  const now = Date.now();
  sessions.forEach((session, id) => {
    if (!session.expiresAt || session.expiresAt <= now) sessions.delete(id);
  });
  oauthStates.forEach((state, id) => {
    if (!state.expiresAt || state.expiresAt <= now) oauthStates.delete(id);
  });
  frameLoginTickets.forEach((ticket, id) => {
    if (!ticket.expiresAt || ticket.expiresAt <= now) frameLoginTickets.delete(id);
  });
}

function getSession(req) {
  if (!isAuthEnabled()) return null;
  cleanupAuthStores();
  const cookies = parseCookies(req);
  const sessionId = cookies[sessionCookieName];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (session?.expiresAt > Date.now()) {
    return { id: sessionId, ...session };
  }

  const signedSession = readSignedSessionCookie(sessionId);
  if (signedSession) {
    sessions.set(sessionId, signedSession);
    return { id: sessionId, ...signedSession };
  }

  if (session) {
    sessions.delete(sessionId);
  }
  return null;
}

function wantsHtml(req) {
  return String(req.headers.accept || "").includes("text/html");
}

function isPublicRequest(url) {
  return (
    url.pathname === "/login"
    || url.pathname === "/styles.css"
    || url.pathname === "/app.js"
    || url.pathname.startsWith("/assets/")
    || url.pathname === "/api/health"
    || url.pathname === "/api/auth/me"
    || url.pathname === "/api/auth/password/login"
    || url.pathname === "/api/auth/dingtalk/login"
    || url.pathname === "/api/auth/dingtalk/callback"
    || url.pathname === "/api/auth/dingtalk/frame-complete"
  );
}

function requireAuth(req, res, url) {
  if (!isAuthEnabled() || isPublicRequest(url)) return true;
  const session = getSession(req);
  if (session) {
    req.user = session.user;
    return true;
  }
  if (req.method === "GET" && wantsHtml(req)) {
    sendRedirect(res, "/login");
  } else {
    sendJson(res, 401, { ok: false, error: "请先登录探嘉 BI。" });
  }
  return false;
}

function getAccessRole(user) {
  const role = String(user?.role || "").trim();
  if (["主账号", "系统管理员"].includes(role)) return role;
  if (["系统管理员", "管理员", "admin"].includes(role)) return "系统管理员";
  if (["财务", "主账户", "owner"].includes(role)) return "主账号";
  return "子账号";
}

function isSystemAdmin(user) {
  return getAccessRole(user) === "系统管理员";
}

function isMainOrSystemAccount(user) {
  return ["主账号", "系统管理员"].includes(getAccessRole(user));
}

function isFinanceUser(user) {
  return isMainOrSystemAccount(user);
}

function requireAdmin(req, res) {
  if (!isAuthEnabled()) return true;
  if (isSystemAdmin(req.user)) return true;
  sendJson(res, 403, { ok: false, error: "当前账号没有后台账号管理权限。" });
  return false;
}

function requireFinance(req, res) {
  if (!isAuthEnabled()) return true;
  if (isFinanceUser(req.user)) return true;
  sendJson(res, 403, { ok: false, error: "当前账号没有财务板块权限，请联系管理员配置。" });
  return false;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function readSalesDashboardFilters(url) {
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const currencyCode = url.searchParams.get("currencyCode") || "CNY";
  const listingOwner = String(url.searchParams.get("listingOwner") || url.searchParams.get("owner") || "").trim();
  const sids = (url.searchParams.get("sids") || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Boolean);

  return { startDate, endDate, currencyCode, sids, listingOwner };
}

function readNumberList(value) {
  return String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Boolean);
}

function readFbaFreightFilters(url) {
  return {
    startDate: url.searchParams.get("startDate") || "",
    endDate: url.searchParams.get("endDate") || "",
    sids: url.searchParams.get("sids") || url.searchParams.get("sid") || "",
    shipmentId: url.searchParams.get("shipmentId") || url.searchParams.get("shipment_id") || "",
    shipmentStatus: url.searchParams.get("shipmentStatus") || url.searchParams.get("shipment_status") || "",
    offset: url.searchParams.get("offset") || "",
    length: url.searchParams.get("length") || "",
    forceRefresh: ["1", "true"].includes(String(url.searchParams.get("forceRefresh") || "").toLowerCase()),
  };
}

const adminSeed = {
  users: [
    { name: "系统管理员", role: "系统管理员", scope: "全部店铺" },
    { name: "主账号", role: "主账号", scope: "全部业务板块，不含后台管理" },
    { name: "子账号", role: "子账号", scope: "业务板块，不含财务和后台管理" },
  ],
  shops: [
    { name: "Amazon-美国4", owner: "销售主管", status: "启用" },
    { name: "Amazon-加拿大4", owner: "销售主管", status: "启用" },
    { name: "Amazon-澳大利亚4", owner: "销售主管", status: "启用" },
  ],
  targets: [
    { month: "2026-04", scope: "美国站", salesTarget: "324.51万", profitTarget: "5.68万" },
    { month: "2026-04", scope: "加拿大站", salesTarget: "45.50万", profitTarget: "0.65万" },
    { month: "2026-04", scope: "澳大利亚站", salesTarget: "40.24万", profitTarget: "3.80万" },
  ],
};

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const routePath = url.pathname === "/" ? "/index.html" : url.pathname === "/login" ? "/login.html" : url.pathname;
  const pathname = decodeURIComponent(routePath);
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const ext = path.extname(filePath);
    const entry = await readStaticFileEntry(filePath);
    const headers = {
      "cache-control": staticCacheControl(ext),
      "content-type": mimeTypes[ext] || "application/octet-stream",
      etag: entry.etag,
      "last-modified": entry.modifiedAt,
    };
    if (requestHasEtag(req, entry.etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers["content-length"] = String(entry.content.length);
    res.writeHead(200, headers);
    res.end(entry.content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function createApiRoutes(routes) {
  return routes.map((route) => {
    if (!Object.hasOwn(route, "auth")) {
      throw new Error(`API route ${route.method || ""} ${route.path || route.pattern || ""} is missing an explicit auth field.`);
    }
    if (!["none", "session", "finance", "admin"].includes(route.auth)) {
      throw new Error(`API route ${route.method || ""} ${route.path || route.pattern || ""} has unsupported auth mode: ${route.auth}`);
    }
    if (!route.method || (!route.path && !route.pattern) || typeof route.handler !== "function") {
      throw new Error("API route requires method, path or pattern, and handler.");
    }
    if (route.pattern && !(route.pattern instanceof RegExp)) {
      throw new Error(`API route ${route.method || ""} ${route.path || ""} pattern must be a RegExp.`);
    }
    return {
      ...route,
      method: String(route.method).toUpperCase(),
    };
  });
}

const apiRoutes = createApiRoutes(buildApiRoutes({
  config,
  sessionCookieName,
  oauthStateCookieName,
  sessionTtlMs,
  oauthStateTtlMs,
  frameLoginTicketTtlMs,
  sessions,
  oauthStates,
  frameLoginTickets,
  getConfig,
  getSession,
  getSyncState,
  getSyncStatus,
  getLingxingShops,
  getLingxingAdapter,
  getAiProviderStatus,
  updateAiProviderSettings,
  testAiProviderConnection,
  sendJson,
  readJsonBody,
  readSalesDashboardFilters,
  readNumberList,
  readFbaFreightFilters,
  sendCachedImage,
  contentDispositionAttachment,
  sendRedirect,
  sendFrameRedirect,
  randomToken,
  parseCookies,
  serializeCookie,
  clearCookie,
  cleanupAuthStores,
  isAuthEnabled,
  isPasswordLoginEnabled,
  isDingtalkLoginConfigured,
  buildCanonicalDingtalkLoginRedirect,
  buildDingtalkLoginUrl,
  exchangeDingtalkCode,
  fetchDingtalkMe,
  resolveDingtalkLogin,
  createSession,
  validatePasswordLogin,
  adminSeed,
  isFinanceUser,
  getSalesWeeklyDashboard,
  resolveActiveAiProviderConfig,
  generateAiListingCopy,
  getMskuDetailDashboard,
  getDailyProductPulse,
  getSalesForecastDashboard,
  exportSalesForecastEstimateXlsx,
  saveSalesForecastManualDailyRow,
  migrateSalesForecastManualDailyRows,
  saveSalesForecastHiddenRow,
  getAdPortfolioDashboard,
  getAdKeywordDashboard,
  getAdKeywordAnalysisDashboard,
  getAdPerformanceReview,
  getAftersalesDashboard,
  getAftersalesMailDashboard,
  syncAftersalesMail,
  getAftersalesMailAttachment,
  getAftersalesMailMessage,
  generateAftersalesMailSuggestion,
  sendAftersalesMailReply,
  updateAftersalesMailStatus,
  getInventoryProvisionDashboard,
  exportInventoryProvisionDetailXlsx,
  getSlowMovingRiskDashboard,
  listSlowMovingRiskReports: () => slowMovingRiskSnapshotStore.list(),
  readSlowMovingRiskReport: (reportKey) => slowMovingRiskSnapshotStore.read(reportKey),
  getLowInventoryFeeDashboard,
  getFactoryInventoryDashboard,
  saveFactoryInventoryShippedQuantity,
  getPlatformCashflowDashboard,
  getPayablesDashboard,
  getSupplierBoardDashboard,
  runPlatformCashflowCapture,
  listSupplierDetails,
  saveSupplierDetail,
  importSupplierDetails,
  deleteSupplierDetail,
  debugInventoryProvisionSource,
  debugLowInventoryLedgerSource,
  listKnowledgeDocuments,
  getFbaShopOptions,
  searchFbaMskus,
  getFbaFreightShipments,
  getFbaShipmentCandidates,
  listFbaForwarderTemplates,
  exportFbaFreightShipments,
  convertFbaFreightShipmentsToForwarderTemplate,
  listFreightRates,
  saveFreightRate,
  deleteFreightRate,
  exportFreightRateLogsCsv,
  listFbaShipmentOrderWarehouses,
  createReadySendFbaShipmentOrders,
  listJiufangChannels,
  dryRunJiufangFbaOrders,
  createJiufangFbaOrders,
  saveFbaBoxTemplate,
  getFbaStaAutomationState,
  updateFbaStaAutomation,
  createFbaStaTasks,
  runFbaStaTaskNow,
  updateFbaStaTask,
  deleteFbaStaTask,
  runStaWarehouseProbe,
  listWebhookTasks,
  createWebhookTask,
  updateWebhookTask,
  deleteWebhookTask,
  sendWebhookTaskNow,
  listAuthUsers,
  listDingtalkAuthUsers,
  updateDingtalkAuthUser,
  deleteDingtalkAuthUser,
  createAuthUser,
  updateAuthUser,
  deleteAuthUser,
  listBudgetUploads,
  listBudgetTargets,
  saveBudgetUpload,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  runManualSync,
  getStoreInspectionDashboard,
  getStoreInspectionSettings,
  updateStoreInspectionSettings,
  getStoreInspectionMarkdown,
  runStoreInspection,
  updateErpBuyerMessageManualStatus,
}));

function matchApiRoute(req, url) {
  for (const route of apiRoutes) {
    if (route.method !== req.method) continue;
    if (route.path && route.path === url.pathname) return { route, params: {} };
    if (route.pattern) {
      const match = route.pattern.exec(url.pathname);
      if (match) return { route, params: match.groups || {} };
    }
  }
  return null;
}

function authorizeApiRoute(route, req, res, url) {
  if (route.auth === "none") return true;
  if (!requireAuth(req, res, url)) return false;
  if (route.auth === "session") return true;
  if (route.auth === "finance") return requireFinance(req, res);
  if (route.auth === "admin") return requireAdmin(req, res);
  throw new Error(`Unsupported route auth mode: ${route.auth}`);
}

async function dispatchApiRoute(req, res, url) {
  const match = matchApiRoute(req, url);
  if (!match) return false;
  const { route, params } = match;
  if (!authorizeApiRoute(route, req, res, url)) return true;
  try {
    await route.handler({ req, res, url, params });
  } catch (error) {
    sendJson(res, error.statusCode || route.errorStatusCode || 500, {
      ok: false,
      error: error.message || "Internal server error",
      details: error.details || null,
      endpoint: error.endpoint || route.path || String(route.pattern),
    });
  }
  return true;
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (await dispatchApiRoute(req, res, url)) return;

  if (req.method === "GET") {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

startSyncScheduler();
startPlatformCashflowScheduler();
startFbaStaScheduler();
startStoreInspectionScheduler();
startWebhookAssistantScheduler();
startFactoryInventoryWarmupScheduler();
startFbaShipmentWarmupScheduler();
startDefaultDashboardWarmupScheduler();
startSlowMovingRiskWeeklyScheduler();

const server = http.createServer((req, res) => {
  router(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
      details: error.details || null,
      endpoint: error.endpoint || "",
    });
  });
});

server.listen(config.port, () => {
  console.log(`探嘉服务已启动：http://localhost:${config.port}`);
  console.log(`数据源：${config.dataProvider}，自动同步间隔：${config.syncIntervalHours} 小时`);
});

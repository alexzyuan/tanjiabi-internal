import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_PORT = 4173;
const DEFAULT_SYNC_INTERVAL_HOURS = 12;
const DOT_ENV_MANAGED_KEYS = new Set([
  "AFTERSALES_MAIL_ENABLED",
  "AFTERSALES_MAIL_PASSWORD",
]);
const dotEnvPath = path.join(process.cwd(), ".env");

function loadDotEnv(envPath = dotEnvPath) {
  if (!existsSync(envPath)) return {};

  return readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#") && trimmed.includes("=");
    })
    .reduce((acc, line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const rawValue = line.slice(index + 1);
      const managedPassword = key === "AFTERSALES_MAIL_PASSWORD";
      const value = managedPassword
        ? rawValue.replace(/^\s*(["'])([\s\S]*)\1\s*$/, "$2")
        : rawValue.trim().replace(/^["']|["']$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

let dotEnv = loadDotEnv(dotEnvPath);
let dotEnvLoaded = existsSync(dotEnvPath);
let preferDotEnvKeys = new Set();

export function reloadDotEnv() {
  dotEnv = loadDotEnv(dotEnvPath);
  dotEnvLoaded = existsSync(dotEnvPath);
  preferDotEnvKeys = new Set([...DOT_ENV_MANAGED_KEYS].filter((key) => Object.hasOwn(dotEnv, key)));
  return { ...dotEnv };
}

export function readEnv(name, fallback = "") {
  if (preferDotEnvKeys.has(name) && dotEnv[name] !== undefined) return dotEnv[name];
  return process.env[name] || dotEnv[name] || fallback;
}

function readBool(name, fallback = false) {
  const value = String(readEnv(name, fallback ? "true" : "false")).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function hasEnv(name) {
  return process.env[name] !== undefined || dotEnv[name] !== undefined;
}

function readList(name) {
  return readEnv(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readMailboxAccounts(name) {
  return readList(name)
    .map((item) => {
      const separator = item.includes("|") ? "|" : ":";
      const [user, ...passwordParts] = item.split(separator);
      return {
        user: String(user || "").trim(),
        password: passwordParts.join(separator).trim(),
      };
    })
    .filter((item) => item.user && item.password);
}

function readKeyValueMap(name) {
  return readList(name)
    .map((item) => {
      const [key, ...valueParts] = item.split("=");
      return [String(key || "").trim().toLowerCase(), valueParts.join("=").trim()];
    })
    .filter(([key, value]) => key && value)
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
}

function defaultDingtalkUsers() {
  return {
    "徐智远": "024662116226579969999",
    "Billy-林芃": "2221374053956163143",
    "林芃": "2221374053956163143",
    "熊丹轩": "361967580828589914",
    "陆俊辉": "02431831284237639621",
    "黄超": "22381010461296193",
    "陈雯婷": "250313641238192560",
  };
}

function defaultStoreOwners() {
  return {
    "xiamentanjia-us": "林芃",
    "tanjia-eu-de": "林芃",
    "xiamentanjia-ca": "熊丹轩",
    "xiamentanjia-au": "黄超",
    "tandanbo-us": "熊丹轩",
    "tandanbo-ca": "熊丹轩",
    "tandanbo-au": "黄超",
  };
}

export function getConfig() {
  const dingtalkClientId = readEnv("DINGTALK_CLIENT_ID");
  const dingtalkClientSecret = readEnv("DINGTALK_CLIENT_SECRET");
  const dingtalkRedirectUri = readEnv("DINGTALK_REDIRECT_URI");
  const dingtalkLoginConfigured = Boolean(dingtalkClientId && dingtalkClientSecret && dingtalkRedirectUri);
  const localUsername = readEnv("AUTH_USERNAME");
  const localPassword = readEnv("AUTH_PASSWORD");
  const localLoginConfigured = Boolean(localUsername && localPassword);
  const lingxingAppKey = readEnv("LINGXING_APP_KEY");
  const lingxingAppSecret = readEnv("LINGXING_APP_SECRET");
  const explicitDataProvider = readEnv("DATA_PROVIDER");
  const dataProvider = explicitDataProvider || (lingxingAppKey && lingxingAppSecret ? "lingxing" : "mock");
  const environment = String(readEnv("NODE_ENV", "development")).trim().toLowerCase() || "development";
  const production = environment === "production";
  const authEnabled = hasEnv("AUTH_ENABLED")
    ? readBool("AUTH_ENABLED", false)
    : production || dingtalkLoginConfigured || localLoginConfigured;

  return {
    port: Number(readEnv("PORT", DEFAULT_PORT)),
    syncIntervalHours: Number(readEnv("SYNC_INTERVAL_HOURS", DEFAULT_SYNC_INTERVAL_HOURS)),
    inventoryLedgerRebuildAt: readEnv("INVENTORY_LEDGER_REBUILD_AT", "02:00"),
    inventoryLedgerRebuildEnabled: readBool("INVENTORY_LEDGER_REBUILD_ENABLED", false),
    dataProvider,
    runtime: {
      cwd: process.cwd(),
      envPath: dotEnvPath,
      envLoaded: dotEnvLoaded,
      dataProviderExplicit: Boolean(explicitDataProvider),
      environment,
      production,
    },
    auth: {
      enabled: authEnabled,
      sessionSecret: readEnv("SESSION_SECRET"),
      cookieSecure: readBool("AUTH_COOKIE_SECURE", false),
      local: {
        username: localUsername,
        password: localPassword,
      },
      allowedMobiles: readList("AUTH_ALLOWED_MOBILES"),
      allowedUnionIds: readList("AUTH_ALLOWED_UNION_IDS"),
      allowedOpenIds: readList("AUTH_ALLOWED_OPEN_IDS"),
    },
    lingxing: {
      baseUrl: readEnv("LINGXING_BASE_URL", "https://openapi.lingxing.com"),
      appKey: lingxingAppKey,
      appSecret: lingxingAppSecret,
      accessToken: readEnv("LINGXING_ACCESS_TOKEN"),
      refreshToken: readEnv("LINGXING_REFRESH_TOKEN"),
      fbaInventoryEndpoint: readEnv("LINGXING_FBA_INVENTORY_ENDPOINT", "/basicOpen/openapi/storage/fbaWarehouseDetail"),
      buyerMessageEndpoint: readEnv("LINGXING_BUYER_MESSAGE_ENDPOINT", "/erp/sc/data/mail/lists"),
      buyerMessageEmail: readEnv("LINGXING_BUYER_MESSAGE_EMAIL"),
      buyerMessageEmails: readList("LINGXING_BUYER_MESSAGE_EMAILS"),
      buyerMessageEmailStoreMap: readKeyValueMap("LINGXING_BUYER_MESSAGE_EMAIL_STORE_MAP"),
      buyerMessageFlag: readEnv("LINGXING_BUYER_MESSAGE_FLAG", "receive"),
      buyerMessageRecentDays: Number(readEnv("LINGXING_BUYER_MESSAGE_RECENT_DAYS", 2)),
      buyerMessageReplyMailboxes: readMailboxAccounts("LINGXING_BUYER_MESSAGE_REPLY_MAILBOXES"),
      buyerMessageReplyImapHost: readEnv("LINGXING_BUYER_MESSAGE_REPLY_IMAP_HOST", "imap.163.com"),
      buyerMessageReplyImapPort: Number(readEnv("LINGXING_BUYER_MESSAGE_REPLY_IMAP_PORT", 993)),
      buyerMessageReplySentMailbox: readEnv("LINGXING_BUYER_MESSAGE_REPLY_SENT_MAILBOX", "已发送"),
      buyerMessageReplyLookbackDays: Number(readEnv("LINGXING_BUYER_MESSAGE_REPLY_LOOKBACK_DAYS", 14)),
      buyerMessageReplyMaxMessages: Number(readEnv("LINGXING_BUYER_MESSAGE_REPLY_MAX_MESSAGES", 200)),
      sellerFeedbackEndpoint: readEnv("LINGXING_SELLER_FEEDBACK_ENDPOINT", "/erp/sc/cs/feedback/listMws"),
      payablePurchaseEndpoint: readEnv("LINGXING_PAYABLE_PURCHASE_ENDPOINT", "/basicOpen/finance/requestFundsPool/purchase/list"),
      payableLogisticsEndpoint: readEnv("LINGXING_PAYABLE_LOGISTICS_ENDPOINT", readEnv("LINGXING_PAYABLE_FREIGHT_ENDPOINT", "/basicOpen/finance/requestFundsPool/logistics/list")),
      payableOtherEndpoint: readEnv("LINGXING_PAYABLE_OTHER_ENDPOINT", ""),
      purchaseOrderEndpoint: readEnv("LINGXING_PURCHASE_ORDER_ENDPOINT", "/erp/sc/routing/data/local_inventory/purchaseOrderList"),
      supplierSalesStatEndpoint: readEnv("LINGXING_SUPPLIER_SALES_STAT_ENDPOINT", "/basicOpen/platformStatisticsV2/saleStat/pageList"),
      replenishmentAdviceEndpoint: readEnv("LINGXING_REPLENISHMENT_ADVICE_ENDPOINT", "/erp/sc/routing/msupply/replenishmentAdvice"),
    },
    jiufang: {
      baseUrl: readEnv("JIUFANG_API_BASE_URL", "https://cgi.jiufanglogistics.cn/api/"),
      username: readEnv("JIUFANG_USERNAME"),
      passwordMd5: readEnv("JIUFANG_PASSWORD_MD5"),
      token: readEnv("JIUFANG_TOKEN"),
      defaultDepartureCode: readEnv("JIUFANG_DEFAULT_DEPARTURE_CODE", "SZ"),
      defaultServiceCode: readEnv("JIUFANG_DEFAULT_SERVICE_CODE"),
    },
    ai: {
      provider: readEnv("AI_PROVIDER", "modelscope"),
      modelscope: {
        endpoint: readEnv("MODELSCOPE_API_ENDPOINT", "https://api-inference.modelscope.cn/v1"),
        apiKey: readEnv("MODELSCOPE_API_KEY"),
        model: readEnv("MODELSCOPE_MODEL", "deepseek-ai/DeepSeek-V4-Flash"),
        timeoutMs: Number(readEnv("MODELSCOPE_TIMEOUT_MS", 120000)),
        maxOutputTokens: Number(readEnv("MODELSCOPE_MAX_OUTPUT_TOKENS", 3000)),
      },
      gemini: {
        endpoint: readEnv("GEMINI_API_ENDPOINT", "https://generativelanguage.googleapis.com/v1beta"),
        apiKey: readEnv("GEMINI_API_KEY", readEnv("GOOGLE_API_KEY")),
        model: readEnv("GEMINI_MODEL", "gemini-2.5-flash"),
        timeoutMs: Number(readEnv("GEMINI_TIMEOUT_MS", 120000)),
        maxOutputTokens: Number(readEnv("GEMINI_MAX_OUTPUT_TOKENS", 3000)),
        proxyUrl: readEnv("GEMINI_PROXY_URL", readEnv("HTTPS_PROXY", readEnv("HTTP_PROXY"))),
      },
    },
    aftersalesMail: {
      enabled: readBool("AFTERSALES_MAIL_ENABLED", false),
      user: readEnv("AFTERSALES_MAIL_USER", "jmcustomer@163.com"),
      password: readEnv("AFTERSALES_MAIL_PASSWORD"),
      imapHost: readEnv("AFTERSALES_MAIL_IMAP_HOST", "imap.163.com"),
      imapPort: Number(readEnv("AFTERSALES_MAIL_IMAP_PORT", 993)),
      sentMailbox: readEnv("AFTERSALES_MAIL_SENT_MAILBOX", "已发送"),
      smtpHost: readEnv("AFTERSALES_MAIL_SMTP_HOST", "smtp.163.com"),
      smtpPort: Number(readEnv("AFTERSALES_MAIL_SMTP_PORT", 465)),
      lookbackDays: Number(readEnv("AFTERSALES_MAIL_LOOKBACK_DAYS", 14)),
      maxMessages: Number(readEnv("AFTERSALES_MAIL_MAX_MESSAGES", 100)),
    },
    dashboard: {
      startDate: readEnv("DASHBOARD_START_DATE"),
      endDate: readEnv("DASHBOARD_END_DATE"),
    },
    storeInspection: {
      enabled: readBool("STORE_INSPECTION_ENABLED", true),
      intervalHours: Number(readEnv("STORE_INSPECTION_INTERVAL_HOURS", 24)),
      sendTime: readEnv("STORE_INSPECTION_SEND_TIME", "08:30"),
      notifyEnabled: readBool("STORE_INSPECTION_NOTIFY_ENABLED", false),
      notifyOnClean: readBool("STORE_INSPECTION_NOTIFY_ON_CLEAN", true),
      lookbackDays: Number(readEnv("STORE_INSPECTION_LOOKBACK_DAYS", 30)),
      dingtalkUsers: {
        ...defaultDingtalkUsers(),
        ...readKeyValueMap("STORE_INSPECTION_DINGTALK_USERS"),
      },
      storeOwners: {
        ...defaultStoreOwners(),
        ...readKeyValueMap("STORE_INSPECTION_STORE_OWNERS"),
      },
    },
    dingtalk: {
      webhook: readEnv("DINGTALK_WEBHOOK"),
      secret: readEnv("DINGTALK_SECRET"),
      atMobiles: readList("DINGTALK_AT_MOBILES"),
      atUserIds: readList("DINGTALK_AT_USER_IDS"),
      fba: {
        webhook: readEnv("FBA_DINGTALK_WEBHOOK"),
        secret: readEnv("FBA_DINGTALK_SECRET"),
        atMobiles: readList("FBA_DINGTALK_AT_MOBILES"),
        atUserIds: readList("FBA_DINGTALK_AT_USER_IDS"),
      },
      login: {
        clientId: dingtalkClientId,
        clientSecret: dingtalkClientSecret,
        redirectUri: dingtalkRedirectUri,
      },
    },
  };
}

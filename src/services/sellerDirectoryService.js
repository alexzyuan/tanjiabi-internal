import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { normalizeRecordList } from "../utils/recordAccess.js";
import { readLingxingSellersCache, saveLingxingSellersCache } from "../utils/cacheStore.js";

const SELLER_ENDPOINT = "/erp/sc/data/seller/lists";

export class SellerDirectoryUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SellerDirectoryUnavailableError";
  }
}

function firstValue(records, keys) {
  for (const key of keys) {
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const value = record[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return "";
}

function textValue(records, keys) {
  const value = firstValue(records, keys);
  return value === "" ? "" : String(value).trim();
}

export function normalizeSellerRecord(record = {}) {
  const sources = [record, record.seller, record.shop, record.store, record.account];
  const explicitSid = firstValue(sources, ["sid", "id", "seller_id_local", "store_id", "storeId", "seller_id"]);
  const sellerIdAlias = textValue(sources, ["sellerId"]);
  const sid = Number(explicitSid || sellerIdAlias);
  const name = textValue(sources, ["name", "seller_name", "sellerName", "shop_name", "shopName", "store_name", "storeName", "account_name", "accountName"]);
  if (!Number.isFinite(sid) || sid <= 0 || !name) return null;

  const country = textValue(sources, ["country", "country_name", "countryName", "marketplace", "marketplace_name", "marketplaceName", "region"]);
  const countryCode = textValue(sources, ["countryCode", "country_code", "marketplaceCode", "marketplace_code", "site"]).toUpperCase();
  const displayName = textValue(sources, ["displayName", "display_name", "display", "label"]) || name;
  const sellerIdCandidate = textValue(sources, ["seller_id_amazon", "amazon_seller_id", "amazonSellerId", "sellerId", "seller_id"]);
  const sellerId = sellerIdCandidate && (!Number.isFinite(Number(sellerIdCandidate)) || Number(sellerIdCandidate) !== sid)
    ? sellerIdCandidate
    : "";
  const marketplaceId = textValue(sources, ["marketplaceId", "marketplace_id"]);
  const mid = firstValue(sources, ["mid", "merchant_id", "merchantId"]);
  const status = firstValue(sources, ["status", "seller_status", "sellerStatus"]);

  return {
    sid,
    name,
    country,
    countryCode,
    displayName,
    sellerId,
    seller_id: sellerId,
    marketplaceId,
    marketplace_id: marketplaceId,
    mid,
    status,
    raw: record,
  };
}

export function normalizeSellerRecords(payload) {
  const bySid = new Map();
  normalizeRecordList(payload).forEach((record) => {
    const seller = normalizeSellerRecord(record);
    if (seller) bySid.set(seller.sid, seller);
  });
  return [...bySid.values()];
}

function writeLog(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[seller-directory]", details);
}

function errorDetails(error, operation) {
  const details = {
    operation,
    errorName: error?.name || "Error",
  };
  const code = error?.code;
  const status = error?.status || error?.statusCode || error?.response?.status;
  const message = String(error?.message || "未知错误").slice(0, 300);
  if (code !== undefined && code !== null && String(code).trim()) details.errorCode = String(code);
  if (status !== undefined && status !== null && String(status).trim()) details.errorStatus = Number(status) || String(status);
  details.errorMessage = message;
  return details;
}

function logDirectoryError(logger, error, { source, sellerCount, operation }) {
  writeLog(logger, "error", {
    source,
    cacheHit: false,
    sellerCount,
    endpoint: SELLER_ENDPOINT,
    operation,
    ...errorDetails(error, operation),
  });
}

function defaultNowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

export async function getSellerDirectory({
  adapter = getLingxingAdapter(),
  forceRefresh = false,
  logger = console,
  nowText = defaultNowText,
  readCache = readLingxingSellersCache,
  saveCache = saveLingxingSellersCache,
} = {}) {
  if (!forceRefresh) {
    let cached;
    try {
      cached = await readCache();
    } catch (error) {
      logDirectoryError(logger, error, {
        source: "lingxing-sellers-cache",
        sellerCount: 0,
        operation: "read-cache",
      });
      throw error;
    }
    const sellers = normalizeSellerRecords(cached?.sellers || []);
    if (sellers.length) {
      const meta = {
        source: "lingxing-sellers-cache",
        cacheHit: true,
        sellerCount: sellers.length,
        updatedAt: cached?.updatedAt || "",
      };
      writeLog(logger, "info", {
        source: meta.source,
        cacheHit: meta.cacheHit,
        sellerCount: meta.sellerCount,
        endpoint: SELLER_ENDPOINT,
      });
      return { sellers, meta };
    }
  }

  let payload;
  try {
    payload = await adapter.fetchSellers();
  } catch (error) {
    logDirectoryError(logger, error, {
      source: "lingxing-api",
      sellerCount: 0,
      operation: "fetch",
    });
    throw error;
  }

  const sellers = normalizeSellerRecords(payload);
  if (!sellers.length) {
    const error = new SellerDirectoryUnavailableError("领星店铺目录返回空店铺列表，无法继续加载业务店铺。");
    logDirectoryError(logger, error, {
      source: "lingxing-api",
      sellerCount: 0,
      operation: "normalize",
    });
    throw error;
  }

  try {
    await saveCache(sellers);
  } catch (error) {
    logDirectoryError(logger, error, {
      source: "lingxing-api",
      sellerCount: sellers.length,
      operation: "save-cache",
    });
    throw error;
  }
  const meta = {
    source: "lingxing-api",
    cacheHit: false,
    sellerCount: sellers.length,
    updatedAt: nowText(),
  };
  writeLog(logger, "info", {
    source: meta.source,
    cacheHit: meta.cacheHit,
    sellerCount: meta.sellerCount,
    endpoint: SELLER_ENDPOINT,
  });
  return { sellers, meta };
}

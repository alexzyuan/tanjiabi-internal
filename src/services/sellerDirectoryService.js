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
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const key of keys) {
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
  const sid = Number(firstValue(sources, ["sid", "id", "seller_id_local", "sellerId", "store_id", "storeId", "seller_id"]));
  const name = textValue(sources, ["name", "seller_name", "sellerName", "shop_name", "shopName", "store_name", "storeName", "account_name", "accountName"]);
  if (!Number.isFinite(sid) || sid <= 0 || !name) return null;

  const country = textValue(sources, ["country", "country_name", "countryName", "marketplace", "marketplace_name", "marketplaceName", "region"]);
  const countryCode = textValue(sources, ["countryCode", "country_code", "marketplaceCode", "marketplace_code", "site"]).toUpperCase();
  const displayName = textValue(sources, ["displayName", "display_name", "display", "label"]) || name;
  const sellerId = textValue(sources, ["seller_id_amazon", "amazon_seller_id", "amazonSellerId", "sellerId", "seller_id"]);
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
    marketplaceId,
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
    const cached = await readCache();
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
    writeLog(logger, "error", {
      source: "lingxing-api",
      cacheHit: false,
      sellerCount: 0,
      endpoint: SELLER_ENDPOINT,
      errorName: error?.name || "Error",
    });
    throw error;
  }

  const sellers = normalizeSellerRecords(payload);
  if (!sellers.length) {
    const error = new SellerDirectoryUnavailableError("领星店铺目录返回空店铺列表，无法继续加载业务店铺。");
    writeLog(logger, "error", {
      source: "lingxing-api",
      cacheHit: false,
      sellerCount: 0,
      endpoint: SELLER_ENDPOINT,
      errorName: error.name,
    });
    throw error;
  }

  await saveCache(sellers);
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

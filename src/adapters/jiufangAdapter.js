import { getConfig } from "../config/index.js";

const REDACT_KEYS = new Set([
  "authorization",
  "password",
  "passwordmd5",
  "token",
  "access_token",
  "apikey",
  "api_key",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class JiufangApiError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "JiufangApiError";
    Object.assign(this, fields);
  }
}

export function redactJiufangPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactJiufangPayload(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (REDACT_KEYS.has(String(key).toLowerCase())) return [key, "[REDACTED]"];
    return [key, redactJiufangPayload(item)];
  }));
}

function assertConfigured(config = {}) {
  const missing = [];
  if (!config.baseUrl) missing.push("JIUFANG_API_BASE_URL");
  if (!config.username) missing.push("JIUFANG_USERNAME");
  if (!config.passwordMd5) missing.push("JIUFANG_PASSWORD_MD5");
  if (!config.token) missing.push("JIUFANG_TOKEN");
  if (missing.length) throw new Error(`Jiufang adapter missing config: ${missing.join(", ")}`);
}

function normalizeEndpoint(endpoint = "") {
  const text = String(endpoint || "").trim();
  if (!text.startsWith("/")) throw new Error(`Jiufang endpoint must start with /: ${text}`);
  return text;
}

function buildUrl(baseUrl, endpoint, lang = "zh_CN") {
  const normalizedBase = String(baseUrl || "").endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(normalizeEndpoint(endpoint).replace(/^\//, ""), normalizedBase);
  url.searchParams.set("lang", lang);
  return url;
}

function security(config) {
  return {
    Username: config.username,
    Password: config.passwordMd5,
  };
}

function jiufangErrorMessage(endpoint, payload, status) {
  const description = payload?.Error?.Description
    || payload?.ResponseStatus?.Description
    || payload?.message
    || `HTTP ${status}`;
  return `Jiufang ${endpoint} failed: ${description}`;
}

export function createJiufangAdapter({
  config = getConfig().jiufang,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 30_000,
  retryDelayMs = 200,
} = {}) {
  const jiufangConfig = { ...config };

  async function request(endpoint, body = {}, {
    lang = "zh_CN",
    retries = 0,
    bodyMode = "securityObject",
  } = {}) {
    assertConfigured(jiufangConfig);
    const url = buildUrl(jiufangConfig.baseUrl, endpoint, lang);
    const headers = {
      "content-type": "application/json",
      Authorization: `Bearer ${jiufangConfig.token}`,
    };
    const requestBody = bodyMode === "topLevelCredentials"
      ? { Username: jiufangConfig.username, Password: jiufangConfig.passwordMd5, ...body }
      : { Security: security(jiufangConfig), ...body };

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response;
      let payload;
      try {
        response = await fetchWithTimeout(fetchImpl, url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        }, timeoutMs);
        payload = await response.json();
      } catch (error) {
        lastError = new JiufangApiError(`Jiufang ${endpoint} request failed: ${error?.message || error}`, {
          endpoint,
          status: 0,
          code: error?.name === "AbortError" ? "TIMEOUT" : "",
          description: error?.name === "AbortError" ? "request timeout" : (error?.message || String(error)),
          retryable: error?.name === "AbortError",
          details: {
            ...redactJiufangPayload(requestBody),
            headers: redactJiufangPayload(headers),
          },
        });
        if (!lastError.retryable || attempt >= retries) throw lastError;
        if (retryDelayMs > 0) await sleep(retryDelayMs);
        continue;
      }

      const errorPayload = payload?.Error;
      const responseDescription = String(payload?.ResponseStatus?.Description || "");
      const responseFailed = payload?.ResponseStatus && responseDescription && responseDescription !== "Success";
      if (!response.ok || errorPayload || responseFailed) {
        throw new JiufangApiError(jiufangErrorMessage(endpoint, payload, response.status), {
          endpoint,
          status: response.status,
          code: errorPayload?.Code || payload?.ResponseStatus?.Code || response.status,
          description: errorPayload?.Description || payload?.ResponseStatus?.Description || response.statusText,
          retryable: response.status >= 500,
          details: {
            ...redactJiufangPayload(requestBody),
            headers: redactJiufangPayload(headers),
            response: redactJiufangPayload(payload),
          },
        });
      }

      return payload;
    }
    throw lastError;
  }

  return {
    request,
    listProducts(params = {}) {
      return request("/v3/product", params, { bodyMode: "topLevelCredentials" });
    },
    rateProduct(params = {}) {
      return request("/v3/product/rate", params);
    },
    createShipment(params = {}) {
      return request("/v3/shipment", params);
    },
    initHdOrder(params = {}) {
      return request("/v3/initDeQingtiPaiWaybillHd", params);
    },
    createHdOrder(params = {}) {
      return request("/v3/saveDeQingtiPaiWaybillHdV2", params);
    },
  };
}

export function getJiufangAdapter(config = getConfig().jiufang) {
  return createJiufangAdapter({ config });
}

import { normalizeLingxingError } from "./errors.js";
import { createSignedParams } from "./sign.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

export function createLingxingClient({
  config = {},
  auth,
  fetchImpl = (...args) => globalThis.fetch(...args),
  buildUrl,
  timeoutMs = 30_000,
  retryDelayMs = 100,
} = {}) {
  const resolveUrl = buildUrl || ((endpoint, queryParams = {}) => {
    const url = new URL(endpoint, config.baseUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return url;
  });

  async function requestOnce(endpoint, {
    method = "POST",
    params = {},
    includeParamsInQuery = false,
    successCodes = [0, "0"],
    acceptSuccessBoolean = false,
    headers: extraHeaders = {},
  } = {}) {
    const tokenData = await auth.ensureAccessToken();
    const accessToken = typeof tokenData === "string" ? tokenData : tokenData?.access_token || config.accessToken;
    const { signedParams, queryParams } = createSignedParams({ params, config, accessToken });
    if (method === "GET" || includeParamsInQuery) Object.assign(queryParams, params);

    const headers = {
      "content-type": "application/json",
      "X-HTTP-Method-Override": method,
      ...extraHeaders,
    };

    let response;
    let payload;
    try {
      response = await fetchWithTimeout(fetchImpl, resolveUrl(endpoint, queryParams), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(signedParams) : undefined,
      }, timeoutMs);
      try {
        payload = await response.json();
      } catch {
        payload = { message: response.statusText };
      }
    } catch (error) {
      throw normalizeLingxingError({
        endpoint,
        method,
        error,
        code: error?.name === "AbortError" ? "TIMEOUT" : "",
        message: error?.name === "AbortError" ? "request timeout" : "",
      });
    }

    const codeSucceeded = successCodes.includes(payload.code);
    const apiSucceeded = (codeSucceeded && payload.success !== false)
      || (acceptSuccessBoolean && payload.success === true);
    if (!response.ok || !apiSucceeded) {
      throw normalizeLingxingError({ endpoint, method, response, payload });
    }

    return payload;
  }

  async function performSignedRequest(endpoint, options = {}) {
    const retries = Number(options.retries ?? 0);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await requestOnce(endpoint, options);
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt >= retries) throw error;
        if (retryDelayMs > 0) await sleep(retryDelayMs);
      }
    }
    throw lastError;
  }

  return { performSignedRequest };
}

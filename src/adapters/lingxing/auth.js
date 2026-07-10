import { normalizeLingxingError } from "./errors.js";

const TOKEN_EXPIRE_SAFETY_MS = 60 * 1000;

function tokenExpiresAt(data = {}) {
  const expiresIn = Number(data.expires_in || data.expiresIn || 0);
  return expiresIn > 0 ? Date.now() + Math.max(0, expiresIn * 1000 - TOKEN_EXPIRE_SAFETY_MS) : 0;
}

function isTokenExpired(state) {
  return Boolean(state?.expiresAt && Date.now() >= state.expiresAt);
}

export function tokenConfigKey(config = {}) {
  return JSON.stringify({
    baseUrl: config.baseUrl || "",
    appKey: config.appKey || "",
    appSecret: config.appSecret || "",
  });
}

export function createTokenState(config = {}) {
  return {
    accessToken: config.accessToken || "",
    refreshToken: config.refreshToken || "",
    expiresAt: 0,
    tokenPromise: null,
    refreshPromise: null,
  };
}

export function createLingxingAuth({
  config = {},
  tokenState = createTokenState(config),
  fetchImpl = (...args) => globalThis.fetch(...args),
  buildUrl,
} = {}) {
  function assertConfigured() {
    if (!config.baseUrl || !config.appKey || !config.appSecret) {
      throw new Error("Lingxing adapter is missing LINGXING_BASE_URL, LINGXING_APP_KEY, or LINGXING_APP_SECRET.");
    }
  }

  function syncTokenConfig() {
    config.accessToken = tokenState.accessToken;
    config.refreshToken = tokenState.refreshToken;
  }

  function updateTokenState(data = {}) {
    tokenState.accessToken = data.access_token || data.accessToken || tokenState.accessToken || "";
    tokenState.refreshToken = data.refresh_token || data.refreshToken || tokenState.refreshToken || "";
    tokenState.expiresAt = tokenExpiresAt(data);
    syncTokenConfig();
    return data;
  }

  async function fetchToken() {
    assertConfigured();
    if (tokenState.tokenPromise) return tokenState.tokenPromise;

    tokenState.tokenPromise = (async () => {
      const form = new FormData();
      form.set("appId", config.appKey);
      form.set("appSecret", config.appSecret);

      const response = await fetchImpl(buildUrl("/api/auth-server/oauth/access-token"), {
        method: "POST",
        body: form,
      });
      const payload = await response.json();

      if (!response.ok || String(payload.code) !== "200") {
        throw normalizeLingxingError({
          endpoint: "/api/auth-server/oauth/access-token",
          method: "POST",
          response,
          payload,
        });
      }

      return updateTokenState(payload.data || {});
    })();

    try {
      return await tokenState.tokenPromise;
    } finally {
      tokenState.tokenPromise = null;
    }
  }

  async function refreshToken() {
    assertConfigured();
    syncTokenConfig();
    if (!tokenState.refreshToken) return fetchToken();
    if (tokenState.refreshPromise) return tokenState.refreshPromise;

    tokenState.refreshPromise = (async () => {
      const form = new FormData();
      form.set("appId", config.appKey);
      form.set("refreshToken", tokenState.refreshToken);

      const response = await fetchImpl(buildUrl("/api/auth-server/oauth/refresh"), {
        method: "POST",
        body: form,
      });
      const payload = await response.json();

      if (!response.ok || String(payload.code) !== "200") {
        return fetchToken();
      }

      return updateTokenState(payload.data || {});
    })();

    try {
      return await tokenState.refreshPromise;
    } finally {
      tokenState.refreshPromise = null;
    }
  }

  async function ensureAccessToken() {
    assertConfigured();
    syncTokenConfig();
    if (!tokenState.accessToken) return fetchToken();
    if (isTokenExpired(tokenState)) return refreshToken();
    return config.accessToken;
  }

  return {
    assertConfigured,
    ensureAccessToken,
    fetchToken,
    refreshToken,
    syncTokenConfig,
    updateTokenState,
    hasAccessToken: () => Boolean(tokenState.accessToken),
  };
}

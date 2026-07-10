const DINGTALK_LOGIN_URL = "https://login.dingtalk.com/oauth2/auth";
const DINGTALK_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken";
const DINGTALK_ME_URL = "https://api.dingtalk.com/v1.0/contact/users/me";

export function isDingtalkLoginConfigured(config) {
  return Boolean(config?.clientId && config?.clientSecret && config?.redirectUri);
}

export function buildCanonicalDingtalkLoginRedirect(config, requestHost, requestPathWithSearch) {
  if (!config?.redirectUri || !requestHost || !requestPathWithSearch) return "";
  let callbackUrl;
  try {
    callbackUrl = new URL(config.redirectUri);
  } catch {
    return "";
  }
  const canonicalHost = callbackUrl.host.toLowerCase();
  const currentHost = String(requestHost || "").split(",")[0].trim().toLowerCase();
  if (!canonicalHost || !currentHost || currentHost === canonicalHost) return "";
  return `${callbackUrl.origin}${requestPathWithSearch}`;
}

export function buildDingtalkLoginUrl(config, state) {
  const url = new URL(DINGTALK_LOGIN_URL);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function exchangeDingtalkCode(config, code) {
  const response = await fetch(DINGTALK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      grantType: "authorization_code",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.accessToken) {
    throw new Error(payload.message || payload.msg || "钉钉授权换取 accessToken 失败");
  }
  return payload;
}

export async function fetchDingtalkMe(accessToken) {
  const response = await fetch(DINGTALK_ME_URL, {
    method: "GET",
    headers: {
      "x-acs-dingtalk-access-token": accessToken,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.msg || "读取钉钉用户信息失败");
  }
  return {
    nick: payload.nick || payload.name || payload.username || "钉钉用户",
    avatarUrl: payload.avatarUrl || "",
    mobile: payload.mobile || "",
    stateCode: payload.stateCode || "",
    openId: payload.openId || payload.openid || "",
    unionId: payload.unionId || payload.unionid || "",
    raw: payload,
  };
}

export function isDingtalkUserAllowed(user, authConfig) {
  const allowedMobiles = new Set(authConfig.allowedMobiles || []);
  const allowedUnionIds = new Set(authConfig.allowedUnionIds || []);
  const allowedOpenIds = new Set(authConfig.allowedOpenIds || []);
  const hasAllowList = allowedMobiles.size || allowedUnionIds.size || allowedOpenIds.size;
  if (!hasAllowList) return true;

  return (
    (user.mobile && allowedMobiles.has(String(user.mobile)))
    || (user.unionId && allowedUnionIds.has(String(user.unionId)))
    || (user.openId && allowedOpenIds.has(String(user.openId)))
  );
}

const sensitiveKeyPattern = /token|secret|password|authorization|app[_-]?key/i;
const sensitiveValuePatterns = [
  /(access_token|refresh_token|app_secret|app_key)=([^&\s]+)/gi,
  /(bearer\s+)[a-z0-9._~+/-]+/gi,
  /(token\s+)[a-z0-9._~+/-]+/gi,
];

export class LingxingRequestError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "LingxingRequestError";
    Object.assign(this, fields);
  }
}

export function redactSensitive(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return sensitiveValuePatterns.reduce(
      (text, pattern) => text.replace(pattern, (_match, prefix) => `${prefix}=[REDACTED]`),
      value,
    );
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));

  return Object.entries(value).reduce((acc, [key, item]) => {
    acc[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactSensitive(item, seen);
    return acc;
  }, {});
}

function payloadMessage(payload = {}, fallback = "Lingxing request failed") {
  return String(payload.message || payload.msg || payload.error || payload.error_message || fallback);
}

function payloadCode(payload = {}, fallback = "") {
  return String(payload.code ?? payload.errorCode ?? payload.errCode ?? fallback ?? "");
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function isLingxingTokenError(payload = {}, response = {}) {
  const status = Number(response?.status || 0);
  if (status === 401 || status === 403) return true;
  const codeText = payloadCode(payload).toLowerCase();
  const messageText = [
    payload.message,
    payload.msg,
    payload.error,
    payload.error_message,
    ...(Array.isArray(payload.errorDetails) ? payload.errorDetails.map((item) => `${item.code || ""} ${item.message || ""}`) : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /access[_ -]?token|token|unauthorized|forbidden|auth|oauth|expired|expire|invalid|登录|授权|鉴权|认证|过期|失效|无效|未登录|未授权/.test(`${codeText} ${messageText}`);
}

export function normalizeLingxingError({
  endpoint = "",
  method = "",
  response = null,
  payload = null,
  error = null,
  code = "",
  message = "",
} = {}) {
  const status = Number(response?.status || 0);
  const normalizedCode = code || (payload ? payloadCode(payload) : "") || (error?.name === "AbortError" ? "TIMEOUT" : error?.code || "REQUEST_ERROR");
  const retryable = normalizedCode === "TIMEOUT"
    || isRetryableStatus(status)
    || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(error?.code);
  const rawMessage = message || (payload ? payloadMessage(payload, response?.statusText) : error?.message) || response?.statusText || "Lingxing request failed";
  const safeMessage = redactSensitive(rawMessage);

  return new LingxingRequestError(`Lingxing API ${endpoint || "request"} failed: ${safeMessage}`, {
    source: "lingxing",
    endpoint,
    method,
    status,
    code: normalizedCode,
    message: safeMessage,
    retryable,
    details: redactSensitive(payload || error?.details || {}),
    cause: error,
    tokenExpired: payload ? isLingxingTokenError(payload, response || {}) : false,
  });
}

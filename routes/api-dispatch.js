export function validApiStatusCode(value) {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : null;
}

function safeErrorName(value) {
  const name = String(value || "Error");
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(name) ? name : "Error";
}

function safeErrorCode(value) {
  const code = String(value || "");
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(code) && !/(token|secret|password|payload|raw|body)/iu.test(code)
    ? code
    : null;
}

function responseStarted(res) {
  return Boolean(res?.headersSent || res?.writableEnded || res?.destroyed);
}

function closePartialResponse(res) {
  if (!res?.headersSent || res.writableEnded || res.destroyed) return "already-closed";
  if (typeof res.end === "function") {
    try {
      res.end();
      return "ended";
    } catch {
      // Fall through to destroy when the response cannot be ended cleanly.
    }
  }
  if (typeof res.destroy === "function") {
    try {
      res.destroy();
      return "destroyed";
    } catch {
      return "unclosable";
    }
  }
  return "unclosable";
}

export async function dispatchApiRoute({
  req,
  res,
  url,
  route,
  params = {},
  authorize,
  sendJson,
  logger = console,
} = {}) {
  if (!route || typeof route.handler !== "function") throw new TypeError("API route handler is required.");
  if (typeof authorize !== "function") throw new TypeError("API route authorizer is required.");
  if (!authorize(route, req, res, url)) return true;
  try {
    await route.handler({ req, res, url, params });
  } catch (error) {
    const endpoint = error?.endpoint || route.path || String(route.pattern);
    if (responseStarted(res)) {
      const responseState = closePartialResponse(res);
      const writeAfterResponse = logger?.error;
      if (typeof writeAfterResponse === "function") {
        writeAfterResponse.call(logger, "[api-error-after-response]", {
          endpoint: route.path || "api-route",
          method: route.method || req?.method || "UNKNOWN",
          responseState,
          errorName: safeErrorName(error?.name),
          errorCode: safeErrorCode(error?.code),
        });
      }
      return true;
    }
    if (typeof route.serializeError === "function") {
      let serialized;
      try {
        serialized = route.serializeError(error, endpoint);
      } catch (serializerError) {
        const writeSerializerError = logger?.error;
        if (typeof writeSerializerError === "function") {
          writeSerializerError.call(logger, "[api-serializer-error]", {
            path: route.path || endpoint,
            method: route.method || req?.method || "UNKNOWN",
            statusCode: 500,
            errorName: safeErrorName(serializerError?.name),
            errorCode: safeErrorCode(serializerError?.code),
          });
        }
        serialized = null;
      }
      const statusCode = validApiStatusCode(serialized?.statusCode) || 500;
      const payload = serialized?.payload && typeof serialized.payload === "object"
        ? serialized.payload
        : { ok: false, error: "Internal server error", details: null, endpoint: route.path || endpoint };
      const log = serialized?.log && typeof serialized.log === "object"
        ? serialized.log
        : { endpoint: route.path || endpoint, statusCode };
      const writeError = logger?.error;
      if (typeof writeError === "function") writeError.call(logger, "[api-error]", log);
      sendJson(res, statusCode, payload);
      return true;
    }
    const statusCode = validApiStatusCode(error?.statusCode)
      || validApiStatusCode(route.errorStatusCode)
      || 500;
    sendJson(res, statusCode, {
      ok: false,
      error: error?.message || "Internal server error",
      details: error?.details || null,
      endpoint,
    });
  }
  return true;
}

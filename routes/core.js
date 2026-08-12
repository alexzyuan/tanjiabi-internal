const SAFE_HEALTH_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SENSITIVE_HEALTH_CODE_PATTERN = /(token|secret|password|payload|raw|body|path)/iu;

function safeHealthCode(value) {
  const code = String(value ?? "");
  return SAFE_HEALTH_CODE_PATTERN.test(code) && !SENSITIVE_HEALTH_CODE_PATTERN.test(code)
    ? code
    : "PRODUCT_CATALOG_HEALTH_ERROR";
}

function safeHealthNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function safeHealthQuickCheck(value) {
  const raw = String(value ?? "").replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim();
  const text = raw.replace(/\s+at\s+\/(?:tmp|Users|var|home|opt)\/.*$/iu, "").trim().slice(0, 120);
  if (text === "ok") return "ok";
  if (!text) return "unavailable";
  if (/(token|secret|password|payload|raw|body|select|pragma|sqlite|\.sqlite|\\|(?:^|\s)\/(?:tmp|Users|var|home|opt)\/)/iu.test(text)) {
    return "unavailable";
  }
  return /^[A-Za-z0-9][A-Za-z0-9 .,:()/'_-]*$/u.test(text) ? text : "unavailable";
}

function sanitizeProductCatalogHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return degradedProductCatalogHealth({ code: "PRODUCT_CATALOG_HEALTH_INVALID" });
  }
  const ok = value.ok === true;
  const quickCheck = safeHealthQuickCheck(value.quickCheck);
  const result = {
    ok,
    status: ok ? "healthy" : "degraded",
    schemaVersion: Number.isInteger(value.schemaVersion) && value.schemaVersion >= 0 ? value.schemaVersion : null,
    quickCheck,
  };
  if (!ok) result.error = safeHealthCode(value.error || "PRODUCT_CATALOG_HEALTH_ERROR");
  for (const field of [
    "revision",
    "listingCount",
    "productCount",
    "aliasCount",
    "metadataCount",
    "schemaMigrationCount",
    "databaseBytes",
    "walBytes",
    "legacyMigratedAt",
  ]) {
    const number = safeHealthNumber(value[field]);
    if (number !== null) result[field] = number;
  }
  return result;
}

function degradedProductCatalogHealth(error) {
  return {
    ok: false,
    status: "degraded",
    schemaVersion: null,
    quickCheck: "unavailable",
    error: safeHealthCode(error?.code || error?.name),
  };
}

export function createCoreRoutes({
  config,
  getSyncState,
  getProductCatalogHealth,
  logger = console,
  getSyncStatus,
  getSession,
  getLingxingShops,
  getAiProviderStatus,
  getConfig,
  updateAiProviderSettings,
  testAiProviderConnection,
  readJsonBody,
  sendJson,
  adminSeed,
  isAuthEnabled,
  isDingtalkLoginConfigured,
  isPasswordLoginEnabled,
} = {}) {
  const readProductCatalogHealth = () => {
    try {
      return sanitizeProductCatalogHealth(getProductCatalogHealth());
    } catch (error) {
      const degraded = degradedProductCatalogHealth(error);
      const log = logger?.error;
      if (typeof log === "function") {
        log.call(logger, "[product-catalog-health]", {
          operation: "health",
          status: "degraded",
          error: degraded.error,
        });
      }
      return degraded;
    }
  };

  return [
    {
      method: "GET",
      path: "/api/health",
      auth: "none",
      handler: async ({ res }) => {
        sendJson(res, 200, {
          ok: true,
          name: "探嘉数据分析系统",
          provider: config.dataProvider,
          runtime: config.runtime,
          sync: getSyncState(),
          productCatalog: readProductCatalogHealth(),
        });
      },
    },
    {
      method: "GET",
      path: "/api/auth/me",
      auth: "none",
      handler: async ({ req, res }) => {
        const session = getSession(req);
        sendJson(res, 200, {
          ok: true,
          enabled: isAuthEnabled(),
          configured: isDingtalkLoginConfigured(config.dingtalk.login) || isPasswordLoginEnabled(),
          dingtalkConfigured: isDingtalkLoginConfigured(config.dingtalk.login),
          localConfigured: isPasswordLoginEnabled(),
          passwordLoginEnabled: isPasswordLoginEnabled(),
          authenticated: Boolean(session),
          user: session?.user || null,
        });
      },
    },
    {
      method: "GET",
      path: "/api/sync/status",
      auth: "session",
      handler: async ({ res }) => {
        sendJson(res, 200, getSyncStatus ? await getSyncStatus() : getSyncState());
      },
    },
    {
      method: "GET",
      path: "/api/lingxing/shops",
      auth: "session",
      handler: async ({ res }) => {
        sendJson(res, 200, await getLingxingShops());
      },
    },
    {
      method: "GET",
      path: "/api/admin/overview",
      auth: "admin",
      handler: async ({ res }) => {
        sendJson(res, 200, adminSeed);
      },
    },
    {
      method: "GET",
      path: "/api/admin/ai-config",
      auth: "admin",
      handler: async ({ res }) => {
        sendJson(res, 200, await getAiProviderStatus(getConfig()));
      },
    },
    {
      method: "PUT",
      path: "/api/admin/ai-config",
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, await updateAiProviderSettings(await readJsonBody(req), getConfig()));
      },
    },
    {
      method: "POST",
      path: "/api/admin/ai-config/test",
      auth: "admin",
      handler: async ({ req, res }) => {
        const payload = await readJsonBody(req);
        sendJson(res, 200, await testAiProviderConnection(payload.provider, getConfig()));
      },
    },
  ];
}

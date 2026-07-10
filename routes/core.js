export function createCoreRoutes({
  config,
  getSyncState,
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

export function createSyncStoreInspectionRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    runManualSync,
    getStoreInspectionDashboard,
    getStoreInspectionSettings,
    updateStoreInspectionSettings,
    getStoreInspectionMarkdown,
    runStoreInspection,
    updateErpBuyerMessageManualStatus,
  } = deps;

  return [
    {
      method: "POST",
      path: "/api/sync/lingxing/manual",
      auth: "session",
      handler: async ({ res }) => {
        const result = await runManualSync();
        sendJson(res, result.ok ? 200 : 500, result);
      },
    },
    {
      method: "GET",
      path: "/api/store-inspection/status",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await getStoreInspectionDashboard()),
    },
    {
      method: "GET",
      path: "/api/store-inspection/settings",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, { ok: true, settings: await getStoreInspectionSettings() }),
    },
    {
      method: "PUT",
      path: "/api/store-inspection/settings",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, { ok: true, settings: await updateStoreInspectionSettings(await readJsonBody(req)) });
      },
    },
    {
      method: "GET",
      path: "/api/store-inspection/markdown",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await getStoreInspectionMarkdown()),
    },
    {
      method: "GET",
      path: "/api/store-inspection/report.md",
      auth: "session",
      handler: async ({ res }) => {
        const report = await getStoreInspectionMarkdown();
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(report.markdown);
      },
    },
    {
      method: "POST",
      path: "/api/store-inspection/run",
      auth: "session",
      handler: async ({ req, res }) => {
        const payload = await readJsonBody(req).catch(() => ({}));
        const result = await runStoreInspection({
          trigger: "manual",
          notify: payload.notify !== false,
        });
        sendJson(res, result.ok ? 200 : 500, result);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/store-inspection\/erp-mails\/(?<id>[^/]+)\/status$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const payload = await readJsonBody(req).catch(() => ({}));
        const result = await updateErpBuyerMessageManualStatus(decodeURIComponent(params.id), payload.status || "replied", {
          operator: req.user?.displayName || req.user?.nick || req.user?.username || "BI",
          note: payload.note || "",
        });
        sendJson(res, 200, result);
      },
    },
  ];
}

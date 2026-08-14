export function createInventoryRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    isFinanceUser,
    getInventoryProvisionDashboard,
    exportInventoryProvisionDetailXlsx,
    refreshInventoryProvisionCosts,
    getSlowMovingRiskDashboard,
    listSlowMovingRiskReports,
    readSlowMovingRiskReport,
    getLowInventoryFeeDashboard,
    getFactoryInventoryDashboard,
    saveFactoryInventoryShippedQuantity,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/dashboard/inventory-provision",
      auth: "finance",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getInventoryProvisionDashboard({
          date: url.searchParams.get("date") || "",
          country: url.searchParams.get("country") || "",
          storeName: url.searchParams.get("storeName") || "",
          listingOwner: url.searchParams.get("listingOwner") || "",
          costMode: url.searchParams.get("costMode") || "",
          keyword: url.searchParams.get("keyword") || "",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/inventory-provision/export",
      auth: "finance",
      handler: async ({ res, url }) => {
        try {
          const result = await exportInventoryProvisionDetailXlsx({
            date: url.searchParams.get("date") || "",
            country: url.searchParams.get("country") || "",
            storeName: url.searchParams.get("storeName") || "",
            listingOwner: url.searchParams.get("listingOwner") || "",
            costMode: url.searchParams.get("costMode") || "",
            keyword: url.searchParams.get("keyword") || "",
          });
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": contentDispositionAttachment(result.filename),
            "cache-control": "no-store",
          });
          res.end(result.buffer);
        } catch (error) {
          sendJson(res, 502, error.payload || error.details || { error: error.message || "库存减值明细导出失败" });
        }
      },
    },
    {
      method: "POST",
      path: "/api/dashboard/inventory-provision/refresh-costs",
      auth: "finance",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        await readJsonBody(req);
        const refresh = await refreshInventoryProvisionCosts({});
        sendJson(res, 200, { ok: true, refresh });
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/slow-moving-risk/live",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getSlowMovingRiskDashboard({
          filters: {
            country: url.searchParams.get("country") || "",
            storeName: url.searchParams.get("storeName") || "",
            listingOwner: url.searchParams.get("listingOwner") || "",
            riskLevel: url.searchParams.get("riskLevel") || "",
            currencyCode: url.searchParams.get("currencyCode") || "",
          },
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/slow-moving-risk/reports",
      auth: "session",
      handler: async ({ res }) => {
        sendJson(res, 200, await listSlowMovingRiskReports());
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/dashboard\/slow-moving-risk\/reports\/(?<reportKey>[^/]+)$/u,
      auth: "session",
      handler: async ({ res, params }) => {
        const report = await readSlowMovingRiskReport(params.reportKey);
        if (!report) {
          const error = new Error(`Slow-moving risk report not found: ${params.reportKey}`);
          error.statusCode = 404;
          throw error;
        }
        sendJson(res, 200, report);
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/low-inventory-fee",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getLowInventoryFeeDashboard({
          date: url.searchParams.get("date") || "",
          country: url.searchParams.get("country") || "",
          storeName: url.searchParams.get("storeName") || "",
          keyword: url.searchParams.get("keyword") || "",
          onlyRisk: url.searchParams.get("onlyRisk") || "1",
          currencyCode: url.searchParams.get("currencyCode") || "ORIGINAL",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/factory-inventory",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getFactoryInventoryDashboard({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          keyword: url.searchParams.get("keyword") || "",
          factory: url.searchParams.get("factory") || "",
          onlyRemaining: url.searchParams.get("onlyRemaining") === "1",
          forceRefresh: url.searchParams.get("forceRefresh") === "1",
        }));
      },
    },
    {
      method: "POST",
      path: "/api/dashboard/factory-inventory/shipped-quantity",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const payload = await readJsonBody(req);
        payload.updatedBy = req.user?.displayName || req.user?.nick || req.user?.username || "BI";
        sendJson(res, 200, await saveFactoryInventoryShippedQuantity(payload));
      },
    },
  ];
}

export function createSalesRoutes(deps = {}) {
  const {
    getConfig,
    readSalesDashboardFilters,
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    getSalesWeeklyDashboard,
    resolveActiveAiProviderConfig,
    generateAiListingCopy,
    getMskuDetailDashboard,
    getDailyProductPulse,
    getSalesForecastDashboard,
    exportSalesForecastEstimateXlsx,
    saveSalesForecastManualDailyRow,
    migrateSalesForecastManualDailyRows,
    saveSalesForecastHiddenRow,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/dashboard/sales-weekly",
      auth: "session",
      handler: async ({ req, res, url }) => {
        sendJson(res, 200, await getSalesWeeklyDashboard(readSalesDashboardFilters(url), {
          requestId: req?.headers?.["x-request-id"] || "sales-weekly",
        }));
      },
    },
    {
      method: "POST",
      path: "/api/ai/listing-copy",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const activeAi = await resolveActiveAiProviderConfig(getConfig());
        const result = await generateAiListingCopy(activeAi.config, await readJsonBody(req));
        sendJson(res, 200, { ok: true, provider: activeAi.provider, providerLabel: activeAi.label, ...result });
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/msku-detail",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getMskuDetailDashboard(readSalesDashboardFilters(url)));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/product-pulse",
      auth: "session",
      handler: async ({ res, url }) => {
        const filters = readSalesDashboardFilters(url);
        const data = await getDailyProductPulse({
          ...filters,
          date: url.searchParams.get("date") || filters.endDate || "",
        });
        sendJson(res, 200, data);
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/sales-forecast",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getSalesForecastDashboard({
          country: url.searchParams.get("country") || "",
          store: url.searchParams.get("store") || "",
          keyword: url.searchParams.get("keyword") || "",
          force: url.searchParams.get("force") === "1",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/sales-forecast/export",
      auth: "finance",
      handler: async ({ res, url }) => {
        try {
          const result = await exportSalesForecastEstimateXlsx({
            country: url.searchParams.get("country") || "",
            store: url.searchParams.get("store") || "",
            keyword: url.searchParams.get("keyword") || "",
          });
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": contentDispositionAttachment(result.filename),
            "cache-control": "no-store",
          });
          res.end(result.buffer);
        } catch (error) {
          sendJson(res, 502, error.payload || error.details || { error: error.message || "销售预估导出失败" });
        }
      },
    },
    {
      method: "POST",
      path: "/api/dashboard/sales-forecast/manual-daily",
      auth: "session",
      handler: async ({ req, res }) => {
        sendJson(res, 200, await saveSalesForecastManualDailyRow(await readJsonBody(req)));
      },
    },
    {
      method: "POST",
      path: "/api/dashboard/sales-forecast/manual-daily/migrate",
      auth: "session",
      handler: async ({ req, res }) => {
        sendJson(res, 200, await migrateSalesForecastManualDailyRows(await readJsonBody(req)));
      },
    },
    {
      method: "POST",
      path: "/api/dashboard/sales-forecast/hidden-row",
      auth: "session",
      handler: async ({ req, res }) => {
        sendJson(res, 200, await saveSalesForecastHiddenRow(await readJsonBody(req)));
      },
    },
  ];
}

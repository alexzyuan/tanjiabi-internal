export function createDebugKnowledgeRoutes(deps = {}) {
  const {
    getLingxingAdapter,
    readSalesDashboardFilters,
    sendJson,
    getPlatformCashflowDashboard,
    debugInventoryProvisionSource,
    debugLowInventoryLedgerSource,
    listKnowledgeDocuments,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/debug/lingxing/settlement-summary",
      auth: "finance",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getPlatformCashflowDashboard({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          dateType: url.searchParams.get("dateType") || "1",
          currencyCode: url.searchParams.get("currencyCode") || "ORIGINAL",
          status: url.searchParams.get("status") || "Open",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/debug/lingxing/inventory-provision",
      auth: "finance",
      handler: async ({ res }) => sendJson(res, 200, await debugInventoryProvisionSource()),
    },
    {
      method: "GET",
      path: "/api/debug/lingxing/low-inventory-ledger",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await debugLowInventoryLedgerSource({
          date: url.searchParams.get("date") || "",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/debug/lingxing/order-profit",
      auth: "session",
      handler: async ({ res, url }) => {
        const filters = readSalesDashboardFilters(url);
        const result = await getLingxingAdapter().debugOrderProfitReport({
          start_date: filters.startDate,
          end_date: filters.endDate,
        });
        sendJson(res, 200, result);
      },
    },
    {
      method: "GET",
      path: "/api/debug/lingxing/profit-sources",
      auth: "session",
      handler: async ({ res, url }) => {
        const filters = readSalesDashboardFilters(url);
        sendJson(res, 200, await getLingxingAdapter().debugProfitSources({
          startDate: filters.startDate,
          endDate: filters.endDate,
        }));
      },
    },
    {
      method: "GET",
      path: "/api/knowledge",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await listKnowledgeDocuments()),
    },
  ];
}

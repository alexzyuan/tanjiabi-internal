export function createAdvertisingRoutes(deps = {}) {
  const {
    sendJson,
    getAdPortfolioDashboard,
    getAdKeywordDashboard,
    getAdKeywordAnalysisDashboard,
    getAdPerformanceReview,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/dashboard/ad-portfolios",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getAdPortfolioDashboard({
          keyword: url.searchParams.get("keyword") || "",
          state: url.searchParams.get("state") || "",
          reportDate: url.searchParams.get("reportDate") || "",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/ad-keywords",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getAdKeywordDashboard({
          keyword: url.searchParams.get("keyword") || "",
          category: url.searchParams.get("category") || "",
          endDate: url.searchParams.get("endDate") || "",
          lookbackDays: url.searchParams.get("lookbackDays") || "7",
          limit: url.searchParams.get("limit") || "300",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/ad-keyword-analysis",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getAdKeywordAnalysisDashboard({
          endDate: url.searchParams.get("endDate") || "",
          targetAcos: url.searchParams.get("targetAcos") || "0.25",
          minCvr: url.searchParams.get("minCvr") || "0.05",
          maxCpc: url.searchParams.get("maxCpc") || "1.5",
          limit: url.searchParams.get("limit") || "80",
          refresh: url.searchParams.get("refresh") === "1",
          cacheOnly: url.searchParams.get("cacheOnly") === "1",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/ad-performance-review",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getAdPerformanceReview({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          compareStartDate: url.searchParams.get("compareStartDate") || "",
          compareEndDate: url.searchParams.get("compareEndDate") || "",
          targetAcos: url.searchParams.get("targetAcos") || "0.25",
          avgClicksPerOrder: url.searchParams.get("avgClicksPerOrder") || "7",
          coreSalesShare: url.searchParams.get("coreSalesShare") || "0.2",
          store: url.searchParams.get("store") || "",
          country: url.searchParams.get("country") || "",
          asin: url.searchParams.get("asin") || "",
          limit: url.searchParams.get("limit") || "120",
          refresh: url.searchParams.get("refresh") === "1",
        }));
      },
    },
  ];
}

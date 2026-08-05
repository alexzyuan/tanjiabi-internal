export function createFinancePurchaseRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    getPlatformCashflowDashboard,
    getPayablesDashboard,
    getSupplierBoardDashboard,
    getStoreOperatingMonthlyReport,
    exportStoreOperatingMonthlyReportXlsx,
    runPlatformCashflowCapture,
    listSupplierDetails,
    saveSupplierDetail,
    importSupplierDetails,
    deleteSupplierDetail,
  } = deps;

  const platformCashflowFilters = (url) => ({
    startDate: url.searchParams.get("startDate") || "",
    endDate: url.searchParams.get("endDate") || "",
    dateType: url.searchParams.get("dateType") || "1",
    currencyCode: url.searchParams.get("currencyCode") || "ORIGINAL",
    country: url.searchParams.get("country") || "",
    storeName: url.searchParams.get("storeName") || "",
    status: url.searchParams.get("status") || "Open",
  });

  const monthlyReportFilters = (url) => ({
    startMonth: url.searchParams.get("startMonth") || "",
    endMonth: url.searchParams.get("endMonth") || "",
    stores: url.searchParams.getAll("stores").filter(Boolean),
    countries: url.searchParams.getAll("countries").filter(Boolean),
    currencyCode: url.searchParams.get("currencyCode") || "CNY",
  });

  return [
    {
      method: "GET",
      path: "/api/dashboard/platform-cashflow",
      auth: "finance",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getPlatformCashflowDashboard(platformCashflowFilters(url)));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/payables",
      auth: "finance",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getPayablesDashboard({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          supplier: url.searchParams.get("supplier") || "",
          carrier: url.searchParams.get("carrier") || "",
          keyword: url.searchParams.get("keyword") || "",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/dashboard/supplier-board",
      auth: "finance",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getSupplierBoardDashboard({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          dimension: url.searchParams.get("dimension") || "day",
          keyword: url.searchParams.get("keyword") || "",
          supplier: url.searchParams.get("supplier") || "",
          storeName: url.searchParams.get("storeName") || "",
          country: url.searchParams.get("country") || "",
          forceRefresh: url.searchParams.get("forceRefresh") === "1",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/finance/store-operating-monthly-report",
      auth: "finance",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getStoreOperatingMonthlyReport(monthlyReportFilters(url)));
      },
    },
    {
      method: "GET",
      path: "/api/finance/store-operating-monthly-report/export",
      auth: "finance",
      errorStatusCode: 502,
      handler: async ({ res, url }) => {
        const result = await exportStoreOperatingMonthlyReportXlsx(monthlyReportFilters(url));
        res.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": contentDispositionAttachment(result.filename),
          "cache-control": "no-store",
        });
        res.end(result.buffer);
      },
    },
    {
      method: "GET",
      path: "/api/purchase/supplier-details",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await listSupplierDetails({
          keyword: url.searchParams.get("keyword") || "",
          qualification: url.searchParams.get("qualification") || "",
          paymentTermType: url.searchParams.get("paymentTermType") || "",
          invoiceType: url.searchParams.get("invoiceType") || "",
        }));
      },
    },
    {
      method: "POST",
      path: "/api/purchase/supplier-details",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, { ok: true, row: await saveSupplierDetail(await readJsonBody(req)) });
      },
    },
    {
      method: "POST",
      path: "/api/purchase/supplier-details/import",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, { ok: true, result: await importSupplierDetails(await readJsonBody(req)) });
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/purchase\/supplier-details\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const payload = await readJsonBody(req);
        payload.id = decodeURIComponent(params.id);
        sendJson(res, 200, { ok: true, row: await saveSupplierDetail(payload) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/purchase\/supplier-details\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, { ok: true, row: await deleteSupplierDetail(decodeURIComponent(params.id)) });
      },
    },
    {
      method: "POST",
      path: "/api/platform-cashflow/capture",
      auth: "finance",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await runPlatformCashflowCapture(platformCashflowFilters(url)));
      },
    },
  ];
}

export function createInventoryRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    isFinanceUser,
    getInventoryProvisionDashboard,
    exportInventoryProvisionDetailXlsx,
    getClearanceInventoryDashboard,
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
      method: "GET",
      path: "/api/dashboard/clearance-inventory",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ req, res, url }) => {
        sendJson(res, 200, await getClearanceInventoryDashboard({
          date: url.searchParams.get("date") || "",
          country: url.searchParams.get("country") || "",
          storeName: url.searchParams.get("storeName") || "",
          listingOwner: url.searchParams.get("listingOwner") || "",
          keyword: url.searchParams.get("keyword") || "",
          includeFinancials: isFinanceUser(req.user),
        }));
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

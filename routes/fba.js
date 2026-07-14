export function createFbaRoutes(deps = {}) {
  const {
    readJsonBody,
    readNumberList,
    readFbaFreightFilters,
    sendJson,
    contentDispositionAttachment,
    getFbaShopOptions,
    searchFbaMskus,
    getFbaFreightShipments,
    getFbaShipmentCandidates,
    listFbaForwarderTemplates,
    exportFbaFreightShipments,
    convertFbaFreightShipmentsToForwarderTemplate,
    listFreightRates,
    saveFreightRate,
    deleteFreightRate,
    exportFreightRateLogsCsv,
    listFbaShipmentOrderWarehouses,
    createReadySendFbaShipmentOrders,
    listJiufangChannels,
    dryRunJiufangFbaOrders,
    createJiufangFbaOrders,
    saveFbaBoxTemplate,
    getFbaStaAutomationState,
    updateFbaStaAutomation,
    createFbaStaTasks,
    runFbaStaTaskNow,
    updateFbaStaTask,
    deleteFbaStaTask,
    runStaWarehouseProbe,
  } = deps;

  const requestOperator = (req) => req.user?.displayName || req.user?.nick || req.user?.username || "系统";

  return [
    {
      method: "GET",
      path: "/api/fba/shops",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, { shops: getFbaShopOptions() }),
    },
    {
      method: "GET",
      path: "/api/fba/mskus",
      auth: "session",
      handler: async ({ res, url }) => {
        const result = await searchFbaMskus({
          sids: readNumberList(url.searchParams.get("sids")),
          q: url.searchParams.get("q") || "",
          matchMode: url.searchParams.get("match") || "fuzzy",
        });
        sendJson(res, result.ok ? 200 : 207, result);
      },
    },
    {
      method: "GET",
      path: "/api/fba/freight/shipments",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => sendJson(res, 200, await getFbaFreightShipments(readFbaFreightFilters(url))),
    },
    {
      method: "GET",
      path: "/api/fba/shipment-candidates",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => sendJson(res, 200, await getFbaShipmentCandidates(readFbaFreightFilters(url), {
        autoLoadSellerMappings: true,
      })),
    },
    {
      method: "GET",
      path: "/api/fba/warehouses",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res }) => sendJson(res, 200, await listFbaShipmentOrderWarehouses()),
    },
    {
      method: "POST",
      path: "/api/fba/shipment-orders/create",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const body = await readJsonBody(req);
        const result = await createReadySendFbaShipmentOrders({
          filters: body.filters || {},
          shipmentIds: Array.isArray(body.shipmentIds) ? body.shipmentIds : [],
          warehouse: body.warehouse || {},
        });
        sendJson(res, result.ok ? 200 : 207, result);
      },
    },
    {
      method: "GET",
      path: "/api/fba/jiufang/channels",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => sendJson(res, 200, await listJiufangChannels({
        shippingWay: url.searchParams.get("shippingWay") || "LCL",
      })),
    },
    {
      method: "POST",
      path: "/api/fba/jiufang/orders/dry-run",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const body = await readJsonBody(req);
        const result = await dryRunJiufangFbaOrders({
          filters: body.filters || {},
          shipmentIds: Array.isArray(body.shipmentIds) ? body.shipmentIds : [],
          channelCode: body.channelCode || "",
          options: body.options || {},
          forceRetry: body.forceRetry === true,
        });
        sendJson(res, result.ok ? 200 : 207, result);
      },
    },
    {
      method: "POST",
      path: "/api/fba/jiufang/orders/create",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const body = await readJsonBody(req);
        const result = await createJiufangFbaOrders({
          filters: body.filters || {},
          shipmentIds: Array.isArray(body.shipmentIds) ? body.shipmentIds : [],
          channelCode: body.channelCode || "",
          options: body.options || {},
          forceRetry: body.forceRetry === true,
          confirmed: body.confirmed === true,
          operator: requestOperator(req),
        });
        sendJson(res, result.ok ? 200 : 207, result);
      },
    },
    {
      method: "GET",
      path: "/api/fba/freight/templates",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, { ok: true, templates: listFbaForwarderTemplates() }),
    },
    {
      method: "GET",
      path: "/api/fba/freight-rates",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, url }) => sendJson(res, 200, await listFreightRates({
        keyword: url.searchParams.get("keyword") || "",
        week: url.searchParams.get("week") || "",
        country: url.searchParams.get("country") || "",
        warehouseCode: url.searchParams.get("warehouseCode") || "",
        carrier: url.searchParams.get("carrier") || "",
        transportMethod: url.searchParams.get("transportMethod") || "",
      })),
    },
    {
      method: "POST",
      path: "/api/fba/freight-rates",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => sendJson(res, 200, { ok: true, row: await saveFreightRate(await readJsonBody(req), { operator: requestOperator(req) }) }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/fba\/freight-rates\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, row: await saveFreightRate({ ...body, id: decodeURIComponent(params.id) }, { operator: requestOperator(req) }) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/fba\/freight-rates\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => sendJson(res, 200, { ok: true, ...(await deleteFreightRate(decodeURIComponent(params.id), { operator: requestOperator(req) })) }),
    },
    {
      method: "GET",
      path: "/api/fba/freight-rates/logs/export",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res }) => {
        const result = await exportFreightRateLogsCsv();
        res.writeHead(200, {
          "content-type": result.contentType,
          "content-disposition": contentDispositionAttachment(result.filename),
        });
        res.end(result.buffer);
      },
    },
    {
      method: "GET",
      path: "/api/fba/freight/export",
      auth: "session",
      handler: async ({ res, url }) => {
        try {
          const result = await exportFbaFreightShipments(readFbaFreightFilters(url));
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": contentDispositionAttachment(result.filename),
          });
          res.end(result.buffer);
        } catch (error) {
          sendJson(res, error.statusCode || 502, { ok: false, error: error.message || "生成货代表格失败。" });
        }
      },
    },
    {
      method: "POST",
      path: "/api/fba/freight/convert",
      auth: "session",
      handler: async ({ req, res }) => {
        try {
          const body = await readJsonBody(req);
          const result = await convertFbaFreightShipmentsToForwarderTemplate({
            templateId: body.templateId || "",
            shipmentIds: Array.isArray(body.shipmentIds) ? body.shipmentIds : [],
            filters: body.filters || {},
          });
          res.writeHead(200, {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": contentDispositionAttachment(result.filename),
          });
          res.end(result.buffer);
        } catch (error) {
          sendJson(res, error.statusCode || 400, { ok: false, error: error.message || "转货代模板失败。" });
        }
      },
    },
    {
      method: "POST",
      path: "/api/fba/box-template",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, { ok: true, template: await saveFbaBoxTemplate(await readJsonBody(req)) });
      },
    },
    {
      method: "GET",
      path: "/api/fba/sta/automation",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await getFbaStaAutomationState()),
    },
    {
      method: "PUT",
      path: "/api/fba/sta/automation",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => sendJson(res, 200, await updateFbaStaAutomation(await readJsonBody(req))),
    },
    {
      method: "POST",
      path: "/api/fba/sta/tasks",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const body = await readJsonBody(req);
        body.operator = req.user?.displayName || req.user?.nick || req.user?.username || "系统";
        sendJson(res, 200, await createFbaStaTasks(body));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/fba\/sta\/tasks\/(?<id>[^/]+)\/run$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        sendJson(res, 200, await runFbaStaTaskNow(
          decodeURIComponent(params.id),
          "manual",
          req.user?.displayName || req.user?.nick || req.user?.username || "手动运行",
        ));
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/fba\/sta\/tasks\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        sendJson(res, 200, await updateFbaStaTask(decodeURIComponent(params.id), await readJsonBody(req)));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/fba\/sta\/tasks\/(?<id>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, await deleteFbaStaTask(decodeURIComponent(params.id)));
      },
    },
    {
      method: "POST",
      path: "/api/fba/sta/warehouse-probe",
      auth: "session",
      handler: async ({ req, res }) => {
        try {
          const payload = await readJsonBody(req);
          payload.operator = req.user?.displayName || req.user?.nick || req.user?.username || "测试刷仓";
          const result = await runStaWarehouseProbe(payload);
          result.operator = payload.operator;
          sendJson(res, 200, result);
        } catch (error) {
          console.error("FBA STA warehouse probe failed:", error);
          sendJson(res, 500, {
            ok: false,
            version: error.version || "",
            error: error.message || "FBA刷仓测试失败",
            step: error.step || "",
            details: error.details || null,
            cleanupError: error.cleanupError || "",
            steps: error.steps || [],
          });
        }
      },
    },
  ];
}

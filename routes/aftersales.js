export function createAftersalesRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    contentDispositionAttachment,
    getAftersalesDashboard,
    getAftersalesMailDashboard,
    syncAftersalesMail,
    getAftersalesMailAttachment,
    getAftersalesMailMessage,
    generateAftersalesMailSuggestion,
    sendAftersalesMailReply,
    updateAftersalesMailStatus,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/image-cache",
      auth: "session",
      handler: async ({ res, url }) => deps.sendCachedImage(res, url.searchParams.get("url") || ""),
    },
    {
      method: "GET",
      path: "/api/dashboard/aftersales",
      auth: "session",
      handler: async ({ res, url }) => {
        sendJson(res, 200, await getAftersalesDashboard({
          startDate: url.searchParams.get("startDate") || "",
          endDate: url.searchParams.get("endDate") || "",
          keyword: url.searchParams.get("keyword") || "",
          dateType: url.searchParams.get("dateType") || "0",
        }));
      },
    },
    {
      method: "GET",
      path: "/api/aftersales-mail/dashboard",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await getAftersalesMailDashboard()),
    },
    {
      method: "POST",
      path: "/api/aftersales-mail/sync",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await syncAftersalesMail()),
    },
    {
      method: "GET",
      pattern: /^\/api\/aftersales-mail\/attachments\/(?<messageId>[^/]+)\/(?<attachmentId>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        const attachment = await getAftersalesMailAttachment(
          decodeURIComponent(params.messageId),
          decodeURIComponent(params.attachmentId),
        );
        res.writeHead(200, {
          "content-type": attachment.contentType,
          "cache-control": "private, max-age=3600",
          "content-disposition": contentDispositionAttachment(attachment.filename).replace(/^attachment/, "inline"),
        });
        res.end(attachment.bytes);
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/aftersales-mail\/messages\/(?<messageId>[^/]+)$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, await getAftersalesMailMessage(decodeURIComponent(params.messageId)));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/aftersales-mail\/messages\/(?<messageId>[^/]+)\/ai-suggestion$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const payload = await readJsonBody(req).catch(() => ({}));
        sendJson(res, 200, await generateAftersalesMailSuggestion(decodeURIComponent(params.messageId), {
          refresh: payload.refresh === true,
        }));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/aftersales-mail\/messages\/(?<messageId>[^/]+)\/reply$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const payload = await readJsonBody(req);
        payload.operator = req.user?.displayName || req.user?.nick || req.user?.username || "ERP";
        sendJson(res, 200, await sendAftersalesMailReply(decodeURIComponent(params.messageId), payload));
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/aftersales-mail\/messages\/(?<messageId>[^/]+)\/status$/,
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        const payload = await readJsonBody(req);
        sendJson(res, 200, { ok: true, dashboard: await updateAftersalesMailStatus(decodeURIComponent(params.messageId), payload.status) });
      },
    },
  ];
}

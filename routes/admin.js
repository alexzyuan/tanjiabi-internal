export function createAdminRoutes(deps = {}) {
  const {
    config,
    readJsonBody,
    sendJson,
    listAuthUsers,
    listDingtalkAuthUsers,
    updateDingtalkAuthUser,
    deleteDingtalkAuthUser,
    createAuthUser,
    updateAuthUser,
    deleteAuthUser,
    listBudgetUploads,
    listBudgetTargets,
    saveBudgetUpload,
    createKnowledgeDocument,
    deleteKnowledgeDocument,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/admin/accounts",
      auth: "admin",
      handler: async ({ res }) => sendJson(res, 200, { accounts: await listAuthUsers(config.auth) }),
    },
    {
      method: "POST",
      path: "/api/admin/accounts",
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        sendJson(res, 200, { ok: true, account: await createAuthUser(await readJsonBody(req)) });
      },
    },
    {
      method: "PUT",
      pattern: /^\/api\/admin\/accounts\/(?<username>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        sendJson(res, 200, { ok: true, account: await updateAuthUser(decodeURIComponent(params.username), await readJsonBody(req)) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/accounts\/(?<username>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, { ok: true, account: await deleteAuthUser(decodeURIComponent(params.username)) });
      },
    },
    {
      method: "GET",
      path: "/api/admin/dingtalk-users",
      auth: "admin",
      handler: async ({ res }) => sendJson(res, 200, { users: await listDingtalkAuthUsers() }),
    },
    {
      method: "PUT",
      pattern: /^\/api\/admin\/dingtalk-users\/(?<id>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        sendJson(res, 200, { ok: true, user: await updateDingtalkAuthUser(decodeURIComponent(params.id), await readJsonBody(req)) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/dingtalk-users\/(?<id>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, { ok: true, user: await deleteDingtalkAuthUser(decodeURIComponent(params.id)) });
      },
    },
    {
      method: "GET",
      path: "/api/admin/budget/uploads",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, { uploads: await listBudgetUploads() }),
    },
    {
      method: "GET",
      path: "/api/budget-targets",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await listBudgetTargets()),
    },
    {
      method: "POST",
      path: "/api/admin/budget/upload",
      auth: "session",
      handler: async ({ req, res }) => {
        const upload = await saveBudgetUpload(await readJsonBody(req));
        sendJson(res, 200, { ok: true, upload });
      },
    },
    {
      method: "POST",
      path: "/api/admin/knowledge/documents",
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const payload = await readJsonBody(req);
        payload.createdBy = req.user?.displayName || req.user?.nick || req.user?.username || "系统管理员";
        sendJson(res, 200, { ok: true, document: await createKnowledgeDocument(payload) });
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/admin\/knowledge\/documents\/(?<id>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, { ok: true, document: await deleteKnowledgeDocument(decodeURIComponent(params.id)) });
      },
    },
  ];
}

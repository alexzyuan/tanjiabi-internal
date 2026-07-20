export function createWebhookAssistantRoutes(deps = {}) {
  const {
    readJsonBody,
    sendJson,
    listWebhookTasks,
    createWebhookTask,
    updateWebhookTask,
    deleteWebhookTask,
    sendWebhookTaskNow,
  } = deps;

  return [
    {
      method: "GET",
      path: "/api/webhook-assistant/tasks",
      auth: "admin",
      handler: async ({ res }) => sendJson(res, 200, await listWebhookTasks()),
    },
    {
      method: "POST",
      path: "/api/webhook-assistant/tasks",
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res }) => sendJson(res, 200, await createWebhookTask(await readJsonBody(req))),
    },
    {
      method: "PUT",
      pattern: /^\/api\/webhook-assistant\/tasks\/(?<id>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ req, res, params }) => {
        sendJson(res, 200, await updateWebhookTask(decodeURIComponent(params.id), await readJsonBody(req)));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/webhook-assistant\/tasks\/(?<id>[^/]+)$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, await deleteWebhookTask(decodeURIComponent(params.id)));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/webhook-assistant\/tasks\/(?<id>[^/]+)\/send$/,
      auth: "admin",
      errorStatusCode: 400,
      handler: async ({ res, params }) => {
        sendJson(res, 200, await sendWebhookTaskNow(decodeURIComponent(params.id), "manual"));
      },
    },
  ];
}

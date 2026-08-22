const FINANCIAL_DEBUG_RATE_LIMIT = 5;
const FINANCIAL_DEBUG_RATE_WINDOW_MS = 60_000;

function financialDebugRateLimitError() {
  const error = new Error("财务诊断请求过于频繁，请稍后再试。");
  error.code = "FINANCIAL_DEBUG_RATE_LIMITED";
  error.statusCode = 429;
  return error;
}

function createActorRateLimiter({ now, limit, windowMs }) {
  const buckets = new Map();
  return {
    consume(actor) {
      const timestamp = now();
      const current = buckets.get(actor);
      const bucket = !current || timestamp - current.startedAt >= windowMs
        ? { startedAt: timestamp, count: 0 }
        : current;
      if (bucket.count >= limit) throw financialDebugRateLimitError();
      bucket.count += 1;
      buckets.set(actor, bucket);
    },
  };
}

function financialDebugActor(req) {
  const user = req?.user || {};
  for (const key of ["id", "unionId", "openId", "username", "mobile", "name"]) {
    const value = String(user[key] || "").trim();
    if (value) return value.slice(0, 128);
  }
  return "unknown-admin";
}

function safeAuditDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : "invalid";
}

function safeAuditErrorCode(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(normalized) ? normalized : null;
}

export function createDebugKnowledgeRoutes(deps = {}) {
  const {
    config = {},
    getLingxingAdapter,
    readSalesDashboardFilters,
    sendJson,
    getPlatformCashflowDashboard,
    debugInventoryProvisionSource,
    debugLowInventoryLedgerSource,
    listKnowledgeDocuments,
    logger = console,
    now = Date.now,
  } = deps;

  const financialDebugLimiter = createActorRateLimiter({
    now,
    limit: FINANCIAL_DEBUG_RATE_LIMIT,
    windowMs: FINANCIAL_DEBUG_RATE_WINDOW_MS,
  });

  async function runFinancialDebug({ req, endpoint, filters, load }) {
    const actor = financialDebugActor(req);
    const startedAt = now();
    try {
      financialDebugLimiter.consume(actor);
      const result = await load();
      logger?.info?.("[lingxing-finance-debug]", {
        actor,
        endpoint,
        startDate: safeAuditDate(filters.startDate),
        endDate: safeAuditDate(filters.endDate),
        status: "success",
        durationMs: Math.max(0, now() - startedAt),
      });
      return result;
    } catch (error) {
      logger?.warn?.("[lingxing-finance-debug]", {
        actor,
        endpoint,
        startDate: safeAuditDate(filters.startDate),
        endDate: safeAuditDate(filters.endDate),
        status: error?.code === "FINANCIAL_DEBUG_RATE_LIMITED" ? "rate-limited" : "failed",
        errorCode: safeAuditErrorCode(error?.code),
        durationMs: Math.max(0, now() - startedAt),
      });
      throw error;
    }
  }

  const routes = [
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
      path: "/api/knowledge",
      auth: "session",
      handler: async ({ res }) => sendJson(res, 200, await listKnowledgeDocuments()),
    },
  ];

  if (config.debug?.lingxingFinancialEnabled === true) {
    routes.push(
      {
        method: "GET",
        path: "/api/debug/lingxing/order-profit",
        auth: "admin",
        handler: async ({ req, res, url }) => {
          const filters = readSalesDashboardFilters(url);
          const result = await runFinancialDebug({
            req,
            endpoint: "/api/debug/lingxing/order-profit",
            filters,
            load: () => getLingxingAdapter().debugOrderProfitReport({
              start_date: filters.startDate,
              end_date: filters.endDate,
            }),
          });
          sendJson(res, 200, result);
        },
      },
      {
        method: "GET",
        path: "/api/debug/lingxing/profit-sources",
        auth: "admin",
        handler: async ({ req, res, url }) => {
          const filters = readSalesDashboardFilters(url);
          const result = await runFinancialDebug({
            req,
            endpoint: "/api/debug/lingxing/profit-sources",
            filters,
            load: () => getLingxingAdapter().debugProfitSources({
              startDate: filters.startDate,
              endDate: filters.endDate,
            }),
          });
          sendJson(res, 200, result);
        },
      },
    );
  }

  return routes;
}

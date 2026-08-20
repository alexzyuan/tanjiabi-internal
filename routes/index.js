import { createAuthRoutes } from "./auth.js";
import { createCoreRoutes } from "./core.js";
import { createSalesRoutes } from "./sales.js";
import { createAdvertisingRoutes } from "./advertising.js";
import { createAftersalesRoutes } from "./aftersales.js";
import { createInventoryRoutes } from "./inventory.js";
import { createFinancePurchaseRoutes } from "./finance-purchase.js";
import { createFbaRoutes } from "./fba.js";
import { createAdminRoutes } from "./admin.js";
import { createWebhookAssistantRoutes } from "./webhook-assistant.js";
import { createSyncStoreInspectionRoutes } from "./sync-store-inspection.js";
import { createDebugKnowledgeRoutes } from "./debug-knowledge.js";
import { createProductCatalogRoutes } from "./product-catalog.js";
import { createSalesFactsRoutes } from "./sales-facts.js";
import { createProductCertificateRoutes } from "./product-certificates.js";

export function buildApiRoutes(deps) {
  return [
    ...createCoreRoutes(deps),
    ...createSalesFactsRoutes(deps),
    ...createProductCatalogRoutes(deps),
    ...createProductCertificateRoutes(deps),
    ...createAuthRoutes(deps),
    ...createSalesRoutes(deps),
    ...createAdvertisingRoutes(deps),
    ...createAftersalesRoutes(deps),
    ...createInventoryRoutes(deps),
    ...createFinancePurchaseRoutes(deps),
    ...createFbaRoutes(deps),
    ...createAdminRoutes(deps),
    ...createWebhookAssistantRoutes(deps),
    ...createSyncStoreInspectionRoutes(deps),
    ...createDebugKnowledgeRoutes(deps),
  ];
}

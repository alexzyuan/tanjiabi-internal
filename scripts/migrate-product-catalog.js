import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLegacyProductCatalogDirectories } from "../src/utils/cacheStore.js";
import { readLingxingSellersCache } from "../src/utils/cacheStore.js";
import { normalizeSellerRecords } from "../src/services/sellerDirectoryService.js";
import { createProductCatalogRepository } from "../src/services/productCatalogRepository.js";
import { migrateLegacyProductCatalog } from "../src/services/productCatalogLegacyMigrationService.js";

/**
 * Deployment entry point.  Seller identity is deliberately read from the
 * local cache only; this script never constructs a Lingxing adapter or calls
 * the seller API as a migration fallback.
 */
export async function runMigrationCli({ logger = console } = {}) {
  const startedAt = Date.now();
  let repository = null;
  try {
    const cached = await readLingxingSellersCache();
    const sellers = normalizeSellerRecords(cached?.sellers || []);
    const { sharedProductCatalogDir: sharedDir, supplierBoardProductDir: supplierDir } = getLegacyProductCatalogDirectories();
    repository = createProductCatalogRepository({
      databasePath: process.env.PRODUCT_CATALOG_DATABASE_PATH
        || path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
      logger,
    });
    const result = await migrateLegacyProductCatalog({
      repository,
      sellers,
      sharedDir,
      supplierDir,
      logger,
      requireSellerCache: true,
    });
    const durationMs = Date.now() - startedAt;
    logger.info?.("[product-catalog-migration] completed", {
      skipped: result.skipped,
      fileCount: result.fileCount,
      listingCount: result.listingCount,
      productCount: result.productCount,
      aliasCount: result.aliasCount,
      conflictCount: result.conflictCount,
      manifestHashPrefix: String(result.manifestHash || "").slice(0, 12),
      durationMs,
    });
    return result;
  } catch (error) {
    logger.error?.("[product-catalog-migration] failed", {
      errorName: error?.name || "Error",
      errorCode: error?.code || null,
      // Keep logs useful without echoing a legacy payload, credential, or
      // arbitrary identity value that happened to be present in an error.
      errorMessage: error?.code === "JSON_PARSE_FAILED"
        ? "legacy JSON parse failed"
        : "legacy product catalog migration failed",
      durationMs: Date.now() - startedAt,
    });
    process.exitCode = 1;
    return null;
  } finally {
    if (repository) repository.close();
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  await runMigrationCli();
}

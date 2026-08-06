import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

function factoryInventoryCacheKey({ startDate, endDate }) {
  return JSON.stringify({
    source: "factory-inventory",
    version: "factory-inventory-v4-row-manual-key",
    startDate,
    endDate,
  });
}

test("factory inventory fails fast instead of serving stale cache on refresh failure", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "factory-inventory-cache-"));
  try {
    process.chdir(tempRoot);
    const { saveFactoryInventoryCache } = await importFresh(projectRoot, "src/utils/cacheStore.js");
    const { getFactoryInventoryDashboard } = await importFresh(projectRoot, "src/services/factoryInventoryService.js");
    const cacheKey = factoryInventoryCacheKey({
      startDate: "2026-03-01",
      endDate: "2026-07-31",
    });
    await saveFactoryInventoryCache(cacheKey, {
      meta: { syncStatus: "old cache" },
      rows: [{ purchaseOrderNo: "PO-STALE", msku: "JM-DGC-BLUE", purchaseQuantity: 10 }],
    });

    const adapter = {
      async fetchPurchaseOrders() {
        throw new Error("purchase order unavailable");
      },
      normalizeRecordList(payload) {
        return payload?.data?.list || [];
      },
      async fetchSellers() {
        return { data: [] };
      },
    };

    await assert.rejects(
      getFactoryInventoryDashboard({
        adapter,
        startDate: "2026-03-01",
        endDate: "2026-07-31",
        forceRefresh: true,
      }),
      /purchase order unavailable/,
    );
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

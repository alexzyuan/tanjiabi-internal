import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { importFresh } from "./helpers/moduleImport.js";

test("supplier board uses the shared catalog once and has no runtime supplier product-map cache path", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const source = await readFile(path.join(projectRoot, "src/services/supplierBoardService.js"), "utf8");
  assert.equal(source.includes("readSupplierBoardProductMapCache"), false);
  assert.equal(source.includes("saveSupplierBoardProductMapCache"), false);

  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(projectRoot, "src/services/supplierBoardService.js");
    let sharedCatalogCalls = 0;
    const adapter = {
      config: { supplierSalesStatEndpoint: "/sales-stat" },
      async fetchSalesStat() {
        return {
          data: {
            list: [{ sid: 99150, msku: "CUSTOM-MSKU", sku: "CUSTOM-SKU", quantity: 2, amount: 10 }],
            total: 1,
          },
        };
      },
    };
    const result = await getSupplierBoardDashboard({
      dimension: "month",
      startDate: "2026-07",
      endDate: "2026-07",
    }, {
      adapter,
      sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
      getSharedCatalog: async () => {
        sharedCatalogCalls += 1;
        return {
          map: new Map([["custom-sku", {
            sku: "CUSTOM-SKU",
            internalSku: "CUSTOM-SKU",
            productName: "共享目录商品",
            supplier: "共享工厂",
            purchasePrice: 3,
          }]]),
          cacheHit: true,
        };
      },
      readDashboardCache: async () => null,
      saveDashboardCache: async () => {},
    });

    assert.equal(sharedCatalogCalls, 1);
    assert.equal(result.rows[0].supplier, "共享工厂");
    assert.equal(result.rows[0].purchasePrice, 3);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

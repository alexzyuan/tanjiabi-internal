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
      getSharedCatalog: async (_adapter, _rows, options) => {
        sharedCatalogCalls += 1;
        assert.deepEqual(options.sellers.map((seller) => seller.sid), [99150]);
        const product = {
          sku: "CUSTOM-SKU",
          internalSku: "CUSTOM-SKU",
          productName: "共享目录商品",
          supplier: "共享工厂",
          purchasePrice: 3,
        };
        return {
          map: new Map([
            ["custom-sku", product],
            ["sid:99150:msku:custom-msku", product],
          ]),
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

function cachedSupplierBoardData(overrides = {}) {
  const row = {
    imageUrl: "https://img.example.com/old.jpg",
    sid: 99150,
    storeName: "runtime-custom-store",
    country: "美国",
    storeCountry: "runtime-custom-store / 美国",
    msku: "CUSTOM-MSKU",
    salePrice: 10,
    productName: "旧商品名",
    sku: "OLD-SKU",
    internalSku: "OLD-SKU",
    model: "旧型号",
    quantity: 2,
    salesAmount: 20,
    subtotal: 20,
    supplier: "旧工厂",
    purchasePrice: 5,
    purchaseCostSubtotal: 10,
    ordinaryInvoicePurchaseCost: 10,
    ordinaryInvoiceTaxRate: 0.13,
    ordinaryInvoiceCost: 1.3,
    specialInvoiceTaxRate: 0.13,
  };
  return {
    meta: {
      productCatalogRevision: 1,
      request: { dimension: "month", startDate: "2026-07-01", endDate: "2026-07-31" },
    },
    summary: {
      quantity: 2,
      purchaseCostSubtotal: 10,
      ordinaryInvoicePurchaseCost: 10,
      ordinaryInvoiceCost: 1.3,
      supplierCount: 1,
      skuCount: 1,
    },
    rows: [row],
    suppliers: [],
    ...overrides,
  };
}

function catalogProduct(overrides = {}) {
  return {
    sku: "NEW-SKU",
    internalSku: "NEW-SKU",
    productName: "新商品名",
    imageUrl: "https://img.example.com/new.jpg",
    model: "新型号",
    supplier: "潮泓升",
    purchasePrice: 7,
    ...overrides,
  };
}

function salesStatAdapter({ onSalesStat } = {}) {
  return {
    config: { supplierSalesStatEndpoint: "/sales-stat" },
    async fetchSalesStat() {
      onSalesStat?.();
      return {
        data: {
          list: [{ sid: 99150, msku: "CUSTOM-MSKU", sku: "OLD-SKU", quantity: 2, amount: 20 }],
          total: 1,
        },
      };
    },
  };
}

test("supplier board rehydrates stale product fields when catalog revision changes without salesStat", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const cachedData = cachedSupplierBoardData();
    const originalCachedData = structuredClone(cachedData);
    let revisionCalls = 0;
    let salesStatCalls = 0;
    let sharedCatalogCalls = 0;
    let savedData = null;
    const result = await getSupplierBoardDashboard({
      dimension: "month",
      startDate: "2026-07",
      endDate: "2026-07",
    }, {
      adapter: salesStatAdapter({ onSalesStat: () => { salesStatCalls += 1; } }),
      sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
      getCatalogRevision: () => {
        revisionCalls += 1;
        return 2;
      },
      getSharedCatalog: async (_adapter, rows, options) => {
        sharedCatalogCalls += 1;
        assert.equal(options.feature, "supplier-board-cache-rehydrate");
        assert.equal(options.strict, true);
        assert.equal(options.allowFetchMissing, false);
        assert.deepEqual(options.sellers.map((seller) => seller.sid), [99150]);
        assert.equal(rows.length, 1);
        const product = catalogProduct();
        return {
          map: new Map([
            ["old-sku", product],
            ["sid:99150:msku:custom-msku", product],
          ]),
          revision: 2,
        };
      },
      readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
      saveDashboardCache: async (_key, data) => { savedData = data; },
    });

    assert.equal(revisionCalls, 1);
    assert.equal(salesStatCalls, 0);
    assert.equal(sharedCatalogCalls, 1);
    assert.equal(result.meta.productCatalogRevision, 2);
    assert.equal(result.rows[0].productName, "新商品名");
    assert.equal(result.rows[0].imageUrl, "https://img.example.com/new.jpg");
    assert.equal(result.rows[0].sku, "NEW-SKU");
    assert.equal(result.rows[0].internalSku, "NEW-SKU");
    assert.equal(result.rows[0].model, "新型号");
    assert.equal(result.rows[0].supplier, "潮泓升");
    assert.equal(result.rows[0].purchasePrice, 7);
    assert.equal(result.rows[0].purchaseCostSubtotal, 14);
    assert.equal(result.rows[0].ordinaryInvoicePurchaseCost, 14);
    assert.equal(result.rows[0].ordinaryInvoiceCost, 0.14);
    assert.equal(result.summary.purchaseCostSubtotal, 14);
    assert.equal(result.summary.ordinaryInvoiceCost, 0.14);
    assert.deepEqual(cachedData, originalCachedData);
    assert.equal(savedData.meta.productCatalogRevision, 2);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board rehydrates duplicate stale SKUs by canonical SID and MSKU", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const cachedData = cachedSupplierBoardData({
      rows: [
        {
          ...cachedSupplierBoardData().rows[0],
          sid: 99150,
          msku: "MSKU-ONE",
          quantity: 2,
          salesAmount: 20,
          subtotal: 20,
        },
        {
          ...cachedSupplierBoardData().rows[0],
          sid: 99151,
          msku: "MSKU-TWO",
          quantity: 3,
          salesAmount: 30,
          subtotal: 30,
        },
      ],
    });
    const p1 = catalogProduct({ sku: "P1", internalSku: "P1", productName: "商品 P1", purchasePrice: 4, supplier: "工厂 P1" });
    const p2 = catalogProduct({ sku: "P2", internalSku: "P2", productName: "商品 P2", purchasePrice: 9, supplier: "工厂 P2" });
    const result = await getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07" }, {
      adapter: salesStatAdapter(),
      sellers: [
        { sid: 99150, name: "runtime-custom-store-us", country: "美国" },
        { sid: 99151, name: "runtime-custom-store-ca", country: "加拿大" },
      ],
      getCatalogRevision: () => 2,
      getSharedCatalog: async (_adapter, rows, options) => {
        assert.equal(options.feature, "supplier-board-cache-rehydrate");
        assert.equal(options.strict, true);
        assert.equal(options.allowFetchMissing, false);
        assert.deepEqual(rows.map((row) => [row.sid, row.msku]), [[99150, "MSKU-ONE"], [99151, "MSKU-TWO"]]);
        return {
          map: new Map([
            ["old-sku", p1],
            ["sid:99150:msku:msku-one", p1],
            ["sid:99151:msku:msku-two", p2],
          ]),
          revision: 2,
        };
      },
      readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
      saveDashboardCache: async () => {},
    });

    assert.deepEqual(result.rows.map((row) => row.productName), ["商品 P1", "商品 P2"]);
    assert.deepEqual(result.rows.map((row) => row.purchasePrice), [4, 9]);
    assert.deepEqual(result.rows.map((row) => row.purchaseCostSubtotal), [8, 27]);
    assert.equal(result.summary.purchaseCostSubtotal, 35);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board treats a missing cached catalog revision as stale and rehydrates once", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const cachedData = cachedSupplierBoardData({ meta: { request: {} } });
    let revisionCalls = 0;
    let sharedCatalogCalls = 0;
    let savedData = null;
    const result = await getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07" }, {
      adapter: salesStatAdapter(),
      sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
      getCatalogRevision: () => {
        revisionCalls += 1;
        return 8;
      },
      getSharedCatalog: async (_adapter, _rows, options) => {
        sharedCatalogCalls += 1;
        assert.equal(options.allowFetchMissing, false);
        const product = catalogProduct({ purchasePrice: 0 });
        return {
          map: new Map([
            ["old-sku", product],
            ["sid:99150:msku:custom-msku", product],
          ]),
          revision: 8,
        };
      },
      readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
      saveDashboardCache: async (_key, data) => { savedData = data; },
    });
    assert.equal(revisionCalls, 1);
    assert.equal(sharedCatalogCalls, 1);
    assert.equal(result.meta.productCatalogRevision, 8);
    assert.equal(result.rows[0].purchasePrice, 0);
    assert.equal(result.rows[0].purchaseCostSubtotal, 0);
    assert.equal(result.summary.purchaseCostSubtotal, 0);
    assert.equal(savedData.meta.productCatalogRevision, 8);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board treats catalog null purchase price as zero cost while preserving real zero", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const cachedData = cachedSupplierBoardData();
    const result = await getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07" }, {
      sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
      getCatalogRevision: () => 2,
      getSharedCatalog: async () => {
        const product = catalogProduct({ purchasePrice: null });
        return {
          map: new Map([
            ["old-sku", product],
            ["sid:99150:msku:custom-msku", product],
          ]),
          revision: 2,
        };
      },
      readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
      saveDashboardCache: async () => {},
    });
    assert.equal(result.rows[0].purchasePrice, 0);
    assert.equal(result.rows[0].purchaseCostSubtotal, 0);
    assert.equal(result.summary.purchaseCostSubtotal, 0);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board returns an equal-revision dashboard cache without catalog or salesStat work", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const cachedData = cachedSupplierBoardData();
    let revisionCalls = 0;
    let salesStatCalls = 0;
    let sharedCatalogCalls = 0;
    const result = await getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07" }, {
      adapter: salesStatAdapter({ onSalesStat: () => { salesStatCalls += 1; } }),
      getCatalogRevision: () => {
        revisionCalls += 1;
        return 1;
      },
      getSharedCatalog: async () => {
        sharedCatalogCalls += 1;
        return { map: new Map(), revision: 1 };
      },
      readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
    });
    assert.equal(revisionCalls, 1);
    assert.equal(salesStatCalls, 0);
    assert.equal(sharedCatalogCalls, 0);
    assert.equal(result.rows[0].productName, "旧商品名");
    assert.equal(result.meta.productCatalogRevision, 1);
    assert.equal(result.meta.cacheHit, true);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board forceRefresh bypasses dashboard cache but does not force catalog refresh", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    let salesStatCalls = 0;
    let sharedCatalogCalls = 0;
    let dashboardCacheReadCalls = 0;
    let savedData = null;
    const result = await getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07", forceRefresh: true }, {
      adapter: salesStatAdapter({ onSalesStat: () => { salesStatCalls += 1; } }),
      sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
      getSharedCatalog: async (_adapter, _rows, options) => {
        sharedCatalogCalls += 1;
        assert.equal(options.feature, "supplier-board");
        assert.equal(options.strict, true);
        assert.equal(Object.hasOwn(options, "forceRefresh"), false);
        const product = catalogProduct();
        return {
          map: new Map([
            ["old-sku", product],
            ["sid:99150:msku:custom-msku", product],
          ]),
          revision: 3,
        };
      },
      readDashboardCache: async () => {
        dashboardCacheReadCalls += 1;
        return { data: cachedSupplierBoardData(), updatedAt: "2026/08/11 12:00:00" };
      },
      saveDashboardCache: async (_key, data) => { savedData = data; },
    });
    assert.equal(dashboardCacheReadCalls, 0);
    assert.equal(salesStatCalls, 1);
    assert.equal(sharedCatalogCalls, 1);
    assert.equal(result.meta.productCatalogRevision, 3);
    assert.equal(result.meta.cacheHit, false);
    assert.equal(savedData.meta.productCatalogRevision, 3);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

test("supplier board propagates failed catalog rehydration and emits redacted trace fields", async () => {
  const previousProvider = process.env.DATA_PROVIDER;
  process.env.DATA_PROVIDER = "lingxing";
  try {
    const { getSupplierBoardDashboard } = await importFresh(path.resolve(import.meta.dirname, ".."), "src/services/supplierBoardService.js");
    const logs = [];
    let saveCalls = 0;
    const cachedData = cachedSupplierBoardData();
    await assert.rejects(
      getSupplierBoardDashboard({ startDate: "2026-07", endDate: "2026-07" }, {
        adapter: salesStatAdapter(),
        sellers: [{ sid: 99150, name: "runtime-custom-store", country: "美国" }],
        getCatalogRevision: () => 2,
        getSharedCatalog: async () => {
          const error = new Error("catalog payload secret-token should not be logged");
          error.details = { token: "secret-token" };
          throw error;
        },
        readDashboardCache: async () => ({ data: cachedData, updatedAt: "2026/08/11 12:00:00" }),
        saveDashboardCache: async () => { saveCalls += 1; },
        logger: { error: (...args) => logs.push(args) },
      }),
      /供应商看板读取失败|商品目录|catalog/i,
    );
    assert.equal(saveCalls, 0);
    const serializedLogs = JSON.stringify(logs);
    assert.match(serializedLogs, /supplier-cache-rehydrate/);
    assert.match(serializedLogs, /cachedRevision/);
    assert.match(serializedLogs, /currentRevision/);
    assert.match(serializedLogs, /rowCount/);
    assert.doesNotMatch(serializedLogs, /secret-token/);
    assert.doesNotMatch(serializedLogs, /CUSTOM-MSKU/);
  } finally {
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
  }
});

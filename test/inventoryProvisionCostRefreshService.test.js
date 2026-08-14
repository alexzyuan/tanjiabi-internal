import assert from "node:assert/strict";
import test from "node:test";

function germanSeller() {
  return {
    sid: 17307,
    seller_id: "A-DE",
    name: "tanjia-eu-DE",
    country: "德国",
    countryCode: "DE",
  };
}

function historicalMonth(month) {
  return {
    rows: [{
      sid: 17307,
      sellerId: "A-DE",
      storeName: "tanjia-eu-DE",
      country: "德国",
      countryCode: "DE",
      msku: "JMDE-HJ825A",
      quantity: 3,
      cohortMonth: "2026-02",
      ageDays: 120,
      purchaseCost: 0,
      firstLegCost: 0,
    }],
    sellers: [germanSeller()],
    rawCount: 1,
    ledgerCount: 1,
    matchedRows: 1,
    ownerSyncVersion: 4,
    reportStartDate: `${month}-01`,
    reportEndDate: month,
  };
}

function createServiceDependencies(overrides = {}) {
  const saved = [];
  const calls = { sellers: [], history: [], loader: [], listings: [], products: [] };
  return {
    saved,
    calls,
    dependencies: {
      adapter: {},
      todayText: () => "2026-08-14",
      nowText: () => "2026/8/14 10:00:00",
      getSellers: async (options) => {
        calls.sellers.push(options);
        return { sellers: [germanSeller()] };
      },
      readHistoryCache: async (month) => {
        calls.history.push({ month });
        return { updatedAt: `2026/8/13 18:00:00`, data: historicalMonth(month) };
      },
      loadHistoricalRows: async (month, options) => {
        calls.loader.push({ month, options });
        throw new Error("历史库存重建加载器不得被成本刷新调用。");
      },
      fetchListingsBySidMskus: async (_adapter, sid, mskus) => {
        calls.listings.push({ sid, mskus });
        return [{ sid, seller_sku: "JMDE-HJ825A", local_sku: "TJ-DE-001" }];
      },
      fetchProductRecords: async (_adapter, params) => {
        calls.products.push(params);
        return [{ sku: "TJ-DE-001", purchase_price: "12.5", unit_first_leg_fee: "3.2" }];
      },
      saveHistoryCache: async (month, data) => saved.push({ month, data }),
      ...overrides,
    },
  };
}

test("cost refresh updates every completed month from existing caches and reuses product lookups", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  assert.equal(typeof createInventoryProvisionCostRefreshService, "function");
  const fixture = createServiceDependencies();
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  const result = await service.refresh({});

  assert.deepEqual(fixture.calls.sellers, [{ forceRefresh: true }]);
  assert.deepEqual(fixture.calls.history.map((call) => call.month), [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
  assert.equal(fixture.calls.loader.length, 0);
  assert.equal(fixture.calls.listings.length, 1);
  assert.equal(fixture.calls.products.length, 1);
  assert.deepEqual(fixture.saved.map(({ month }) => month), [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
  fixture.saved.forEach(({ data }) => {
    assert.equal(data.rows[0].purchaseCost, 12.5);
    assert.equal(data.rows[0].firstLegCost, 3.2);
    assert.equal(data.costSource, "lingxing-product-management");
    assert.equal(data.costRefreshedAt, "2026/8/14 10:00:00");
    assert.equal(data.costRefreshYear, "2026");
  });
  assert.equal(result.year, "2026");
  assert.deepEqual(result.months.map((item) => item.month), [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
  ]);
  assert.equal(result.totalRows, 7);
  assert.equal(result.updatedRows, 7);
  assert.equal(result.refreshedAt, "2026/8/14 10:00:00");
});

test("cost refresh fails before writing when a completed-month cache is missing", async () => {
  const fixture = createServiceDependencies();
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  fixture.dependencies.readHistoryCache = async (month) => {
    fixture.calls.history.push({ month });
    return month === "2026-04" ? null : { updatedAt: "2026/8/13 18:00:00", data: historicalMonth(month) };
  };
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(() => service.refresh({}), /库存计提历史缓存缺失：2026-04/);
  assert.equal(fixture.saved.length, 0);
  assert.equal(fixture.calls.listings.length, 0);
});

test("cost refresh rejects a missing product-management cost without overwriting any month", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    fetchProductRecords: async () => [{ sku: "TJ-DE-001", purchase_price: "12.5" }],
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({}),
    /产品管理.*单位头程成本.*tanjia-eu-DE.*JMDE-HJ825A/,
  );
  assert.equal(fixture.saved.length, 0);
});

test("cost refresh failure exposes its stage and logs annual lookup counts", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const failures = [];
  const fixture = createServiceDependencies({
    fetchListingsBySidMskus: async (_adapter, sid, _mskus, options) => {
      options.metrics.increment("lingxingListingRequests");
      options.metrics.increment("lingxingListingRequests");
      return [{ sid, seller_sku: "JMDE-HJ825A", local_sku: "TJ-DE-001" }];
    },
    fetchProductRecords: async (_adapter, _params, _fallbackParams, options) => {
      options.metrics.increment("lingxingProductInfoRequests");
      options.metrics.increment("lingxingProductFallbackRequests");
      return [{ sku: "TJ-DE-001", purchase_price: "12.5" }];
    },
    logger: { error: (...args) => failures.push(args) },
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({}),
    (error) => error.details?.stage === "cost-validation",
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], "[inventory-provision-cost-refresh] failed");
  assert.deepEqual(failures[0][1], {
    operationId: failures[0][1].operationId,
    year: "2026",
    months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"],
    monthCount: 7,
    rowCount: 7,
    listingRequestCount: 2,
    productRequestCount: 2,
    stage: "cost-validation",
    stageDurations: failures[0][1].stageDurations,
    error: "产品管理缺少单位头程成本：店铺 tanjia-eu-DE（SID 17307）MSKU JMDE-HJ825A，内部 SKU TJ-DE-001。",
  });
});

test("cost refresh rejects a fresh seller directory that omits the required German shop", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    getSellers: async () => ({ sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }] }),
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(() => service.refresh({}), /tanjia-eu-DE.*17307/);
  assert.equal(fixture.calls.history.length, 0);
  assert.equal(fixture.saved.length, 0);
});

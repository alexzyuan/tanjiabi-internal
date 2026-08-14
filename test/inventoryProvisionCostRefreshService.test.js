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

function usSeller() {
  return {
    sid: 8708,
    seller_id: "A-US",
    name: "xiamentanjia-US",
    country: "美国",
    countryCode: "US",
  };
}

function caSeller() {
  return {
    sid: 8709,
    seller_id: "A-CA",
    name: "xiamentanjia-CA",
    country: "加拿大",
    countryCode: "CA",
  };
}

function historicalMonth(month) {
  const monthNumber = Number(month.slice(5));
  return {
    rows: [{
      sid: 17307,
      sellerId: "A-DE",
      storeName: "tanjia-eu-DE",
      country: "德国",
      countryCode: "DE",
      msku: "JMDE-HJ825A",
      quantity: monthNumber,
      cohortMonth: `2025-${String(monthNumber).padStart(2, "0")}`,
      ageDays: monthNumber * 10,
      listingOwner: `owner-${month}`,
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
  fixture.saved.forEach(({ month, data }) => {
    const monthNumber = Number(month.slice(5));
    assert.equal(data.rows[0].purchaseCost, 12.5);
    assert.equal(data.rows[0].firstLegCost, 3.2);
    assert.equal(data.rows[0].quantity, monthNumber);
    assert.equal(data.rows[0].cohortMonth, `2025-${String(monthNumber).padStart(2, "0")}`);
    assert.equal(data.rows[0].ageDays, monthNumber * 10);
    assert.equal(data.rows[0].listingOwner, `owner-${month}`);
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

test("cost refresh reads deleted Listing mappings and country logistics costs for historical inventory", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    readHistoryCache: async (month) => {
      fixture.calls.history.push({ month });
      return {
        updatedAt: "2026/8/13 18:00:00",
        data: {
          ...historicalMonth(month),
          rows: [{
            sid: 8708,
            sellerId: "A-US",
            storeName: "xiamentanjia-US",
            country: "美国",
            countryCode: "US",
            msku: "JM-XSL-SP",
            skuName: "TJ018水陆遥控车",
            quantity: Number(month.slice(5)),
            purchaseCost: 0,
            firstLegCost: 0,
          }],
        },
      };
    },
    fetchListingsBySidMskus: async (_adapter, sid, mskus, options) => {
      fixture.calls.listings.push({ sid, mskus, options });
      assert.equal(options.includeDeletedListings, true);
      assert.equal(options.includeUnpairedListings, true);
      return [{ sid, seller_sku: "JM-XSL-SP", local_sku: "TJ018", is_delete: 1 }];
    },
    fetchProductRecords: async (_adapter, params) => {
      fixture.calls.products.push(params);
      return [{
        sku: "TJ018",
        cg_price: "48.0000",
        product_logistics_relation: [{ US_cg_transport_costs: "6.8900", US_currency: "CNY" }],
      }];
    },
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await service.refresh({});

  assert.equal(fixture.calls.listings.length, 1);
  assert.deepEqual(fixture.calls.products, [{ skus: ["TJ018"] }]);
  fixture.saved.forEach(({ data }) => {
    assert.equal(data.rows[0].purchaseCost, 48);
    assert.equal(data.rows[0].firstLegCost, 6.89);
    assert.equal(data.rows[0].costInternalSku, "TJ018");
  });
});

test("cost refresh resolves an unpaired deleted Listing through a unique same-family mapped Listing", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    getSellers: async (options) => {
      fixture.calls.sellers.push(options);
      return { sellers: [germanSeller(), usSeller(), caSeller()] };
    },
    readHistoryCache: async (month) => {
      fixture.calls.history.push({ month });
      return {
        updatedAt: "2026/8/13 18:00:00",
        data: {
          ...historicalMonth(month),
          rows: [{
            sid: 8708,
            sellerId: "A-US",
            storeName: "xiamentanjia-US",
            country: "美国",
            countryCode: "US",
            msku: "JM-FJPPJ",
            skuName: "",
            quantity: Number(month.slice(5)),
            purchaseCost: 0,
            firstLegCost: 0,
          }],
        },
      };
    },
    fetchListingsBySidMskus: async (_adapter, sid, mskus, options) => {
      fixture.calls.listings.push({ sid, mskus, options });
      assert.equal(options.includeDeletedListings, true);
      assert.equal(options.includeUnpairedListings, true);
      if (sid === 8708 && mskus.includes("JM-FJPPJ")) {
        return [{ sid, seller_sku: "JM-FJPPJ", local_sku: "", is_delete: 1, status: 0 }];
      }
      if (sid === 8709 && mskus.includes("FJPPJ")) {
        return [{ sid, seller_sku: "CAJM-FJPPJ", local_sku: "TJ015", is_delete: 0, status: 0 }];
      }
      return [];
    },
    fetchProductRecords: async (_adapter, params) => {
      fixture.calls.products.push(params);
      return [{
        sku: "TJ015",
        cg_price: "29.5000",
        product_logistics_relation: [{ US_cg_transport_costs: "6.9600", US_currency: "CNY" }],
      }];
    },
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await service.refresh({});

  assert.equal(fixture.calls.listings.some((call) => call.sid === 8709 && call.mskus.includes("FJPPJ")), true);
  assert.deepEqual(fixture.calls.products, [{ skus: ["TJ015"] }]);
  fixture.saved.forEach(({ data }) => {
    assert.equal(data.rows[0].purchaseCost, 29.5);
    assert.equal(data.rows[0].firstLegCost, 6.96);
    assert.equal(data.rows[0].costInternalSku, "TJ015");
  });
});

test("cost refresh fails before writing when a completed-month cache is missing", async () => {
  const fixture = createServiceDependencies();
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  fixture.dependencies.readHistoryCache = async (month) => {
    fixture.calls.history.push({ month });
    return month === "2026-04" ? null : { updatedAt: "2026/8/13 18:00:00", data: historicalMonth(month) };
  };
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({}),
    (error) => error.statusCode === 409 && /库存计提历史缓存缺失：2026-04/.test(error.message),
  );
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
  assert.equal(typeof failures[0][1].stageDurations.costValidationMs, "number");
});

test("cost refresh classifies Listing dependency failures as upstream errors", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    fetchListingsBySidMskus: async () => { throw new Error("listing unavailable"); },
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({}),
    (error) => error.statusCode === 502 && error.details?.stage === "listing-lookup",
  );
  assert.equal(fixture.saved.length, 0);
});

test("cost refresh reports partial atomic cache writes as server failures", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies();
  fixture.dependencies.saveHistoryCache = async (month, data) => {
    if (month === "2026-03") throw new Error("disk unavailable");
    fixture.saved.push({ month, data });
  };
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({}),
    (error) => error.statusCode === 500
      && error.details?.stage === "cache-write"
      && JSON.stringify(error.details.writtenMonths) === JSON.stringify(["2026-01", "2026-02"])
      && JSON.stringify(error.details.pendingMonths) === JSON.stringify(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]),
  );
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

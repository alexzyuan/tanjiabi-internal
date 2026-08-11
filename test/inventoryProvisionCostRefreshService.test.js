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
  const calls = { sellers: [], history: [], listings: [], products: [] };
  return {
    saved,
    calls,
    dependencies: {
      adapter: {},
      todayText: () => "2026-08-11",
      nowText: () => "2026/8/11 16:03:44",
      getSellers: async (options) => {
        calls.sellers.push(options);
        return { sellers: [germanSeller()] };
      },
      loadHistoricalRows: async (month, options) => {
        calls.history.push({ month, options });
        return historicalMonth(month);
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

test("cost refresh rebuilds the selected and comparison months with current German product costs", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  assert.equal(typeof createInventoryProvisionCostRefreshService, "function");
  const fixture = createServiceDependencies();
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  const result = await service.refresh({ date: "2026-05" });

  assert.deepEqual(fixture.calls.sellers, [{ forceRefresh: true }]);
  assert.deepEqual(fixture.calls.history.map((call) => call.month), ["2026-04", "2026-05"]);
  fixture.calls.history.forEach(({ options }) => {
    assert.equal(options.forceRefresh, true);
    assert.equal(options.persist, false);
    assert.equal(options.sellers[0].sid, 17307);
  });
  assert.deepEqual(fixture.saved.map(({ month }) => month), ["2026-04", "2026-05"]);
  fixture.saved.forEach(({ data }) => {
    assert.equal(data.rows[0].purchaseCost, 12.5);
    assert.equal(data.rows[0].firstLegCost, 3.2);
    assert.equal(data.costSource, "lingxing-product-management");
    assert.equal(data.costRefreshedAt, "2026/8/11 16:03:44");
  });
  assert.equal(result.date, "2026-05");
  assert.equal(result.comparisonMonth, "2026-04");
  assert.equal(result.months.find((item) => item.month === "2026-05").updatedRows, 1);
});

test("cost refresh rejects a missing product-management cost without overwriting either month", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    fetchProductRecords: async () => [{ sku: "TJ-DE-001", purchase_price: "12.5" }],
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(
    () => service.refresh({ date: "2026-05" }),
    /产品管理.*单位头程成本.*tanjia-eu-DE.*JMDE-HJ825A/,
  );
  assert.equal(fixture.saved.length, 0);
});

test("cost refresh rejects a fresh seller directory that omits the required German shop", async () => {
  const { createInventoryProvisionCostRefreshService } = await import("../src/services/inventoryProvisionCostRefreshService.js");
  const fixture = createServiceDependencies({
    getSellers: async () => ({ sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }] }),
  });
  const service = createInventoryProvisionCostRefreshService(fixture.dependencies);

  await assert.rejects(() => service.refresh({ date: "2026-05" }), /tanjia-eu-DE.*17307/);
  assert.equal(fixture.calls.history.length, 0);
  assert.equal(fixture.saved.length, 0);
});

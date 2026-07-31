import assert from "node:assert/strict";
import test from "node:test";
import { withEnv } from "./helpers/env.js";

test("loadFbaInventoryDetailRows normalizes FBA inventory rows for an injected seller source", async () => {
  const { loadFbaInventoryDetailRows } = await import("../src/services/inventoryProvisionService.js");
  const result = await loadFbaInventoryDetailRows({
    sellersOverride: [{ sid: 11500, name: "tandanbo-US", country: "US", countryCode: "US" }],
    adapter: {
      fetchAllFbaInventoryDetails: async () => [{
        sid: 11500,
        seller_sku: "MD-DINOBATH",
        available_quantity: 646,
        inv_age_91_to_180_days: 623,
        total_amount: 14728.8,
        historical_days_of_supply: 240,
        estimated_storage_cost_next_month: 93.17,
      }],
    },
  });

  assert.equal(result.sellers.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].msku, "MD-DINOBATH");
  assert.equal(result.rows[0].quantity, 623);
  assert.equal(result.rows[0].totalInventory, 646);
  assert.equal(result.rows[0].inventoryAmount, 14728.8);
  assert.equal(result.rows[0].historicalDaysOfSupply, 240);
  assert.equal(result.rows[0].currencyCode, "USD");
});

test("loadFbaInventoryDetailRows derives the known store currency when Lingxing omits countryCode", async () => {
  const { loadFbaInventoryDetailRows } = await import("../src/services/inventoryProvisionService.js");
  const result = await loadFbaInventoryDetailRows({
    sellersOverride: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }],
    adapter: {
      fetchAllFbaInventoryDetails: async () => [{
        sid: 8708,
        seller_sku: "JM-DGC-BLUE",
        available_quantity: 118,
        inv_age_91_to_180_days: 118,
      }],
    },
  });

  assert.equal(result.rows[0].countryCode, "US");
  assert.equal(result.rows[0].currencyCode, "USD");
});

test("inventory provision landed cost rows calculate provision amount by aging bucket", async () => {
  const { inventoryProvisionTestUtils } = await import("../src/services/inventoryProvisionService.js");
  assert.ok(inventoryProvisionTestUtils, "inventory provision test utilities must be exported");

  const row = inventoryProvisionTestUtils.toProvisionRow({
    storeName: "xiamentanjia-US",
    country: "美国",
    msku: "JM-DGC-BLUE",
    ageDays: 210,
    quantity: 10,
    purchaseCost: 12,
    firstLegCost: 3,
  }, inventoryProvisionTestUtils.costModes.landed);

  assert.equal(row.bucketKey, "181_270");
  assert.equal(row.provisionRate, 0.8);
  assert.equal(row.unitCost, 15);
  assert.equal(row.amount, 150);
  assert.equal(row.provisionAmount, 120);
});

test("inventory provision movement separates retained increase and consumed reversal by cohort", async () => {
  const { inventoryProvisionTestUtils, applyProvisionMovements } = await import("../src/services/inventoryProvisionService.js");
  assert.ok(inventoryProvisionTestUtils, "inventory provision test utilities must be exported");

  const previousRows = [
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-DGC-BLUE",
      cohortMonth: "2026-03",
      ageDays: 120,
      quantity: 10,
      purchaseCost: 10,
      firstLegCost: 0,
    }),
  ];
  const currentRows = [
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-DGC-BLUE",
      cohortMonth: "2026-03",
      ageDays: 210,
      quantity: 6,
      purchaseCost: 10,
      firstLegCost: 0,
    }),
  ];

  const movement = applyProvisionMovements(currentRows, previousRows);

  assert.equal(movement.monthlyProvisionAmount, 24);
  assert.equal(movement.reversalAmount, 16);
  assert.equal(movement.netProvisionAmount, 8);
  assert.equal(movement.rows.length, 1);
  assert.equal(movement.rows[0].monthlyProvisionAmount, 24);
  assert.equal(movement.rows[0].reversalAmount, 16);
  assert.equal(movement.rows[0].netProvisionAmount, 8);
});

test("inventory provision summary rows aggregate batches by store country MSKU and owner", async () => {
  const { inventoryProvisionTestUtils, applyProvisionMovements } = await import("../src/services/inventoryProvisionService.js");
  assert.ok(inventoryProvisionTestUtils.buildInventoryProvisionSummaryRows, "summary row builder must be exported for tests");

  const previousRows = [
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-9006Truck",
      skuName: "TJ024高速越野短卡绿色",
      listingOwner: "林芃",
      cohortMonth: "2025-11",
      ageDays: 120,
      quantity: 137,
      purchaseCost: 185,
      firstLegCost: 28.76,
    }),
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-9006Truck",
      skuName: "TJ024高速越野短卡绿色",
      listingOwner: "林芃",
      cohortMonth: "2026-02",
      ageDays: 75,
      quantity: 23,
      purchaseCost: 185,
      firstLegCost: 28.76,
    }),
  ];
  const currentRows = [
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-9006Truck",
      skuName: "TJ024高速越野短卡绿色",
      listingOwner: "林芃",
      cohortMonth: "2025-11",
      ageDays: 210,
      quantity: 112,
      purchaseCost: 185,
      firstLegCost: 28.76,
    }),
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-9006Truck",
      skuName: "TJ024高速越野短卡绿色",
      listingOwner: "林芃",
      cohortMonth: "2026-02",
      ageDays: 120,
      quantity: 23,
      purchaseCost: 185,
      firstLegCost: 28.76,
    }),
  ];

  const movement = applyProvisionMovements(currentRows, previousRows);
  const summaryRows = inventoryProvisionTestUtils.buildInventoryProvisionSummaryRows(movement.rows);

  assert.equal(summaryRows.length, 1);
  assert.equal(summaryRows[0].storeName, "xiamentanjia-US");
  assert.equal(summaryRows[0].country, "美国");
  assert.equal(summaryRows[0].msku, "JM-9006Truck");
  assert.equal(summaryRows[0].listingOwner, "林芃");
  assert.equal(summaryRows[0].quantity, 135);
  assert.equal(summaryRows[0].amount, 24975);
  assert.equal(summaryRows[0].provisionAmount, 18278);
  assert.equal(summaryRows[0].monthlyProvisionAmount, 9990);
  assert.equal(summaryRows[0].reversalAmount, 1850);
  assert.equal(summaryRows[0].netProvisionAmount, 8140);
  assert.equal(summaryRows[0].batchRows.length, 2);
  assert.deepEqual(summaryRows[0].batchRows.map((row) => row.cohortMonth), ["2025-11", "2026-02"]);
});

test("inventory provision movement records aggregate reversals when a SKU disappears", async () => {
  const { inventoryProvisionTestUtils, applyProvisionMovements } = await import("../src/services/inventoryProvisionService.js");

  const previousRows = [
    inventoryProvisionTestUtils.toProvisionRow({
      storeName: "xiamentanjia-US",
      country: "美国",
      msku: "JM-SLOW",
      ageDays: 300,
      quantity: 5,
      purchaseCost: 8,
    }),
  ];

  const movement = applyProvisionMovements([], previousRows);

  assert.equal(movement.monthlyProvisionAmount, 0);
  assert.equal(movement.reversalAmount, 40);
  assert.equal(movement.netProvisionAmount, -40);
  assert.equal(movement.bucketMovementRows[0].reversalBucketKey, "271_plus");
  assert.equal(movement.rows.length, 1);
  assert.equal(movement.rows[0].released, true);
  assert.equal(movement.rows[0].bucketLabel, "本期已售/库存减少");
});

test("inventory provision dashboard summarizes mock rows with filters and landed cost mode", async () => {
  await withEnv({ DATA_PROVIDER: "mock" }, async () => {
    const { getInventoryProvisionDashboard } = await import("../src/services/inventoryProvisionService.js");

    const dashboard = await getInventoryProvisionDashboard({
      country: "美国",
      owner: "婷婷",
      costMode: "landed",
      keyword: "bubble",
    });

    assert.equal(dashboard.meta.source, "模拟数据 · FBA在库库龄");
    assert.equal(dashboard.meta.costMode, "landed");
    assert.equal(dashboard.meta.snapshotAvailable, true);
    assert.equal(dashboard.kpis.skuCount, 2);
    assert.equal(dashboard.kpis.inventoryAmount, 29912);
    assert.equal(dashboard.kpis.provisionAmount, 5832);
    assert.equal(dashboard.kpis.over180Amount, 5832);
    assert.equal(dashboard.bucketSummary.length, 6);
    assert.equal(dashboard.bucketSummary.find((row) => row.key === "91_180").amount, 0);
    assert.equal(dashboard.bucketSummary.find((row) => row.key === "271_plus").provisionAmount, 5832);
    assert.deepEqual(dashboard.storeDistribution.map((row) => row.storeName), ["xiamentanjia-US"]);
    assert.ok(dashboard.detailRows.every((row) => row.country === "美国" && row.listingOwner === "婷婷"));
  });
});

test("inventory provision normalizes Lingxing age buckets and allocates storage fee", async () => {
  const { inventoryProvisionTestUtils } = await import("../src/services/inventoryProvisionService.js");

  const rows = inventoryProvisionTestUtils.normalizeLingxingInventoryRows([
    {
      sid: 8708,
      seller_sku: "JM-DGC-BLUE",
      product_name: "灯光船蓝色",
      purchase_price: "10",
      first_leg_cost: "2.5",
      afn_fulfillable_quantity: "20",
      reserved_fc_processing: "2",
      reserved_customer_orders: "3",
      inv_age_91_to_180_days: "6",
      inv_age_271_to_330_days: "4",
      inv_age_331_to_365_days: "5",
      inv_age_365_plus_days: "5",
      estimated_storage_cost_next_month: "200",
      total_amount: "400",
      historical_days_of_supply: "180",
    },
  ], [
    {
      sid: 8708,
      seller_id: "A1",
      name: "xiamentanjia-US",
      country: "美国",
      countryCode: "US",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.ageDays), [120, 300]);
  assert.deepEqual(rows.map((row) => row.quantity), [6, 14]);
  assert.equal(rows[0].totalInventory, 25);
  assert.equal(rows[0].estimatedStorageCostAllocation, 48);
  assert.equal(rows[0].storageFeeAllocationRate, 24);
  assert.equal(rows[1].estimatedStorageCostAllocation, 112);
  assert.equal(rows[1].storageFeeAllocationRate, 56);
  assert.equal(rows[0].inventoryAmount, 400);
  assert.equal(rows[0].historicalDaysOfSupply, 180);
});

test("inventory provision export workbook includes detail, summary, and meta sheets", async () => {
  await withEnv({ DATA_PROVIDER: "mock" }, async () => {
    const { exportInventoryProvisionDetailXlsx } = await import("../src/services/inventoryProvisionService.js");
    const xlsxModule = await import("xlsx");
    const XLSX = xlsxModule.default || xlsxModule;

    const exportResult = await exportInventoryProvisionDetailXlsx({
      country: "加拿大",
      costMode: "purchase",
      date: "2026-07",
    });
    const workbook = XLSX.read(exportResult.buffer, { type: "buffer" });

    assert.equal(exportResult.filename, "库存减值明细-2026-07.xlsx");
    assert.equal(exportResult.rowCount, 4);
    assert.deepEqual(workbook.SheetNames, ["库存减值明细", "批次追溯明细", "库龄汇总", "导出说明"]);
    const detailRows = XLSX.utils.sheet_to_json(workbook.Sheets["库存减值明细"], { header: 1 });
    assert.equal(detailRows[0][0], "月份");
    assert.equal(detailRows[1][2], "加拿大");
    assert.equal(detailRows[0][7], "到库金额（库存金额）");
    const batchRows = XLSX.utils.sheet_to_json(workbook.Sheets["批次追溯明细"], { header: 1 });
    assert.equal(batchRows[0][6], "库存批次月份");
    const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets["库龄汇总"], { header: 1 });
    assert.equal(summaryRows.length, 7);
  });
});

test("clearance inventory dashboard keeps mock provider observable without ERP sales", async () => {
  await withEnv({ DATA_PROVIDER: "mock" }, async () => {
    const { getClearanceInventoryDashboard } = await import("../src/services/inventoryProvisionService.js");

    const dashboard = await getClearanceInventoryDashboard({
      date: "2026-07",
      includeFinancials: true,
    });

    assert.equal(dashboard.meta.source, "模拟数据 · FBA在库库龄");
    assert.equal(dashboard.meta.salesSource, "模拟数据未含近30天销售");
    assert.equal(dashboard.meta.storageFeeSource, "模拟数据未含 ERP 仓储费");
    assert.equal(dashboard.kpis.mskuCount, 0);
    assert.deepEqual(dashboard.rows, []);
  });
});

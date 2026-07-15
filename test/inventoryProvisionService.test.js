import assert from "node:assert/strict";
import test from "node:test";

async function withEnv(values, run) {
  const previous = {};
  Object.keys(values).forEach((key) => {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  });
  try {
    return await run();
  } finally {
    Object.keys(values).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

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
    assert.deepEqual(workbook.SheetNames, ["库存减值明细", "库龄汇总", "导出说明"]);
    const detailRows = XLSX.utils.sheet_to_json(workbook.Sheets["库存减值明细"], { header: 1 });
    assert.equal(detailRows[0][0], "月份");
    assert.equal(detailRows[1][2], "加拿大");
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

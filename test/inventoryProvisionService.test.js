import assert from "node:assert/strict";
import test from "node:test";

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

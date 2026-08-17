import assert from "node:assert/strict";
import test from "node:test";
import { rebuildInventoryProvisionHistory } from "../src/services/inventoryProvisionLedgerRebuilder.js";

const sellers = [{ seller_id: "A-SELLER", marketplaceId: "ATVPD", sid: 8708, name: "xiamentanjia-US", country: "美国", countryCode: "US" }];
const baseRecord = { sellerId: "A-SELLER", marketplaceId: "ATVPD", msku: "MSKU-1", fulfillmentCenter: "ONT8", disposition: "SELLABLE" };

function event(date, eventType, quantity, sourceRow) {
  return { ...baseRecord, date, eventType, quantity, sourceRow, scopeKey: "A-SELLER|na|ATVPD", title: "Toy truck" };
}

test("inventory ledger rebuilder applies FIFO and snapshots each target month", () => {
  const result = rebuildInventoryProvisionHistory({
    records: [
      event("2025-10-01", "BeginningBalance", 10, 2),
      event("2025-10-03", "Receipts", 5, 3),
      event("2025-10-10", "CustomerShipments", -7, 4),
      event("2025-11-05", "CustomerReturns", 2, 2),
      event("2025-11-10", "WarehouseTransferOut", -1, 3),
    ],
    targetMonths: ["2025-10", "2025-11"],
    sellers,
    baseRowsByKey: new Map([["A-SELLER|ATVPD|MSKU-1", {
      purchaseCost: 12,
      firstLegCost: 3,
      skuName: "Legacy truck",
      listingOwner: "林芃",
    }]]),
    nowText: () => "2026/8/17 10:00:00",
  });

  const october = result.entries[0].data.rows;
  const november = result.entries[1].data.rows;
  assert.deepEqual(october.map(({ cohortMonth, quantity, ageDays }) => ({ cohortMonth, quantity, ageDays })), [
    { cohortMonth: "2025-09", quantity: 3, ageDays: 45 },
    { cohortMonth: "2025-10", quantity: 5, ageDays: 15 },
  ]);
  assert.deepEqual(november.map(({ cohortMonth, quantity, ageDays }) => ({ cohortMonth, quantity, ageDays })), [
    { cohortMonth: "2025-09", quantity: 2, ageDays: 75 },
    { cohortMonth: "2025-10", quantity: 5, ageDays: 45 },
    { cohortMonth: "2025-11", quantity: 2, ageDays: 15 },
  ]);
  assert.equal(november[0].purchaseCost, 12);
  assert.equal(november[0].firstLegCost, 3);
  assert.equal(november[0].listingOwner, "林芃");
  assert.equal(result.summary.matchedRows, 2);
});

test("inventory ledger rebuilder rejects unknown and ambiguous ledger events", () => {
  assert.throws(
    () => rebuildInventoryProvisionHistory({
      records: [event("2025-10-01", "MysteryEvent", 1, 2)],
      targetMonths: ["2025-10"], sellers, baseRowsByKey: new Map(),
    }),
    (error) => error.code === "INVENTORY_LEDGER_EVENT_TYPE_UNSUPPORTED" && /MysteryEvent/u.test(error.message),
  );
  assert.throws(
    () => rebuildInventoryProvisionHistory({
      records: [event("2025-10-01", "Other", 0, 2)],
      targetMonths: ["2025-10"], sellers, baseRowsByKey: new Map(),
    }),
    (error) => error.code === "INVENTORY_LEDGER_EVENT_TYPE_AMBIGUOUS",
  );
});

test("inventory ledger rebuilder preserves fractional quantities and omits empty stock", () => {
  const result = rebuildInventoryProvisionHistory({
    records: [
      event("2025-10-01", "BeginningBalance", 1.5, 2),
      event("2025-10-02", "CustomerShipments", -1, 3),
      event("2025-11-02", "CustomerShipments", -0.5, 2),
    ],
    targetMonths: ["2025-10", "2025-11"], sellers, baseRowsByKey: new Map(),
  });
  assert.equal(result.entries[0].data.rows[0].quantity, 0.5);
  assert.equal(result.entries[1].data.rows.length, 0);
  assert.equal(result.summary.metadataFallbackRows, 1);
});

test("inventory ledger rebuilder excludes non-sellable ledger rows from provision history", () => {
  const result = rebuildInventoryProvisionHistory({
    records: [
      event("2025-10-01", "BeginningBalance", 2, 2),
      { ...event("2025-10-02", "Receipts", 9, 3), disposition: "UNSELLABLE" },
    ],
    targetMonths: ["2025-10"], sellers, baseRowsByKey: new Map(),
  });
  assert.equal(result.entries[0].data.rows.length, 1);
  assert.equal(result.entries[0].data.rows[0].quantity, 2);
});

test("inventory ledger rebuilder maps official numeric event types and preserves historical seed events", () => {
  const result = rebuildInventoryProvisionHistory({
    records: [
      event("2024-10-01", "04", 10, 1),
      event("2025-10-02", "01", -4, 2),
      event("2025-10-04", "02", 1, 3),
      event("2025-10-05", "03", -1, 4),
      event("2025-10-06", "06", 2, 5),
    ],
    targetMonths: ["2025-10"], sellers, baseRowsByKey: new Map(),
  });
  assert.deepEqual(result.entries[0].data.rows.map(({ cohortMonth, quantity }) => ({ cohortMonth, quantity })), [
    { cohortMonth: "2024-10", quantity: 5 },
    { cohortMonth: "2025-10", quantity: 1 },
    { cohortMonth: "2025-10", quantity: 2 },
  ]);
});

test("inventory ledger rebuilder consumes an audited opening snapshot before the first ledger event", () => {
  const result = rebuildInventoryProvisionHistory({
    records: [
      event("2024-10-01", "BeginningBalance", 3, 0),
      event("2024-10-01", "01", -1, 1),
      event("2025-10-02", "01", -1, 2),
    ],
    targetMonths: ["2025-10"], sellers, baseRowsByKey: new Map(),
  });
  assert.deepEqual(result.entries[0].data.rows.map(({ cohortMonth, quantity, ageDays }) => ({ cohortMonth, quantity, ageDays })), [
    { cohortMonth: "2024-09", quantity: 1, ageDays: 300 },
  ]);
});

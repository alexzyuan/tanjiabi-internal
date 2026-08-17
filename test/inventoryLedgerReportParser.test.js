import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { parseInventoryLedgerReport } from "../src/services/inventoryLedgerReportParser.js";

async function fixture(name) {
  return readFile(new URL(`./fixtures/inventory-ledger/${name}`, import.meta.url));
}

const context = {
  expectedMonth: "2025-10",
  sellerId: "A-SELLER",
  marketplaceId: "ATVPD",
  scopeKey: "A-SELLER|na|ATVPD",
};

test("inventory ledger parser normalizes TSV detail records", async () => {
  const parsed = parseInventoryLedgerReport(await fixture("2025-10.tsv"), context);
  assert.equal(parsed.meta.rowCount, 3);
  assert.equal(parsed.meta.expectedMonth, "2025-10");
  assert.deepEqual(parsed.records[0], {
    date: "2025-10-01",
    msku: "MSKU-1",
    eventType: "BeginningBalance",
    quantity: 10,
    fulfillmentCenter: "ONT8",
    disposition: "SELLABLE",
    referenceId: "opening",
    reason: "opening balance",
    title: "Toy truck",
    sellerId: "A-SELLER",
    marketplaceId: "ATVPD",
    scopeKey: "A-SELLER|na|ATVPD",
    sourceRow: 2,
  });
});

test("inventory ledger parser supports gzip and a UTF-8 BOM", async () => {
  const source = Buffer.concat([Buffer.from("\ufeff", "utf8"), await fixture("2025-10.tsv")]);
  const parsed = parseInventoryLedgerReport(gzipSync(source), {
    ...context,
    compressionAlgorithm: "GZIP",
  });
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[2].quantity, -7);
});

test("inventory ledger parser rejects missing required headers, invalid quantities, and out-of-month rows", () => {
  assert.throws(
    () => parseInventoryLedgerReport(Buffer.from("event-date\tmsku\n2025-10-01\tMSKU-1\n"), context),
    /缺少必需列/u,
  );
  assert.throws(
    () => parseInventoryLedgerReport(Buffer.from("event-date\tmsku\tevent-type\tquantity\tfulfillment-center\tdisposition\treference-id\treason\n2025-10-01\tMSKU-1\tReceipts\tnope\tONT8\tSELLABLE\tid\treason\n"), context),
    /数量无效/u,
  );
  assert.throws(
    () => parseInventoryLedgerReport(Buffer.from("event-date\tmsku\tevent-type\tquantity\tfulfillment-center\tdisposition\treference-id\treason\n2025-11-01\tMSKU-1\tReceipts\t1\tONT8\tSELLABLE\tid\treason\n"), context),
    /不属于目标月份 2025-10/u,
  );
});

test("inventory ledger parser retains unknown event types for the FIFO validator", () => {
  const parsed = parseInventoryLedgerReport(Buffer.from("event-date\tmsku\tevent-type\tquantity\tfulfillment-center\tdisposition\treference-id\treason\n2025-10-01\tMSKU-1\tMysteryEvent\t1\tONT8\tSELLABLE\tid\treason\n"), context);
  assert.equal(parsed.records[0].eventType, "MysteryEvent");
});

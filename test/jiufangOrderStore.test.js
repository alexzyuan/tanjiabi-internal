import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getJiufangOrderByShipmentId,
  listJiufangOrdersByShipmentIds,
  saveJiufangOrderResult,
} from "../src/services/jiufangOrderStore.js";

async function withTempStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-jiufang-orders-"));
  try {
    await fn(path.join(dir, "orders.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("saveJiufangOrderResult stores successful order state by shipment id with redacted payloads", async () => {
  await withTempStore(async (storeFile) => {
    const row = await saveJiufangOrderResult({
      shipmentId: "FBA18QJFDCWJ",
      jiufangOrderNumber: "JF260714001",
      channelCode: "SEA-US-07",
      requestSummary: { boxCount: 2, totalKg: 18.5 },
      requestPayload: {
        Security: { Username: "JF_TEST_USER", Password: "0123456789abcdef0123456789abcdef" },
        ShipmentRequest: { ReferenceNumber: { Value: "FBA18QJFDCWJ" } },
      },
      responsePayload: {
        ShipmentResponse: { ShipmentIdentificationNumber: "JF260714001" },
      },
      operator: "Billy",
      now: () => new Date("2026-07-14T10:00:00.000Z"),
    }, { storeFile });

    assert.equal(row.shipmentId, "FBA18QJFDCWJ");
    assert.equal(row.status, "created");
    assert.equal(row.jiufangOrderNumber, "JF260714001");
    assert.equal(row.createdAt, "2026-07-14T10:00:00.000Z");
    assert.equal(row.requestPayload.Security.Password, "[REDACTED]");
    assert.equal(row.responsePayload.ShipmentResponse.ShipmentIdentificationNumber, "JF260714001");

    const stored = await getJiufangOrderByShipmentId("FBA18QJFDCWJ", { storeFile });
    assert.equal(stored.jiufangOrderNumber, "JF260714001");
  });
});

test("listJiufangOrdersByShipmentIds returns a map for idempotency checks", async () => {
  await withTempStore(async (storeFile) => {
    await saveJiufangOrderResult({
      shipmentId: "FBA18QJFDCWJ",
      jiufangOrderNumber: "JF260714001",
      channelCode: "SEA-US-07",
      operator: "Billy",
    }, { storeFile });

    const rows = await listJiufangOrdersByShipmentIds(["FBA18QJFDCWJ", "FBA-MISSING"], { storeFile });

    assert.equal(rows.get("FBA18QJFDCWJ").jiufangOrderNumber, "JF260714001");
    assert.equal(rows.has("FBA-MISSING"), false);
  });
});

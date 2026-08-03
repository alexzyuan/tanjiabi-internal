import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearFbaShipmentVarianceFollowup,
  listFbaShipmentVarianceFollowupsByKeys,
  markFbaShipmentVarianceFollowup,
} from "../src/services/fbaShipmentVarianceFollowupStore.js";

async function withTempStore(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fba-shipment-variance-followups-"));
  const storeFile = path.join(dir, "followups.json");
  try {
    return await run(storeFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("marking a shipment follow-up persists its business key, operator and timestamp", async () => {
  await withTempStore(async (storeFile) => {
    const row = await markFbaShipmentVarianceFollowup({
      sid: 8708,
      shipmentId: "FBA18QJFDCWJ",
      operator: "Alice",
    }, {
      storeFile,
      now: () => new Date("2026-08-03T08:00:00.000Z"),
    });

    assert.deepEqual(row, {
      sid: 8708,
      shipmentId: "FBA18QJFDCWJ",
      followedUp: true,
      followedUpAt: "2026-08-03T08:00:00.000Z",
      followedUpBy: "Alice",
      clearedAt: "",
      clearedBy: "",
      updatedAt: "2026-08-03T08:00:00.000Z",
    });

    const records = await listFbaShipmentVarianceFollowupsByKeys(["8708:FBA18QJFDCWJ"], { storeFile });
    assert.deepEqual(records.get("8708:FBA18QJFDCWJ"), row);
  });
});

test("clearing a follow-up keeps its audit record and restores the shipment to pending", async () => {
  await withTempStore(async (storeFile) => {
    await markFbaShipmentVarianceFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ", operator: "Alice" }, {
      storeFile,
      now: () => new Date("2026-08-03T08:00:00.000Z"),
    });
    const row = await clearFbaShipmentVarianceFollowup({ sid: 8708, shipmentId: "FBA18QJFDCWJ", operator: "Bob" }, {
      storeFile,
      now: () => new Date("2026-08-03T09:00:00.000Z"),
    });

    assert.equal(row.followedUp, false);
    assert.equal(row.followedUpBy, "Alice");
    assert.equal(row.clearedBy, "Bob");
    assert.equal(row.clearedAt, "2026-08-03T09:00:00.000Z");
    assert.equal(row.updatedAt, "2026-08-03T09:00:00.000Z");
  });
});

test("follow-up store rejects missing business identity", async () => {
  await assert.rejects(
    () => markFbaShipmentVarianceFollowup({ shipmentId: "FBA18QJFDCWJ" }),
    /缺少店铺 SID/,
  );
  await assert.rejects(
    () => markFbaShipmentVarianceFollowup({ sid: 8708 }),
    /缺少货件单号/,
  );
});

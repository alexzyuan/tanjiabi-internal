import assert from "node:assert/strict";
import test from "node:test";
import {
  runInventoryLedgerRawRebuildIfNeeded,
  shouldRunInventoryLedgerRawRebuild,
} from "../src/jobs/inventoryLedgerRawRebuildJob.js";

test("inventory ledger job waits until Shanghai 10th at configured time and runs once per period", () => {
  assert.equal(shouldRunInventoryLedgerRawRebuild({ now: new Date("2026-08-08T18:00:00.000Z"), state: {}, runAt: "02:00" }), false);
  assert.equal(shouldRunInventoryLedgerRawRebuild({ now: new Date("2026-08-09T17:59:00.000Z"), state: {}, runAt: "02:00" }), false);
  assert.equal(shouldRunInventoryLedgerRawRebuild({ now: new Date("2026-08-09T18:00:00.000Z"), state: { lastSuccessfulPeriod: "2026-07" }, runAt: "02:00" }), false);
  assert.equal(shouldRunInventoryLedgerRawRebuild({ now: new Date("2026-08-10T02:00:00.000Z"), state: {}, runAt: "02:00" }), true);
  assert.equal(shouldRunInventoryLedgerRawRebuild({
    now: new Date("2026-08-10T03:00:00.000Z"),
    state: { lastAttemptPeriod: "2026-07", lastAttemptDate: "2026-08-10" }, runAt: "02:00",
  }), false);
  assert.equal(shouldRunInventoryLedgerRawRebuild({
    now: new Date("2026-08-11T03:00:00.000Z"),
    state: { lastAttemptPeriod: "2026-07", lastAttemptDate: "2026-08-10" }, runAt: "02:00",
  }), true);
});

test("inventory ledger job persists success and uses a lock", async () => {
  const writes = [];
  let rebuildCalls = 0;
  const result = await runInventoryLedgerRawRebuildIfNeeded({
    now: new Date("2026-08-10T02:00:00.000Z"),
    readState: async () => ({}),
    writeState: async (value) => { writes.push(value); },
    rebuild: async () => { rebuildCalls += 1; return { committedMonths: ["2025-10", "2026-07"], rebuiltRowCount: 9 }; },
    lockRunner: async (_name, fn) => fn(),
  });
  assert.equal(result.rebuilt, true);
  assert.equal(rebuildCalls, 1);
  assert.equal(writes.at(-1).lastSuccessfulPeriod, "2026-07");
  assert.equal(writes.at(-1).lastStatus, "success");
});

test("inventory ledger job persists failure context and defers automatic retry to the next Shanghai day", async () => {
  const writes = [];
  await assert.rejects(
    () => runInventoryLedgerRawRebuildIfNeeded({
      now: new Date("2026-08-10T02:00:00.000Z"),
      readState: async () => ({}),
      writeState: async (value) => { writes.push(value); },
      rebuild: async () => {
        const error = new Error("report unavailable");
        error.stage = "poll";
        error.month = "2026-07";
        error.sellerId = "A-SELLER";
        error.taskId = "task-1";
        error.taskStatus = "UNKNOWN";
        throw error;
      },
      lockRunner: async (_name, fn) => fn(),
    }),
    /report unavailable/u,
  );
  assert.equal(writes.at(-1).lastStatus, "failed");
  assert.equal(writes.at(-1).lastAttemptPeriod, "2026-07");
  assert.equal(writes.at(-1).lastAttemptDate, "2026-08-10");
  assert.deepEqual(writes.at(-1).lastFailure, {
    stage: "poll", month: "2026-07", sellerId: "A-SELLER", taskId: "task-1", taskStatus: "UNKNOWN",
  });
  assert.equal(writes.at(-1).lastSuccessfulPeriod, undefined);
});

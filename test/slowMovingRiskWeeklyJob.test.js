import assert from "node:assert/strict";
import test from "node:test";

import {
  runSlowMovingRiskWeeklyJobIfNeeded,
  shouldRunSlowMovingRiskWeeklyJob,
} from "../src/jobs/slowMovingRiskWeeklyJob.js";

const tuesdayAtNine = new Date("2026-08-04T01:00:00.000Z");

test("shouldRunSlowMovingRiskWeeklyJob runs on Tuesday at 09:00 Shanghai time once per report key", () => {
  assert.equal(shouldRunSlowMovingRiskWeeklyJob({ now: tuesdayAtNine, state: {} }), true);
  assert.equal(shouldRunSlowMovingRiskWeeklyJob({ now: new Date("2026-08-04T00:59:00.000Z"), state: {} }), false);
  assert.equal(shouldRunSlowMovingRiskWeeklyJob({ now: new Date("2026-08-03T01:00:00.000Z"), state: {} }), false);
  assert.equal(shouldRunSlowMovingRiskWeeklyJob({ now: tuesdayAtNine, state: { lastSuccessfulReportKey: "2026-08-02" } }), false);
});

test("runSlowMovingRiskWeeklyJobIfNeeded saves one successful immutable report and state", async () => {
  const saved = [];
  const states = [];
  const result = await runSlowMovingRiskWeeklyJobIfNeeded({
    now: tuesdayAtNine,
    reportService: {
      getDashboard: async ({ dateRange }) => ({ dateRange, rows: [{ msku: "MD-DINOBATH" }], meta: { dataSources: {} } }),
    },
    snapshotStore: {
      saveSuccess: async (value) => { saved.push(value); return value; },
      saveFailure: async () => assert.fail("unexpected failure snapshot"),
      read: async () => null,
    },
    readState: async () => ({}),
    writeState: async (state) => { states.push(state); },
    lockRunner: async (_name, callback) => callback(),
  });

  assert.equal(result.generated, true);
  assert.equal(saved[0].reportKey, "2026-08-02");
  assert.equal(saved[0].dashboard.dateRange.startDate, "2026-07-04");
  assert.equal(states[0].lastSuccessfulReportKey, "2026-08-02");
  assert.equal(states[0].lastStatus, "success");
});

test("runSlowMovingRiskWeeklyJobIfNeeded records a failed source without saving a partial report", async () => {
  const failures = [];
  const states = [];
  await assert.rejects(
    () => runSlowMovingRiskWeeklyJobIfNeeded({
      now: tuesdayAtNine,
      reportService: {
        getDashboard: async () => {
          const error = new Error("order profit timeout");
          error.source = "orderProfit";
          throw error;
        },
      },
      snapshotStore: {
        read: async () => null,
        saveSuccess: async () => assert.fail("partial report must not be saved"),
        saveFailure: async (value) => { failures.push(value); return value; },
      },
      readState: async () => ({}),
      writeState: async (state) => { states.push(state); },
      lockRunner: async (_name, callback) => callback(),
    }),
    (error) => error.source === "orderProfit" && error.message === "order profit timeout",
  );

  assert.equal(failures[0].reportKey, "2026-08-02");
  assert.equal(failures[0].error.source, "orderProfit");
  assert.equal(states[0].lastStatus, "failed");
});

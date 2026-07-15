import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultDashboardWarmupJobs,
  runDefaultDashboardWarmupIfNeeded,
  shouldRunDefaultDashboardWarmup,
} from "../src/services/defaultDashboardWarmupService.js";

test("默认页面预热每天到点后只运行一次", () => {
  assert.equal(shouldRunDefaultDashboardWarmup({
    now: new Date("2026-07-14T00:34:00.000Z"),
    state: {},
    runAt: "08:35",
  }), false);
  assert.equal(shouldRunDefaultDashboardWarmup({
    now: new Date("2026-07-14T00:35:00.000Z"),
    state: {},
    runAt: "08:35",
  }), true);
  assert.equal(shouldRunDefaultDashboardWarmup({
    now: new Date("2026-07-14T12:00:00.000Z"),
    state: { lastRunDate: "2026-07-14" },
    runAt: "08:35",
  }), false);
});

test("默认页面预热使用真实首屏缓存参数", () => {
  const jobs = buildDefaultDashboardWarmupJobs();
  assert.deepEqual(jobs.map((job) => ({ name: job.name, filters: job.filters })), [
    { name: "sales-forecast", filters: { force: true } },
    { name: "inventory-provision", filters: {} },
    { name: "supplier-board", filters: { dimension: "month", forceRefresh: true } },
  ]);
});

test("默认页面预热按任务记录行数和缓存命中状态", async () => {
  const calls = [];
  let writtenState = null;
  const result = await runDefaultDashboardWarmupIfNeeded({
    force: true,
    now: new Date("2026-07-14T00:35:00.000Z"),
    readState: async () => ({}),
    writeState: async (state) => {
      writtenState = state;
    },
    lockRunner: async (_name, run) => run(),
    jobs: [
      {
        name: "sales-forecast",
        filters: { force: true },
        run: async (filters) => {
          calls.push(["sales-forecast", filters]);
          return { rows: [{ id: 1 }], meta: { cacheHit: false } };
        },
      },
      {
        name: "inventory-provision",
        filters: {},
        run: async (filters) => {
          calls.push(["inventory-provision", filters]);
          return { rows: [{ id: 2 }, { id: 3 }], meta: { cacheHit: true } };
        },
      },
    ],
  });

  assert.deepEqual(calls, [
    ["sales-forecast", { force: true }],
    ["inventory-provision", {}],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.warmed, true);
  assert.deepEqual(result.jobs.map((job) => ({
    name: job.name,
    rowCount: job.rowCount,
    cacheHit: job.cacheHit,
  })), [
    { name: "sales-forecast", rowCount: 1, cacheHit: false },
    { name: "inventory-provision", rowCount: 2, cacheHit: true },
  ]);
  assert.equal(writtenState.lastRunDate, "2026-07-14");
  assert.equal(writtenState.lastStatus, "success");
});

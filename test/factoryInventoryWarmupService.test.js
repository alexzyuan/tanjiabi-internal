import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunFactoryInventoryWarmup } from "../src/services/factoryInventoryWarmupService.js";

test("工厂库存预热每天到点后只运行一次", () => {
  assert.equal(shouldRunFactoryInventoryWarmup({
    now: new Date("2026-07-14T00:19:00.000Z"),
    state: {},
    runAt: "08:20",
  }), false);
  assert.equal(shouldRunFactoryInventoryWarmup({
    now: new Date("2026-07-14T00:20:00.000Z"),
    state: {},
    runAt: "08:20",
  }), true);
  assert.equal(shouldRunFactoryInventoryWarmup({
    now: new Date("2026-07-14T12:00:00.000Z"),
    state: { lastRunDate: "2026-07-14" },
    runAt: "08:20",
  }), false);
  assert.equal(shouldRunFactoryInventoryWarmup({
    now: new Date("2026-07-15T00:20:00.000Z"),
    state: { lastRunDate: "2026-07-14" },
    runAt: "08:20",
  }), true);
});

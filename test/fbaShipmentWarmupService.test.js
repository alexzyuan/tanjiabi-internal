import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunFbaShipmentWarmup } from "../src/services/fbaShipmentWarmupService.js";

test("FBA 货件预热每天到点后只运行一次", () => {
  assert.equal(shouldRunFbaShipmentWarmup({
    now: new Date("2026-07-14T00:04:00.000Z"),
    state: {},
    runAt: "08:05",
  }), false);
  assert.equal(shouldRunFbaShipmentWarmup({
    now: new Date("2026-07-14T00:05:00.000Z"),
    state: {},
    runAt: "08:05",
  }), true);
  assert.equal(shouldRunFbaShipmentWarmup({
    now: new Date("2026-07-14T12:00:00.000Z"),
    state: { lastRunDate: "2026-07-14" },
    runAt: "08:05",
  }), false);
  assert.equal(shouldRunFbaShipmentWarmup({
    now: new Date("2026-07-15T00:05:00.000Z"),
    state: { lastRunDate: "2026-07-14" },
    runAt: "08:05",
  }), true);
});

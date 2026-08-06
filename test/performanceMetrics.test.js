import assert from "node:assert/strict";
import test from "node:test";

import { createPerformanceMetrics } from "../src/utils/performanceMetrics.js";

test("performance metrics measure elapsed time and counters", async () => {
  const now = (() => {
    const values = [100, 112, 124, 140];
    return () => values.shift();
  })();
  const metrics = createPerformanceMetrics("shared-product-catalog", { now });

  const result = await metrics.measure("listing", async () => {
    metrics.increment("lingxingRequests", 2);
    return "ok";
  });
  metrics.increment("rowCount", 3);

  assert.equal(result, "ok");
  assert.deepEqual(metrics.summary(), {
    scope: "shared-product-catalog",
    durationMs: 40,
    counters: {
      lingxingRequests: 2,
      rowCount: 3,
    },
    timings: {
      listingMs: 12,
    },
  });
});

test("performance metrics preserve thrown errors while recording timing", async () => {
  const now = (() => {
    const values = [200, 210, 260, 260];
    return () => values.shift();
  })();
  const metrics = createPerformanceMetrics("failing-work", { now });

  await assert.rejects(
    metrics.measure("refresh", async () => {
      throw new Error("refresh failed");
    }),
    /refresh failed/,
  );

  assert.deepEqual(metrics.summary(), {
    scope: "failing-work",
    durationMs: 60,
    counters: {},
    timings: {
      refreshMs: 50,
    },
  });
});

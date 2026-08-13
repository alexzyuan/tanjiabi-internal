import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const serviceUrl = pathToFileURL(path.resolve("src/services/syncService.js"));

async function withTempService(fn, { provider = "mock" } = {}) {
  const originalCwd = process.cwd();
  const originalProvider = process.env.DATA_PROVIDER;
  const originalInterval = process.env.SYNC_INTERVAL_HOURS;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-sync-service-"));
  process.chdir(dir);
  process.env.DATA_PROVIDER = provider;
  process.env.SYNC_INTERVAL_HOURS = "6";
  try {
    const service = await import(`${serviceUrl.href}?case=${Date.now()}-${Math.random()}`);
    await fn(service, dir);
  } finally {
    if (originalProvider === undefined) {
      delete process.env.DATA_PROVIDER;
    } else {
      process.env.DATA_PROVIDER = originalProvider;
    }
    if (originalInterval === undefined) {
      delete process.env.SYNC_INTERVAL_HOURS;
    } else {
      process.env.SYNC_INTERVAL_HOURS = originalInterval;
    }
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test("getSyncState exposes initial provider and interval from configuration", async () => {
  await withTempService(async ({ getSyncState }) => {
    const state = getSyncState();

    assert.equal(state.provider, "mock");
    assert.equal(state.intervalHours, 6);
    assert.equal(state.running, false);
    assert.equal(state.lastStatus, "等待首次同步");
    assert.equal(state.lastError, null);
  });
});

test("buildSalesWeeklySyncSource writes the v3 cache shape with 30-day records", async () => {
  await withTempService(async ({ buildSalesWeeklySyncSource }) => {
    const source = buildSalesWeeklySyncSource({
      sellers: [{ sid: 1, name: "探嘉美国" }],
      orderProfitRecords: [{ sid: 1, msku: "MSKU-1", totalSalesAmount: 100 }],
      recent30OrderProfitRecords: [{ sid: 1, msku: "MSKU-1", totalSalesAmount: 500, totalSalesRefunds: 10 }],
      range: { startDate: "2026-08-01", endDate: "2026-08-09" },
      currencyCode: "CNY",
      raw: { recent30: { startDate: "2026-07-11", endDate: "2026-08-09", recordCount: 1 } },
    }, { rows: [] }, []);

    assert.equal(source.cacheScope.version, "sales-weekly-source-v3");
    assert.deepEqual(source.recent30OrderProfitRecords, [{ sid: 1, msku: "MSKU-1", totalSalesAmount: 500, totalSalesRefunds: 10 }]);
    assert.deepEqual(source.raw.recent30, { startDate: "2026-07-11", endDate: "2026-08-09", recordCount: 1 });
  });
});

test("runManualSync completes the mock sync path and updates state timestamps", async () => {
  await withTempService(async ({ runManualSync, getSyncState, getSyncStatus }) => {
    const result = await runManualSync();
    const state = getSyncState();
    const status = await getSyncStatus();

    assert.equal(result.ok, true);
    assert.equal(result.provider, "mock");
    assert.equal(result.rows, 0);
    assert.equal(result.message, "模拟同步完成，正式接入后这里会写入领星数据。");
    assert.equal(state.running, false);
    assert.equal(state.lastError, null);
    assert.equal(state.lastStatus, result.message);
    assert.ok(state.lastStartedAt);
    assert.ok(state.lastFinishedAt);
    assert.equal(state.lastSuccessAt, state.lastFinishedAt);
    assert.equal(status.history.length, 1);
    assert.equal(status.history[0].status, "success");
    assert.equal(status.history[0].triggerType, "manual");
  });
});

test("runManualSync rejects a duplicate trigger while a sync is already running", async () => {
  await withTempService(async ({ runManualSync, getSyncState, getSyncStatus }) => {
    const first = runManualSync();
    const second = await runManualSync();
    const firstResult = await first;
    const finalState = getSyncState();
    const status = await getSyncStatus();

    assert.equal(second.ok, false);
    assert.equal(second.message, "已有同步任务正在运行，请稍后再试。");
    assert.equal(second.state.running, true);
    assert.equal(firstResult.ok, true);
    assert.equal(finalState.running, false);
    assert.equal(finalState.lastError, null);
    assert.equal(status.history.some((job) => job.status === "skipped" && job.triggerType === "manual"), true);
  });
});

test("runSync records scheduled trigger type and failed error summaries", async () => {
  await withTempService(async ({ runSync, getSyncStatus }) => {
    const scheduled = await runSync({ triggerType: "scheduled", triggeredBy: "timer" });
    const failed = await runSync({
      triggerType: "startup",
      triggeredBy: "boot",
      executeSync: async () => {
        throw new Error("access_token abc123 failed");
      },
    });
    const status = await getSyncStatus();

    assert.equal(scheduled.ok, true);
    assert.equal(failed.ok, false);
    assert.equal(status.history.some((job) => job.status === "success" && job.triggerType === "scheduled"), true);
    const failedJob = status.history.find((job) => job.status === "failed" && job.triggerType === "startup");
    assert.ok(failedJob);
    assert.equal(failedJob.errorSummary.includes("abc123"), false);
  });
});

test("lingxing sync refreshes the rolling sales-facts scope and reports cache metadata", async () => {
  await withTempService(async ({ configureSalesFactsSyncService, runManualSync }) => {
    const fixedMs = Date.parse("2026-08-13T12:00:00.000Z");
    let requestedScope = null;
    let requestedOptions = null;
    configureSalesFactsSyncService({
      now: () => fixedMs,
      getSellerDirectory: async () => [
        { sid: 1, name: "探嘉美国", countryCode: "US", status: 1 },
        { sid: 2, name: "探嘉加拿大", countryCode: "CA", status: 1 },
      ],
      refreshOrderProfitScope: async (scope, options) => {
        requestedScope = scope;
        requestedOptions = options;
        return {
          facts: [{ factDate: scope.endDate, sid: 1 }, { factDate: scope.endDate, sid: 2 }],
          meta: {
            cacheState: "refreshed",
            revision: 7,
            updatedAt: "2026-08-13T12:00:00.000Z",
            ageSeconds: 0,
          },
        };
      },
      captureInventorySnapshot: async () => ({ date: "2026-08-13", rowCount: 0 }),
    });

    const result = await runManualSync();

    assert.equal(result.ok, true);
    assert.equal(result.provider, "lingxing");
    assert.equal(result.rows, 2);
    assert.equal(result.cacheState, "refreshed");
    assert.equal(result.revision, 7);
    assert.equal(result.rangeKey, requestedScope.rangeKey);
    assert.equal(requestedScope.dates.length, 30);
    assert.deepEqual(requestedScope.sids, [1, 2]);
    assert.equal(requestedScope.currencyMode, "CNY");
    assert.equal(requestedOptions.forceRefresh, false);
    assert.equal(requestedOptions.requestId, "sync-sales-facts");
  }, { provider: "lingxing" });
});

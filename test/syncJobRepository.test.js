import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendSkippedSyncJob,
  finishSyncJob,
  listRecentSyncJobs,
  startSyncJob,
} from "../src/repositories/syncJobRepository.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-sync-jobs-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("sync job repository records running and success states", async () => {
  await withTempDir(async (dir) => {
    const running = await startSyncJob({
      dataDir: dir,
      jobName: "lingxing-sync",
      triggerType: "manual",
      triggeredBy: "tester",
      metadata: { provider: "mock" },
    });
    const finished = await finishSyncJob({
      dataDir: dir,
      jobId: running.jobId,
      status: "success",
      fetchedCount: 3,
      processedCount: 2,
      failedCount: 1,
    });

    assert.equal(finished.status, "success");
    assert.equal(finished.jobName, "lingxing-sync");
    assert.equal(finished.triggerType, "manual");
    assert.equal(finished.triggeredBy, "tester");
    assert.equal(finished.fetchedCount, 3);
    assert.equal(finished.processedCount, 2);
    assert.equal(finished.failedCount, 1);
    assert.ok(finished.startedAt);
    assert.ok(finished.finishedAt);
    assert.ok(finished.durationMs >= 0);
  });
});

test("sync job repository stores failed and skipped records with safe summaries", async () => {
  await withTempDir(async (dir) => {
    const running = await startSyncJob({ dataDir: dir, jobName: "lingxing-sync", triggerType: "scheduled" });
    const failed = await finishSyncJob({
      dataDir: dir,
      jobId: running.jobId,
      status: "failed",
      errorSummary: "access_token abc123 failed",
    });
    const skipped = await appendSkippedSyncJob({
      dataDir: dir,
      jobName: "lingxing-sync",
      triggerType: "manual",
      triggeredBy: "tester",
      errorSummary: "lock held",
    });

    assert.equal(failed.status, "failed");
    assert.equal(failed.errorSummary.includes("abc123"), false);
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.errorSummary, "lock held");
  });
});

test("listRecentSyncJobs returns newest records first and honors limit", async () => {
  await withTempDir(async (dir) => {
    const first = await startSyncJob({ dataDir: dir, jobName: "first", triggerType: "manual" });
    await finishSyncJob({ dataDir: dir, jobId: first.jobId, status: "success" });
    const second = await appendSkippedSyncJob({ dataDir: dir, jobName: "second", triggerType: "scheduled", errorSummary: "busy" });
    const recent = await listRecentSyncJobs({ dataDir: dir, limit: 1 });

    assert.equal(recent.length, 1);
    assert.equal(recent[0].jobId, second.jobId);
  });
});

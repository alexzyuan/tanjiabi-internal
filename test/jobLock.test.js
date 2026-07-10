import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireJobLock,
  releaseJobLock,
  withJobLock,
} from "../src/jobs/jobLock.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-job-lock-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("acquireJobLock creates and releaseJobLock removes an owned lock", async () => {
  await withTempDir(async (dir) => {
    const lock = await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 1000, owner: "test" });
    assert.equal(lock.acquired, true);
    assert.equal(lock.jobName, "lingxing-sync");
    assert.equal(lock.owner, "test");

    const released = await releaseJobLock(lock, { dataDir: dir });
    assert.equal(released, true);
    const next = await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 1000 });
    assert.equal(next.acquired, true);
  });
});

test("acquireJobLock rejects duplicate unexpired locks", async () => {
  await withTempDir(async (dir) => {
    const first = await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 60_000, owner: "first" });
    const second = await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 60_000, owner: "second" });

    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.match(second.reason, /already running/i);
    assert.equal(second.existing.owner, "first");
  });
});

test("expired locks can be acquired by a new owner", async () => {
  await withTempDir(async (dir) => {
    await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: -1, owner: "old" });
    const next = await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 60_000, owner: "new" });

    assert.equal(next.acquired, true);
    assert.equal(next.owner, "new");
  });
});

test("withJobLock releases locks after success and after exceptions", async () => {
  await withTempDir(async (dir) => {
    const result = await withJobLock("lingxing-sync", async () => "ok", { dataDir: dir, ttlMs: 60_000 });
    assert.equal(result, "ok");
    assert.equal((await acquireJobLock("lingxing-sync", { dataDir: dir, ttlMs: 60_000 })).acquired, true);

    await assert.rejects(
      () => withJobLock("failing-sync", async () => {
        throw new Error("boom");
      }, { dataDir: dir, ttlMs: 60_000 }),
      /boom/,
    );
    assert.equal((await acquireJobLock("failing-sync", { dataDir: dir, ttlMs: 60_000 })).acquired, true);
  });
});

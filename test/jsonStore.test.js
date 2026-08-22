import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

import {
  backupJson,
  getJsonStoreCommitUncertainty,
  readJson,
  readJsonWithRecovery,
  reconcileJsonStoreCommit,
  updateJsonAtomic,
  writeJsonAtomic,
} from "../src/utils/jsonStore.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-json-store-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function reconcileFile(filePath) {
  const content = await readFile(filePath, "utf8");
  return reconcileJsonStoreCommit(filePath, {
    expectedSha256: createHash("sha256").update(content).digest("hex"),
  });
}

test("readJson returns fallback for missing files", async () => {
  await withTempDir(async (dir) => {
    const value = await readJson(path.join(dir, "missing.json"), { rows: [] });
    assert.deepEqual(value, { rows: [] });
  });
});

test("writeJsonAtomic writes complete JSON and creates parent directories", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "nested", "state.json");
    await writeJsonAtomic(file, { ok: true });

    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { ok: true });
  });
});

test("writeJsonAtomic does not replace old file when serialization fails", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 1 });
    const circular = {};
    circular.self = circular;

    await assert.rejects(() => writeJsonAtomic(file, circular), /circular|Converting/i);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
  });
});

test("writeJsonAtomic reports an uncertain post-rename commit without retrying", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 1 });
    const syncDirectory = async () => {
      const error = new Error("directory sync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      await assert.rejects(
        () => writeJsonAtomic(file, { version: 2 }, { syncDirectory }),
        (error) => {
          assert.equal(error.code, "DIRECTORY_FSYNC_FAILED");
          assert.equal(error.filePath, file);
          assert.equal(error.directory, dir);
          assert.equal(error.causeCode, "EIO");
          assert.equal(error.commitState, "unknown");
          assert.equal(error.targetMayContainNewValue, true);
          assert.equal(error.markerPersisted, true);
          assert.equal(error.retryable, false);
          return true;
        },
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2 });
    } finally {
      await reconcileFile(file);
    }
  });
});

test("writeJsonAtomic keeps the old target when the write-ahead marker cannot be fsynced", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 1 });
    const syncMarkerFile = async () => {
      const error = new Error("marker fsync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      await assert.rejects(
        () => writeJsonAtomic(file, { version: 2 }, { syncMarkerFile }),
        (error) => {
          assert.equal(error.code, "DIRECTORY_FSYNC_FAILED");
          assert.equal(error.causeCode, "EIO");
          assert.equal(error.commitState, "unknown");
          assert.equal(error.targetMayContainNewValue, false);
          assert.equal(error.markerPersisted, false);
          assert.equal(error.markerPersistenceErrorCode, "EIO");
          return true;
        },
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
      assert.equal(getJsonStoreCommitUncertainty(file).targetMayContainNewValue, false);
    } finally {
      await reconcileFile(file);
    }
  });
});

test("writeJsonAtomic keeps the old target when the persisted marker directory cannot be fsynced", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 1 });
    const syncMarkerDirectory = async () => {
      const error = new Error("marker directory fsync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      await assert.rejects(
        () => writeJsonAtomic(file, { version: 2 }, { syncMarkerDirectory }),
        (error) => {
          assert.equal(error.code, "DIRECTORY_FSYNC_FAILED");
          assert.equal(error.causeCode, "EIO");
          assert.equal(error.commitState, "unknown");
          assert.equal(error.targetMayContainNewValue, false);
          assert.equal(error.markerPersisted, true);
          return true;
        },
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
      await access(`${file}.uncertain`);
    } finally {
      await reconcileFile(file);
    }
  });
});

test("writeJsonAtomic serializes concurrent writes before recording an uncertain commit", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    let releaseSync;
    let markSyncStarted;
    const syncStarted = new Promise((resolve) => {
      markSyncStarted = resolve;
    });
    const holdSync = new Promise((resolve) => {
      releaseSync = resolve;
    });
    let syncCalls = 0;
    const syncDirectory = async () => {
      syncCalls += 1;
      markSyncStarted();
      await holdSync;
      const error = new Error("directory sync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      const first = writeJsonAtomic(file, { version: 1 }, { syncDirectory });
      await syncStarted;
      const second = writeJsonAtomic(file, { version: 2 }, { syncDirectory });
      releaseSync();

      await assert.rejects(first, (error) => error.commitState === "unknown");
      await assert.rejects(second, (error) => error.commitState === "unknown");
      assert.equal(syncCalls, 1);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
    } finally {
      await reconcileFile(file);
    }
  });
});

test("reconcileJsonStoreCommit requires a matching current-file hash before unblocking writes", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    const syncDirectory = async () => {
      const error = new Error("directory sync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      await assert.rejects(() => writeJsonAtomic(file, { version: 1 }, { syncDirectory }), (error) => error.commitState === "unknown");
      assert.equal(getJsonStoreCommitUncertainty(file).requiresReconciliation, true);
      const content = await readFile(file, "utf8");
      const sha256 = createHash("sha256").update(content).digest("hex");

      await assert.rejects(
        () => reconcileJsonStoreCommit(file, { expectedSha256: "0".repeat(64) }),
        (error) => error.code === "RECONCILIATION_HASH_MISMATCH" && error.statusCode === 409,
      );
      assert.ok(getJsonStoreCommitUncertainty(file));

      const reconciled = await reconcileJsonStoreCommit(file, { expectedSha256: sha256 });
      assert.equal(reconciled.status, "cleared");
      assert.equal(getJsonStoreCommitUncertainty(file), null);
      await writeJsonAtomic(file, { version: 2 });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2 });
    } finally {
      await reconcileFile(file);
    }
  });
});

test("persisted uncertainty blocks writes across process restarts until hash reconciliation", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    const storeUrl = path.join(process.cwd(), "src/utils/jsonStore.js");
    const failScript = [
      `const { writeJsonAtomic } = await import(${JSON.stringify(storeUrl)});`,
      "try {",
      "  await writeJsonAtomic('state.json', { version: 1 }, { syncDirectory: async () => { const error = new Error('directory sync failed'); error.code = 'EIO'; throw error; } });",
      "  console.log(JSON.stringify({ ok: true }));",
      "} catch (error) {",
      "  console.log(JSON.stringify({ ok: false, code: error.code, commitState: error.commitState, markerPersisted: error.markerPersisted }));",
      "}",
    ].join("\n");
    const blockedScript = [
      `const { writeJsonAtomic } = await import(${JSON.stringify(storeUrl)});`,
      "try {",
      "  await writeJsonAtomic('state.json', { version: 2 });",
      "  console.log(JSON.stringify({ ok: true }));",
      "} catch (error) {",
      "  console.log(JSON.stringify({ ok: false, code: error.code, commitState: error.commitState, markerPersisted: error.markerPersisted }));",
      "}",
    ].join("\n");
    const successScript = [
      `const { writeJsonAtomic } = await import(${JSON.stringify(storeUrl)});`,
      "await writeJsonAtomic('state.json', { version: 2 });",
      "console.log(JSON.stringify({ ok: true }));",
    ].join("\n");

    try {
      const first = JSON.parse((await execFile(process.execPath, ["--input-type=module", "--eval", failScript], { cwd: dir })).stdout.trim());
      assert.deepEqual(first, { ok: false, code: "DIRECTORY_FSYNC_FAILED", commitState: "unknown", markerPersisted: true });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
      await access(`${file}.uncertain`);

      const restart = JSON.parse((await execFile(process.execPath, ["--input-type=module", "--eval", blockedScript], { cwd: dir })).stdout.trim());
      assert.deepEqual(restart, { ok: false, code: "JSON_COMMIT_UNCERTAIN", commitState: "unknown", markerPersisted: true });

      const content = await readFile(file, "utf8");
      const sha256 = createHash("sha256").update(content).digest("hex");
      const reconciled = await reconcileJsonStoreCommit(file, { expectedSha256: sha256 });
      assert.equal(reconciled.status, "cleared");

      const success = JSON.parse((await execFile(process.execPath, ["--input-type=module", "--eval", successScript], { cwd: dir })).stdout.trim());
      assert.deepEqual(success, { ok: true });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2 });
    } finally {
      await reconcileFile(file);
    }
  });
});

test("reconcileJsonStoreCommit waits for an in-flight write before clearing its uncertainty", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 0 });
    let releaseSync;
    let markSyncStarted;
    const syncStarted = new Promise((resolve) => {
      markSyncStarted = resolve;
    });
    const holdSync = new Promise((resolve) => {
      releaseSync = resolve;
    });
    const syncDirectory = async () => {
      markSyncStarted();
      await holdSync;
      const error = new Error("directory sync failed");
      error.code = "EIO";
      throw error;
    };

    const writePromise = writeJsonAtomic(file, { version: 1 }, { syncDirectory });
    await syncStarted;
    const content = await readFile(file, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    let reconciliationSettled = false;
    const reconciliation = reconcileJsonStoreCommit(file, { expectedSha256: sha256 }).then((result) => {
      reconciliationSettled = true;
      return result;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(reconciliationSettled, false);
      releaseSync();
      await assert.rejects(writePromise, (error) => error.commitState === "unknown");
      assert.equal((await reconciliation).status, "cleared");
      assert.equal(getJsonStoreCommitUncertainty(file), null);
    } finally {
      releaseSync();
      await reconciliation.catch(() => {});
      await reconcileFile(file);
    }
  });
});

test("writeJsonAtomic tolerates an explicitly unsupported directory fsync", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    const syncDirectory = async () => {
      const error = new Error("directory sync unsupported");
      error.code = "EOPNOTSUPP";
      throw error;
    };

    await writeJsonAtomic(file, { version: 1 }, { syncDirectory });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
  });
});

test("updateJsonAtomic does not queue a follow-up update after an uncertain commit", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    let syncCalls = 0;
    const syncDirectory = async () => {
      syncCalls += 1;
      const error = new Error("directory sync failed");
      error.code = "EIO";
      throw error;
    };

    try {
      const first = updateJsonAtomic(file, () => ({ version: 1 }), { version: 0 }, { syncDirectory });
      const second = updateJsonAtomic(file, () => ({ version: 2 }), { version: 0 }, { syncDirectory });

      await assert.rejects(first, (error) => error.commitState === "unknown" && error.retryable === false);
      await assert.rejects(second, (error) => error.commitState === "unknown" && error.retryable === false);
      assert.equal(syncCalls, 1);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });

      await assert.rejects(
        () => updateJsonAtomic(file, () => ({ version: 3 }), { version: 0 }),
        (error) => error.commitState === "unknown" && error.requiresReconciliation === true,
      );
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });

      assert.equal((await reconcileFile(file)).status, "cleared");
      await updateJsonAtomic(file, () => ({ version: 3 }), { version: 0 });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 3 });
    } finally {
      await reconcileFile(file);
    }
  });
});

test("readJson throws a clear parse error for invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "broken.json");
    await writeFile(file, "{broken", "utf8");

    await assert.rejects(
      () => readJson(file, {}),
      (error) => {
        assert.equal(error.code, "JSON_PARSE_FAILED");
        assert.equal(error.filePath, file);
        return true;
      },
    );
  });
});

test("backupJson and readJsonWithRecovery restore a valid backup", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { version: 1 });
    const backupFile = await backupJson(file);
    await writeFile(file, "{broken", "utf8");

    const value = await readJsonWithRecovery(file, { version: 0 });

    assert.deepEqual(value, { version: 1 });
    assert.match(backupFile, /\.bak$/);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
  });
});

test("updateJsonAtomic applies sequential updates through the same store path", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "counter.json");
    await updateJsonAtomic(file, (current) => ({ count: (current?.count || 0) + 1 }), { count: 0 });
    await updateJsonAtomic(file, (current) => ({ count: current.count + 1 }), { count: 0 });

    assert.deepEqual(await readJson(file, { count: 0 }), { count: 2 });
  });
});

test("updateJsonAtomic preserves concurrent updates through the same store path", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "history.json");
    let releaseFirst;
    const firstCanFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted;
    const firstStartedPromise = new Promise((resolve) => {
      firstStarted = resolve;
    });

    const first = updateJsonAtomic(file, async (current) => {
      firstStarted();
      await firstCanFinish;
      return { entries: [...(current?.entries || []), "first"] };
    }, { entries: [] });

    await firstStartedPromise;
    const second = updateJsonAtomic(file, (current) => ({
      entries: [...(current?.entries || []), "second"],
    }), { entries: [] });

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual((await readJson(file, { entries: [] })).entries.sort(), ["first", "second"]);
  });
});

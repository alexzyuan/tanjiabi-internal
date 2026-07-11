import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backupJson,
  readJson,
  readJsonWithRecovery,
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

#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

/**
 * Run a disposable SQLite capability check for sales-facts.sqlite.
 *
 * The smoke database is always outside data-cache.  It exercises the same
 * native module and SQLite pragmas as the sales-facts repository, then removes
 * the database, WAL/SHM sidecars, and an owned temporary directory even when
 * setup or an assertion fails.
 */
export async function runSalesFactsSqliteSmoke({
  directory = null,
  fsOps = {},
  databaseFactory = (databasePath) => new Database(databasePath),
} = {}) {
  const fileSystem = { mkdir, mkdtemp, rm, ...fsOps };
  const ownsDirectory = !directory;
  let workingDirectory = directory;
  let databasePath = null;
  let database = null;
  let operationError = null;
  const cleanupErrors = [];
  let result = null;

  try {
    workingDirectory = directory || await fileSystem.mkdtemp(path.join(tmpdir(), "sales-facts-smoke-"));
    databasePath = path.join(workingDirectory, "smoke.sqlite");
    await fileSystem.mkdir(workingDirectory, { recursive: true });

    database = await databaseFactory(databasePath);
    if (!database || typeof database.prepare !== "function" || typeof database.pragma !== "function") {
      throw new Error("sales facts SQLite smoke database factory returned an invalid database");
    }

    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("synchronous = FULL");

    const sqliteVersion = String(database.prepare("SELECT sqlite_version() AS version").get()?.version || "");
    if (!/^\d+\.\d+\.\d+$/u.test(sqliteVersion)) throw new Error("SQLite version query returned an invalid value");

    const journalMode = String(database.pragma("journal_mode", { simple: true })).toLowerCase();
    const foreignKeys = Number(database.pragma("foreign_keys", { simple: true }));
    const busyTimeout = Number(database.pragma("busy_timeout", { simple: true }));
    const synchronous = Number(database.pragma("synchronous", { simple: true }));
    assert.equal(journalMode, "wal");
    assert.equal(foreignKeys, 1);
    assert.equal(busyTimeout, 5000);
    assert.equal(synchronous, 2);

    database.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    const insert = database.prepare("INSERT INTO smoke(value) VALUES (?)");
    const select = database.prepare("SELECT value FROM smoke WHERE id = ?");
    const update = database.prepare("UPDATE smoke SET value = ? WHERE id = ?");
    const remove = database.prepare("DELETE FROM smoke WHERE id = ?");
    assert.equal(insert.run("initial").changes, 1);
    assert.equal(select.get(1)?.value, "initial");
    assert.equal(update.run("updated", 1).changes, 1);
    assert.equal(select.get(1)?.value, "updated");
    assert.equal(remove.run(1).changes, 1);
    assert.equal(select.get(1), undefined);

    let committedId = null;
    const commitTransaction = database.transaction(() => {
      committedId = insert.run("committed").lastInsertRowid;
    });
    commitTransaction();
    assert.equal(select.get(committedId)?.value, "committed");

    const rollbackTransaction = database.transaction(() => {
      insert.run("rolled-back");
      throw new Error("forced rollback");
    });
    assert.throws(rollbackTransaction, /forced rollback/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM smoke WHERE value = ?").get("rolled-back")?.count, 0);

    const quickCheck = String(database.pragma("quick_check", { simple: true })).toLowerCase();
    const integrityCheck = String(database.pragma("integrity_check", { simple: true })).toLowerCase();
    assert.equal(quickCheck, "ok");
    assert.equal(integrityCheck, "ok");

    result = {
      ok: true,
      sqliteVersion,
      journalMode,
      foreignKeys,
      busyTimeout,
      synchronous,
      crudVerified: true,
      transactionCommitVerified: true,
      transactionRollbackVerified: true,
      quickCheck,
      integrityCheck,
    };
  } catch (error) {
    operationError = error;
  } finally {
    try {
      if (database?.open && typeof database.close === "function") database.close();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (workingDirectory && databasePath) {
      const cleanupResults = await Promise.allSettled([
        "smoke.sqlite",
        "smoke.sqlite-wal",
        "smoke.sqlite-shm",
      ].map((name) => Promise.resolve().then(() => fileSystem.rm(
        path.join(workingDirectory, name),
        { force: true },
      ))));
      cleanupResults
        .filter((outcome) => outcome.status === "rejected")
        .forEach((outcome) => cleanupErrors.push(outcome.reason));
    }

    if (ownsDirectory && workingDirectory) {
      try {
        await fileSystem.rm(workingDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  const cleanupError = cleanupErrors.length
    ? new AggregateError(cleanupErrors, "Sales facts SQLite smoke cleanup failed")
    : null;
  if (operationError && cleanupError) {
    const combinedError = new AggregateError(
      [operationError, cleanupError],
      `Sales facts SQLite smoke failed: ${operationError?.message || "operation error"}; cleanup also failed`,
      { cause: operationError },
    );
    combinedError.operationError = operationError;
    combinedError.cleanupError = cleanupError;
    throw combinedError;
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return result;
}

async function main() {
  try {
    console.log(JSON.stringify(await runSalesFactsSqliteSmoke()));
  } catch (error) {
    console.error(`[sales-facts-sqlite-smoke] failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}

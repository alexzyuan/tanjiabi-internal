#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

/**
 * Open a temporary SQLite database using the production native module and
 * verify the write/read/rollback path used by the product-catalog repository.
 * The database is deliberately disposable: it must never touch data-cache.
 */
export async function runProductCatalogSqliteSmoke({ directory = null } = {}) {
  const ownsDirectory = !directory;
  const workingDirectory = directory || await mkdtemp(path.join(tmpdir(), "product-catalog-smoke-"));
  await mkdir(workingDirectory, { recursive: true });

  const databasePath = path.join(workingDirectory, "smoke.sqlite");
  let database = null;
  let operationError = null;
  let cleanupError = null;
  let result = null;

  try {
    database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.pragma("synchronous = FULL");
    database.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");

    database.prepare("INSERT INTO smoke(value) VALUES (?)").run("committed");
    assert.equal(database.prepare("SELECT value FROM smoke WHERE id = 1").get()?.value, "committed");

    const transaction = database.transaction(() => {
      database.prepare("INSERT INTO smoke(value) VALUES (?)").run("rolled-back");
      throw new Error("rollback");
    });
    assert.throws(transaction, /rollback/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM smoke WHERE value = ?").get("rolled-back")?.count, 0);

    result = {
      ok: true,
      journalMode: String(database.pragma("journal_mode", { simple: true })).toLowerCase(),
      transactionRollbackVerified: true,
    };
    assert.equal(result.journalMode, "wal");
  } catch (error) {
    operationError = error;
  }

  try {
    if (database?.open) database.close();
  } catch (error) {
    cleanupError = error;
  }

  try {
    await Promise.all([
      "smoke.sqlite",
      "smoke.sqlite-wal",
      "smoke.sqlite-shm",
    ].map((name) => rm(path.join(workingDirectory, name), { force: true })));
    if (ownsDirectory) await rm(workingDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupError ||= error;
  }

  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return result;
}

async function main() {
  try {
    const result = await runProductCatalogSqliteSmoke();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[product-catalog-sqlite-smoke] failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}

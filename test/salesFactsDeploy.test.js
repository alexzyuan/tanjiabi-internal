import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("sales facts SQLite smoke verifies native settings, CRUD, transactions, and integrity", async () => {
  const { runSalesFactsSqliteSmoke } = await import("../scripts/sales-facts-sqlite-smoke.js");
  const directory = await mkdtemp(path.join(tmpdir(), "sales-facts-deploy-test-"));
  try {
    const result = await runSalesFactsSqliteSmoke({ directory });
    assert.equal(result.ok, true);
    assert.match(result.sqliteVersion, /^\d+\.\d+\.\d+$/u);
    assert.equal(result.journalMode, "wal");
    assert.equal(result.foreignKeys, 1);
    assert.equal(result.busyTimeout, 5000);
    assert.equal(result.synchronous, 2);
    assert.equal(result.crudVerified, true);
    assert.equal(result.transactionCommitVerified, true);
    assert.equal(result.transactionRollbackVerified, true);
    assert.equal(result.quickCheck, "ok");
    assert.equal(result.integrityCheck, "ok");
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sales facts SQLite smoke preserves operation failure and attempts all cleanup", async () => {
  const calls = [];
  const fsOps = {
    mkdtemp: async () => "/tmp/sales-facts-operation-failure",
    mkdir: async () => {},
    rm: async (target, options) => { calls.push({ target, options }); },
  };
  const { runSalesFactsSqliteSmoke } = await import("../scripts/sales-facts-sqlite-smoke.js");

  await assert.rejects(
    runSalesFactsSqliteSmoke({
      fsOps,
      databaseFactory: () => { throw new Error("native module unavailable"); },
    }),
    /native module unavailable/,
  );

  assert.deepEqual(calls.map(({ target }) => target), [
    "/tmp/sales-facts-operation-failure/smoke.sqlite",
    "/tmp/sales-facts-operation-failure/smoke.sqlite-wal",
    "/tmp/sales-facts-operation-failure/smoke.sqlite-shm",
    "/tmp/sales-facts-operation-failure",
  ]);
  assert.equal(calls.at(-1)?.options?.recursive, true);
});

test("sales facts SQLite smoke exposes partial cleanup failures", async () => {
  const calls = [];
  const fsOps = {
    mkdtemp: async () => "/tmp/sales-facts-cleanup-failure",
    mkdir: async () => {},
    rm: (target, options) => {
      calls.push({ target, options });
      if (target.endsWith("smoke.sqlite-wal")) throw new Error("wal cleanup failed");
    },
  };
  const { runSalesFactsSqliteSmoke } = await import("../scripts/sales-facts-sqlite-smoke.js");

  await assert.rejects(
    runSalesFactsSqliteSmoke({ fsOps, databaseFactory: () => { throw new Error("operation failed"); } }),
    (error) => {
      assert.match(error.message, /cleanup/i);
      assert.ok(error.cleanupError instanceof AggregateError);
      assert.ok(error.cleanupError.errors.some((cause) => cause?.message === "wal cleanup failed"));
      return true;
    },
  );
  assert.equal(calls.length, 4);
});

test("sales facts schema validator bootstraps and validates the production schema", async () => {
  const { validateSalesFactsDatabase } = await import("../scripts/validate-sales-facts-schema.js");
  const directory = await mkdtemp(path.join(tmpdir(), "sales-facts-schema-test-"));
  const databasePath = path.join(directory, "sales-facts.sqlite");
  try {
    const result = validateSalesFactsDatabase({ databasePath, logger: { info() {}, error() {} } });
    assert.deepEqual(result, {
      ok: true,
      schemaVersion: 1,
      quickCheck: "ok",
      salesFactsRevision: 0,
      ownerRevision: 0,
      dailyFactCount: 0,
      factCoverageCount: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment package advertises the sales facts capability and smoke/schema entrypoints", async () => {
  const [packageSource, deploySource, packageJson] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../scripts/package-deploy.js", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../deploy.sh", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../package.json", import.meta.url), "utf8")),
  ]);
  assert.match(packageSource, /sales-facts-sqlite-v1/);
  assert.match(packageSource, /scripts\/sales-facts-sqlite-smoke\.js/);
  assert.match(packageSource, /scripts\/validate-sales-facts-schema\.js/);
  assert.match(packageSource, /scripts\/validate-sales-facts-preflight-artifact\.js/);
  assert.match(packageSource, /deployScope/);
  assert.match(packageSource, /requiresSalesFactsPreflight/);
  assert.match(deploySource, /node scripts\/sales-facts-sqlite-smoke\.js/);
  assert.match(deploySource, /node scripts\/validate-sales-facts-schema\.js/);
  assert.match(deploySource, /node scripts\/validate-sales-facts-preflight-artifact\.js/);
  assert.match(deploySource, /SALES_FACTS_PREFLIGHT_ARTIFACT/);
  assert.match(deploySource, /SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256/);
  assert.match(deploySource, /SKIP_SALES_FACTS_PREFLIGHT/);
  assert.match(deploySource, /DEPLOY_SCOPE_FROM_MANIFEST/);
  assert.match(packageJson, /sales-facts:sqlite:smoke/);
  assert.match(packageJson, /sales-facts:schema:check/);
});

test("sales facts preflight artifact requires the complete approved daily contract", async () => {
  const { validateSalesFactsPreflightArtifact } = await import("../scripts/validate-sales-facts-preflight-artifact.js");
  const valid = {
    ok: true,
    exitCode: 0,
    approvedFetchMode: "daily",
    dailyValidationComplete: true,
    monthlyRequestCount: 1,
    dailyRequestCount: 31,
    sidCount: 18,
    identityMismatchCount: 0,
    metricMismatchCount: 0,
    actualPagination: {
      requestCount: 32,
      pageCount: 32,
      incompleteRequestCount: 0,
      safetyLimitHitCount: 0,
    },
  };

  assert.doesNotThrow(() => validateSalesFactsPreflightArtifact(valid));
  for (const [label, mutate] of [
    ["approved fetch mode", (report) => { delete report.approvedFetchMode; }],
    ["daily completeness", (report) => { delete report.dailyValidationComplete; }],
    ["identity mismatch count", (report) => { delete report.identityMismatchCount; }],
    ["metric mismatch count", (report) => { delete report.metricMismatchCount; }],
    ["pagination completeness", (report) => { delete report.actualPagination.incompleteRequestCount; }],
    ["pagination safety limit", (report) => { report.actualPagination.safetyLimitHitCount = 1; }],
  ]) {
    const report = structuredClone(valid);
    mutate(report);
    assert.throws(() => validateSalesFactsPreflightArtifact(report), new RegExp(label.replaceAll(" ", ".*"), "iu"));
  }
});

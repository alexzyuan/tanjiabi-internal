import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  normalizeSalesFactsScope,
  SalesFactsConflictError,
  SalesFactsDatabaseError,
} from "../src/services/salesFactsIdentity.js";
import { createSalesFactsRepository } from "../src/services/salesFactsRepository.js";

const sellers = [{ sid: 8708, countryCode: "US", status: 1 }];

function scopeFor(startDate = "2026-08-01", endDate = startDate) {
  return normalizeSalesFactsScope({
    startDate,
    endDate,
    sids: [8708],
    currencyMode: "CNY",
    sellerDirectory: sellers,
    now: new Date("2026-08-13T08:00:00Z"),
  });
}

function fact(overrides = {}) {
  return {
    factDate: "2026-08-01",
    sid: 8708,
    msku: "MSKU-A",
    mskuKey: "msku-a",
    currencyMode: "CNY",
    actualCurrencyCode: "CNY",
    metrics: { totalSalesAmount: 0n, totalSalesQuantity: 20000n },
    sourceUpdatedAtMs: 900,
    ...overrides,
  };
}

function coverage(overrides = {}) {
  return {
    factDate: "2026-08-01",
    sid: 8708,
    currencyMode: "CNY",
    sourceUpdatedAtMs: 900,
    rowCount: 1,
    pageCount: 1,
    ...overrides,
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-facts-repository-test-"));
  const databasePath = path.join(directory, "sales-facts-v1.sqlite");
  const repository = createSalesFactsRepository({
    databasePath,
    now: () => 1000,
    logger: { info() {}, error() {} },
    ...options,
  });
  t.after(() => {
    repository.close();
    return rm(directory, { recursive: true, force: true });
  });
  return { repository, databasePath };
}

test("initializes the exact WAL schema with integer metrics and zero revisions", async (t) => {
  const { repository, databasePath } = await fixture(t);
  const schema = repository.getSchemaInfo();
  assert.equal(schema.version, 1);
  assert.equal(schema.journalMode, "wal");
  assert.equal(schema.foreignKeys, 1);
  assert.equal(schema.busyTimeout, 5000);
  assert.equal(schema.synchronous, 2);
  assert.deepEqual(repository.getRevisions(), { salesFactsRevision: 0, ownerRevision: 0 });

  const readonlyDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  t.after(() => readonlyDb.close());
  const tables = readonlyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => name);
  assert.deepEqual(tables, [
    "custom_fee_coverage_monthly",
    "custom_fee_monthly",
    "fact_coverage_daily",
    "listing_owner_period",
    "order_profit_daily",
    "sales_derived_cache",
    "sales_facts_metadata",
    "schema_migrations",
  ]);
  const amountColumn = readonlyDb.prepare("PRAGMA table_info(order_profit_daily)").all()
    .find(({ name }) => name === "total_sales_amount");
  assert.equal(amountColumn.type, "INTEGER");
});

test("replaces facts and coverage atomically while preserving zero", async (t) => {
  const { repository } = await fixture(t);
  const before = repository.getRevisions();
  const result = repository.replaceOrderProfitScope({
    scope: scopeFor(),
    facts: [fact()],
    coverage: [coverage()],
    requestId: "facts-test-1",
    refreshedAtMs: 1000,
    refreshBatchId: "batch-1",
  });

  assert.equal(result.salesFactsRevision, before.salesFactsRevision + 1);
  const [stored] = repository.readFacts(scopeFor());
  assert.equal(stored.metrics.totalSalesAmount, 0n);
  assert.equal(stored.metrics.totalSalesQuantity, 20000n);
  assert.equal(repository.readCoverage(scopeFor()).length, 1);
});

test("a failed replacement leaves facts, coverage, and revision unchanged", async (t) => {
  const { repository } = await fixture(t);
  repository.replaceOrderProfitScope({
    scope: scopeFor(),
    facts: [fact()],
    coverage: [coverage()],
    refreshedAtMs: 1000,
    refreshBatchId: "batch-1",
  });
  const before = repository.debugSnapshotForTest();

  assert.throws(
    () => repository.replaceOrderProfitScope({
      scope: scopeFor(),
      facts: [fact(), fact({ actualCurrencyCode: "USD" })],
      coverage: [coverage()],
      refreshedAtMs: 2000,
      refreshBatchId: "batch-2",
    }),
    (error) => error instanceof SalesFactsConflictError
      && error.code === "SALES_FACTS_ACTUAL_CURRENCY_CONFLICT",
  );
  assert.deepEqual(repository.debugSnapshotForTest(), before);
});

test("range replacement deletes only the requested dates", async (t) => {
  const { repository } = await fixture(t);
  const twoDays = scopeFor("2026-08-01", "2026-08-02");
  repository.replaceOrderProfitScope({
    scope: twoDays,
    facts: [fact(), fact({ factDate: "2026-08-02", metrics: { totalSalesAmount: 50000n } })],
    coverage: [coverage(), coverage({ factDate: "2026-08-02" })],
    refreshedAtMs: 1000,
    refreshBatchId: "batch-1",
  });
  repository.replaceOrderProfitScope({
    scope: scopeFor("2026-08-01"),
    facts: [fact({ metrics: { totalSalesAmount: 25000n } })],
    coverage: [coverage()],
    refreshedAtMs: 2000,
    refreshBatchId: "batch-2",
  });

  const records = repository.readFacts(twoDays);
  assert.deepEqual(records.map(({ factDate, metrics }) => [factDate, metrics.totalSalesAmount]), [
    ["2026-08-01", 25000n],
    ["2026-08-02", 50000n],
  ]);
});

test("monthly replacement commits OrderProfit and custom fees in one revision", async (t) => {
  const { repository } = await fixture(t);
  const result = repository.replaceMonthlyReportScope({
    scope: scopeFor(),
    facts: [fact()],
    coverage: [coverage()],
    customFees: [{
      naturalMonth: "2026-08",
      sid: 8708,
      feeTypeId: "rent",
      currencyMode: "CNY",
      feeName: "办公费用-租金",
      feeAmount: -125000n,
      actualCurrencyCode: "CNY",
      recognized: true,
      sourceUpdatedAtMs: 900,
    }],
    customFeeCoverage: [{ naturalMonth: "2026-08", sid: 8708, currencyMode: "CNY", rowCount: 1 }],
    refreshedAtMs: 1000,
    refreshBatchId: "monthly-1",
  });
  assert.equal(result.salesFactsRevision, 1);
  assert.deepEqual(repository.readCustomFees(scopeFor()), [{
    naturalMonth: "2026-08",
    sid: 8708,
    feeTypeId: "rent",
    currencyMode: "CNY",
    feeName: "办公费用-租金",
    feeAmount: -125000n,
    actualCurrencyCode: "CNY",
    recognized: true,
    sourceUpdatedAtMs: 900,
    refreshedAtMs: 1000,
    refreshBatchId: "monthly-1",
  }]);
});

test("owner periods reject overlap and increment owner revision only on change", async (t) => {
  const { repository } = await fixture(t);
  const first = repository.applyOwnerSnapshot({
    periods: [{
      sid: 8708,
      msku: "MSKU-A",
      mskuKey: "msku-a",
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      ownerIdentity: "id:101",
      ownerPersonId: "101",
      ownerNameSnapshot: "Alice",
      identitySource: "lingxing-person-id",
      status: "assigned",
      updatedAtMs: 1000,
    }],
    requestId: "owner-1",
  });
  assert.equal(first.ownerRevision, 1);
  const same = repository.applyOwnerSnapshot({ periods: repository.readOwnerPeriods(scopeFor()) });
  assert.equal(same.ownerRevision, 1);
  assert.equal(same.changed, false);

  assert.throws(
    () => repository.applyOwnerSnapshot({
      periods: [
        ...repository.readOwnerPeriods(scopeFor()),
        {
          sid: 8708,
          msku: "MSKU-A",
          mskuKey: "msku-a",
          effectiveFrom: "2026-08-10",
          effectiveTo: null,
          ownerIdentity: "id:102",
          ownerPersonId: "102",
          ownerNameSnapshot: "Bob",
          identitySource: "lingxing-person-id",
          status: "assigned",
          updatedAtMs: 2000,
        },
      ],
    }),
    (error) => error.code === "SALES_FACTS_OWNER_PERIOD_OVERLAP",
  );
  assert.equal(repository.getRevisions().ownerRevision, 1);
});

test("derived cache round-trips safe payloads and health exposes redacted counts", async (t) => {
  const { repository } = await fixture(t);
  repository.writeDerivedCache({
    cacheKey: "weekly|scope",
    payload: { rows: [{ sid: 8708, amount: 0 }] },
    salesFactsRevision: 0,
    ownerRevision: 0,
    mapperVersion: "weekly-v1",
    generatedAtMs: 1000,
    expiresAtMs: 2000,
  });
  assert.deepEqual(repository.readDerivedCache("weekly|scope"), {
    cacheKey: "weekly|scope",
    payload: { rows: [{ sid: 8708, amount: 0 }] },
    salesFactsRevision: 0,
    ownerRevision: 0,
    mapperVersion: "weekly-v1",
    generatedAtMs: 1000,
    expiresAtMs: 2000,
  });
  const health = repository.getHealth();
  assert.equal(health.ok, true);
  assert.equal(health.quickCheck, "ok");
  assert.equal(health.derivedCacheCount, 1);
  assert.equal("databasePath" in health, false);
});

test("checksum mismatch fails fast and readonly repository rejects writes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-facts-checksum-test-"));
  const databasePath = path.join(directory, "sales-facts-v1.sqlite");
  const writable = createSalesFactsRepository({ databasePath });
  writable.close();
  const tamper = new Database(databasePath);
  tamper.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
  tamper.close();
  assert.throws(
    () => createSalesFactsRepository({ databasePath }),
    (error) => error instanceof SalesFactsDatabaseError
      && error.statusCode === 503
      && error.details?.operation === "bootstrap"
      && /checksum/.test(error.cause?.message || ""),
  );
  await rm(directory, { recursive: true, force: true });

  const readonlyDirectory = await mkdtemp(path.join(tmpdir(), "sales-facts-readonly-test-"));
  const readonlyPath = path.join(readonlyDirectory, "sales-facts-v1.sqlite");
  const seed = createSalesFactsRepository({ databasePath: readonlyPath });
  seed.close();
  const readonly = createSalesFactsRepository({
    databasePath: readonlyPath,
    readonly: true,
    logger: { info() {}, error() {} },
  });
  t.after(() => {
    readonly.close();
    return rm(readonlyDirectory, { recursive: true, force: true });
  });
  assert.throws(() => readonly.replaceOrderProfitScope({}), /只读/);
  assert.equal(readonly.getHealth().ok, true);
});

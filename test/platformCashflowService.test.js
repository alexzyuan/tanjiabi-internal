import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const serviceUrl = pathToFileURL(path.resolve("src/services/platformCashflowService.js"));

async function withTempService(fn) {
  const originalCwd = process.cwd();
  const originalProvider = process.env.DATA_PROVIDER;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-cashflow-service-"));
  process.chdir(dir);
  process.env.DATA_PROVIDER = "mock";
  try {
    const service = await import(`${serviceUrl.href}?case=${Date.now()}-${Math.random()}`);
    await fn(service, dir);
  } finally {
    if (originalProvider === undefined) {
      delete process.env.DATA_PROVIDER;
    } else {
      process.env.DATA_PROVIDER = originalProvider;
    }
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test("getPlatformCashflowDashboard returns mock cashflow KPIs and store rows", async () => {
  await withTempService(async ({ getPlatformCashflowDashboard }) => {
    const data = await getPlatformCashflowDashboard();

    assert.equal(data.meta.source, "模拟数据");
    assert.equal(data.meta.currencyMode, "CNY");
    assert.equal(data.meta.symbol, "¥");
    assert.equal(data.storeCount, 3);
    assert.equal(data.recordCount, 3);
    assert.equal(data.kpis.pendingAmount, 48900);
    assert.equal(data.kpis.delayedAmount, 6650);
    assert.equal(data.storeRows[0].storeName, "xiamentanjia-US");
    assert.ok(data.filters.countryOptions.some((item) => item.name === "美国"));
  });
});

test("getPlatformCashflowDashboard applies country, store, and status filters in mock mode", async () => {
  await withTempService(async ({ getPlatformCashflowDashboard }) => {
    const data = await getPlatformCashflowDashboard({
      country: "美国",
      storeName: "tandanbo-US",
      status: "Pending",
    });

    assert.equal(data.recordCount, 1);
    assert.equal(data.storeRows[0].storeName, "tandanbo-US");
    assert.equal(data.storeRows[0].status, "结算中");
    assert.equal(data.kpis.pendingAmount, 5400);
    assert.equal(data.kpis.expense, -2150);
  });
});

test("getPlatformCashflowDashboard tolerates empty matches and invalid status filters", async () => {
  await withTempService(async ({ getPlatformCashflowDashboard }) => {
    const data = await getPlatformCashflowDashboard({
      country: "不存在国家",
      status: "not-a-status",
    });

    assert.equal(data.recordCount, 0);
    assert.equal(data.storeCount, 0);
    assert.deepEqual(data.storeRows, []);
    assert.deepEqual(data.kpis, {
      pendingAmount: 0,
      delayedAmount: 0,
      standardAmount: 0,
      income: 0,
      refund: 0,
      expense: 0,
    });
  });
});

test("runPlatformCashflowCapture skips persistence in mock mode and is repeatable", async () => {
  await withTempService(async ({ runPlatformCashflowCapture }) => {
    const [first, second] = await Promise.all([
      runPlatformCashflowCapture({ storeName: "xiamentanjia-US" }),
      runPlatformCashflowCapture({ storeName: "xiamentanjia-US" }),
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.message, "模拟环境已跳过真实留存");
    assert.equal(second.snapshot.recordCount, 1);
    assert.equal(second.snapshot.storeRows[0].storeName, "xiamentanjia-US");
  });
});

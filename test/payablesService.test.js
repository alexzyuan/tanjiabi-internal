import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const serviceUrl = pathToFileURL(path.resolve("src/services/payablesService.js"));

async function withTempService(fn) {
  const originalCwd = process.cwd();
  const originalProvider = process.env.DATA_PROVIDER;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-payables-service-"));
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

test("getPayablesDashboard returns the documented empty payload in mock mode", async () => {
  await withTempService(async ({ getPayablesDashboard }) => {
    const data = await getPayablesDashboard({
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      supplier: "测试供应商",
      carrier: "测试承运商",
    });

    assert.equal(data.meta.source, "领星 ERP");
    assert.equal(data.meta.syncStatus, "当前不是 lingxing 数据源，应付账款未显示模拟数据。");
    assert.deepEqual(data.summary.total, { payable: 0, paid: 0, unpaid: 0, unapplied: 0, applying: 0 });
    assert.deepEqual(data.supplierRows, []);
    assert.deepEqual(data.carrierRows, []);
    assert.deepEqual(data.otherRows, []);
    assert.ok(data.metricDocs.some(([name]) => name === "应付金额"));
    assert.deepEqual(data.filters, { supplierOptions: [], carrierOptions: [] });
  });
});

test("payable request params use the documented closed-range field names", async () => {
  await withTempService(async ({ buildRequestParams }) => {
    const common = { startDate: "2026-07-01", endDate: "2026-07-31", keyword: "PO-001" };
    const purchase = buildRequestParams(common, 0, 200, "purchase");
    const logistics = buildRequestParams(common, 0, 200, "logistics");
    const customFee = buildRequestParams(common, 0, 200, "customFee");

    assert.equal(purchase.start_time, "2026-07-01");
    assert.equal(purchase.end_time, "2026-07-31");
    assert.equal(purchase.time_field, "create_time");
    assert.equal(logistics.start_time, "2026-07-01");
    assert.equal(logistics.end_time, "2026-07-31");
    assert.equal(logistics.search_field_time, "create_time");
    assert.equal(customFee.start_time, "2026-07-01");
    assert.equal(customFee.end_time, "2026-07-31");
    assert.equal(customFee.search_field_time, "create_time");

    for (const params of [purchase, logistics, customFee]) {
      assert.equal(params.created_start_time, undefined);
      assert.equal(params.created_end_time, undefined);
      assert.equal(params.start_date, undefined);
      assert.equal(params.end_date, undefined);
      assert.equal(params.keyword, "PO-001");
    }
  });
});

test("getPayablesDashboard normalizes reversed and slash-separated date filters", async () => {
  await withTempService(async ({ getPayablesDashboard }) => {
    const data = await getPayablesDashboard({
      startDate: "2026/7/09 12:30:00",
      endDate: "2026/7/01",
      keyword: " PO-001 ",
    });

    assert.equal(data.meta.requestRange.startDate, "2026-07-01");
    assert.equal(data.meta.requestRange.endDate, "2026-07-09");
    assert.equal(data.meta.requestRange.keyword, "PO-001");
  });
});

test("getPayablesDashboard handles repeated calls without sharing mutable row state", async () => {
  await withTempService(async ({ getPayablesDashboard }) => {
    const [first, second] = await Promise.all([
      getPayablesDashboard({ supplier: "A" }),
      getPayablesDashboard({ carrier: "B" }),
    ]);

    assert.notEqual(first, second);
    assert.deepEqual(first.summary.total, second.summary.total);
    first.supplierRows.push({ name: "mutated" });
    assert.deepEqual(second.supplierRows, []);
  });
});

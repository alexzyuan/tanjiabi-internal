import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteFreightRate,
  exportFreightRateLogsCsv,
  freightRateOptions,
  isoWeekFromDate,
  listFreightRates,
  saveFreightRate,
} from "../src/services/freightRateService.js";

async function withTempStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "freight-rates-"));
  const storeFile = path.join(dir, "freight-rates.json");
  try {
    return await fn(storeFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isoWeekFromDate derives ISO week from date", () => {
  assert.equal(isoWeekFromDate("2026-07-13"), "2026-W29");
  assert.equal(isoWeekFromDate("2026-01-01"), "2026-W01");
  assert.equal(isoWeekFromDate("2024-12-31"), "2025-W01");
});

test("saveFreightRate derives week from date and ignores supplied week", async () => {
  await withTempStore(async (storeFile) => {
    const row = await saveFreightRate({
      week: "2099-W99",
      date: "2026-07-13",
      country: "加拿大",
      warehouseCode: "YOW",
      carrier: "九方通逊",
      transportMethod: "快船",
      price: "12.35",
    }, { storeFile, now: () => new Date("2026-07-13T08:00:00.000Z") });

    assert.equal(row.week, "2026-W29");
    assert.equal(row.price, 12.35);
    assert.equal(row.carrier, "九方通逊");
    assert.equal(row.transportMethod, "快船");
    assert.ok(row.id);
    assert.equal(row.createdAt, "2026-07-13T08:00:00.000Z");
  });
});

test("saveFreightRate rejects duplicate weekly route keys", async () => {
  await withTempStore(async (storeFile) => {
    const base = {
      date: "2026-07-13",
      country: "加拿大",
      warehouseCode: "yow",
      carrier: "九方通逊",
      transportMethod: "普船",
      price: "10",
    };
    await saveFreightRate(base, { storeFile });

    await assert.rejects(
      () => saveFreightRate({ ...base, date: "2026-07-15", price: "11" }, { storeFile }),
      /同一周、国家、仓库、承运商和运输方式已存在运费记录/,
    );
  });
});

test("saveFreightRate validates required fields and allowed options", async () => {
  await withTempStore(async (storeFile) => {
    await assert.rejects(
      () => saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "YOW", carrier: "未知", transportMethod: "快船", price: 1 }, { storeFile }),
      /承运商必须是/,
    );
    await assert.rejects(
      () => saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "YOW", carrier: "九方通逊", transportMethod: "铁路", price: 1 }, { storeFile }),
      /运输方式必须是/,
    );
    await assert.rejects(
      () => saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "YOW", carrier: "九方通逊", transportMethod: "快船", price: -1 }, { storeFile }),
      /价格必须是非负数字/,
    );
    await assert.rejects(
      () => saveFreightRate({ date: "2026-07-13", country: "日本", warehouseCode: "YOW", carrier: "九方通逊", transportMethod: "快船", price: 1 }, { storeFile }),
      /国家必须是：美国、加拿大、澳洲、德国、英国/,
    );
    await assert.rejects(
      () => saveFreightRate({ date: "2026-07-13", country: "美国", warehouseCode: "YOW3", carrier: "九方通逊", transportMethod: "快船", price: 1 }, { storeFile }),
      /美国仓库代码必须是：MIT、GEU、POC、TCY、ONT、GYR/,
    );
  });
});

test("saveFreightRate restricts warehouse choices for US Canada and Australia only", async () => {
  await withTempStore(async (storeFile) => {
    assert.deepEqual(freightRateOptions.warehouseCodesByCountry, {
      美国: ["MIT", "GEU", "POC", "TCY", "ONT", "GYR"],
      加拿大: ["YYZ", "YUX", "YOW", "YYC", "YVR", "YEG"],
      澳洲: ["BWU", "XAU", "XBW"],
    });

    const canada = await saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "yow", carrier: "九方通逊", transportMethod: "快船", price: 1 }, { storeFile });
    assert.equal(canada.warehouseCode, "YOW");

    const germany = await saveFreightRate({ date: "2026-07-13", country: "德国", warehouseCode: "de-custom", carrier: "九方通逊", transportMethod: "快船", price: 1 }, { storeFile });
    assert.equal(germany.warehouseCode, "DE-CUSTOM");
  });
});

test("saveFreightRate records operator and create update logs", async () => {
  await withTempStore(async (storeFile) => {
    const created = await saveFreightRate({
      date: "2026-07-13",
      country: "加拿大",
      warehouseCode: "YOW",
      carrier: "九方通逊",
      transportMethod: "快船",
      price: 1,
    }, { storeFile, now: () => new Date("2026-07-13T08:00:00.000Z"), operator: "Alice" });
    const updated = await saveFreightRate({
      id: created.id,
      price: 2,
    }, { storeFile, now: () => new Date("2026-07-14T08:00:00.000Z"), operator: "Bob" });

    assert.equal(created.operator, "Alice");
    assert.equal(created.createdBy, "Alice");
    assert.equal(updated.operator, "Bob");
    assert.equal(updated.updatedBy, "Bob");

    const result = await listFreightRates({}, { storeFile, now: () => new Date("2026-07-14T09:00:00.000Z") });
    assert.deepEqual(result.logs.map((item) => `${item.action}:${item.operator}:${item.rowId}`), [
      `update:Bob:${created.id}`,
      `create:Alice:${created.id}`,
    ]);
    assert.equal(result.logs[0].before.price, 1);
    assert.equal(result.logs[0].after.price, 2);
  });
});

test("deleteFreightRate records operator and listFreightRates returns only recent half-year logs", async () => {
  await withTempStore(async (storeFile) => {
    await saveFreightRate({
      date: "2025-12-01",
      country: "德国",
      warehouseCode: "OLD",
      carrier: "九方通逊",
      transportMethod: "普船",
      price: 1,
    }, { storeFile, now: () => new Date("2025-12-01T08:00:00.000Z"), operator: "Old User" });
    const recent = await saveFreightRate({
      date: "2026-07-13",
      country: "美国",
      warehouseCode: "MIT",
      carrier: "同袍",
      transportMethod: "空运",
      price: 3,
    }, { storeFile, now: () => new Date("2026-07-13T08:00:00.000Z"), operator: "Alice" });

    await deleteFreightRate(recent.id, {
      storeFile,
      now: () => new Date("2026-07-13T09:00:00.000Z"),
      operator: "Bob",
    });

    const result = await listFreightRates({}, { storeFile, now: () => new Date("2026-07-13T10:00:00.000Z") });
    assert.deepEqual(result.logs.map((item) => `${item.action}:${item.operator}`), [
      "delete:Bob",
      "create:Alice",
    ]);
    assert.equal(result.logs[0].before.id, recent.id);
    assert.equal(result.logs.some((item) => item.operator === "Old User"), false);
  });
});

test("exportFreightRateLogsCsv exports recent half-year operation logs for backend audit", async () => {
  await withTempStore(async (storeFile) => {
    await saveFreightRate({
      date: "2025-12-01",
      country: "德国",
      warehouseCode: "OLD",
      carrier: "九方通逊",
      transportMethod: "普船",
      price: 1,
    }, { storeFile, now: () => new Date("2025-12-01T08:00:00.000Z"), operator: "Old User" });
    const created = await saveFreightRate({
      date: "2026-07-13",
      country: "加拿大",
      warehouseCode: "YUX",
      carrier: "同袍",
      transportMethod: "快递",
      price: 3.5,
    }, { storeFile, now: () => new Date("2026-07-13T08:00:00.000Z"), operator: "Alice" });
    await saveFreightRate({
      id: created.id,
      price: 4.25,
    }, { storeFile, now: () => new Date("2026-07-13T09:00:00.000Z"), operator: "Bob" });

    const result = await exportFreightRateLogsCsv({ storeFile, now: () => new Date("2026-07-13T10:00:00.000Z") });
    const csv = result.buffer.toString("utf8");

    assert.equal(result.contentType, "text/csv; charset=utf-8");
    assert.equal(result.filename, "运费看板操作日志-2026-07-13.csv");
    assert.match(csv, /^﻿操作时间,操作,操作人,周数,日期,国家,仓库代码,承运商,运输方式,价格,变更前价格,变更后价格,记录ID/m);
    assert.match(csv, /2026-07-13T09:00:00.000Z,修改,Bob,2026-W29,2026-07-13,加拿大,YUX,同袍,快递,4.25,3.5,4.25,/);
    assert.match(csv, /2026-07-13T08:00:00.000Z,新增,Alice,2026-W29,2026-07-13,加拿大,YUX,同袍,快递,3.5,,3.5,/);
    assert.equal(csv.includes("Old User"), false);
  });
});

test("listFreightRates returns rows sorted by week and date descending", async () => {
  await withTempStore(async (storeFile) => {
    await saveFreightRate({ date: "2026-07-06", country: "美国", warehouseCode: "MIT", carrier: "同袍", transportMethod: "空运", price: 20 }, { storeFile });
    await saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "YOW", carrier: "九方通逊", transportMethod: "普船", price: 10 }, { storeFile });
    await saveFreightRate({ date: "2026-07-14", country: "加拿大", warehouseCode: "YVR", carrier: "同袍", transportMethod: "快递", price: 30 }, { storeFile });

    const result = await listFreightRates({}, { storeFile });

    assert.deepEqual(result.rows.map((row) => `${row.week}:${row.date}:${row.warehouseCode}`), [
      "2026-W29:2026-07-14:YVR",
      "2026-W29:2026-07-13:YOW",
      "2026-W28:2026-07-06:MIT",
    ]);
    assert.deepEqual(result.weekGroups, [
      { week: "2026-W29", count: 2 },
      { week: "2026-W28", count: 1 },
    ]);
    assert.deepEqual(result.options, freightRateOptions);
  });
});

test("deleteFreightRate removes an existing row and fails for unknown ids", async () => {
  await withTempStore(async (storeFile) => {
    const row = await saveFreightRate({ date: "2026-07-13", country: "加拿大", warehouseCode: "YOW", carrier: "九方通逊", transportMethod: "普船", price: 10 }, { storeFile });
    assert.deepEqual(await deleteFreightRate(row.id, { storeFile }), { id: row.id });
    assert.equal((await listFreightRates({}, { storeFile })).rows.length, 0);
    await assert.rejects(() => deleteFreightRate(row.id, { storeFile }), /运费记录不存在/);
  });
});

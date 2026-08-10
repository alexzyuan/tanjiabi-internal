import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  StoreOperatingMonthlyReportRowVisibilityInputError,
  createStoreOperatingMonthlyReportRowVisibilityService,
} from "../src/services/storeOperatingMonthlyReportRowVisibilityService.js";

const metrics = [
  { key: "ad-fee", name: "广告费", category: "platform-expense", categoryName: "平台支出" },
  { key: "purchase-cost", name: "采购成本", category: "product-cost-expense", categoryName: "商品成本支出" },
  { key: "software-fee", name: "软件费用", category: "custom-expense", categoryName: "自定义费用" },
];

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-monthly-row-visibility-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createService(filePath, options = {}) {
  return createStoreOperatingMonthlyReportRowVisibilityService({
    filePath,
    listMetrics: () => metrics,
    now: () => "2026-08-06T10:00:00.000Z",
    ...options,
  });
}

test("stores normalized hidden metric ids separately for each account", async () => {
  await withTempDir(async (dir) => {
    const service = createService(path.join(dir, "row-visibility.json"));

    await service.save(
      { username: "Finance-A", source: "managed" },
      { hiddenMetricIds: ["software-fee", "ad-fee", "ad-fee", "retired-metric", "  purchase-cost  "] },
    );
    await service.save(
      { username: "finance-b", source: "managed" },
      { hiddenMetricIds: ["purchase-cost"] },
    );

    assert.deepEqual(
      (await service.read({ username: "finance-a", source: "managed" })).hiddenMetricIds,
      ["ad-fee", "purchase-cost", "software-fee"],
    );
    assert.deepEqual(
      (await service.read({ username: "finance-b", source: "managed" })).hiddenMetricIds,
      ["purchase-cost"],
    );
  });
});

test("separates managed and DingTalk accounts with the same username", async () => {
  await withTempDir(async (dir) => {
    const service = createService(path.join(dir, "row-visibility.json"));

    await service.save(
      { username: "shared-user", source: "managed" },
      { hiddenMetricIds: ["ad-fee"] },
    );
    await service.save(
      { username: "shared-user", id: "shared-user", source: "dingtalk" },
      { hiddenMetricIds: ["software-fee"] },
    );

    assert.deepEqual(
      (await service.read({ username: "shared-user", source: "managed" })).hiddenMetricIds,
      ["ad-fee"],
    );
    assert.deepEqual(
      (await service.read({ username: "shared-user", id: "shared-user", source: "dingtalk" })).hiddenMetricIds,
      ["software-fee"],
    );
  });
});

test("rejects a malformed payload and an unidentified account instead of writing a shared preference", async () => {
  await withTempDir(async (dir) => {
    const service = createService(path.join(dir, "row-visibility.json"));

    await assert.rejects(
      () => service.save({ username: "finance-a", source: "managed" }, { hiddenMetricIds: "ad-fee" }),
      (error) => error instanceof StoreOperatingMonthlyReportRowVisibilityInputError && error.statusCode === 400,
    );
    await assert.rejects(
      () => service.read({ source: "managed" }),
      (error) => error instanceof StoreOperatingMonthlyReportRowVisibilityInputError && error.statusCode === 400,
    );
  });
});

test("keeps concurrent writes for different accounts and fails loudly on corrupt storage", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "row-visibility.json");
    const service = createService(filePath);

    await Promise.all([
      service.save({ username: "finance-a", source: "managed" }, { hiddenMetricIds: ["ad-fee"] }),
      service.save({ username: "finance-b", source: "managed" }, { hiddenMetricIds: ["software-fee"] }),
    ]);
    assert.deepEqual((await service.read({ username: "finance-a", source: "managed" })).hiddenMetricIds, ["ad-fee"]);
    assert.deepEqual((await service.read({ username: "finance-b", source: "managed" })).hiddenMetricIds, ["software-fee"]);

    await writeFile(filePath, "{broken", "utf8");
    await assert.rejects(() => service.read({ username: "finance-a", source: "managed" }), /JSON parse failed/);
  });
});

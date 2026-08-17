import assert from "node:assert/strict";
import test from "node:test";

import { createInventoryProvisionRefreshService } from "../src/services/inventoryProvisionRefreshService.js";

function createRefreshService(overrides = {}) {
  return createInventoryProvisionRefreshService({
    todayText: () => "2026-08-17",
    readHistoryCache: async () => ({
      updatedAt: "2026/8/16 10:00:00",
      data: { rows: [{ quantity: 27 }] },
    }),
    rebuildHistory: async () => ({
      rows: [{ quantity: 27 }],
      rawCount: 1,
      ledgerCount: 10,
      matchedRows: 1,
    }),
    backupHistoryCache: async () => ({ created: true }),
    saveHistoryCache: async () => {},
    logger: { info() {}, error() {} },
    ...overrides,
  });
}

test("selected-month refresh rebuilds before backup and cache write", async () => {
  const calls = [];
  const service = createRefreshService({
    rebuildHistory: async (month, options) => {
      calls.push(["rebuild", month, options]);
      return { rows: [{ quantity: 27 }], rawCount: 1, ledgerCount: 10, matchedRows: 1 };
    },
    backupHistoryCache: async (month, options) => {
      calls.push(["backup", month, options]);
      return { created: true };
    },
    saveHistoryCache: async (month, data) => { calls.push(["save", month, data]); },
  });

  const result = await service.refresh({ date: "2026-07" });

  assert.equal(result.month, "2026-07");
  assert.equal(result.backupCreated, true);
  assert.deepEqual(calls.map(([name]) => name), ["rebuild", "backup", "save"]);
  assert.deepEqual(calls[0].slice(1), ["2026-07", { forceRefresh: true, persist: false }]);
});

test("selected-month refresh does not back up or write when FIFO rebuild fails", async () => {
  let backupCalls = 0;
  let saveCalls = 0;
  const service = createRefreshService({
    rebuildHistory: async () => { throw new Error("库存分类账 FIFO 生成了非整数批次数量：2026-07 / 8708 / US / JM-9006Truck。"); },
    backupHistoryCache: async () => { backupCalls += 1; return { created: true }; },
    saveHistoryCache: async () => { saveCalls += 1; },
  });

  await assert.rejects(
    service.refresh({ date: "2026-07" }),
    /FIFO 生成了非整数批次数量/u,
  );
  assert.equal(backupCalls, 0);
  assert.equal(saveCalls, 0);
});

test("selected-month refresh rejects the current month", async () => {
  const service = createRefreshService();

  await assert.rejects(
    service.refresh({ date: "2026-08" }),
    /当前月仅支持实时库存读取，不能重建月末历史计提/u,
  );
});

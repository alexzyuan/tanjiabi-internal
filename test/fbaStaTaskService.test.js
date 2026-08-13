import assert from "node:assert/strict";
import test from "node:test";

import { fbaStaTaskTestUtils, normalizeFbaStaTaskShop } from "../src/services/fbaStaTaskService.js";

function runtimeDirectory() {
  return {
    sellers: [
      { sid: 11500, name: "tandanbo-US", displayName: "坦蛋伯美国", country: "美国" },
      { sid: 17307, name: "tanjia-eu-DE", displayName: "探嘉德国", country: "德国" },
    ],
  };
}

test("STA tasks keep the runtime seller identity and legal sender key", async () => {
  const shop = await normalizeFbaStaTaskShop(
    { sid: 17307, name: "tanjia-eu-DE" },
    { getDirectory: async () => runtimeDirectory() },
  );

  assert.deepEqual(shop, {
    sid: 17307,
    name: "tanjia-eu-DE",
    displayName: "探嘉德国",
    country: "德国",
    legalSenderKey: "xiamentanjia",
  });
});

test("STA tasks reject a name/SID mismatch before scheduling work", async () => {
  await assert.rejects(
    () => normalizeFbaStaTaskShop(
      { sid: 11500, name: "tanjia-eu-DE" },
      { getDirectory: async () => runtimeDirectory() },
    ),
    (error) => {
      assert.match(error.message, /SID 11500/);
      assert.match(error.message, /tanjia-eu-DE/);
      assert.match(error.message, /tandanbo-US/);
      assert.doesNotMatch(error.message, /token|secret|password/i);
      return true;
    },
  );
});

test("STA task validation rejects scheduled tasks whose end date is before Beijing today", () => {
  assert.throws(
    () => fbaStaTaskTestUtils.validateTaskScheduleDates({
      scheduleEnabled: true,
      activeEndDate: "2026-07-31",
    }, new Date("2026-08-13T09:50:00.000Z")),
    /结束日期不能早于当前日期 2026-08-13/,
  );
});

test("STA task validation allows scheduled tasks ending today in Beijing time", () => {
  assert.doesNotThrow(() => fbaStaTaskTestUtils.validateTaskScheduleDates({
    scheduleEnabled: true,
    activeEndDate: "2026-08-13",
  }, new Date("2026-08-13T09:50:00.000Z")));
});

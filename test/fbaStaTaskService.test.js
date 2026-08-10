import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFbaStaTaskShop } from "../src/services/fbaStaTaskService.js";

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

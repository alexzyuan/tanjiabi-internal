import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanonicalStaSeller } from "../src/services/fbaStaService.js";

function runtimeDirectory() {
  return {
    sellers: [
      { sid: 11500, name: "tandanbo-US", displayName: "坦蛋伯美国", country: "美国" },
      { sid: 17307, name: "tanjia-eu-DE", displayName: "探嘉德国", country: "德国" },
    ],
  };
}

test("STA resolves the legal sender from the canonical runtime seller name", async () => {
  const seller = await resolveCanonicalStaSeller(
    { sid: 17307, shopName: "tanjia-eu-DE" },
    { getDirectory: async () => runtimeDirectory() },
  );

  assert.deepEqual(
    { sid: seller.sid, name: seller.name, displayName: seller.displayName, country: seller.country },
    { sid: 17307, name: "tanjia-eu-DE", displayName: "探嘉德国", country: "德国" },
  );
  assert.equal(seller.legalSenderKey, "xiamentanjia");
});

test("STA rejects a real tandanbo SID paired with a fake tanjia name", async () => {
  await assert.rejects(
    () => resolveCanonicalStaSeller(
      { sid: 11500, shopName: "tanjia-eu-DE" },
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

test("STA does not resolve a static-map-only seller absent from the runtime directory", async () => {
  await assert.rejects(
    () => resolveCanonicalStaSeller(
      { sid: 8708, shopName: "xiamentanjia-US" },
      { getDirectory: async () => ({ sellers: [{ sid: 99901, name: "runtime-store-FR" }] }) },
    ),
    /SID 8708.*运行时领星店铺目录/,
  );
});

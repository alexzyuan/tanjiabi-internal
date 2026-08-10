import assert from "node:assert/strict";
import test from "node:test";

import { createFbaRoutes } from "../routes/fba.js";
import { getFbaAddressProfile, requireFbaAddressProfile } from "../src/data/fbaAddressBook.js";
import { getFbaShopOptions } from "../src/services/fbaCatalogService.js";

test("getFbaAddressProfile resolves legal senders by case-insensitive brand markers", () => {
  assert.equal(getFbaAddressProfile("unknown-store"), null);
  assert.equal(getFbaAddressProfile("tanjia-eu-DE")?.key, "xiamentanjia");
  assert.equal(getFbaAddressProfile("EU-TANJIA-UK")?.key, "xiamentanjia");
  assert.equal(getFbaAddressProfile("xiamentanjia-US")?.key, "xiamentanjia");
  assert.equal(getFbaAddressProfile("探嘉加拿大")?.key, "xiamentanjia");
  assert.equal(getFbaAddressProfile("tandanbo-US")?.key, "tandanbo");
  assert.equal(getFbaAddressProfile("坦蛋伯澳洲")?.key, "tandanbo");
});

test("requireFbaAddressProfile fails with the workflow and unknown brand", () => {
  assert.throws(
    () => requireFbaAddressProfile("unknown-store", { context: "FBA STA" }),
    /FBA STA.*unknown-store.*法定发件主体/,
  );
});

test("getFbaShopOptions uses only runtime sellers and redacts unmapped identities", async () => {
  const warnings = [];
  let directoryCalls = 0;
  const result = await getFbaShopOptions({
    getDirectory: async () => {
      directoryCalls += 1;
      return {
        sellers: [
          { sid: 8708, name: "xiamentanjia-US", country: "美国", displayName: "探嘉美国", raw: { internalNote: "must-not-return" } },
          { sid: 11500, name: "tandanbo-US", country: "美国", displayName: "坦蛋伯美国" },
          { sid: 17305, name: "tanjia-eu-UK", country: "英国", displayName: "探嘉英国" },
          { sid: 19999, name: "unknown-store", country: "未知", displayName: "未知店铺", raw: { token: "must-not-log" } },
        ],
        meta: {
          source: "test-runtime",
          cacheHit: false,
          updatedAt: "2026-08-10 12:00:00",
        },
      };
    },
    logger: { warn(...args) { warnings.push(args); } },
  });

  assert.equal(directoryCalls, 1);
  assert.deepEqual(result.shops.map(({ sid }) => sid), [8708, 11500, 17305]);
  assert.equal(result.shops.some((shop) => shop.sid === 11501), false);
  assert.equal(result.shops.some((shop) => shop.sid === 17307), false);
  assert.equal(result.shops[0].addressProfile.key, "xiamentanjia");
  assert.equal(Object.hasOwn(result.shops[0], "raw"), false);
  assert.equal(JSON.stringify(result.shops).includes("must-not-return"), false);
  assert.equal(result.shops[1].addressProfile.key, "tandanbo");
  assert.equal(result.shops[2].addressProfile.key, "xiamentanjia");
  assert.deepEqual(result.unmappedShops, [
    { sid: 19999, name: "unknown-store", country: "未知" },
  ]);
  assert.deepEqual({
    source: result.source,
    cacheHit: result.cacheHit,
    updatedAt: result.updatedAt,
  }, {
    source: "test-runtime",
    cacheHit: false,
    updatedAt: "2026-08-10 12:00:00",
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings.every(([prefix]) => prefix === "[fba-shop-directory]"), true);
  assert.equal(JSON.stringify(warnings).includes("must-not-log"), false);
});

test("/api/fba/shops awaits the directory result and sends it directly", async () => {
  const sent = [];
  const directoryResult = {
    shops: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }],
    unmappedShops: [],
    source: "test-runtime",
  };
  const routes = createFbaRoutes({
    getFbaShopOptions: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return directoryResult;
    },
    sendJson: (_res, status, payload) => sent.push({ status, payload }),
  });
  const route = routes.find((item) => item.path === "/api/fba/shops");

  await route.handler({ res: {} });

  assert.deepEqual(sent, [{ status: 200, payload: directoryResult }]);
});

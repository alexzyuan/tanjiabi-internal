import assert from "node:assert/strict";
import test from "node:test";
import { listBudgetShopCatalog } from "../src/data/budgetShopCatalog.js";

test("budget shop catalog exposes the approved German and Australian stores", () => {
  const catalog = listBudgetShopCatalog();

  assert.deepEqual(
    catalog.find((shop) => shop.storeName === "欧洲-探嘉德国店铺"),
    { country: "德国", storeName: "欧洲-探嘉德国店铺", sid: 17307, sourceName: "tanjia-eu-DE" },
  );
  assert.deepEqual(
    catalog.find((shop) => shop.storeName === "探嘉澳洲"),
    { country: "澳洲", storeName: "探嘉澳洲", sid: 11499, sourceName: "xiamentanjia-AU" },
  );
  assert.deepEqual(
    catalog.find((shop) => shop.storeName === "坦蛋伯澳洲"),
    { country: "澳洲", storeName: "坦蛋伯澳洲", sid: 11503, sourceName: "tandanbo-AU" },
  );
});

test("budget shop catalog only exposes approved budget countries", () => {
  const catalog = listBudgetShopCatalog();

  assert.deepEqual(
    [...new Set(catalog.map((shop) => shop.country))],
    ["澳洲", "德国", "加拿大", "美国"],
  );
  assert.equal(catalog.some((shop) => ["巴西", "墨西哥"].includes(shop.country)), false);
});

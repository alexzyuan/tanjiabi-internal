import assert from "node:assert/strict";
import test from "node:test";
import {
  filterBudgetRowsByCountryScope,
  listBudgetCountries,
  listBudgetListingOwners,
  mergeBudgetShopOptions,
} from "../assets/js/features/budget-targets.js";

test("budget filter options retain catalog stores before and after historical uploads", () => {
  const options = mergeBudgetShopOptions(
    [
      { country: "德国", storeName: "欧洲-探嘉德国店铺" },
      { country: "澳洲", storeName: "探嘉澳洲" },
      { country: "澳洲", storeName: "坦蛋伯澳洲" },
    ],
    [{ site: "美国站", storeName: "历史美国店铺" }],
  );

  assert.deepEqual(
    options.filter((shop) => shop.country === "澳洲").map((shop) => shop.storeName),
    ["坦蛋伯澳洲", "探嘉澳洲"],
  );
  assert.deepEqual(
    options.filter((shop) => shop.country === "德国").map((shop) => shop.storeName),
    ["欧洲-探嘉德国店铺"],
  );
  assert.deepEqual(
    options.find((shop) => shop.storeName === "历史美国店铺"),
    { country: "美国", storeName: "历史美国店铺" },
  );
});

test("budget defaults use approved countries and listing owners", () => {
  assert.deepEqual(listBudgetCountries(), ["德国", "美国", "加拿大", "澳洲"]);
  assert.deepEqual(listBudgetListingOwners(), ["林芃", "熊丹轩"]);
  assert.deepEqual(
    filterBudgetRowsByCountryScope([
      { country: "美国", storeName: "探嘉美国" },
      { country: "巴西", storeName: "坦蛋伯巴西" },
      { site: "墨西哥站", storeName: "坦蛋伯墨西哥" },
    ]),
    [{ country: "美国", storeName: "探嘉美国" }],
  );
});

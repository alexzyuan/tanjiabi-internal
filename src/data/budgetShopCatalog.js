import { lingxingShopMap } from "./lingxingShopMap.js";

const budgetOnlyShops = [
  { name: "tanjia-eu-DE", country: "德国", sid: 17307, displayName: "欧洲-探嘉德国店铺" },
];

export function listBudgetShopCatalog() {
  return [...lingxingShopMap, ...budgetOnlyShops]
    .map((shop) => ({
      country: shop.country,
      storeName: shop.displayName,
      sid: shop.sid,
      sourceName: shop.name,
    }))
    .sort((left, right) => left.country.localeCompare(right.country, "zh-CN")
      || left.storeName.localeCompare(right.storeName, "zh-CN"));
}

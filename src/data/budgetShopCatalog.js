import { lingxingShopMap } from "./lingxingShopMap.js";

const budgetOnlyShops = [
  { name: "tanjia-eu-DE", country: "德国", sid: 17307, displayName: "欧洲-探嘉德国店铺" },
];
const budgetCountries = new Set(["德国", "美国", "加拿大", "澳洲"]);

export function listBudgetShopCatalog() {
  return [...lingxingShopMap, ...budgetOnlyShops]
    .filter((shop) => budgetCountries.has(shop.country))
    .map((shop) => ({
      country: shop.country,
      storeName: shop.displayName,
      sid: shop.sid,
      sourceName: shop.name,
    }))
    .sort((left, right) => left.country.localeCompare(right.country, "zh-CN")
      || left.storeName.localeCompare(right.storeName, "zh-CN"));
}

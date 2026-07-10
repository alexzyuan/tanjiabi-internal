export const lingxingShopMap = [
  { name: "tandanbo-AU", country: "澳洲", sid: 11503, displayName: "坦蛋伯澳洲" },
  { name: "xiamentanjia-US", country: "美国", sid: 8708, displayName: "探嘉美国" },
  { name: "xiamentanjia-CA", country: "加拿大", sid: 8709, displayName: "探嘉加拿大" },
  { name: "xiamentanjia-MX", country: "墨西哥", sid: 8710, displayName: "探嘉墨西哥" },
  { name: "tandanbo-US", country: "美国", sid: 11500, displayName: "坦蛋伯美国" },
  { name: "tandanbo-CA", country: "加拿大", sid: 11501, displayName: "坦蛋伯加拿大" },
  { name: "tandanbo-MX", country: "墨西哥", sid: 11502, displayName: "坦蛋伯墨西哥" },
  { name: "tandanbo-BR", country: "巴西", sid: 14527, displayName: "坦蛋伯巴西" },
  { name: "xiamentanjia-AU", country: "澳洲", sid: 11499, displayName: "探嘉澳洲" },
];

export function findLingxingShop(identifier) {
  const value = String(identifier || "").trim();
  return lingxingShopMap.find((shop) => shop.name === value || shop.displayName === value || String(shop.sid) === value);
}

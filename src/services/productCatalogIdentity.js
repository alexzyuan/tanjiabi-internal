export class ProductCatalogInputError extends Error {
  constructor(message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "ProductCatalogInputError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ProductCatalogConflictError extends ProductCatalogInputError {
  constructor(message, details = null) {
    super(message, { statusCode: 409, details });
    this.name = "ProductCatalogConflictError";
  }
}

export function normalizeCatalogKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeProductCatalogScope(items, { maxItems = 500 } = {}) {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sid = Number(item?.sid || 0);
    const msku = String(item?.msku || "").trim();
    const mskuKey = normalizeCatalogKey(msku);
    if (!Number.isInteger(sid) || sid <= 0) throw new ProductCatalogInputError("商品目录范围包含无效 SID。");
    if (!mskuKey) throw new ProductCatalogInputError(`SID ${sid} 缺少有效 MSKU。`);
    const key = `${sid}:${mskuKey}`;
    if (!byKey.has(key)) byKey.set(key, { sid, msku, mskuKey, key });
  }
  const scope = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
  if (!scope.length) throw new ProductCatalogInputError("请选择至少一个商品后再刷新商品资料。");
  if (scope.length > maxItems) throw new ProductCatalogInputError(`单次最多刷新 ${maxItems} 个商品。`);
  return scope;
}

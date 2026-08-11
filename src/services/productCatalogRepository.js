import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  applyProductCatalogSchema,
  PRODUCT_CATALOG_SCHEMA_VERSION,
} from "./productCatalogSchema.js";
import {
  normalizeCatalogKey,
  ProductCatalogConflictError,
  ProductCatalogInputError,
} from "./productCatalogIdentity.js";

const ALIAS_TYPES = new Set(["sku_identifier", "product_id", "listing_sku"]);
const EXTERNAL_METADATA_KEYS = new Set(["legacy_manifest_hash", "legacy_migrated_at_ms"]);

function writeLog(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[product-catalog-repository]", details);
}

function bootstrapErrorDetails(error) {
  return {
    operation: "bootstrap",
    errorName: error?.name || "Error",
    errorMessage: String(error?.message || "未知错误").slice(0, 300),
  };
}

function operationErrorDetails(operation, error) {
  return {
    operation,
    code: error?.code || null,
    message: error instanceof ProductCatalogConflictError
      ? "商品目录冲突。"
      : error instanceof ProductCatalogInputError
        ? "商品目录输入无效。"
        : String(error?.message || "未知错误").slice(0, 300),
  };
}

function withOperation(logger, operation, callback) {
  try {
    return callback();
  } catch (error) {
    writeLog(logger, "error", operationErrorDetails(operation, error));
    throw error;
  }
}

function readPragmas(db) {
  return {
    journalMode: String(db.pragma("journal_mode", { simple: true })).toLowerCase(),
    foreignKeys: Number(db.pragma("foreign_keys", { simple: true })),
    busyTimeout: Number(db.pragma("busy_timeout", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
  };
}

function configurePragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  const actual = readPragmas(db);
  const expected = [
    ["journal_mode", "journalMode", "wal"],
    ["foreign_keys", "foreignKeys", 1],
    ["busy_timeout", "busyTimeout", 5000],
    ["synchronous", "synchronous", 2],
  ];
  for (const [pragmaName, name, value] of expected) {
    if (actual[name] !== value) {
      throw new Error(`商品目录数据库 pragma ${pragmaName} 必须为 ${value}，实际为 ${actual[name]}。`);
    }
  }
  return actual;
}

function resolveNow(now) {
  const value = typeof now === "function" ? now() : now;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ProductCatalogInputError("商品目录时间无效。");
  return number;
}

function asArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ProductCatalogInputError(`${name} 必须为数组。`);
  return value;
}

function requiredText(value, message) {
  const text = String(value ?? "").trim();
  if (!text) throw new ProductCatalogInputError(message);
  return text;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function nullableNumber(value, message = "商品目录数值无效。") {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ProductCatalogInputError(message);
  return number;
}

function requiredTimestamp(value, message) {
  const number = nullableNumber(value, message);
  if (number === null) throw new ProductCatalogInputError(message);
  return number;
}

function normalizeInternalSkuKey(value, message = "商品目录缺少有效内部 SKU。") {
  const key = normalizeCatalogKey(value);
  if (!key) throw new ProductCatalogInputError(message);
  return key;
}

function assertCanonicalIdentityKey(explicitKey, rawValue, message) {
  const rawKey = normalizeCatalogKey(rawValue);
  if (!rawKey) throw new ProductCatalogInputError(message);
  const key = normalizeInternalSkuKey(explicitKey, message);
  if (key !== rawKey) throw new ProductCatalogInputError(message);
  return key;
}

function normalizeAlias(alias) {
  const aliasType = requiredText(alias?.aliasType, "商品别名类型不能为空。");
  if (!ALIAS_TYPES.has(aliasType)) throw new ProductCatalogInputError("商品别名类型无效。");
  const aliasKey = normalizeCatalogKey(alias?.aliasKey);
  if (!aliasKey) throw new ProductCatalogInputError("商品别名键不能为空。");
  const aliasValue = requiredText(alias?.aliasValue ?? alias?.aliasKey, "商品别名值不能为空。");
  if (aliasType === "listing_sku" && alias?.sourceField !== "local_sku") {
    throw new ProductCatalogInputError("listing_sku 别名必须来自 Listing local_sku。");
  }
  const internalSkuKey = normalizeInternalSkuKey(alias?.internalSkuKey);
  return {
    aliasType,
    aliasKey,
    aliasValue,
    internalSkuKey,
    source: requiredText(alias?.source, "商品别名来源不能为空。"),
    updatedAtMs: requiredTimestamp(alias?.updatedAtMs, "商品别名更新时间无效。"),
  };
}

function normalizeBoxSpec(boxSpec) {
  if (boxSpec === null || boxSpec === undefined) return null;
  if (typeof boxSpec !== "object" || Array.isArray(boxSpec)) {
    throw new ProductCatalogInputError("商品目录箱规无效。");
  }
  const dimensions = boxSpec.dimensions || {};
  const weight = boxSpec.weight || {};
  return {
    dimensions: {
      length: nullableNumber(dimensions.length, "商品箱规长度无效。"),
      width: nullableNumber(dimensions.width, "商品箱规宽度无效。"),
      height: nullableNumber(dimensions.height, "商品箱规高度无效。"),
      unitOfMeasurement: nullableText(dimensions.unitOfMeasurement),
    },
    weight: {
      value: nullableNumber(weight.value, "商品箱规重量无效。"),
      unit: nullableText(weight.unit),
    },
  };
}

function normalizeProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new ProductCatalogInputError("商品主数据无效。");
  }
  const internalSku = requiredText(product.internalSku, "商品主数据缺少内部 SKU。");
  const internalSkuKey = assertCanonicalIdentityKey(
    product.internalSkuKey,
    internalSku,
    "商品主数据内部 SKU key 与内部 SKU 不一致。",
  );
  const boxSpec = normalizeBoxSpec(product.boxSpec);
  return {
    internalSkuKey,
    internalSku,
    productName: nullableText(product.productName),
    imageUrl: nullableText(product.imageUrl),
    supplier: nullableText(product.supplier),
    purchasePrice: nullableNumber(product.purchasePrice, "采购价无效。"),
    model: nullableText(product.model),
    brand: nullableText(product.brand),
    material: nullableText(product.material),
    purpose: nullableText(product.purpose),
    customsCode: nullableText(product.customsCode),
    isBattery: nullableText(product.isBattery),
    unit: nullableText(product.unit),
    declaredValue: nullableNumber(product.declaredValue, "申报价值无效。"),
    packQuantity: nullableNumber(product.packQuantity, "装箱数量无效。"),
    boxLength: boxSpec?.dimensions.length ?? null,
    boxWidth: boxSpec?.dimensions.width ?? null,
    boxHeight: boxSpec?.dimensions.height ?? null,
    boxDimensionUnit: boxSpec?.dimensions.unitOfMeasurement ?? null,
    boxWeight: boxSpec?.weight.value ?? null,
    boxWeightUnit: boxSpec?.weight.unit ?? null,
    productId: nullableText(product.productId),
    skuIdentifier: nullableText(product.skuIdentifier),
    source: requiredText(product.source, "商品主数据来源不能为空。"),
    sourceUpdatedAtMs: requiredTimestamp(product.sourceUpdatedAtMs, "商品来源更新时间无效。"),
    refreshedAtMs: requiredTimestamp(product.refreshedAtMs, "商品本地更新时间无效。"),
  };
}

function normalizeListing(listing) {
  if (!listing || typeof listing !== "object" || Array.isArray(listing)) {
    throw new ProductCatalogInputError("Listing 身份无效。");
  }
  const sid = Number(listing.sid);
  if (!Number.isInteger(sid) || sid <= 0) throw new ProductCatalogInputError("Listing SID 无效。");
  const msku = requiredText(listing.msku, `SID ${sid} 缺少有效 MSKU。`);
  const explicitMskuKey = listing.mskuKey === null || listing.mskuKey === undefined || listing.mskuKey === ""
    ? null
    : listing.mskuKey;
  const mskuKey = explicitMskuKey === null
    ? normalizeCatalogKey(msku)
    : assertCanonicalIdentityKey(explicitMskuKey, msku, `SID ${sid} 的 MSKU key 与 MSKU 不一致。`);
  const internalSku = nullableText(listing.internalSku);
  const hasInternalSku = internalSku !== null && internalSku.trim() !== "";
  const hasInternalSkuKey = listing.internalSkuKey !== null
    && listing.internalSkuKey !== undefined
    && listing.internalSkuKey !== "";
  if (hasInternalSkuKey && hasInternalSku) {
    assertCanonicalIdentityKey(
      listing.internalSkuKey,
      internalSku,
      "Listing 内部 SKU key 与内部 SKU 不一致。",
    );
  }
  return {
    sid,
    mskuKey,
    msku,
    internalSkuKey: !hasInternalSkuKey
      ? null
      : normalizeInternalSkuKey(listing.internalSkuKey),
    internalSku,
    listingSku: nullableText(listing.listingSku),
    asin: nullableText(listing.asin),
    storeName: nullableText(listing.storeName),
    country: nullableText(listing.country),
    source: requiredText(listing.source, "Listing 来源不能为空。"),
    sourceUpdatedAtMs: requiredTimestamp(listing.sourceUpdatedAtMs, "Listing 来源更新时间无效。"),
    refreshedAtMs: requiredTimestamp(listing.refreshedAtMs, "Listing 本地更新时间无效。"),
  };
}

function productHashInput(product) {
  const boxSpec = product.boxLength === null && product.boxWidth === null && product.boxHeight === null
    && product.boxDimensionUnit === null && product.boxWeight === null && product.boxWeightUnit === null
    ? null
    : {
      dimensions: {
        length: product.boxLength,
        width: product.boxWidth,
        height: product.boxHeight,
        unitOfMeasurement: product.boxDimensionUnit,
      },
      weight: { value: product.boxWeight, unit: product.boxWeightUnit },
    };
  return {
    internalSkuKey: product.internalSkuKey,
    internalSku: product.internalSku,
    productName: product.productName,
    imageUrl: product.imageUrl,
    supplier: product.supplier,
    purchasePrice: product.purchasePrice,
    model: product.model,
    brand: product.brand,
    material: product.material,
    purpose: product.purpose,
    customsCode: product.customsCode,
    isBattery: product.isBattery,
    unit: product.unit,
    declaredValue: product.declaredValue,
    packQuantity: product.packQuantity,
    boxSpec,
    productId: product.productId,
    skuIdentifier: product.skuIdentifier,
  };
}

function computeProductHash(product) {
  return createHash("sha256").update(JSON.stringify(productHashInput(product))).digest("hex");
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ProductCatalogInputError("metadata 必须为对象。");
  }
  return Object.entries(metadata).map(([key, value]) => {
    if (!EXTERNAL_METADATA_KEYS.has(key)) {
      throw new ProductCatalogInputError("商品目录元数据键不在允许范围内。");
    }
    if (value !== null && typeof value !== "string"
      && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new ProductCatalogInputError("商品目录元数据值必须为字符串、有限数字或 null。");
    }
    return [key, String(value)];
  });
}

function mapBoxSpecRow(row) {
  const boxValues = [
    row.box_length,
    row.box_width,
    row.box_height,
    row.box_dimension_unit,
    row.box_weight,
    row.box_weight_unit,
  ];
  if (boxValues.every((value) => value === null)) return null;
  return {
    dimensions: {
      length: row.box_length,
      width: row.box_width,
      height: row.box_height,
      unitOfMeasurement: row.box_dimension_unit,
    },
    weight: { value: row.box_weight, unit: row.box_weight_unit },
  };
}

function mapProductRow(row) {
  if (!row) return null;
  return {
    internalSkuKey: row.internal_sku_key,
    internalSku: row.internal_sku,
    productName: row.product_name || "",
    imageUrl: row.image_url,
    supplier: row.supplier,
    purchasePrice: row.purchase_price,
    model: row.model,
    brand: row.brand,
    material: row.material,
    purpose: row.purpose,
    customsCode: row.customs_code,
    isBattery: row.is_battery,
    unit: row.unit,
    declaredValue: row.declared_value,
    packQuantity: row.pack_quantity,
    boxSpec: mapBoxSpecRow(row),
    productId: row.product_id,
    skuIdentifier: row.sku_identifier,
    source: row.source,
    sourceUpdatedAtMs: row.source_updated_at_ms,
    refreshedAtMs: row.refreshed_at_ms,
  };
}

function mapListingRow(row) {
  if (!row) return null;
  return {
    sid: row.sid,
    mskuKey: row.msku_key,
    msku: row.msku,
    internalSkuKey: row.internal_sku_key,
    internalSku: row.internal_sku,
    listingSku: row.listing_sku,
    asin: row.asin,
    storeName: row.store_name,
    country: row.country,
    source: row.source,
    sourceUpdatedAtMs: row.source_updated_at_ms,
    refreshedAtMs: row.refreshed_at_ms,
  };
}

function normalizeScopeItem(item) {
  const sid = Number(item?.sid);
  if (!Number.isInteger(sid) || sid <= 0) throw new ProductCatalogInputError("商品目录范围包含无效 SID。");
  const mskuKey = normalizeCatalogKey(item?.mskuKey || item?.msku);
  if (!mskuKey) throw new ProductCatalogInputError(`SID ${sid} 缺少有效 MSKU。`);
  return { sid, mskuKey };
}

function assertAliasesDoNotConflict(db, aliases) {
  const existingAlias = db.prepare(
    "SELECT internal_sku_key FROM product_alias WHERE alias_type = ? AND alias_key = ?",
  );
  const byAlias = new Map();
  const conflicts = [];
  for (const alias of aliases) {
    const key = `${alias.aliasType}:${alias.aliasKey}`;
    const previous = byAlias.get(key);
    if (previous && previous !== alias.internalSkuKey) conflicts.push(alias.aliasType);
    byAlias.set(key, alias.internalSkuKey);
    const existing = existingAlias.get(alias.aliasType, alias.aliasKey);
    if (existing && existing.internal_sku_key !== alias.internalSkuKey) conflicts.push(alias.aliasType);
  }
  if (conflicts.length) {
    const uniqueTypes = [...new Set(conflicts)].sort();
    throw new ProductCatalogConflictError("商品目录别名冲突，批次未写入。", {
      conflictCount: conflicts.length,
      aliasTypes: uniqueTypes,
    });
  }
}

function fileSize(filePath) {
  try {
    return statSync(filePath).size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

export function createProductCatalogRepository({
  databasePath = path.join(process.cwd(), "data-cache", "product-catalog", "product-catalog-v1.sqlite"),
  logger = console,
  now = Date.now,
} = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  let db;
  try {
    db = new Database(databasePath);
    configurePragmas(db);
    applyProductCatalogSchema(db, { now });
  } catch (error) {
    try {
      writeLog(logger, "error", bootstrapErrorDetails(error));
    } finally {
      if (db) db.close();
    }
    throw error;
  }

  const readMetadataValue = db.prepare(
    "SELECT value FROM catalog_metadata WHERE key = ?",
  );
  const writeMetadata = db.prepare(
    `INSERT INTO catalog_metadata (key, value, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
  );
  const readListing = db.prepare(
    "SELECT * FROM listing_identity WHERE sid = ? AND msku_key = ?",
  );
  const readProduct = db.prepare(
    "SELECT * FROM product_master WHERE internal_sku_key = ?",
  );
  const upsertProduct = db.prepare(
    `INSERT INTO product_master (
      internal_sku_key, internal_sku, product_name, image_url, supplier, purchase_price,
      model, brand, material, purpose, customs_code, is_battery, unit, declared_value,
      pack_quantity, box_length, box_width, box_height, box_dimension_unit, box_weight,
      box_weight_unit, product_id, sku_identifier, source, source_updated_at_ms,
      refreshed_at_ms, data_hash
    ) VALUES (
      @internalSkuKey, @internalSku, @productName, @imageUrl, @supplier, @purchasePrice,
      @model, @brand, @material, @purpose, @customsCode, @isBattery, @unit, @declaredValue,
      @packQuantity, @boxLength, @boxWidth, @boxHeight, @boxDimensionUnit, @boxWeight,
      @boxWeightUnit, @productId, @skuIdentifier, @source, @sourceUpdatedAtMs,
      @refreshedAtMs, @dataHash
    ) ON CONFLICT(internal_sku_key) DO UPDATE SET
      internal_sku = excluded.internal_sku,
      product_name = excluded.product_name,
      image_url = excluded.image_url,
      supplier = excluded.supplier,
      purchase_price = excluded.purchase_price,
      model = excluded.model,
      brand = excluded.brand,
      material = excluded.material,
      purpose = excluded.purpose,
      customs_code = excluded.customs_code,
      is_battery = excluded.is_battery,
      unit = excluded.unit,
      declared_value = excluded.declared_value,
      pack_quantity = excluded.pack_quantity,
      box_length = excluded.box_length,
      box_width = excluded.box_width,
      box_height = excluded.box_height,
      box_dimension_unit = excluded.box_dimension_unit,
      box_weight = excluded.box_weight,
      box_weight_unit = excluded.box_weight_unit,
      product_id = excluded.product_id,
      sku_identifier = excluded.sku_identifier,
      source = excluded.source,
      source_updated_at_ms = excluded.source_updated_at_ms,
      refreshed_at_ms = excluded.refreshed_at_ms,
      data_hash = excluded.data_hash`,
  );
  const upsertAlias = db.prepare(
    `INSERT INTO product_alias (
      alias_type, alias_key, alias_value, internal_sku_key, source, updated_at_ms
    ) VALUES (@aliasType, @aliasKey, @aliasValue, @internalSkuKey, @source, @updatedAtMs)
    ON CONFLICT(alias_type, alias_key) DO UPDATE SET
      alias_value = excluded.alias_value,
      internal_sku_key = excluded.internal_sku_key,
      source = excluded.source,
      updated_at_ms = excluded.updated_at_ms`,
  );
  const upsertListing = db.prepare(
    `INSERT INTO listing_identity (
      sid, msku_key, msku, internal_sku_key, internal_sku, listing_sku, asin,
      store_name, country, source, source_updated_at_ms, refreshed_at_ms
    ) VALUES (
      @sid, @mskuKey, @msku, @internalSkuKey, @internalSku, @listingSku, @asin,
      @storeName, @country, @source, @sourceUpdatedAtMs, @refreshedAtMs
    ) ON CONFLICT(sid, msku_key) DO UPDATE SET
      msku = excluded.msku,
      internal_sku_key = excluded.internal_sku_key,
      internal_sku = excluded.internal_sku,
      listing_sku = excluded.listing_sku,
      asin = excluded.asin,
      store_name = excluded.store_name,
      country = excluded.country,
      source = excluded.source,
      source_updated_at_ms = excluded.source_updated_at_ms,
      refreshed_at_ms = excluded.refreshed_at_ms`,
  );

  const writeCatalog = db.transaction(({ products, aliases, listings, metadata = [] }) => {
    const normalizedProducts = products.map(normalizeProduct).map((product) => ({
      ...product,
      dataHash: computeProductHash(product),
    }));
    const normalizedAliases = aliases.map(normalizeAlias);
    const normalizedListings = listings.map(normalizeListing);

    assertAliasesDoNotConflict(db, normalizedAliases);
    for (const product of normalizedProducts) upsertProduct.run(product);
    for (const alias of normalizedAliases) upsertAlias.run(alias);
    for (const listing of normalizedListings) upsertListing.run(listing);

    const hasCatalogRows = normalizedProducts.length > 0
      || normalizedAliases.length > 0
      || normalizedListings.length > 0;
    const currentRevision = Number(readMetadataValue.get("catalog_revision")?.value || 0);
    if (!Number.isInteger(currentRevision) || currentRevision < 0) {
      throw new Error("商品目录 catalog_revision 元数据无效。");
    }
    const revision = hasCatalogRows ? currentRevision + 1 : currentRevision;
    if (hasCatalogRows) writeMetadata.run("catalog_revision", String(revision), resolveNow(now));
    for (const [key, value] of metadata) {
      writeMetadata.run(key, value, resolveNow(now));
    }
    return { revision };
  });

  function readScope(scope) {
    return withOperation(logger, "read-scope", () => {
      if (!Array.isArray(scope)) throw new ProductCatalogInputError("商品目录范围必须为数组。");
      const seen = new Set();
      const productByKey = new Map();
      const rows = [];
      for (const item of scope) {
        const normalized = normalizeScopeItem(item);
        const key = `${normalized.sid}:${normalized.mskuKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const listingRow = readListing.get(normalized.sid, normalized.mskuKey);
        if (!listingRow) continue;
        const listing = mapListingRow(listingRow);
        let product = null;
        if (listing.internalSkuKey) {
          if (!productByKey.has(listing.internalSkuKey)) {
            productByKey.set(listing.internalSkuKey, mapProductRow(readProduct.get(listing.internalSkuKey)));
          }
          product = productByKey.get(listing.internalSkuKey);
        }
        rows.push({ listing, product });
      }
      return rows;
    });
  }

  function readProductsByInternalSkuKeys(keys) {
    return withOperation(logger, "read-products", () => {
      if (!Array.isArray(keys)) throw new ProductCatalogInputError("内部 SKU key 范围必须为数组。");
      const seen = new Set();
      const rows = [];
      for (const value of keys) {
        const key = normalizeInternalSkuKey(value);
        if (seen.has(key)) continue;
        seen.add(key);
        const row = readProduct.get(key);
        if (row) rows.push(mapProductRow(row));
      }
      return rows;
    });
  }

  function upsertCatalog(input = {}) {
    const operation = input && typeof input === "object" && !Array.isArray(input) && input.operation
      ? String(input.operation)
      : "upsert-catalog";
    return withOperation(logger, operation, () => {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ProductCatalogInputError("商品目录写入参数必须为对象。");
      }
      const {
        products = [],
        aliases = [],
        listings = [],
        metadata = {},
      } = input;
      const normalizedProducts = asArray(products, "products");
      const normalizedAliases = asArray(aliases, "aliases");
      const normalizedListings = asArray(listings, "listings");
      const normalizedMetadata = normalizeMetadata(metadata);
      return writeCatalog({
        products: normalizedProducts,
        aliases: normalizedAliases,
        listings: normalizedListings,
        metadata: normalizedMetadata,
      });
    });
  }

  function getRevision() {
    return withOperation(logger, "get-revision", () => {
      const value = readMetadataValue.get("catalog_revision")?.value;
      const revision = Number(value ?? 0);
      if (!Number.isInteger(revision) || revision < 0) throw new Error("商品目录 catalog_revision 元数据无效。");
      return revision;
    });
  }

  function getMetadata(key) {
    return withOperation(logger, "get-metadata", () => {
      const normalizedKey = requiredText(key, "商品目录元数据键不能为空。");
      return readMetadataValue.get(normalizedKey)?.value ?? null;
    });
  }

  function getHealth() {
    return withOperation(logger, "health", () => {
      const quickCheck = String(db.pragma("quick_check", { simple: true })).toLowerCase();
      const legacyValue = readMetadataValue.get("legacy_migrated_at_ms")?.value ?? null;
      const legacyMigratedAt = legacyValue === null || legacyValue === "null" ? null : Number(legacyValue);
      if (legacyValue !== null && legacyValue !== "null" && !Number.isFinite(legacyMigratedAt)) {
        throw new Error("商品目录 legacy_migrated_at_ms 元数据无效。");
      }
      const revisionValue = readMetadataValue.get("catalog_revision")?.value;
      const revision = Number(revisionValue ?? 0);
      if (!Number.isInteger(revision) || revision < 0) throw new Error("商品目录 catalog_revision 元数据无效。");
      return {
        ok: quickCheck === "ok",
        schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
        quickCheck,
        revision,
        listingCount: Number(db.prepare("SELECT COUNT(*) AS count FROM listing_identity").get().count),
        productCount: Number(db.prepare("SELECT COUNT(*) AS count FROM product_master").get().count),
        aliasCount: Number(db.prepare("SELECT COUNT(*) AS count FROM product_alias").get().count),
        metadataCount: Number(db.prepare("SELECT COUNT(*) AS count FROM catalog_metadata").get().count),
        schemaMigrationCount: Number(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count),
        databaseBytes: fileSize(databasePath),
        walBytes: fileSize(`${databasePath}-wal`),
        legacyMigratedAt,
      };
    });
  }

  function getSchemaInfo() {
    return withOperation(logger, "schema-info", () => ({
      version: PRODUCT_CATALOG_SCHEMA_VERSION,
      ...readPragmas(db),
    }));
  }

  return {
    databasePath,
    getSchemaInfo,
    readScope,
    readProductsByInternalSkuKeys,
    upsertCatalog,
    getRevision,
    getMetadata,
    getHealth,
    close: () => withOperation(logger, "close", () => db.close()),
  };
}

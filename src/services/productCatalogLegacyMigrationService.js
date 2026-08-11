import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getLegacyProductCatalogDirectories } from "../utils/cacheStore.js";
import {
  catalogProductToRepositoryRows,
  normalizeCatalogListing,
  normalizeCatalogProduct,
} from "./productCatalogNormalization.js";
import { normalizeCatalogKey } from "./productCatalogIdentity.js";

const SOURCE_SHARED = "shared-product-catalog";
const SOURCE_SUPPLIER = "supplier-board-product-map";
const DEFAULT_MAX_SCAN_ATTEMPTS = 3;

const PRODUCT_FIELDS = [
  "internalSku",
  "sku",
  "productName",
  "imageUrl",
  "supplier",
  "purchasePrice",
  "model",
  "brand",
  "material",
  "purpose",
  "customsCode",
  "isBattery",
  "unit",
  "declaredValue",
  "packQuantity",
  "boxSpec",
  "productId",
  "skuIdentifier",
];

const LEGACY_JSON_SOURCE = "legacy-json";

const LISTING_FIELDS = [
  "sid",
  "msku",
  "internalSku",
  "listingSku",
  "asin",
  "storeName",
  "country",
];

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value).some(hasValue);
  return Boolean(value);
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (typeof left === "number" || typeof right === "number") {
    return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right);
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function canonicalFieldValue(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return `[${value.map(canonicalFieldValue).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFieldValue(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return JSON.stringify(String(value ?? "").trim());
}

function sortFiles(files) {
  return [...files].sort((left, right) => `${left.source}:${left.name}`.localeCompare(`${right.source}:${right.name}`));
}

/**
 * Build a deterministic manifest of the two legacy JSON directories.  File
 * contents are intentionally not included: the manifest is cheap to compare
 * before and after the complete read and is stable across process restarts.
 */
export async function buildLegacyProductCatalogManifest({ sharedDir, supplierDir } = {}) {
  const defaults = getLegacyProductCatalogDirectories();
  const resolvedSharedDir = sharedDir || defaults.sharedProductCatalogDir;
  const resolvedSupplierDir = supplierDir || defaults.supplierBoardProductDir;

  async function list(directory, source) {
    let names;
    try {
      names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      const fileStat = await stat(filePath);
      return {
        source,
        name,
        filePath,
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs),
      };
    }));
  }

  const files = sortFiles([
    ...await list(resolvedSharedDir, SOURCE_SHARED),
    ...await list(resolvedSupplierDir, SOURCE_SUPPLIER),
  ]);
  const entries = files.map(({ source, name, size, mtimeMs }) => ({ source, name, size, mtimeMs }));
  const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { hash, entries, files };
}

function extractRecordList(payload, file) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") {
    throw new Error(`legacy JSON envelope schema invalid: ${file.name}`);
  }
  if (!Object.hasOwn(payload, "data")) {
    throw new Error(`legacy JSON envelope schema invalid: ${file.name}`);
  }
  const unknownEnvelopeKeys = Object.keys(payload).filter((key) => !["updatedAt", "updatedAtMs", "data"].includes(key));
  if (unknownEnvelopeKeys.length) {
    throw new Error(`legacy JSON envelope schema invalid: ${file.name}`);
  }
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.records)) {
    throw new Error(`legacy JSON envelope schema invalid: ${file.name}`);
  }
  const unknownDataKeys = Object.keys(data).filter((key) => key !== "records");
  if (unknownDataKeys.length) {
    throw new Error(`legacy JSON envelope schema invalid: ${file.name}`);
  }
  return data.records;
}

function readEnvelopeUpdatedAtMs(payload, fallback) {
  const candidates = [payload?.updatedAtMs, payload?.data?.updatedAtMs];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return fallback;
}

function errorForJson(file, error) {
  if (error?.code === "JSON_PARSE_FAILED") return error;
  if (error instanceof SyntaxError) {
    const wrapped = new Error(`legacy JSON parse failed: ${file.name}`, { cause: error });
    wrapped.code = "JSON_PARSE_FAILED";
    wrapped.filePath = file.filePath;
    return wrapped;
  }
  const wrapped = new Error(`legacy JSON read failed: ${file.name}: ${String(error?.message || error)}`, { cause: error });
  wrapped.filePath = file.filePath;
  return wrapped;
}

async function readLegacyFile(file) {
  try {
    const payload = JSON.parse(await readFile(file.filePath, "utf8"));
    return {
      sourceUpdatedAtMs: readEnvelopeUpdatedAtMs(payload, file.mtimeMs),
      records: extractRecordList(payload, file),
    };
  } catch (error) {
    throw errorForJson(file, error);
  }
}

function canonicalSeller(sellerBySid, sid, msku) {
  const seller = sellerBySid.get(Number(sid));
  if (!seller) {
    throw new Error(`legacy product catalog references unknown seller SID ${sid} (MSKU ${msku})`);
  }
  const name = String(seller.name ?? seller.storeName ?? "").trim();
  const country = String(seller.country ?? seller.countryName ?? "").trim();
  return { name, country };
}

function productFromListing(listing) {
  if (!listing?.internalSku) return null;
  return {
    internalSku: listing.internalSku,
    sku: listing.internalSku,
    productName: listing.productName,
    imageUrl: listing.imageUrl,
    supplier: listing.supplier,
    purchasePrice: listing.purchasePrice,
    model: listing.model,
    brand: listing.brand,
    material: listing.material,
    purpose: listing.purpose,
    customsCode: listing.customsCode,
    isBattery: listing.isBattery,
    unit: listing.unit,
    declaredValue: listing.declaredValue,
    packQuantity: listing.packQuantity,
    boxSpec: listing.boxSpec,
    productId: listing.productId,
    skuIdentifier: listing.skuIdentifier,
  };
}

function omitRaw(value) {
  if (Array.isArray(value)) return value.map(omitRaw);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.toLowerCase() !== "raw")
    .map(([key, child]) => [key, omitRaw(child)]));
}

function normalizeLegacyRecord(record, file, rowIndex, sellerBySid) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`legacy JSON record schema invalid: ${file.name} row ${rowIndex + 1}`);
  }
  const sanitizedRecord = omitRaw(record);
  const listing = normalizeCatalogListing(sanitizedRecord);
  let product = normalizeCatalogProduct(sanitizedRecord);
  if (!listing && !product) {
    throw new Error(`legacy JSON record identity invalid: ${file.name} row ${rowIndex + 1}`);
  }

  let canonicalListing = listing;
  let identity = "";
  let seller = null;
  if (listing) {
    const sid = Number(listing.sid);
    const mskuKey = normalizeCatalogKey(listing.msku);
    if (!Number.isInteger(sid) || sid <= 0 || !mskuKey) {
      throw new Error(`legacy product catalog contains an invalid listing identity in ${file.name}`);
    }
    seller = canonicalSeller(sellerBySid, sid, listing.msku);
    // Legacy store/country values are deliberately discarded.  Runtime seller
    // identity is the only source that can populate these listing fields.
    canonicalListing = { ...listing, storeName: seller.name, country: seller.country };
    identity = `${sid}:${mskuKey}`;
  }
  if (!product && canonicalListing?.internalSku) product = productFromListing(canonicalListing);

  return {
    source: file.source,
    sourcePriority: file.source === SOURCE_SHARED ? 2 : 1,
    fileName: file.name,
    sourceUpdatedAtMs: file.sourceUpdatedAtMs,
    rowIndex,
    identity,
    listing: canonicalListing,
    product,
  };
}

function createState(value, fields, candidate) {
  const fieldMeta = new Map();
  const fieldCandidates = new Map();
  fields.forEach((field) => {
    if (hasValue(value?.[field])) {
      const candidateValue = canonicalFieldValue(value[field]);
      fieldCandidates.set(field, new Map([[candidateValue, true]]));
      fieldMeta.set(field, {
        sourcePriority: candidate.sourcePriority,
        sourceUpdatedAtMs: candidate.sourceUpdatedAtMs,
        fileName: candidate.fileName,
        rowIndex: candidate.rowIndex,
      });
    }
  });
  return {
    value: cloneValue(value),
    fieldMeta,
    fieldCandidates,
    identity: candidate.identity,
    sourceUpdatedAtMs: candidate.sourceUpdatedAtMs,
    sourcePriority: candidate.sourcePriority,
  };
}

function shouldReplace(previous, incoming, previousValue, incomingValue) {
  if (!previous) return true;
  if (incoming.sourcePriority !== previous.sourcePriority) {
    return incoming.sourcePriority > previous.sourcePriority;
  }
  if (incoming.sourceUpdatedAtMs !== previous.sourceUpdatedAtMs) {
    return incoming.sourceUpdatedAtMs > previous.sourceUpdatedAtMs;
  }
  if (incoming.fileName !== previous.fileName) {
    return incoming.fileName.localeCompare(previous.fileName) > 0;
  }
  const previousCanonical = canonicalFieldValue(previousValue);
  const incomingCanonical = canonicalFieldValue(incomingValue);
  if (incomingCanonical !== previousCanonical) {
    return incomingCanonical.localeCompare(previousCanonical) > 0;
  }
  // Equal canonical values produce the same persisted result; row order is
  // allowed only as an internal tie-breaker for metadata bookkeeping.
  return incoming.rowIndex >= previous.rowIndex;
}

function mergeIntoState(state, incomingValue, fields, candidate, conflict) {
  if (!state) return createState(incomingValue, fields, candidate);
  fields.forEach((field) => {
    const next = incomingValue?.[field];
    if (!hasValue(next)) return;
    const candidateValue = canonicalFieldValue(next);
    if (!state.fieldCandidates.has(field)) state.fieldCandidates.set(field, new Map());
    state.fieldCandidates.get(field).set(candidateValue, true);
    const previous = state.value?.[field];
    const previousMeta = state.fieldMeta.get(field);
    if (hasValue(previous) && !valuesEqual(previous, next)) {
      conflict.count += 1;
      if (conflict.fields.length < 20 && !conflict.fields.includes(field)) conflict.fields.push(field);
    }
    if (!hasValue(previous) || shouldReplace(previousMeta, candidate, previous, next)) {
      state.value[field] = cloneValue(next);
      state.fieldMeta.set(field, {
        sourcePriority: candidate.sourcePriority,
        sourceUpdatedAtMs: candidate.sourceUpdatedAtMs,
        fileName: candidate.fileName,
        rowIndex: candidate.rowIndex,
      });
    }
  });
  state.sourceUpdatedAtMs = Math.max(state.sourceUpdatedAtMs, candidate.sourceUpdatedAtMs);
  state.sourcePriority = Math.max(state.sourcePriority, candidate.sourcePriority);
  return state;
}

function collectConflictSamples(states) {
  const samples = [];
  for (const [identity, state] of [...states.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (const field of [...state.fieldCandidates.keys()].sort()) {
      const candidateValues = state.fieldCandidates.get(field);
      if (!candidateValues || candidateValues.size < 2) continue;
      samples.push({
        identity,
        field,
        candidateCount: candidateValues.size,
        selectedSourceUpdatedAtMs: state.fieldMeta.get(field)?.sourceUpdatedAtMs ?? null,
      });
      if (samples.length >= 10) return samples;
    }
  }
  return samples;
}

function emptyMetrics() {
  return {
    skipped: false,
    fileCount: 0,
    recordCount: 0,
    listingCount: 0,
    productCount: 0,
    aliasCount: 0,
    conflictCount: 0,
    conflictSamples: [],
  };
}

function validateMaxScanAttempts(value) {
  if (!Number.isInteger(value) || value < 1 || value > DEFAULT_MAX_SCAN_ATTEMPTS) {
    throw new Error(`maxScanAttempts 必须是 1..${DEFAULT_MAX_SCAN_ATTEMPTS} 的整数。`);
  }
  return value;
}

function mergeCandidates(candidates, manifest, refreshedAtMs) {
  const sharedIdentities = new Set(candidates
    .filter((candidate) => candidate.source === SOURCE_SHARED && candidate.identity)
    .map((candidate) => candidate.identity));
  const accepted = candidates.filter((candidate) => (
    candidate.source === SOURCE_SHARED
      || !candidate.identity
      || !sharedIdentities.has(candidate.identity)
  ));

  const listings = new Map();
  const products = new Map();
  const conflict = { count: 0, fields: [] };
  for (const candidate of accepted) {
    if (candidate.identity) {
      const listingKey = candidate.identity;
      listings.set(listingKey, mergeIntoState(
        listings.get(listingKey),
        candidate.listing,
        LISTING_FIELDS,
        candidate,
        conflict,
      ));
    }
    if (candidate.product?.internalSku) {
      const productKey = normalizeCatalogKey(candidate.product.internalSku);
      const productCandidate = { ...candidate, identity: productKey };
      products.set(productKey, mergeIntoState(
        products.get(productKey),
        candidate.product,
        PRODUCT_FIELDS,
        productCandidate,
        conflict,
      ));
    }
  }

  const productRows = [];
  const listingRows = [];
  // Keep aliases for distinct internal SKUs separate.  If the same alias key
  // points at two products, the repository must see both rows and reject the
  // batch atomically rather than allowing migration to silently choose one.
  const aliasByIdentity = new Map();
  const source = LEGACY_JSON_SOURCE;
  const addRows = (product, listing, sourceUpdatedAtMs) => {
    const rows = catalogProductToRepositoryRows({
      product,
      listing,
      source,
      sourceUpdatedAtMs,
      refreshedAtMs,
    });
    productRows.push(...rows.products);
    listingRows.push(...rows.listings);
    rows.aliases.forEach((alias) => {
      aliasByIdentity.set(
        `${alias.aliasType}:${alias.aliasKey}:${alias.internalSkuKey}`,
        alias,
      );
    });
  };

  for (const [, listingState] of [...listings.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const listing = listingState.value;
    const productKey = normalizeCatalogKey(listing.internalSku);
    const productState = productKey ? products.get(productKey) : null;
    addRows(productState?.value || null, listing, Math.max(
      listingState.sourceUpdatedAtMs,
      productState?.sourceUpdatedAtMs || 0,
    ));
    // A product state can be emitted once for every listing; dedupe below by
    // canonical key while retaining the newest merged field set.
  }

  const linkedProductKeys = new Set([...listings.values()]
    .map((state) => normalizeCatalogKey(state.value.internalSku))
    .filter(Boolean));
  for (const [productKey, productState] of [...products.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (linkedProductKeys.has(productKey)) continue;
    addRows(productState.value, null, productState.sourceUpdatedAtMs);
  }

  const uniqueProducts = new Map();
  productRows.forEach((row) => {
    const previous = uniqueProducts.get(row.internalSkuKey);
    if (!previous || Number(row.sourceUpdatedAtMs) > Number(previous.sourceUpdatedAtMs)) {
      uniqueProducts.set(row.internalSkuKey, row);
    }
  });
  const uniqueListings = new Map();
  listingRows.forEach((row) => {
    const key = `${row.sid}:${row.mskuKey}`;
    const previous = uniqueListings.get(key);
    if (!previous || Number(row.sourceUpdatedAtMs) > Number(previous.sourceUpdatedAtMs)) {
      uniqueListings.set(key, row);
    }
  });
  const metrics = {
    ...emptyMetrics(),
    fileCount: manifest.files.length,
    recordCount: candidates.length,
    listingCount: uniqueListings.size,
    productCount: uniqueProducts.size,
    aliasCount: aliasByIdentity.size,
    conflictCount: conflict.count,
    conflictFields: conflict.fields,
    conflictSamples: [
      ...collectConflictSamples(listings),
      ...collectConflictSamples(products),
    ].slice(0, 10),
  };
  return {
    records: {
      products: [...uniqueProducts.values()],
      aliases: [...aliasByIdentity.values()],
      listings: [...uniqueListings.values()],
    },
    metrics,
  };
}

/**
 * Read every file in a manifest, then compare a fresh manifest.  Any change
 * discards all in-memory rows before the next complete scan; callers only open
 * the repository transaction after this function returns successfully.
 */
export async function readAndMergeStableManifest({
  currentManifest,
  sellerBySid,
  sharedDir,
  supplierDir,
  maxScanAttempts = DEFAULT_MAX_SCAN_ATTEMPTS,
  refreshedAtMs = Date.now,
  buildManifest = buildLegacyProductCatalogManifest,
} = {}) {
  if (!currentManifest || !Array.isArray(currentManifest.files)) {
    throw new Error("legacy product catalog manifest 无效。");
  }
  const attempts = validateMaxScanAttempts(maxScanAttempts);
  let startingManifest = currentManifest;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidates = [];
    for (const file of startingManifest.files) {
      const { sourceUpdatedAtMs, records } = await readLegacyFile(file);
      records.forEach((record, rowIndex) => {
        const candidate = normalizeLegacyRecord(record, { ...file, sourceUpdatedAtMs }, rowIndex, sellerBySid);
        if (candidate) candidates.push(candidate);
      });
    }
    const freshManifest = await buildManifest({ sharedDir, supplierDir });
    if (freshManifest.hash === startingManifest.hash) {
      const effectiveRefreshedAtMs = typeof refreshedAtMs === "function"
        ? Number(refreshedAtMs())
        : Number(refreshedAtMs);
      if (!Number.isFinite(effectiveRefreshedAtMs) || effectiveRefreshedAtMs <= 0) {
        throw new Error("legacy product catalog migration time 无效。");
      }
      return {
        ...mergeCandidates(candidates, startingManifest, effectiveRefreshedAtMs),
        manifest: freshManifest,
        refreshedAtMs: effectiveRefreshedAtMs,
      };
    }
    startingManifest = freshManifest;
  }
  throw new Error(`旧商品目录连续 ${attempts} 次扫描均发生变化，已放弃迁移。`);
}

function logMigration(logger, level, details) {
  const method = logger?.[level];
  if (typeof method === "function") method.call(logger, "[product-catalog-legacy-migration]", details);
}

function skippedResult(manifest, repository) {
  return {
    ...emptyMetrics(),
    skipped: true,
    fileCount: Array.isArray(manifest.entries) ? manifest.entries.length : manifest.files.length,
    manifestHash: manifest.hash,
    revision: repository.getRevision(),
  };
}

/** Import the old row-set JSON caches into one atomic SQLite repository write. */
export async function migrateLegacyProductCatalog({
  repository,
  sellers = [],
  sharedDir,
  supplierDir,
  logger = console,
  maxScanAttempts = DEFAULT_MAX_SCAN_ATTEMPTS,
  now = Date.now,
  buildManifest = buildLegacyProductCatalogManifest,
  requireSellerCache = false,
} = {}) {
  if (!repository || typeof repository.getMetadata !== "function" || typeof repository.upsertCatalog !== "function") {
    throw new Error("legacy product catalog migration requires a repository");
  }
  validateMaxScanAttempts(maxScanAttempts);
  const defaults = getLegacyProductCatalogDirectories();
  const resolvedSharedDir = sharedDir || defaults.sharedProductCatalogDir;
  const resolvedSupplierDir = supplierDir || defaults.supplierBoardProductDir;
  const initialManifest = await buildManifest({
    sharedDir: resolvedSharedDir,
    supplierDir: resolvedSupplierDir,
  });
  if (repository.getMetadata("legacy_manifest_hash") === initialManifest.hash) {
    return skippedResult(initialManifest, repository);
  }

  const sellerBySid = new Map((Array.isArray(sellers) ? sellers : [])
    .map((seller) => [Number(seller?.sid), seller])
    .filter(([sid]) => Number.isInteger(sid) && sid > 0));
  const merged = await readAndMergeStableManifest({
    currentManifest: initialManifest,
    sellerBySid,
    sharedDir: resolvedSharedDir,
    supplierDir: resolvedSupplierDir,
    maxScanAttempts,
    // Resolve this callback only after a complete read has matched its fresh
    // manifest, so every imported row records the successful-read timestamp.
    refreshedAtMs: () => Number(now()),
    buildManifest,
  });
  if (requireSellerCache && sellerBySid.size === 0 && merged.metrics.recordCount > 0) {
    throw new Error("legacy product catalog records exist but the canonical seller cache is empty");
  }
  const manifest = merged.manifest;
  const migratedAtMs = merged.refreshedAtMs;
  const write = repository.upsertCatalog({
    ...merged.records,
    operation: "legacy-migration",
    requestId: `legacy:${manifest.hash.slice(0, 12)}`,
    metadata: {
      legacy_manifest_hash: manifest.hash,
      legacy_migrated_at_ms: migratedAtMs,
    },
  });
  const result = {
    ...merged.metrics,
    revision: write.revision,
    manifestHash: manifest.hash,
  };
  logMigration(logger, "info", {
    fileCount: result.fileCount,
    listingCount: result.listingCount,
    productCount: result.productCount,
    aliasCount: result.aliasCount,
    conflictCount: result.conflictCount,
    conflictFields: result.conflictFields,
    conflictSamples: result.conflictSamples,
    manifestHashPrefix: result.manifestHash.slice(0, 12),
    migratedAtMs,
  });
  return result;
}

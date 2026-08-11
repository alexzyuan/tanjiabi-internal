import fs from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  normalizeCatalogListing,
} from "./productCatalogNormalization.js";
import { normalizeCatalogKey } from "./productCatalogIdentity.js";

const DEFAULT_LISTING_SHARED_CATALOG_DIR = path.join(process.cwd(), "data-cache", "listing-shared-catalog");

async function listXlsxFiles(directory) {
  const configured = String(process.env.LISTING_SHARED_CATALOG_FILE || "").trim();
  if (configured) return [configured];
  try {
    const names = await readdir(directory);
    const paths = [];
    for (const name of names) {
      if (!/\.xlsx$/i.test(name) || name.startsWith("._")) continue;
      const filePath = path.join(directory, name);
      const info = await stat(filePath);
      if (info.isFile()) paths.push(filePath);
    }
    return paths.sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function loadXlsxModule() {
  const module = await import("xlsx");
  const XLSX = module.default || module;
  if (typeof XLSX.set_fs === "function") XLSX.set_fs(fs);
  return XLSX;
}

/** Read every supported workbook/sheet from the legacy Listing shared catalog. */
export async function readListingSharedCatalogRecords({
  directory = DEFAULT_LISTING_SHARED_CATALOG_DIR,
  files = null,
} = {}) {
  const sourceFiles = Array.isArray(files) ? files : await listXlsxFiles(directory);
  if (!sourceFiles.length) return [];
  const XLSX = await loadXlsxModule();
  const records = [];
  for (const filePath of sourceFiles) {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    for (const sheetName of workbook.SheetNames) {
      records.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }));
    }
  }
  return records;
}

function scopeKey(scopeItem) {
  if (!scopeItem) return "";
  if (scopeItem.key) {
    const key = String(scopeItem.key).trim().toLowerCase();
    const legacy = key.match(/^sid:(\d+):msku:(.+)$/);
    return legacy ? `${legacy[1]}:${legacy[2]}` : key;
  }
  const sid = Number(scopeItem.sid || 0);
  const msku = normalizeCatalogKey(scopeItem.msku);
  return sid > 0 && msku ? `${sid}:${msku}` : "";
}

function rowMskus(scopeItem) {
  return String(scopeItem?.msku || "")
    .split("/")
    .map((value) => normalizeCatalogKey(value))
    .filter(Boolean);
}

function sameOptionalText(left, right) {
  if (!left || !right) return true;
  return normalizeCatalogKey(left) === normalizeCatalogKey(right);
}

function matchesScopeItem(scopeItem, listing) {
  const mskus = rowMskus(scopeItem);
  // A scope containing only a canonical key is already disambiguated by the
  // direct SID/MSKU lookup above.
  if (!mskus.length) return true;
  if (!mskus.includes(normalizeCatalogKey(listing.msku))) return false;
  // Preserve the legacy matcher precedence: store name wins over country,
  // then country wins over SID when both sides provide that dimension.
  if (scopeItem.storeName && listing.storeName) return sameOptionalText(scopeItem.storeName, listing.storeName);
  if (scopeItem.country && listing.country) return sameOptionalText(scopeItem.country, listing.country);
  if (scopeItem.sid && listing.sid) return Number(scopeItem.sid) === Number(listing.sid);
  return true;
}

function cloneListing(listing) {
  return {
    ...listing,
    boxSpec: listing.boxSpec
      ? {
        dimensions: {
          length: listing.boxSpec.dimensions?.length ?? null,
          width: listing.boxSpec.dimensions?.width ?? null,
          height: listing.boxSpec.dimensions?.height ?? null,
          unitOfMeasurement: listing.boxSpec.dimensions?.unitOfMeasurement ?? null,
        },
        weight: {
          value: listing.boxSpec.weight?.value ?? null,
          unit: listing.boxSpec.weight?.unit ?? null,
        },
      }
      : null,
  };
}

/**
 * Match normalized shared-catalog records to a requested SID/MSKU scope.
 * Besides canonical `sid:msku` keys, store/country fallback matching is kept
 * for existing workbooks that do not contain SID columns.
 */
export function findListingSharedCatalogMatches(scope = [], records = []) {
  const normalizedListings = (Array.isArray(records) ? records : [])
    .map((record) => normalizeCatalogListing(record))
    .filter((listing) => listing?.msku && listing?.internalSku);
  const bySidMsku = new Map();
  normalizedListings.forEach((listing) => {
    if (!listing.sid) return;
    bySidMsku.set(`${Number(listing.sid)}:${normalizeCatalogKey(listing.msku)}`, listing);
  });
  return (Array.isArray(scope) ? scope : []).flatMap((scopeItem) => {
    const direct = bySidMsku.get(scopeKey(scopeItem));
    if (direct && matchesScopeItem(scopeItem, direct)) return [cloneListing(direct)];
    return normalizedListings
      .filter((listing) => matchesScopeItem(scopeItem, listing))
      .map((listing) => cloneListing(listing));
  });
}

export { listXlsxFiles };

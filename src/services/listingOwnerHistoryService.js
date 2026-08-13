import { createHash } from "node:crypto";

import { fetchLingxingListingRecords } from "./lingxingCatalogLookupService.js";
import { readCatalogListingMsku, SID_KEYS } from "./productCatalogNormalization.js";
import { SalesFactsInputError } from "./salesFactsIdentity.js";

const OWNER_FIELDS = Object.freeze([
  "asin_principal_list",
  "listing_principal_list",
  "principal_list",
  "principal_info",
  "principalInfo",
  "listing_owner",
  "listingOwner",
  "listing_principal",
  "listingPrincipal",
  "asin_principal",
  "asinPrincipal",
  "principal",
  "principal_name",
  "principalName",
]);

const OWNER_ID_FIELDS = Object.freeze([
  "principal_id",
  "principalId",
  "user_id",
  "userId",
  "employee_id",
  "employeeId",
  "id",
]);

const OWNER_NAME_FIELDS = Object.freeze([
  "principal_name",
  "principalName",
  "user_name",
  "userName",
  "real_name",
  "realName",
  "name",
]);

export class ListingOwnerAuditError extends Error {
  constructor(message, { code, statusCode = 422, details = null, cause } = {}) {
    super(message, { cause });
    this.name = "ListingOwnerAuditError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function firstPresent(record, keys) {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return { key, value: record[key] };
  }
  return null;
}

function firstText(record, keys) {
  if (!record || typeof record !== "object") return "";
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function listingSid(record, fallbackSid = 0) {
  const direct = firstText(record, SID_KEYS);
  const sid = Number(direct || fallbackSid);
  return Number.isInteger(sid) && sid > 0 ? sid : 0;
}

function normalizeOwnerName(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function normalizedNameIdentity(value) {
  return normalizeOwnerName(value).toLocaleLowerCase("en-US");
}

function parseJsonContainer(value, field) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("[") && !text.startsWith("{"))) return value;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ListingOwnerAuditError("Listing 负责人字段结构异常。", {
      code: "LISTING_OWNER_FIELD_MALFORMED",
      details: { field },
      cause,
    });
  }
}

function ownerEntries(value, field) {
  const parsed = parseJsonContainer(value, field);
  if (parsed === undefined || parsed === null || parsed === "") return [];
  if (Array.isArray(parsed)) return parsed;
  return [parsed];
}

function normalizeOwnerEntry(entry, field) {
  if (typeof entry === "string" || typeof entry === "number") {
    const name = normalizeOwnerName(entry);
    if (!name) return null;
    return {
      identity: `name:${normalizedNameIdentity(name)}`,
      personId: null,
      name,
      identitySource: "name-fallback",
    };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ListingOwnerAuditError("Listing 负责人字段结构异常。", {
      code: "LISTING_OWNER_FIELD_MALFORMED",
      details: { field },
    });
  }
  const personId = firstText(entry, OWNER_ID_FIELDS);
  const name = normalizeOwnerName(firstText(entry, OWNER_NAME_FIELDS));
  if (personId) {
    return {
      identity: `id:${personId}`,
      personId,
      name: name || null,
      identitySource: "lingxing-person-id",
    };
  }
  if (name) {
    return {
      identity: `name:${normalizedNameIdentity(name)}`,
      personId: null,
      name,
      identitySource: "name-fallback",
    };
  }
  throw new ListingOwnerAuditError("Listing 负责人字段结构异常。", {
    code: "LISTING_OWNER_FIELD_MALFORMED",
    details: { field },
  });
}

function identityHashPrefix(identity) {
  return createHash("sha256").update(String(identity)).digest("hex").slice(0, 12);
}

function safeIdentityDetails(owners) {
  return [...owners.keys()].sort().map(identityHashPrefix);
}

export function parseListingOwnerRecord(record = {}, { fallbackSid = 0 } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new ListingOwnerAuditError("Listing 记录结构异常。", {
      code: "LISTING_RECORD_MALFORMED",
    });
  }
  const sid = listingSid(record, fallbackSid);
  const msku = readCatalogListingMsku(record);
  if (!sid || !msku) {
    throw new ListingOwnerAuditError("Listing SID 或 MSKU 缺失。", {
      code: "LISTING_IDENTITY_MISSING",
      details: { sid: sid || Number(fallbackSid) || 0, msku: msku || "" },
    });
  }
  const ownerField = firstPresent(record, OWNER_FIELDS);
  if (!ownerField) {
    throw new ListingOwnerAuditError("Listing 负责人字段缺失。", {
      code: "LISTING_OWNER_FIELD_MISSING",
      details: { sid, msku },
    });
  }

  const entries = ownerEntries(ownerField.value, ownerField.key);
  const owners = new Map();
  for (const entry of entries) {
    const owner = normalizeOwnerEntry(entry, ownerField.key);
    if (owner && !owners.has(owner.identity)) owners.set(owner.identity, owner);
  }
  if (!owners.size) {
    return {
      sid,
      msku,
      status: "unassigned",
      ownerIdentity: null,
      ownerPersonId: null,
      ownerNameSnapshot: null,
      identitySource: "lingxing-explicit-empty",
      ownerCount: 0,
    };
  }
  if (owners.size > 1) {
    throw new ListingOwnerAuditError("Listing 返回多个不同负责人。", {
      code: "LISTING_MULTIPLE_OWNERS",
      statusCode: 409,
      details: {
        sid,
        msku,
        ownerCount: owners.size,
        identityHashPrefixes: safeIdentityDetails(owners),
      },
    });
  }
  const owner = owners.values().next().value;
  return {
    sid,
    msku,
    status: "assigned",
    ownerIdentity: owner.identity,
    ownerPersonId: owner.personId,
    ownerNameSnapshot: owner.name,
    identitySource: owner.identitySource,
    ownerCount: 1,
  };
}

function isActiveSeller(seller) {
  const status = seller?.status;
  if (status === undefined || status === null || status === "") return true;
  if (Number(status) === 1) return true;
  return ["active", "enabled", "正常", "启用"].includes(String(status).trim().toLocaleLowerCase("en-US"));
}

function activeSellers(sellers) {
  const bySid = new Map();
  for (const seller of Array.isArray(sellers) ? sellers : []) {
    const sid = Number(seller?.sid ?? seller?.seller_id ?? seller?.sellerId);
    if (Number.isInteger(sid) && sid > 0 && isActiveSeller(seller)) bySid.set(sid, seller);
  }
  return [...bySid.values()].sort((left, right) => Number(left.sid) - Number(right.sid));
}

function listingBaseParams(sid) {
  return { sid, is_delete: 0 };
}

export async function scanAllListingOwners({
  sellers,
  adapter,
  pageSize = 1000,
  maxOffset = 50000,
  requestId = "",
} = {}) {
  const active = activeSellers(sellers);
  if (!active.length) {
    throw new ListingOwnerAuditError("没有可审计的有效店铺。", {
      code: "LISTING_OWNER_NO_ACTIVE_SELLERS",
      statusCode: 400,
      details: { requestId },
    });
  }
  const rows = [];
  let pageCount = 0;
  for (const seller of active) {
    const sid = Number(seller.sid);
    const pagination = {};
    let records;
    try {
      records = await fetchLingxingListingRecords(adapter, listingBaseParams(sid), {
        pageSize,
        maxOffset,
        pagination,
        requireTotal: true,
      });
    } catch (error) {
      if (error?.code === "LISTING_PAGINATION_INCOMPLETE") {
        error.details = { ...error.details, sid, requestId };
      }
      throw error;
    }
    pageCount += pagination.pageCount || 0;
    for (const record of records) rows.push(parseListingOwnerRecord(record, { fallbackSid: sid }));
  }
  return {
    requestId,
    sellerCount: active.length,
    sidCount: active.length,
    rowCount: rows.length,
    pageCount,
    rows,
  };
}

function safeAnomaly(error, fallbackSid) {
  const details = error?.details || {};
  const anomaly = {
    code: String(error?.code || "LISTING_OWNER_FIELD_MALFORMED"),
    sid: Number(details.sid || fallbackSid || 0),
    msku: String(details.msku || ""),
  };
  if (Number.isInteger(details.ownerCount) && details.ownerCount >= 0) anomaly.ownerCount = details.ownerCount;
  if (Array.isArray(details.identityHashPrefixes)) anomaly.identityHashPrefixes = [...details.identityHashPrefixes];
  return anomaly;
}

export async function auditAllListingOwners({
  sellers,
  adapter,
  pageSize = 1000,
  maxOffset = 50000,
  requestId = "",
} = {}) {
  const active = activeSellers(sellers);
  const counts = {
    assigned: 0,
    unassigned: 0,
    multiple: 0,
    malformed: 0,
    failedSidCount: 0,
    paginationIncomplete: 0,
  };
  const anomalies = [];
  const failedSids = [];
  let rowCount = 0;
  let pageCount = 0;
  for (const seller of active) {
    const sid = Number(seller.sid);
    const pagination = {};
    let records;
    try {
      records = await fetchLingxingListingRecords(adapter, listingBaseParams(sid), {
        pageSize,
        maxOffset,
        pagination,
        requireTotal: true,
      });
    } catch (error) {
      if (error?.code === "LISTING_PAGINATION_INCOMPLETE") {
        counts.paginationIncomplete += 1;
        anomalies.push({
          code: "LISTING_PAGINATION_INCOMPLETE",
          sid,
          declaredTotal: Number(error.details?.declaredTotal || 0),
          rowCount: Number(error.details?.rowCount || 0),
        });
      } else {
        counts.failedSidCount += 1;
        failedSids.push({ sid, code: "LISTING_REQUEST_FAILED" });
      }
      continue;
    }
    pageCount += pagination.pageCount || 0;
    rowCount += records.length;
    for (const record of records) {
      try {
        const row = parseListingOwnerRecord(record, { fallbackSid: sid });
        counts[row.status] += 1;
      } catch (error) {
        if (error?.code === "LISTING_MULTIPLE_OWNERS") counts.multiple += 1;
        else counts.malformed += 1;
        anomalies.push(safeAnomaly(error, sid));
      }
    }
  }
  return {
    requestId,
    sellerCount: active.length,
    sidCount: active.length,
    rowCount,
    pageCount,
    counts,
    anomalies,
    failedSids,
  };
}

const OWNER_HISTORY_START_DATE = "0001-01-01";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function canonicalDate(value) {
  const text = String(value || "").trim();
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!DATE_PATTERN.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new SalesFactsInputError("负责人检测日期无效。", { code: "SALES_FACTS_OWNER_DATE_INVALID" });
  }
  return text;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedMskuKey(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function ownerKey(row) {
  return `${Number(row.sid)}|${normalizedMskuKey(row.mskuKey || row.msku)}`;
}

function ownerUpdatedAtMs(now) {
  const value = typeof now === "function" ? now() : now;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new SalesFactsInputError("负责人同步时间无效。", { code: "SALES_FACTS_OWNER_NOW_INVALID" });
  }
  return timestamp;
}

function periodSort(left, right) {
  return Number(left.sid) - Number(right.sid)
    || left.mskuKey.localeCompare(right.mskuKey)
    || left.effectiveFrom.localeCompare(right.effectiveFrom);
}

function snapshotStateChanged(current, snapshot) {
  return current.status !== snapshot.status
    || current.ownerIdentity !== snapshot.ownerIdentity
    || current.ownerPersonId !== snapshot.ownerPersonId
    || current.ownerNameSnapshot !== snapshot.ownerNameSnapshot
    || current.identitySource !== snapshot.identitySource;
}

function historicalUnknownPeriod(snapshot, cutoverDate, updatedAtMs) {
  return {
    sid: snapshot.sid,
    msku: snapshot.msku,
    mskuKey: snapshot.mskuKey,
    effectiveFrom: OWNER_HISTORY_START_DATE,
    effectiveTo: shiftDate(cutoverDate, -1),
    ownerIdentity: null,
    ownerPersonId: null,
    ownerNameSnapshot: null,
    identitySource: "cutover-historical-unknown",
    status: "historical-unknown",
    updatedAtMs,
  };
}

function snapshotPeriod(snapshot, effectiveFrom, updatedAtMs) {
  return {
    sid: snapshot.sid,
    msku: snapshot.msku,
    mskuKey: snapshot.mskuKey,
    effectiveFrom,
    effectiveTo: null,
    ownerIdentity: snapshot.ownerIdentity,
    ownerPersonId: snapshot.ownerPersonId,
    ownerNameSnapshot: snapshot.ownerNameSnapshot,
    identitySource: snapshot.identitySource,
    status: snapshot.status,
    updatedAtMs,
  };
}

export async function syncListingOwnerHistory({
  repository,
  sellers,
  adapter,
  detectedDate,
  requestId = "",
  now = Date.now,
} = {}) {
  if (!repository || typeof repository.readOwnerPeriods !== "function" || typeof repository.applyOwnerSnapshot !== "function") {
    throw new SalesFactsInputError("负责人仓储无效。", { code: "SALES_FACTS_OWNER_REPOSITORY_INVALID" });
  }
  const detectionDate = canonicalDate(detectedDate);
  const scan = await scanAllListingOwners({ sellers, adapter, requestId });
  const snapshots = scan.rows.map((row) => ({
    ...row,
    mskuKey: normalizedMskuKey(row.msku),
  }));
  const duplicateKeys = new Set();
  const snapshotByKey = new Map();
  for (const snapshot of snapshots) {
    const key = ownerKey(snapshot);
    if (snapshotByKey.has(key)) duplicateKeys.add(key);
    snapshotByKey.set(key, snapshot);
  }
  if (duplicateKeys.size) {
    throw new ListingOwnerAuditError("Listing 扫描返回重复身份。", {
      code: "LISTING_OWNER_DUPLICATE_IDENTITY",
      statusCode: 409,
      details: { duplicateCount: duplicateKeys.size },
    });
  }

  const existing = repository.readOwnerPeriods(null, { requestId }).map((period) => ({ ...period }));
  const periodsByKey = new Map();
  for (const period of existing) {
    const key = ownerKey(period);
    if (!periodsByKey.has(key)) periodsByKey.set(key, []);
    periodsByKey.get(key).push(period);
  }
  const scannedSids = new Set(activeSellers(sellers).map((seller) => Number(seller.sid)));
  const missingOpenIdentityCount = [...periodsByKey]
    .filter(([key, periods]) => scannedSids.has(Number(periods[0]?.sid))
      && periods.some((period) => period.effectiveTo === null)
      && !snapshotByKey.has(key))
    .length;
  if (missingOpenIdentityCount) {
    throw new ListingOwnerAuditError("完整 Listing 快照缺少已有开放负责人身份。", {
      code: "LISTING_OWNER_SNAPSHOT_MISSING_OPEN_IDENTITY",
      statusCode: 409,
      details: { missingOpenIdentityCount },
    });
  }
  const updatedAtMs = ownerUpdatedAtMs(now);
  let changedListingCount = 0;
  let transferCount = 0;
  for (const [key, snapshot] of snapshotByKey) {
    const periods = periodsByKey.get(key) || [];
    const open = periods.find((period) => period.effectiveTo === null);
    if (!periods.length) {
      periods.push(historicalUnknownPeriod(snapshot, detectionDate, updatedAtMs));
      periods.push(snapshotPeriod(snapshot, detectionDate, updatedAtMs));
      periodsByKey.set(key, periods);
      changedListingCount += 1;
      continue;
    }
    if (!open) {
      throw new ListingOwnerAuditError("Listing 负责人历史缺少开放期间。", {
        code: "LISTING_OWNER_OPEN_PERIOD_MISSING",
        statusCode: 409,
        details: { missingOpenPeriodCount: 1 },
      });
    }
    if (!snapshotStateChanged(open, snapshot)) continue;
    const nextEffectiveFrom = shiftDate(detectionDate, 1);
    if (open.effectiveFrom > detectionDate) {
      throw new ListingOwnerAuditError("负责人检测日期早于当前开放期间。", {
        code: "LISTING_OWNER_DETECTION_DATE_CONFLICT",
        statusCode: 409,
      });
    }
    open.effectiveTo = detectionDate;
    periods.push(snapshotPeriod(snapshot, nextEffectiveFrom, updatedAtMs));
    changedListingCount += 1;
    if (open.status === "assigned" && snapshot.status === "assigned" && open.ownerIdentity !== snapshot.ownerIdentity) {
      transferCount += 1;
    }
  }
  const nextPeriods = [...periodsByKey.values()].flat().sort(periodSort);
  const applied = repository.applyOwnerSnapshot({ periods: nextPeriods, requestId });
  return {
    changed: Boolean(applied.changed),
    ownerRevision: Number(applied.ownerRevision),
    scannedListingCount: snapshots.length,
    periodCount: nextPeriods.length,
    changedListingCount,
    transferCount,
  };
}

import path from "node:path";

import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";

const defaultStoreFile = path.join(
  process.cwd(),
  "data-cache",
  "fba-shipment-variance-followups.json",
);

const emptyStore = {
  version: 1,
  rows: [],
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeSid(value) {
  const sid = Number(value);
  if (!Number.isInteger(sid) || sid <= 0) {
    throw new Error("保存货件差异跟进失败：缺少店铺 SID。");
  }
  return sid;
}

function normalizeShipmentId(value) {
  const shipmentId = firstText(value);
  if (!shipmentId) {
    throw new Error("保存货件差异跟进失败：缺少货件单号。");
  }
  return shipmentId;
}

function normalizeStore(store) {
  return {
    version: 1,
    rows: Array.isArray(store?.rows) ? store.rows : [],
  };
}

function shipmentKey({ sid, shipmentId }) {
  return `${sid}:${shipmentId}`;
}

function timestampFrom(now) {
  const timestamp = typeof now === "function" ? now() : new Date();
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.valueOf())) {
    throw new Error("保存货件差异跟进失败：操作时间无效。");
  }
  return timestamp.toISOString();
}

export async function listFbaShipmentVarianceFollowupsByKeys(
  keys = [],
  { storeFile = defaultStoreFile } = {},
) {
  const wantedKeys = new Set(keys.map((key) => firstText(key)).filter(Boolean));
  const store = normalizeStore(await readJson(storeFile, emptyStore));

  return new Map(
    store.rows
      .filter((row) => wantedKeys.has(shipmentKey(row)))
      .map((row) => [shipmentKey(row), row]),
  );
}

async function saveFollowup(
  input,
  followedUp,
  { storeFile = defaultStoreFile, now = () => new Date() } = {},
) {
  const sid = normalizeSid(input?.sid);
  const shipmentId = normalizeShipmentId(input?.shipmentId);
  const operator = firstText(input?.operator, "系统");
  const updatedAt = timestampFrom(now);
  const key = shipmentKey({ sid, shipmentId });
  let savedRow;

  await updateJsonAtomic(
    storeFile,
    (store) => {
      const currentStore = normalizeStore(store);
      const previous = currentStore.rows.find((row) => shipmentKey(row) === key) || {};
      savedRow = {
        sid,
        shipmentId,
        followedUp,
        followedUpAt: followedUp ? updatedAt : firstText(previous.followedUpAt),
        followedUpBy: followedUp ? operator : firstText(previous.followedUpBy),
        clearedAt: followedUp ? "" : updatedAt,
        clearedBy: followedUp ? "" : operator,
        updatedAt,
      };

      return {
        ...currentStore,
        rows: [savedRow, ...currentStore.rows.filter((row) => shipmentKey(row) !== key)],
      };
    },
    emptyStore,
  );

  console.info("[fba-shipment-variance-followup] updated", {
    action: followedUp ? "marked" : "cleared",
    shipmentKey: key,
    operator,
  });

  return savedRow;
}

export function markFbaShipmentVarianceFollowup(input, options) {
  return saveFollowup(input, true, options);
}

export function clearFbaShipmentVarianceFollowup(input, options) {
  return saveFollowup(input, false, options);
}

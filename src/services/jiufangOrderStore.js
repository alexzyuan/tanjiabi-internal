import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";
import { redactJiufangPayload } from "../adapters/jiufangAdapter.js";

const defaultStoreFile = path.join(process.cwd(), "data-cache", "jiufang-fba-orders.json");
const fallbackStore = { version: 1, rows: [] };

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeStore(store = fallbackStore) {
  return {
    version: 1,
    rows: Array.isArray(store.rows) ? store.rows : [],
  };
}

function normalizeOrderRow(input = {}) {
  const shipmentId = firstText(input.shipmentId);
  if (!shipmentId) throw new Error("保存九方订单状态失败：缺少货件单号。");
  const jiufangOrderNumber = firstText(input.jiufangOrderNumber, input.orderNumber);
  if (!jiufangOrderNumber) throw new Error(`保存九方订单状态失败：${shipmentId} 缺少九方订单号。`);
  const createdAt = typeof input.now === "function" ? input.now().toISOString() : new Date().toISOString();
  return {
    shipmentId,
    status: "created",
    jiufangOrderNumber,
    channelCode: firstText(input.channelCode),
    requestSummary: input.requestSummary || {},
    responseChargeSummary: input.responseChargeSummary || {},
    requestPayload: redactJiufangPayload(input.requestPayload || {}),
    responsePayload: redactJiufangPayload(input.responsePayload || {}),
    operator: firstText(input.operator, "系统"),
    createdAt,
    lastError: "",
  };
}

export async function getJiufangOrderByShipmentId(shipmentId, { storeFile = defaultStoreFile } = {}) {
  const id = firstText(shipmentId);
  if (!id) return null;
  const store = normalizeStore(await readJson(storeFile, fallbackStore));
  return store.rows.find((row) => row.shipmentId === id && row.status === "created" && row.jiufangOrderNumber) || null;
}

export async function listJiufangOrdersByShipmentIds(shipmentIds = [], { storeFile = defaultStoreFile } = {}) {
  const wanted = new Set((shipmentIds || []).map((value) => firstText(value)).filter(Boolean));
  const store = normalizeStore(await readJson(storeFile, fallbackStore));
  return new Map(store.rows
    .filter((row) => wanted.has(row.shipmentId) && row.status === "created" && row.jiufangOrderNumber)
    .map((row) => [row.shipmentId, row]));
}

export async function saveJiufangOrderResult(input = {}, { storeFile = defaultStoreFile } = {}) {
  const nextRow = normalizeOrderRow(input);
  await updateJsonAtomic(storeFile, (store = fallbackStore) => {
    const current = normalizeStore(store);
    return {
      ...current,
      rows: [
        nextRow,
        ...current.rows.filter((row) => row.shipmentId !== nextRow.shipmentId),
      ],
    };
  }, fallbackStore);
  console.info("[jiufang-order-store] saved Jiufang order", {
    shipmentId: nextRow.shipmentId,
    jiufangOrderNumber: nextRow.jiufangOrderNumber,
    channelCode: nextRow.channelCode,
  });
  return nextRow;
}

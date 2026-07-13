import crypto from "node:crypto";
import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";

const defaultStoreFile = path.join(process.cwd(), "data-cache", "freight-rates.json");
const fallbackStore = { rows: [] };

export const freightRateOptions = {
  carriers: ["九方通逊", "同袍"],
  transportMethods: ["普船", "快船", "空运", "快递"],
};

function nowIso(now = () => new Date()) {
  return now().toISOString();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeWarehouseCode(value) {
  return cleanText(value).toUpperCase();
}

function assertDateText(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("日期不能为空，格式必须是 YYYY-MM-DD。");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("日期不是有效日期。");
  }
  return text;
}

export function isoWeekFromDate(value) {
  const text = assertDateText(value);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function parsePrice(value) {
  const number = Number(cleanText(value).replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) throw new Error("价格必须是非负数字。");
  return Number(number.toFixed(4));
}

function assertAllowed(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label}必须是：${allowed.join("、")}。`);
}

function routeKey(row = {}) {
  return [
    row.week,
    normalizeKey(row.country),
    normalizeWarehouseCode(row.warehouseCode),
    row.carrier,
    row.transportMethod,
  ].join("|");
}

function normalizeFreightRateRow(input = {}, existing = {}, { now = () => new Date() } = {}) {
  const date = assertDateText(input.date ?? existing.date);
  const country = cleanText(input.country ?? existing.country);
  const warehouseCode = normalizeWarehouseCode(input.warehouseCode ?? existing.warehouseCode);
  const carrier = cleanText(input.carrier ?? existing.carrier) || freightRateOptions.carriers[0];
  const transportMethod = cleanText(input.transportMethod ?? existing.transportMethod);

  if (!country) throw new Error("国家不能为空。");
  if (!warehouseCode) throw new Error("仓库代码不能为空。");
  assertAllowed(carrier, freightRateOptions.carriers, "承运商");
  assertAllowed(transportMethod, freightRateOptions.transportMethods, "运输方式");

  return {
    id: existing.id || cleanText(input.id) || makeId(),
    week: isoWeekFromDate(date),
    date,
    country,
    warehouseCode,
    carrier,
    transportMethod,
    price: parsePrice(input.price ?? existing.price),
    createdAt: existing.createdAt || nowIso(now),
    updatedAt: nowIso(now),
  };
}

function sortFreightRateRows(rows = []) {
  return [...rows].sort((left, right) => (
    right.week.localeCompare(left.week)
    || right.date.localeCompare(left.date)
    || left.country.localeCompare(right.country, "zh-Hans-CN")
    || left.warehouseCode.localeCompare(right.warehouseCode)
    || left.carrier.localeCompare(right.carrier, "zh-Hans-CN")
    || left.transportMethod.localeCompare(right.transportMethod, "zh-Hans-CN")
  ));
}

function filterRows(rows = [], filters = {}) {
  const keyword = normalizeKey(filters.keyword);
  const week = cleanText(filters.week);
  const country = normalizeKey(filters.country);
  const warehouseCode = normalizeWarehouseCode(filters.warehouseCode);
  const carrier = cleanText(filters.carrier);
  const transportMethod = cleanText(filters.transportMethod);
  return rows.filter((row) => {
    if (week && row.week !== week) return false;
    if (country && normalizeKey(row.country) !== country) return false;
    if (warehouseCode && normalizeWarehouseCode(row.warehouseCode) !== warehouseCode) return false;
    if (carrier && row.carrier !== carrier) return false;
    if (transportMethod && row.transportMethod !== transportMethod) return false;
    if (keyword) {
      const haystack = normalizeKey(`${row.week} ${row.date} ${row.country} ${row.warehouseCode} ${row.carrier} ${row.transportMethod} ${row.price}`);
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function buildWeekGroups(rows = []) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row.week, (counts.get(row.week) || 0) + 1));
  return [...counts.entries()].map(([week, count]) => ({ week, count }));
}

export async function listFreightRates(filters = {}, { storeFile = defaultStoreFile } = {}) {
  const store = await readJson(storeFile, fallbackStore);
  const allRows = Array.isArray(store.rows) ? store.rows : [];
  const rows = sortFreightRateRows(filterRows(allRows, filters));
  return {
    ok: true,
    meta: {
      source: "BI手填运费看板",
      total: allRows.length,
      updatedAt: nowIso(),
    },
    rows,
    weekGroups: buildWeekGroups(rows),
    options: freightRateOptions,
  };
}

export async function saveFreightRate(payload = {}, { storeFile = defaultStoreFile, now = () => new Date() } = {}) {
  let saved = null;
  await updateJsonAtomic(storeFile, async (store = fallbackStore) => {
    const rows = Array.isArray(store.rows) ? [...store.rows] : [];
    const id = cleanText(payload.id);
    const index = id ? rows.findIndex((row) => row.id === id) : -1;
    const existing = index >= 0 ? rows[index] : {};
    const normalized = normalizeFreightRateRow(payload, existing, { now });
    const duplicate = rows.find((row) => row.id !== normalized.id && routeKey(row) === routeKey(normalized));
    if (duplicate) throw new Error("同一周、国家、仓库、承运商和运输方式已存在运费记录。");

    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);
    saved = normalized;
    return { rows: sortFreightRateRows(rows) };
  }, fallbackStore);
  return saved;
}

export async function deleteFreightRate(id, { storeFile = defaultStoreFile } = {}) {
  const targetId = cleanText(id);
  if (!targetId) throw new Error("运费记录 ID 不能为空。");
  await updateJsonAtomic(storeFile, async (store = fallbackStore) => {
    const rows = Array.isArray(store.rows) ? store.rows : [];
    const nextRows = rows.filter((row) => row.id !== targetId);
    if (nextRows.length === rows.length) throw new Error("运费记录不存在。");
    return { rows: nextRows };
  }, fallbackStore);
  return { id: targetId };
}

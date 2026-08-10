import path from "node:path";

import { listStoreOperatingMonthlyReportMetricDefinitions } from "./storeOperatingMonthlyReportMapper.js";
import { readJsonWithRecovery, updateJsonAtomic } from "../utils/jsonStore.js";

const EMPTY_STORE = Object.freeze({ version: 1, users: {} });

export class StoreOperatingMonthlyReportRowVisibilityInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreOperatingMonthlyReportRowVisibilityInputError";
    this.statusCode = 400;
  }
}

function text(value) {
  return String(value || "").trim();
}

function accountKeyForUser(user = {}) {
  const source = text(user.source || "managed").toLowerCase() || "managed";
  const identity = source === "dingtalk" ? text(user.id || user.username) : text(user.username || user.id).toLowerCase();
  if (!identity) throw new StoreOperatingMonthlyReportRowVisibilityInputError("当前登录账号缺少稳定身份，无法读取项目行配置。");
  return `${source}:${identity}`;
}

function normalizeMetrics(listMetrics) {
  const metrics = listMetrics();
  if (!Array.isArray(metrics)) throw new Error("月报项目行指标目录必须是数组。");
  const seen = new Set();
  return metrics.map((metric) => ({
    key: text(metric?.key),
    name: text(metric?.name),
    category: text(metric?.category),
    categoryName: text(metric?.categoryName),
  })).filter((metric) => {
    if (!metric.key || seen.has(metric.key)) return false;
    seen.add(metric.key);
    return true;
  });
}

function normalizeHiddenMetricIds(value, metrics) {
  if (!Array.isArray(value)) {
    throw new StoreOperatingMonthlyReportRowVisibilityInputError("hiddenMetricIds 必须是数组。");
  }
  const requested = new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean));
  return metrics.map((metric) => metric.key).filter((key) => requested.has(key));
}

function normalizeStore(value) {
  const users = value && typeof value === "object" && value.users && typeof value.users === "object" && !Array.isArray(value.users)
    ? value.users
    : {};
  return { version: 1, users: { ...users } };
}

function responseFor(store, accountKey, metrics) {
  const record = store.users[accountKey] || {};
  const known = new Set(metrics.map((metric) => metric.key));
  const hiddenMetricIds = Array.isArray(record.hiddenMetricIds)
    ? metrics.map((metric) => metric.key).filter((key) => known.has(key) && record.hiddenMetricIds.includes(key))
    : [];
  return {
    hiddenMetricIds,
    updatedAt: text(record.updatedAt),
    metrics,
  };
}

export function createStoreOperatingMonthlyReportRowVisibilityService({
  filePath = path.join(process.cwd(), "data-cache", "store-operating-monthly-report-row-visibility.json"),
  listMetrics = listStoreOperatingMonthlyReportMetricDefinitions,
  now = () => new Date().toISOString(),
} = {}) {
  async function read(user) {
    const accountKey = accountKeyForUser(user);
    const metrics = normalizeMetrics(listMetrics);
    const store = normalizeStore(await readJsonWithRecovery(filePath, EMPTY_STORE));
    return responseFor(store, accountKey, metrics);
  }

  async function save(user, payload = {}) {
    const accountKey = accountKeyForUser(user);
    const metrics = normalizeMetrics(listMetrics);
    const hiddenMetricIds = normalizeHiddenMetricIds(payload.hiddenMetricIds, metrics);
    await readJsonWithRecovery(filePath, EMPTY_STORE);
    const store = normalizeStore(await updateJsonAtomic(filePath, (current) => {
      const next = normalizeStore(current);
      next.users[accountKey] = { hiddenMetricIds, updatedAt: now() };
      return next;
    }, EMPTY_STORE));
    return responseFor(store, accountKey, metrics);
  }

  return { read, save };
}

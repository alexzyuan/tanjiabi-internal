import { randomUUID } from "node:crypto";

import { getPacificTodayText } from "../utils/pacificDate.js";
import {
  backupInventoryProvisionHistoryCache,
  readInventoryProvisionHistoryCache,
  saveInventoryProvisionHistoryCache,
} from "../utils/cacheStore.js";
import { loadHistoricalInventoryRows } from "./inventoryProvisionService.js";

function monthNumber(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  return year * 12 + month;
}

function validateHistoricalMonth(value, todayText) {
  const month = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) {
    throw new Error("库存计提刷新月份必须是 YYYY-MM 格式。");
  }
  const currentMonth = String(todayText || "").slice(0, 7);
  if (month === currentMonth) {
    throw new Error("当前月仅支持实时库存读取，不能重建月末历史计提。");
  }
  if (monthNumber(month) > monthNumber(currentMonth)) {
    throw new Error(`不能刷新未来月份库存计提：${month}。`);
  }
  return month;
}

export function createInventoryProvisionRefreshService({
  todayText = getPacificTodayText,
  nowText = () => new Date().toLocaleString("zh-CN", { hour12: false }),
  readHistoryCache = readInventoryProvisionHistoryCache,
  rebuildHistory = loadHistoricalInventoryRows,
  backupHistoryCache = backupInventoryProvisionHistoryCache,
  saveHistoryCache = saveInventoryProvisionHistoryCache,
  logger = console,
} = {}) {
  async function refresh({ date } = {}) {
    const operationId = `inventory-provision-refresh-${randomUUID()}`;
    const today = todayText();
    let month = "";
    let stage = "validate";
    let previous = null;
    let backupCreated = false;
    const startedAt = Date.now();

    try {
      month = validateHistoricalMonth(date, today);

      stage = "history-cache-read";
      previous = await readHistoryCache(month);

      stage = "history-rebuild";
      const rebuilt = await rebuildHistory(month, { forceRefresh: true, persist: false });

      stage = "history-cache-backup";
      const backup = await backupHistoryCache(month, { operationId });
      backupCreated = backup.created === true;

      stage = "history-cache-write";
      await saveHistoryCache(month, rebuilt);

      const refreshedAt = nowText();
      logger.info?.("[inventory-provision-refresh] completed", {
        operationId,
        month,
        previousCacheExists: Boolean(previous),
        backupCreated,
        rawCount: rebuilt.rawCount,
        ledgerCount: rebuilt.ledgerCount,
        matchedRows: rebuilt.matchedRows,
        batchCount: rebuilt.rows?.length || 0,
        durationMs: Date.now() - startedAt,
        refreshedAt,
      });
      return {
        operationId,
        month,
        backupCreated,
        previousCacheExists: Boolean(previous),
        refreshedAt,
        ...rebuilt,
      };
    } catch (error) {
      error.operationId = operationId;
      error.month = month || String(date || "").trim();
      error.stage = stage;
      error.details = {
        ...(error.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {}),
        operationId,
        month: error.month,
        stage,
        previousCacheExists: Boolean(previous),
        backupCreated,
      };
      logger.error?.("[inventory-provision-refresh] failed", {
        operationId,
        month: error.month,
        stage,
        previousCacheExists: Boolean(previous),
        backupCreated,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
      throw error;
    }
  }

  return { refresh };
}

const defaultService = createInventoryProvisionRefreshService();

export function refreshInventoryProvisionMonth(input) {
  return defaultService.refresh(input);
}

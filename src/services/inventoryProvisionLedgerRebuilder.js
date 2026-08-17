function monthText(date) {
  return String(date || "").slice(0, 7);
}

function shiftMonth(value, delta) {
  const [year, month] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(month) {
  const [year, value] = String(month).split("-").map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, "0")}`;
}

function monthDistance(later, earlier) {
  const [laterYear, laterMonth] = String(later).split("-").map(Number);
  const [earlierYear, earlierMonth] = String(earlier).split("-").map(Number);
  return laterYear * 12 + laterMonth - earlierYear * 12 - earlierMonth;
}

function ageDaysForHistoricalMonth(selectedMonth, cohortMonth) {
  const distance = monthDistance(selectedMonth, cohortMonth);
  if (distance <= 0) return 15;
  if (distance === 1) return 45;
  if (distance === 2) return 75;
  if (distance <= 5) return 120;
  if (distance <= 8) return 210;
  return 300;
}

function eventKey(record) {
  return `${record.sellerId}|${record.marketplaceId}|${record.msku}`;
}

function normalizedEventType(value) {
  return String(value || "").replace(/[\s_-]+/gu, "").toLowerCase();
}

const eventActions = new Map([
  ["beginningbalance", "opening"],
  ["receipts", "in"],
  ["receipt", "in"],
  ["customerreturns", "in"],
  ["customerreturn", "in"],
  ["warehousetransferin", "in"],
  ["transferin", "in"],
  ["found", "in"],
  ["customershipments", "out"],
  ["customershipment", "out"],
  ["warehousetransferout", "out"],
  ["transferout", "out"],
  ["lost", "out"],
  ["damaged", "out"],
  ["disposed", "out"],
  ["disposition", "out"],
  ["other", "signed"],
]);

function createLedgerError(code, message, record) {
  const error = new Error(message);
  error.code = code;
  error.record = {
    sellerId: record.sellerId,
    marketplaceId: record.marketplaceId,
    msku: record.msku,
    eventType: record.eventType,
    sourceRow: record.sourceRow,
  };
  return error;
}

function consumeOldest(cohorts, quantity) {
  let remaining = quantity;
  for (const cohort of cohorts) {
    if (remaining <= 0) break;
    const removed = Math.min(cohort.quantity, remaining);
    cohort.quantity -= removed;
    remaining -= removed;
  }
  if (remaining > 0.000001) throw new Error(`库存分类账出库超出可用库存：${remaining}`);
  return cohorts.filter((cohort) => cohort.quantity > 0.000001);
}

function applyRecord(cohorts, record) {
  const action = eventActions.get(normalizedEventType(record.eventType));
  if (!action) {
    throw createLedgerError(
      "INVENTORY_LEDGER_EVENT_TYPE_UNSUPPORTED",
      `库存分类账事件类型不支持：${record.eventType}（第 ${record.sourceRow} 行）。`,
      record,
    );
  }
  const quantity = Number(record.quantity);
  if (!Number.isFinite(quantity)) throw createLedgerError("INVENTORY_LEDGER_QUANTITY_INVALID", `库存分类账数量无效（第 ${record.sourceRow} 行）。`, record);
  if (action === "signed") {
    if (!quantity) throw createLedgerError("INVENTORY_LEDGER_EVENT_TYPE_AMBIGUOUS", `库存分类账 Other 事件数量不能为 0（第 ${record.sourceRow} 行）。`, record);
    if (quantity > 0) return [...cohorts, { month: monthText(record.date), quantity }];
    return consumeOldest(cohorts, Math.abs(quantity));
  }
  if (action === "opening") {
    if (quantity < 0) throw createLedgerError("INVENTORY_LEDGER_OPENING_BALANCE_INVALID", `库存分类账期初余额不能为负（第 ${record.sourceRow} 行）。`, record);
    if (!quantity) return cohorts;
    if (cohorts.length) throw createLedgerError("INVENTORY_LEDGER_DUPLICATE_OPENING_BALANCE", `库存分类账重复期初余额（第 ${record.sourceRow} 行）。`, record);
    return [{ month: shiftMonth(monthText(record.date), -1), quantity: Math.abs(quantity) }];
  }
  if (!quantity) return cohorts;
  if (action === "in") return [...cohorts, { month: monthText(record.date), quantity: Math.abs(quantity) }];
  return consumeOldest(cohorts, Math.abs(quantity));
}

function baseMetadata(baseRowsByKey, key, record, sellersById) {
  const source = baseRowsByKey instanceof Map ? baseRowsByKey.get(key) : baseRowsByKey?.[key];
  const seller = sellersById.get(record.sellerId) || {};
  return {
    sid: Number(source?.sid || seller.sid || 0),
    sellerId: record.sellerId,
    marketplaceId: record.marketplaceId,
    countryCode: source?.countryCode || seller.countryCode || "",
    storeName: source?.storeName || seller.name || record.sellerId,
    country: source?.country || seller.country || seller.countryCode || "",
    msku: record.msku,
    skuName: source?.skuName || record.title || "",
    listingOwner: source?.listingOwner || "-",
    purchaseCost: Number(source?.purchaseCost || 0),
    firstLegCost: Number(source?.firstLegCost || 0),
    fallback: !source,
  };
}

function uniqueMonths(months) {
  const result = [...new Set(months.map(String))].sort();
  if (!result.length || result.some((month) => !/^\d{4}-\d{2}$/u.test(month))) throw new Error("库存分类账重建目标月份无效。");
  return result;
}

export function rebuildInventoryProvisionHistory({
  records = [],
  targetMonths = [],
  sellers = [],
  baseRowsByKey = new Map(),
  nowText = () => new Date().toLocaleString("zh-CN", { hour12: false }),
} = {}) {
  const months = uniqueMonths(targetMonths);
  const targetSet = new Set(months);
  const sellersById = new Map(sellers.map((seller) => [String(seller.seller_id || seller.sellerId || ""), seller]));
  const recordsByKey = new Map();
  records.forEach((record) => {
    if (!targetSet.has(monthText(record.date))) throw new Error(`库存分类账事件 ${record.date} 不在重建范围内。`);
    const key = eventKey(record);
    if (!recordsByKey.has(key)) recordsByKey.set(key, []);
    recordsByKey.get(key).push(record);
  });
  const rowsByMonth = new Map(months.map((month) => [month, []]));
  let metadataFallbackRows = 0;
  let matchedRows = 0;

  for (const [key, group] of recordsByKey) {
    group.sort((left, right) => left.date.localeCompare(right.date) || Number(left.sourceRow || 0) - Number(right.sourceRow || 0));
    let cohorts = [];
    let offset = 0;
    for (const month of months) {
      while (offset < group.length && monthText(group[offset].date) === month) {
        cohorts = applyRecord(cohorts, group[offset]);
        offset += 1;
      }
      if (!cohorts.length) continue;
      const metadata = baseMetadata(baseRowsByKey, key, group[0], sellersById);
      if (metadata.fallback) metadataFallbackRows += 1;
      matchedRows += 1;
      rowsByMonth.get(month).push(...cohorts.map((cohort) => ({
        ...metadata,
        ageDays: ageDaysForHistoricalMonth(month, cohort.month),
        cohortMonth: cohort.month,
        quantity: cohort.quantity,
      })));
    }
  }

  const rebuiltAt = nowText();
  return {
    entries: months.map((month) => ({
      month,
      data: {
        rows: rowsByMonth.get(month),
        sellers,
        rawCount: rowsByMonth.get(month).length,
        ledgerCount: records.filter((record) => monthText(record.date) === month).length,
        matchedRows,
        ownerSyncVersion: 4,
        reportStartDate: `${months[0]}-01`,
        reportEndDate: lastDayOfMonth(month),
        source: "amazon-inventory-ledger-raw",
        inventoryLedgerRebuiltAt: rebuiltAt,
      },
    })),
    summary: {
      recordCount: records.length,
      rowCount: [...rowsByMonth.values()].reduce((total, rows) => total + rows.length, 0),
      metadataFallbackRows,
      matchedRows,
    },
  };
}

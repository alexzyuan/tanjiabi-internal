import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";
import { listFbaShipmentVarianceFollowupsByKeys } from "./fbaShipmentVarianceFollowupStore.js";

const INTERNAL_SLA_MS = 7 * 24 * 60 * 60 * 1000;
const STAGE_DATE_LOOKBACK_DAYS = 180;

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function normalizedNow(value) {
  const now = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(now.valueOf())) throw new Error("货件收发差异读取失败：当前时间无效。");
  return now;
}

function normalizeSids(value) {
  return [...new Set(String(value || "").split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0))];
}

function normalizeFollowupStatus(value) {
  const status = firstText(value).toLowerCase();
  if (["", "pending", "followed-up", "followed", "overdue"].includes(status)) return status;
  throw new Error(`货件收发差异读取失败：不支持的跟进状态 ${status}。`);
}

export function normalizeFbaShipmentVarianceFilters(filters = {}, { now = new Date() } = {}) {
  const current = normalizedNow(now);
  const start = new Date(current);
  start.setDate(start.getDate() - 29);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const providedStartDate = firstText(filters.startDate, filters.start_date);
  const providedEndDate = firstText(filters.endDate, filters.end_date);

  return {
    startDate: datePattern.test(providedStartDate) ? providedStartDate : formatDate(start),
    endDate: datePattern.test(providedEndDate) ? providedEndDate : formatDate(current),
    sids: normalizeSids(filters.sids || filters.sid),
    shipmentId: firstText(filters.shipmentId, filters.shipment_id),
    shipmentStatus: firstText(filters.shipmentStatus, filters.shipment_status, "RECEIVING,CLOSED"),
    followupStatus: normalizeFollowupStatus(filters.followupStatus || filters.followup_status),
    offset: Math.max(0, Number(filters.offset || 0) || 0),
    length: Math.min(500, Math.max(1, Number(filters.length || 100) || 100)),
    forceRefresh: String(filters.forceRefresh || "").toLowerCase() === "true" || filters.forceRefresh === true,
  };
}

function formatDuration(milliseconds, prefix) {
  const wholeHours = Math.floor(Math.max(0, milliseconds) / (60 * 60 * 1000));
  return `${prefix} ${Math.floor(wholeHours / 24)} 天 ${wholeHours % 24} 小时`;
}

function buildSla({ shipmentStatus, differenceQuantity, closedAt, now }) {
  if (shipmentStatus !== "CLOSED" || differenceQuantity <= 0) {
    return { status: "not-applicable", deadlineAt: "", display: "—" };
  }

  const closedAtMs = Date.parse(closedAt);
  if (!closedAt || Number.isNaN(closedAtMs)) {
    return {
      status: "unavailable",
      deadlineAt: "",
      display: "缺少关闭时间，无法计算内部 SLA",
    };
  }

  const deadline = new Date(closedAtMs + INTERNAL_SLA_MS);
  const remainingMs = deadline.valueOf() - now.valueOf();
  if (remainingMs < 0) {
    return {
      status: "overdue",
      deadlineAt: deadline.toISOString(),
      display: formatDuration(-remainingMs, "已超时"),
    };
  }
  return {
    status: "active",
    deadlineAt: deadline.toISOString(),
    display: formatDuration(remainingMs, "还剩"),
  };
}

function investigationStatus(shipmentStatus, differenceQuantity) {
  if (shipmentStatus === "RECEIVING") return "收货中";
  if (shipmentStatus === "CLOSED") {
    if (differenceQuantity > 0) return "待调查";
    if (differenceQuantity < 0) return "多收";
    return "收发一致";
  }
  return shipmentStatus || "未知";
}

function itemTotals(items = []) {
  return (items || []).reduce((totals, item) => ({
    shippedQuantity: totals.shippedQuantity + numberValue(item?.shippedQuantity),
    receivedQuantity: totals.receivedQuantity + numberValue(item?.receivedQuantity),
  }), { shippedQuantity: 0, receivedQuantity: 0 });
}

function subtractDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.valueOf())) throw new Error(`货件收发差异读取失败：日期无效 ${dateText}。`);
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

function dateText(value) {
  const text = firstText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function stageDateForShipment(shipment = {}) {
  const status = firstText(shipment.shipmentStatus).toUpperCase();
  if (status === "RECEIVING") return firstText(shipment.receivingAt, shipment.raw?.receiving_time, shipment.raw?.receivingAt, shipment.createdAt);
  if (status === "CLOSED") return firstText(shipment.closedAt, shipment.raw?.closed_time, shipment.raw?.closedAt, shipment.createdAt);
  return firstText(shipment.createdAt);
}

function isWithinSelectedStageDate(shipment, filters) {
  const stageDate = dateText(stageDateForShipment(shipment));
  return Boolean(stageDate && stageDate >= filters.startDate && stageDate <= filters.endDate);
}

function shipmentKey(row = {}) {
  return `${Number(row.sid)}:${firstText(row.shipmentId)}`;
}

function normalizedFollowup(record) {
  return {
    followedUp: Boolean(record?.followedUp),
    status: firstText(record?.followupStatus),
    followedUpAt: firstText(record?.followedUpAt),
    followedUpBy: firstText(record?.followedUpBy),
    clearedAt: firstText(record?.clearedAt),
    clearedBy: firstText(record?.clearedBy),
  };
}

function buildRow(shipment, followups, now) {
  const totals = itemTotals(shipment.items);
  const shippedQuantity = totals.shippedQuantity || numberValue(shipment.shippedQuantity);
  const receivedQuantity = totals.receivedQuantity;
  const differenceQuantity = shippedQuantity - receivedQuantity;
  const shipmentStatus = firstText(shipment.shipmentStatus).toUpperCase();
  const closedAt = firstText(shipment.closedAt, shipment.raw?.closed_time, shipment.raw?.closedAt);
  const mskus = [...new Set((shipment.items || []).map((item) => firstText(item.msku)).filter(Boolean))].join("、");
  const sla = buildSla({ shipmentStatus, differenceQuantity, closedAt, now });
  const key = shipmentKey(shipment);

  return {
    ...shipment,
    shipmentStatus,
    closedAt,
    mskus,
    shippedQuantity,
    receivedQuantity,
    differenceQuantity,
    investigationStatus: investigationStatus(shipmentStatus, differenceQuantity),
    sla,
    followup: normalizedFollowup(followups.get(key)),
  };
}

function matchesFollowupFilter(row, followupStatus) {
  if (!followupStatus) return true;
  if (followupStatus === "pending") return row.investigationStatus === "待调查" && !row.followup.followedUp;
  if (followupStatus === "followed" || followupStatus === "followed-up") return row.followup.followedUp;
  return row.sla.status === "overdue";
}

function summarize(rows) {
  return rows.reduce((summary, row) => ({
    receiving: summary.receiving + Number(row.shipmentStatus === "RECEIVING"),
    closedShortage: summary.closedShortage + Number(row.investigationStatus === "待调查"),
    dueWithinSevenDays: summary.dueWithinSevenDays + Number(row.sla.status === "active"),
    overdue: summary.overdue + Number(row.sla.status === "overdue"),
  }), { receiving: 0, closedShortage: 0, dueWithinSevenDays: 0, overdue: 0 });
}

export async function getFbaShipmentVariances(filters = {}, {
  getCandidates = getFbaShipmentCandidates,
  listFollowups = listFbaShipmentVarianceFollowupsByKeys,
  now = new Date(),
} = {}) {
  const current = normalizedNow(now);
  const normalizedFilters = normalizeFbaShipmentVarianceFilters(filters, { now: current });
  const shipmentStatuses = new Set(normalizedFilters.shipmentStatus.split(",").map((status) => firstText(status).toUpperCase()).filter(Boolean));
  const sourceFilters = {
    ...normalizedFilters,
    startDate: subtractDays(normalizedFilters.startDate, STAGE_DATE_LOOKBACK_DAYS),
    shipmentStatus: "",
  };
  const candidateResult = await getCandidates(sourceFilters, { now: current.valueOf() });
  const candidateRows = (Array.isArray(candidateResult?.rows) ? candidateResult.rows : []).filter((row) =>
    (!shipmentStatuses.size || shipmentStatuses.has(firstText(row.shipmentStatus).toUpperCase()))
    && isWithinSelectedStageDate(row, normalizedFilters));
  const keys = candidateRows.map(shipmentKey).filter((key) => !key.startsWith("0:"));
  const followups = await listFollowups(keys);
  const allRows = candidateRows.map((shipment) => buildRow(shipment, followups, current));
  const rows = allRows.filter((row) => matchesFollowupFilter(row, normalizedFilters.followupStatus));
  const summary = summarize(allRows);

  console.info("[fba-shipment-variance] loaded", {
    shipmentCount: allRows.length,
    visibleCount: rows.length,
    closedShortage: summary.closedShortage,
    overdue: summary.overdue,
    statusCounts: allRows.reduce((counts, row) => {
      counts[row.shipmentStatus || "UNKNOWN"] = (counts[row.shipmentStatus || "UNKNOWN"] || 0) + 1;
      return counts;
    }, {}),
    sourceStartDate: sourceFilters.startDate,
    selectedStageDateRange: `${normalizedFilters.startDate}..${normalizedFilters.endDate}`,
  });

  return {
    ok: true,
    filters: normalizedFilters,
    rows,
    summary,
    fetchedAt: candidateResult?.fetchedAt || current.toISOString(),
    sourceRequestId: candidateResult?.sourceRequestId || "",
  };
}

export const fbaShipmentVarianceTestUtils = {
  buildSla,
  itemTotals,
};

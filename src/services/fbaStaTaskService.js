import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { requireFbaAddressProfile } from "../data/fbaAddressBook.js";
import { readJsonFileWithRecovery } from "../utils/jsonFile.js";
import { resolveCanonicalStaSeller, runSingleStaWarehouseProbe } from "./fbaStaService.js";
import { assertFbaMskuPackMatchesErp } from "./fbaCatalogService.js";
import { hasCompleteBoxSpec, normalizeBoxSpec, saveFbaBoxTemplate } from "./fbaBoxTemplateService.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const taskFile = path.join(appRoot, "data-cache", "fba-sta-tasks.json");
const legacyTaskFile = path.join(process.cwd(), "data-cache", "fba-sta-tasks.json");
const schedulerPollMs = 5 * 1000;
const defaultTaskIntervalMinutes = 20;
const taskIntervalOptions = [20, 30, 40, 50, 60];
const historyLimit = 60;
const scheduleTimeZone = "Asia/Shanghai";
const defaultDeliveryPreferences = {
  shipAfterDays: 10,
  deliveryAfterShipDays: 10,
  shipDate: "",
  deliveryDate: "",
  shippingMode: "FREIGHT_LTL",
  shippingSolution: "USE_YOUR_OWN_CARRIER",
  transportationKeyword: "海运",
};
const supportedShippingModes = new Set([
  "GROUND_SMALL_PARCEL",
  "FREIGHT_LTL",
]);

const defaultWarehouses = [
  "ONT8", "GYR2", "SBD1", "SCK4", "SMF3", "LGB8", "FTW1", "CLT2", "ABE8", "IND9", "MDW2", "MEM1", "BNA3", "TEB9",
  "YYZ4", "YYZ9", "YOW1", "YVR4", "YEG2", "YYC1",
];

let schedulerStarted = false;
const runningTaskIds = new Set();
const queuedTaskIds = new Set();
const taskRunMeta = new Map();
let taskRunQueue = Promise.resolve();
let stateUpdateQueue = Promise.resolve();

function defaultState() {
  return {
    automation: {
      enabled: false,
      startDay: 1,
      endDay: 5,
      workdays: [1, 2, 3, 4, 5],
      startHour: 8,
      endHour: 19,
      scheduleIntervalMinutes: 30,
      taskIntervalMinutes: defaultTaskIntervalMinutes,
      notificationEnabled: true,
      timezone: "Asia/Shanghai",
      updatedAt: "",
    },
    tasks: [],
    history: [],
    warehouses: defaultWarehouses,
  };
}

function toIso(value = Date.now()) {
  return new Date(value).toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getScheduleTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: scheduleTimeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(values.year),
    month: Number(values.month),
    dayOfMonth: Number(values.day),
    dayOfWeek: weekdayMap[values.weekday] ?? 0,
    hour: Number(values.hour),
  };
}

function scheduleDateText(date = new Date()) {
  const parts = getScheduleTimeParts(date);
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.dayOfMonth).padStart(2, "0"),
  ].join("-");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeInterval(value, fallback = defaultTaskIntervalMinutes) {
  const number = Number(value);
  return taskIntervalOptions.includes(number) ? number : fallback;
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeDeliveryPreferences(value = {}) {
  const shippingMode = String(value.shippingMode || defaultDeliveryPreferences.shippingMode).trim().toUpperCase();
  const shippingSolution = String(value.shippingSolution || defaultDeliveryPreferences.shippingSolution).trim().toUpperCase();
  const transportationKeyword = String(value.transportationKeyword || defaultDeliveryPreferences.transportationKeyword).trim();
  const shipDate = normalizeDateText(value.shipDate || value.shipingTime || value.shippingDate);
  const deliveryDate = normalizeDateText(value.deliveryDate || value.desiredDeliveryDate || value.arrivalDate);
  const deliveryAfterShipDays = clampNumber(value.deliveryAfterShipDays, defaultDeliveryPreferences.deliveryAfterShipDays, 1, 180);
  const normalizedShippingMode = shippingMode === "GROUND_SMALL_PARCEL" ? "GROUND_SMALL_PARCEL" : "FREIGHT_LTL";
  return {
    shipAfterDays: clampNumber(value.shipAfterDays, defaultDeliveryPreferences.shipAfterDays, 1, 180),
    deliveryAfterShipDays: !deliveryDate && deliveryAfterShipDays === 40 ? defaultDeliveryPreferences.deliveryAfterShipDays : deliveryAfterShipDays,
    shipDate,
    deliveryDate,
    shippingMode: supportedShippingModes.has(normalizedShippingMode) ? normalizedShippingMode : defaultDeliveryPreferences.shippingMode,
    shippingSolution: ["USE_YOUR_OWN_CARRIER", "AMAZON_PARTNERED_CARRIER"].includes(shippingSolution) ? shippingSolution : defaultDeliveryPreferences.shippingSolution,
    transportationKeyword,
  };
}

function isSeaTransportPreference(keyword) {
  const text = String(keyword || "").trim().toLowerCase();
  return ["海运", "海", "sea", "ocean", "ocean freight", "by sea"].includes(text);
}

function dayRange(startDay, endDay) {
  const start = clampNumber(startDay, 1, 0, 6);
  const end = clampNumber(endDay, 5, 0, 6);
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const day = (start + index) % 7;
    days.push(day);
    if (day === end) break;
  }
  return days;
}

async function readState() {
  try {
    const parsed = await readJsonFileWithRecovery(taskFile);
    const state = { ...defaultState(), ...parsed };
    state.automation = { ...defaultState().automation, ...(parsed.automation || {}) };
    state.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    state.history = Array.isArray(parsed.history)
      ? parsed.history.slice(0, historyLimit)
      : [];
    state.warehouses = Array.from(new Set([...(parsed.warehouses || []), ...defaultWarehouses].map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)));
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      if (legacyTaskFile !== taskFile) {
        try {
          const parsed = await readJsonFileWithRecovery(legacyTaskFile);
          await writeState(parsed);
          return readState();
        } catch (legacyError) {
          if (legacyError.code !== "ENOENT") throw legacyError;
        }
      }
      return defaultState();
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(taskFile), { recursive: true });
  const tempFile = `${taskFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempFile, taskFile);
}

async function updateState(mutator) {
  const run = async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return result === undefined ? state : result;
  };
  const next = stateUpdateQueue.then(run, run);
  stateUpdateQueue = next.catch(() => {});
  return next;
}

function publicSchedulerState(state) {
  const taskMap = new Map((state.tasks || []).map((task) => [task.id, task]));
  const queue = [
    ...Array.from(runningTaskIds).map((id) => ({ id, queueStatus: "running" })),
    ...Array.from(queuedTaskIds).filter((id) => !runningTaskIds.has(id)).map((id) => ({ id, queueStatus: "queued" })),
  ].map(({ id, queueStatus }) => {
    const task = taskMap.get(id) || {};
    const meta = taskRunMeta.get(id) || {};
    return {
      id,
      queueStatus,
      trigger: meta.trigger || "",
      operator: meta.operator || task.operator || "系统",
      queuedAt: meta.queuedAt || "",
      startedAt: meta.startedAt || "",
      shopName: task.shop?.name || "",
      displayName: task.shop?.displayName || task.shop?.name || "",
      country: task.shop?.country || "",
      msku: task.msku || "",
      targetWarehouseCode: task.targetWarehouseCode || "",
      status: task.status || "",
      progress: queueStatus === "running" ? (task.lastStatus || "运行中") : "排队等待运行",
    };
  });
  return {
    ...state,
    scheduler: {
      started: schedulerStarted,
      runningTaskIds: Array.from(runningTaskIds),
      queuedTaskIds: Array.from(queuedTaskIds),
      queue,
      pollSeconds: schedulerPollMs / 1000,
    },
  };
}

function normalizeAutomation(payload = {}, current = defaultState().automation) {
  const startDay = clampNumber(payload.startDay, current.startDay ?? 1, 0, 6);
  const endDay = clampNumber(payload.endDay, current.endDay ?? 5, 0, 6);
  return {
    ...current,
    enabled: payload.enabled === undefined ? current.enabled : payload.enabled === true,
    startDay,
    endDay,
    workdays: dayRange(startDay, endDay),
    startHour: clampNumber(payload.startHour, current.startHour, 0, 23),
    endHour: clampNumber(payload.endHour, current.endHour, 1, 24),
    scheduleIntervalMinutes: clampNumber(payload.scheduleIntervalMinutes, current.scheduleIntervalMinutes, 5, 180),
    taskIntervalMinutes: normalizeInterval(payload.taskIntervalMinutes, current.taskIntervalMinutes || defaultTaskIntervalMinutes),
    notificationEnabled: payload.notificationEnabled === undefined ? current.notificationEnabled !== false : payload.notificationEnabled === true,
    timezone: scheduleTimeZone,
    updatedAt: toIso(),
  };
}

function isWithinAutomationWindow(automation, date = new Date()) {
  const parts = getScheduleTimeParts(date);
  return automation.enabled
    && automation.workdays.includes(parts.dayOfWeek)
    && parts.hour >= Number(automation.startHour)
    && parts.hour < Number(automation.endHour);
}

function isWithinTaskWindow(task, date = new Date()) {
  if (Number(task.runCount || 0) === 0) return true;
  if (task.scheduleEnabled === false) return true;
  const today = scheduleDateText(date);
  if (task.activeStartDate && today < task.activeStartDate) return false;
  if (task.activeEndDate && today > task.activeEndDate) return false;
  const workdays = Array.isArray(task.workdays) && task.workdays.length
    ? task.workdays
    : dayRange(task.startDay ?? 1, task.endDay ?? 5);
  const parts = getScheduleTimeParts(date);
  return workdays.includes(parts.dayOfWeek)
    && parts.hour >= Number(task.startHour ?? 8)
    && parts.hour < Number(task.endHour ?? 19);
}

function validateTaskScheduleDates(payload = {}, date = new Date()) {
  if (payload.scheduleEnabled !== true) return;
  const activeEndDate = normalizeDateText(payload.activeEndDate);
  if (!activeEndDate) return;
  const today = scheduleDateText(date);
  if (activeEndDate < today) {
    throw new Error(`结束日期不能早于当前日期 ${today}，请修改结束日期。`);
  }
}

export async function normalizeFbaStaTaskShop(input, options = {}) {
  const seller = await resolveCanonicalStaSeller(input, options);
  return {
    sid: seller.sid,
    name: seller.name,
    displayName: seller.displayName,
    country: seller.country,
    legalSenderKey: seller.legalSenderKey,
  };
}

async function normalizeTaskInput(payload, shopInput, automation) {
  validateTaskScheduleDates(payload);
  const shop = await normalizeFbaStaTaskShop(shopInput);
  const targetWarehouseCode = String(payload.targetWarehouseCode || "").trim().toUpperCase();
  const msku = String(payload.msku || payload.inboundPlanItems?.[0]?.msku || "").trim();
  const quantity = Number(payload.quantity || payload.inboundPlanItems?.[0]?.quantity || 0);
  const boxCount = Number(payload.boxCount || 0);
  const packQuantity = Number(payload.packQuantity || 0);
  const planName = String(payload.planName || "").trim();
  if (!targetWarehouseCode) throw new Error("确认新建时必须填写目标 FBA 仓库代码。");
  if (!planName) throw new Error("FBA货件名不能为空。");
  if (Array.from(planName).length > 35) throw new Error("FBA货件名最多 35 个字符。");
  if (!msku) throw new Error("MSKU 不能为空。");
  if (!boxCount || boxCount <= 0) throw new Error("箱数必须大于 0。");
  const erpMatch = await assertFbaMskuPackMatchesErp({
    sid: shop.sid,
    msku,
    packQuantity,
    boxCount,
    quantity,
  });
  if (!Number.isFinite(erpMatch.quantity) || erpMatch.quantity <= 0) throw new Error("数量必须大于 0。");
  const boxSpec = hasCompleteBoxSpec({ dimensions: erpMatch.boxDimensions, weight: erpMatch.boxWeight })
    ? { dimensions: erpMatch.boxDimensions, weight: erpMatch.boxWeight }
    : normalizeBoxSpec(payload);
  if (String(payload.positionType || "1") === "1" && !hasCompleteBoxSpec(boxSpec)) {
    throw new Error("先装箱再分仓需要外箱规格：ERP 产品管理未返回外箱长、外箱宽、外箱高、外箱实重，请手填后系统会按店铺+MSKU保存为模板。");
  }
  if (hasCompleteBoxSpec(boxSpec) && erpMatch.boxSource !== "erp") {
    await saveFbaBoxTemplate({
      sid: shop.sid,
      msku: erpMatch.erpItem.msku,
      boxDimensions: boxSpec.dimensions,
      boxWeight: boxSpec.weight,
      source: erpMatch.boxSource === "template" ? "template" : "manual",
    });
  }
  const runIntervalMinutes = normalizeInterval(payload.runIntervalMinutes, automation.taskIntervalMinutes || defaultTaskIntervalMinutes);
  const startDay = clampNumber(payload.startDay, automation.startDay ?? 1, 0, 6);
  const endDay = clampNumber(payload.endDay, automation.endDay ?? 5, 0, 6);

  return {
    id: randomUUID(),
    enabled: payload.enabled !== false,
    status: "pending",
    shop,
    targetWarehouseCode,
    msku: erpMatch.erpItem.msku,
    quantity: erpMatch.quantity,
    boxCount,
    packQuantity: erpMatch.packQuantity,
    boxDimensions: boxSpec.dimensions,
    boxWeight: boxSpec.weight,
    boxSource: erpMatch.boxSource || "manual",
    deliveryPreferences: normalizeDeliveryPreferences(payload.deliveryPreferences || payload.delivery || payload),
    positionType: String(payload.positionType || "1"),
    planName,
    scheduleEnabled: payload.scheduleEnabled === true,
    notificationEnabled: payload.notificationPolicy === "none" ? false : (payload.notificationEnabled === undefined ? true : payload.notificationEnabled === true),
    notificationPolicy: ["all", "none"].includes(payload.notificationPolicy) ? payload.notificationPolicy : "matched",
    scheduleMode: payload.scheduleMode || "week",
    activeStartDate: normalizeDateText(payload.activeStartDate),
    activeEndDate: normalizeDateText(payload.activeEndDate),
    startDay,
    endDay,
    workdays: dayRange(startDay, endDay),
    startHour: clampNumber(payload.startHour, automation.startHour ?? 8, 0, 23),
    endHour: clampNumber(payload.endHour, automation.endHour ?? 19, 1, 24),
    runIntervalMinutes,
    nextRunAt: toIso(new Date(Date.now() + 5000)),
    runCount: 0,
    operator: String(payload.operator || "系统").trim() || "系统",
    matchedCount: 0,
    lastRunAt: "",
    lastStatus: "等待运行",
    lastWarehouseCodes: [],
    lastInboundPlanId: "",
    lastShipmentIds: [],
    createdAt: toIso(),
    updatedAt: toIso(),
  };
}

function buildTaskProbePayload(task) {
  const profile = requireFbaAddressProfile(task.shop.name || task.shop.sid, { context: "FBA STA 定时任务" });
  return {
    sid: task.shop.sid,
    shopName: task.shop.name,
    useBrandAddress: true,
    ...profile,
    planName: task.planName,
    positionType: task.positionType || "1",
    remark: "探嘉BI自动刷仓：命中目标仓后自动确认货件方案，未命中自动取消。",
    targetWarehouseCode: task.targetWarehouseCode,
    boxCount: task.boxCount,
    packQuantity: task.packQuantity,
    boxDimensions: task.boxDimensions,
    boxWeight: task.boxWeight,
    deliveryPreferences: normalizeDeliveryPreferences(task.deliveryPreferences || task.delivery || task),
    cancelAfterPreview: true,
    confirmOnTargetMatch: true,
    notificationEnabled: task.notificationPolicy === "none" ? false : task.notificationEnabled !== false,
    notificationPolicy: ["all", "none"].includes(task.notificationPolicy) ? task.notificationPolicy : "matched",
    inboundPlanItems: [
      {
        labelOwner: "SELLER",
        msku: task.msku,
        prepOwner: "SELLER",
        quantity: task.quantity,
      },
    ],
  };
}

function extractDisplayWarehouses(result) {
  return result?.displayWarehouses?.length
    ? result.displayWarehouses
    : (result?.selectedWarehouses?.length ? result.selectedWarehouses : result?.warehouses || []).slice(0, 1);
}

function extractWarehouseCodes(result) {
  const warehouses = extractDisplayWarehouses(result);
  return Array.from(new Set(warehouses.map((item) => String(item.wareHouseId || "").trim().toUpperCase()).filter(Boolean)));
}

function formatActualWarehouseText(result) {
  const warehouses = extractDisplayWarehouses(result);
  return Array.from(new Set(warehouses.map((item) => [item.wareHouseId, item.regionLabel].filter(Boolean).join("，")).filter(Boolean))).join(", ");
}

async function persistTaskRun(taskId, runResult, error = null, operator = "") {
  return updateState((state) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return null;

    const now = new Date();
    const matched = Boolean(runResult?.targetMatched && runResult?.confirmed);
    const warehouseCodes = error ? task.lastWarehouseCodes || [] : extractWarehouseCodes(runResult);
    const shouldContinue = !matched && !error && task.scheduleEnabled === true;
    task.runCount = Number(task.runCount || 0) + 1;
    task.lastRunAt = toIso(now);
    task.updatedAt = toIso(now);
    task.lastWarehouseCodes = warehouseCodes;
    task.lastInboundPlanId = runResult?.inboundPlanId || task.lastInboundPlanId || "";
    const selectedShipments = matched && runResult?.selectedWarehouses?.length ? runResult.selectedWarehouses : [];
    task.lastShipmentIds = selectedShipments.map((item) => item.shipmentId).filter(Boolean);
    task.status = error ? "failed" : (matched ? "matched_confirmed" : "warehouse_mismatch");
    task.lastStatus = error
      ? `运行失败：${error.message}`
	      : (matched
		          ? "已命中目标仓并确认货件方案"
	          : `未命中目标仓，实际仓：${formatActualWarehouseText(runResult) || "-"}`);
    task.enabled = matched || (!shouldContinue && !error) ? false : task.enabled;
    task.matchedCount = Number(task.matchedCount || 0) + (matched ? 1 : 0);
    task.nextRunAt = task.enabled ? toIso(addMinutes(now, task.runIntervalMinutes || defaultTaskIntervalMinutes)) : "";

    const historyOperator = String(operator || task.operator || "系统自动").trim() || "系统自动";
    state.history.unshift({
      id: randomUUID(),
      taskId,
      taskName: `${task.shop.displayName} ${task.msku}`,
      status: task.status,
      message: task.lastStatus,
      country: task.shop.country || "",
      shopName: task.shop.name || "",
      displayName: task.shop.displayName || task.shop.name || "",
      msku: task.msku,
      operator: historyOperator,
      targetWarehouseCode: task.targetWarehouseCode,
      warehouseCodes,
      actualWarehouseCode: warehouseCodes[0] || "",
      inboundPlanId: task.lastInboundPlanId,
	      shipmentIds: task.lastShipmentIds,
	      shipmentNames: matched ? [task.planName].filter(Boolean) : [],
	      quantity: task.quantity,
	      boxCount: task.boxCount || 0,
	      packQuantity: task.packQuantity || 0,
	      actualWarehouseRegion: extractDisplayWarehouses(runResult)[0]?.regionLabel || "",
	      ranAt: task.lastRunAt,
      error: error?.message || "",
    });
    state.history = state.history.slice(0, historyLimit);
    state.warehouses = Array.from(new Set([...(state.warehouses || []), ...warehouseCodes, task.targetWarehouseCode].filter(Boolean)));
    return task;
  });
}

export async function getFbaStaAutomationState() {
  return publicSchedulerState(await readState());
}

export async function updateFbaStaAutomation(payload) {
  return updateState((state) => {
    state.automation = normalizeAutomation(payload, state.automation);
    return publicSchedulerState(state);
  });
}

export async function createFbaStaTasks(payload = {}) {
  return updateState(async (state) => {
    const shops = [payload.shop || { sid: payload.sid, name: payload.shopName, displayName: payload.displayName }];
    const tasks = await Promise.all(shops.map((shop) => normalizeTaskInput(payload, shop, state.automation)));
    state.tasks.unshift(...tasks);
    state.warehouses = Array.from(new Set([...(state.warehouses || []), ...tasks.map((task) => task.targetWarehouseCode)].filter(Boolean)));
    return { ok: true, tasks, state: publicSchedulerState(state) };
  });
}

function hasTaskConfigPayload(payload = {}) {
  return [
    "shop", "sid", "shopName", "targetWarehouseCode", "msku", "inboundPlanItems", "planName",
    "boxCount", "packQuantity", "quantity", "boxDimensions", "boxWeight", "deliveryPreferences", "shipAfterDays",
    "deliveryAfterShipDays", "shippingMode", "shippingSolution", "transportationKeyword", "positionType", "scheduleEnabled",
    "notificationEnabled", "notificationPolicy", "activeStartDate", "activeEndDate",
    "startHour", "endHour", "runIntervalMinutes",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function mergeTaskEditPayload(task, payload = {}) {
  return {
    ...payload,
    targetWarehouseCode: payload.targetWarehouseCode ?? task.targetWarehouseCode,
    msku: payload.msku ?? payload.inboundPlanItems?.[0]?.msku ?? task.msku,
    quantity: payload.quantity ?? payload.inboundPlanItems?.[0]?.quantity ?? task.quantity,
    boxCount: payload.boxCount ?? task.boxCount,
    packQuantity: payload.packQuantity ?? task.packQuantity,
    boxDimensions: payload.boxDimensions ?? task.boxDimensions,
    boxWeight: payload.boxWeight ?? task.boxWeight,
    deliveryPreferences: payload.deliveryPreferences ?? task.deliveryPreferences,
    positionType: payload.positionType ?? task.positionType,
    planName: payload.planName ?? task.planName,
    scheduleEnabled: payload.scheduleEnabled ?? task.scheduleEnabled,
    notificationEnabled: payload.notificationEnabled ?? task.notificationEnabled,
    notificationPolicy: payload.notificationPolicy ?? task.notificationPolicy,
    activeStartDate: payload.activeStartDate ?? task.activeStartDate,
    activeEndDate: payload.activeEndDate ?? task.activeEndDate,
    startDay: payload.startDay ?? task.startDay,
    endDay: payload.endDay ?? task.endDay,
    startHour: payload.startHour ?? task.startHour,
    endHour: payload.endHour ?? task.endHour,
    runIntervalMinutes: payload.runIntervalMinutes ?? task.runIntervalMinutes,
  };
}

export async function updateFbaStaTask(id, payload = {}) {
  return updateState(async (state) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new Error("刷仓任务不存在。");
    if (hasTaskConfigPayload(payload)) {
      const normalized = await normalizeTaskInput(
        mergeTaskEditPayload(task, payload),
        payload.shop || { sid: payload.sid || task.shop?.sid, name: payload.shopName || task.shop?.name, displayName: payload.displayName || task.shop?.displayName },
        state.automation,
      );
      Object.assign(task, {
        shop: normalized.shop,
        targetWarehouseCode: normalized.targetWarehouseCode,
        msku: normalized.msku,
        quantity: normalized.quantity,
        boxCount: normalized.boxCount,
        packQuantity: normalized.packQuantity,
        boxDimensions: normalized.boxDimensions,
        boxWeight: normalized.boxWeight,
        boxSource: normalized.boxSource,
        deliveryPreferences: normalized.deliveryPreferences,
        positionType: normalized.positionType,
        planName: normalized.planName,
        scheduleEnabled: normalized.scheduleEnabled,
        notificationEnabled: normalized.notificationEnabled,
        notificationPolicy: normalized.notificationPolicy,
        scheduleMode: normalized.scheduleMode,
        activeStartDate: normalized.activeStartDate,
        activeEndDate: normalized.activeEndDate,
        startDay: normalized.startDay,
        endDay: normalized.endDay,
        workdays: normalized.workdays,
        startHour: normalized.startHour,
        endHour: normalized.endHour,
        runIntervalMinutes: normalized.runIntervalMinutes,
        enabled: payload.enabled === undefined ? task.enabled : payload.enabled === true,
        status: payload.enabled === false ? "paused" : "pending",
        lastStatus: "任务配置已更新",
        updatedAt: toIso(),
      });
      if (payload.nextRunAt !== undefined) task.nextRunAt = payload.nextRunAt || toIso();
      return { ok: true, task, state: publicSchedulerState(state) };
    }
    if (payload.enabled !== undefined) task.enabled = payload.enabled === true;
    if (payload.targetWarehouseCode !== undefined) task.targetWarehouseCode = String(payload.targetWarehouseCode || "").trim().toUpperCase();
    if (payload.quantity !== undefined) task.quantity = Number(payload.quantity || 0);
    if (payload.boxCount !== undefined) task.boxCount = Number(payload.boxCount || 0);
    if (payload.packQuantity !== undefined) task.packQuantity = Number(payload.packQuantity || 0);
    if (payload.runIntervalMinutes !== undefined) task.runIntervalMinutes = normalizeInterval(payload.runIntervalMinutes, task.runIntervalMinutes);
    if (payload.scheduleEnabled !== undefined) task.scheduleEnabled = payload.scheduleEnabled === true;
    if (payload.notificationEnabled !== undefined) task.notificationEnabled = payload.notificationEnabled === true;
    if (payload.notificationPolicy !== undefined) {
      task.notificationPolicy = ["all", "none"].includes(payload.notificationPolicy) ? payload.notificationPolicy : "matched";
      if (task.notificationPolicy === "none") task.notificationEnabled = false;
    }
    if (payload.scheduleMode !== undefined) task.scheduleMode = payload.scheduleMode || task.scheduleMode || "week";
    if (payload.activeStartDate !== undefined) task.activeStartDate = normalizeDateText(payload.activeStartDate);
    if (payload.activeEndDate !== undefined) task.activeEndDate = normalizeDateText(payload.activeEndDate);
    if (payload.startDay !== undefined || payload.endDay !== undefined) {
      task.startDay = clampNumber(payload.startDay, task.startDay ?? 1, 0, 6);
      task.endDay = clampNumber(payload.endDay, task.endDay ?? 5, 0, 6);
      task.workdays = dayRange(task.startDay, task.endDay);
    }
    if (payload.startHour !== undefined) task.startHour = clampNumber(payload.startHour, task.startHour ?? 8, 0, 23);
    if (payload.endHour !== undefined) task.endHour = clampNumber(payload.endHour, task.endHour ?? 19, 1, 24);
    if (payload.nextRunAt !== undefined) task.nextRunAt = payload.nextRunAt || toIso();
    validateTaskScheduleDates(task);
    task.status = task.enabled ? "pending" : "paused";
    task.updatedAt = toIso();
    return { ok: true, task, state: publicSchedulerState(state) };
  });
}

export async function deleteFbaStaTask(id) {
  return updateState((state) => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((task) => task.id !== id);
    if (state.tasks.length === before) throw new Error("刷仓任务不存在。");
    return { ok: true, state: publicSchedulerState(state) };
  });
}

export async function runFbaStaTaskNow(id, trigger = "manual", operator = "") {
  if (runningTaskIds.has(id) || queuedTaskIds.has(id)) {
    return { ok: false, skipped: true, message: "任务正在运行或排队中，请稍后查看结果。" };
  }

  queuedTaskIds.add(id);
  taskRunMeta.set(id, {
    trigger,
    operator: String(operator || "").trim(),
    queuedAt: toIso(),
    startedAt: "",
  });
  await updateState((draft) => {
    const current = draft.tasks.find((item) => item.id === id);
    if (current) {
      current.status = "running";
      current.lastStatus = "排队等待运行";
      current.updatedAt = toIso();
    }
  });
  const queuedRun = taskRunQueue.then(() => runFbaStaTaskNowDirect(id, trigger, operator));
  taskRunQueue = queuedRun.catch(() => {});
  try {
    return await queuedRun;
  } finally {
    queuedTaskIds.delete(id);
    if (!runningTaskIds.has(id)) taskRunMeta.delete(id);
  }
}

async function runFbaStaTaskNowDirect(id, trigger = "manual", operator = "") {
  const state = await readState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error("刷仓任务不存在。");
  if (!task.enabled && trigger !== "manual") return { ok: false, skipped: true, message: "任务已暂停。" };

  runningTaskIds.add(id);
  const meta = taskRunMeta.get(id) || {};
  taskRunMeta.set(id, {
    ...meta,
    trigger,
    operator: String(operator || meta.operator || "").trim(),
    queuedAt: meta.queuedAt || toIso(),
    startedAt: toIso(),
  });
  await updateState((draft) => {
    const current = draft.tasks.find((item) => item.id === id);
    if (current) {
      current.status = "running";
      current.lastStatus = trigger === "manual" ? "手动运行中" : "自动运行中";
      current.updatedAt = toIso();
    }
  });

  try {
    await assertFbaMskuPackMatchesErp({
      sid: task.shop.sid,
      msku: task.msku,
      packQuantity: task.packQuantity,
      boxCount: task.boxCount,
      quantity: task.quantity,
    });
    const result = await runSingleStaWarehouseProbe(buildTaskProbePayload(task));
    const updatedTask = await persistTaskRun(id, result, null, operator || (trigger === "manual" ? "手动运行" : task.operator || "系统自动"));
    return { ok: true, task: updatedTask, result };
  } catch (error) {
    const updatedTask = await persistTaskRun(id, null, error, operator || (trigger === "manual" ? "手动运行" : task.operator || "系统自动"));
    return { ok: false, task: updatedTask, error: error.message, details: error.details || null, steps: error.steps || [] };
  } finally {
    runningTaskIds.delete(id);
    taskRunMeta.delete(id);
  }
}

async function runDueTasks() {
  const state = await readState();
  const now = new Date();

  const dueTasks = state.tasks.filter((task) =>
    task.enabled
    && !runningTaskIds.has(task.id)
    && !queuedTaskIds.has(task.id)
    && isWithinTaskWindow(task, now)
    && (!task.nextRunAt || new Date(task.nextRunAt).getTime() <= now.getTime()),
  );

  for (const task of dueTasks) {
    runFbaStaTaskNow(task.id, "scheduler").catch((error) => {
      console.error("FBA STA scheduled task failed:", error);
    });
  }
}

export function startFbaStaScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => {
    runDueTasks().catch((error) => {
      console.error("FBA STA scheduler tick failed:", error);
    });
  }, schedulerPollMs);
}

export const fbaStaTaskTestUtils = {
  validateTaskScheduleDates,
};

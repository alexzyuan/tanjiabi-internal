import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { findLingxingShop } from "../data/lingxingShopMap.js";
import { getFbaAddressProfile } from "../data/fbaAddressBook.js";
import { sendFbaDingTalkText } from "./dingtalkService.js";
import { assertFbaMskuPackMatchesErp } from "./fbaCatalogService.js";
import { hasCompleteBoxSpec, saveFbaBoxTemplate } from "./fbaBoxTemplateService.js";

const terminalStatuses = new Set(["success", "failure", "local_failure"]);
const FBA_PROBE_VERSION = "2026-05-18-delivery-dates-transport-lock";
const MAX_STA_PLAN_NAME_LENGTH = 40;
const DEFAULT_BOX_DIMENSIONS = {
  height: 0,
  length: 0,
  width: 0,
  unitOfMeasurement: "CM",
};
const DEFAULT_BOX_WEIGHT = {
  value: 0,
  unit: "KG",
};
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireText(payload, key) {
  const value = String(payload[key] || "").trim();
  if (!value) throw new Error(`${key} 不能为空`);
  return value;
}

function compactPlanName(value, fallback) {
  const text = String(value || fallback || "").trim().replace(/\s+/g, "-");
  const chars = Array.from(text);
  if (chars.length <= MAX_STA_PLAN_NAME_LENGTH) return text;
  return chars.slice(0, MAX_STA_PLAN_NAME_LENGTH).join("");
}

function normalizePlanName(payload) {
  const value = String(payload.planName || "").trim();
  if (!value) throw new Error("FBA货件名不能为空。");
  if (Array.from(value).length > 35) throw new Error("FBA货件名最多 35 个字符。");
  return compactPlanName(value, "");
}

function normalizeStaPayload(payload) {
  const shop = findLingxingShop(payload.shopName || payload.sid);
  const sid = Number(payload.sid || shop?.sid);
  if (!sid) throw new Error("sid 不能为空，请选择领星店铺或传入 sid。");
  const profile = getFbaAddressProfile(shop?.name || payload.shopName);
  const address = payload.useBrandAddress === false ? payload : profile;
  const planName = normalizePlanName(payload);

  return {
    sid,
    name: planName,
    shopName: shop?.name || payload.shopName || String(sid),
    displayName: shop?.displayName || payload.shopName || String(sid),
    shipperName: requireText(address, "shipperName"),
    addressLine1: requireText(address, "addressLine1"),
    addressLine2: address.addressLine2 || "",
    city: requireText(address, "city"),
    companyName: address.companyName || "",
    countryCode: requireText(address, "countryCode"),
    email: address.email || "",
    phoneNumber: requireText(address, "phoneNumber"),
    planName,
    positionType: String(payload.positionType || "1"),
    postalCode: requireText(address, "postalCode"),
    remark: payload.remark || "探嘉BI目标仓测试",
    stateOrProvinceCode: requireText(address, "stateOrProvinceCode"),
    targetWarehouseCode: String(payload.targetWarehouseCode || "").trim(),
    boxCount: Number(payload.boxCount || 0),
    packQuantity: Number(payload.packQuantity || 0),
    boxDimensions: normalizeBoxDimensions(payload.boxDimensions || payload.dimensions),
    boxWeight: normalizeBoxWeight(payload.boxWeight || payload.weight),
    deliveryPreferences: normalizeDeliveryPreferences(payload.deliveryPreferences || payload.delivery || payload),
    cancelAfterPreview: payload.cancelAfterPreview !== false,
    confirmOnTargetMatch: payload.confirmOnTargetMatch === true,
    notificationEnabled: payload.notificationPolicy === "none" ? false : payload.notificationEnabled !== false,
    notificationPolicy: ["all", "none"].includes(payload.notificationPolicy) ? payload.notificationPolicy : "matched",
    inboundPlanItems: normalizeItems(payload.inboundPlanItems),
  };
}

function normalizeDeliveryPreferences(value = {}) {
  const shippingMode = String(value.shippingMode || defaultDeliveryPreferences.shippingMode).trim().toUpperCase();
  const shippingSolution = String(value.shippingSolution || defaultDeliveryPreferences.shippingSolution).trim().toUpperCase();
  const transportationKeyword = String(value.transportationKeyword || defaultDeliveryPreferences.transportationKeyword).trim();
  const shipDate = normalizeDateText(value.shipDate || value.shipingTime || value.shippingDate);
  const deliveryDate = normalizeDateText(value.deliveryDate || value.desiredDeliveryDate || value.arrivalDate);
  const deliveryAfterShipDays = positiveNumber(value.deliveryAfterShipDays, defaultDeliveryPreferences.deliveryAfterShipDays);
  const normalizedShippingMode = shippingMode === "GROUND_SMALL_PARCEL" ? "GROUND_SMALL_PARCEL" : "FREIGHT_LTL";
  return {
    shipAfterDays: positiveNumber(value.shipAfterDays, defaultDeliveryPreferences.shipAfterDays),
    deliveryAfterShipDays: !deliveryDate && deliveryAfterShipDays === 40 ? defaultDeliveryPreferences.deliveryAfterShipDays : deliveryAfterShipDays,
    shipDate,
    deliveryDate,
    shippingMode: supportedShippingModes.has(normalizedShippingMode) ? normalizedShippingMode : defaultDeliveryPreferences.shippingMode,
    shippingSolution: ["USE_YOUR_OWN_CARRIER", "AMAZON_PARTNERED_CARRIER"].includes(shippingSolution) ? shippingSolution : defaultDeliveryPreferences.shippingSolution,
    transportationKeyword,
  };
}

function normalizeDateText(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeBoxDimensions(value = {}) {
  return {
    height: positiveNumber(value.height, DEFAULT_BOX_DIMENSIONS.height),
    length: positiveNumber(value.length, DEFAULT_BOX_DIMENSIONS.length),
    width: positiveNumber(value.width, DEFAULT_BOX_DIMENSIONS.width),
    unitOfMeasurement: String(value.unitOfMeasurement || value.unit || DEFAULT_BOX_DIMENSIONS.unitOfMeasurement).trim().toUpperCase() || "CM",
  };
}

function normalizeBoxWeight(value = {}) {
  return {
    value: positiveNumber(value.value ?? value.weight, DEFAULT_BOX_WEIGHT.value),
    unit: String(value.unit || DEFAULT_BOX_WEIGHT.unit).trim().toUpperCase() || "KG",
  };
}

function createStepError(step, message, details, steps) {
  const error = new Error(message);
  error.step = step;
  error.details = details || null;
  error.steps = steps;
  return error;
}

async function runStep(steps, step, label, action) {
  const record = {
    step,
    label,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  steps.push(record);

  try {
    const result = await action();
    record.status = "success";
    record.finishedAt = new Date().toISOString();
    return result;
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.error = error.message;
    throw createStepError(step, `${label}失败：${error.message}`, error.details, steps);
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("inboundPlanItems 至少需要 1 个商品。");
  }

  return items.map((item) => ({
    expiration: item.expiration || undefined,
    labelOwner: item.labelOwner || "SELLER",
    msku: requireText(item, "msku"),
    prepOwner: item.prepOwner || "SELLER",
    quantity: Number(item.quantity || 0),
  })).map((item) => {
    if (!item.quantity || item.quantity <= 0) throw new Error(`${item.msku} 的 quantity 必须大于 0`);
    return item;
  });
}

async function waitStaTask(adapter, taskId, label, { attempts = 8, intervalMs = 5000 } = {}) {
  if (!taskId) throw new Error(`${label}缺少 taskId，无法查询任务状态。`);
  let lastPayload = null;
  for (let index = 0; index < attempts; index += 1) {
    lastPayload = await adapter.queryStaTaskOperate({ taskId });
    const status = lastPayload.data?.taskStatus;
    if (status === "success") return lastPayload;
    if (status === "failure" || status === "local_failure") {
      throw new Error(`${label}返回失败状态：${status}`);
    }
    await sleep(intervalMs);
  }

  throw new Error(`${label} 等待超时，最后状态：${lastPayload?.data?.taskStatus || "未知"}`);
}

function extractWarehouses(previewPayload) {
  const options = previewPayload.data?.placementOptionList || [];
  return options.flatMap((option) =>
    (option.shipmentInformationList || []).map((shipment) => ({
      placementOptionId: option.placementOptionId,
      placementStatus: option.placementStatus,
      feeCount: option.feeCount,
	      shipmentId: shipment.shipmentId,
	      shipmentName: shipment.shipmentName || "",
	      wareHouseId: shipment.wareHouseId,
	      postalCodeMark: shipment.postalCodeMark,
	      regionLabel: normalizeRegionLabel(shipment.postalCodeMark),
	      quantity: shipment.quantity,
	    })),
	  );
}

function normalizeMsku(value) {
  return String(value || "").trim().toLowerCase();
}

function boxDimensionsForSubmit(request) {
  return {
    height: request.boxDimensions.height,
    length: request.boxDimensions.length,
    width: request.boxDimensions.width,
    unitOfMeasurement: request.boxDimensions.unitOfMeasurement,
  };
}

function boxDimensionsForSave(request) {
  const dimensions = boxDimensionsForSubmit(request);
  return {
    height: String(dimensions.height),
    length: String(dimensions.length),
    width: String(dimensions.width),
    unitOfMeasurement: dimensions.unitOfMeasurement,
  };
}

function boxWeightForSubmit(request) {
  return {
    value: request.boxWeight.value,
    unit: request.boxWeight.unit,
  };
}

function boxWeightForSave(request) {
  return {
    value: String(request.boxWeight.value),
    unit: request.boxWeight.unit,
  };
}

function buildPackingBoxesForGroup(group, request, { forSave = false } = {}) {
  const groupItems = group.packingGroupItemList || [];
  const requestItem = request.inboundPlanItems?.[0] || {};
  const requestMsku = normalizeMsku(requestItem.msku);
  const matchedItems = groupItems.filter((item) => normalizeMsku(item.msku) === requestMsku);
  const unsupportedItems = groupItems.filter((item) => normalizeMsku(item.msku) !== requestMsku);
  if (!matchedItems.length) {
    throw new Error(`包装组 ${group.packingGroupId || "-"} 未返回当前 MSKU ${requestItem.msku || "-"}，无法提交装箱信息。`);
  }
  if (unsupportedItems.length) {
    throw new Error(`包装组 ${group.packingGroupId || "-"} 包含多个 MSKU，当前刷仓任务只支持单 MSKU 整箱装箱。`);
  }

  const packQuantity = Number(request.packQuantity || 0);
  if (!packQuantity || packQuantity <= 0) throw new Error("装箱数量必须来自领星 ERP，且必须大于 0。");

  const boxes = [];
  for (const item of matchedItems) {
    let remaining = Number(item.quantity || 0);
    while (remaining > 0) {
      const quantity = Math.min(packQuantity, remaining);
      boxes.push({
        dimensions: forSave ? boxDimensionsForSave(request) : boxDimensionsForSubmit(request),
        items: [{
          expiration: item.expiration || undefined,
          labelOwner: item.labelOwner || requestItem.labelOwner || "SELLER",
          msku: item.msku || requestItem.msku,
          prepOwner: item.prepOwner || requestItem.prepOwner || "SELLER",
          quantity,
        }],
        weight: forSave ? boxWeightForSave(request) : boxWeightForSubmit(request),
      });
      remaining -= quantity;
    }
  }

  if (!boxes.length) throw new Error(`包装组 ${group.packingGroupId || "-"} 未返回有效装箱数量。`);
  return boxes;
}

function buildPackingGroupings(packingGroupResult, request, { forSave = false } = {}) {
  const groups = packingGroupResult.data?.packingGroupList || [];
  if (!groups.length) throw new Error("查询包装组失败：领星未返回 packingGroupList。");
  return groups.map((group) => ({
    packingGroupId: group.packingGroupId,
    boxes: buildPackingBoxesForGroup(group, request, { forSave }),
  }));
}

async function submitPackBeforePlacement(adapter, steps, request, inboundPlanId) {
  if (request.positionType !== "1") return null;
  const packingGroupResult = await runStep(steps, "list_packing_groups", "查询包装组", () => adapter.listStaPackingGroupItems({
    inboundPlanId,
    sid: request.sid,
  }));
  const saveGroupings = buildPackingGroupings(packingGroupResult, request, { forSave: true });
  for (const grouping of saveGroupings) {
    await runStep(steps, `save_packing_information_${grouping.packingGroupId}`, `保存装箱信息 ${grouping.packingGroupId}`, () => adapter.saveStaPackingInformation({
      inboundPlanId,
      packingGroupId: grouping.packingGroupId,
      boxes: grouping.boxes,
      sid: request.sid,
    }));
  }
  const submitGroupings = buildPackingGroupings(packingGroupResult, request);
  const submitResult = await runStep(steps, "submit_packing_information", "提交装箱信息", () => adapter.submitStaPackingInformation({
    inboundPlanId,
    packageGroupings: submitGroupings,
    sid: request.sid,
  }));
  if (!submitResult.data?.taskId) {
    throw createStepError("submit_packing_information", "提交装箱信息失败：领星未返回 taskId。", submitResult, steps);
  }
  await runStep(steps, "wait_submit_packing_task", "等待装箱信息提交完成", () => waitStaTask(adapter, submitResult.data.taskId, "提交装箱信息"));
  return {
    packingGroupResult,
    submitResult,
    groupCount: submitGroupings.length,
    boxCount: submitGroupings.reduce((total, group) => total + group.boxes.length, 0),
  };
}

function beijingDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function formatBeijingDate(date) {
  const parts = beijingDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function firstText(item = {}, keys = []) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function transportSearchTokens(keyword) {
  const text = String(keyword || "").trim().toLowerCase();
  if (!text) return [];
  const tokens = new Set([text]);
  return [...tokens];
}

function isSeaTransportPreference(keyword) {
  const text = String(keyword || "").trim().toLowerCase();
  return ["海运", "海", "sea", "ocean", "ocean freight", "by sea"].includes(text);
}

function transportOptionText(item = {}) {
  return [item.alphaCode, item.alphaName, item.alphaAliasName, item.transportationName, item.transportationMode, item.transportType]
    .map((field) => String(field || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isOtherCarrierOption(item = {}) {
  const text = transportOptionText(item);
  return /\bother\b/.test(text) || text.includes("其他");
}

function chooseTransportOption(payload, preferences) {
  const list = payload.data?.transportVOList || [];
  if (!list.length) throw new Error("查询承运方式失败：领星未返回 transportVOList。");
  const byModeSolution = list.filter((item) =>
    String(item.shippingMode || "").toUpperCase() === preferences.shippingMode
    && String(item.shippingSolution || "").toUpperCase() === preferences.shippingSolution,
  );
  if (!byModeSolution.length) {
    const available = Array.from(new Set(list.map((item) => [item.shippingMode, item.shippingSolution].filter(Boolean).join("/")).filter(Boolean))).join(", ");
    throw new Error(`领星未返回配送模式 ${preferences.shippingMode}/${preferences.shippingSolution}，已停止确认货件，避免亚马逊配送模式选择错误。可选模式：${available || "无"}`);
  }
  const source = byModeSolution;
  const requiresOwnOtherCarrier = preferences.shippingSolution === "USE_YOUR_OWN_CARRIER";
  if (requiresOwnOtherCarrier) {
    const other = source.find(isOtherCarrierOption);
    if (!other) {
      const available = source.map((item) => [item.alphaCode, item.alphaName || item.alphaAliasName].filter(Boolean).join("/")).filter(Boolean).join(", ");
      throw new Error(`领星未返回 ${preferences.shippingMode} 的 Other/其他承运人，已停止确认货件，避免亚马逊承运人被选成 FIST Carriers。可选承运方式：${available || "无"}`);
    }
    return other;
  }
  if (isSeaTransportPreference(preferences.transportationKeyword)) {
    return source.find(isOtherCarrierOption) || source[0];
  }
  const tokens = transportSearchTokens(preferences.transportationKeyword);
  const byKeyword = tokens.length
    ? source.filter((item) => {
      const value = transportOptionText(item);
      return tokens.some((token) => value.includes(token));
    })
    : [];
  return byKeyword[0] || source.find(isOtherCarrierOption) || source[0];
}

function chooseDeliveryWindow(payload, desiredDate) {
  const list = payload.data?.shipmentList || payload.data?.deliveryWindowOptionList || payload.data?.deliveryWindowList || [];
  if (!list.length) throw new Error("查询可选送达时间失败：领星未返回 shipmentList。");
  const normalized = list
    .map((item) => ({
      raw: item,
      deliveryWindowOptionId: firstText(item, ["deliveryWindowOptionId", "deliveryWindowOptionID", "optionId", "id"]),
      startDate: dateOnly(firstText(item, ["startDate", "startTime", "start_date", "start_time", "windowStartDate"])),
      endDate: dateOnly(firstText(item, ["endDate", "endTime", "end_date", "end_time", "windowEndDate"])),
    }))
    .filter((item) => item.deliveryWindowOptionId && item.startDate && item.endDate);
  if (!normalized.length) {
    throw new Error(`查询可选送达时间失败：领星返回的送达窗口缺少 deliveryWindowOptionId/startDate/endDate，已停止确认货件。原始返回：${JSON.stringify(list).slice(0, 800)}`);
  }
  const sorted = normalized.sort((left, right) => left.startDate.localeCompare(right.startDate));
  return sorted.find((item) => item.startDate <= desiredDate && item.endDate >= desiredDate)
    || sorted.find((item) => item.startDate >= desiredDate)
    || sorted[sorted.length - 1]
    || sorted[0];
}

async function waitStaOperation(adapter, operationId, label, steps) {
  if (!operationId) return null;
  return runStep(steps, `wait_${label}`, `等待${label}完成`, () => waitStaTask(adapter, operationId, label));
}

async function prepareDeliveryService(adapter, steps, request, inboundPlanId, targetPlacement) {
  const shipments = targetPlacement.shipmentInformationList || [];
  const shipmentIds = shipments.map((shipment) => shipment.shipmentId).filter(Boolean);
  if (!shipmentIds.length) throw new Error("配送服务准备失败：命中的方案未返回 shipmentId。");

  const preferences = request.deliveryPreferences || defaultDeliveryPreferences;
  const shipingTime = preferences.shipDate || formatBeijingDate(addDays(new Date(), preferences.shipAfterDays));
  const desiredDeliveryDate = preferences.deliveryDate || formatBeijingDate(addDays(new Date(`${shipingTime}T00:00:00+08:00`), preferences.deliveryAfterShipDays));

  const generateTransportResult = await runStep(steps, "generate_transport_list", "生成承运方式", () => adapter.generateStaTransportList({
    inboundPlanId,
    shipmentIdList: shipmentIds.map((shipmentId) => ({ shipmentId, shipingTime })),
    sid: request.sid,
  }));
  await waitStaOperation(adapter, generateTransportResult.data?.operationId, "生成承运方式", steps);

  const distributionInfo = [];
  for (const shipmentId of shipmentIds) {
    const transportResult = await runStep(steps, `get_transport_list_${shipmentId}`, `查询承运方式 ${shipmentId}`, () => adapter.getStaTransportList({
      inboundPlanId,
      shipmentId,
      sid: request.sid,
    }));
    const transport = chooseTransportOption(transportResult, preferences);

    const generateDeliveryResult = await runStep(steps, `generate_delivery_dates_${shipmentId}`, `生成可选送达时间 ${shipmentId}`, () => adapter.generateStaDeliveryDateList({
      inboundPlanId,
      shipmentId,
      sid: request.sid,
    }));
    await waitStaOperation(adapter, generateDeliveryResult.data?.operationId, `生成可选送达时间_${shipmentId}`, steps);

    const deliveryResult = await runStep(steps, `get_delivery_dates_${shipmentId}`, `查询可选送达时间 ${shipmentId}`, () => adapter.getStaDeliveryDateList({
      inboundPlanId,
      shipmentId,
      sid: request.sid,
    }));
    const delivery = chooseDeliveryWindow(deliveryResult, desiredDeliveryDate);
    const deliveryWindowOptionId = delivery.deliveryWindowOptionId;
    const startDate = delivery.startDate;
    const endDate = delivery.endDate;
    if (!transport.transportationOptionId || !transport.alphaCode || !deliveryWindowOptionId || !startDate || !endDate) {
      throw new Error(`配送服务参数不完整，已停止确认货件。承运方式=${JSON.stringify(transport).slice(0, 500)}，送达窗口=${JSON.stringify(delivery.raw || delivery).slice(0, 500)}`);
    }

    distributionInfo.push({
      alphaCode: transport.alphaCode,
      alphaName: transport.alphaName || transport.alphaAliasName || transport.alphaCode,
      deliveryWindowOptionId,
      endDate,
      shipingTime,
      shipmentId,
      shippingMode: transport.shippingMode || preferences.shippingMode,
      shippingSolution: transport.shippingSolution || preferences.shippingSolution,
      startDate,
      transportationOptionId: transport.transportationOptionId,
    });
  }

  return {
    preferences,
    shipingTime,
    desiredDeliveryDate,
    distributionInfo,
  };
}

async function submitDeliveryService(adapter, steps, request, inboundPlanId, deliveryService) {
  if (!deliveryService?.distributionInfo?.length) return null;
  const result = await runStep(steps, "set_delivery_service", "提交货件配送服务", () => adapter.setStaDeliveryService({
    inboundPlanId,
    shipmentDistributionInfo: deliveryService.distributionInfo,
    sid: request.sid,
  }));
  await waitStaOperation(adapter, result.data?.operationId, "提交货件配送服务", steps);
  return result;
}

function normalizeRegionLabel(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (!raw) return "";
  if (normalized.includes("midwest")) return "中部";
  if (normalized.includes("west") || raw.includes("西部") || raw.includes("美西")) return "西部";
  if (normalized.includes("east") || raw.includes("东部") || raw.includes("美东")) return "东部";
  if (normalized.includes("central") || raw.includes("中部")) return "中部";
  return raw;
}

function isUsShop(request) {
  const shopText = [
    request.shopName,
    request.displayName,
    request.countryCode,
    findLingxingShop(request.shopName || request.sid)?.country,
  ].map((item) => String(item || "").trim().toLowerCase()).join(" ");
  return /\b(us|usa)\b/.test(shopText) || /-us\b/.test(shopText) || shopText.includes("美国");
}

function isWestPostalCodeMark(value) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized) return false;
  if (normalized.includes("midwest")) return false;
  return ["west", "western", "westcoast", "uswest", "usawest"].includes(normalized)
    || normalized.includes("west")
    || raw.includes("西部")
    || raw.includes("美西");
}

function getPlacementRule(request) {
	return isUsShop(request)
	  ? {
	      requireSingleShipment: true,
	      requireWestRegion: true,
	      description: "美国店铺：先筛单个货件且入库区域为西部的方案，再核对目标仓前缀。",
	    }
    : { requireSingleShipment: false, requireWestRegion: false, description: "非美国店铺：命中目标仓前缀后确认方案。" };
}

function placementHasTargetWarehouse(option, targetWarehouseCode) {
  const normalizedTarget = String(targetWarehouseCode || "").trim().toUpperCase();
  if (!normalizedTarget) return false;
  return (option.shipmentInformationList || []).some((shipment) =>
    String(shipment.wareHouseId || "").trim().toUpperCase().startsWith(normalizedTarget),
  );
}

function placementSatisfiesRule(option, rule) {
  const shipments = option.shipmentInformationList || [];
  if (rule.requireSingleShipment && shipments.length !== 1) return false;
  if (rule.requireWestRegion && !shipments.some((shipment) => isWestPostalCodeMark(shipment.postalCodeMark))) return false;
  return true;
}

function findTargetPlacement(previewPayload, request) {
  const normalizedTarget = String(request.targetWarehouseCode || "").trim().toUpperCase();
  if (!normalizedTarget) return { placement: null, targetWarehouseFound: false, rule: getPlacementRule(request) };
	const options = previewPayload.data?.placementOptionList || [];
	const rule = getPlacementRule(request);
	const ruleOptions = options.filter((option) => placementSatisfiesRule(option, rule));
	const eligibleOptions = ruleOptions.filter((option) => placementHasTargetWarehouse(option, normalizedTarget));
	eligibleOptions.sort((left, right) => Number(left.feeCount || 0) - Number(right.feeCount || 0));
	return {
	  placement: eligibleOptions[0] || null,
	  targetWarehouseFound: eligibleOptions.length > 0,
	  rule,
	};
}

function selectDisplayWarehouses(previewPayload, request, targetPlacement = null) {
  const normalizedTarget = String(request.targetWarehouseCode || "").trim().toUpperCase();
  const options = targetPlacement ? [targetPlacement] : previewPayload.data?.placementOptionList || [];
  if (!options.length) return [];
  const scoredOptions = options.map((option, index) => {
    const shipments = option.shipmentInformationList || [];
    const single = shipments.length === 1;
    const hasTarget = placementHasTargetWarehouse(option, normalizedTarget);
    const hasWest = shipments.some((shipment) => isWestPostalCodeMark(shipment.postalCodeMark));
    let score = 20;
    if (single && hasTarget && hasWest) score = 0;
    else if (single && hasWest) score = 1;
    else if (single && hasTarget) score = 2;
    else if (hasWest) score = 3;
    else if (hasTarget) score = 4;
    else if (single) score = 5;
    return { option, index, score };
  }).sort((left, right) => left.score - right.score || Number(left.option.feeCount || 0) - Number(right.option.feeCount || 0) || left.index - right.index);
  const option = scoredOptions[0]?.option;
  if (!option) return [];
  const shipments = option.shipmentInformationList || [];
  const shipment = shipments.find((item) => normalizedTarget && String(item.wareHouseId || "").trim().toUpperCase().startsWith(normalizedTarget))
    || shipments.find((item) => isWestPostalCodeMark(item.postalCodeMark))
    || shipments[0];
  if (!shipment) return [];
  return extractWarehouses({ data: { placementOptionList: [{ ...option, shipmentInformationList: [shipment] }] } })
    .map((item) => ({ ...item, shipmentName: request.planName || item.shipmentName || "" }));
}

function buildNotice({ request, createResult, generateResult, warehouses, displayWarehouses, targetMatched, targetWarehouseFound, placementRule, deliveryService, deliveryServiceResult, confirmResult, syncResult, syncError, cancelResult }) {
  const shownWarehouses = displayWarehouses?.length ? displayWarehouses : warehouses.slice(0, 1);
  const actualWarehouseText = shownWarehouses.length
    ? Array.from(new Set(shownWarehouses.map((item) => [item.wareHouseId, item.regionLabel].filter(Boolean).join("，")).filter(Boolean))).join("、")
    : "未返回仓库";
  const shipmentText = targetMatched ? request.planName || "" : "";
  const firstItem = request.inboundPlanItems?.[0] || {};
  return [
    "探嘉 BI-刷仓结果通知",
    `店铺：${request.displayName} (${request.shopName})`,
    `货件名称：${request.planName || "-"}`,
    `MKSU名称：${firstItem.msku || "-"}`,
    `发货数量：${firstItem.quantity || 0}`,
    `目标仓：${request.targetWarehouseCode || "未设置"}`,
    `实际仓：${actualWarehouseText}`,
    `是否命中：${request.targetWarehouseCode ? (targetMatched ? "是" : "否") : "未判断"}`,
    `目标仓是否出现：${request.targetWarehouseCode ? (targetWarehouseFound ? "是" : "否") : "未判断"}`,
    `确认规则：${placementRule?.description || "-"}`,
    `确认货件名称：${shipmentText || "-"}`,
    `发货时间：${deliveryService?.shipingTime || "-"}`,
    `送达时间：${deliveryService?.distributionInfo?.[0]?.startDate || "-"} ~ ${deliveryService?.distributionInfo?.[0]?.endDate || "-"}`,
    `配送模式：${deliveryService?.distributionInfo?.[0]?.shippingMode || "-"}`,
    `承运人类型：${deliveryService?.distributionInfo?.[0]?.shippingSolution || "-"}`,
    `承运方式：${deliveryService?.distributionInfo?.[0]?.alphaName || "-"}`,
    `STA任务：${createResult.data?.inboundPlanId || "-"}`,
    `确认货件：${confirmResult ? `已确认，任务 ${confirmResult.data?.taskId || "-"}` : "未确认"}`,
    `配送服务：${deliveryServiceResult ? "已提交" : "未提交"}`,
    `同步ERP：${syncResult ? "已同步" : (syncError || "未同步")}`,
    `取消任务：${cancelResult ? "已请求取消" : "未取消"}`,
  ].join("\n");
}

export async function runSingleStaWarehouseProbe(payload) {
  const request = normalizeStaPayload(payload);
  const erpMatch = await assertFbaMskuPackMatchesErp({
    sid: request.sid,
    msku: request.inboundPlanItems?.[0]?.msku,
    packQuantity: request.packQuantity,
    boxCount: request.boxCount,
    quantity: request.inboundPlanItems?.[0]?.quantity,
  });
  request.inboundPlanItems[0].msku = erpMatch.erpItem.msku;
  request.inboundPlanItems[0].quantity = erpMatch.quantity;
  request.packQuantity = erpMatch.packQuantity;
  const erpBoxSpec = { dimensions: erpMatch.boxDimensions, weight: erpMatch.boxWeight };
  const requestBoxSpec = { dimensions: request.boxDimensions, weight: request.boxWeight };
  if (hasCompleteBoxSpec(erpBoxSpec)) {
    request.boxDimensions = erpBoxSpec.dimensions;
    request.boxWeight = erpBoxSpec.weight;
  } else if (request.positionType === "1" && !hasCompleteBoxSpec(requestBoxSpec)) {
    throw new Error("先装箱再分仓需要外箱规格：ERP 产品管理未返回外箱长、外箱宽、外箱高、外箱实重，请手填后保存模板。");
  } else if (request.positionType === "1") {
    await saveFbaBoxTemplate({
      sid: request.sid,
      msku: request.inboundPlanItems[0].msku,
      boxDimensions: request.boxDimensions,
      boxWeight: request.boxWeight,
      source: erpMatch.boxSource === "template" ? "template" : "manual",
    });
  }
  const adapter = getLingxingAdapter();
  const steps = [];
  let createResult = null;
  let generateResult = null;
  let packingFlowResult = null;

  try {
    createResult = await runStep(steps, "create_inbound_plan", "创建STA任务", () => adapter.createStaTask(request));
    if (!createResult.data?.inboundPlanId) {
      throw createStepError("create_inbound_plan", "创建STA任务失败：领星未返回 inboundPlanId。", createResult, steps);
    }
    if (!createResult.data?.taskId) {
      throw createStepError("create_inbound_plan", "创建STA任务失败：领星未返回 taskId。", createResult, steps);
    }
    await runStep(steps, "wait_create_task", "等待STA创建完成", () => waitStaTask(adapter, createResult.data.taskId, "创建STA任务"));

    packingFlowResult = await submitPackBeforePlacement(adapter, steps, request, createResult.data?.inboundPlanId);

    generateResult = await runStep(steps, "generate_placement_options", "生成分仓方案", () => adapter.generateStaShipmentPlan({
      inboundPlanId: createResult.data?.inboundPlanId,
      sid: request.sid,
    }));
    if (!generateResult.data?.taskId) {
      throw createStepError("generate_placement_options", "生成分仓方案失败：领星未返回 taskId。", generateResult, steps);
    }
    await runStep(steps, "wait_generate_task", "等待分仓方案完成", () => waitStaTask(adapter, generateResult.data.taskId, "生成货件方案"));

    const previewResult = await runStep(steps, "preview_shipment", "读取实际仓库代码", () => adapter.previewStaShipment({
      inboundPlanId: createResult.data?.inboundPlanId,
      sid: request.sid,
    }));
	    const warehouses = extractWarehouses(previewResult);
	    const placementDecision = findTargetPlacement(previewResult, request);
	    const targetPlacement = placementDecision.placement;
	    const targetMatched = Boolean(targetPlacement);
	    const targetWarehouseFound = placementDecision.targetWarehouseFound;
	    let selectedWarehouses = targetPlacement
	      ? selectDisplayWarehouses(previewResult, request, targetPlacement)
	      : [];
	    let displayWarehouses = selectedWarehouses.length
	      ? selectedWarehouses
	      : selectDisplayWarehouses(previewResult, request);

    let confirmResult = null;
    let syncResult = null;
    let syncError = "";
    let cancelResult = null;
    let cancelError = null;
    let deliveryService = null;
    let deliveryServiceResult = null;
    if (targetMatched && request.confirmOnTargetMatch) {
      const shipmentIds = (targetPlacement.shipmentInformationList || []).map((shipment) => shipment.shipmentId).filter(Boolean);
      if (!shipmentIds.length) {
        throw createStepError("confirm_placement_option", "确认货件方案失败：命中的方案未返回 shipmentIds。", targetPlacement, steps);
      }
      deliveryService = await prepareDeliveryService(adapter, steps, request, createResult.data?.inboundPlanId, targetPlacement);
      confirmResult = await runStep(steps, "confirm_placement_option", "确认货件方案", () => adapter.confirmStaShipmentPlan({
        inboundPlanId: createResult.data?.inboundPlanId,
        placementOptionId: targetPlacement.placementOptionId,
        shipmentIds,
        sid: request.sid,
      }));
	      if (confirmResult.data?.taskId) {
	        await runStep(steps, "wait_confirm_task", "等待货件方案确认完成", () => waitStaTask(adapter, confirmResult.data.taskId, "确认货件方案"));
	      }
      deliveryServiceResult = await submitDeliveryService(adapter, steps, request, createResult.data?.inboundPlanId, deliveryService);
	      try {
	        const confirmedPreview = await runStep(steps, "preview_confirmed_shipment", "读取确认后货件名称", () => adapter.previewStaShipment({
	          inboundPlanId: createResult.data?.inboundPlanId,
	          sid: request.sid,
	        }));
	        const confirmedPlacement = (confirmedPreview.data?.placementOptionList || []).find((option) => option.placementOptionId === targetPlacement.placementOptionId) || targetPlacement;
	        selectedWarehouses = selectDisplayWarehouses(confirmedPreview, request, confirmedPlacement);
	        displayWarehouses = selectedWarehouses;
	      } catch {
	        displayWarehouses = selectedWarehouses;
	      }
	      try {
        syncResult = await runStep(steps, "sync_sta_to_erp", "同步STA任务到ERP", () => adapter.syncStaInboundPlan({
          inboundPlanIdList: [createResult.data?.inboundPlanId],
          sid: request.sid,
        }));
      } catch (error) {
        syncError = error.message;
      }
    }

    if (request.cancelAfterPreview && !confirmResult) {
      try {
        cancelResult = await runStep(steps, "cancel_inbound_plan", "取消测试STA任务", () => adapter.cancelStaTask({
          inboundPlanId: createResult.data?.inboundPlanId,
          sid: request.sid,
        }));
      } catch (error) {
        cancelError = error.message;
      }
    }

	    const notice = buildNotice({
	      request,
	      createResult,
	      generateResult,
	      warehouses,
		      displayWarehouses,
	      targetMatched,
	      targetWarehouseFound,
      placementRule: placementDecision.rule,
      deliveryService,
      deliveryServiceResult,
      confirmResult,
      syncResult,
      syncError,
      cancelResult,
    });
	    const shouldNotify = request.notificationPolicy !== "none" && request.notificationEnabled && (request.notificationPolicy === "all" || targetMatched);
    const dingTalk = shouldNotify
      ? await sendFbaDingTalkText(notice)
      : { ok: false, skipped: true, message: request.notificationEnabled ? "钉钉通知策略为命中后通知，本次未命中已跳过。" : "钉钉通知开关已关闭。" };

    return {
      ok: true,
      version: FBA_PROBE_VERSION,
      request: {
        sid: request.sid,
        shopName: request.shopName,
        displayName: request.displayName,
        country: findLingxingShop(request.shopName || request.sid)?.country || "",
        planName: request.planName,
        msku: request.inboundPlanItems?.[0]?.msku || "",
        quantity: request.inboundPlanItems?.[0]?.quantity || 0,
        targetWarehouseCode: request.targetWarehouseCode,
        cancelAfterPreview: request.cancelAfterPreview,
      },
      inboundPlanId: createResult.data?.inboundPlanId,
	      createTaskId: createResult.data?.taskId,
      packingFlow: packingFlowResult ? {
        groupCount: packingFlowResult.groupCount,
        boxCount: packingFlowResult.boxCount,
        submitTaskId: packingFlowResult.submitResult?.data?.taskId || "",
      } : null,
	      generateTaskId: generateResult.data?.taskId,
	      warehouses,
	      selectedWarehouses,
	      displayWarehouses,
      targetMatched,
      targetWarehouseFound,
      placementRule: placementDecision.rule,
      deliveryService,
      deliveryServiceResult,
      confirmed: Boolean(confirmResult),
      confirmTaskId: confirmResult?.data?.taskId || "",
      syncResult,
      syncError,
      cancelRequested: Boolean(cancelResult),
      cancelError,
      dingTalk,
      notice,
      steps,
    };
  } catch (error) {
    const inboundPlanId = createResult?.data?.inboundPlanId;
    if (request.cancelAfterPreview && inboundPlanId && !steps.some((item) => item.step === "cancel_inbound_plan")) {
      try {
        await runStep(steps, "cancel_inbound_plan", "失败后取消测试STA任务", () => adapter.cancelStaTask({
          inboundPlanId,
          sid: request.sid,
        }));
      } catch (cancelError) {
        error.cleanupError = cancelError.message;
      }
    }

    error.steps = steps;
    error.version = FBA_PROBE_VERSION;
    throw error;
  }
}

export async function runStaWarehouseProbe(payload) {
  const shops = Array.isArray(payload.shops) ? payload.shops.filter((shop) => shop?.sid || shop?.name) : [];
  if (!shops.length) return runSingleStaWarehouseProbe(payload);

  const results = [];
  for (const shop of shops) {
    try {
      const result = await runSingleStaWarehouseProbe({
        ...payload,
        sid: shop.sid,
        shopName: shop.name,
        useBrandAddress: payload.useBrandAddress !== false,
      });
      results.push(result);
    } catch (error) {
      results.push({
        ok: false,
        version: error.version || FBA_PROBE_VERSION,
        error: error.message,
        step: error.step || "",
        details: error.details || null,
        cleanupError: error.cleanupError || "",
        request: {
          sid: shop.sid,
          shopName: shop.name,
          displayName: shop.displayName || shop.name,
          country: findLingxingShop(shop.name || shop.sid)?.country || "",
          planName: payload.planName || "",
          msku: payload.inboundPlanItems?.[0]?.msku || "",
          quantity: payload.inboundPlanItems?.[0]?.quantity || 0,
          targetWarehouseCode: payload.targetWarehouseCode || "",
          cancelAfterPreview: payload.cancelAfterPreview !== false,
        },
        warehouses: [],
        steps: error.steps || [],
      });
    }
  }

  return {
    ok: results.every((result) => result.ok),
    version: FBA_PROBE_VERSION,
    mode: "multi-shop",
    total: results.length,
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    warehouses: results.flatMap((result) =>
      (result.warehouses || []).map((warehouse) => ({
        ...warehouse,
        sid: result.request?.sid,
        shopName: result.request?.shopName,
        displayName: result.request?.displayName,
        country: result.request?.country,
        msku: result.request?.msku,
        quantity: result.request?.quantity,
      })),
    ),
    results,
  };
}

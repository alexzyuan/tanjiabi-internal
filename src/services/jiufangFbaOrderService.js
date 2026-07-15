import { getConfig } from "../config/index.js";
import { getJiufangAdapter } from "../adapters/jiufangAdapter.js";
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaAddressProfile } from "../data/fbaAddressBook.js";
import { getFbaFreightShipments, fbaFreightSheetTestUtils } from "./fbaFreightSheetService.js";
import {
  listJiufangOrdersByShipmentIds,
  saveJiufangOrderResult,
} from "./jiufangOrderStore.js";

const { normalizeForwarderLines } = fbaFreightSheetTestUtils;

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function selectedSet(values = []) {
  return new Set((values || []).map((value) => firstText(value)).filter(Boolean));
}

function shipmentRowId(row = {}) {
  return firstText(row.shipmentId, row.staShipmentId, row.id);
}

function boxesForShipment(shipment = {}, boxPayloadsByShipmentId = new Map()) {
  const payload = boxPayloadsByShipmentId.get(shipment.shipmentId) || boxPayloadsByShipmentId.get(shipment.staShipmentId) || {};
  const list = payload.data?.shipmentList || payload.shipmentList || [];
  const matched = list.find((item) => !shipment.staShipmentId || item.shipmentId === shipment.staShipmentId) || list[0] || {};
  return Array.isArray(matched.shipmentPackingList) ? matched.shipmentPackingList : [];
}

function boxWeightKg(box = {}) {
  const value = numberValue(box.weight);
  return String(box.weightUnit || "").toUpperCase() === "LB" ? roundNumber(value * 0.45359237, 3) : value;
}

function boxCm(box = {}, key) {
  const value = numberValue(box[key]);
  return String(box.lengthUnit || "").toUpperCase() === "IN" ? roundNumber(value * 2.54, 2) : value;
}

function declaredUnitPrice(line = {}) {
  return numberValue(
    line.declaredValue
      || line.declareUnitPrice
      || line.unitPrice
      || line.item?.declaredValue
      || line.item?.declareUnitPrice
      || line.item?.unitPrice,
  );
}

const knownJiufangChannelCapacityCodes = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "15"]);
const batteryYesValues = new Set(["1", "true", "yes", "y", "是", "有", "带电", "含电", "含电池", "内置电池"]);
const batteryNoValues = new Set(["0", "false", "no", "n", "否", "无", "不带电", "不含电", "不含电池", "普货"]);

function batteryFlag(value) {
  const text = firstText(value).toLowerCase();
  if (!text) return "";
  if (knownJiufangChannelCapacityCodes.has(text)) return text === "1" ? "no" : "yes";
  if (batteryYesValues.has(text)) return "yes";
  if (batteryNoValues.has(text)) return "no";
  if (text.includes("不含") || text.includes("不带") || text.includes("无电") || text.includes("普货")) return "no";
  if (text.includes("电池") || text.includes("带电") || text.includes("含电")) return "yes";
  return "";
}

function channelCapacityForShipment(shipment = {}, lines = [], options = {}) {
  const explicit = firstText(options.channelCapacity, options.ChannelCapacity);
  if (explicit) return explicit;
  const flags = [...(shipment.items || []), ...lines].map((line) => batteryFlag(line.isBattery)).filter(Boolean);
  if (!flags.length) return "";
  return flags.includes("yes") ? "5" : "1";
}

function destinationAddress(shipment = {}) {
  return shipment.shipToAddress || shipment.raw?.ship_to_address || shipment.raw?.shipToAddress || {};
}

function addressValue(address = {}, camelKey, snakeKey) {
  return firstText(address[camelKey], address[snakeKey]);
}

function senderAddress(senderProfile = {}) {
  return {
    CompanyNameCn: firstText(senderProfile.companyNameCn, senderProfile.companyNameCN, senderProfile.companyChineseName),
    CompanyNameEn: firstText(senderProfile.companyNameEn, senderProfile.companyName, senderProfile.shipperName),
    AttentionName: firstText(senderProfile.contact, senderProfile.contactName, senderProfile.shipperName, senderProfile.companyName),
    Phone: firstText(senderProfile.phoneNumber, senderProfile.phone),
    EnterpriseCreditCode: firstText(senderProfile.enterpriseCreditCode, senderProfile.creditCode),
    Address: {
      AddressLine: [senderProfile.addressLine1, senderProfile.addressLine2].filter(Boolean),
      City: firstText(senderProfile.city),
      StateProvinceCode: firstText(senderProfile.stateOrProvinceCode, senderProfile.province),
      PostalCode: firstText(senderProfile.postalCode),
      CountryCode: firstText(senderProfile.countryCode, "CN"),
    },
  };
}

function amazonAddress(shipment = {}) {
  const address = destinationAddress(shipment);
  return {
    Name: firstText(address.name, `Amazon ${shipment.fulfillmentCenterCode || ""}`),
    DestinationFulfillmentCenterId: firstText(shipment.fulfillmentCenterCode),
    Address: {
      AddressLine: [
        addressValue(address, "addressLine1", "address_line1"),
        addressValue(address, "addressLine2", "address_line2"),
      ].filter(Boolean),
      City: addressValue(address, "city", "city"),
      StateProvinceCode: firstText(addressValue(address, "stateOrProvinceCode", "state_or_province_code"), address.state),
      PostalCode: addressValue(address, "postalCode", "postal_code"),
      CountryCode: firstText(addressValue(address, "countryCode", "country_code"), address.country, shipment.country),
    },
  };
}

function lineKey(line = {}) {
  return firstText(line.msku, line.sku, line.asin);
}

function productMatchesLine(product = {}, line = {}) {
  const candidates = [product.msku, product.sku, product.asin].map((value) => firstText(value)).filter(Boolean);
  const wanted = [line.msku, line.sku, line.internalSku, line.asin].map((value) => firstText(value)).filter(Boolean);
  return candidates.some((candidate) => wanted.includes(candidate));
}

function packageDetailsForBox(box = {}, linesByKey = new Map()) {
  return (box.productList || []).map((product) => {
    const line = [...linesByKey.values()].find((candidate) => productMatchesLine(product, candidate)) || {};
    return {
      SKU: firstText(line.internalSku, product.sku, line.sku, product.msku, line.msku),
      ProductName: firstText(product.title, product.productName, line.title, line.productName),
      Quantity: numberValue(product.quantityInBox || product.quantity || product.total || box.total),
    };
  }).filter((item) => item.SKU && item.Quantity > 0);
}

function buildInvoices(lines = []) {
  return lines.map((line) => ({
    SKU: firstText(line.internalSku, line.sku, line.msku),
    ShipmentID: firstText(line.shipment?.shipmentId, line.shipment?.staShipmentId),
    ProductName: firstText(line.title, line.productName),
    ChineseName: firstText(line.productName),
    EnglishName: firstText(line.title, line.productName),
    Quantity: numberValue(line.quantity),
    UnitPrice: declaredUnitPrice(line),
    CurrencyCode: "USD",
    Brand: firstText(line.brand),
    Material: firstText(line.material),
    Purpose: firstText(line.purpose),
    CustomsCode: firstText(line.customsCode),
    Unit: firstText(line.unit),
    Asin: firstText(line.asin),
    IsBattery: firstText(line.isBattery),
  })).filter((line) => line.SKU && line.Quantity > 0);
}

function summaryFor({ shipment, lines, boxes, channelCode, channelCapacity }) {
  const totalKg = boxes.reduce((total, box) => total + boxWeightKg(box), 0);
  const totalCbm = boxes.reduce((total, box) => total + (boxCm(box, "length") * boxCm(box, "width") * boxCm(box, "height") / 1000000), 0);
  const invoiceTotal = lines.reduce((total, line) => total + declaredUnitPrice(line) * numberValue(line.quantity), 0);
  return {
    shipmentId: firstText(shipment.shipmentId),
    channelCode,
    channelCapacity,
    warehouseCode: firstText(shipment.fulfillmentCenterCode),
    boxCount: boxes.length,
    skuCount: new Set(lines.map(lineKey).filter(Boolean)).size,
    totalKg: roundNumber(totalKg, 3),
    totalCbm: roundNumber(totalCbm, 4),
    invoiceTotal: roundNumber(invoiceTotal, 2),
  };
}

export function validateJiufangOrderInput({
  shipment = {},
  boxPayloadsByShipmentId = new Map(),
  channelCode = "",
  senderProfile = getFbaAddressProfile(shipment.storeName || shipment.raw?.seller || ""),
  options = {},
} = {}) {
  const shipmentId = firstText(shipment.shipmentId, shipment.staShipmentId, "未知货件");
  const errors = [];
  const address = destinationAddress(shipment);
  const boxes = boxesForShipment(shipment, boxPayloadsByShipmentId);
  const lines = normalizeForwarderLines([shipment], boxPayloadsByShipmentId);

  if (!firstText(channelCode)) errors.push(`${shipmentId} 缺少九方渠道代码`);
  if (!firstText(shipment.fulfillmentCenterCode)) errors.push(`${shipmentId} 缺少 Amazon 物流中心编码`);
  for (const [key, label] of [
    ["addressLine1", "addressLine1"],
    ["city", "city"],
    ["stateOrProvinceCode", "stateOrProvinceCode"],
    ["postalCode", "postalCode"],
  ]) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (!firstText(addressValue(address, key, snakeKey), key === "stateOrProvinceCode" ? address.state : "")) errors.push(`${shipmentId} 缺少收件地址 ${label}`);
  }
  if (!firstText(addressValue(address, "countryCode", "country_code"), address.country, shipment.country)) errors.push(`${shipmentId} 缺少收件国家`);

  const sender = senderAddress(senderProfile);
  if (!firstText(sender.CompanyNameCn)) errors.push(`${shipmentId} 缺少发件公司中文名`);
  if (!firstText(sender.CompanyNameEn)) errors.push(`${shipmentId} 缺少发件公司英文名`);
  if (!firstText(sender.EnterpriseCreditCode)) errors.push(`${shipmentId} 缺少发件企业信用代码`);
  if (!firstText(sender.AttentionName)) errors.push(`${shipmentId} 缺少发件联系人`);
  if (!sender.Address.AddressLine.length) errors.push(`${shipmentId} 缺少发件地址`);
  if (!firstText(sender.Address.City)) errors.push(`${shipmentId} 缺少发件城市`);
  if (!firstText(sender.Phone)) errors.push(`${shipmentId} 缺少发件电话`);

  if (!boxes.length) errors.push(`${shipmentId} 缺少装箱明细`);
  boxes.forEach((box, index) => {
    const label = `第 ${index + 1} 箱`;
    if (boxWeightKg(box) <= 0) errors.push(`${shipmentId} ${label}缺少重量`);
    if (boxCm(box, "length") <= 0) errors.push(`${shipmentId} ${label}缺少长度`);
    if (boxCm(box, "width") <= 0) errors.push(`${shipmentId} ${label}缺少宽度`);
    if (boxCm(box, "height") <= 0) errors.push(`${shipmentId} ${label}缺少高度`);
    if (!Array.isArray(box.productList) || !box.productList.length) errors.push(`${shipmentId} ${label}缺少箱内 SKU 明细`);
  });

  const requiredLineFields = [
    ["brand", "品牌"],
    ["material", "材质"],
    ["purpose", "用途"],
    ["customsCode", "清关编码"],
    ["isBattery", "是否带电"],
    ["unit", "单位"],
  ];
  const declarationLines = lines.length
    ? lines
    : (shipment.items || []).map((item) => ({
      ...item,
      item,
      quantity: numberValue(item.shippedQuantity || item.quantity),
      title: firstText(item.title, item.productName, item.msku, item.sku),
      productName: firstText(item.productName, item.title, item.msku, item.sku),
    }));
  for (const line of declarationLines) {
    const label = firstText(line.internalSku, line.msku, line.sku, line.asin, shipmentId);
    for (const [key, name] of requiredLineFields) {
      if (!firstText(line[key])) errors.push(`${label} 缺少${name}`);
    }
    if (declaredUnitPrice(line) <= 0) errors.push(`${label} 缺少申报单价`);
  }
  if (!declarationLines.length) errors.push(`${shipmentId} 没有可下单的 SKU 明细`);
  if (!channelCapacityForShipment(shipment, declarationLines, options)) errors.push(`${shipmentId} 缺少九方渠道能力（请确认 SKU 是否带电）`);
  return errors;
}

export function buildJiufangShipmentPayload({
  shipment = {},
  boxPayloadsByShipmentId = new Map(),
  channelCode = "",
  senderProfile = getFbaAddressProfile(shipment.storeName || shipment.raw?.seller || ""),
  options = {},
} = {}) {
  const errors = validateJiufangOrderInput({ shipment, boxPayloadsByShipmentId, channelCode, senderProfile, options });
  if (errors.length) throw new Error(errors.join("；"));

  const config = getConfig().jiufang;
  const boxes = boxesForShipment(shipment, boxPayloadsByShipmentId);
  const lines = normalizeForwarderLines([shipment], boxPayloadsByShipmentId);
  const linesByKey = new Map(lines.map((line) => [lineKey(line), line]));
  const invoices = buildInvoices(lines);
  const channelCapacity = channelCapacityForShipment(shipment, lines, options);
  if (!channelCapacity) throw new Error(`${firstText(shipment.shipmentId, shipment.staShipmentId, "未知货件")} 缺少九方渠道能力`);
  const summary = summaryFor({ shipment, lines, boxes, channelCode, channelCapacity });
  const packages = boxes.map((box, index) => ({
    BoxMark: {
      FbaBoxNumber: firstText(box.fbaBoxNumber, box.cartonId, `${shipment.shipmentId}-${box.localBoxId || index + 1}`),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: "KGS" },
      Weight: boxWeightKg(box),
    },
    Dimensions: {
      UnitOfMeasurement: { Code: "CM" },
      Length: boxCm(box, "length"),
      Width: boxCm(box, "width"),
      Height: boxCm(box, "height"),
    },
    PackageDetails: packageDetailsForBox(box, linesByKey),
  }));

  return {
    payload: {
      ShipmentRequest: {
        ReferenceNumber: { Value: shipment.shipmentId },
        Qty: boxes.length,
        Service: { Code: channelCode },
        ShipFrom: senderAddress(senderProfile),
        ShipTo: amazonAddress(shipment),
        InvoiceLineTotal: {
          CurrencyCode: "USD",
          MonetaryValue: summary.invoiceTotal,
        },
        Packages: packages,
        Invoices: invoices,
        ShipmentServiceOptions: {
          PickUp: false,
          Dropoff: true,
          ExportLicence: false,
          DeliveryTerms: firstText(options.deliveryTerms, "DDP"),
          Fba: true,
          Tax: true,
          ChannelCapacity: channelCapacity,
          AmazonWarehouseCode: firstText(shipment.fulfillmentCenterCode),
        },
        Departure: { Code: firstText(options.departureCode, config.defaultDepartureCode) },
      },
    },
    summary,
  };
}

async function defaultGetShipments(filters = {}, { adapter = getLingxingAdapter(), sellers = [] } = {}) {
  const result = await getFbaFreightShipments(filters, {
    adapter,
    sellers,
    productCatalogRequired: true,
    forceProductCatalogRefresh: true,
  });
  return result.rows || [];
}

async function defaultFetchBoxPayloadsByShipmentId(shipments = [], { adapter = getLingxingAdapter() } = {}) {
  const map = new Map();
  for (const shipment of shipments) {
    if (!shipment.inboundPlanId || !shipment.staShipmentId || !shipment.sid) {
      throw new Error(`${shipment.shipmentId || shipment.staShipmentId || "未知货件"} 缺少查询装箱明细所需 inboundPlanId/staShipmentId/sid。`);
    }
    const payload = await adapter.fetchFbaCargoShipmentBoxes({
      inboundPlanId: shipment.inboundPlanId,
      shipmentIdList: [shipment.staShipmentId],
      sid: shipment.sid,
    });
    map.set(shipment.shipmentId, payload);
    if (shipment.staShipmentId) map.set(shipment.staShipmentId, payload);
  }
  return map;
}

function resultSummary(results = []) {
  const readyCount = results.filter((item) => item.status === "ready").length;
  const createdCount = results.filter((item) => item.status === "created").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  return {
    ok: failedCount === 0,
    partial: failedCount > 0 && readyCount + createdCount + skippedCount > 0,
    readyCount,
    createdCount,
    skippedCount,
    failedCount,
    results,
  };
}

function resolveDependencies(deps = {}) {
  return {
    getShipments: deps.getShipments || ((filters, options) => defaultGetShipments(filters, options)),
    fetchBoxPayloadsByShipmentId: deps.fetchBoxPayloadsByShipmentId || ((shipments, options) => defaultFetchBoxPayloadsByShipmentId(shipments, options)),
    jiufangAdapter: deps.jiufangAdapter || getJiufangAdapter(),
    orderStore: deps.orderStore || {
      listByShipmentIds: (ids) => listJiufangOrdersByShipmentIds(ids),
      save: (row) => saveJiufangOrderResult(row),
    },
    lingxingAdapter: deps.lingxingAdapter || getLingxingAdapter(),
    sellers: deps.sellers || [],
  };
}

function jiufangProductRows(payload = {}) {
  const response = payload.ProductResponse || payload.productResponse || payload.data || payload;
  if (Array.isArray(response)) return response;
  return response.Products || response.products || response.list || response.rows || [];
}

export async function listJiufangChannels({ shippingWay = "LCL" } = {}, deps = {}) {
  const adapter = deps.jiufangAdapter || getJiufangAdapter();
  const payload = await adapter.listProducts({ ShippingWay: shippingWay });
  const defaultServiceCode = getConfig().jiufang.defaultServiceCode;
  const channels = jiufangProductRows(payload)
    .map((row) => ({
      code: firstText(row.Code, row.code, row.ProductCode, row.productCode),
      name: firstText(row.Name, row.name, row.ProductName, row.productName),
      shippingWay: firstText(row.ShippingWay, row.shippingWay, shippingWay),
    }))
    .filter((row) => row.code && row.name)
    .map((row) => ({
      ...row,
      isDefault: Boolean(defaultServiceCode && row.code === defaultServiceCode),
    }));
  console.info("[jiufang-fba-order] loaded Jiufang channels", {
    channelCount: channels.length,
    shippingWay,
  });
  return { ok: true, channels };
}

async function prepareRows(input = {}, deps = {}) {
  const selected = selectedSet(input.shipmentIds);
  if (!selected.size) throw new Error("请选择要提交九方的 FBA 货件。");
  const resolved = resolveDependencies(deps);
  const allRows = await resolved.getShipments(input.filters || {}, {
    adapter: resolved.lingxingAdapter,
    sellers: resolved.sellers,
  });
  const rows = allRows.filter((row) => selected.has(shipmentRowId(row)));
  if (!rows.length) throw new Error("当前筛选结果中没有找到选中的 FBA 货件。");
  const boxPayloadsByShipmentId = await resolved.fetchBoxPayloadsByShipmentId(rows, {
    adapter: resolved.lingxingAdapter,
  });
  const existingByShipmentId = await resolved.orderStore.listByShipmentIds(rows.map((row) => row.shipmentId));
  return { ...resolved, rows, boxPayloadsByShipmentId, existingByShipmentId };
}

export async function dryRunJiufangFbaOrders(input = {}, deps = {}) {
  const prepared = await prepareRows(input, deps);
  const results = [];
  for (const shipment of prepared.rows) {
    const existing = prepared.existingByShipmentId.get(shipment.shipmentId);
    if (existing && !input.forceRetry) {
      results.push({
        shipmentId: shipment.shipmentId,
        status: "skipped",
        reason: "已存在九方订单",
        jiufangOrderNumber: existing.jiufangOrderNumber,
      });
      continue;
    }
    const senderProfile = input.senderProfile || getFbaAddressProfile(shipment.storeName || shipment.raw?.seller || "");
    const missingFields = validateJiufangOrderInput({
      shipment,
      boxPayloadsByShipmentId: prepared.boxPayloadsByShipmentId,
      channelCode: input.channelCode,
      senderProfile,
      options: input.options || {},
    });
    if (missingFields.length) {
      results.push({ shipmentId: shipment.shipmentId, status: "failed", missingFields });
      continue;
    }
    const { summary } = buildJiufangShipmentPayload({
      shipment,
      boxPayloadsByShipmentId: prepared.boxPayloadsByShipmentId,
      channelCode: input.channelCode,
      senderProfile,
      options: input.options || {},
    });
    results.push({ shipmentId: shipment.shipmentId, status: "ready", summary, missingFields: [] });
  }
  return resultSummary(results);
}

function extractJiufangOrderNumber(response = {}) {
  return firstText(
    response.ShipmentResponse?.ShipmentIdentificationNumber,
    response.ShipmentIdentificationNumber,
    response.orderNo,
    response.orderNumber,
  );
}

export async function createJiufangFbaOrders(input = {}, deps = {}) {
  if (input.confirmed !== true) throw new Error("提交九方下单前必须先确认提交。");
  const prepared = await prepareRows(input, deps);
  const results = [];
  for (const shipment of prepared.rows) {
    const existing = prepared.existingByShipmentId.get(shipment.shipmentId);
    if (existing && !input.forceRetry) {
      results.push({
        shipmentId: shipment.shipmentId,
        status: "skipped",
        reason: "已存在九方订单",
        jiufangOrderNumber: existing.jiufangOrderNumber,
      });
      continue;
    }
    const senderProfile = input.senderProfile || getFbaAddressProfile(shipment.storeName || shipment.raw?.seller || "");
    let payload = null;
    let summary = null;
    try {
      ({ payload, summary } = buildJiufangShipmentPayload({
        shipment,
        boxPayloadsByShipmentId: prepared.boxPayloadsByShipmentId,
        channelCode: input.channelCode,
        senderProfile,
        options: input.options || {},
      }));
      const response = await prepared.jiufangAdapter.createShipment(payload);
      const jiufangOrderNumber = extractJiufangOrderNumber(response);
      if (!jiufangOrderNumber) throw new Error(`${shipment.shipmentId} 九方创建成功响应缺少订单号。`);
      await prepared.orderStore.save({
        shipmentId: shipment.shipmentId,
        jiufangOrderNumber,
        channelCode: input.channelCode,
        requestSummary: summary,
        requestPayload: payload,
        responsePayload: response,
        operator: input.operator,
      });
      results.push({
        shipmentId: shipment.shipmentId,
        status: "created",
        jiufangOrderNumber,
        summary,
      });
      console.info("[jiufang-fba-order] created Jiufang order", {
        shipmentId: shipment.shipmentId,
        jiufangOrderNumber,
        channelCode: input.channelCode,
      });
    } catch (error) {
      results.push({
        shipmentId: shipment.shipmentId,
        status: "failed",
        error: error.message || String(error),
      });
      console.error("[jiufang-fba-order] create failed", {
        shipmentId: shipment.shipmentId,
        channelCode: input.channelCode,
        error: error.message,
        code: error.code,
        endpoint: error.endpoint,
        payloadSummary: summary,
      });
    }
  }
  return resultSummary(results);
}

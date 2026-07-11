import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";

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

function records(payload) {
  const data = payload?.data !== undefined ? payload.data : (payload || {});
  if (Array.isArray(data)) return data;
  return data.list || data.records || data.rows || [];
}

function selectedSet(values = []) {
  return new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean));
}

function normalizeWarehouse(input = {}) {
  const sysWidValue = input.sysWid !== undefined ? input.sysWid : input.sys_wid;
  return {
    wid: numberValue(input.wid),
    sysWid: numberValue(sysWidValue),
  };
}

function assertWarehouse(warehouse = {}) {
  if (!warehouse.wid && !warehouse.sysWid) throw new Error("请选择发货仓库后再创建发货单。");
}

function resultSummary(results = []) {
  const createdCount = results.filter((item) => item.status === "created").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  return {
    ok: failedCount === 0,
    partial: failedCount > 0 && createdCount + skippedCount > 0,
    createdCount,
    skippedCount,
    failedCount,
    results,
  };
}

function shipmentRowId(row = {}) {
  return firstText(row.shipmentId, row.staShipmentId, row.id);
}

export async function listFbaShipmentOrderWarehouses({ adapter = getLingxingAdapter() } = {}) {
  const payload = await adapter.fetchLocalWarehouses({ type: 1, is_delete: 0, offset: 0, length: 1000 });
  const warehouses = records(payload)
    .map((row) => ({
      wid: numberValue(row.wid),
      name: firstText(row.name),
      type: numberValue(row.type),
      countryCode: firstText(row.country_code, row.countryCode),
    }))
    .filter((row) => row.wid && row.name);
  return { ok: true, warehouses };
}

export function validateShipmentForReadySendOrder(shipment = {}) {
  const errors = [];
  if (!firstText(shipment.shipmentId)) errors.push("缺少货件单号");
  if (!firstText(shipment.sellerId)) errors.push("缺少店铺映射 seller_id");
  if (!firstText(shipment.marketplaceId)) errors.push("缺少店铺映射 marketplace_id");
  const validItems = [];
  for (const item of shipment.items || []) {
    const sku = firstText(item.sku);
    const fnsku = firstText(item.fnsku);
    const num = numberValue(item.shippedQuantity);
    if (!sku) errors.push(`${item.msku || shipment.shipmentId} 缺少 SKU`);
    if (!fnsku) errors.push(`${item.msku || sku || shipment.shipmentId} 缺少 FNSKU`);
    if (num <= 0) errors.push(`${item.msku || sku || shipment.shipmentId} 发货数量必须大于 0`);
    if (sku && fnsku && num > 0) validItems.push(item);
  }
  if (!validItems.length) errors.push("货件没有可创建发货单的商品明细");
  return errors;
}

export function buildReadySendOrderPayload({ warehouse, shipment, nowText = new Date().toISOString() } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  assertWarehouse(normalizedWarehouse);
  const payload = {
    head_fee_type: 0,
    tax_fee_type: 0,
    is_pick: 0,
    remark: `探嘉BI自动创建: ${shipment.shipmentId} ${nowText}`,
    list: (shipment.items || [])
      .filter((item) => firstText(item.sku) && firstText(item.fnsku) && numberValue(item.shippedQuantity) > 0)
      .map((item) => ({
        seller_id: shipment.sellerId,
        marketplace_id: shipment.marketplaceId,
        shipment_id: shipment.shipmentId,
        fulfillment_network_sku: item.fnsku,
        fnsku: "",
        num: numberValue(item.shippedQuantity),
        box_num: numberValue(item.boxCount),
        sku: item.sku,
        quantity_in_case: numberValue(item.quantityInCase),
        remark: `探嘉BI自动创建: ${shipment.shipmentId}`,
      })),
  };
  if (normalizedWarehouse.wid) payload.wid = normalizedWarehouse.wid;
  else payload.sys_wid = normalizedWarehouse.sysWid;
  return payload;
}

async function findExistingShipmentOrder(adapter, shipmentId) {
  const payload = await adapter.fetchFbaInboundShipmentOrders({
    offset: 0,
    length: 20,
    is_delete: 0,
    senior_search_list: [{ search_field: "shipment_id", search_value: [shipmentId] }],
  });
  return records(payload)[0] || null;
}

function existingOrderResult(shipment, existing) {
  return {
    shipmentId: shipment.shipmentId,
    sid: shipment.sid,
    status: "skipped",
    reason: "已存在发货单",
    orderSn: firstText(existing.shipment_sn),
    orderStatus: existing.status,
    warehouseName: firstText(existing.wname),
  };
}

export async function createReadySendFbaShipmentOrders({
  filters = {},
  shipmentIds = [],
  warehouse = {},
} = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  now = () => new Date(),
} = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  assertWarehouse(normalizedWarehouse);
  const selected = selectedSet(shipmentIds);
  if (!selected.size) throw new Error("请选择要创建发货单的 FBA 货件。");
  const candidates = await getFbaShipmentCandidates(filters, { adapter, sellers });
  const rows = candidates.rows.filter((row) => selected.has(shipmentRowId(row)));
  if (!rows.length) throw new Error("当前筛选结果中没有找到选中的 FBA 货件。");

  const results = [];
  for (const shipment of rows) {
    const shipmentId = shipment.shipmentId;
    try {
      const errors = validateShipmentForReadySendOrder(shipment);
      if (errors.length) throw new Error(errors.join("；"));
      const existing = await findExistingShipmentOrder(adapter, shipmentId);
      if (existing) {
        results.push(existingOrderResult(shipment, existing));
        console.info("[fba-shipment-order] skipped existing order", { shipmentId, sid: shipment.sid, orderSn: existing.shipment_sn });
        continue;
      }
      const createPayload = buildReadySendOrderPayload({
        warehouse: normalizedWarehouse,
        shipment,
        nowText: now().toISOString(),
      });
      const response = await adapter.createReadySendFbaShipmentOrder(createPayload);
      const orderSn = firstText(response?.data?.order_sn, response?.order_sn);
      results.push({
        shipmentId,
        sid: shipment.sid,
        status: "created",
        orderSn,
        requestId: firstText(response?.request_id, response?.requestId),
      });
      console.info("[fba-shipment-order] created ready-send order", {
        shipmentId,
        sid: shipment.sid,
        orderSn,
        requestId: firstText(response?.request_id, response?.requestId),
      });
    } catch (error) {
      results.push({
        shipmentId,
        sid: shipment.sid,
        status: "failed",
        error: error.message || String(error),
      });
      console.error("[fba-shipment-order] create ready-send order failed", {
        shipmentId,
        sid: shipment.sid,
        error: error.message,
      });
    }
  }

  return resultSummary(results);
}

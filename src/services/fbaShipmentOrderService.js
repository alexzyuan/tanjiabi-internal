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

async function resolveSellerMappings(adapter, sellers = []) {
  if (Array.isArray(sellers) && sellers.length) return sellers;
  if (typeof adapter.fetchSellers !== "function") return [];
  const payload = await adapter.fetchSellers();
  const sellerRows = records(payload);
  console.info("[fba-shipment-order] loaded seller mappings", { sellerCount: sellerRows.length });
  return sellerRows;
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
      sysWid: numberValue(row.sys_wid ?? row.sysWid ?? row.wid),
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
      .map((item) => {
        const line = {
          seller_id: shipment.sellerId,
          marketplace_id: shipment.marketplaceId,
          shipment_id: shipment.shipmentId,
          fulfillment_network_sku: item.fnsku,
          fnsku: "",
          num: numberValue(item.shippedQuantity),
          sku: item.sku,
          remark: `探嘉BI自动创建: ${shipment.shipmentId}`,
        };
        const boxCount = numberValue(item.boxCount);
        const quantityInCase = numberValue(item.quantityInCase);
        if (boxCount > 0) line.box_num = boxCount;
        if (quantityInCase > 0) line.quantity_in_case = quantityInCase;
        return line;
      }),
  };
  if (normalizedWarehouse.sysWid) payload.sys_wid = normalizedWarehouse.sysWid;
  else payload.wid = normalizedWarehouse.wid;
  return payload;
}

function summarizeReadySendOrderPayload(payload = {}) {
  const firstLine = payload.list?.[0] || {};
  return {
    warehouseField: payload.sys_wid ? "sys_wid" : (payload.wid ? "wid" : ""),
    lineCount: Array.isArray(payload.list) ? payload.list.length : 0,
    firstLine: {
      shipmentId: firstText(firstLine.shipment_id),
      hasSellerId: Boolean(firstText(firstLine.seller_id)),
      hasMarketplaceId: Boolean(firstText(firstLine.marketplace_id)),
      hasSku: Boolean(firstText(firstLine.sku)),
      hasFnsku: Boolean(firstText(firstLine.fulfillment_network_sku)),
      num: numberValue(firstLine.num),
      hasBoxNum: firstLine.box_num !== undefined,
      hasQuantityInCase: firstLine.quantity_in_case !== undefined,
    },
  };
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
  const sellerMappings = await resolveSellerMappings(adapter, sellers);
  const candidates = await getFbaShipmentCandidates(filters, { adapter, sellers: sellerMappings });
  const rows = candidates.rows.filter((row) => selected.has(shipmentRowId(row)));
  if (!rows.length) throw new Error("当前筛选结果中没有找到选中的 FBA 货件。");

  const results = [];
  for (const shipment of rows) {
    const shipmentId = shipment.shipmentId;
    let createPayload = null;
    try {
      const errors = validateShipmentForReadySendOrder(shipment);
      if (errors.length) throw new Error(errors.join("；"));
      const existing = await findExistingShipmentOrder(adapter, shipmentId);
      if (existing) {
        results.push(existingOrderResult(shipment, existing));
        console.info("[fba-shipment-order] skipped existing order", { shipmentId, sid: shipment.sid, orderSn: existing.shipment_sn });
        continue;
      }
      createPayload = buildReadySendOrderPayload({
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
        code: error.code,
        details: error.details,
        payloadSummary: createPayload ? summarizeReadySendOrderPayload(createPayload) : null,
      });
    }
  }

  return resultSummary(results);
}

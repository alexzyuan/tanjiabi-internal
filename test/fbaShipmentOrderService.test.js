import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadySendOrderPayload,
  createReadySendFbaShipmentOrders,
  listFbaShipmentOrderWarehouses,
} from "../src/services/fbaShipmentOrderService.js";
import { clearFbaShipmentCandidateCache } from "../src/services/fbaShipmentCandidateService.js";

const shipmentPayload = {
  data: {
    list: [{
      sid: 8708,
      shipment_id: "FBA18QJFDCWJ",
      shipment_name: "FBA STA",
      shipment_status: "SHIPPED",
      item_list: [
        { msku: "MSKU-BLUE", fnsku: "X004BLUE", sku: "TJ-DGC-BLUE", quantity_shipped: 18, quantity_in_case: 6 },
      ],
    }],
  },
};

const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER", name: "US Store" }];

test("listFbaShipmentOrderWarehouses normalizes Lingxing local warehouse rows", async () => {
  const adapter = {
    async fetchLocalWarehouses() {
      return { data: [{ wid: 1, name: "深圳仓", type: 1, is_delete: 0 }, { wid: 2, name: "", type: 1, is_delete: 0 }] };
    },
  };

  const result = await listFbaShipmentOrderWarehouses({ adapter });

  assert.deepEqual(result.warehouses, [{ wid: 1, name: "深圳仓", type: 1, countryCode: "" }]);
});

test("buildReadySendOrderPayload maps shipment items to Lingxing required fields", () => {
  const payload = buildReadySendOrderPayload({
    warehouse: { sysWid: 1 },
    shipment: {
      shipmentId: "FBA18QJFDCWJ",
      sellerId: "A1SELLERUS",
      marketplaceId: "ATVPDKIKX0DER",
      items: [{ fnsku: "X004BLUE", sku: "TJ-DGC-BLUE", shippedQuantity: 18, quantityInCase: 6 }],
    },
    nowText: "2026-07-11T12:00:00.000Z",
  });

  assert.equal(payload.sys_wid, 1);
  assert.equal(payload.head_fee_type, 0);
  assert.equal(payload.tax_fee_type, 0);
  assert.equal(payload.list[0].seller_id, "A1SELLERUS");
  assert.equal(payload.list[0].marketplace_id, "ATVPDKIKX0DER");
  assert.equal(payload.list[0].shipment_id, "FBA18QJFDCWJ");
  assert.equal(payload.list[0].fulfillment_network_sku, "X004BLUE");
  assert.equal(payload.list[0].num, 18);
  assert.equal(payload.list[0].sku, "TJ-DGC-BLUE");
  assert.equal(payload.list[0].quantity_in_case, 6);
});

test("createReadySendFbaShipmentOrders skips existing shipment orders and creates missing ones serially", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
    async fetchFbaInboundShipmentOrders(params) {
      events.push(`lookup:${params.senior_search_list[0].search_value[0]}`);
      return { data: { list: [] } };
    },
    async createReadySendFbaShipmentOrder(params) {
      events.push(`create:${params.list[0].shipment_id}`);
      return { code: 0, message: "success", request_id: "create-request-1", data: { order_sn: "SP260711001" } };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA18QJFDCWJ"],
    warehouse: { sysWid: 1 },
  }, { adapter, sellers, now: () => new Date("2026-07-11T12:00:00.000Z") });

  assert.equal(result.createdCount, 1);
  assert.equal(result.results[0].status, "created");
  assert.equal(result.results[0].orderSn, "SP260711001");
  assert.deepEqual(events, ["fetch-shipments", "lookup:FBA18QJFDCWJ", "create:FBA18QJFDCWJ"]);
});

test("createReadySendFbaShipmentOrders loads seller mappings from Lingxing when not provided", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchSellers() {
      events.push("fetch-sellers");
      return { data: sellers };
    },
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
    async fetchFbaInboundShipmentOrders() {
      events.push("lookup");
      return { data: { list: [] } };
    },
    async createReadySendFbaShipmentOrder(params) {
      events.push(`create:${params.list[0].seller_id}:${params.list[0].marketplace_id}`);
      return { code: 0, message: "success", data: { order_sn: "SP260711003" } };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA18QJFDCWJ"],
    warehouse: { sysWid: 1 },
  }, { adapter });

  assert.equal(result.createdCount, 1);
  assert.equal(result.results[0].status, "created");
  assert.deepEqual(events, ["fetch-sellers", "fetch-shipments", "lookup", "create:A1SELLERUS:ATVPDKIKX0DER"]);
});

test("createReadySendFbaShipmentOrders skips creation when shipment order already exists", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
    async fetchFbaInboundShipmentOrders(params) {
      events.push(`lookup:${params.senior_search_list[0].search_value[0]}`);
      return { data: { list: [{ shipment_sn: "SP-EXISTS", status: 0, wname: "深圳仓" }] } };
    },
    async createReadySendFbaShipmentOrder() {
      events.push("create-should-not-run");
      return { data: { order_sn: "SP260711002" } };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA18QJFDCWJ"],
    warehouse: { sysWid: 1 },
  }, { adapter, sellers });

  assert.equal(result.createdCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.results[0].status, "skipped");
  assert.equal(result.results[0].orderSn, "SP-EXISTS");
  assert.deepEqual(events, ["fetch-shipments", "lookup:FBA18QJFDCWJ"]);
});

test("createReadySendFbaShipmentOrders returns per-shipment failure when required fields are missing", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = {
    async fetchFbaCargoShipments() {
      return { data: { list: [{ sid: 8708, shipment_id: "FBA-MISSING", item_list: [{ sku: "", fnsku: "", quantity_shipped: 0 }] }] } };
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA-MISSING"],
    warehouse: { sysWid: 1 },
  }, { adapter, sellers: [] });

  assert.equal(result.failedCount, 1);
  assert.equal(result.results[0].status, "failed");
  assert.match(result.results[0].error, /缺少店铺映射|缺少 FNSKU|缺少 SKU|发货数量/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  applyProductCatalogToFbaFreightShipments,
  buildFbaFreightWorkbookBuffer,
  buildFbaForwarderWorkbookBuffer,
  convertFbaFreightShipmentsToForwarderTemplate,
  fbaFreightSheetTestUtils,
  listFbaForwarderTemplates,
  normalizeFbaFreightFilters,
  normalizeFbaFreightShipments,
} from "../src/services/fbaFreightSheetService.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

function zipEntryNames(buffer) {
  const signature = 0x06054b50;
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("zip end of central directory not found");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const names = [];
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function templateEntryNames(filename) {
  return zipEntryNames(readFileSync(path.join(projectRoot, "assets", "freight-templates", filename)));
}

const shipmentPayload = {
  data: {
    list: [
      {
        id: 494,
        sid: 8708,
        seller: "xiamentanjia-US",
        shipment_id: "FBA18QJFDCWJ",
        shipment_name: "FBA STA (07/04/2026 09:15)-TEB9",
        shipment_status: "SHIPPED",
        destination_fulfillment_center_id: "TEB9",
        gmt_create: "2026-07-04 09:15",
        item_list: [
          {
            msku: "JM-DGC-BLUE",
            fnsku: "X004BLUE",
            sku: "TJ-DGC-BLUE",
            quantity_shipped: 18,
            product_name: "灯光船蓝色",
            title: "RC Boat Blue",
            url: "https://img.example.com/blue.jpg",
          },
          {
            msku: "JM-DGC-RED",
            fnsku: "X004RED",
            sku: "TJ-DGC-RED",
            quantity_shipped: 12,
            title: "RC Boat Red",
            url: "https://img.example.com/red.jpg",
          },
        ],
      },
    ],
  },
};

test("normalizeFbaFreightShipments maps Lingxing fba shipment rows into freight table rows", () => {
  const rows = normalizeFbaFreightShipments(shipmentPayload, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].country, "美国");
  assert.equal(rows[0].storeName, "xiamentanjia-US");
  assert.equal(rows[0].productImageUrl, "https://img.example.com/blue.jpg");
  assert.equal(rows[0].shipmentName, "FBA STA (07/04/2026 09:15)-TEB9");
  assert.equal(rows[0].shipmentId, "FBA18QJFDCWJ");
  assert.equal(rows[0].shippedQuantity, 30);
  assert.equal(rows[0].shipmentStatus, "SHIPPED");
  assert.equal(rows[0].fulfillmentCenterCode, "TEB9");
  assert.equal(rows[0].createdAt, "2026-07-04 09:15");
  assert.equal(rows[0].items.length, 2);
  assert.equal(rows[0].items[0].msku, "JM-DGC-BLUE");
});

test("normalizeFbaFreightShipments preserves Lingxing close time for downstream logistics views", () => {
  const rows = normalizeFbaFreightShipments({
    data: {
      list: [{
        sid: 8708,
        shipment_id: "FBA-CLOSED-1",
        closed_time: "2026-08-01 12:00:00",
        item_list: [],
      }],
    },
  }, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });

  assert.equal(rows[0].closedAt, "2026-08-01 12:00:00");
});

test("normalizeFbaFreightFilters leaves seller scope empty until the runtime directory is resolved", () => {
  const filters = normalizeFbaFreightFilters({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
  });

  assert.deepEqual(filters.sids, []);
});

test("buildSellersBySid does not seed static shop identities", () => {
  assert.deepEqual([...fbaFreightSheetTestUtils.buildSellersBySid().keys()], []);
});

test("normalizeFbaFreightShipments rejects rows whose SID is absent from the injected runtime directory", () => {
  assert.throws(
    () => normalizeFbaFreightShipments({
      data: {
        list: [{ sid: 17307, shipment_id: "FBA-UNKNOWN-SELLER", item_list: [] }],
      },
    }, {
      sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
    }),
    /17307/,
  );
});

test("buildLingxingShipmentParams keeps the visible UI end date for the adapter boundary", () => {
  const params = fbaFreightSheetTestUtils.buildLingxingShipmentParams({
    sids: [8708],
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    offset: 0,
    length: 500,
  });

  assert.equal(params.start_date, "2026-07-01");
  assert.equal(params.end_date, "2026-07-14");
});

test("buildLingxingShipmentParams keeps invalid end_date visible for normalized filter tests", () => {
  const params = fbaFreightSheetTestUtils.buildLingxingShipmentParams({
    sids: [8708],
    startDate: "2026-07-01",
    endDate: "bad-date",
    offset: 0,
    length: 500,
  });

  assert.equal(params.end_date, "bad-date");
});

test("buildFbaFreightWorkbookBuffer exports the requested freight sheet columns", () => {
  const rows = normalizeFbaFreightShipments(shipmentPayload, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });
  const buffer = buildFbaFreightWorkbookBuffer(rows);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets["货代表格"];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  assert.deepEqual(values[0], [
    "国家",
    "店铺",
    "发货产品图片",
    "货件名称",
    "货件单号",
    "发货数量",
    "货件状态",
    "物流中心编码",
    "创建时间",
  ]);
  assert.deepEqual(values[1], [
    "美国",
    "xiamentanjia-US",
    "https://img.example.com/blue.jpg",
    "FBA STA (07/04/2026 09:15)-TEB9",
    "FBA18QJFDCWJ",
    30,
    "SHIPPED",
    "TEB9",
    "2026-07-04 09:15",
  ]);
});

test("applyProductCatalogToFbaFreightShipments fills product images by sid and msku", () => {
  const rows = normalizeFbaFreightShipments({
    data: {
      list: [{
        sid: 8708,
        seller: "xiamentanjia-US",
        shipment_id: "FBA18QJFDCWJ",
        shipment_name: "No image shipment",
        item_list: [{ msku: "JM-DGC-BLUE", sku: "TJ-DGC-BLUE", quantity_shipped: 3 }],
      }],
    },
  }, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });
  const catalogMap = new Map([
    ["sid:8708:msku:jm-dgc-blue", { sid: 8708, msku: "JM-DGC-BLUE", internalSku: "TJ001", imageUrl: "https://img.example.com/catalog-blue.jpg", productName: "Catalog Blue", model: "SB-2" }],
  ]);

  const enriched = applyProductCatalogToFbaFreightShipments(rows, catalogMap);

  assert.equal(enriched[0].productImageUrl, "https://img.example.com/catalog-blue.jpg");
  assert.equal(enriched[0].items[0].imageUrl, "https://img.example.com/catalog-blue.jpg");
  assert.equal(enriched[0].items[0].internalSku, "TJ001");
  assert.equal(enriched[0].items[0].productName, "Catalog Blue");
  assert.equal(enriched[0].items[0].model, "SB-2");
});

test("convertFbaFreightShipmentsToForwarderTemplate fills Jiufang header and product declaration fields from ERP product management", async () => {
  const adapter = {
    fetchFbaCargoShipments: async () => shipmentPayload,
    fetchListings: async () => ({
      data: {
        list: [{
          sid: 8708,
          seller_sku: "JM-DGC-BLUE",
          sku: "TJ-DGC-BLUE",
          local_sku: "TJ-DGC-BLUE",
          asin: "B0BLUEBOAT",
          product_name: "Catalog Boat Blue",
        }],
      },
    }),
    fetchLocalProductInfos: async () => ({
      data: [
        {
          sku: "TJ-DGC-BLUE",
          product_name: "双头蜘蛛船",
          brand_name: "JOI MEW",
          material: "塑料",
          purpose: "kids toy",
          customs_code: "9503008900",
          is_battery: "否",
          unit: "套",
        },
        {
          sku: "TJ-DGC-RED",
          product_name: "红色灯光船",
          brand_name: "JOI MEW",
          material: "塑料",
          purpose: "kids toy",
          customs_code: "9503008900",
          is_battery: "否",
          unit: "套",
        },
      ],
    }),
    fetchFbaCargoShipmentBoxes: async () => ({ data: { shipmentList: [] } }),
  };

  const result = await convertFbaFreightShipmentsToForwarderTemplate({
    templateId: "jiufang",
    shipmentIds: ["FBA18QJFDCWJ"],
    filters: { startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" },
  }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国" }],
  });
  const workbook = XLSX.read(result.buffer, { type: "buffer" });
  const sheet = workbook.Sheets["下单模板"];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  assert.equal(values[8][4], "美国");
  assert.equal(values[11][1], "TEB9");
  assert.equal(values[19][7], "JOI MEW");
  assert.equal(values[19][8], "塑料");
  assert.equal(values[19][9], "kids toy");
  assert.equal(values[19][10], "9503008900");
  assert.equal(values[19][12], "否");
  assert.equal(values[19][15], "套");
});

test("listFbaForwarderTemplates exposes the two built-in freight forwarder templates", () => {
  const templates = listFbaForwarderTemplates();

  assert.deepEqual(templates.map((item) => item.id), ["jiufang", "tongpao"]);
  assert.equal(templates[0].name, "九方通逊");
  assert.equal(templates[1].name, "同袍物流");
});

test("buildFbaForwarderWorkbookBuffer requires an explicit forwarder template", () => {
  assert.throws(
    () => buildFbaForwarderWorkbookBuffer([], { templateId: "" }),
    /请选择货代模板/,
  );
});

test("buildFbaForwarderWorkbookBuffer accepts a Jiufang workbook for a regional Tanjia shop", () => {
  const buffer = buildFbaForwarderWorkbookBuffer([{
    sid: 17307,
    storeName: "tanjia-eu-DE",
    country: "德国",
    fulfillmentCenterCode: "LEJ1",
    items: [],
  }], { templateId: "jiufang" });
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const values = XLSX.utils.sheet_to_json(workbook.Sheets["下单模板"], { header: 1, defval: "" });

  assert.ok(buffer.length > 0);
  assert.equal(values[3][1], "Xiamen Tanjia wangluo keji youxian gongsi");
});

test("buildFbaForwarderWorkbookBuffer rejects Jiufang shipments owned by different legal senders", () => {
  assert.throws(
    () => buildFbaForwarderWorkbookBuffer([
      { sid: 8708, storeName: "xiamentanjia-US", country: "美国", fulfillmentCenterCode: "ONT8", items: [] },
      { sid: 11500, storeName: "tandanbo-US", country: "美国", fulfillmentCenterCode: "ONT8", items: [] },
    ], { templateId: "jiufang" }),
    /九方通逊模板.*多个法定发件主体.*xiamentanjia-US.*tandanbo-US/,
  );
});

test("buildFbaForwarderWorkbookBuffer accepts multiple stores owned by one legal sender", () => {
  const buffer = buildFbaForwarderWorkbookBuffer([
    { sid: 8708, storeName: "xiamentanjia-US", country: "美国", fulfillmentCenterCode: "ONT8", items: [] },
    { sid: 8709, storeName: "xiamentanjia-CA", country: "美国", fulfillmentCenterCode: "ONT8", items: [] },
  ], { templateId: "jiufang" });
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const values = XLSX.utils.sheet_to_json(workbook.Sheets["下单模板"], { header: 1, defval: "" });

  assert.notEqual(values[3][1], "");
  assert.notEqual(values[4][1], "");
  assert.notEqual(values[6][1], "");
  assert.notEqual(values[7][1], "");
});

test("buildFbaForwarderWorkbookBuffer fills Tongpao template with shipment and box data", () => {
  const rows = normalizeFbaFreightShipments(shipmentPayload, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });
  rows[0].raw.reference_id = "6QHMS9JA";
  rows[0].raw.ship_to_address = { addressLine1: "4000 S PRIME PASEO", city: "ONTARIO", stateOrProvinceCode: "CA", postalCode: "91761", countryCode: "US" };
  rows[0].staShipmentId = "shc-test";
  const boxPayloadsByShipmentId = new Map([[
    "FBA18QJFDCWJ",
    {
      data: {
        shipmentList: [{
          shipmentId: "shc-test",
          shipmentPackingList: [
            {
              localBoxId: "1",
              total: 20,
              weight: 24.25,
              weightUnit: "LB",
              length: 22.83,
              width: 22.83,
              height: 13.77,
              lengthUnit: "IN",
              productList: [{ msku: "JM-DGC-BLUE", sku: "TJ001", asin: "B0CT6BRPX9", productName: "蓝色灯光船", title: "Kids rc boat toy", url: "https://img.example.com/blue.jpg", quantityInBox: 20 }],
            },
            {
              localBoxId: "2",
              total: 20,
              weight: 24.25,
              weightUnit: "LB",
              length: 22.83,
              width: 22.83,
              height: 13.77,
              lengthUnit: "IN",
              productList: [{ msku: "JM-DGC-BLUE", sku: "TJ001", asin: "B0CT6BRPX9", productName: "蓝色灯光船", title: "Kids rc boat toy", url: "https://img.example.com/blue.jpg", quantityInBox: 20 }],
            },
          ],
        }],
      },
    },
  ]]);

  const buffer = buildFbaForwarderWorkbookBuffer(rows, { templateId: "tongpao", boxPayloadsByShipmentId });
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets["装箱单和发票"];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  assert.equal(values[4][25], "FBA18QJFDCWJ");
  assert.equal(values[4][26], "6QHMS9JA");
  assert.equal(values[4][27], "TEB9");
  assert.equal(values[4][2], 2);
  assert.equal(values[4][3], 20);
  assert.equal(values[4][4], 40);
  assert.equal(values[4][24], "https://img.example.com/blue.jpg");
});

test("buildFbaForwarderWorkbookBuffer preserves the source template package parts", () => {
  const rows = normalizeFbaFreightShipments(shipmentPayload, {
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });

  for (const { templateId, filename } of [
    { templateId: "jiufang", filename: "jiufang.xlsx" },
    { templateId: "tongpao", filename: "tongpao.xlsx" },
  ]) {
    const buffer = buildFbaForwarderWorkbookBuffer(rows, { templateId });
    const sourceNames = templateEntryNames(filename).filter((name) =>
      name.startsWith("xl/media/")
      || name.startsWith("xl/drawings/")
      || name.startsWith("xl/worksheets/_rels/")
      || name === "xl/cellimages.xml"
      || name === "xl/_rels/cellimages.xml.rels",
    ).sort();
    const outputNames = zipEntryNames(buffer).filter((name) =>
      name.startsWith("xl/media/")
      || name.startsWith("xl/drawings/")
      || name.startsWith("xl/worksheets/_rels/")
      || name === "xl/cellimages.xml"
      || name === "xl/_rels/cellimages.xml.rels",
    ).sort();

    assert.deepEqual(outputNames, sourceNames, templateId);
  }
});

test("getFbaFreightShipments uses shared candidate cache for identical filters", async () => {
  const { clearFbaShipmentCandidateCache } = await import("../src/services/fbaShipmentCandidateService.js");
  const { getFbaFreightShipments } = await import("../src/services/fbaFreightSheetService.js");
  clearFbaShipmentCandidateCache();
  let shipmentCalls = 0;
  const adapter = {
    async fetchFbaCargoShipments() {
      shipmentCalls += 1;
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };

  await getFbaFreightShipments({ startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
  });
  await getFbaFreightShipments({ startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
  });

  assert.equal(shipmentCalls, 1);
});

test("getFbaFreightShipments annotates rows with persisted Jiufang order numbers", async () => {
  const { clearFbaShipmentCandidateCache } = await import("../src/services/fbaShipmentCandidateService.js");
  const { getFbaFreightShipments } = await import("../src/services/fbaFreightSheetService.js");
  clearFbaShipmentCandidateCache();
  const adapter = {
    async fetchFbaCargoShipments() {
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };

  const result = await getFbaFreightShipments({ startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
    jiufangOrderStore: {
      async listByShipmentIds(ids) {
        assert.deepEqual(ids, ["FBA18QJFDCWJ"]);
        return new Map([["FBA18QJFDCWJ", { jiufangOrderNumber: "LCL2607ZZ01", channelCode: "SEA-OA-03" }]]);
      },
    },
  });

  assert.equal(result.rows[0].jiufangOrderNumber, "LCL2607ZZ01");
  assert.equal(result.rows[0].jiufangChannelCode, "SEA-OA-03");
});

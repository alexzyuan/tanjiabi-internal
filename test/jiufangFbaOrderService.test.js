import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJiufangShipmentPayload,
  createJiufangFbaOrders,
  dryRunJiufangFbaOrders,
  listJiufangChannels,
  validateJiufangOrderInput,
} from "../src/services/jiufangFbaOrderService.js";

const shipment = {
  sid: 8708,
  shipmentId: "FBA18QJFDCWJ",
  staShipmentId: "STA-123",
  storeName: "xiamentanjia-US",
  country: "US",
  fulfillmentCenterCode: "ONT8",
  shipToAddress: {
    name: "Amazon ONT8",
    addressLine1: "24300 Nandina Ave",
    city: "Moreno Valley",
    stateOrProvinceCode: "CA",
    postalCode: "92551",
    countryCode: "US",
  },
  items: [{
    msku: "MSKU-BLUE",
    sku: "TJ-DGC-BLUE",
    asin: "B0BLUE",
    productName: "收纳盒",
    title: "Storage Box",
    imageUrl: "https://img.example.com/storage-box.jpg",
    brand: "Tanjia",
    material: "Plastic",
    purpose: "Home storage",
    customsCode: "3924900000",
    isBattery: "否",
    unit: "pcs",
    model: "SB-2",
    shippedQuantity: 12,
    declaredValue: 2.5,
  }],
};

const boxPayloadsByShipmentId = new Map([[
  "FBA18QJFDCWJ",
  {
    data: {
      shipmentList: [{
        shipmentId: "STA-123",
        shipmentPackingList: [{
          localBoxId: 1,
          weight: 10,
          weightUnit: "KG",
          length: 40,
          width: 30,
          height: 20,
          lengthUnit: "CM",
          productList: [{
            msku: "MSKU-BLUE",
            sku: "TJ-DGC-BLUE",
            asin: "B0BLUE",
            productName: "收纳盒",
            title: "Storage Box",
            imageUrl: "https://img.example.com/storage-box.jpg",
            brand: "Tanjia",
            material: "Plastic",
            purpose: "Home storage",
            customsCode: "3924900000",
            isBattery: "否",
            unit: "pcs",
            model: "SB-2",
            quantityInBox: 12,
          }],
        }],
      }],
    },
  },
]]);

const senderProfile = {
  shipperName: "Xiamen Tanjia wangluo keji youxian gongsi",
  companyName: "Xiamen Tanjia wangluo keji youxian gongsi",
  companyNameCn: "厦门探嘉网络科技有限公司",
  enterpriseCreditCode: "91350200TEST000001",
  addressLine1: "No.1 Taiwen street",
  addressLine2: "Room 239-9, Huli",
  city: "Xiamen",
  stateOrProvinceCode: "Fujian",
  postalCode: "361006",
  countryCode: "CN",
  phoneNumber: "+86 13235037039",
};

test("buildJiufangShipmentPayload maps FBA shipment boxes to Jiufang ordinary shipment request", () => {
  const { payload, summary } = buildJiufangShipmentPayload({
    shipment,
    boxPayloadsByShipmentId,
    channelCode: "SEA-US-07",
    senderProfile,
    options: { departureCode: "SZ" },
  });

  assert.equal(payload.ShipmentRequest.ReferenceNumber.Value, "FBA18QJFDCWJ");
  assert.equal(payload.ShipmentRequest.Service.Code, "SEA-US-07");
  assert.equal(payload.ShipmentRequest.Departure.Code, "SZ");
  assert.equal(Object.hasOwn(payload.ShipmentRequest.ShipFrom, "CompanyNameCn"), false);
  assert.equal(payload.ShipmentRequest.ShipFrom.CompanyNameEn, "Xiamen Tanjia wangluo keji youxian gongsi");
  assert.equal(payload.ShipmentRequest.ShipFrom.AttentionName, "justin");
  assert.equal(Object.hasOwn(payload.ShipmentRequest.ShipFrom, "EnterpriseCreditCode"), false);
  assert.equal(Object.hasOwn(payload.ShipmentRequest, "Importer"), false);
  assert.equal(payload.ShipmentRequest.ShipmentServiceOptions.ChannelCapacity, "1");
  assert.equal(payload.ShipmentRequest.ShipmentServiceOptions.ExportLicence, false);
  assert.equal(payload.ShipmentRequest.ShipTo.DestinationFulfillmentCenterId, "ONT8");
  assert.equal(payload.ShipmentRequest.Packages[0].BoxMark.FbaBoxNumber, "FBA18QJFDCWJ-1");
  assert.equal(payload.ShipmentRequest.Packages[0].PackageWeight.Weight, 10);
  assert.equal(payload.ShipmentRequest.Packages[0].Dimensions.Length, 40);
  assert.equal(payload.ShipmentRequest.Packages[0].PackageDetails[0].Sku, "TJ-DGC-BLUE");
  assert.equal(payload.ShipmentRequest.Packages[0].PackageDetails[0].Num, 12);
  assert.equal(payload.ShipmentRequest.Invoices[0].ShipmentId, "FBA18QJFDCWJ");
  assert.equal(payload.ShipmentRequest.Invoices[0].Sku, "TJ-DGC-BLUE");
  assert.equal(payload.ShipmentRequest.Invoices[0].ProductNameCn, "收纳盒");
  assert.equal(payload.ShipmentRequest.Invoices[0].ProductNameEn, "Storage Box");
  assert.equal(payload.ShipmentRequest.Invoices[0].HsCode, "3924900000");
  assert.equal(payload.ShipmentRequest.Invoices[0].CustomsClearanceCode, "3924900000");
  assert.equal(payload.ShipmentRequest.Invoices[0].PurchasingPrice, 2.5);
  assert.equal(payload.ShipmentRequest.Invoices[0].DeclareValue, 2);
  assert.equal(payload.ShipmentRequest.Invoices[0].Num, 12);
  assert.equal(payload.ShipmentRequest.Invoices[0].MeasurementUnit, "pcs");
  assert.equal(payload.ShipmentRequest.Invoices[0].IsCharged, "否");
  assert.equal(payload.ShipmentRequest.Invoices[0].Model, "SB-2");
  assert.equal(payload.ShipmentRequest.Invoices[0].ImageUrl, "https://img.example.com/storage-box.jpg");
  assert.equal(payload.ShipmentRequest.Invoices[0].PerSuitNum, 1);
  assert.equal(payload.ShipmentRequest.InvoiceLineTotal.MonetaryValue, 24);
  assert.equal(summary.boxCount, 1);
  assert.equal(summary.skuCount, 1);
  assert.equal(summary.totalKg, 10);
  assert.equal(summary.totalCbm, 0.024);
});

test("buildJiufangShipmentPayload uses internal SKU mapped from Lingxing listing", () => {
  const listingSkuShipment = {
    ...shipment,
    items: [{
      ...shipment.items[0],
      msku: "JMCA-DGC-Spider",
      sku: "JMCA-DGC-Spider",
      internalSku: "TJ033",
      productName: "双支蜘蛛船",
      title: "Spider Boat",
    }],
  };
  const listingSkuBoxes = new Map([[
    "FBA18QJFDCWJ",
    {
      data: {
        shipmentList: [{
          shipmentId: "STA-123",
          shipmentPackingList: [{
            localBoxId: 1,
            weight: 10,
            weightUnit: "KG",
            length: 40,
            width: 30,
            height: 20,
            lengthUnit: "CM",
            productList: [{
              msku: "JMCA-DGC-Spider",
              sku: "JMCA-DGC-Spider",
              asin: "B0BLUE",
              productName: "双支蜘蛛船",
              title: "Spider Boat",
              imageUrl: "https://img.example.com/spider.jpg",
              quantityInBox: 12,
            }],
          }],
        }],
      },
    },
  ]]);

  const { payload } = buildJiufangShipmentPayload({
    shipment: listingSkuShipment,
    boxPayloadsByShipmentId: listingSkuBoxes,
    channelCode: "SEA-US-07",
    senderProfile,
  });

  assert.equal(payload.ShipmentRequest.Packages[0].PackageDetails[0].Sku, "TJ033");
  assert.equal(payload.ShipmentRequest.Invoices[0].Sku, "TJ033");
});

test("buildJiufangShipmentPayload resolves legal sender by store owner prefix regardless of country", () => {
  const tanjia = buildJiufangShipmentPayload({
    shipment: { ...shipment, storeName: "xiamentanjia-CA", country: "加拿大" },
    boxPayloadsByShipmentId,
    channelCode: "SEA-CA-02",
    senderProfile: undefined,
  }).payload.ShipmentRequest.ShipFrom;
  const tandanbo = buildJiufangShipmentPayload({
    shipment: { ...shipment, storeName: "tandanbo-AU", country: "澳洲" },
    boxPayloadsByShipmentId,
    channelCode: "SEA-AU-01",
    senderProfile: undefined,
  }).payload.ShipmentRequest.ShipFrom;

  assert.equal(Object.hasOwn(tanjia, "CompanyNameCn"), false);
  assert.equal(tanjia.AttentionName, "justin");
  assert.equal(Object.hasOwn(tanjia, "EnterpriseCreditCode"), false);
  assert.deepEqual(tanjia.Address.AddressLine, ["Unit 2302-3-2D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone"]);
  assert.equal(Object.hasOwn(tandanbo, "CompanyNameCn"), false);
  assert.equal(tandanbo.AttentionName, "justin");
  assert.equal(Object.hasOwn(tandanbo, "EnterpriseCreditCode"), false);
  assert.deepEqual(tandanbo.Address.AddressLine, ["Unit 2302-3-1D, No. 56 Chengyi North Street, Phase III Software Park, Xiamen Torch High-tech Zone"]);
});

test("buildJiufangShipmentPayload resolves legal sender from Lingxing display shop names", () => {
  const tanjia = buildJiufangShipmentPayload({
    shipment: { ...shipment, storeName: "探嘉加拿大", sid: 8709 },
    boxPayloadsByShipmentId,
    channelCode: "SEA-CA-02",
  }).payload.ShipmentRequest.ShipFrom;
  const tandanbo = buildJiufangShipmentPayload({
    shipment: { ...shipment, storeName: "坦蛋伯澳洲", sid: 11503 },
    boxPayloadsByShipmentId,
    channelCode: "SEA-AU-01",
  }).payload.ShipmentRequest.ShipFrom;

  assert.equal(Object.hasOwn(tanjia, "CompanyNameCn"), false);
  assert.equal(Object.hasOwn(tandanbo, "CompanyNameCn"), false);
  assert.equal(tanjia.CompanyNameEn, "Xiamen Tanjia wangluo keji youxian gongsi");
  assert.equal(tandanbo.CompanyNameEn, "Xiamen tandanbo wangluokeji youxiangongsi");
});

test("validateJiufangOrderInput fails fast when Jiufang sender store owner cannot be resolved", () => {
  const errors = validateJiufangOrderInput({
    shipment: { ...shipment, storeName: "unknown-store-US" },
    boxPayloadsByShipmentId,
    channelCode: "SEA-US-07",
    senderProfile: undefined,
  });

  assert.ok(errors.some((item) => item.includes("无法识别发件店铺主体")));
});

test("buildJiufangShipmentPayload sends battery channel capacity when ERP product is marked battery", () => {
  const { payload, summary } = buildJiufangShipmentPayload({
    shipment: {
      ...shipment,
      items: [{ ...shipment.items[0], isBattery: "是" }],
    },
    boxPayloadsByShipmentId,
    channelCode: "SEA-CA-02",
    senderProfile,
  });

  assert.equal(payload.ShipmentRequest.ShipmentServiceOptions.ChannelCapacity, "5");
  assert.equal(summary.channelCapacity, "5");
});

test("buildJiufangShipmentPayload accepts Lingxing snake_case destination address fields", () => {
  const { payload } = buildJiufangShipmentPayload({
    shipment: {
      ...shipment,
      shipToAddress: {
        name: "Amazon.com Services LLC",
        address_line1: "18900 W McDowell Road",
        city: "BUCKEYE",
        state_or_province_code: "AZ",
        postal_code: "85396",
        country_code: "US",
      },
    },
    boxPayloadsByShipmentId,
    channelCode: "SEA-US-07",
    senderProfile,
  });

  assert.deepEqual(payload.ShipmentRequest.ShipTo.Address, {
    AddressLine: ["18900 W McDowell Road"],
    City: "BUCKEYE",
    StateProvinceCode: "AZ",
    PostalCode: "85396",
    CountryCode: "US",
  });
});

test("buildJiufangShipmentPayload defaults Jiufang declare value to 2 when ERP price is missing", () => {
  const localBoxPayloadsByShipmentId = new Map([[
    "FBA18QJFDCWJ",
    {
      data: {
        shipmentList: [{
          shipmentId: "STA-123",
          shipmentPackingList: [{
            localBoxId: 1,
            weight: 10,
            weightUnit: "KG",
            length: 40,
            width: 30,
            height: 20,
            lengthUnit: "CM",
            productList: [{
              msku: "MSKU-BLUE",
              sku: "TJ-DGC-BLUE",
              productName: "收纳盒",
              imageUrl: "https://img.example.com/storage-box.jpg",
              quantityInBox: 12,
            }],
          }],
        }],
      },
    },
  ]]);

  const { payload } = buildJiufangShipmentPayload({
    shipment: {
      ...shipment,
      items: [{ ...shipment.items[0], declaredValue: "" }],
    },
    boxPayloadsByShipmentId: localBoxPayloadsByShipmentId,
    channelCode: "SEA-US-07",
    senderProfile,
  });

  assert.equal(payload.ShipmentRequest.Invoices[0].PurchasingPrice, 2);
  assert.equal(payload.ShipmentRequest.Invoices[0].DeclareValue, 2);
});

test("validateJiufangOrderInput fails fast on required missing fields", () => {
  const errors = validateJiufangOrderInput({
    shipment: {
      ...shipment,
      fulfillmentCenterCode: "",
      shipToAddress: {},
      items: [{ ...shipment.items[0], declaredValue: "" }],
    },
    boxPayloadsByShipmentId: new Map([["FBA18QJFDCWJ", { data: { shipmentList: [{ shipmentPackingList: [{ productList: [] }] }] } }]]),
    channelCode: "",
    senderProfile: {},
  });

  assert.deepEqual(errors.slice(0, 4), [
    "FBA18QJFDCWJ 缺少九方渠道代码",
    "FBA18QJFDCWJ 缺少 Amazon 物流中心编码",
    "FBA18QJFDCWJ 缺少收件地址 addressLine1",
    "FBA18QJFDCWJ 缺少收件地址 city",
  ]);
  assert.equal(errors.some((item) => item.includes("缺少发件公司中文名")), false);
  assert.equal(errors.some((item) => item.includes("缺少发件企业信用代码")), false);
  assert.equal(errors.some((item) => item.includes("MSKU-BLUE 缺少申报单价")), false);
  assert.ok(errors.some((item) => item.includes("第 1 箱缺少重量")));
});

test("dryRunJiufangFbaOrders does not call Jiufang and reports duplicate stored order", async () => {
  let createCalled = false;
  const result = await dryRunJiufangFbaOrders({
    shipmentIds: ["FBA18QJFDCWJ"],
    channelCode: "SEA-US-07",
  }, {
    getShipments: async () => [shipment],
    fetchBoxPayloadsByShipmentId: async () => boxPayloadsByShipmentId,
    orderStore: {
      async listByShipmentIds() {
        return new Map([["FBA18QJFDCWJ", { jiufangOrderNumber: "JF-EXISTS" }]]);
      },
    },
    jiufangAdapter: {
      async createShipment() {
        createCalled = true;
      },
    },
  });

  assert.equal(createCalled, false);
  assert.equal(result.results[0].status, "skipped");
  assert.equal(result.results[0].reason, "已存在九方订单");
  assert.equal(result.results[0].jiufangOrderNumber, "JF-EXISTS");
});

test("createJiufangFbaOrders requires explicit confirmation and saves returned Jiufang order number", async () => {
  await assert.rejects(
    () => createJiufangFbaOrders({
      shipmentIds: ["FBA18QJFDCWJ"],
      channelCode: "SEA-US-07",
      confirmed: false,
    }),
    /确认提交/,
  );

  const saved = [];
  const result = await createJiufangFbaOrders({
    shipmentIds: ["FBA18QJFDCWJ"],
    channelCode: "SEA-US-07",
    senderProfile,
    confirmed: true,
    operator: "Billy",
  }, {
    getShipments: async () => [shipment],
    fetchBoxPayloadsByShipmentId: async () => boxPayloadsByShipmentId,
    orderStore: {
      async listByShipmentIds() {
        return new Map();
      },
      async save(row) {
        saved.push(row);
      },
    },
    jiufangAdapter: {
      async createShipment(payload) {
        assert.equal(payload.ShipmentRequest.ReferenceNumber.Value, "FBA18QJFDCWJ");
        return {
          ShipmentResponse: { ShipmentIdentificationNumber: "JF260714001" },
        };
      },
    },
  });

  assert.equal(result.createdCount, 1);
  assert.equal(result.results[0].status, "created");
  assert.equal(result.results[0].jiufangOrderNumber, "JF260714001");
  assert.equal(saved[0].operator, "Billy");
});

test("listJiufangChannels normalizes Jiufang product response for selector options", async () => {
  const result = await listJiufangChannels({}, {
    jiufangAdapter: {
      async listProducts(params) {
        assert.equal(params.ShippingWay, "LCL");
        return {
          ProductResponse: {
            Products: [
              { Code: "SEA-US-07", Name: "九方美国海派", ShippingWay: "LCL" },
              { Code: "", Name: "无效渠道" },
            ],
          },
        };
      },
    },
  });

  assert.deepEqual(result.channels, [{
    code: "SEA-US-07",
    name: "九方美国海派",
    shippingWay: "LCL",
    isDefault: false,
  }]);
});

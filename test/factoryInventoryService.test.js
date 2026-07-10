import assert from "node:assert/strict";
import test from "node:test";
import { factoryInventoryTestUtils } from "../src/services/factoryInventoryService.js";

const {
  aggregateFbaInventoryByMsku,
  aggregateSalesForecastFbaByMsku,
  applyManualShippedQuantities,
  isFactoryInventoryRowManualKey,
  normalizePurchaseOrderRows,
} = factoryInventoryTestUtils;

test("采购单商品行默认按手填已发数量计算工厂剩余库存并关联 MSKU FBA 库存", () => {
  const fbaByMsku = aggregateFbaInventoryByMsku([
    {
      sid: 8708,
      seller_sku: "JM-DGC-BLUE",
      afn_fulfillable_quantity: 108,
      reserved_fc_transfers: 12,
      amazon_quantity_shipping: 30,
    },
    {
      sid: 11499,
      seller_sku: "JM-DGC-BLUE",
      afn_fulfillable_quantity: 20,
      reserved_fc_transfers: 3,
      inbound_quantity: 5,
    },
  ]);

  const rows = normalizePurchaseOrderRows([
    {
      purchase_order_no: "PO-202603-001",
      supplier_name: "汕头市澄海区鹏翔玩具有限公司",
      create_time: "2026-03-12 10:30:00",
      detail: [
        {
          sku: "TJ-DGC-BLUE",
          seller_sku: "JM-DGC-BLUE",
          product_name: "灯光船蓝色",
          image_url: "https://img.example.com/dgc-blue.jpg",
          purchase_quantity: 600,
          amount: "9300",
          shipped_quantity: 420,
        },
      ],
    },
  ], fbaByMsku);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].purchaseOrderNo, "PO-202603-001");
  assert.equal(rows[0].factoryName, "汕头市澄海区鹏翔玩具有限公司");
  assert.equal(rows[0].sku, "TJ-DGC-BLUE");
  assert.equal(rows[0].msku, "JM-DGC-BLUE");
  assert.equal(rows[0].purchaseQuantity, 600);
  assert.equal(rows[0].purchaseAmount, 9300);
  assert.equal(rows[0].erpShippedQuantity, 420);
  assert.equal(rows[0].shippedQuantity, 0);
  assert.equal(rows[0].factoryRemainingQuantity, 600);
  assert.equal(rows[0].fbaAvailable, 128);
  assert.equal(rows[0].fbaTransfer, 15);
  assert.equal(rows[0].fbaInbound, 35);
  assert.equal(rows[0].fbaTotalStock, 178);
});

test("采购单 msku 数组保持一条采购明细并汇总关联的 FBA 库存", () => {
  const fbaByMsku = aggregateSalesForecastFbaByMsku([
    { msku: "US-MSKU", imageUrl: "https://img.example.com/us-msku.jpg", fbaAvailable: 10, fbaTransfer: 2, fbaInbound: 3 },
    { msku: "CA-MSKU", fbaAvailable: 4, fbaTransfer: 1, fbaInbound: 8 },
  ]);

  const rows = normalizePurchaseOrderRows([
    {
      order_sn: "PO-202603-002",
      supplier_name: "测试工厂",
      create_time: "2026-03-15 08:00:00",
      item_list: [{
        sku: "LOCAL-SKU",
        product_name: "测试产品",
        quantity_real: 200,
        amount: "1200",
        msku: [{ msku: "US-MSKU" }, { msku: "CA-MSKU" }],
      }],
    },
  ], fbaByMsku);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].purchaseOrderNo, "PO-202603-002");
  assert.equal(rows[0].purchaseQuantity, 200);
  assert.equal(rows[0].msku, "US-MSKU / CA-MSKU");
  assert.equal(rows[0].imageUrl, "https://img.example.com/us-msku.jpg");
  assert.equal(rows[0].fbaAvailable, 14);
  assert.equal(rows[0].fbaTransfer, 3);
  assert.equal(rows[0].fbaInbound, 11);
});

test("采购单明细只有 sid 时会用店铺缓存补齐店铺和国家", () => {
  const rows = normalizePurchaseOrderRows([
    {
      order_sn: "PO-202603-003",
      supplier_name: "测试工厂",
      create_time: "2026-03-15 08:00:00",
      item_list: [{
        sid: "8708",
        sku: "TJ001",
        product_name: "测试产品",
        quantity_real: 200,
        amount: "1200",
      }],
    },
  ], new Map(), {
    startDate: "2026-03-01",
    sellersBySid: new Map([[8708, { sid: 8708, name: "xiamentanjia-US", country: "美国" }]]),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].storeName, "xiamentanjia-US");
  assert.equal(rows[0].country, "美国");
});

test("工厂库存按销售预估缓存里的 MSKU 汇总 FBA 可售、转库、在途", () => {
  const fbaByMsku = aggregateSalesForecastFbaByMsku([
    { msku: "JM-DGC-BLUE", fbaAvailable: 10, fbaTransfer: 2, fbaInbound: 5 },
    { msku: "JM-DGC-BLUE", fbaAvailable: 7, fbaTransfer: 3, fbaInbound: 11 },
    { msku: "JM-DGC-RED", fbaAvailable: 1, fbaTransfer: 0, fbaInbound: 4 },
  ]);

  const blue = fbaByMsku.get("jm-dgc-blue");
  assert.equal(blue.fbaAvailable, 17);
  assert.equal(blue.fbaTransfer, 5);
  assert.equal(blue.fbaInbound, 16);
  assert.equal(blue.fbaTotalStock, 38);
});

test("手填已发数量覆盖 ERP 值并重新计算工厂剩余库存", () => {
  const rows = normalizePurchaseOrderRows([
    {
      purchase_order_no: "PO-202603-001",
      supplier_name: "汕头市澄海区鹏翔玩具有限公司",
      create_time: "2026-03-12 10:30:00",
      detail: [{
        sku: "TJ-DGC-BLUE",
        seller_sku: "JM-DGC-BLUE",
        purchase_quantity: 600,
        shipped_quantity: 420,
      }],
    },
  ]);

  const manualRows = applyManualShippedQuantities(rows, {
    [rows[0].manualKey]: { shippedQuantity: 455, updatedBy: "婷婷" },
  });

  assert.equal(manualRows[0].erpShippedQuantity, 420);
  assert.equal(manualRows[0].shippedQuantity, 455);
  assert.equal(manualRows[0].factoryRemainingQuantity, 145);
  assert.equal(rows[0].shippedQuantity, 0);
  assert.equal(manualRows[0].shippedQuantitySource, "manual");
});

test("同一采购单同 SKU/MSKU 按店铺拆行时手填 key 不串行", () => {
  const rows = normalizePurchaseOrderRows([
    {
      purchase_order_no: "PO-202607-001",
      supplier_name: "测试工厂",
      create_time: "2026-07-01 10:30:00",
      detail: [
        { id: "line-us", sid: "8708", sku: "TJ001", msku: ["CA-DGC-BLUE"], quantity_real: 300 },
        { id: "line-ca", sid: "8709", sku: "TJ001", msku: ["CA-DGC-BLUE"], quantity_real: 300 },
      ],
    },
  ], new Map(), { startDate: "2026-03-01" });

  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].manualKey, rows[1].manualKey);

  const manualRows = applyManualShippedQuantities(rows, {
    [rows[0].manualKey]: { shippedQuantity: 111, updatedBy: "A" },
  });

  assert.equal(manualRows[0].shippedQuantity, 111);
  assert.equal(manualRows[1].shippedQuantity, 0);
  assert.equal(manualRows[1].shippedQuantitySource, "blank");
});

test("重复旧手填 key 不会继续套到多行导致已发数量自动变化", () => {
  const rows = normalizePurchaseOrderRows([
    {
      purchase_order_no: "PO-202607-002",
      supplier_name: "测试工厂",
      create_time: "2026-07-01 10:30:00",
      detail: [
        { id: "line-us", sid: "8708", sku: "TJ001", msku: ["CA-DGC-BLUE"], quantity_real: 300 },
        { id: "line-ca", sid: "8709", sku: "TJ001", msku: ["CA-DGC-BLUE"], quantity_real: 300 },
      ],
    },
  ], new Map(), { startDate: "2026-03-01" });
  const legacyKey = rows[0].legacyManualKey;

  const manualRows = applyManualShippedQuantities(rows, {
    [legacyKey]: { shippedQuantity: 222, updatedBy: "旧数据" },
  });

  assert.equal(manualRows[0].shippedQuantity, 0);
  assert.equal(manualRows[1].shippedQuantity, 0);
});

test("手填保存只接受行级 manualKey，旧格式 key 需要刷新页面后再保存", () => {
  assert.equal(isFactoryInventoryRowManualKey("PO260702006|line:634176|sid:8708|TJ001|CA-DGC-BLUE"), true);
  assert.equal(isFactoryInventoryRowManualKey("PO260702006|idx:0|store:|TJ001|"), true);
  assert.equal(isFactoryInventoryRowManualKey("PO260702006|TJ001|CA-DGC-BLUE"), false);
});

test("采购单归一化会过滤 2026 年 3 月以前创建的订单", () => {
  const rows = normalizePurchaseOrderRows([
    {
      order_no: "PO-OLD",
      supplier_name: "旧工厂",
      created_at: "2026-02-28 23:59:59",
      products: [{ sku: "OLD-SKU", purchase_qty: 10 }],
    },
    {
      order_no: "PO-NEW",
      supplier_name: "新工厂",
      created_at: "2026-03-01 00:00:00",
      products: [{ sku: "NEW-SKU", purchase_qty: 20 }],
    },
  ], new Map(), { startDate: "2026-03-01" });

  assert.deepEqual(rows.map((row) => row.purchaseOrderNo), ["PO-NEW"]);
});

test("采购单归一化会过滤 ERP 已作废采购单", () => {
  const rows = normalizePurchaseOrderRows([
    {
      order_no: "PO-VOID",
      supplier_name: "作废工厂",
      created_at: "2026-03-10 10:00:00",
      status: 124,
      status_text: "已作废",
      products: [{ sku: "VOID-SKU", purchase_qty: 10 }],
    },
    {
      order_no: "PO-ACTIVE",
      supplier_name: "有效工厂",
      created_at: "2026-03-11 10:00:00",
      status: 2,
      status_text: "待到货",
      products: [{ sku: "ACTIVE-SKU", purchase_qty: 20 }],
    },
  ], new Map(), { startDate: "2026-03-01" });

  assert.deepEqual(rows.map((row) => row.purchaseOrderNo), ["PO-ACTIVE"]);
});

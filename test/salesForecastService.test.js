import assert from "node:assert/strict";
import test from "node:test";
import { salesForecastTestUtils } from "../src/services/salesForecastService.js";

const {
  normalizeAdviceRecord,
  applyPreviousYearMonthlySales,
  applyFbaInventoryDetails,
  buildSalesForecastCostLookup,
  buildSalesForecastExportColumns,
  buildSalesForecastExportRows,
  buildSalesForecastExportScope,
} = salesForecastTestUtils;

test("同期销量只按 sid 和 MSKU 精确匹配", () => {
  const rows = [
    { sid: 8708, country: "美国", msku: "JM-DGC-BLUE", imageUrl: "" },
    { sid: 11499, country: "澳洲", msku: "JM-DGC-BLUE", imageUrl: "" },
  ];
  const rowsByMonth = new Map([
    [12, [{
      sid: 8708,
      msku: "JM-DGC-BLUE",
      quantity: 932,
      imageUrl: "https://example.com/us.jpg",
    }]],
  ]);

  const result = applyPreviousYearMonthlySales(rows, rowsByMonth);

  assert.equal(result[0].previousYearMonthlySales[11], 932);
  assert.equal(result[1].previousYearMonthlySales[11], 0);
  assert.equal(result[1].imageUrl, "");
});

test("补货建议保留 afn_reserved_quantity", () => {
  const row = normalizeAdviceRecord({
    basic_info: {
      sid: "11499",
      msku_fnsku_list: [{ msku: "JMAU-DGC-Blue" }],
    },
    amazon_quantity_info: {
      afn_fulfillable_quantity: 108,
      afn_reserved_quantity: 3,
      reserved_fc_transfers: 0,
      reserved_fc_processing: 0,
    },
  }, new Map([[11499, { name: "xiamentanjia-AU", country: "澳洲" }]]));

  assert.equal(row.fbaAvailable, 108);
  assert.equal(row.fbaReserved, 3);
  assert.equal(row.totalStock, 111);
});

test("FBA库存明细只覆盖相同 sid 的 MSKU", () => {
  const rows = [
    { sid: 8708, msku: "JM-DGC-BLUE", productName: "美国灯光船", fbaAvailable: 20, fbaTransfer: 0, fbaReserved: 0, awd: 0 },
    { sid: 11499, msku: "JM-DGC-BLUE", productName: "澳洲灯光船", fbaAvailable: 0, fbaTransfer: 0, fbaReserved: 0, awd: 0 },
  ];
  const inventory = [{
    sid: 11499,
    seller_sku: "JM-DGC-BLUE",
    afn_fulfillable_quantity: 108,
    afn_reserved_quantity: 3,
    reserved_fc_transfers: 0,
  }];

  const result = applyFbaInventoryDetails(rows, inventory);

  assert.equal(result.matchedCount, 1);
  assert.equal(result.rows[0].fbaAvailable, 20);
  assert.equal(result.rows[1].fbaAvailable, 108);
  assert.equal(result.rows[1].fbaReserved, 3);
  assert.equal(result.rows[1].totalStock, 111);
});

test("销售预估导出按旺季预测扣总库存和在途，并使用采购成本加头程成本统计货值", () => {
  const rowKey = encodeURIComponent("8708|JM-DGC-BLUE");
  const manualRows = {
    [rowKey]: [0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 0, 0],
  };
  const costLookup = buildSalesForecastCostLookup([{
    sid: 8708,
    storeName: "xiamentanjia-US",
    country: "美国",
    msku: "JM-DGC-BLUE",
    purchaseCost: 10,
    firstLegCost: 2,
    unitCost: 12,
  }]);

  const rows = buildSalesForecastExportRows([{
    sid: 8708,
    storeName: "xiamentanjia-US",
    country: "美国",
    productName: "灯光船蓝色",
    msku: "JM-DGC-BLUE",
    fbaAvailable: 40,
    fbaTransfer: 5,
    fbaReserved: 5,
    awd: 0,
    fbaInbound: 20,
  }], {
    manualRows,
    costLookup,
    now: new Date("2026-07-07T00:00:00"),
  });

  assert.equal(rows[0].totalStock, 50);
  assert.equal(rows[0].salesForecast, 141);
  assert.equal(rows[0].peakSeasonForecast, 141);
  assert.equal(rows[0].fbaAvailableDays, 24.7);
  assert.equal(rows[0].outOfStockDate, "2026-07-31");
  assert.equal(rows[0].shippingDate, "2026-06-16");
  assert.equal(rows[0].purchaseDate, "2026-05-17");
  assert.equal(rows[0].replenishmentEstimate, 71);
  assert.equal(rows[0].goodsValue, 852);
});

test("销售预估导出列覆盖数据表所有业务列并保留导出统计列", () => {
  const columns = buildSalesForecastExportColumns(new Date("2026-07-13T00:00:00"));
  const labels = columns.map((column) => column.label);

  assert.equal(labels.includes("关注"), false);
  assert.equal(labels.includes("隐藏"), false);
  assert.deepEqual(labels.slice(0, 5), ["图片", "店铺", "国家", "产品名称", "msku"]);
  assert.equal(labels.includes("FBA可售"), true);
  assert.equal(labels.includes("FBA在途"), true);
  assert.equal(labels.includes("销量预测"), true);
  assert.equal(labels.includes("7月日销"), true);
  assert.equal(labels.includes("12月销量"), true);
  assert.equal(labels.includes("3天日均"), true);
  assert.equal(labels.includes("补货建议"), true);
  assert.equal(labels.includes("补货预计"), true);
  assert.equal(labels.includes("货值统计"), true);
});

test("销售预估导出使用全量数据范围，不继承页面筛选", () => {
  const scope = buildSalesForecastExportScope({
    country: "美国",
    store: "xiamentanjia-US",
    keyword: "JM-DGC",
    force: "1",
  });

  assert.deepEqual(scope.dashboardFilters, { force: true });
  assert.deepEqual(scope.provisionFilters, { costMode: "landed" });
  assert.deepEqual(scope.ignoredFilters, {
    country: "美国",
    store: "xiamentanjia-US",
    keyword: "JM-DGC",
  });
});

test("销售预估导出保留非补货行", () => {
  const rowKey = encodeURIComponent("8708|JM-DGC-BLUE");
  const manualRows = {
    [rowKey]: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  };
  const rows = buildSalesForecastExportRows([{
    sid: 8708,
    storeName: "xiamentanjia-US",
    country: "美国",
    productName: "灯光船蓝色",
    msku: "JM-DGC-BLUE",
    fbaAvailable: 100,
    fbaTransfer: 0,
    fbaReserved: 0,
    awd: 0,
    fbaInbound: 0,
  }], {
    manualRows,
    costLookup: new Map(),
    now: new Date("2026-07-07T00:00:00"),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].replenishmentEstimate < 0, true);
});

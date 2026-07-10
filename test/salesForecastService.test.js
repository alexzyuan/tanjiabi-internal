import assert from "node:assert/strict";
import test from "node:test";
import { salesForecastTestUtils } from "../src/services/salesForecastService.js";

const {
  normalizeAdviceRecord,
  applyPreviousYearMonthlySales,
  applyFbaInventoryDetails,
  buildSalesForecastCostLookup,
  buildSalesForecastExportRows,
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
  assert.equal(rows[0].peakSeasonForecast, 141);
  assert.equal(rows[0].replenishmentEstimate, 71);
  assert.equal(rows[0].goodsValue, 852);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildBudgetMskuDetailRows } from "../src/services/lingxingDashboardMapper.js";

test("MSKU detail computes 30d refund rate from aggregated store and MSKU records", () => {
  const rows = buildBudgetMskuDetailRows(
    [
      { sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 100, totalSalesRefunds: 5 },
      { sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 50, totalSalesRefunds: 5 },
    ],
    {
      rows: [
        {
          storeName: "探嘉美国",
          mskuRows: [{ storeName: "探嘉美国", msku: "MSKU-1", productName: "产品 1", salesQty: 10 }],
        },
      ],
    },
    [],
    [],
    [],
    {},
    [
      { sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 200, totalSalesRefunds: 4 },
      { sid: 1, storeName: "探嘉美国", msku: "MSKU-1", totalSalesAmount: 200, totalSalesRefunds: 8 },
    ],
  );

  assert.equal(rows[0].refundRate, 6.67);
  assert.equal(rows[0].refundRate30d, 3);
});

test("MSKU detail keeps 30d refund rate unavailable when 30d sales are zero", () => {
  const rows = buildBudgetMskuDetailRows(
    [],
    {
      rows: [
        {
          storeName: "探嘉美国",
          mskuRows: [{ storeName: "探嘉美国", msku: "MSKU-2", productName: "产品 2", salesQty: 0 }],
        },
      ],
    },
    [],
    [],
    [],
    {},
    [{ sid: 1, storeName: "探嘉美国", msku: "MSKU-2", totalSalesAmount: 0, totalSalesRefunds: 2 }],
  );

  assert.equal(rows[0].refundRate30d, null);
});

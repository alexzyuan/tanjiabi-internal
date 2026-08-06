import assert from "node:assert/strict";
import test from "node:test";

import { buildBudgetMskuDetailRows } from "../src/services/lingxingDashboardMapper.js";

test("budget MSKU detail owner matching uses mapped store SID when one MSKU exists in multiple shops", () => {
  const rows = buildBudgetMskuDetailRows(
    [],
    {
      rows: [
        {
          storeName: "探嘉澳洲",
          site: "澳洲站",
          mskuRows: [
            { storeName: "探嘉澳洲", site: "澳洲站", msku: "JMAU-SHARED", productName: "无销量预算品", salesQty: 10 },
          ],
        },
      ],
    },
    [],
    [],
    [
      { sid: 11499, country: "澳洲", countryCode: "", msku: "JMAU-SHARED", listingOwner: "黄超" },
      { sid: 11503, country: "澳洲", countryCode: "", msku: "JMAU-SHARED", listingOwner: "林芃" },
    ],
    { listingOwner: "黄超" },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].listingOwner, "黄超");
  assert.equal(rows[0].msku, "JMAU-SHARED");
});

test("MSKU detail includes uncovered actual rows for non-AU shops when budget rows are empty", () => {
  const rows = buildBudgetMskuDetailRows(
    [
      {
        sid: 8709,
        storeName: "xiamentanjia-CA",
        country: "加拿大",
        countryCode: "CA",
        msku: "JMCA-ACTUAL",
        productName: "加拿大实际销售品",
        amount: 120,
        volume: 3,
        gross_profit: 24,
      },
    ],
    { rows: [] },
    [],
    [],
    [
      { sid: 8709, country: "加拿大", countryCode: "CA", msku: "JMCA-ACTUAL", listingOwner: "熊丹轩" },
    ],
    { listingOwner: "熊丹轩" },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].budgetStoreName, "探嘉加拿大");
  assert.equal(rows[0].msku, "JMCA-ACTUAL");
  assert.equal(rows[0].listingOwner, "熊丹轩");
  assert.equal(rows[0].actualQuantity, 3);
  assert.equal(rows[0].averageProfit, 8);
});

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

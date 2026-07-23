import assert from "node:assert/strict";
import test from "node:test";

import {
  listingOwnerRowsFromRecords,
  ownerLookupRowsFromBudgetTargets,
} from "../src/services/listingOwnerService.js";

test("listingOwnerRowsFromRecords extracts listing owners returned by order profit records", () => {
  const rows = listingOwnerRowsFromRecords([
    {
      sid: 11499,
      country: "澳洲",
      countryCode: "AU",
      msku: "JMAU-DGC-BLUE",
      asin_principal_list: [{ principal_name: "黄超" }],
    },
  ]);

  assert.deepEqual(rows, [
    {
      sid: 11499,
      country: "澳洲",
      countryCode: "AU",
      msku: "JMAU-DGC-BLUE",
      listingOwner: "黄超",
    },
  ]);
});

test("ownerLookupRowsFromBudgetTargets includes no-sales budget MSKUs by mapped store SID", () => {
  const rows = ownerLookupRowsFromBudgetTargets({
    rows: [
      {
        storeName: "探嘉澳洲",
        site: "澳洲站",
        mskuRows: [
          { storeName: "探嘉澳洲", site: "澳洲站", msku: "JMAU-NO-SALES" },
        ],
      },
    ],
  }, []);

  assert.deepEqual(rows, [
    {
      sid: 11499,
      country: "澳洲",
      countryCode: "",
      msku: "JMAU-NO-SALES",
    },
  ]);
});

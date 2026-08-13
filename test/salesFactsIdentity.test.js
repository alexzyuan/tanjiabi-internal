import assert from "node:assert/strict";
import test from "node:test";

import {
  SALES_FACTS_CURRENCY_MODES,
  SalesFactsContractError,
  SalesFactsInputError,
  addSalesFactsDateDays,
  normalizeSalesFactsDate,
  normalizeSalesFactsScope,
} from "../src/services/salesFactsIdentity.js";

const sellers = [
  { sid: 8708, country: "美国", countryCode: "US", status: 1 },
  { sid: 8709, country: "美国", countryCode: "US", status: "active" },
  { sid: 8710, country: "加拿大", countryCode: "CA", status: 1 },
];

test("normalizes and shifts canonical sales fact dates", () => {
  assert.equal(normalizeSalesFactsDate(" 2028-02-29 "), "2028-02-29");
  assert.equal(addSalesFactsDateDays("2028-02-29", 1), "2028-03-01");
  assert.equal(addSalesFactsDateDays("2026-01-01", -1), "2025-12-31");
  assert.throws(
    () => normalizeSalesFactsDate("2026-02-29"),
    (error) => error.code === "SALES_FACTS_DATE_INVALID",
  );
  assert.throws(
    () => addSalesFactsDateDays("2026-08-13", 1.5),
    (error) => error.code === "SALES_FACTS_DATE_SHIFT_INVALID",
  );
});

test("normalizes a Pacific inclusive range and stable SID/currency scope", () => {
  const scope = normalizeSalesFactsScope({
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    sids: [8709, 8708, 8708],
    currencyMode: "cny",
    sellerDirectory: sellers,
    now: new Date("2026-08-13T08:00:00Z"),
  });

  assert.deepEqual(scope.dates, ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.deepEqual(scope.sids, [8708, 8709]);
  assert.equal(scope.currencyMode, "CNY");
  assert.equal(scope.countryCode, "US");
  assert.equal(scope.rangeKey, "2026-08-01|2026-08-03|8708,8709|CNY");
  assert.deepEqual(SALES_FACTS_CURRENCY_MODES, ["CNY", "ORIGINAL"]);
});

test("rejects cross-country ORIGINAL and unknown runtime SIDs", () => {
  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      sids: [8708, 8710],
      currencyMode: "ORIGINAL",
      sellerDirectory: sellers,
    }),
    (error) => error instanceof SalesFactsContractError
      && error.statusCode === 422
      && error.code === "SALES_FACTS_ORIGINAL_SCOPE_INVALID",
  );

  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      sids: [9999],
      currencyMode: "CNY",
      sellerDirectory: sellers,
    }),
    (error) => error instanceof SalesFactsInputError
      && error.statusCode === 400
      && error.code === "SALES_FACTS_UNKNOWN_SID",
  );
});

test("normalizes seller countries from the first non-empty directory field", () => {
  const scope = normalizeSalesFactsScope({
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    sids: [8708, 8709],
    currencyMode: "ORIGINAL",
    sellerDirectory: [
      { sid: 8708, countryCode: "", country: "美国", status: 1 },
      { sid: 8709, countryCode: "US", country: "", status: 1 },
    ],
  });

  assert.equal(scope.countryCode, "US");
});

test("normalizes known country names and code aliases without reading store names", () => {
  const cases = [
    ["美国", "US"],
    ["USA", "US"],
    ["加拿大", "CA"],
    ["澳洲", "AU"],
    ["澳大利亚", "AU"],
    ["德国", "DE"],
    ["de", "DE"],
    ["mx", "MX"],
  ];
  for (const [country, expected] of cases) {
    const scope = normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      sids: [8708],
      currencyMode: "ORIGINAL",
      sellerDirectory: [{ sid: 8708, countryCode: "", country, name: "misleading-US", status: 1 }],
    });
    assert.equal(scope.countryCode, expected);
  }

  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      sids: [8708],
      currencyMode: "ORIGINAL",
      sellerDirectory: [{ sid: 8708, countryCode: "", country: "", name: "store-US", status: 1 }],
    }),
    (error) => error.code === "SALES_FACTS_ORIGINAL_SCOPE_INVALID" && error.details?.countryCount === 0,
  );

  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      sids: [8708, 8709],
      currencyMode: "ORIGINAL",
      sellerDirectory: [
        { sid: 8708, countryCode: "US", status: 1 },
        { sid: 8709, countryCode: "", country: "", status: 1 },
      ],
    }),
    (error) => error.code === "SALES_FACTS_ORIGINAL_SCOPE_INVALID"
      && error.details?.missingCountryCount === 1,
  );
});

test("rejects invalid dates, empty scopes, and inactive sellers instead of broadening", () => {
  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-03",
      endDate: "2026-08-01",
      sids: [8708],
      currencyMode: "CNY",
      sellerDirectory: sellers,
    }),
    (error) => error.code === "SALES_FACTS_DATE_RANGE_INVALID",
  );
  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      sids: [],
      currencyMode: "CNY",
      sellerDirectory: sellers,
    }),
    (error) => error.code === "SALES_FACTS_SCOPE_EMPTY",
  );
  assert.throws(
    () => normalizeSalesFactsScope({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      sids: [8711],
      currencyMode: "CNY",
      sellerDirectory: [...sellers, { sid: 8711, countryCode: "US", status: 0 }],
    }),
    (error) => error.code === "SALES_FACTS_UNKNOWN_SID",
  );
});

test("classifies current, previous, and frozen natural months in Pacific time", () => {
  const scope = normalizeSalesFactsScope({
    startDate: "2026-06-30",
    endDate: "2026-08-01",
    sids: [8708],
    currencyMode: "CNY",
    sellerDirectory: sellers,
    now: new Date("2026-08-13T08:00:00Z"),
  });
  assert.deepEqual(scope.monthClasses, [
    { naturalMonth: "2026-06", classification: "frozen" },
    { naturalMonth: "2026-07", classification: "previous" },
    { naturalMonth: "2026-08", classification: "current" },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLingxingDateRangeParams,
  getLingxingDateContract,
  LINGXING_DATE_CONTRACTS,
  lingxingExclusiveEndDate,
  withLingxingDateContract,
  withLingxingExclusiveEndDate,
} from "../src/utils/lingxingDateRange.js";

test("only documented exclusive endpoints add one day", () => {
  assert.equal(withLingxingDateContract("/erp/sc/data/mws/orders", {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  }).end_date, "2026-08-01");
  assert.equal(withLingxingDateContract("/bd/profit/report/open/report/seller/list", {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }).endDate, "2026-07-31");
  assert.equal(withLingxingDateContract("/unknown", {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  }).end_date, "2026-07-31");
});

test("date contracts expose official boundary and documentation metadata", () => {
  assert.equal(getLingxingDateContract("/erp/sc/data/fba_report/shipmentList").boundary, "exclusive");
  assert.equal(getLingxingDateContract("/basicOpen/finance/mreport/OrderProfit").boundary, "inclusive");
  assert.equal(getLingxingDateContract("/unknown").boundary, "undocumented");
  assert.equal(LINGXING_DATE_CONTRACTS["/erp/sc/data/mws/orders"].docsUrl, "https://apidoc.lingxing.com/docs/Sale/Orderlists");
});

test("exclusive FBA contracts convert both creation and extra date end keys", () => {
  const params = withLingxingDateContract("/erp/sc/data/fba_report/shipmentList", {
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    start_extra_date: "2026-07-01",
    end_extra_date: "2026-07-31",
  });

  assert.equal(params.end_date, "2026-08-01");
  assert.equal(params.end_extra_date, "2026-08-01");
});

test("contract conversion does not mutate visible filters", () => {
  const filters = { startDate: "2026-07-01", endDate: "2026-07-31" };
  const params = withLingxingDateContract("/basicOpen/finance/mreport/OrderProfit", filters);

  assert.equal(params.endDate, "2026-07-31");
  assert.deepEqual(filters, { startDate: "2026-07-01", endDate: "2026-07-31" });
});

test("lingxingExclusiveEndDate converts UI inclusive end day to Lingxing exclusive boundary", () => {
  assert.equal(lingxingExclusiveEndDate("2026-07-14"), "2026-07-15");
  assert.equal(lingxingExclusiveEndDate("2026-12-31"), "2027-01-01");
});

test("withLingxingExclusiveEndDate does not mutate visible frontend filter dates", () => {
  const filters = {
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    end_date: "2026-07-14",
  };

  const params = withLingxingExclusiveEndDate(filters);

  assert.equal(filters.endDate, "2026-07-14");
  assert.equal(filters.end_date, "2026-07-14");
  assert.equal(params.endDate, "2026-07-15");
  assert.equal(params.end_date, "2026-07-15");
});

test("buildLingxingDateRangeParams keeps start date and makes only end date exclusive", () => {
  assert.deepEqual(buildLingxingDateRangeParams({
    startDate: "2026-07-01",
    endDate: "2026-07-14",
  }), {
    start_date: "2026-07-01",
    end_date: "2026-07-15",
  });
});

test("Lingxing date helpers fail fast on invalid date input", () => {
  assert.throws(() => lingxingExclusiveEndDate("bad-date"), /Invalid Lingxing date/);
  assert.throws(() => lingxingExclusiveEndDate("2026-02-30"), /Invalid Lingxing date/);
});

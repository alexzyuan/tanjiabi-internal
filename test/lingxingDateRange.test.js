import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLingxingDateRangeParams,
  lingxingExclusiveEndDate,
  withLingxingExclusiveEndDate,
} from "../src/utils/lingxingDateRange.js";

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

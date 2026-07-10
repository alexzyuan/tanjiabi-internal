import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  formatCompactDateTime,
  formatDate,
  getDateRangeByPreset,
  getDefaultFrontDateRange,
  getPacificDateParts,
  getPacificTodayText,
} from "../assets/js/date-utils.js";

test("date utils format local dates and Pacific date parts", () => {
  assert.equal(formatDate(new Date(2026, 6, 5)), "2026-07-05");
  assert.deepEqual(getPacificDateParts(new Date("2026-07-06T07:30:00Z")), {
    year: 2026,
    month: 7,
    day: 6,
  });
  assert.equal(getPacificTodayText(new Date("2026-07-06T07:30:00Z")), "2026-07-06");
});

test("date utils build dashboard range presets from a fixed Pacific day", () => {
  const reference = new Date("2026-07-06T16:00:00Z");
  assert.deepEqual(getDefaultFrontDateRange(reference), { start: "2026-07-01", end: "2026-07-06" });
  assert.deepEqual(getDateRangeByPreset("last7", reference).map(formatDate), ["2026-06-30", "2026-07-06"]);
  assert.deepEqual(getDateRangeByPreset("lastWeek", reference).map(formatDate), ["2026-06-29", "2026-07-05"]);
  assert.deepEqual(getDateRangeByPreset("lastMonth", reference).map(formatDate), ["2026-06-01", "2026-06-30"]);
  assert.equal(formatDate(addDays(new Date(2026, 6, 6), -1)), "2026-07-05");
});

test("date utils compact datetime uses Beijing display and safe fallbacks", () => {
  assert.equal(formatCompactDateTime(""), "-");
  assert.equal(formatCompactDateTime("not-a-date-value"), "not-a-date-value");
  assert.equal(formatCompactDateTime("2026-07-06T00:30:00Z"), "2026-07-06 08:30");
});

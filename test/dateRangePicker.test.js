import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarMonth,
  createDateRangePicker,
  formatDateRangeLabel,
  normalizeDateRange,
  resolveDateRangePreset,
} from "../assets/js/date-range-picker.js";

function createFakeElement() {
  const listeners = {};
  return {
    classList: { add() {} },
    dispatchEvent() {},
    focusCalled: false,
    hidden: true,
    innerHTML: "",
    listeners,
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    focus() {
      this.focusCalled = true;
    },
    textContent: "",
    value: "",
  };
}

function createDateClickEvent(date) {
  let propagationStopped = false;
  return {
    get propagationStopped() {
      return propagationStopped;
    },
    stopPropagation() {
      propagationStopped = true;
    },
    target: {
      closest(selector) {
        if (selector === "[data-date-range-day]") return { dataset: { dateRangeDay: date } };
        return null;
      },
    },
  };
}

test("date range picker normalizes reversed ranges and labels them consistently", () => {
  assert.deepEqual(normalizeDateRange("2026-07-17", "2026-01-01"), {
    start: "2026-01-01",
    end: "2026-07-17",
  });
  assert.equal(formatDateRangeLabel({ start: "2026-01-01", end: "2026-07-17" }), "2026-01-01 - 2026-07-17");
});

test("date range picker resolves BI shortcut presets from a fixed today", () => {
  const today = new Date("2026-07-17T08:00:00Z");

  assert.deepEqual(resolveDateRangePreset("today", today), { start: "2026-07-17", end: "2026-07-17" });
  assert.deepEqual(resolveDateRangePreset("yesterday", today), { start: "2026-07-16", end: "2026-07-16" });
  assert.deepEqual(resolveDateRangePreset("last7", today), { start: "2026-07-11", end: "2026-07-17" });
  assert.deepEqual(resolveDateRangePreset("last30", today), { start: "2026-06-18", end: "2026-07-17" });
  assert.deepEqual(resolveDateRangePreset("thisMonth", today), { start: "2026-07-01", end: "2026-07-17" });
  assert.deepEqual(resolveDateRangePreset("lastMonth", today), { start: "2026-06-01", end: "2026-06-30" });
  assert.deepEqual(resolveDateRangePreset("thisYear", today), { start: "2026-01-01", end: "2026-07-17" });
  assert.deepEqual(resolveDateRangePreset("lastYear", today), { start: "2025-01-01", end: "2025-12-31" });
});

test("date range picker builds a six-week month grid with range states", () => {
  const month = buildCalendarMonth({
    year: 2026,
    monthIndex: 0,
    range: { start: "2026-01-01", end: "2026-01-17" },
    todayText: "2026-07-17",
  });
  const flatDays = month.weeks.flat();
  const jan1 = flatDays.find((day) => day.date === "2026-01-01");
  const jan10 = flatDays.find((day) => day.date === "2026-01-10");
  const jan17 = flatDays.find((day) => day.date === "2026-01-17");

  assert.equal(month.title, "2026 年 1 月");
  assert.equal(month.weeks.length, 6);
  assert.equal(month.weeks.every((week) => week.length === 7), true);
  assert.equal(flatDays[0].date, "2025-12-28");
  assert.equal(jan1.isRangeStart, true);
  assert.equal(jan1.isSelected, true);
  assert.equal(jan10.isInRange, true);
  assert.equal(jan17.isRangeEnd, true);
  assert.equal(jan17.isSelected, true);
});

test("date range picker closes with Escape", () => {
  const trigger = createFakeElement();
  const popover = createFakeElement();
  const picker = createDateRangePicker({
    trigger,
    popover,
    startInput: createFakeElement(),
    endInput: createFakeElement(),
    today: new Date("2026-07-17T08:00:00Z"),
  });

  picker.setup();
  picker.open();
  let prevented = false;
  popover.listeners.keydown({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(popover.hidden, true);
  assert.equal(trigger["aria-expanded"], "false");
  assert.equal(trigger.focusCalled, true);
  assert.equal(prevented, true);
});

test("date range picker opens on the previous 30 days through today viewport", () => {
  const trigger = createFakeElement();
  const popover = createFakeElement();
  const startInput = createFakeElement();
  const endInput = createFakeElement();
  startInput.value = "2026-07-01";
  endInput.value = "2026-07-17";
  const picker = createDateRangePicker({
    trigger,
    popover,
    startInput,
    endInput,
    today: new Date("2026-07-17T08:00:00Z"),
  });

  picker.setup();
  picker.open();

  assert.match(popover.innerHTML, /2026 年 6 月/);
  assert.match(popover.innerHTML, /2026 年 7 月/);
  assert.doesNotMatch(popover.innerHTML, /2026 年 8 月/);
});

test("date range picker requires the end date within 30 days after the selected start date", () => {
  const trigger = createFakeElement();
  const popover = createFakeElement();
  const startInput = createFakeElement();
  const endInput = createFakeElement();
  const changes = [];
  const picker = createDateRangePicker({
    trigger,
    popover,
    startInput,
    endInput,
    today: new Date("2026-07-17T08:00:00Z"),
    onChange: (range) => changes.push(range),
  });

  picker.setup();
  picker.open();
  popover.listeners.click(createDateClickEvent("2026-07-01"));
  popover.listeners.click(createDateClickEvent("2026-08-15"));

  assert.equal(startInput.value, "2026-07-01");
  assert.equal(endInput.value, "2026-07-01");
  assert.equal(popover.hidden, false);
  assert.deepEqual(changes, []);
});

test("date range picker rejects dates after today for start and end selection", () => {
  const trigger = createFakeElement();
  const popover = createFakeElement();
  const startInput = createFakeElement();
  const endInput = createFakeElement();
  const changes = [];
  const picker = createDateRangePicker({
    trigger,
    popover,
    startInput,
    endInput,
    today: new Date("2026-07-17T08:00:00Z"),
    onChange: (range) => changes.push(range),
  });

  picker.setup();
  picker.open();
  popover.listeners.click(createDateClickEvent("2026-07-18"));

  assert.equal(startInput.value, "2026-07-17");
  assert.equal(endInput.value, "2026-07-17");
  assert.equal(popover.hidden, false);
  assert.deepEqual(changes, []);

  popover.listeners.click(createDateClickEvent("2026-07-01"));
  popover.listeners.click(createDateClickEvent("2026-07-18"));

  assert.equal(startInput.value, "2026-07-01");
  assert.equal(endInput.value, "2026-07-01");
  assert.equal(popover.hidden, false);
  assert.deepEqual(changes, []);
  assert.match(popover.innerHTML, /data-date-range-day="2026-07-18"[^>]*disabled/);
});

test("date range picker stops popover click propagation before rerendering days", () => {
  const trigger = createFakeElement();
  const popover = createFakeElement();
  const picker = createDateRangePicker({
    trigger,
    popover,
    startInput: createFakeElement(),
    endInput: createFakeElement(),
    today: new Date("2026-07-17T08:00:00Z"),
  });

  picker.setup();
  picker.open();
  const event = createDateClickEvent("2026-07-01");
  popover.listeners.click(event);

  assert.equal(event.propagationStopped, true);
  assert.equal(popover.hidden, false);
});

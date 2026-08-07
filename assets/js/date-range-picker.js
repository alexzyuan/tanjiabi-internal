const dayMs = 24 * 60 * 60 * 1000;
const maxRangeDays = 30;
export const DATE_RANGE_CHANGE_EVENT = "tanjia:date-range-change";
const autoRefreshRegistrations = new WeakMap();
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const defaultPresets = [
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["last7", "最近7天"],
  ["last30", "最近30天"],
  ["thisMonth", "本月"],
  ["lastMonth", "上月"],
  ["thisYear", "本年"],
  ["lastYear", "去年"],
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateText(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateText(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return dateText(date) === text ? date : null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months, 1);
  return next;
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date) {
  return new Date(date.getFullYear(), 11, 31);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function defaultVisibleMonth(today) {
  return startOfMonth(addDays(today, -(maxRangeDays - 1)));
}

function minDateText(first, second) {
  return first <= second ? first : second;
}

function maxCalendarMonthEnd(startDate, maxCalendarMonths) {
  return new Date(startDate.getFullYear(), startDate.getMonth() + maxCalendarMonths, 0);
}

export function normalizeDateRange(start, end, fallbackDate = new Date()) {
  const fallback = dateText(fallbackDate);
  const startText = parseDateText(start) ? String(start) : fallback;
  const endText = parseDateText(end) ? String(end) : startText;
  return startText <= endText ? { start: startText, end: endText } : { start: endText, end: startText };
}

export function formatDateRangeLabel(range) {
  const normalized = normalizeDateRange(range?.start, range?.end);
  return `${normalized.start} - ${normalized.end}`;
}

export function resolveDateRangePreset(preset, today = new Date()) {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterday = addDays(current, -1);
  const lastMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const lastYear = new Date(current.getFullYear() - 1, 0, 1);
  const ranges = {
    today: [current, current],
    yesterday: [yesterday, yesterday],
    last7: [addDays(current, -6), current],
    last30: [addDays(current, -29), current],
    thisMonth: [startOfMonth(current), current],
    lastMonth: [startOfMonth(lastMonth), endOfMonth(lastMonth)],
    thisYear: [startOfYear(current), current],
    lastYear: [startOfYear(lastYear), endOfYear(lastYear)],
  };
  const [start, end] = ranges[preset] || ranges.today;
  return { start: dateText(start), end: dateText(end) };
}

export function buildCalendarMonth({ year, monthIndex, range, previewRange = null, selectableRange = null, todayText = dateText(new Date()) } = {}) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const normalized = normalizeDateRange(range?.start, range?.end);
  const normalizedPreview = previewRange ? normalizeDateRange(previewRange.start, previewRange.end) : null;
  const selectableStart = selectableRange?.start || "";
  const selectableEnd = selectableRange?.end || "";
  const weeks = [];
  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const week = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const current = addDays(gridStart, weekIndex * 7 + dayIndex);
      const text = dateText(current);
      const isRangeStart = text === normalized.start;
      const isRangeEnd = text === normalized.end;
      const isSelectable = !selectableRange || (selectableStart <= text && text <= selectableEnd);
      const isPreviewInRange = Boolean(normalizedPreview && normalizedPreview.start <= text && text <= normalizedPreview.end);
      const isPreviewEnd = Boolean(normalizedPreview && text === normalizedPreview.end);
      week.push({
        date: text,
        day: current.getDate(),
        isCurrentMonth: current.getMonth() === monthIndex,
        isInRange: normalized.start <= text && text <= normalized.end,
        isPreviewEnd,
        isPreviewInRange,
        isRangeEnd,
        isRangeStart,
        isSelectable,
        isSelected: isRangeStart || isRangeEnd,
        isToday: text === todayText,
      });
    }
    weeks.push(week);
  }
  return {
    title: `${year} 年 ${monthIndex + 1} 月`,
    weekdays: weekdayLabels,
    weeks,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dayClassName(day) {
  return [
    "date-range-picker__day",
    day.isCurrentMonth ? "" : "is-outside-month",
    day.isInRange || day.isPreviewInRange ? "is-in-range" : "",
    day.isPreviewEnd ? "is-preview-end" : "",
    day.isRangeStart ? "is-range-start" : "",
    day.isRangeEnd ? "is-range-end" : "",
    day.isSelected ? "is-selected" : "",
    day.isToday ? "is-today" : "",
    day.isSelectable ? "" : "is-disabled",
  ].filter(Boolean).join(" ");
}

function renderMonth(month) {
  return `
    <section class="date-range-picker__month" aria-label="${escapeHtml(month.title)}">
      <h3>${escapeHtml(month.title)}</h3>
      <div class="date-range-picker__weekdays">${month.weekdays.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      <div class="date-range-picker__days">
        ${month.weeks.flat().map((day) => `
          <button class="${dayClassName(day)}" type="button" data-date-range-day="${escapeHtml(day.date)}" aria-pressed="${day.isSelected ? "true" : "false"}"${day.isSelectable ? "" : ' aria-disabled="true" disabled'}>
            ${escapeHtml(day.day)}
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function setInputValue(input, value) {
  if (!input) return;
  input.value = value;
  input.dispatchEvent?.(new Event("change", { bubbles: true }));
}

function dispatchDateRangeChange(trigger, range) {
  if (!trigger?.dispatchEvent) return;
  const detail = { range: { ...range } };
  const event = typeof globalThis.CustomEvent === "function"
    ? new CustomEvent(DATE_RANGE_CHANGE_EVENT, { bubbles: true, detail })
    : Object.assign(new Event(DATE_RANGE_CHANGE_EVENT, { bubbles: true }), { detail });
  trigger.dispatchEvent(event);
}

export function installDateRangeAutoRefresh({
  root = globalThis.document,
  refreshSelector = "[data-date-range-auto-refresh]",
} = {}) {
  if (!root?.addEventListener || !root?.removeEventListener) return () => {};
  const existing = autoRefreshRegistrations.get(root);
  if (existing) return existing;

  const handler = (event) => {
    const view = event?.target?.closest?.(".view") || root.querySelector?.(".view.active");
    view?.querySelector?.(refreshSelector)?.click?.();
  };
  const cleanup = () => {
    root.removeEventListener(DATE_RANGE_CHANGE_EVENT, handler);
    autoRefreshRegistrations.delete(root);
  };

  root.addEventListener(DATE_RANGE_CHANGE_EVENT, handler);
  autoRefreshRegistrations.set(root, cleanup);
  return cleanup;
}

export function createDateRangePicker({
  root = globalThis.document,
  trigger,
  triggerSelector = "",
  popover,
  popoverSelector = "",
  startInput,
  startInputSelector = "",
  endInput,
  endInputSelector = "",
  maxCalendarMonths = 0,
  today = new Date(),
  onChange = () => {},
} = {}) {
  const doc = root;
  const triggerElement = trigger || doc?.querySelector?.(triggerSelector);
  const popoverElement = popover || doc?.querySelector?.(popoverSelector);
  const startInputElement = startInput || doc?.querySelector?.(startInputSelector);
  const endInputElement = endInput || doc?.querySelector?.(endInputSelector);
  const todayText = dateText(today);
  let range = normalizeDateRange(startInputElement?.value, endInputElement?.value, today);
  let visibleMonth = defaultVisibleMonth(today);
  let selectingStart = true;
  let pendingStart = "";
  let previewEnd = "";

  function setPopoverOpen(open) {
    if (!popoverElement) return;
    popoverElement.hidden = !open;
    triggerElement?.setAttribute?.("aria-expanded", open ? "true" : "false");
  }

  function resetSelectionDraft() {
    selectingStart = true;
    pendingStart = "";
    previewEnd = "";
  }

  function openPopover() {
    resetSelectionDraft();
    visibleMonth = defaultVisibleMonth(today);
    render();
    setPopoverOpen(true);
  }

  function selectableRangeForCurrentStep() {
    const startDate = parseDateText(pendingStart);
    if (selectingStart || !startDate) {
      return {
        start: "0000-01-01",
        end: todayText,
      };
    }
    const maxEnd = maxCalendarMonths > 0
      ? dateText(maxCalendarMonthEnd(startDate, maxCalendarMonths))
      : dateText(addDays(startDate, maxRangeDays - 1));
    return {
      start: pendingStart,
      end: minDateText(maxEnd, todayText),
    };
  }

  function isSelectableDate(value) {
    const selectableRange = selectableRangeForCurrentStep();
    if (!selectableRange) return true;
    return selectableRange.start <= value && value <= selectableRange.end;
  }

  function syncInputs() {
    setInputValue(startInputElement, range.start);
    setInputValue(endInputElement, range.end);
    if (triggerElement) triggerElement.textContent = formatDateRangeLabel(range);
  }

  function render() {
    if (!popoverElement) return;
    const selectableRange = selectableRangeForCurrentStep();
    const previewRange = !selectingStart && pendingStart && previewEnd
      ? { start: pendingStart, end: previewEnd }
      : null;
    const leftMonth = buildCalendarMonth({
      year: visibleMonth.getFullYear(),
      monthIndex: visibleMonth.getMonth(),
      range,
      previewRange,
      selectableRange,
      todayText,
    });
    const rightDate = addMonths(visibleMonth, 1);
    const rightMonth = buildCalendarMonth({
      year: rightDate.getFullYear(),
      monthIndex: rightDate.getMonth(),
      range,
      previewRange,
      selectableRange,
      todayText,
    });
    popoverElement.classList?.add?.("date-range-picker__popover");
    popoverElement.innerHTML = `
      <div class="date-range-picker__shortcuts">
        ${defaultPresets.map(([key, label]) => `<button type="button" data-date-range-preset="${key}">${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="date-range-picker__calendar">
        <div class="date-range-picker__nav">
          <button type="button" data-date-range-nav="prevYear" aria-label="上一年">«</button>
          <button type="button" data-date-range-nav="prevMonth" aria-label="上一月">‹</button>
          <span></span>
          <button type="button" data-date-range-nav="nextMonth" aria-label="下一月">›</button>
          <button type="button" data-date-range-nav="nextYear" aria-label="下一年">»</button>
        </div>
        <div class="date-range-picker__months">
          ${renderMonth(leftMonth)}
          ${renderMonth(rightMonth)}
        </div>
      </div>
    `;
  }

  function applyRange(nextRange) {
    range = normalizeDateRange(nextRange.start, nextRange.end, today);
    visibleMonth = defaultVisibleMonth(today);
    resetSelectionDraft();
    syncInputs();
    render();
    dispatchDateRangeChange(triggerElement, range);
    onChange({ ...range });
  }

  function handlePopoverClick(event) {
    event.stopPropagation?.();
    const presetButton = event.target?.closest?.("[data-date-range-preset]");
    if (presetButton) {
      applyRange(resolveDateRangePreset(presetButton.dataset.dateRangePreset, today));
      setPopoverOpen(false);
      return;
    }
    const navButton = event.target?.closest?.("[data-date-range-nav]");
    if (navButton) {
      const delta = { prevYear: -12, prevMonth: -1, nextMonth: 1, nextYear: 12 }[navButton.dataset.dateRangeNav] || 0;
      visibleMonth = addMonths(visibleMonth, delta);
      render();
      return;
    }
    const dayButton = event.target?.closest?.("[data-date-range-day]");
    if (!dayButton) return;
    const selectedDate = dayButton.dataset.dateRangeDay;
    if (!isSelectableDate(selectedDate)) return;
    if (selectingStart) {
      pendingStart = selectedDate;
      previewEnd = "";
      range = { start: selectedDate, end: selectedDate };
      selectingStart = false;
      syncInputs();
      render();
      return;
    }
    applyRange(normalizeDateRange(pendingStart, selectedDate, today));
    setPopoverOpen(false);
  }

  function handlePopoverMouseover(event) {
    if (selectingStart || !pendingStart) return;
    const dayButton = event.target?.closest?.("[data-date-range-day]");
    if (!dayButton) return;
    const hoveredDate = dayButton.dataset.dateRangeDay;
    const nextPreviewEnd = isSelectableDate(hoveredDate) ? hoveredDate : "";
    if (previewEnd === nextPreviewEnd) return;
    previewEnd = nextPreviewEnd;
    render();
  }

  function handlePopoverMouseleave() {
    if (!previewEnd) return;
    previewEnd = "";
    render();
  }

  function isInsideDateRangeControl(target) {
    return Boolean(target?.closest?.(".date-range-control"))
      || target === triggerElement
      || target === popoverElement
      || Boolean(triggerElement?.contains?.(target))
      || Boolean(popoverElement?.contains?.(target));
  }

  function handleRootClick(event) {
    if (popoverElement?.hidden || isInsideDateRangeControl(event?.target)) return;
    setPopoverOpen(false);
  }

  function handleKeydown(event) {
    if (event?.key !== "Escape" || popoverElement?.hidden) return;
    event.preventDefault?.();
    setPopoverOpen(false);
    triggerElement?.focus?.();
  }

  function setup() {
    syncInputs();
    render();
    triggerElement?.setAttribute?.("aria-haspopup", "dialog");
    triggerElement?.setAttribute?.("aria-expanded", "false");
    triggerElement?.addEventListener?.("click", () => (popoverElement?.hidden ? openPopover() : setPopoverOpen(false)));
    triggerElement?.addEventListener?.("keydown", handleKeydown);
    doc?.addEventListener?.("click", handleRootClick);
    popoverElement?.addEventListener?.("click", handlePopoverClick);
    popoverElement?.addEventListener?.("mouseover", handlePopoverMouseover);
    popoverElement?.addEventListener?.("mousemove", handlePopoverMouseover);
    popoverElement?.addEventListener?.("mouseleave", handlePopoverMouseleave);
    popoverElement?.addEventListener?.("keydown", handleKeydown);
    return { applyRange, close: () => setPopoverOpen(false), open: openPopover, refresh: () => { range = normalizeDateRange(startInputElement?.value, endInputElement?.value, today); syncInputs(); render(); } };
  }

  return {
    applyRange,
    close: () => setPopoverOpen(false),
    getRange: () => ({ ...range }),
    open: openPopover,
    refresh: () => {
      range = normalizeDateRange(startInputElement?.value, endInputElement?.value, today);
      syncInputs();
      render();
      return { ...range };
    },
    setup,
  };
}

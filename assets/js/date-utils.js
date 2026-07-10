export const PACIFIC_TIME_ZONE = "America/Los_Angeles";
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getPacificDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

export function getPacificTodayDate(date = new Date()) {
  const parts = getPacificDateParts(date);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function getPacificTodayText(date = new Date()) {
  return formatDate(getPacificTodayDate(date));
}

export function formatCompactDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getWeekStart(date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

export function getDefaultFrontDateRange(date = new Date()) {
  const today = getPacificTodayDate(date);
  return {
    start: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: formatDate(today),
  };
}

export function getDateRangeByPreset(preset, date = new Date()) {
  const today = getPacificTodayDate(date);
  const yesterday = addDays(today, -1);
  const thisWeekStart = getWeekStart(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = addDays(thisMonthStart, -1);

  const ranges = {
    today: [today, today],
    yesterday: [yesterday, yesterday],
    last7: [addDays(today, -6), today],
    last30: [addDays(today, -29), today],
    thisWeek: [thisWeekStart, today],
    lastWeek: [lastWeekStart, addDays(thisWeekStart, -1)],
    thisMonth: [thisMonthStart, today],
    lastMonth: [lastMonthStart, lastMonthEnd],
  };

  return ranges[preset] || [today, today];
}

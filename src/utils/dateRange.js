import { formatDate, getPacificTodayDate } from "./pacificDate.js";

export { formatDate };

export function parseDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function listDateRange(startDate, endDate, maxDays = 31) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || start > end) return [];

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < maxDays) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function getDefaultWeekRange(configRange = {}) {
  if (configRange.startDate && configRange.endDate) {
    return {
      startDate: configRange.startDate,
      endDate: configRange.endDate,
    };
  }

  const end = getPacificTodayDate();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

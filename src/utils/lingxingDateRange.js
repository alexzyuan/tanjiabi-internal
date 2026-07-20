const DATE_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addDaysToDateText(dateText, days = 1) {
  const text = String(dateText || "").trim();
  const match = text.match(DATE_TEXT_RE);
  if (!match) throw new Error(`Invalid Lingxing date: ${dateText}`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`Invalid Lingxing date: ${dateText}`);
  }
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function lingxingExclusiveEndDate(endDate) {
  if (endDate === undefined || endDate === null || String(endDate).trim() === "") return endDate;
  return addDaysToDateText(endDate, 1);
}

export function withLingxingExclusiveEndDate(params = {}, { endKeys = ["end_date", "endDate"] } = {}) {
  const next = { ...params };
  for (const key of endKeys) {
    if (next[key] !== undefined && next[key] !== null && String(next[key]).trim() !== "") {
      next[key] = lingxingExclusiveEndDate(next[key]);
    }
  }
  return next;
}

export function buildLingxingDateRangeParams(
  { startDate, endDate } = {},
  { startKey = "start_date", endKey = "end_date" } = {},
) {
  return {
    [startKey]: startDate,
    [endKey]: lingxingExclusiveEndDate(endDate),
  };
}

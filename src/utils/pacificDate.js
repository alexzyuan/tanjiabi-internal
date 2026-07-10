const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

export function listFilterValues(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => listFilterValues(item))
      .filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function matchesAnyFilter(value, filters) {
  const values = listFilterValues(filters);
  return !values.length || values.includes(String(value || "").trim());
}

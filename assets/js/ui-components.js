const componentGlobal = globalThis.window || globalThis;

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampNumber(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function percentStyle(value, { min = 0, max = 100, variable = "--ui-meter-value" } = {}) {
  return `${variable}:${clampNumber(value, min, max).toFixed(2)}%`;
}

function normalizeTone(tone, fallback = "neutral") {
  const normalized = String(tone || "").trim().toLowerCase();
  if (["blue", "info", "positive", "success", "green", "warning", "orange", "danger", "error", "red", "neutral"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function toneClassName(prefix, tone, fallback = "neutral") {
  return `${prefix}--${normalizeTone(tone, fallback)}`;
}

function renderKpiProgress({
  value = 0,
  tone = "blue",
  label = "进度",
  className = "kpi-progress",
} = {}) {
  const clamped = clampNumber(value);
  return `<div class="${escapeAttribute(className)} ${toneClassName(className, tone, "blue")}" style="${percentStyle(clamped, { variable: "--progress" })}" role="progressbar" aria-label="${escapeAttribute(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clamped.toFixed(0)}"><span></span></div>`;
}

function renderMeterBar({
  value = 0,
  max = 100,
  tone = "neutral",
  label = "数据占比",
  className = "ui-meter",
  barClassName = "ui-meter__bar",
} = {}) {
  const denominator = Math.max(Number(max || 0), 1);
  const percent = clampNumber((Number(value || 0) / denominator) * 100);
  return `<span class="${escapeAttribute(className)} ${toneClassName(className, tone)}" role="meter" aria-label="${escapeAttribute(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(0)}"><span class="${escapeAttribute(barClassName)}" style="${percentStyle(percent)}"></span></span>`;
}

function normalizeBucketKey(key, index = 0) {
  const normalized = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `bucket-${index + 1}`;
}

function chartBucketClass(key, index = 0, prefix = "chart-bucket") {
  return `${prefix} ${prefix}--${normalizeBucketKey(key, index)} ${prefix}--${(index % 8) + 1}`;
}

function renderChartSwatch({
  key = "",
  index = 0,
  label = "",
  className = "bucket-dot",
} = {}) {
  return `<span class="${escapeAttribute(className)} ${chartBucketClass(key, index, "chart-bucket")}" aria-hidden="true"></span>${escapeAttribute(label)}`;
}

function configureModalElement(modalTarget, {
  root = componentGlobal.document,
  dialogSelector = "article",
  labelledBy = "",
  describedBy = "",
} = {}) {
  const modal = typeof modalTarget === "string" ? root?.querySelector?.(modalTarget) : modalTarget;
  if (!modal) return null;
  const dialog = modal.matches?.(dialogSelector) ? modal : modal.querySelector?.(dialogSelector);
  if (dialog?.setAttribute) {
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    if (labelledBy) dialog.setAttribute("aria-labelledby", labelledBy);
    if (describedBy) dialog.setAttribute("aria-describedby", describedBy);
  }
  return { modal, dialog: dialog || null };
}

const TanjiaUiComponents = {
  chartBucketClass,
  clampNumber,
  configureModalElement,
  normalizeBucketKey,
  normalizeTone,
  percentStyle,
  renderChartSwatch,
  renderKpiProgress,
  renderMeterBar,
  toneClassName,
};

componentGlobal.TanjiaUiComponents = TanjiaUiComponents;

export {
  chartBucketClass,
  clampNumber,
  configureModalElement,
  normalizeBucketKey,
  normalizeTone,
  percentStyle,
  renderChartSwatch,
  renderKpiProgress,
  renderMeterBar,
  toneClassName,
};

export default TanjiaUiComponents;

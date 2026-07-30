import {
  renderTableMessage,
  setButtonBusy,
  setText,
} from "./ui-utils.js?v=20260706-frontend-refactor-v41";

function resolveElement(selectorOrElement, root = globalThis.document) {
  return typeof selectorOrElement === "string" ? root?.querySelector?.(selectorOrElement) : selectorOrElement;
}

function resolveOverlayTarget({ root = globalThis.document, target = null, targetSelector = "" } = {}) {
  return resolveElement(target || targetSelector, root)
    || root?.querySelector?.(".view.active .dashboard-loading-scope")
    || root?.querySelector?.(".view.active")
    || root?.body
    || null;
}

export function showDashboardLoadingOverlay({
  root = globalThis.document,
  target = null,
  targetSelector = "",
  message = "数据加载中...",
} = {}) {
  if (typeof root?.createElement !== "function") return () => {};
  const overlayTarget = resolveOverlayTarget({ root, target, targetSelector });
  if (!overlayTarget?.appendChild) return () => {};
  overlayTarget.classList?.add?.("dashboard-loading-target");

  const overlay = root.createElement("div");
  overlay.className = "dashboard-loading-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.setAttribute("aria-label", message);

  const spinner = root.createElement("span");
  spinner.className = "dashboard-loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const copy = root.createElement("span");
  copy.className = "dashboard-loading-copy";

  const text = root.createElement("span");
  text.className = "dashboard-loading-text";
  text.textContent = message;
  copy.append(text);

  const progress = root.createElement("span");
  progress.className = "dashboard-loading-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");

  const progressBar = root.createElement("span");
  progressBar.className = "dashboard-loading-progress-bar";

  const percent = root.createElement("span");
  percent.className = "dashboard-loading-percent";
  progress.append(progressBar, percent);

  let progressValue = 8;
  const renderProgress = () => {
    const safeValue = Math.max(0, Math.min(100, Math.round(progressValue)));
    progress.setAttribute("aria-valuenow", String(safeValue));
    if (progressBar.style) progressBar.style.width = `${safeValue}%`;
    percent.textContent = `${safeValue}%`;
  };
  renderProgress();
  const progressTimer = globalThis.setInterval?.(() => {
    progressValue = Math.min(92, progressValue + Math.max(1, Math.round((92 - progressValue) * 0.16)));
    renderProgress();
  }, 450) || null;

  overlay.append(spinner, copy, progress);
  overlayTarget.appendChild(overlay);

  return () => {
    if (progressTimer !== null) globalThis.clearInterval?.(progressTimer);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlayTarget.classList?.remove?.("dashboard-loading-target");
  };
}

export function startDashboardLoadingOverlay({
  root = globalThis.document,
  target = null,
  targetSelector = "",
  message = "数据加载中...",
  delayMs = 300,
} = {}) {
  let hideOverlay = () => {};
  let timer = null;
  let cleanedUp = false;
  const showOverlay = () => {
    if (cleanedUp) return;
    hideOverlay = showDashboardLoadingOverlay({ root, target, targetSelector, message });
  };

  if (Number(delayMs) <= 0) {
    showOverlay();
  } else {
    timer = globalThis.setTimeout(showOverlay, Number(delayMs) || 300);
  }

  return () => {
    cleanedUp = true;
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
    hideOverlay();
  };
}

function defaultJsonError(response, data) {
  return data?.error || data?.meta?.syncStatus || `API ${response.status}`;
}

export async function loadDashboardSection({
  endpoint,
  fetchOptions = { cache: "no-store" },
  buttonSelector = null,
  busyText = "加载中...",
  restoreText = "",
  buttonBusyOptions = {},
  statusSelector = "",
  loadingStatus = "",
  tableSelector = null,
  tableColspan = 1,
  loadingMessage = "",
  validate = (response, data) => response.ok && data?.ok !== false,
  errorMessage = defaultJsonError,
  onData = () => {},
  onError = () => {},
  onFinally = () => {},
  loadingOverlay = {},
  root = globalThis.document,
  fetchApi = globalThis.fetch,
} = {}) {
  if (!endpoint) throw new Error("loadDashboardSection requires an endpoint.");
  if (typeof fetchApi !== "function") throw new Error("loadDashboardSection requires fetch.");

  const button = resolveElement(buttonSelector, root);
  const table = resolveElement(tableSelector, root);
  const restoreButton = setButtonBusy(button, busyText, restoreText || button?.textContent || "", buttonBusyOptions);
  const hideLoadingOverlay = loadingOverlay === false ? () => {} : startDashboardLoadingOverlay({
    root,
    target: typeof loadingOverlay === "object" ? loadingOverlay.target : null,
    targetSelector: typeof loadingOverlay === "object" ? loadingOverlay.targetSelector : "",
    message: typeof loadingOverlay === "object" ? loadingOverlay.message : undefined,
    delayMs: typeof loadingOverlay === "object" ? loadingOverlay.delayMs : undefined,
  });

  if (statusSelector && loadingStatus) setText(statusSelector, loadingStatus, root);
  if (table && loadingMessage) renderTableMessage(table, tableColspan, loadingMessage, root);

  try {
    const response = await fetchApi(endpoint, fetchOptions);
    const data = await response.json();
    if (!validate(response, data)) {
      throw Object.assign(new Error(errorMessage(response, data)), { payload: data, response });
    }
    await onData(data, response);
    return { ok: true, data, response };
  } catch (error) {
    await onError(error);
    return { ok: false, error };
  } finally {
    await onFinally();
    hideLoadingOverlay();
    restoreButton();
  }
}

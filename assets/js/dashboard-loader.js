import {
  renderTableMessage,
  setButtonBusy,
  setText,
} from "./ui-utils.js?v=20260706-frontend-refactor-v41";

function resolveElement(selectorOrElement, root = globalThis.document) {
  return typeof selectorOrElement === "string" ? root?.querySelector?.(selectorOrElement) : selectorOrElement;
}

export function showDashboardLoadingOverlay({
  root = globalThis.document,
  message = "数据加载中...",
} = {}) {
  if (!root?.body || typeof root.createElement !== "function") return () => {};
  const overlay = root.createElement("div");
  overlay.className = "dashboard-loading-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.setAttribute("aria-label", message);

  const spinner = root.createElement("span");
  spinner.className = "dashboard-loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const text = root.createElement("span");
  text.className = "dashboard-loading-text";
  text.textContent = message;

  overlay.append(spinner, text);
  root.body.appendChild(overlay);

  return () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  };
}

export function startDashboardLoadingOverlay({
  root = globalThis.document,
  message = "数据加载中...",
  delayMs = 300,
} = {}) {
  let hideOverlay = () => {};
  let timer = null;
  let cleanedUp = false;
  const showOverlay = () => {
    if (cleanedUp) return;
    hideOverlay = showDashboardLoadingOverlay({ root, message });
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

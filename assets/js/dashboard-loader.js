import {
  renderTableMessage,
  setButtonBusy,
  setText,
} from "./ui-utils.js?v=20260706-frontend-refactor-v41";

const MANAGED_LOADING_REQUEST = Symbol.for("tanjia.dashboard.loading.managed-request");
const GLOBAL_FETCH_OVERLAY_STATE = Symbol.for("tanjia.dashboard.loading.fetch-overlay-state");

function resolveElement(selectorOrElement, root = globalThis.document) {
  return typeof selectorOrElement === "string" ? root?.querySelector?.(selectorOrElement) : selectorOrElement;
}

function bannerAdjacentFilterOffset(target) {
  const filter = target?.querySelector?.(":scope > .module-hero + :is(.filters, .filter-toolbar)")
    || target?.querySelector?.(".filters, .filter-toolbar");
  if (!filter) return 0;
  const top = Number(filter.offsetTop || 0) - Number(target.offsetTop || 0);
  const height = Number(filter.offsetHeight || 0);
  return Math.max(0, Math.round(top + height));
}

function resolveOverlayTarget({ root = globalThis.document, target = null, targetSelector = "" } = {}) {
  const explicitTarget = resolveElement(target || targetSelector, root);
  if (explicitTarget) return { element: explicitTarget, topOffset: 0 };

  const scopedTarget = root?.querySelector?.(".view.active .dashboard-loading-scope");
  if (scopedTarget) return { element: scopedTarget, topOffset: 0 };

  const activeView = root?.querySelector?.(".view.active");
  if (activeView) return { element: activeView, topOffset: bannerAdjacentFilterOffset(activeView) };
  if (root?.body) return { element: root.body, topOffset: 0 };
  return { element: null, topOffset: 0 };
}

function isReadApiRequest(input, options = {}) {
  if (options?.[MANAGED_LOADING_REQUEST]) return false;
  const method = String(options?.method || input?.method || "GET").toUpperCase();
  if (method !== "GET") return false;
  const url = typeof input === "string" ? input : input?.url;
  if (!url) return false;
  if (url.startsWith("/api/")) return true;
  try {
    const parsed = new URL(url, globalThis.location?.origin || "http://localhost");
    return parsed.origin === (globalThis.location?.origin || parsed.origin) && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export function markDashboardLoadingRequest(options = {}) {
  const requestOptions = { ...options };
  Object.defineProperty(requestOptions, MANAGED_LOADING_REQUEST, { value: true });
  return requestOptions;
}

export function installDashboardLoadingFetchOverlay({
  root = globalThis.document,
  globalObject = globalThis,
  delayMs = 300,
  message = "数据加载中...",
} = {}) {
  if (typeof globalObject?.fetch !== "function") return () => {};
  const existingState = globalObject[GLOBAL_FETCH_OVERLAY_STATE];
  if (existingState?.restore) return existingState.restore;

  const fetchImpl = globalObject.fetch;
  let pendingCount = 0;
  let hideOverlay = () => {};
  const wrappedFetch = async (input, options) => {
    if (!isReadApiRequest(input, options)) return fetchImpl(input, options);
    pendingCount += 1;
    if (pendingCount === 1) {
      hideOverlay = startDashboardLoadingOverlay({ root, delayMs, message });
    }
    try {
      return await fetchImpl(input, options);
    } finally {
      pendingCount = Math.max(0, pendingCount - 1);
      if (pendingCount === 0) {
        hideOverlay();
        hideOverlay = () => {};
      }
    }
  };
  const restore = () => {
    if (globalObject.fetch === wrappedFetch) globalObject.fetch = fetchImpl;
    hideOverlay();
    delete globalObject[GLOBAL_FETCH_OVERLAY_STATE];
  };

  globalObject.fetch = wrappedFetch;
  globalObject[GLOBAL_FETCH_OVERLAY_STATE] = { restore };
  return restore;
}

export function showDashboardLoadingOverlay({
  root = globalThis.document,
  target = null,
  targetSelector = "",
  message = "数据加载中...",
} = {}) {
  if (typeof root?.createElement !== "function") return () => {};
  const { element: overlayTarget, topOffset } = resolveOverlayTarget({ root, target, targetSelector });
  if (!overlayTarget?.appendChild) return () => {};
  overlayTarget.classList?.add?.("dashboard-loading-target");

  const overlay = root.createElement("div");
  overlay.className = "dashboard-loading-overlay";
  if (topOffset > 0) overlay.style?.setProperty?.("--dashboard-loading-overlay-top", `${topOffset}px`);
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
    const response = await fetchApi(endpoint, markDashboardLoadingRequest(fetchOptions));
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

import {
  renderTableMessage,
  setButtonBusy,
  setText,
} from "./ui-utils.js?v=20260706-frontend-refactor-v41";

function resolveElement(selectorOrElement, root = globalThis.document) {
  return typeof selectorOrElement === "string" ? root?.querySelector?.(selectorOrElement) : selectorOrElement;
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
  root = globalThis.document,
  fetchApi = globalThis.fetch,
} = {}) {
  if (!endpoint) throw new Error("loadDashboardSection requires an endpoint.");
  if (typeof fetchApi !== "function") throw new Error("loadDashboardSection requires fetch.");

  const button = resolveElement(buttonSelector, root);
  const table = resolveElement(tableSelector, root);
  const restoreButton = setButtonBusy(button, busyText, restoreText || button?.textContent || "", buttonBusyOptions);

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
    restoreButton();
  }
}

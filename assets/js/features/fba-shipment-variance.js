import { createDateRangePicker } from "../date-range-picker.js?v=20260803-date-auto-refresh-v1";

export function createFbaShipmentVarianceFeature({
  root = globalThis.document,
  bind,
  bindBackdropClose,
  closestTarget,
  createDateRangePickerImpl = createDateRangePicker,
  escapeHtml,
  fbaValue,
  fetchImpl = globalThis.fetch,
  formatDate,
  formatNumber,
  getCurrentAuthUser = () => null,
  getFbaShops,
  loadFbaShops,
  normalizeFbaShop,
  renderTableMessage,
  setModalOpenState,
  setText,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaShipmentVarianceFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaShipmentVarianceFeature requires fetch.");
  let rows = [];
  let loaded = false;
  let loading = false;
  let picker = null;
  let pendingFollowupKey = "";
  const query = (selector) => root?.querySelector?.(selector) || null;
  const value = (selector) => fbaValue?.(selector) || "";

  function setDefaults() {
    const end = query("#fba-shipment-variance-end-date");
    const start = query("#fba-shipment-variance-start-date");
    if (end && !end.value) end.value = formatDate(new Date());
    if (start && !start.value) {
      const date = new Date();
      date.setDate(date.getDate() - 29);
      start.value = formatDate(date);
    }
    picker?.refresh?.();
  }

  function renderShopOptions() {
    const select = query("#fba-shipment-variance-sid");
    if (!select) return;
    const previous = select.value;
    const shops = (getFbaShops?.() || []).map(normalizeFbaShop).filter((shop) => shop?.sid);
    select.innerHTML = `<option value="">全部店铺</option>${shops.map((shop) => `<option value="${escapeHtml(shop.sid)}">${escapeHtml(shop.name)} · ${escapeHtml(shop.country)}</option>`).join("")}`;
    if (previous) select.value = previous;
  }

  function buildQuery({ forceRefresh = false } = {}) {
    const params = new URLSearchParams();
    [["startDate", value("#fba-shipment-variance-start-date")], ["endDate", value("#fba-shipment-variance-end-date")], ["sids", value("#fba-shipment-variance-sid")], ["shipmentStatus", value("#fba-shipment-variance-status-filter") || "RECEIVING,CLOSED"], ["followupStatus", value("#fba-shipment-variance-followup-status")]].forEach(([key, item]) => {
      if (item) params.set(key, item);
    });
    if (forceRefresh) params.set("forceRefresh", "true");
    params.set("length", "500");
    return params;
  }

  function setLoading(next) {
    loading = Boolean(next);
    const button = query("#fba-shipment-variance-refresh");
    if (button) button.disabled = loading;
  }

  function setStatus(message) { setText?.("#fba-shipment-variance-status", message, root); }

  function renderSummary(summary = {}) {
    setText?.("#fba-shipment-variance-receiving", formatNumber(summary.receiving || 0), root);
    setText?.("#fba-shipment-variance-closed-shortage", formatNumber(summary.closedShortage || 0), root);
    setText?.("#fba-shipment-variance-due", formatNumber(summary.dueWithinSevenDays || 0), root);
    setText?.("#fba-shipment-variance-overdue", formatNumber(summary.overdue || 0), root);
  }

  function renderRows() {
    const table = query("#fba-shipment-variance-table");
    if (!table) return;
    if (!rows.length) return renderTableMessage(table, 13, "当前筛选没有货件差异。");
    table.innerHTML = rows.map((row) => {
      const canFollow = row.investigationStatus === "待调查";
      const followed = Boolean(row.followup?.followedUp);
      return `<tr>
        <td>${escapeHtml(row.storeName || row.sid || "-")}</td><td>${escapeHtml(row.shipmentId || "-")}</td><td>${escapeHtml(row.mskus || "-")}</td>
        <td><span class="risk-badge">${escapeHtml(row.shipmentStatus || "-")}</span><br /><small>${escapeHtml(row.investigationStatus || "-")}</small></td>
        <td>${formatNumber(row.shippedQuantity || 0)}</td><td>${formatNumber(row.receivedQuantity || 0)}</td><td>${formatNumber(row.differenceQuantity || 0)}</td>
        <td>${escapeHtml(row.createdAt || "-")}</td><td>${escapeHtml(row.updatedAt || "-")}</td><td>${escapeHtml(row.closedAt || "-")}</td><td>${escapeHtml(row.sla?.display || "—")}</td>
        <td>${followed ? `${escapeHtml(row.followup.status || "已跟进")}<br /><small>${escapeHtml(row.followup.followedUpBy || "")}</small>` : "待跟进"}</td>
        <td class="table-actions">${canFollow ? `<button class="primary-button compact-button" type="button" data-fba-shipment-variance-followup="${escapeHtml(`${row.sid}:${row.shipmentId}`)}" data-fba-shipment-variance-followup-status="${escapeHtml(row.followup?.status || "已跟进")}">跟进</button>` : ""}</td>
      </tr>`;
    }).join("");
  }

  function openFollowup(button) {
    pendingFollowupKey = button.dataset.fbaShipmentVarianceFollowup;
    const user = getCurrentAuthUser?.() || {};
    setText?.("#fba-shipment-variance-followup-user", user.displayName || user.nick || user.username || "当前登录用户", root);
    const status = query("#fba-shipment-variance-followup-select");
    if (status) status.value = button.dataset.fbaShipmentVarianceFollowupStatus || "已跟进";
    setModalOpenState?.(query("#fba-shipment-variance-followup-modal"), true);
  }

  async function loadFbaShipmentVariances({ forceRefresh = false } = {}) {
    if (loading) return;
    setDefaults(); setLoading(true); setStatus("正在读取领星货件差异...");
    try {
      const response = await fetchImpl(`/api/fba/shipment-variances?${buildQuery({ forceRefresh })}`);
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      rows = data.rows || []; loaded = true; renderSummary(data.summary); renderRows(); setStatus(`已读取 ${formatNumber(rows.length)} 个货件`);
    } catch (error) {
      rows = []; renderSummary(); renderTableMessage(query("#fba-shipment-variance-table"), 13, `读取失败：${error.message || error}`); setStatus(`读取失败：${error.message || error}`);
    } finally { setLoading(false); }
  }

  async function updateFollowup(key, followupStatus) {
    const [sid, ...shipmentParts] = String(key || "").split(":");
    const shipmentId = shipmentParts.join(":");
    if (!sid || !shipmentId) throw new Error("货件跟进操作缺少业务键。");
    const response = await fetchImpl(`/api/fba/shipment-variances/${encodeURIComponent(sid)}/${encodeURIComponent(shipmentId)}/followup`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ followupStatus }) });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
    await loadFbaShipmentVariances({ forceRefresh: true });
  }

  async function loadFbaShipmentVarianceInitial() {
    setDefaults(); await loadFbaShops?.(); renderShopOptions(); if (!loaded) await loadFbaShipmentVariances(); else renderRows();
  }

  function setupFbaShipmentVariance() {
    setDefaults();
    picker = createDateRangePickerImpl({ root, triggerSelector: "#fba-shipment-variance-date-range-button", popoverSelector: "#fba-shipment-variance-date-range-popover", startInputSelector: "#fba-shipment-variance-start-date", endInputSelector: "#fba-shipment-variance-end-date" });
    picker.setup?.();
    bind(root, "#fba-shipment-variance-refresh", "click", () => loadFbaShipmentVariances({ forceRefresh: true }));
    bind(root, "#fba-shipment-variance-table", "click", async (event) => {
      const follow = closestTarget(event, "[data-fba-shipment-variance-followup]"); if (follow) openFollowup(follow);
    });
    bind(root, "#fba-shipment-variance-followup-cancel", "click", () => setModalOpenState?.(query("#fba-shipment-variance-followup-modal"), false));
    bind(root, "#fba-shipment-variance-followup-confirm", "click", async () => { await updateFollowup(pendingFollowupKey, value("#fba-shipment-variance-followup-select")); setModalOpenState?.(query("#fba-shipment-variance-followup-modal"), false); });
    bindBackdropClose?.(root, "#fba-shipment-variance-followup-modal", () => setModalOpenState?.(query("#fba-shipment-variance-followup-modal"), false));
  }
  return { loadFbaShipmentVarianceInitial, loadFbaShipmentVariances, renderFbaShipmentVarianceShopOptions: renderShopOptions, setupFbaShipmentVariance };
}

export function createSlowMovingRiskFeature({
  root = globalThis.document,
  bind,
  bindAll,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  formatActualMoney,
  formatNumber,
  formatPercent,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
} = {}) {
  if (typeof bind !== "function") throw new Error("createSlowMovingRiskFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createSlowMovingRiskFeature requires bindAll.");
  if (typeof fetchImpl !== "function") throw new Error("createSlowMovingRiskFeature requires fetchImpl.");

  let activeTab = "weekly";
  let reports = [];

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function text(value, fallback = "—") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function money(value) {
    return value === null || value === undefined ? "—" : formatActualMoney(value);
  }

  function percent(value) {
    return value === null || value === undefined ? "—" : formatPercent(value);
  }

  async function fetchJson(url) {
    const response = await fetchImpl(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "动销预警读取失败");
    return data;
  }

  function renderTabs() {
    root?.querySelectorAll?.("[data-slow-moving-risk-tab]").forEach((button) => {
      const active = button.dataset.slowMovingRiskTab === activeTab;
      button.classList?.toggle("is-active", active);
      button.setAttribute?.("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    root?.querySelectorAll?.("[data-slow-moving-risk-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.slowMovingRiskPanel !== activeTab;
    });
  }

  function renderRows(rows = []) {
    const table = query("#slow-moving-risk-table");
    if (!table) return;
    table.innerHTML = rows.length ? rows.map((row) => `
      <tr class="slow-moving-risk-row slow-moving-risk-row--${escapeHtml(row.riskLevel || "正常")}">
        <td>${escapeHtml(text(row.riskLevel))}</td>
        <td>${escapeHtml(text(row.storeName))}<br /><small>${escapeHtml(text(row.country))}</small></td>
        <td>${escapeHtml(text(row.msku))}</td>
        <td>${formatNumber(row.availableQuantity || 0)}<br /><strong>${formatNumber(row.agedQuantity || 0)}</strong></td>
        <td>${money(row.inventoryAmount)}<br /><strong>${money(row.agedInventoryAmount)}</strong></td>
        <td>${formatNumber(row.historicalDaysOfSupply || 0)}天<br /><strong>${percent(row.cashConversionRate)}</strong></td>
        <td>${formatNumber(row.recent30SalesQuantity || 0)}<br /><span class="${row.recent30GrossProfit < 0 ? "metric-danger" : ""}">${money(row.recent30GrossProfit)} / ${row.averageGrossProfit === null ? "无销量" : money(row.averageGrossProfit)}</span></td>
        <td>${money(row.recent30AdSpend)}<br />${percent(row.adShare)} / ${percent(row.acos)}${row.adWaste ? "<br /><strong>广告浪费</strong>" : ""}</td>
        <td><strong>${money(row.cashRiskAmount)}</strong></td>
        <td>${escapeHtml(text(row.currencyCode, "原币"))} ${money(row.clearanceRecoveryOriginal)}<br />${escapeHtml(text(row.currencyCode, "原币"))} ${money(row.liquidationRecoveryOriginal)}</td>
        <td>${row.removalFeeStatus === "unavailable" ? escapeHtml(text(row.removalFeeReason)) : money(row.removalFeeOriginal)}</td>
        <td><strong>${escapeHtml(text(row.recommendation, "待评估"))}</strong><br /><small>${escapeHtml(text(row.recommendationReason, "—"))}</small></td>
      </tr>
    `).join("") : "<tr><td colspan=\"12\">当前筛选下没有滞销风险 SKU。</td></tr>";
  }

  function renderDashboard(dashboard = {}, { preview = false } = {}) {
    const kpis = dashboard.kpis || {};
    setText("#slow-moving-risk-kpi-count", formatNumber(kpis.highRiskSkuCount || 0), root);
    setText("#slow-moving-risk-kpi-quantity", formatNumber(kpis.agedInventoryQuantity || 0), root);
    setText("#slow-moving-risk-kpi-amount", money(kpis.agedInventoryAmount), root);
    setText("#slow-moving-risk-kpi-profit", money(kpis.recent30GrossProfit), root);
    const sourceStatus = Object.values(dashboard.meta?.dataSources || {}).map((item) => item.status).join(" / ") || "快照";
    setText("#slow-moving-risk-status", `${preview ? "实时预览，未保存为定时周报" : "周报快照"} · 截至 ${dashboard.dateRange?.endDate || "—"} · ${dashboard.meta?.generatedAt || "—"} · ${sourceStatus}`, root);
    renderRows(dashboard.rows || []);
  }

  function populateFilters(filters = {}) {
    setSelectOptions("#slow-moving-risk-country-filter", filters.countryOptions || [], "全部国家");
    setSelectOptions("#slow-moving-risk-store-filter", filters.storeOptions || [], "全部店铺");
    setSelectOptions("#slow-moving-risk-owner-filter", filters.ownerOptions || [], "全部运营");
  }

  function successfulReports() {
    return reports.filter((report) => report.status === "success" && report.reportKey);
  }

  function populateHistoryReports(selectedReportKey = "") {
    setSelectOptions("#slow-moving-risk-history-select", successfulReports().map((report) => ({
      value: report.reportKey,
      label: `截至 ${report.reportKey}`,
    })), "暂无历史周报");
    const select = query("#slow-moving-risk-history-select");
    if (select && selectedReportKey) select.value = selectedReportKey;
  }

  function showLoadError(error) {
    setText("#slow-moving-risk-status", `动销预警读取失败：${error.message}`, root);
  }

  function liveQuery() {
    const params = new URLSearchParams();
    const country = selectedFilterValues("#slow-moving-risk-country-filter", root).join(",");
    const storeName = selectedFilterValues("#slow-moving-risk-store-filter", root).join(",");
    const listingOwner = query("#slow-moving-risk-owner-filter")?.value || "";
    const riskLevel = query("#slow-moving-risk-level-filter")?.value || "";
    if (country) params.set("country", country);
    if (storeName) params.set("storeName", storeName);
    if (listingOwner) params.set("listingOwner", listingOwner);
    if (riskLevel) params.set("riskLevel", riskLevel);
    return params.toString();
  }

  async function loadSlowMovingRiskLive() {
    const queryString = liveQuery();
    const dashboard = await fetchJson(`/api/dashboard/slow-moving-risk/live${queryString ? `?${queryString}` : ""}`);
    populateFilters(dashboard.filters);
    renderDashboard(dashboard, { preview: true });
  }

  async function loadSlowMovingRiskReport(reportKey) {
    const report = await fetchJson(`/api/dashboard/slow-moving-risk/reports/${encodeURIComponent(reportKey)}`);
    renderDashboard(report.dashboard || report, { preview: false });
    populateHistoryReports(reportKey);
  }

  async function loadSlowMovingRiskView() {
    const directory = await fetchJson("/api/dashboard/slow-moving-risk/reports");
    reports = Array.isArray(directory) ? directory : directory.reports || [];
    const latest = successfulReports()[0];
    populateHistoryReports(latest?.reportKey || "");
    if (latest) {
      await loadSlowMovingRiskReport(latest.reportKey);
      return;
    }
    activeTab = "live";
    renderTabs();
    await loadSlowMovingRiskLive();
  }

  async function setSlowMovingRiskTab(tab) {
    activeTab = tab;
    renderTabs();
    if (tab === "live") return loadSlowMovingRiskLive();
    if (tab === "weekly") return loadSlowMovingRiskView();
    const latest = successfulReports()[0];
    if (latest) return loadSlowMovingRiskReport(latest.reportKey);
    setText("#slow-moving-risk-status", "暂无已生成周报", root);
  }

  async function refreshSlowMovingRisk() {
    const button = query("#slow-moving-risk-refresh");
    const restoreButton = setButtonBusy(button, "刷新中", button?.textContent || "刷新数据");
    try {
      await setSlowMovingRiskTab(activeTab);
    } catch (error) {
      setText("#slow-moving-risk-status", `动销预警读取失败：${error.message}`, root);
      renderRows([]);
    } finally {
      restoreButton();
    }
  }

  function handleTabKeydown(event) {
    if (!event || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
    const tabs = [...(root?.querySelectorAll?.("[data-slow-moving-risk-tab]") || [])];
    const index = tabs.findIndex((tab) => tab.dataset.slowMovingRiskTab === activeTab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    event.preventDefault();
    next?.focus?.();
    setSlowMovingRiskTab(next?.dataset?.slowMovingRiskTab).catch((error) => setText("#slow-moving-risk-status", `动销预警读取失败：${error.message}`, root));
  }

  function setupSlowMovingRisk() {
    bind(root, "#slow-moving-risk-refresh", "click", refreshSlowMovingRisk);
    bind(root, "#slow-moving-risk-country-filter", "change", () => {
      syncAllOptionSelection(query("#slow-moving-risk-country-filter"));
      loadSlowMovingRiskLive().catch(showLoadError);
    });
    bind(root, "#slow-moving-risk-store-filter", "change", () => {
      syncAllOptionSelection(query("#slow-moving-risk-store-filter"));
      loadSlowMovingRiskLive().catch(showLoadError);
    });
    bind(root, "#slow-moving-risk-owner-filter", "change", () => loadSlowMovingRiskLive().catch(showLoadError));
    bind(root, "#slow-moving-risk-level-filter", "change", () => loadSlowMovingRiskLive().catch(showLoadError));
    bind(root, "#slow-moving-risk-history-select", "change", (event) => {
      const reportKey = event.currentTarget?.value;
      if (reportKey) loadSlowMovingRiskReport(reportKey).catch(showLoadError);
    });
    bindAll(root, "[data-slow-moving-risk-tab]", "click", (event) => setSlowMovingRiskTab(event.currentTarget.dataset.slowMovingRiskTab).catch(showLoadError));
    bindAll(root, "[data-slow-moving-risk-tab]", "keydown", handleTabKeydown);
  }

  return { loadSlowMovingRiskView, loadSlowMovingRiskLive, loadSlowMovingRiskReport, setSlowMovingRiskTab, renderDashboard, setupSlowMovingRisk };
}

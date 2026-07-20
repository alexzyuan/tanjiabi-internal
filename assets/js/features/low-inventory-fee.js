export function createLowInventoryFeeFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  getDefaultDate,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createLowInventoryFeeFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createLowInventoryFeeFeature requires bind.");

  let lowFeeStoreFilterOptions = [];

  function populateLowFeeCountryOptions(options = []) {
    setSelectOptions("#lowfee-country", options, "全部国家");
  }

  function populateLowFeeStoreOptions(options = [], { selectAllStores = false } = {}) {
    lowFeeStoreFilterOptions = options || [];
    const countries = selectedFilterValues("#lowfee-country", root);
    setSelectOptions("#lowfee-store", lowFeeStoreFilterOptions, "全部店铺", { groupByCountry: true, countries, selectAllVisible: selectAllStores });
  }

  function riskClassName(level) {
    if (level === "高") return "risk-high";
    if (level === "中") return "risk-mid";
    if (level === "低") return "risk-low";
    return "";
  }

  function setDefaultLowInventoryFeeDate() {
    const dateInput = root?.querySelector?.("#lowfee-date");
    if (dateInput && !dateInput.value) dateInput.value = getDefaultDate();
  }

  function renderLowInventoryFee(data) {
    const kpis = data.kpis || {};
    setText("#lowfee-msku-count", formatNumber(kpis.mskuCount || 0), root);
    setText("#lowfee-risk-count", formatNumber(kpis.riskCount || 0), root);
    setText("#lowfee-high-count", formatNumber(kpis.highRiskCount || 0), root);
    setText("#lowfee-band-days", `${formatActualMoney(kpis.avgHistoricalDays || 0)}天`, root);
    setText("#lowfee-status", `${data.meta?.source || "数据源"} · ${data.meta?.date || ""} · ${data.meta?.syncStatus || ""}`, root);
    setText("#lowfee-rule", data.meta?.ruleText || "按领星 FBA 库存明细的亚马逊历史供货天数判断：低于28天红色，低于35天橙色，低于42天浅黄色", root);
    populateLowFeeCountryOptions(data.filters?.countryOptions || []);
    populateLowFeeStoreOptions(data.filters?.storeOptions || []);

    const table = root?.querySelector?.("#lowfee-table");
    if (!table) return;
    const rows = data.rows || [];
    if (!rows.length) {
      renderTableMessage(table, 12, "暂无符合条件的低库存费预警。", root, { tone: "empty" });
      return;
    }
    table.innerHTML = rows.map((item) => `
      <tr class="${item.eligible ? `lowfee-warning-row ${riskClassName(item.riskLevel)}` : ""}">
        <td><span class="risk-badge ${riskClassName(item.riskLevel)}">${escapeHtml(item.riskLevel || "正常")}</span></td>
        <td>${escapeHtml(item.storeName || "-")}</td>
        <td>${escapeHtml(item.country || "-")}</td>
        <td>${escapeHtml(item.fnsku || "-")}</td>
        <td><strong>${escapeHtml(item.msku || "-")}</strong></td>
        <td>${escapeHtml(item.productName || item.title || "-")}</td>
        <td>${formatNumber(item.inventoryAvailable || 0)}</td>
        <td>${formatNumber(item.inventoryTransfer || 0)}</td>
        <td>${formatNumber(item.inventoryInbound || 0)}</td>
        <td>${item.amazonHistoricalDays ? `${formatActualMoney(item.amazonHistoricalDays)}天` : "-"}</td>
        <td>${escapeHtml(item.feeApplied || "-")}</td>
        <td>${escapeHtml(item.reason || "-")}</td>
      </tr>
    `).join("");
  }

  function buildLowFeeQuery() {
    const params = new URLSearchParams();
    const date = fieldValue("#lowfee-date", "", root) || getDefaultDate();
    const country = selectedFilterValue("#lowfee-country", root);
    const storeName = selectedFilterValue("#lowfee-store", root);
    const keyword = trimmedFieldValue("#lowfee-keyword", "", root);
    const onlyRisk = fieldValue("#lowfee-only-risk", "", root) || "1";
    if (date) params.set("date", date);
    if (country) params.set("country", country);
    if (storeName) params.set("storeName", storeName);
    if (keyword) params.set("keyword", keyword);
    params.set("onlyRisk", onlyRisk);
    params.set("currencyCode", "ORIGINAL");
    return params.toString();
  }

  async function loadLowInventoryFee() {
    setDefaultLowInventoryFeeDate();
    await loadDashboardSection({
      endpoint: `/api/dashboard/low-inventory-fee?${buildLowFeeQuery()}`,
      buttonSelector: "#lowfee-refresh",
      busyText: "刷新中...",
      restoreText: "刷新预警",
      buttonBusyOptions: { disable: false },
      statusSelector: "#lowfee-status",
      loadingStatus: "正在读取FBA库存明细",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || `API ${response.status}`,
      onData: renderLowInventoryFee,
      onError: (error) => {
        setText("#lowfee-status", `低库存费预警加载失败：${error.message}`, root);
        const table = root?.querySelector?.("#lowfee-table");
        renderTableMessage(table, 12, "加载失败，请稍后重试。", root, { tone: "error" });
      },
      root,
    });
  }

  function handleLowFeeCountryChange() {
    syncAllOptionSelection(root?.querySelector?.("#lowfee-country"));
    populateLowFeeStoreOptions(lowFeeStoreFilterOptions, { selectAllStores: true });
    loadLowInventoryFee();
  }

  function handleLowFeeStoreChange() {
    syncAllOptionSelection(root?.querySelector?.("#lowfee-store"));
    loadLowInventoryFee();
  }

  function handleLowFeeKeywordKeydown(event) {
    if (event.key === "Enter") loadLowInventoryFee();
  }

  function setupLowInventoryFee() {
    bind(root, "#lowfee-refresh", "click", loadLowInventoryFee);
    bind(root, "#lowfee-date", "change", loadLowInventoryFee);
    bind(root, "#lowfee-country", "change", handleLowFeeCountryChange);
    bind(root, "#lowfee-store", "change", handleLowFeeStoreChange);
    bind(root, "#lowfee-only-risk", "change", loadLowInventoryFee);
    bind(root, "#lowfee-keyword", "keydown", handleLowFeeKeywordKeydown);
  }

  return {
    buildLowFeeQuery,
    loadLowInventoryFee,
    renderLowInventoryFee,
    setDefaultLowInventoryFeeDate,
    setupLowInventoryFee,
  };
}

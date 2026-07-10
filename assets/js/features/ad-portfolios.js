export function createAdPortfolioFeature({
  root = globalThis.document,
  loadDashboardSection,
  addDays,
  bind,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatMoney,
  formatRateNullable,
  setText,
  trimmedFieldValue,
  storage = globalThis.localStorage,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createAdPortfolioFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createAdPortfolioFeature requires bind.");
  if (typeof createDebouncedAction !== "function") throw new Error("createAdPortfolioFeature requires createDebouncedAction.");

  const columnsStorageKey = "tanjia:adPortfolioColumns:v1";
  let adPortfolioRows = [];

  function formatAdBudget(row) {
    if (!row || !row.budget) return "-";
    const currency = row.currency ? `${row.currency} ` : "";
    return `${currency}${Number(row.budget || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }

  const adPortfolioColumns = [
    { key: "name", label: "广告组合", group: "设置", default: true, value: (row) => `<strong>${escapeHtml(row.name || "-")}</strong><br /><small>${escapeHtml(row.id || "-")}</small>` },
    { key: "servingStatus", label: "服务状态", group: "设置", default: true, value: (row) => escapeHtml(row.servingStatus || "-") },
    { key: "createdAt", label: "创建时间", group: "设置", value: (row) => escapeHtml(row.createdAt || "-") },
    { key: "budget", label: "预算", group: "设置", value: (row) => escapeHtml(formatAdBudget(row)) },
    { key: "startDate", label: "开始日期", group: "设置", value: (row) => escapeHtml(row.startDate || "-") },
    { key: "endDate", label: "结束日期", group: "设置", value: (row) => escapeHtml(row.endDate || "-") },
    { key: "sales", label: "广告销售额", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.sales, 2) },
    { key: "salesRate", label: "广告销售额%", group: "转化", default: true, value: (row, totals) => formatRateNullable(totals.sales ? (row.report?.sales || 0) / totals.sales : 0) },
    { key: "sameSales", label: "直接销售额", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.sameSales, 2) },
    { key: "sameSalesRate", label: "直接销售额%", group: "转化", value: (row, totals) => formatRateNullable(totals.sameSales ? (row.report?.sameSales || 0) / totals.sameSales : 0) },
    { key: "indirectSales", label: "间接销售额", group: "转化", value: (row) => formatMetricNumber((row.report?.sales || 0) - (row.report?.sameSales || 0), 2) },
    { key: "indirectSalesRate", label: "间接销售额%", group: "转化", value: (row, totals) => formatRateNullable((totals.sales - totals.sameSales) ? (((row.report?.sales || 0) - (row.report?.sameSales || 0)) / (totals.sales - totals.sameSales)) : 0) },
    { key: "acos", label: "ACoS", group: "转化", default: true, value: (row) => formatRateNullable((row.report?.sales || 0) ? (row.report?.cost || 0) / row.report.sales : 0) },
    { key: "roas", label: "ROAS", group: "转化", value: (row) => formatMetricNumber((row.report?.cost || 0) ? (row.report?.sales || 0) / row.report.cost : 0, 2) },
    { key: "sameAcos", label: "直接ACoS", group: "转化", value: (row) => formatRateNullable((row.report?.sameSales || 0) ? (row.report?.cost || 0) / row.report.sameSales : 0) },
    { key: "sameRoas", label: "直接ROAS", group: "转化", value: (row) => formatMetricNumber((row.report?.cost || 0) ? (row.report?.sameSales || 0) / row.report.cost : 0, 2) },
    { key: "orders", label: "广告订单", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.orders) },
    { key: "sameOrders", label: "直接订单", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.sameOrders) },
    { key: "sameOrderRate", label: "直接订单%", group: "转化", value: (row) => formatRateNullable((row.report?.orders || 0) ? (row.report?.sameOrders || 0) / row.report.orders : 0) },
    { key: "indirectOrders", label: "间接订单", group: "转化", value: (row) => formatMetricNumber((row.report?.orders || 0) - (row.report?.sameOrders || 0)) },
    { key: "indirectOrderRate", label: "间接订单占比", group: "转化", value: (row) => formatRateNullable((row.report?.orders || 0) ? ((row.report?.orders || 0) - (row.report?.sameOrders || 0)) / row.report.orders : 0) },
    { key: "cvr", label: "CVR", group: "转化", default: true, value: (row) => formatRateNullable((row.report?.clicks || 0) ? (row.report?.orders || 0) / row.report.clicks : 0) },
    { key: "cpa", label: "CPA", group: "业绩", default: true, value: (row) => formatMetricNumber((row.report?.orders || 0) ? (row.report?.cost || 0) / row.report.orders : 0, 2) },
    { key: "adUnitPrice", label: "广告笔单价", group: "转化", default: true, value: (row) => formatMetricNumber((row.report?.orders || 0) ? (row.report?.sales || 0) / row.report.orders : 0, 2) },
    { key: "brandNewOrders", label: "品牌新客订单", group: "转化", value: () => "-" },
    { key: "units", label: "广告销量", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.units) },
    { key: "unitsRate", label: "广告销量%", group: "转化", value: (row, totals) => formatRateNullable(totals.units ? (row.report?.units || 0) / totals.units : 0) },
    { key: "sameUnits", label: "直接销量", group: "转化", default: true, value: (row) => formatMetricNumber(row.report?.sameUnits) },
    { key: "impressions", label: "曝光量", group: "业绩", default: true, value: (row) => formatMetricNumber(row.report?.impressions) },
    { key: "clicks", label: "点击", group: "业绩", default: true, value: (row) => formatMetricNumber(row.report?.clicks) },
    { key: "clickRate", label: "点击%", group: "业绩", default: true, value: (row) => formatRateNullable((row.report?.impressions || 0) ? (row.report?.clicks || 0) / row.report.impressions : 0) },
    { key: "ctr", label: "CTR", group: "业绩", default: true, value: (row) => formatRateNullable((row.report?.impressions || 0) ? (row.report?.clicks || 0) / row.report.impressions : 0) },
    { key: "cpc", label: "CPC", group: "业绩", default: true, value: (row) => formatMetricNumber((row.report?.clicks || 0) ? (row.report?.cost || 0) / row.report.clicks : 0, 2) },
    { key: "cost", label: "花费", group: "业绩", default: true, value: (row) => formatMetricNumber(row.report?.cost, 2) },
    { key: "costRate", label: "花费%", group: "业绩", default: true, value: (row, totals) => formatRateNullable(totals.cost ? (row.report?.cost || 0) / totals.cost : 0) },
    { key: "campaignCount", label: "广告活动数", group: "业绩", value: (row) => formatMetricNumber(row.report?.campaignCount) },
  ];

  function setDefaultAdPortfolioDate() {
    const input = root?.querySelector?.("#ads-portfolio-report-date");
    if (!input || input.value) return;
    input.value = formatDate(addDays(new Date(), -1));
  }

  function buildAdPortfolioQuery() {
    setDefaultAdPortfolioDate();
    const params = new URLSearchParams();
    const state = fieldValue("#ads-portfolio-state", "", root);
    const reportDate = fieldValue("#ads-portfolio-report-date", "", root);
    const keyword = trimmedFieldValue("#ads-portfolio-keyword", "", root);
    if (state) params.set("state", state);
    if (reportDate) params.set("reportDate", reportDate);
    if (keyword) params.set("keyword", keyword);
    return params.toString();
  }

  function defaultAdPortfolioColumnKeys() {
    return adPortfolioColumns.filter((column) => column.default).map((column) => column.key);
  }

  function selectedAdPortfolioColumnKeys() {
    const saved = storage?.getItem?.(columnsStorageKey);
    if (!saved) return defaultAdPortfolioColumnKeys();
    try {
      const keys = JSON.parse(saved);
      return Array.isArray(keys) && keys.length ? keys : defaultAdPortfolioColumnKeys();
    } catch {
      return defaultAdPortfolioColumnKeys();
    }
  }

  function setSelectedAdPortfolioColumnKeys(keys) {
    storage?.setItem?.(columnsStorageKey, JSON.stringify(keys));
  }

  function adPortfolioTotals(rows) {
    return rows.reduce((acc, row) => {
      acc.sales += row.report?.sales || 0;
      acc.sameSales += row.report?.sameSales || 0;
      acc.cost += row.report?.cost || 0;
      acc.units += row.report?.units || 0;
      return acc;
    }, { sales: 0, sameSales: 0, cost: 0, units: 0 });
  }

  function buildAdPortfolioSummary(rows = []) {
    return rows.reduce((acc, row) => {
      if (row.status === "启用") acc.active += 1;
      else if (row.status === "暂停") acc.paused += 1;
      acc.totalBudget += row.budget || 0;
      return acc;
    }, { active: 0, paused: 0, archived: 0, totalBudget: 0 });
  }

  function renderAdPortfolioColumnPicker() {
    const container = root?.querySelector?.("#ads-portfolio-columns");
    if (!container) return;
    const selected = new Set(selectedAdPortfolioColumnKeys());
    const groups = [...new Set(adPortfolioColumns.map((column) => column.group))];
    container.innerHTML = groups.map((group) => `
      <section>
        <div class="column-group-head"><strong>${escapeHtml(group)}</strong><button type="button" data-ads-column-group="${escapeHtml(group)}">全选</button></div>
        <div class="column-options">
          ${adPortfolioColumns.filter((column) => column.group === group).map((column) => `
            <label><input type="checkbox" value="${escapeHtml(column.key)}" ${selected.has(column.key) ? "checked" : ""} />${escapeHtml(column.label)}</label>
          `).join("")}
        </div>
      </section>
    `).join("");
  }

  function renderAdPortfolios(data = {}) {
    adPortfolioRows = data.rows || [];
    const summary = data.summary || {};
    setText("#ads-portfolio-source", `${data.source || "领星 ERP · 广告-广告组合"} · ${data.syncStatus || ""}`, root);
    setText("#ads-portfolio-count", `共 ${adPortfolioRows.length} 条 · 启用 ${summary.active || 0} · 暂停 ${summary.paused || 0} · 预算 ${formatMoney(summary.totalBudget || 0)}`, root);

    renderAdPortfolioColumnPicker();
    const selectedKeys = selectedAdPortfolioColumnKeys();
    const columns = adPortfolioColumns.filter((column) => selectedKeys.includes(column.key));
    const totals = adPortfolioTotals(adPortfolioRows);
    const header = root?.querySelector?.("#ads-portfolio-table thead tr");
    if (header) header.innerHTML = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const table = root?.querySelector?.("#ads-portfolio-table tbody");
    if (!table) return;
    table.innerHTML = adPortfolioRows.length ? adPortfolioRows.map((row) => `
      <tr>
        ${columns.map((column) => `<td>${column.value(row, totals)}</td>`).join("")}
      </tr>
    `).join("") : `<tr><td colspan="${Math.max(columns.length, 1)}">当前筛选条件下没有广告组合。</td></tr>`;
  }

  async function loadAdPortfolios() {
    const query = buildAdPortfolioQuery();
    await loadDashboardSection({
      endpoint: `/api/dashboard/ad-portfolios${query ? `?${query}` : ""}`,
      buttonSelector: "#ads-portfolio-refresh",
      busyText: "刷新中...",
      restoreText: "刷新广告组合",
      statusSelector: "#ads-portfolio-source",
      loadingStatus: "正在读取领星 ERP 广告组合",
      tableSelector: "#ads-portfolio-table tbody",
      tableColspan: 9,
      loadingMessage: "正在加载广告组合...",
      errorMessage: (_response, data) => data.error || data.message || "广告组合加载失败",
      onData: renderAdPortfolios,
      onError(error) {
        renderAdPortfolios({
          source: "领星 ERP · 广告-广告组合",
          syncStatus: `读取失败：${error.message}`,
          rows: [],
          summary: { active: 0, paused: 0, archived: 0, totalBudget: 0 },
        });
      },
      root,
    });
  }

  function rerenderColumnConfigurationStatus() {
    renderAdPortfolios({
      rows: adPortfolioRows,
      summary: buildAdPortfolioSummary(adPortfolioRows),
      source: "领星 ERP · 广告-广告组合",
      syncStatus: "已更新列配置",
    });
  }

  function handleAdPortfolioColumnsChange(event) {
    const input = closestTarget(event, "input[type='checkbox']");
    if (!input) return;
    const checkedKeys = [...(root?.querySelectorAll?.("#ads-portfolio-columns input[type='checkbox']:checked") || [])].map((item) => item.value);
    setSelectedAdPortfolioColumnKeys(checkedKeys.length ? checkedKeys : [input.value]);
    rerenderColumnConfigurationStatus();
  }

  function handleAdPortfolioColumnGroupClick(event) {
    const button = closestTarget(event, "[data-ads-column-group]");
    if (!button) return;
    const group = button.dataset.adsColumnGroup || "";
    const selected = new Set(selectedAdPortfolioColumnKeys());
    adPortfolioColumns.filter((column) => column.group === group).forEach((column) => selected.add(column.key));
    setSelectedAdPortfolioColumnKeys([...selected]);
    rerenderColumnConfigurationStatus();
  }

  const scheduleAdPortfolioLoad = createDebouncedAction(loadAdPortfolios, 350);

  function setupAdPortfolios() {
    bind(root, "#ads-portfolio-refresh", "click", loadAdPortfolios);
    bind(root, "#ads-portfolio-state", "change", loadAdPortfolios);
    bind(root, "#ads-portfolio-report-date", "change", loadAdPortfolios);
    bind(root, "#ads-portfolio-keyword", "input", scheduleAdPortfolioLoad);
    bind(root, "#ads-portfolio-columns", "change", handleAdPortfolioColumnsChange);
    bind(root, "#ads-portfolio-columns", "click", handleAdPortfolioColumnGroupClick);
  }

  return {
    handleAdPortfolioColumnGroupClick,
    handleAdPortfolioColumnsChange,
    loadAdPortfolios,
    renderAdPortfolios,
    setDefaultAdPortfolioDate,
    setupAdPortfolios,
  };
}

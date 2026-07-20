export function createAftersalesDashboardFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatNumber,
  formatPercent,
  getPacificTodayText,
  renderTableMessage,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createAftersalesDashboardFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createAftersalesDashboardFeature requires bind.");
  if (typeof createDebouncedAction !== "function") throw new Error("createAftersalesDashboardFeature requires createDebouncedAction.");

  let dashboardData = null;

  function setDefaultAftersalesDates() {
    const startInput = root?.querySelector?.("#aftersales-start-date");
    const endInput = root?.querySelector?.("#aftersales-end-date");
    if (!startInput || !endInput) return;
    if (!endInput.value) endInput.value = getPacificTodayText();
    if (!startInput.value) {
      const start = new Date(`${endInput.value}T00:00:00`);
      start.setDate(start.getDate() - 29);
      startInput.value = formatDate(start);
    }
  }

  function buildAftersalesQuery() {
    setDefaultAftersalesDates();
    const params = new URLSearchParams();
    params.set("startDate", fieldValue("#aftersales-start-date", "", root));
    params.set("endDate", fieldValue("#aftersales-end-date", "", root));
    params.set("dateType", fieldValue("#aftersales-date-type", "", root) || "0");
    const keyword = trimmedFieldValue("#aftersales-keyword", "", root);
    if (keyword) params.set("keyword", keyword);
    return params.toString();
  }

  function aftersalesRiskClass(level) {
    if (level === "高风险") return "risk-high";
    if (level === "需关注") return "risk-mid";
    return "";
  }

  function renderAftersalesSourceSummary(items = []) {
    const container = root?.querySelector?.("#aftersales-source-summary");
    if (!container) return;
    container.innerHTML = items.length ? items.map((item) => `
      <article class="metric-tile">
        <span>${escapeHtml(item.title)}</span>
        <strong>${formatNumber(item.count || 0)}</strong>
        <small>${escapeHtml(item.primary || "")}<br />${escapeHtml(item.secondary || "")}</small>
      </article>
    `).join("") : `
      <article class="metric-tile"><span>退货分析</span><strong>-</strong><small>等待数据</small></article>
      <article class="metric-tile"><span>Review</span><strong>-</strong><small>等待数据</small></article>
      <article class="metric-tile"><span>买家之声</span><strong>-</strong><small>等待数据</small></article>
    `;
  }

  function renderAftersalesDashboard(data) {
    const kpis = data?.kpis || {};
    setText("#aftersales-return-count", formatNumber(kpis.returnCount || 0), root);
    setText("#aftersales-return-rate", formatPercent(kpis.returnRate || 0), root);
    setText("#aftersales-low-review-count", formatNumber(kpis.lowStarReviewCount || 0), root);
    setText("#aftersales-voice-risk-count", formatNumber(kpis.voiceRiskCount || 0), root);
    setText("#aftersales-high-risk-count", formatNumber(kpis.highRiskCount || 0), root);
    setText("#aftersales-return-note", `${formatNumber(kpis.returnOrders || 0)} 个退货订单 · 销量 ${formatNumber(kpis.salesVolume || 0)}`, root);
    setText("#aftersales-review-note", `占 Review ${formatPercent(kpis.lowStarRate || 0)}`, root);
    setText("#aftersales-status", `${data?.meta?.source || "领星 ERP"} · ${data?.meta?.startDate || ""} ~ ${data?.meta?.endDate || ""} · ${data?.meta?.syncStatus || ""}`, root);
    renderAftersalesSourceSummary(data?.sourceSummary || []);

    const table = root?.querySelector?.("#aftersales-risk-table");
    const rows = data?.rows || [];
    setText("#aftersales-table-count", `共 ${rows.length} 个产品信号，按三源风险评分排序`, root);
    if (!table) return;
    if (!rows.length) {
      renderTableMessage?.(table, 9, "当前筛选条件下暂无售后风险数据。", root, { tone: "empty" });
      return;
    }
    table.innerHTML = rows.map((row) => `
      <tr>
        <td>
          <strong>${escapeHtml(row.msku || row.asin || row.localSku || "-")}</strong>
          <br /><small>${escapeHtml(row.localName || row.title || row.asin || "-")}</small>
        </td>
        <td>${escapeHtml(row.storeName || "-")}<br /><small>${escapeHtml(row.country || "-")}</small></td>
        <td>${formatNumber(row.returnCount || 0)}<br /><small>${formatNumber(row.returnOrders || 0)} 单</small></td>
        <td>${formatPercent(row.returnRate || 0)}<br /><small>环比差 ${formatPercent(row.returnRateDiff || 0)}</small></td>
        <td>${formatNumber(row.lowStarReviewCount || 0)} / ${formatNumber(row.reviewCount || 0)}<br /><small>均星 ${Number(row.avgStar || 0).toFixed(1)}</small></td>
        <td>${escapeHtml(row.voiceHealth || "-")}<br /><small>NCX ${formatPercent(row.ncxRate || 0)} · ${formatNumber(row.ncxCount || 0)}单</small></td>
        <td>${(row.signals || []).length ? row.signals.map((signal) => `<span class="tag">${escapeHtml(signal)}</span>`).join(" ") : escapeHtml(row.returnReason || "-")}</td>
        <td><span class="risk-badge ${aftersalesRiskClass(row.riskLevel)}">${escapeHtml(row.riskLevel || "观察")}</span><br /><small>${formatNumber(row.riskScore || 0)}分</small></td>
        <td>${escapeHtml(row.action || "保持观察")}</td>
      </tr>
    `).join("");
  }

  async function loadAftersalesDashboard() {
    await loadDashboardSection({
      endpoint: `/api/dashboard/aftersales?${buildAftersalesQuery()}`,
      buttonSelector: "#aftersales-refresh-button",
      busyText: "刷新中...",
      restoreText: "刷新售后",
      statusSelector: "#aftersales-status",
      loadingStatus: "正在读取领星 ERP：退货分析、Review、买家之声",
      tableSelector: "#aftersales-risk-table",
      tableColspan: 9,
      loadingMessage: "正在加载售后数据...",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || data.meta?.syncStatus || `API ${response.status}`,
      onData(data) {
        dashboardData = data;
      },
      onError(error) {
        dashboardData = {
          kpis: {},
          rows: [],
          sourceSummary: [],
          meta: {
            source: "领星 ERP · 售后数据",
            syncStatus: `读取失败：${error.message}`,
          },
        };
      },
      onFinally() {
        renderAftersalesDashboard(dashboardData);
      },
      root,
    });
  }

  const scheduleAftersalesLoad = createDebouncedAction(loadAftersalesDashboard, 350);

  function setupAftersalesDashboard() {
    bind(root, "#aftersales-refresh-button", "click", loadAftersalesDashboard);
    bind(root, "#aftersales-start-date", "change", scheduleAftersalesLoad);
    bind(root, "#aftersales-end-date", "change", scheduleAftersalesLoad);
    bind(root, "#aftersales-date-type", "change", scheduleAftersalesLoad);
    bind(root, "#aftersales-keyword", "input", scheduleAftersalesLoad);
  }

  return {
    buildAftersalesQuery,
    loadAftersalesDashboard,
    renderAftersalesDashboard,
    setDefaultAftersalesDates,
    setupAftersalesDashboard,
  };
}

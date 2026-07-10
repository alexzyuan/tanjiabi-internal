export function createAdKeywordFeature({
  root = globalThis.document,
  loadDashboardSection,
  addDays,
  bind,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatRateNullable,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createAdKeywordFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createAdKeywordFeature requires bind.");
  if (typeof createDebouncedAction !== "function") throw new Error("createAdKeywordFeature requires createDebouncedAction.");

  let adKeywordRows = [];
  const scheduleAdKeywordLoad = createDebouncedAction(loadAdKeywordDashboard, 350);

  function setDefaultAdKeywordDate() {
    const input = root?.querySelector?.("#ads-keyword-end-date");
    if (!input || input.value) return;
    const portfolioDate = fieldValue("#ads-portfolio-report-date", "", root);
    input.value = portfolioDate || formatDate(addDays(new Date(), -1));
  }

  function buildAdKeywordQuery() {
    setDefaultAdKeywordDate();
    const params = new URLSearchParams();
    const endDate = fieldValue("#ads-keyword-end-date", "", root);
    const category = fieldValue("#ads-keyword-category", "", root);
    const keyword = trimmedFieldValue("#ads-keyword-search", "", root);
    if (endDate) params.set("endDate", endDate);
    if (category) params.set("category", category);
    if (keyword) params.set("keyword", keyword);
    params.set("lookbackDays", "7");
    params.set("limit", "300");
    return params.toString();
  }

  function formatSignedRate(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value || 0);
    return `${number > 0 ? "+" : ""}${(number * 100).toFixed(2)}%`;
  }

  function adKeywordCategoryClass(category) {
    if (category === "该加预算") return "scale";
    if (category === "建议暂停") return "pause";
    if (category === "亏钱词") return "losing";
    if (category === "排名在掉") return "rank-drop";
    return "watch";
  }

  function renderAdKeywordBadges(row) {
    const badges = [];
    if (row.flags?.losing) badges.push(["亏钱词", "losing"]);
    if (row.flags?.scale) badges.push(["该加预算", "scale"]);
    if (row.flags?.pause) badges.push(["建议暂停", "pause"]);
    if (row.flags?.rankDrop) badges.push(["排名在掉", "rank-drop"]);
    if (!badges.length) badges.push(["观察", "watch"]);
    return badges.map(([label, tone]) => `<span class="ads-keyword-badge ${tone}">${escapeHtml(label)}</span>`).join("");
  }

  function renderAdKeywordDashboard(data = {}) {
    adKeywordRows = data.rows || [];
    const kpis = data.kpis || {};
    setText("#ads-keyword-source", `${data.source || "领星 ERP · 广告关键词策略"} · ${data.syncStatus || ""}`, root);
    setText("#ads-keyword-kpi-losing", formatMetricNumber(kpis.losing || 0), root);
    setText("#ads-keyword-kpi-scale", formatMetricNumber(kpis.scale || 0), root);
    setText("#ads-keyword-kpi-pause", formatMetricNumber(kpis.pause || 0), root);
    setText("#ads-keyword-kpi-rank-drop", formatMetricNumber(kpis.rankDrop || 0), root);

    const table = root?.querySelector?.("#ads-keyword-table tbody");
    if (!table) return;
    table.innerHTML = adKeywordRows.length ? adKeywordRows.map((row) => {
      const current = row.current || {};
      const trend = row.trend || {};
      const categoryClass = adKeywordCategoryClass(row.actionCategory);
      return `
        <tr>
          <td><span class="ads-keyword-primary ${categoryClass}">${escapeHtml(row.actionCategory || "观察")}</span><div class="ads-keyword-badges">${renderAdKeywordBadges(row)}</div></td>
          <td><strong>${escapeHtml(row.keywordText || "-")}</strong><small>${escapeHtml(row.sellerName || "-")} · ${escapeHtml(row.country || "-")} · ${escapeHtml(row.matchType || "-")}</small><small>Campaign ${escapeHtml(row.campaignId || "-")} · Bid ${formatMetricNumber(row.bid || 0, 2)}</small></td>
          <td><span>点击 ${formatMetricNumber(current.clicks)}</span><span>订单 ${formatMetricNumber(current.orders)}</span><span>花费 ${formatMetricNumber(current.cost, 2)}</span><span>销售 ${formatMetricNumber(current.sales, 2)}</span></td>
          <td><span>ACoS ${formatRateNullable(current.acos)}</span><span>CVR ${formatRateNullable(current.cvr)}</span><span>CPC ${current.cpc === null || current.cpc === undefined ? "-" : formatMetricNumber(current.cpc, 2)}</span><span>ROAS ${current.roas === null || current.roas === undefined ? "-" : formatMetricNumber(current.roas, 2)}</span></td>
          <td><span>曝光 ${formatSignedRate(trend.impressionChangeRate)}</span><span>点击 ${formatSignedRate(trend.clickChangeRate)}</span><span>订单 ${formatMetricNumber(trend.orderChange || 0)}</span><span>销售 ${formatMetricNumber(trend.salesChange || 0, 2)}</span></td>
          <td><strong>${escapeHtml(row.actionTitle || "-")}</strong><small>${escapeHtml(row.recommendation || "-")}</small></td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="6">当前筛选条件下没有需要处理的关键词。</td></tr>`;
  }

  async function loadAdKeywordDashboard() {
    const query = buildAdKeywordQuery();
    await loadDashboardSection({
      endpoint: `/api/dashboard/ad-keywords${query ? `?${query}` : ""}`,
      buttonSelector: "#ads-keyword-refresh",
      busyText: "刷新中...",
      restoreText: "刷新关键词",
      statusSelector: "#ads-keyword-source",
      loadingStatus: "正在读取领星 ERP 关键词报表",
      tableSelector: "#ads-keyword-table tbody",
      tableColspan: 6,
      loadingMessage: "正在加载关键词策略...",
      errorMessage: (_response, data) => data.error || data.message || "广告关键词加载失败",
      onData: renderAdKeywordDashboard,
      onError(error) {
        renderAdKeywordDashboard({
          source: "领星 ERP · 广告关键词策略",
          syncStatus: `读取失败：${error.message}`,
          rows: [],
          kpis: { losing: 0, scale: 0, pause: 0, rankDrop: 0 },
        });
      },
      root,
    });
  }

  function setupAdKeywordDashboard() {
    bind(root, "#ads-keyword-refresh", "click", loadAdKeywordDashboard);
    bind(root, "#ads-keyword-end-date", "change", loadAdKeywordDashboard);
    bind(root, "#ads-keyword-category", "change", loadAdKeywordDashboard);
    bind(root, "#ads-keyword-search", "input", scheduleAdKeywordLoad);
  }

  return {
    buildAdKeywordQuery,
    loadAdKeywordDashboard,
    renderAdKeywordDashboard,
    setDefaultAdKeywordDate,
    setupAdKeywordDashboard,
  };
}

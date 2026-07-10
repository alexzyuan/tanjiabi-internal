export function createAdPerformanceReviewFeature({
  root = globalThis.document,
  loadDashboardSection,
  addDays,
  bind,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatRateNullable,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createAdPerformanceReviewFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createAdPerformanceReviewFeature requires bind.");

  function readPercentInput(selector, fallbackPercent) {
    const value = Number(fieldValue(selector, fallbackPercent, root));
    const percent = Number.isFinite(value) ? value : fallbackPercent;
    return Math.max(0, percent) / 100;
  }

  function setDefaultAdReviewDates() {
    const endInput = root?.querySelector?.("#ads-review-end-date");
    const startInput = root?.querySelector?.("#ads-review-start-date");
    const compareEndInput = root?.querySelector?.("#ads-review-compare-end-date");
    const compareStartInput = root?.querySelector?.("#ads-review-compare-start-date");
    const endDate = fieldValue(endInput, "", root) || fieldValue("#ads-portfolio-report-date", "", root) || formatDate(addDays(new Date(), -1));
    const startDate = startInput?.value || formatDate(addDays(new Date(`${endDate}T00:00:00`), -6));
    const compareEndDate = compareEndInput?.value || formatDate(addDays(new Date(`${startDate}T00:00:00`), -1));
    const compareStartDate = compareStartInput?.value || formatDate(addDays(new Date(`${compareEndDate}T00:00:00`), -6));
    if (endInput && !endInput.value) endInput.value = endDate;
    if (startInput && !startInput.value) startInput.value = startDate;
    if (compareEndInput && !compareEndInput.value) compareEndInput.value = compareEndDate;
    if (compareStartInput && !compareStartInput.value) compareStartInput.value = compareStartDate;
  }

  function signedRateText(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "对比 -";
    const sign = value > 0 ? "+" : "";
    return `对比 ${sign}${formatRateNullable(value)}`;
  }

  function buildAdReviewQuery({ refresh = false } = {}) {
    setDefaultAdReviewDates();
    const params = new URLSearchParams();
    const fields = [
      ["startDate", "#ads-review-start-date"],
      ["endDate", "#ads-review-end-date"],
      ["compareStartDate", "#ads-review-compare-start-date"],
      ["compareEndDate", "#ads-review-compare-end-date"],
      ["store", "#ads-review-store"],
      ["country", "#ads-review-country"],
      ["asin", "#ads-review-asin"],
    ];
    fields.forEach(([name, selector]) => {
      const value = trimmedFieldValue(selector, "", root);
      if (value) params.set(name, value);
    });
    params.set("targetAcos", String(readPercentInput("#ads-review-target-acos", 25)));
    params.set("avgClicksPerOrder", String(Number(fieldValue("#ads-review-avg-clicks", 7, root) || 7) || 7));
    if (refresh) params.set("refresh", "1");
    return params.toString();
  }

  function renderAdReviewMetricNotes(summary = {}, rules = {}) {
    const current = summary.current || {};
    const delta = summary.delta || {};
    setText("#ads-review-kpi-cost", formatMetricNumber(current.cost || 0, 2), root);
    setText("#ads-review-kpi-sales", formatMetricNumber(current.sales || 0, 2), root);
    setText("#ads-review-kpi-acos", formatRateNullable(current.acos), root);
    setText("#ads-review-kpi-orders", formatMetricNumber(current.orders || 0), root);
    setText("#ads-review-kpi-cost-note", signedRateText(delta.cost), root);
    setText("#ads-review-kpi-sales-note", signedRateText(delta.sales), root);
    setText("#ads-review-kpi-orders-note", signedRateText(delta.orders), root);
    setText("#ads-review-kpi-acos-note", `目标 ${formatRateNullable(rules.targetAcos)} · 对比 ${delta.acos === null || delta.acos === undefined ? "-" : signedRateText(delta.acos).replace("对比 ", "")}`, root);
  }

  function renderAdReviewCards(data = {}) {
    const targets = data.targets || [];
    const searchTerms = data.searchTerms || [];
    const list = root?.querySelector?.("#ads-review-list");
    if (!list) return;
    const targetCards = targets.slice(0, 8).map((row) => `
      <article class="ads-analysis-card ${escapeHtml(row.tone || "muted")}">
        <div class="ads-analysis-card-head">
          <span>${escapeHtml(row.action || "观察")}</span>
          <strong>${escapeHtml(row.targetText || "-")}</strong>
        </div>
        <p>${escapeHtml(row.reason || row.label || "-")}</p>
        <div class="ads-analysis-terms">
          <span>${escapeHtml(row.matchType || "-")}<small>Campaign ${escapeHtml(row.campaignId || "-")} · ${escapeHtml(row.sellerName || "-")}</small></span>
          ${row.core ? `<span>核心保护<small>销售占比 ${formatRateNullable(row.salesShare)}</small></span>` : ""}
        </div>
        <div class="ads-analysis-metrics">
          <span>ACoS ${formatRateNullable(row.current?.acos)}</span>
          <span>CVR ${formatRateNullable(row.current?.cvr)}</span>
          <span>CPC ${row.current?.cpc === null || row.current?.cpc === undefined ? "-" : formatMetricNumber(row.current.cpc, 2)}</span>
          <span>花费 ${formatMetricNumber(row.current?.cost, 2)}</span>
          <span>订单 ${formatMetricNumber(row.current?.orders)}</span>
        </div>
        <small>建议调价 ${escapeHtml(row.bidChange || "0%")} · ${escapeHtml(row.label || "-")}</small>
      </article>
    `);
    const searchCards = searchTerms.slice(0, 4).map((row) => `
      <article class="ads-analysis-card ${escapeHtml(row.tone || "muted")}">
        <div class="ads-analysis-card-head">
          <span>${escapeHtml(row.action || "观察")}</span>
          <strong>${escapeHtml(row.query || "-")}</strong>
        </div>
        <p>${escapeHtml(row.reason || "-")}</p>
        <div class="ads-analysis-metrics">
          <span>点击 ${formatMetricNumber(row.current?.clicks)}</span>
          <span>花费 ${formatMetricNumber(row.current?.cost, 2)}</span>
          <span>订单 ${formatMetricNumber(row.current?.orders)}</span>
          <span>ACoS ${formatRateNullable(row.current?.acos)}</span>
        </div>
        <small>来自 Targeting：${escapeHtml(row.targetText || "-")}</small>
      </article>
    `);
    list.innerHTML = targetCards.length || searchCards.length
      ? [...targetCards, ...searchCards].join("")
      : `<div class="empty-state">当前筛选条件下没有足够广告数据生成动作建议。</div>`;
  }

  function renderAdPerformanceReview(data = {}) {
    const kpis = data.kpis || {};
    setText("#ads-review-source", `${data.source || "领星 ERP · 广告复盘分析"} · ${data.syncStatus || ""}`, root);
    renderAdReviewMetricNotes(data.summary || {}, data.rules || {});
    setText("#ads-review-kpi-high-acos", formatMetricNumber(kpis.highAcosTargets || 0), root);
    setText("#ads-review-kpi-negative", formatMetricNumber((kpis.noOrderTargets || 0) + (kpis.negativeSearchTerms || 0)), root);
    setText("#ads-review-kpi-protect", formatMetricNumber(kpis.protectedTargets || 0), root);
    setText("#ads-review-kpi-exact", formatMetricNumber(kpis.exactCandidates || 0), root);
    const report = root?.querySelector?.("#ads-review-report");
    if (report) report.value = data.markdown || "";
    renderAdReviewCards(data);
  }

  async function loadAdPerformanceReview(options = {}) {
    const refresh = Boolean(options.refresh);
    const query = buildAdReviewQuery({ refresh });
    const list = root?.querySelector?.("#ads-review-list");
    if (list) list.innerHTML = `<div class="empty-state">正在读取广告活动、Targeting 和搜索词数据...</div>`;
    await loadDashboardSection({
      endpoint: `/api/dashboard/ad-performance-review${query ? `?${query}` : ""}`,
      buttonSelector: "#ads-review-refresh",
      busyText: "生成中...",
      restoreText: "生成复盘",
      statusSelector: "#ads-review-source",
      loadingStatus: refresh ? "正在从领星广告 API 生成复盘" : "正在读取广告复盘快照",
      errorMessage: (_response, data) => data.error || data.message || "广告复盘加载失败",
      onData: renderAdPerformanceReview,
      onError(error) {
        renderAdPerformanceReview({
          source: "领星 ERP · 广告复盘分析",
          syncStatus: `读取失败：${error.message}`,
          rows: [],
          kpis: {},
          summary: { current: {}, compare: {}, delta: {} },
          markdown: "",
        });
      },
      root,
    });
  }

  function setupAdPerformanceReview() {
    bind(root, "#ads-review-refresh", "click", () => loadAdPerformanceReview({ refresh: true }));
    bind(root, "#ads-review-start-date", "change", setDefaultAdReviewDates);
    bind(root, "#ads-review-end-date", "change", setDefaultAdReviewDates);
    bind(root, "#ads-review-compare-start-date", "change", setDefaultAdReviewDates);
    bind(root, "#ads-review-compare-end-date", "change", setDefaultAdReviewDates);
  }

  return {
    buildAdReviewQuery,
    loadAdPerformanceReview,
    renderAdPerformanceReview,
    setDefaultAdReviewDates,
    setupAdPerformanceReview,
  };
}

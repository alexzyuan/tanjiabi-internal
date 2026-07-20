export function createProductPulseFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  buildDashboardQuery,
  getFrontDateEnd,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  formatPercent,
  renderTableMessage,
  setText,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createProductPulseFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createProductPulseFeature requires bind.");
  if (typeof buildDashboardQuery !== "function") throw new Error("createProductPulseFeature requires buildDashboardQuery.");

  function riskClass(level) {
    if (level === "高") return "risk-high";
    if (level === "中") return "risk-mid";
    if (level === "低") return "risk-low";
    return "";
  }

  function metricText(value, matched = true) {
    if (!matched) return "未返回";
    return value === null || value === undefined || value === "" ? "-" : formatNumber(value);
  }

  function metricToneClass(value, rules = {}) {
    const number = Number(value || 0);
    if (rules.red !== undefined && number >= rules.red) return "metric-danger";
    if (rules.orange !== undefined && number >= rules.orange) return "metric-warning";
    return "";
  }

  function salesDropClass(item) {
    const current = Number(item.salesUnits || 0);
    const previous = Number(item.previousSalesUnits || 0);
    return previous > 0 && current < previous * 0.7 ? "metric-danger" : "";
  }

  function inventoryRiskClass(item) {
    if (!item.replenishmentMatched) return "";
    const available = Number(item.inventoryAvailable || 0);
    const transfer = Number(item.inventoryTransfer || 0);
    const dailyAvg14 = Number(item.dailyAvg14 || 0);
    return dailyAvg14 > 0 && available + transfer < dailyAvg14 * 14 ? "metric-danger" : "";
  }

  function noSalesAdCostClass(item) {
    return Number(item.salesUnits || 0) === 0 && Number(item.adCost || 0) > 0 ? "metric-warning" : "";
  }

  function rankCellHtml(item) {
    const currentRank = Number(item.rank);
    const previousRank = Number(item.previousRank);
    if (!Number.isFinite(currentRank) || currentRank <= 0) return "未返回";

    const category = item.rankCategory ? ` · ${escapeHtml(item.rankCategory)}` : "";
    if (!Number.isFinite(previousRank) || previousRank <= 0) {
      return `${formatNumber(currentRank)}${category}`;
    }

    if (currentRank < previousRank) {
      return `${formatNumber(currentRank)}${category} <span class="rank-change rank-up">↑ 上升${formatNumber(previousRank - currentRank)}</span>`;
    }
    if (currentRank > previousRank) {
      return `${formatNumber(currentRank)}${category} <span class="rank-change rank-down">↓ 下降${formatNumber(currentRank - previousRank)}</span>`;
    }
    return `${formatNumber(currentRank)}${category} <span class="rank-change rank-flat">-</span>`;
  }

  function buildProductPulseQuery() {
    const params = new URLSearchParams(buildDashboardQuery());
    const pulseDate = fieldValue("#pulse-date", "", root) || getFrontDateEnd?.() || "";
    params.set("date", pulseDate);
    params.set("startDate", pulseDate);
    params.set("endDate", pulseDate);
    return params.toString();
  }

  function renderProductPulse(data) {
    const totals = data.totals || {};
    setText("#pulse-sales-units", formatNumber(Math.round(totals.salesUnits || 0)), root);
    setText("#pulse-ad-cost", formatActualMoney(totals.adCost || 0), root);
    setText("#pulse-acos", formatPercent(totals.acos || 0), root);
    setText("#pulse-acoas", `ACOAS ${formatPercent(totals.acoas || 0)} · ASOAS ${formatPercent(totals.asoas || 0)}`, root);
    setText("#pulse-anomaly-count", String((data.topAnomalies || []).length), root);
    const warnings = Array.isArray(data.dataWarnings) && data.dataWarnings.length ? ` · ${data.dataWarnings.join("；")}` : "";
    setText("#pulse-status", `${data.source || "数据源"} · ${data.date || ""} · ${data.cacheHit ? "缓存" : "实时"} · ${data.updatedAt || ""}${warnings}`, root);

    const anomalyList = root?.querySelector?.("#pulse-anomaly-list");
    const anomalies = data.topAnomalies || [];
    if (anomalyList) {
      anomalyList.innerHTML = anomalies.length
        ? anomalies
          .map((item) => `
            <div>
              <strong>${escapeHtml(item.msku)}<br /><small>${escapeHtml(item.storeName || "-")}</small></strong>
              <span>${escapeHtml(item.anomaly?.aiSummary || "")}</span>
              <em class="risk-badge ${riskClass(item.anomaly?.level)}">${escapeHtml(item.anomaly?.level || "正常")}</em>
            </div>
          `)
          .join("")
        : `<div><strong>暂无明显异动</strong><span>${escapeHtml(data.aiNote || "当天产品表现暂无明显异常。")}</span><em class="risk-badge">正常</em></div>`;
    }

    const table = root?.querySelector?.("#pulse-product-table");
    const rows = data.rows || [];
    if (!table) return;
    if (!rows.length) {
      renderTableMessage(table, 16, "当前日期暂无产品数据。", root, { tone: "empty" });
      return;
    }
    table.innerHTML = rows.slice(0, 100).map((item) => {
        const inventoryClass = inventoryRiskClass(item);
        const adCostClass = noSalesAdCostClass(item);
        return `
          <tr>
            <td>${escapeHtml(item.msku || "-")}</td>
            <td>${escapeHtml(item.storeName || "-")}</td>
            <td>${escapeHtml(item.country || "-")}</td>
            <td class="${salesDropClass(item)}">${formatNumber(item.salesUnits || 0)}</td>
            <td>${formatNumber(item.previousSalesUnits || 0)}</td>
            <td class="${inventoryClass}">${metricText(item.dailyAvg14, item.replenishmentMatched)}</td>
            <td class="${inventoryClass}">${metricText(item.inventoryAvailable, item.replenishmentMatched)}</td>
            <td class="${inventoryClass}">${metricText(item.inventoryTransfer, item.replenishmentMatched)}</td>
            <td>${metricText(item.inventoryInbound, item.replenishmentMatched)}</td>
            <td class="${adCostClass}">${formatActualMoney(item.adCost || 0)}</td>
            <td>${formatActualMoney(item.adSales || 0)}</td>
            <td>${formatPercent(item.acos || 0)}</td>
            <td class="${metricToneClass(item.acoas, { red: 0.2, orange: 0.15 })}">${formatPercent(item.acoas || 0)}</td>
            <td>${formatPercent(item.asoas || 0)}</td>
            <td>${rankCellHtml(item)}</td>
            <td><span class="risk-badge ${riskClass(item.anomaly?.level)}" title="${escapeHtml((item.anomaly?.signals || []).join("；") || "未命中异动规则")}">${escapeHtml(item.anomaly?.level || "正常")}</span></td>
          </tr>
        `;
      }).join("");
  }

  async function loadProductPulse() {
    await loadDashboardSection({
      endpoint: `/api/dashboard/product-pulse?${buildProductPulseQuery()}`,
      fetchOptions: {},
      buttonSelector: "#pulse-refresh-button",
      busyText: "加载中",
      restoreText: "刷新追踪",
      statusSelector: "#pulse-status",
      loadingStatus: "正在读取即时表现",
      tableSelector: "#pulse-product-table",
      tableColspan: 16,
      loadingMessage: "正在加载...",
      errorMessage: (_response, data) => data.error || "即时表现加载失败",
      onData: renderProductPulse,
      onError(error) {
        setText("#pulse-status", `即时表现加载失败：${error.message}`, root);
        renderTableMessage("#pulse-product-table", 16, "加载失败，请稍后重试。", root, { tone: "error" });
      },
      root,
    });
  }

  function setupProductPulse() {
    bind(root, "#pulse-refresh-button", "click", loadProductPulse);
    bind(root, "#pulse-date", "change", loadProductPulse);
  }

  return {
    buildProductPulseQuery,
    loadProductPulse,
    renderProductPulse,
    setupProductPulse,
  };
}

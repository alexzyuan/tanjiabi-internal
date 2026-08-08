import { renderKpiProgress } from "../ui-components.js?v=20260707-ui-components-v1";
import { markDashboardLoadingRequest, startDashboardLoadingOverlay } from "../dashboard-loader.js?v=20260803-global-page-loading-v1";

export function createSalesDashboardFeature({
  root = globalThis.document,
  bind,
  bindAll,
  buildDashboardQuery,
  closestTarget,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  formatActualMoney,
  formatNumber,
  parseDisplayPercent,
  parseNumber,
  renderDataValueButtonsHtml,
  redirectToLogin,
  setTableSortButtonGroupState,
  setText,
  canAccessFinance,
  getCurrentAuthUser,
} = {}) {
  if (typeof bind !== "function") throw new Error("createSalesDashboardFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createSalesDashboardFeature requires bindAll.");

  const fallbackDashboard = {
    meta: {
      source: "接口未连接",
      syncStatus: "本地预览无法连接领星 ERP",
      updatedAt: "-",
      periodText: "",
    },
    insights: [
      ["数据状态", "正在连接真实数据", "当前不会展示模拟经营数据，请稍等或到同步中心检查接口状态。"],
      ["需要检查", "等待领星 ERP 返回", "如果长时间没有数据，请确认服务器已部署最新前端包。"],
      ["下一步", "重新同步或刷新页面", "数据源正常后，页面会自动替换为领星订单利润口径。"],
    ],
    kpis: [
      ["时间进度", "-", "总天数：-", "已过天数：-"],
      ["总销售收入达成率", "-", "目标：-", "实际：-"],
      ["广告销售占比", "-", "广告销售：-", "销售额：-"],
      ["店铺利润达成率", "-", "目标：-", "实际：-"],
      ["广告费率达成率", "-", "目标费率：-", "实际费率：-"],
    ],
    siteRows: [],
    miniMetrics: [
      ["销售额", "-", "等待领星接口", ""],
      ["订单退款", "-", "等待领星接口", ""],
      ["广告花费", "-", "等待领星接口", ""],
      ["退货率", "-", "等待领星接口", ""],
      ["ACOS", "-", "等待领星接口", ""],
      ["销售净毛利", "-", "等待领星接口", ""],
    ],
    summary: [
      ["销售净毛利", "-"],
      ["销售净毛利率", "-"],
      ["公司净利", "-"],
      ["公司净利率", "-"],
      ["销售额", "-"],
      ["广告花费", "-"],
      ["广告销售额", "-"],
      ["ACOS", "-"],
      ["退款率", "-"],
    ],
    trend: [],
    adTrend: [],
    acosTrend: [],
    returnTrend: [],
    trendLabels: [],
    dailyRows: [],
    storeData: [],
    profitData: [],
    detailRows: [],
  };

  let mskuDetailRows = [];
  let mskuDetailStoreFilter = "";
  let mskuDetailSort = { key: "budgetQuantity", direction: "desc" };

  function asArray(value, fallback = []) {
    return Array.isArray(value) ? value : fallback;
  }

  function runSafely(label, callback) {
    try {
      return callback();
    } catch (error) {
      console.error(`${label}失败`, error);
      return null;
    }
  }

  function makeUnavailableDashboard(message) {
    return {
      ...fallbackDashboard,
      meta: {
        source: "接口未连接",
        syncStatus: message,
        updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        currencyText: "等待真实数据",
      },
      insights: [
        ["数据未连接", "未显示模拟经营数据", "请打开服务器地址 http://47.107.92.14/，或检查同步中心配置。"],
        ["需要检查", "确认数据源为 lingxing", "服务器 /api/health 需要返回 provider: lingxing。"],
        ["下一步", "重新同步", "配置正确后点击同步中心的手动同步。"],
      ],
      kpis: [
        { title: "时间进度", value: "未连接", left: "等待真实数据", right: "请检查同步中心", progress: 0, tone: "orange" },
        { title: "总销售收入达成率", value: "-", left: "目标：-", right: "实际：-", progress: 0, tone: "orange" },
        { title: "广告销售占比", value: "-", left: "广告销售：-", right: "销售额：-", progress: 0, tone: "orange" },
        { title: "店铺利润达成率", value: "-", left: "目标：-", right: "实际：-", progress: 0, tone: "orange" },
        { title: "广告费率达成率", value: "-", left: "目标费率：-", right: "实际费率：-", progress: 0, tone: "orange" },
      ],
      siteRows: [["接口未连接", "-", 0, 0, "0.0%", 0, 0, "0.0%", 0, 0, "0.00%", "0.00%"]],
      miniMetrics: [
        ["销售额", "-", "等待领星接口", ""],
        ["订单退款", "-", "等待领星接口", ""],
        ["广告花费", "-", "等待领星接口", ""],
        ["退货率", "-", "等待领星接口", ""],
        ["ACOS", "-", "等待领星接口", ""],
        ["销售毛利", "-", "等待领星接口", ""],
      ],
      summary: [
        ["销售毛利", "-"],
        ["销售毛利率", "-"],
        ["公司净利", "-"],
        ["公司净利率", "-"],
        ["销售额", "-"],
        ["广告花费", "-"],
        ["广告销售额", "-"],
        ["ACOS", "-"],
        ["退款率", "-"],
      ],
      trend: [],
      adTrend: [],
      acosTrend: [],
      returnTrend: [],
      trendLabels: [],
      dailyRows: [],
      storeData: [],
      profitData: [],
      detailRows: [],
      filters: {},
    };
  }

  function normalizeDashboardPayload(data, message = "正在读取真实数据") {
    const fallback = makeUnavailableDashboard(message);
    const source = data && typeof data === "object" ? data : {};
    return {
      ...fallback,
      ...source,
      meta: {
        ...fallback.meta,
        ...(source.meta && typeof source.meta === "object" ? source.meta : {}),
      },
      insights: asArray(source.insights, fallback.insights),
      kpis: asArray(source.kpis, fallback.kpis),
      siteRows: asArray(source.siteRows, fallback.siteRows),
      miniMetrics: asArray(source.miniMetrics, fallback.miniMetrics),
      summary: asArray(source.summary, fallback.summary),
      trend: asArray(source.trend, fallback.trend),
      adTrend: asArray(source.adTrend, fallback.adTrend),
      acosTrend: asArray(source.acosTrend, fallback.acosTrend),
      returnTrend: asArray(source.returnTrend, fallback.returnTrend),
      trendLabels: asArray(source.trendLabels, fallback.trendLabels),
      dailyRows: asArray(source.dailyRows, fallback.dailyRows),
      storeData: asArray(source.storeData, fallback.storeData),
      profitData: asArray(source.profitData, fallback.profitData),
      detailRows: asArray(source.detailRows, fallback.detailRows),
      filters: source.filters && typeof source.filters === "object" ? source.filters : fallback.filters,
    };
  }

  function normalizeKpi(item) {
    if (!Array.isArray(item)) return item;
    const progress = parseDisplayPercent(item[1]);
    return {
      title: item[0],
      value: item[1],
      left: item[2],
      right: item[3],
      progress,
      tone: item[0]?.includes("利润") && progress < 0 ? "red" : progress >= 100 ? "green" : "blue",
    };
  }

  function compareMskuDetailRows(left, right, key) {
    const leftValue = left?.[key];
    const rightValue = right?.[key];
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return String(leftValue || "").localeCompare(String(rightValue || ""), "zh-Hans-CN");
  }

  function currentListingOwnerFilter() {
    const select = root?.querySelector?.("#front-owner-filter");
    return String(select?.value || "").trim();
  }

  function ownerFilteredMskuDetailRows(rows = mskuDetailRows) {
    const owner = currentListingOwnerFilter();
    if (!owner) return rows;
    return rows.filter((row) => String(row?.listingOwner || "").trim() === owner);
  }

  function filteredMskuDetailRows() {
    const ownerRows = ownerFilteredMskuDetailRows();
    const rows = mskuDetailStoreFilter
      ? ownerRows.filter((row) => row.budgetStoreName === mskuDetailStoreFilter)
      : ownerRows;
    const multiplier = mskuDetailSort.direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => compareMskuDetailRows(left, right, mskuDetailSort.key) * multiplier);
  }

  function renderMskuStoreTabs(rows = mskuDetailRows) {
    const container = root?.querySelector?.("#msku-store-tabs");
    if (!container) return;
    const stores = [...new Set(rows.map((row) => row.budgetStoreName).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    if (mskuDetailStoreFilter && !stores.includes(mskuDetailStoreFilter)) mskuDetailStoreFilter = "";
    container.innerHTML = renderDataValueButtonsHtml(stores, "data-msku-store", mskuDetailStoreFilter, {
      allLabel: "全部店铺",
    });
  }

  function renderMskuSortState() {
    setTableSortButtonGroupState("[data-msku-sort]", "mskuSort", mskuDetailSort.key, mskuDetailSort.direction, root);
  }

  function applyMskuDetailSort(key) {
    if (!key) return;
    mskuDetailSort = {
      key,
      direction: mskuDetailSort.key === key && mskuDetailSort.direction === "asc" ? "desc" : "asc",
    };
    renderMskuDetailTable();
  }

  function mskuRateToneClass(key, value) {
    const number = Number(value || 0);
    const rules = {
      refundRate: { orange: 3.5, red: 6 },
      adFeeRate: { orange: 15, red: 20 },
      promotionDiscountRate: { orange: 3, red: 4 },
      storageFeeRate: { orange: 2, red: 3 },
      fbaDeliveryFeeRate: { orange: 27, red: 30 },
      purchaseCostRate: { orange: 20, red: 25 },
      firstLegCostRate: { orange: 10, red: 13 },
    };
    if (key === "grossRate") return number < 0 ? "msku-rate-danger" : "";
    const rule = rules[key];
    if (!rule) return "";
    if (number >= rule.red) return "msku-rate-danger";
    if (number >= rule.orange) return "msku-rate-warning";
    return "";
  }

  function mskuRateCell(key, value) {
    return `<td class="${mskuRateToneClass(key, value)}">${formatActualMoney(value || 0)}%</td>`;
  }

  function renderMskuDetailTable() {
    const detailTable = root?.querySelector?.("#detail-table");
    if (!detailTable) return;
    const rows = filteredMskuDetailRows();
    renderMskuSortState();
    detailTable.innerHTML = rows.length
      ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.budgetStoreName || "-")}</td>
          <td><strong>${escapeHtml(row.msku || "-")}</strong></td>
          <td>${escapeHtml(row.productName || "-")}</td>
          <td>${formatActualMoney(row.budgetQuantity || 0)}</td>
          <td>${formatActualMoney(row.actualQuantity || 0)}</td>
          <td>${formatActualMoney(row.fbaInventory || 0)}</td>
          <td>${formatActualMoney(row.quantityAchievement || 0)}%</td>
          <td>${formatActualMoney(row.orderProfit || 0)}</td>
          <td>${formatActualMoney(row.averageProfit || 0)}</td>
          ${mskuRateCell("grossRate", row.grossRate)}
          ${mskuRateCell("refundRate", row.refundRate)}
          ${mskuRateCell("adFeeRate", row.adFeeRate)}
          ${mskuRateCell("promotionDiscountRate", row.promotionDiscountRate)}
          ${mskuRateCell("storageFeeRate", row.storageFeeRate)}
          <td>${formatActualMoney(row.platformFeeRate || 0)}%</td>
          ${mskuRateCell("fbaDeliveryFeeRate", row.fbaDeliveryFeeRate)}
          ${mskuRateCell("purchaseCostRate", row.purchaseCostRate)}
          ${mskuRateCell("firstLegCostRate", row.firstLegCostRate)}
        </tr>
      `).join("")
      : `<tr><td colspan="18">当前筛选周期暂无 MSKU 明细。</td></tr>`;
  }

  function normalizeSiteCells(cells) {
    if (cells.length === 7) {
      return [cells[0], "CNY", ...cells.slice(1), 0, 0, "0.00%", "0.00%"];
    }
    if (cells.length === 8) {
      return [...cells, 0, 0, "0.00%", "0.00%"];
    }
    if (cells.length === 9) {
      return [cells[0], "CNY", ...cells.slice(1, 7), 0, 0, "0.00%", "0.00%"];
    }
    if (cells.length === 10) {
      return [...cells.slice(0, 8), 0, 0, "0.00%", "0.00%"];
    }
    return cells;
  }

  function rateClass(value) {
    const number = parseNumber(value);
    if (number >= 100) return "rate-good";
    if (number >= 80) return "rate-warn";
    return "rate-bad";
  }

  function fillTables(data) {
    const siteTable = root?.querySelector?.("#site-table");
    if (siteTable) {
      siteTable.innerHTML = data.siteRows
        .map((rawRow, index) => {
          const cells = normalizeSiteCells(Array.isArray(rawRow) ? rawRow : rawRow.cells);
          const type = Array.isArray(rawRow) ? (index === data.siteRows.length - 1 ? "total" : "country") : rawRow.type;
          const level = Array.isArray(rawRow) ? 0 : Number(rawRow.level || 0);
          return `
          <tr class="${type === "total" ? "total-row" : ""} site-row-level-${level}">
            ${cells.map((cell, cellIndex) => {
              const cellClass = cellIndex === 4 || cellIndex === 7 ? rateClass(cell) : "";
              const content = cellIndex === 0 && level > 0 ? `<span class="drill-child">${formatNumber(cell)}</span>` : formatNumber(cell);
              return `<td class="${cellClass}">${content}</td>`;
            }).join("")}
          </tr>
        `;
        })
        .join("");
    }

    const detailTable = root?.querySelector?.("#detail-table");
    const detailRows = (data.detailRows || []).filter((row) => row && !Array.isArray(row) && typeof row === "object");
    if (detailTable) {
      mskuDetailRows = detailRows;
      const visibleDetailRows = ownerFilteredMskuDetailRows(mskuDetailRows);
      renderMskuStoreTabs(visibleDetailRows);
      renderMskuDetailTable();
      const status = root?.querySelector?.("#msku-detail-status");
      if (status) status.textContent = `随销售看板同步加载 · ${visibleDetailRows.length} 条预算 MSKU`;
    }

    const dailyTable = root?.querySelector?.("#daily-table");
    if (dailyTable) {
      const rows = data.dailyRows || [];
      dailyTable.innerHTML = rows.length
        ? rows
          .map((row) => `
            <tr>
              ${row.map((cell, index) => `<td class="${index === 4 && parseNumber(cell) < 0 ? "warning-cell" : ""}">${formatNumber(cell)}</td>`).join("")}
            </tr>
          `)
          .join("")
        : `<tr><td colspan="11">当前筛选周期暂无每日数据</td></tr>`;
    }
  }

  function fillCards(data) {
    setText("#site-currency-note", `销售收入、利润与达成率 · ${data.meta.currencyText || "CNY"}`, root);
    setText("#msku-detail-status", "随销售看板同步加载", root);

    const kpiStack = root?.querySelector?.(".kpi-stack");
    if (kpiStack) {
      kpiStack.innerHTML = data.kpis
        .map((rawItem) => {
          const item = normalizeKpi(rawItem);
          return `
          <article class="kpi-card kpi-${item.tone || "blue"}">
            <span class="card-title">${item.title}</span>
            <strong>${item.value}</strong>
            ${renderKpiProgress({
              value: item.progress,
              tone: item.tone || "blue",
              label: `${item.title} ${item.value}`,
            })}
            <div class="target-line"><span>${item.left}</span><span>${item.right}</span></div>
          </article>
        `;
        })
        .join("");
    }

    const miniMetrics = root?.querySelector?.(".mini-metrics");
    if (miniMetrics) {
      miniMetrics.innerHTML = data.miniMetrics
        .map((item) => `
          <div class="mini-card">
            <span>${item[0]}</span>
            <strong class="${item[3]}">${item[1]}</strong>
            <small>${item[2]}</small>
          </div>
        `)
        .join("");
    }

    const summaryStrip = root?.querySelector?.(".summary-strip");
    if (summaryStrip) {
      summaryStrip.innerHTML = data.summary
        .map((item) => `<div><span>${item[0]}</span><strong>${item[1]}</strong></div>`)
        .join("");
    }
  }

  function populateFrontOwnerOptions(options = []) {
    const select = root?.querySelector?.("#front-owner-filter");
    if (!select) return;
    const selected = select.value;
    const mergedOptions = options.reduce((items, item) => {
      const value = item.value || item.name;
      if (!value || items.some((existing) => existing.value === value)) return items;
      items.push({ value, name: item.name || value });
      return items;
    }, []);
    select.innerHTML = `<option value="">全部负责人</option>${mergedOptions
      .map((item) => `<option value="${escapeHtml(item.value || item.name)}">${escapeHtml(item.name || item.value)}</option>`)
      .join("")}`;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function renderHomeOverview(dashboard) {
    const summaryMap = new Map((dashboard?.summary || []).map((item) => [String(item?.[0] || ""), item?.[1] || "--"]));
    const kpiMap = new Map((dashboard?.kpis || []).map((rawItem) => {
      const item = normalizeKpi(rawItem);
      return [item.title, item.value];
    }));
    setText("#home-sales-income", summaryMap.get("销售额") || kpiMap.get("总销售收入达成率") || "--", root);
    setText("#home-inventory-health", "待巡检", root);
    setText("#home-purchase-pending", "待同步", root);
    const user = typeof getCurrentAuthUser === "function" ? getCurrentAuthUser() : null;
    setText("#home-finance-cashflow", user && canAccessFinance?.(user) ? "待更新" : "--", root);
  }

  function renderDashboard(data) {
    const dashboard = normalizeDashboardPayload(data);
    globalThis.__tanjiaSalesRendered = true;
    globalThis.__tanjiaLastDashboard = dashboard;
    populateFrontOwnerOptions(dashboard.filters?.ownerOptions || []);
    renderHomeOverview(dashboard);
    runSafely("销售看板指标渲染", () => fillCards(dashboard));
    runSafely("销售看板表格渲染", () => fillTables(dashboard));
  }

  function revealMskuDetailPanel() {
    const detailTable = root?.querySelector?.("#detail-table");
    const detailPanel = detailTable?.closest?.(".detail-panel") || root?.querySelector?.(".detail-panel");
    detailPanel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function loadDashboard({ loadingOverlay = {} } = {}) {
    const hideLoadingOverlay = loadingOverlay === false ? () => {} : startDashboardLoadingOverlay({
      root,
      targetSelector: "#sales-dashboard-content",
      message: typeof loadingOverlay === "object" ? loadingOverlay.message || "正在加载销售复盘数据..." : "正在加载销售复盘数据...",
      delayMs: typeof loadingOverlay === "object" ? loadingOverlay.delayMs : undefined,
    });
    try {
      const params = new URLSearchParams(buildDashboardQuery());
      params.set("_", String(Date.now()));
      const response = await fetchImpl(`/api/dashboard/sales-weekly?${params.toString()}`, markDashboardLoadingRequest({
        cache: "no-store",
        credentials: "same-origin",
      }));
      if (response.status === 401) {
        redirectToLogin?.();
        throw new Error("登录状态已失效");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `API ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.info("销售看板接口未返回真实数据。", error);
      return makeUnavailableDashboard(`销售看板接口失败：${error.message}`);
    } finally {
      hideLoadingOverlay();
    }
  }

  function setupSalesDashboard() {
    bind(root, "#msku-store-tabs", "click", (event) => {
      const button = closestTarget(event, "[data-msku-store]");
      if (!button) return;
      mskuDetailStoreFilter = button.dataset.mskuStore || "";
      renderMskuStoreTabs();
      renderMskuDetailTable();
    });
    bindAll(root, "[data-msku-sort]", "click", function handleMskuSortClick() {
      applyMskuDetailSort(this.dataset.mskuSort);
    });
  }

  return {
    applyMskuDetailSort,
    loadDashboard,
    makeUnavailableDashboard,
    revealMskuDetailPanel,
    renderDashboard,
    setupSalesDashboard,
  };
}

import { renderMeterBar } from "../ui-components.js?v=20260707-ui-components-v1";

export function createPayablesDashboardFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  bindAll,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  setActiveElementState,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createPayablesDashboardFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createPayablesDashboardFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createPayablesDashboardFeature requires bindAll.");
  if (typeof createDebouncedAction !== "function") throw new Error("createPayablesDashboardFeature requires createDebouncedAction.");

  let payableDashboardData = createEmptyPayablesData();
  const schedulePayablesLoad = createDebouncedAction(loadPayablesDashboard, 350);

  function createEmptyPayablesData(syncStatus = "等待加载") {
    return {
      summary: {
        total: { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 },
        supplier: { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 },
        carrier: { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 },
        other: { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 },
      },
      supplierMonthly: [],
      carrierMonthly: [],
      supplierRows: [],
      carrierRows: [],
      otherRows: [],
      forecastRows: [],
      metricDocs: [
        ["供应商金额来源", "领星 ERP - 请款池 - 采购 - 现结货款。"],
        ["承运商金额来源", "领星 ERP - 请款池 - 头程款。"],
        ["其他应付金额来源", "领星 ERP - 费用管理 - 其他应付款。"],
        ["应付金额", "取请款池应付金额；缺失时用采购金额或到货金额兜底。"],
        ["实付金额", "取请款池实付金额或已付金额。"],
        ["未付金额", "取请款池未付金额；缺失时按应付金额 - 实付金额计算。"],
        ["申请中/未申请", "取请款池对应字段，用于识别审批中和尚未发起请款的金额。"],
      ],
      meta: { source: "领星 ERP", syncStatus },
    };
  }

  function formatPayableMoney(value) {
    const number = Number(value || 0);
    const sign = number < 0 ? "-" : "";
    return `${sign}¥ ${Math.abs(number).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  }

  function selectedPayableRange() {
    const start = fieldValue("#payables-start-month", "", root) || "2025-04";
    const end = fieldValue("#payables-end-month", "", root) || "2026-05";
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function monthInPayableRange(month) {
    const { start, end } = selectedPayableRange();
    return month >= start && month <= end;
  }

  function selectedPayableSupplier() {
    return trimmedFieldValue("#payables-supplier", "", root);
  }

  function selectedPayableCarrier() {
    return trimmedFieldValue("#payables-carrier", "", root);
  }

  function filterPayableRows(rows = [], type) {
    const supplier = selectedPayableSupplier().toLowerCase();
    const carrier = selectedPayableCarrier().toLowerCase();
    return rows.filter((row) => {
      if (!monthInPayableRange(row.month)) return false;
      const name = String(row.name || "").toLowerCase();
      if (type === "supplier" && supplier && !name.includes(supplier)) return false;
      if (type === "carrier" && carrier && !name.includes(carrier)) return false;
      return true;
    });
  }

  function payableRowsToSummary(rows) {
    return rows.reduce((summary, row) => {
      summary.payable += Number(row.payable || 0);
      summary.paid += Number(row.paid || 0);
      summary.unpaid += Number(row.unpaid || 0);
      summary.applying += Number(row.applying || row.reconciled || row.reconciledUnpaid || 0);
      summary.unapplied += Number(row.unapplied || row.unreconciled || row.unreconciledUnpaid || 0);
      return summary;
    }, { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 });
  }

  function setPayableMoney(selector, value) {
    setText(selector, formatPayableMoney(value), root);
  }

  function monthStartDate(value) {
    return value ? `${value}-01` : "";
  }

  function monthEndDate(value) {
    if (!value) return "";
    const [year, month] = value.split("-").map(Number);
    if (!year || !month) return "";
    return formatDate(new Date(year, month, 0));
  }

  function buildPayablesQuery() {
    const params = new URLSearchParams();
    const startMonth = fieldValue("#payables-start-month", "", root);
    const endMonth = fieldValue("#payables-end-month", "", root);
    const startDate = monthStartDate(startMonth);
    const endDate = monthEndDate(endMonth);
    const supplier = selectedPayableSupplier();
    const carrier = selectedPayableCarrier();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (supplier) params.set("supplier", supplier);
    if (carrier) params.set("carrier", carrier);
    return params.toString();
  }

  function renderPayableSummary() {
    const supplierRows = filterPayableRows(payableDashboardData.supplierRows || [], "supplier");
    const carrierRows = filterPayableRows(payableDashboardData.carrierRows || [], "carrier");
    const otherRows = filterPayableRows(payableDashboardData.otherRows || [], "other");
    const supplier = payableRowsToSummary(supplierRows);
    const carrier = payableRowsToSummary(carrierRows);
    const other = otherRows.length ? payableRowsToSummary(otherRows) : (payableDashboardData.summary?.other || { payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 });
    const total = payableRowsToSummary([...supplierRows, ...carrierRows, ...otherRows]);
    if (!otherRows.length) {
      total.payable += Number(other.payable || 0);
      total.paid += Number(other.paid || 0);
      total.unpaid += Number(other.unpaid || 0);
      total.applying += Number(other.applying || other.reconciled || 0);
      total.unapplied += Number(other.unapplied || other.unreconciled || 0);
    }

    const totalPayable = Number(total.payable || 0);
    const totalPaid = Number(total.paid || 0);
    const totalUnpaid = Number(total.unpaid || 0);
    const supplierPayable = Number(supplier.payable || 0);
    const carrierPayable = Number(carrier.payable || 0);
    const otherPayable = Number(other.payable || 0);
    const supplierShare = totalPayable ? (supplierPayable / totalPayable) * 100 : 0;
    const carrierShare = totalPayable ? (carrierPayable / totalPayable) * 100 : 0;
    const otherShare = totalPayable ? (otherPayable / totalPayable) * 100 : 0;
    const paidRate = totalPayable ? (totalPaid / totalPayable) * 100 : 0;
    const unpaidRate = totalPayable ? (totalUnpaid / totalPayable) * 100 : 0;

    setPayableMoney("#payables-kpi-payable", totalPayable);
    setPayableMoney("#payables-kpi-supplier-payable", supplierPayable);
    setPayableMoney("#payables-kpi-carrier-payable", carrierPayable);
    setPayableMoney("#payables-kpi-other-payable", otherPayable);
    setText("#payables-kpi-total-note", `实付率 ${paidRate.toFixed(1)}% · 未付率 ${unpaidRate.toFixed(1)}%`, root);
    setText("#payables-kpi-supplier-note", `占总应付 ${supplierShare.toFixed(1)}%`, root);
    setText("#payables-kpi-carrier-note", `占总应付 ${carrierShare.toFixed(1)}%`, root);
    setText("#payables-kpi-other-note", `占总应付 ${otherShare.toFixed(1)}%`, root);

    renderPayableStatusRows([
      { label: "合计", ...total },
      { label: "供应商", ...supplier },
      { label: "承运商", ...carrier },
      { label: "其他应付", ...other },
    ]);
  }

  function payableStatusParts(summary) {
    const payable = Math.max(Number(summary.payable || 0), 0);
    const paid = Math.max(Number(summary.paid || 0), 0);
    const unpaid = Math.max(Number(summary.unpaid || 0), 0);
    const denominator = Math.max(payable, paid, unpaid, 1);
    return { payable, paid, unpaid, denominator };
  }

  function renderPayableStatusRows(groups) {
    const container = root?.querySelector?.("#payables-status-rows");
    if (!container) return;
    container.innerHTML = groups.map((group) => {
      const parts = payableStatusParts(group);
      const unpaidRate = parts.payable ? (parts.unpaid / parts.payable) * 100 : 0;
      const bar = (key, tone, label) => {
        const value = parts[key];
        return `
          <div class="payable-comparison-line">
            <span>${label}</span>
            <div>${renderMeterBar({
              value,
              max: parts.denominator,
              tone,
              label: `${group.label}${label}`,
            })}</div>
            <strong>${formatPayableMoney(value)}</strong>
          </div>
        `;
      };
      return `
        <div class="payable-status-row">
          <div class="payable-status-title">
            <strong>${escapeHtml(group.label)}</strong>
            <span>未付率 ${unpaidRate.toFixed(1)}%</span>
          </div>
          <div class="payable-status-metrics">
            <span>应付 ${formatPayableMoney(parts.payable)}</span>
            <span>实付 ${formatPayableMoney(parts.paid)}</span>
            <span>未付 ${formatPayableMoney(parts.unpaid)}</span>
          </div>
          <div class="payable-comparison-bars" aria-label="${escapeHtml(group.label)}资金状态">
            ${bar("payable", "neutral", "应付金额")}
            ${bar("paid", "blue", "实付金额")}
            ${bar("unpaid", "danger", "未付金额")}
          </div>
        </div>
      `;
    }).join("");
  }

  function groupPayableRows(rows, keys) {
    const grouped = rows.reduce((result, row) => {
      const id = keys.map((key) => row[key]).join("|");
      if (!result[id]) {
        result[id] = { category: row.category, name: row.name, accountType: keys.includes("accountType") ? row.accountType : "全部", month: keys.includes("month") ? row.month : "全部", payable: 0, paid: 0, unpaid: 0, applying: 0, unapplied: 0 };
      }
      result[id].payable += Number(row.payable || 0);
      result[id].paid += Number(row.paid || 0);
      result[id].unpaid += Number(row.unpaid || 0);
      result[id].applying += Number(row.applying || row.reconciled || row.reconciledUnpaid || 0);
      result[id].unapplied += Number(row.unapplied || row.unreconciled || row.unreconciledUnpaid || 0);
      return result;
    }, {});
    return Object.values(grouped);
  }

  function renderPayableDetail() {
    const active = root?.querySelector?.('[data-payable-tabs="detail"] button.active')?.dataset.detail || "supplierSummary";
    const table = root?.querySelector?.("#payables-detail-table");
    const tbody = table?.querySelector("tbody");
    const thead = table?.querySelector("thead");
    if (!table || !tbody || !thead) return;
    const detailConfig = {
      supplierSummary: { title: "汇总 · 供应商", rows: groupPayableRows(filterPayableRows(payableDashboardData.supplierRows, "supplier"), ["category", "name"]), type: "supplier" },
      supplierMonthly: { title: "月度汇总 · 供应商", rows: groupPayableRows(filterPayableRows(payableDashboardData.supplierRows, "supplier"), ["category", "name", "accountType", "month"]), type: "supplier" },
      supplierDetail: { title: "明细表 · 供应商", rows: filterPayableRows(payableDashboardData.supplierRows, "supplier"), type: "supplier" },
      carrierSummary: { title: "汇总 · 承运商", rows: groupPayableRows(filterPayableRows(payableDashboardData.carrierRows, "carrier"), ["category", "name"]), type: "carrier" },
      carrierMonthly: { title: "月度汇总 · 承运商", rows: groupPayableRows(filterPayableRows(payableDashboardData.carrierRows, "carrier"), ["category", "name", "accountType", "month"]), type: "carrier" },
      carrierDetail: { title: "明细表 · 承运商", rows: filterPayableRows(payableDashboardData.carrierRows, "carrier"), type: "carrier" },
      otherSummary: { title: "汇总 · 其他应付", rows: groupPayableRows(filterPayableRows(payableDashboardData.otherRows || [], "other"), ["category", "name"]), type: "other" },
      otherDetail: { title: "明细表 · 其他应付", rows: filterPayableRows(payableDashboardData.otherRows || [], "other"), type: "other" },
    };

    if (active === "metricDoc") {
      const docs = payableDashboardData.metricDocs || [];
      setText("#payables-detail-title", "指标说明", root);
      setText("#payables-detail-count", `共 ${docs.length} 条说明`, root);
      thead.innerHTML = `<tr><th scope="col" class="table-col-text">指标名称</th><th scope="col" class="table-col-text">说明</th></tr>`;
      tbody.innerHTML = docs.length
        ? docs.map((row) => `<tr><td class="table-col-text"><strong>${escapeHtml(row[0])}</strong></td><td class="table-col-text">${escapeHtml(row[1])}</td></tr>`).join("")
        : `<tr class="table-state-row"><td class="table-state is-empty" colspan="2">暂无指标说明。</td></tr>`;
      return;
    }

    const config = detailConfig[active] || detailConfig.supplierSummary;
    setText("#payables-detail-title", config.title, root);
    setText("#payables-detail-count", `共 ${config.rows.length} 条数据`, root);
    const nameTitle = config.type === "carrier" ? "承运商名称" : config.type === "other" ? "对象名称" : "供应商名称";
    thead.innerHTML = `<tr><th scope="col" class="table-col-text">类别</th><th scope="col" class="table-col-text">${nameTitle}</th><th scope="col" class="table-col-text">请款维度</th><th scope="col" class="table-col-date">账单月份</th><th scope="col" class="table-col-money">应付金额</th><th scope="col" class="table-col-money">实付金额</th><th scope="col" class="table-col-money">未付金额</th><th scope="col" class="table-col-money">申请中</th><th scope="col" class="table-col-money">未申请</th></tr>`;
    tbody.innerHTML = config.rows.length ? config.rows.map((row) => `
      <tr><td class="table-col-text">${escapeHtml(row.category || "-")}</td><td class="table-col-text"><strong>${escapeHtml(row.name || "-")}</strong></td><td class="table-col-text">${escapeHtml(row.accountType || "全部")}</td><td class="table-col-date">${escapeHtml(row.month || "全部")}</td><td class="table-col-money">${formatPayableMoney(row.payable)}</td><td class="table-col-money">${formatPayableMoney(row.paid)}</td><td class="table-col-money"><strong>${formatPayableMoney(row.unpaid)}</strong></td><td class="table-col-money">${formatPayableMoney(row.applying || row.reconciled || 0)}</td><td class="table-col-money">${formatPayableMoney(row.unapplied || row.unreconciled || 0)}</td></tr>
    `).join("") : `<tr class="table-state-row"><td class="table-state is-empty" colspan="9">暂无符合筛选条件的应付账款数据。</td></tr>`;
  }

  function renderPayablesDashboard() {
    setText("#payables-status-text", `${payableDashboardData.meta?.source || "领星 ERP · 请款池"} · ${payableDashboardData.meta?.syncStatus || ""}`, root);
    renderPayableSummary();
    renderPayableDetail();
  }

  async function loadPayablesDashboard() {
    await loadDashboardSection({
      endpoint: `/api/dashboard/payables?${buildPayablesQuery()}`,
      buttonSelector: "#payables-refresh-button",
      busyText: "刷新中...",
      restoreText: "刷新应付",
      buttonBusyOptions: { disable: false },
      statusSelector: "#payables-status-text",
      loadingStatus: "正在读取领星 ERP：采购-现结货款、头程款、其他应付款",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || data.meta?.syncStatus || `API ${response.status}`,
      onData: (data) => {
        payableDashboardData = data;
      },
      onError: (error) => {
        payableDashboardData = error.payload || createEmptyPayablesData(`读取失败：${error.message}`);
      },
      onFinally: renderPayablesDashboard,
      root,
    });
  }

  function handlePayableTabsClick(event) {
    const tabs = event.currentTarget;
    const button = closestTarget(event, "button");
    if (!button || !tabs?.contains?.(button)) return;
    setActiveElementState(tabs.querySelectorAll("button"), button);
    if (tabs.dataset.payableTabs === "detail") renderPayableDetail();
  }

  function setupPayablesDashboard() {
    bind(root, "#payables-refresh-button", "click", loadPayablesDashboard);
    bind(root, "#payables-start-month", "change", loadPayablesDashboard);
    bind(root, "#payables-end-month", "change", loadPayablesDashboard);
    bind(root, "#payables-supplier", "input", schedulePayablesLoad);
    bind(root, "#payables-carrier", "input", schedulePayablesLoad);
    bindAll(root, ".payable-tabs", "click", handlePayableTabsClick);
  }

  return {
    loadPayablesDashboard,
    renderPayableDetail,
    setupPayablesDashboard,
  };
}

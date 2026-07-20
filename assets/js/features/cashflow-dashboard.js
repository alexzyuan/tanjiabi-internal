export function createCashflowDashboardFeature({
  root = globalThis.document,
  loadDashboardSection,
  addDays,
  bind,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  fieldValue,
  formatActualMoney,
  formatDate,
  getPacificTodayDate,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createCashflowDashboardFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createCashflowDashboardFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createCashflowDashboardFeature requires fetch.");

  let cashflowStoreFilterOptions = [];

  function formatCashAmount(value, symbol = "¥") {
    const prefix = symbol ? `${symbol} ` : "";
    return `${prefix}${formatActualMoney(value || 0)}`;
  }

  function setDefaultCashflowDates() {
    const startInput = root?.querySelector?.("#cashflow-start-date");
    const endInput = root?.querySelector?.("#cashflow-end-date");
    const today = getPacificTodayDate();
    if (endInput && !endInput.value) endInput.value = formatDate(today);
    if (startInput && !startInput.value) startInput.value = formatDate(addDays(today, -29));
  }

  function buildCashflowQuery() {
    setDefaultCashflowDates();
    const params = new URLSearchParams();
    const startDate = fieldValue("#cashflow-start-date", "", root);
    const endDate = fieldValue("#cashflow-end-date", "", root);
    const dateType = fieldValue("#cashflow-date-type", "", root) || "0";
    const currencyCode = fieldValue("#cashflow-currency", "", root) || "ORIGINAL";
    const status = fieldValue("#cashflow-status", "", root) || "Open";
    const country = selectedFilterValue("#cashflow-country", root);
    const storeName = selectedFilterValue("#cashflow-store", root);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (dateType) params.set("dateType", dateType);
    if (currencyCode) params.set("currencyCode", currencyCode);
    if (status) params.set("status", status);
    if (country) params.set("country", country);
    if (storeName) params.set("storeName", storeName);
    return params.toString();
  }

  function populateCashflowCountryOptions(options = []) {
    setSelectOptions("#cashflow-country", options, "全部国家");
  }

  function populateCashflowStoreOptions(options = [], { selectAllStores = false } = {}) {
    cashflowStoreFilterOptions = options || [];
    const countries = selectedFilterValues("#cashflow-country", root);
    setSelectOptions("#cashflow-store", cashflowStoreFilterOptions, "全部店铺", { groupByCountry: true, countries, selectAllVisible: selectAllStores });
  }

  function renderCashflow(data) {
    const symbol = data.meta?.symbol || "¥";
    const kpis = data.kpis || {};
    setText("#cashflow-pending", formatCashAmount(kpis.pendingAmount, symbol), root);
    setText("#cashflow-standard", formatCashAmount(kpis.standardAmount, symbol), root);
    setText("#cashflow-income", formatCashAmount(kpis.income, symbol), root);
    setText("#cashflow-refund", formatCashAmount(kpis.refund, symbol), root);
    setText("#cashflow-expense", formatCashAmount(kpis.expense, symbol), root);
    setText("#cashflow-status-text", data.meta?.syncStatus || "已加载", root);
    setText("#cashflow-next-capture", `下次自动留存：${data.meta?.nextCaptureText || "周二或周五"}`, root);

    populateCashflowCountryOptions(data.filters?.countryOptions || []);
    populateCashflowStoreOptions(data.filters?.storeOptions || data.storeRows || []);

    const storeTable = root?.querySelector?.("#cashflow-store-table");
    if (storeTable) {
      const rows = data.storeRows || [];
      if (!rows.length) {
        renderTableMessage(storeTable, 12, "暂无结算汇总数据。", root, { tone: "empty" });
      } else {
        storeTable.innerHTML = rows.map((row) => `
        <tr>
          <td><strong>${escapeHtml(row.storeName)}</strong></td>
          <td>${escapeHtml(row.country || "-")}</td>
          <td><span class="status-pill ${row.rawStatus === "Closed" ? "active" : "disabled"}">${escapeHtml(row.status || "-")}</span></td>
          <td>${escapeHtml(row.currencyCode || "")}</td>
          <td>${formatCashAmount(row.pendingAmount, row.symbol)}</td>
          <td>${formatCashAmount(row.delayedAmount, row.symbol)}</td>
          <td>${formatCashAmount(row.standardAmount, row.symbol)}</td>
          <td>${formatCashAmount(row.income, row.symbol)}</td>
          <td>${formatCashAmount(row.refund, row.symbol)}</td>
          <td>${formatCashAmount(row.expense, row.symbol)}</td>
          <td>${escapeHtml(row.settlementStart || "-")}</td>
          <td>${escapeHtml(row.estimatedTransferDate || row.transferDate || "-")}</td>
        </tr>
      `).join("");
      }
    }

    const historyTable = root?.querySelector?.("#cashflow-history-table");
    if (historyTable) {
      const rows = (data.history || []).flatMap((snapshot) => {
        const storeRows = snapshot.storeRows?.length ? snapshot.storeRows : [];
        if (!storeRows.length) {
          return [{
            capturedAt: snapshot.capturedAt || snapshot.captureDate || "-",
            periodText: snapshot.periodText || "-",
            country: "-",
            storeName: "合计",
            currencyCode: snapshot.currencyMode || "",
            symbol: snapshot.symbol || symbol,
            status: "-",
            pendingAmount: snapshot.kpis?.pendingAmount || 0,
            delayedAmount: snapshot.kpis?.delayedAmount || 0,
            standardAmount: snapshot.kpis?.standardAmount || 0,
            income: snapshot.kpis?.income || 0,
            refund: snapshot.kpis?.refund || 0,
            expense: snapshot.kpis?.expense || 0,
            settlementStart: "-",
            transferDate: "-",
            estimatedTransferDate: "-",
          }];
        }
        return storeRows.map((row) => ({
          ...row,
          capturedAt: snapshot.capturedAt || snapshot.captureDate || "-",
          periodText: snapshot.periodText || "-",
          symbol: row.symbol || snapshot.symbol || symbol,
        }));
      });

      if (!rows.length) {
        renderTableMessage(historyTable, 14, "暂无留存记录。系统会在每周二、周五自动留存，也可以手动留存一次。", root, { tone: "empty" });
      } else {
        historyTable.innerHTML = rows.map((item) => `
        <tr>
          <td>${escapeHtml(item.capturedAt || item.captureDate || "-")}</td>
          <td>${escapeHtml(item.periodText || "-")}</td>
          <td>${escapeHtml(item.country || "-")}</td>
          <td><strong>${escapeHtml(item.storeName || "-")}</strong></td>
          <td>${escapeHtml(item.currencyCode || "")}</td>
          <td>${escapeHtml(item.status || "-")}</td>
          <td>${formatCashAmount(item.pendingAmount, item.symbol || symbol)}</td>
          <td>${formatCashAmount(item.delayedAmount, item.symbol || symbol)}</td>
          <td>${formatCashAmount(item.standardAmount, item.symbol || symbol)}</td>
          <td>${formatCashAmount(item.income, item.symbol || symbol)}</td>
          <td>${formatCashAmount(item.refund, item.symbol || symbol)}</td>
          <td>${formatCashAmount(item.expense, item.symbol || symbol)}</td>
          <td>${escapeHtml(item.settlementStart || "-")}</td>
          <td>${escapeHtml(item.estimatedTransferDate || item.transferDate || "-")}</td>
        </tr>
      `).join("");
      }
    }
  }

  async function loadCashflowDashboard() {
    setDefaultCashflowDates();
    await loadDashboardSection({
      endpoint: `/api/dashboard/platform-cashflow?${buildCashflowQuery()}`,
      buttonSelector: "#cashflow-refresh-button",
      busyText: "刷新中...",
      restoreText: "刷新回款",
      buttonBusyOptions: { disable: false },
      statusSelector: "#cashflow-status-text",
      loadingStatus: "正在读取领星结算汇总",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || `API ${response.status}`,
      onData: renderCashflow,
      onError: (error) => {
        setText("#cashflow-status-text", `平台回款加载失败：${error.message}`, root);
        root?.querySelector?.("#cashflow-store-table")?.replaceChildren();
        const storeTable = root?.querySelector?.("#cashflow-store-table");
        renderTableMessage(storeTable, 12, "加载失败，请稍后重试。", root, { tone: "error" });
      },
      root,
    });
  }

  async function captureCashflowSnapshot() {
    const button = root?.querySelector?.("#cashflow-capture-button");
    const restoreButton = setButtonBusy(button, "留存中...", "手动留存", { disable: false });
    try {
      const response = await fetchImpl(`/api/platform-cashflow/capture?${buildCashflowQuery()}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      setText("#cashflow-status-text", data.message || "平台回款快照已留存", root);
      await loadCashflowDashboard();
    } catch (error) {
      setText("#cashflow-status-text", `留存失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  function handleCashflowCountryChange() {
    syncAllOptionSelection(root?.querySelector?.("#cashflow-country"));
    populateCashflowStoreOptions(cashflowStoreFilterOptions, { selectAllStores: true });
    loadCashflowDashboard();
  }

  function handleCashflowStoreChange() {
    syncAllOptionSelection(root?.querySelector?.("#cashflow-store"));
    loadCashflowDashboard();
  }

  function setupCashflowDashboard() {
    bind(root, "#cashflow-refresh-button", "click", loadCashflowDashboard);
    bind(root, "#cashflow-capture-button", "click", captureCashflowSnapshot);
    bind(root, "#cashflow-start-date", "change", loadCashflowDashboard);
    bind(root, "#cashflow-end-date", "change", loadCashflowDashboard);
    bind(root, "#cashflow-date-type", "change", loadCashflowDashboard);
    bind(root, "#cashflow-currency", "change", loadCashflowDashboard);
    bind(root, "#cashflow-status", "change", loadCashflowDashboard);
    bind(root, "#cashflow-country", "change", handleCashflowCountryChange);
    bind(root, "#cashflow-store", "change", handleCashflowStoreChange);
  }

  return {
    buildCashflowQuery,
    captureCashflowSnapshot,
    loadCashflowDashboard,
    renderCashflow,
    setDefaultCashflowDates,
    setupCashflowDashboard,
  };
}

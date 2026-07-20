export function createSupplierBoardFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  bindAll,
  closestTarget,
  compareTableSortableValues,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatRateNullable,
  normalizeCountryName,
  selectedFilterValues,
  setSelectOptions,
  setTableSortButtonGroupState,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createSupplierBoardFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createSupplierBoardFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createSupplierBoardFeature requires bindAll.");
  if (typeof closestTarget !== "function") throw new Error("createSupplierBoardFeature requires closestTarget.");

  let supplierBoardData = {
    meta: { source: "领星 ERP · salesStat 销量统计", syncStatus: "等待加载" },
    summary: { quantity: 0, purchaseCostSubtotal: 0, ordinaryInvoicePurchaseCost: 0, ordinaryInvoiceCost: 0, supplierCount: 0, skuCount: 0 },
    rows: [],
  };
  let supplierBoardSort = { key: "", direction: "" };
  let supplierBoardStoreFilterOptions = [];

  const visibleLimit = 500;
  const numericSortKeys = new Set([
    "quantity",
    "purchasePrice",
    "purchaseCostSubtotal",
    "ordinaryInvoicePurchaseCost",
    "ordinaryInvoiceTaxRate",
    "ordinaryInvoiceCost",
    "specialInvoiceTaxRate",
  ]);
  const exportHeaders = [
    ["imageUrl", "图片链接"],
    ["storeName", "店铺"],
    ["country", "国家"],
    ["msku", "MSKU"],
    ["productName", "品名"],
    ["sku", "SKU"],
    ["model", "型号"],
    ["quantity", "销量统计"],
    ["supplier", "供应商"],
    ["purchasePrice", "采购价"],
    ["purchaseCostSubtotal", "采购成本小计"],
    ["ordinaryInvoicePurchaseCost", "普票采购成本"],
    ["ordinaryInvoiceTaxRate", "普票税点"],
    ["ordinaryInvoiceCost", "普票成本"],
    ["specialInvoiceTaxRate", "专票税点"],
    ["taxFactoryName", "税点匹配工厂"],
  ];

  function padSupplierBoardNumber(value) {
    return String(value).padStart(2, "0");
  }

  function currentSupplierBoardPeriod() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: `${now.getFullYear()}-${padSupplierBoardNumber(now.getMonth() + 1)}`,
    };
  }

  function shiftSupplierBoardMonth(monthText, offset) {
    const match = String(monthText || "").match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const year = match ? Number(match[1]) : now.getFullYear();
    const month = match ? Number(match[2]) : now.getMonth() + 1;
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${padSupplierBoardNumber(date.getMonth() + 1)}`;
  }

  function normalizeSupplierBoardSearchText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）【】\[\]·.,，。-]/g, "")
      .replace(/有限责任公司|股份有限公司|有限公司|科技|玩具|实业|贸易|商贸|工厂|厂/g, "");
  }

  function supplierBoardFuzzyMatch(value, keyword) {
    const rawKeyword = String(keyword || "").trim().toLowerCase();
    if (!rawKeyword) return true;
    const rawValue = String(value || "").toLowerCase();
    if (rawValue.includes(rawKeyword)) return true;
    const normalizedValue = normalizeSupplierBoardSearchText(value);
    const normalizedKeyword = normalizeSupplierBoardSearchText(keyword);
    return Boolean(normalizedKeyword && normalizedValue.includes(normalizedKeyword));
  }

  function updateSupplierBoardDateInputs() {
    const dimension = fieldValue("#supplier-board-dimension", "", root) || "month";
    const startInput = root?.querySelector?.("#supplier-board-start-date");
    const endInput = root?.querySelector?.("#supplier-board-end-date");
    const startLabel = root?.querySelector?.("#supplier-board-start-label");
    const endLabel = root?.querySelector?.("#supplier-board-end-label");
    if (!startInput || !endInput) return;

    const previousStart = startInput.value || "";
    const previousEnd = endInput.value || "";
    startInput.type = "text";
    endInput.type = "text";
    startInput.inputMode = "numeric";
    endInput.inputMode = "numeric";
    startInput.removeAttribute("min");
    endInput.removeAttribute("min");
    startInput.removeAttribute("max");
    endInput.removeAttribute("max");
    startInput.removeAttribute("step");
    endInput.removeAttribute("step");
    if (dimension === "year") {
      startInput.placeholder = "2025";
      endInput.placeholder = "2025";
      startInput.value = previousStart ? String(previousStart).slice(0, 4) : "";
      endInput.value = previousEnd ? String(previousEnd).slice(0, 4) : "";
      if (startLabel) startLabel.textContent = "开始年份";
      if (endLabel) endLabel.textContent = "结束年份";
      return;
    }

    startInput.placeholder = "2025-01";
    endInput.placeholder = "2025-12";
    startInput.value = /^\d{4}$/.test(String(previousStart)) ? `${previousStart}-01` : previousStart.slice(0, 7);
    endInput.value = /^\d{4}$/.test(String(previousEnd)) ? `${previousEnd}-12` : previousEnd.slice(0, 7);
    if (startLabel) startLabel.textContent = "开始月份";
    if (endLabel) endLabel.textContent = "结束月份";
  }

  function setDefaultSupplierBoardDates() {
    updateSupplierBoardDateInputs();
    const endInput = root?.querySelector?.("#supplier-board-end-date");
    const startInput = root?.querySelector?.("#supplier-board-start-date");
    if (!endInput || !startInput) return;
    const dimension = fieldValue("#supplier-board-dimension", "", root) || "month";
    const current = currentSupplierBoardPeriod();
    if (dimension === "year") {
      if (!endInput.value) endInput.value = String(current.year);
      if (!startInput.value) startInput.value = String(current.year);
      return;
    }
    if (!endInput.value) endInput.value = current.month;
    if (!startInput.value) startInput.value = shiftSupplierBoardMonth(current.month, -2);
  }

  function buildSupplierBoardQuery({ forceRefresh = false } = {}) {
    const params = new URLSearchParams();
    const dimension = fieldValue("#supplier-board-dimension", "", root) || "month";
    const startDate = fieldValue("#supplier-board-start-date", "", root);
    const endDate = fieldValue("#supplier-board-end-date", "", root);
    if (dimension) params.set("dimension", dimension);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (forceRefresh) params.set("forceRefresh", "1");
    return params.toString();
  }

  function populateSupplierBoardFilters({ selectAllStores = false } = {}) {
    const rows = supplierBoardData.rows || [];
    const countryOptions = [...new Set(rows.map((row) => normalizeCountryName(row.country)).filter((item) => item && item !== "-"))]
      .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
      .map((name) => ({ name }));
    supplierBoardStoreFilterOptions = [...new Set(rows.map((row) => row.storeName).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"))
      .map((name) => {
        const match = rows.find((row) => row.storeName === name);
        return { name, country: normalizeCountryName(match?.country || "") };
      });
    setSelectOptions("#supplier-board-country", countryOptions, "全部国家");
    const countries = selectedFilterValues("#supplier-board-country", root);
    setSelectOptions("#supplier-board-store", supplierBoardStoreFilterOptions, "全部店铺", {
      groupByCountry: true,
      countries,
      selectAllVisible: selectAllStores,
    });
  }

  function getSupplierBoardClientRows() {
    const storeNames = selectedFilterValues("#supplier-board-store", root);
    const countries = new Set(selectedFilterValues("#supplier-board-country", root).map(normalizeCountryName));
    const supplier = trimmedFieldValue("#supplier-board-supplier", "", root);
    const keyword = trimmedFieldValue("#supplier-board-keyword", "", root);
    return (supplierBoardData.rows || []).filter((row) => {
      if (storeNames.length && !storeNames.includes(String(row.storeName || "").trim())) return false;
      if (countries.size && !countries.has(normalizeCountryName(row.country))) return false;
      if (supplier && !supplierBoardFuzzyMatch(row.supplier, supplier)) return false;
      if (keyword && !supplierBoardFuzzyMatch(`${row.msku} ${row.sku} ${row.productName} ${row.model}`, keyword)) return false;
      return true;
    });
  }

  function supplierBoardSortValue(row, key) {
    if (key === "productName") return `${row.productName || ""} ${row.sku || ""}`;
    return row?.[key];
  }

  function compareSupplierBoardRows(left, right, key) {
    const leftValue = supplierBoardSortValue(left, key);
    const rightValue = supplierBoardSortValue(right, key);
    if (numericSortKeys.has(key)) {
      const leftNumber = Number(leftValue);
      const rightNumber = Number(rightValue);
      const leftValid = Number.isFinite(leftNumber);
      const rightValid = Number.isFinite(rightNumber);
      if (leftValid && rightValid) return leftNumber - rightNumber;
      if (leftValid) return -1;
      if (rightValid) return 1;
    }
    return compareTableSortableValues(leftValue, rightValue);
  }

  function getSupplierBoardDisplayRows() {
    const rows = getSupplierBoardClientRows();
    if (!supplierBoardSort.key) return rows;
    const multiplier = supplierBoardSort.direction === "asc" ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const result = compareSupplierBoardRows(left.row, right.row, supplierBoardSort.key);
        return result === 0 ? left.index - right.index : result * multiplier;
      })
      .map(({ row }) => row);
  }

  function renderSupplierBoardSortState() {
    setTableSortButtonGroupState("#supplier-board-table button[data-supplier-sort]", "supplierSort", supplierBoardSort.key, supplierBoardSort.direction);
  }

  function applySupplierBoardSort(key) {
    if (!key) return;
    supplierBoardSort = {
      key,
      direction: supplierBoardSort.key === key && supplierBoardSort.direction === "asc" ? "desc" : "asc",
    };
    renderSupplierBoard();
  }

  function summarizeSupplierBoardRows(rows) {
    const supplierSet = new Set(rows.map((row) => row.supplier).filter(Boolean));
    const mskuSet = new Set(rows.map((row) => row.msku || row.sku).filter(Boolean));
    return {
      quantity: rows.reduce((total, row) => total + Number(row.quantity || 0), 0),
      purchaseCostSubtotal: rows.reduce((total, row) => total + Number(row.purchaseCostSubtotal || 0), 0),
      ordinaryInvoicePurchaseCost: rows.reduce((total, row) => total + Number(row.ordinaryInvoicePurchaseCost || 0), 0),
      ordinaryInvoiceCost: rows.reduce((total, row) => total + Number(row.ordinaryInvoiceCost || 0), 0),
      supplierCount: supplierSet.size,
      skuCount: mskuSet.size,
    };
  }

  function renderSupplierBoard() {
    populateSupplierBoardFilters();
    const rows = getSupplierBoardDisplayRows();
    const visibleRows = rows.slice(0, visibleLimit);
    const summary = summarizeSupplierBoardRows(rows);
    renderSupplierBoardSortState();
    setText("#supplier-board-status", `${supplierBoardData.meta?.source || "领星 ERP"} · ${supplierBoardData.meta?.syncStatus || ""}`, root);
    setText("#supplier-board-quantity", formatActualMoney(summary.quantity || 0), root);
    setText("#supplier-board-purchase-cost", `¥ ${formatActualMoney(summary.purchaseCostSubtotal || 0)}`, root);
    setText("#supplier-board-ordinary-purchase-cost", `¥ ${formatActualMoney(summary.ordinaryInvoicePurchaseCost || 0)}`, root);
    setText("#supplier-board-ordinary-cost", `¥ ${formatActualMoney(summary.ordinaryInvoiceCost || 0)}`, root);
    setText("#supplier-board-supplier-count", formatActualMoney(summary.supplierCount || 0), root);
    setText("#supplier-board-sku-count", formatActualMoney(summary.skuCount || 0), root);
    setText(
      "#supplier-board-count",
      rows.length > visibleRows.length
        ? `共 ${rows.length} 条数据，当前显示前 ${visibleRows.length} 条`
        : `共 ${rows.length} 条数据`,
      root,
    );
    const tbody = root?.querySelector?.("#supplier-board-table tbody");
    if (!tbody) return;
    tbody.innerHTML = visibleRows.length ? visibleRows.map((row) => `
      <tr>
        <td class="table-col-text">${row.imageUrl ? `<img class="supplier-board-image" src="${escapeHtml(row.imageUrl)}" alt="">` : `<span class="image-placeholder">-</span>`}</td>
        <td class="table-col-text"><strong>${escapeHtml(row.storeName || "-")}</strong></td>
        <td class="table-col-text">${escapeHtml(row.country || "-")}</td>
        <td class="table-col-text"><strong>${escapeHtml(row.msku || "-")}</strong></td>
        <td class="table-col-text"><strong>${escapeHtml(row.productName || "-")}</strong><small>${escapeHtml(row.sku || "-")}</small></td>
        <td class="table-col-text">${escapeHtml(row.model || "-")}</td>
        <td class="table-col-number">${formatActualMoney(row.quantity || 0)}</td>
        <td class="table-col-text"><strong>${escapeHtml(row.supplier || "-")}</strong><small>${row.taxFactoryName ? `匹配：${escapeHtml(row.taxFactoryName)}` : "税点未匹配"}</small></td>
        <td class="table-col-money">¥ ${formatActualMoney(row.purchasePrice || 0)}</td>
        <td class="table-col-money">¥ ${formatActualMoney(row.purchaseCostSubtotal || 0)}</td>
        <td class="table-col-money">${row.ordinaryInvoicePurchaseCost === null || row.ordinaryInvoicePurchaseCost === undefined ? "-" : `¥ ${formatActualMoney(row.ordinaryInvoicePurchaseCost || 0)}`}</td>
        <td class="table-col-percent">${formatRateNullable(row.ordinaryInvoiceTaxRate)}</td>
        <td class="table-col-money">${row.ordinaryInvoiceCost === null || row.ordinaryInvoiceCost === undefined ? "-" : `¥ ${formatActualMoney(row.ordinaryInvoiceCost || 0)}`}</td>
        <td class="table-col-percent">${formatRateNullable(row.specialInvoiceTaxRate)}</td>
      </tr>
    `).join("") : `<tr class="table-state-row"><td class="table-state is-empty" colspan="14">暂无符合筛选条件的供应商销售数据。</td></tr>`;
  }

  function supplierBoardExportValue(row, key) {
    if (key === "ordinaryInvoiceTaxRate" || key === "specialInvoiceTaxRate") {
      return row[key] === null || row[key] === undefined ? "" : `${(Number(row[key] || 0) * 100).toFixed(2)}%`;
    }
    if (["quantity", "purchasePrice", "purchaseCostSubtotal", "ordinaryInvoicePurchaseCost", "ordinaryInvoiceCost"].includes(key)) {
      return row[key] === null || row[key] === undefined ? "" : Number(row[key] || 0);
    }
    return row[key] ?? "";
  }

  function buildSupplierBoardExportHtml(rows) {
    const headerHtml = exportHeaders.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("");
    const rowsHtml = rows.map((row) => `
      <tr>
        ${exportHeaders.map(([key]) => `<td>${escapeHtml(supplierBoardExportValue(row, key))}</td>`).join("")}
      </tr>
    `).join("");
    return `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <table border="1">
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="${exportHeaders.length}">暂无符合筛选条件的数据</td></tr>`}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  function exportSupplierBoardExcel() {
    const rows = getSupplierBoardDisplayRows();
    const startDate = fieldValue("#supplier-board-start-date", "", root);
    const endDate = fieldValue("#supplier-board-end-date", "", root);
    const filename = `供应商销售明细_${startDate || "开始"}_${endDate || "结束"}.xls`.replace(/[\\/:*?"<>|]/g, "-");
    const blob = new Blob([buildSupplierBoardExportHtml(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
    downloadBlob(blob, filename);
  }

  async function loadSupplierBoard(options = {}) {
    setDefaultSupplierBoardDates();
    const forceRefresh = Boolean(options.forceRefresh);
    await loadDashboardSection({
      endpoint: `/api/dashboard/supplier-board?${buildSupplierBoardQuery({ forceRefresh })}`,
      buttonSelector: "#supplier-board-refresh",
      busyText: "刷新中...",
      restoreText: "刷新看板",
      buttonBusyOptions: { disable: false },
      statusSelector: "#supplier-board-status",
      loadingStatus: forceRefresh ? "正在实时读取领星 salesStat、产品管理和供应商税点" : "正在读取服务器缓存和领星 salesStat",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || data.meta?.syncStatus || `API ${response.status}`,
      onData: (data) => {
        supplierBoardData = data;
      },
      onError: (error) => {
        supplierBoardData = error.payload || {
          meta: { source: "领星 ERP · salesStat 销量统计", syncStatus: `读取失败：${error.message}` },
          summary: { quantity: 0, purchaseCostSubtotal: 0, ordinaryInvoicePurchaseCost: 0, ordinaryInvoiceCost: 0, supplierCount: 0, skuCount: 0 },
          rows: [],
        };
      },
      onFinally: renderSupplierBoard,
      root,
    });
  }

  function handleSupplierBoardDimensionChange() {
    updateSupplierBoardDateInputs();
    loadSupplierBoard();
  }

  function handleSupplierBoardCountryChange() {
    syncAllOptionSelection(root?.querySelector?.("#supplier-board-country"));
    setSelectOptions("#supplier-board-store", supplierBoardStoreFilterOptions, "全部店铺", {
      groupByCountry: true,
      countries: selectedFilterValues("#supplier-board-country", root),
      selectAllVisible: true,
    });
    renderSupplierBoard();
  }

  function handleSupplierBoardStoreChange() {
    syncAllOptionSelection(root?.querySelector?.("#supplier-board-store"));
    renderSupplierBoard();
  }

  function setupSupplierBoard() {
    bind(root, "#supplier-board-refresh", "click", () => loadSupplierBoard({ forceRefresh: true }));
    bind(root, "#supplier-board-export", "click", exportSupplierBoardExcel);
    bind(root, "#supplier-board-table thead", "click", (event) => {
      const header = closestTarget(event, "th[data-supplier-sort]");
      if (!header) return;
      event.stopPropagation();
      applySupplierBoardSort(header.dataset.supplierSort || "");
    });
    bindAll(root, "#supplier-board-table .supplier-sort-button", "click", function handleSupplierSortButtonClick(event) {
      event.stopPropagation();
      applySupplierBoardSort(this.dataset.supplierSort || "");
    });
    bind(root, "#supplier-board-dimension", "change", handleSupplierBoardDimensionChange);
    bind(root, "#supplier-board-start-date", "change", loadSupplierBoard);
    bind(root, "#supplier-board-end-date", "change", loadSupplierBoard);
    bind(root, "#supplier-board-country", "change", handleSupplierBoardCountryChange);
    bind(root, "#supplier-board-store", "change", handleSupplierBoardStoreChange);
    bind(root, "#supplier-board-supplier", "input", renderSupplierBoard);
    bind(root, "#supplier-board-keyword", "input", renderSupplierBoard);
  }

  return {
    applySupplierBoardSort,
    exportSupplierBoardExcel,
    handleSupplierBoardCountryChange,
    handleSupplierBoardDimensionChange,
    handleSupplierBoardStoreChange,
    loadSupplierBoard,
    renderSupplierBoard,
    setDefaultSupplierBoardDates,
    setupSupplierBoard,
    updateSupplierBoardDateInputs,
  };
}

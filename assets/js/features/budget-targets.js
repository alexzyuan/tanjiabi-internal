export function createBudgetTargetsFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  escapeHtml,
  fieldValue,
  formatMoney,
  formatNumber,
  formatPercent,
  getPacificDateParts,
  readFileAsBase64,
  renderTableMessage,
  setButtonBusy,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof bind !== "function") throw new Error("createBudgetTargetsFeature requires bind.");
  if (typeof readFileAsBase64 !== "function") throw new Error("createBudgetTargetsFeature requires readFileAsBase64.");

  let budgetTargetRows = [];
  let budgetMskuRows = [];
  let selectedBudgetMonths = [];

  function formatMonthLabel(month) {
    const [year, monthNumber] = String(month).split("-");
    if (!year || !monthNumber) return month;
    return `${year}年${monthNumber}月`;
  }

  function renderBudgetUploads(uploads) {
    const list = root?.querySelector?.("#budget-upload-list");
    if (!list) return;

    if (!uploads.length) {
      list.innerHTML = `<div><strong>暂无上传记录</strong><span>选择你的月度预算模板后点击上传。</span></div>`;
      return;
    }

    list.innerHTML = uploads
      .map((item) => {
        const sizeKb = Math.max(1, Math.round(item.size / 1024));
        const uploadedAt = item.uploadedAt ? item.uploadedAt.replace("T", " ").slice(0, 16) : "-";
        const monthText = item.summary?.month ? `${formatMonthLabel(item.summary.month)} · ` : "";
        const replaceText = item.summary?.replaceMessage ? `${item.summary.replaceMessage} · ` : "";
        const detail = item.summary?.status === "已解析"
          ? `${monthText}${replaceText}已解析 ${item.summary.skuCount || 0} 个 SKU，汇总到 ${item.summary.storeName}`
          : item.summary?.parseError || item.status;
        return `<div><strong>${escapeHtml(item.fileName)}</strong><span>${escapeHtml(detail)} · ${sizeKb} KB · ${uploadedAt}</span></div>`;
      })
      .join("");
  }

  function renderBudgetMonthChips() {
    const list = root?.querySelector?.("#budget-month-chip-list");
    if (!list) return;

    if (!selectedBudgetMonths.length) {
      list.innerHTML = `<span class="empty-chip">未选择月份，默认显示全部</span>`;
      return;
    }

    list.innerHTML = selectedBudgetMonths
      .map((month) => `
        <span class="month-chip">
          ${formatMonthLabel(month)}
          <button type="button" data-month="${month}" aria-label="移除${formatMonthLabel(month)}">×</button>
        </span>
      `)
      .join("");
  }

  function handleBudgetMonthChipListClick(event) {
    const button = closestTarget(event, "button[data-month]");
    if (!button) return;
    selectedBudgetMonths = selectedBudgetMonths.filter((month) => month !== button.dataset.month);
    renderBudgetMonthChips();
    renderBudgetTargets({ rows: budgetTargetRows });
  }

  function addBudgetMonth() {
    const picker = root?.querySelector?.("#budget-month-picker");
    const month = fieldValue(picker);
    if (!month || selectedBudgetMonths.includes(month)) return;

    if (selectedBudgetMonths.length >= 12) {
      setText("#budget-upload-status", "最多只能选择 12 个月", root);
      return;
    }

    selectedBudgetMonths = [...selectedBudgetMonths, month].sort();
    if (picker) picker.value = "";
    renderBudgetMonthChips();
    renderBudgetTargets({ rows: budgetTargetRows });
  }

  function budgetFilterValues() {
    return {
      platform: fieldValue("#budget-platform-filter", "", root),
      store: trimmedFieldValue("#budget-store-filter", "", root),
      status: fieldValue("#budget-status-filter", "", root),
      keyword: trimmedFieldValue("#budget-keyword-filter", "", root),
    };
  }

  function getFilteredBudgetRows() {
    const { platform, store, status, keyword } = budgetFilterValues();
    const normalizedKeyword = keyword.toLowerCase();

    return budgetTargetRows.filter((row) => {
      const haystack = `${row.month} ${row.platform} ${row.storeName} ${row.site} ${row.status}`.toLowerCase();
      if (selectedBudgetMonths.length && !selectedBudgetMonths.includes(row.month)) return false;
      if (platform && row.platform !== platform) return false;
      if (store && !row.storeName.includes(store)) return false;
      if (status && !row.status.includes(status)) return false;
      if (normalizedKeyword && !haystack.includes(normalizedKeyword)) return false;
      return true;
    });
  }

  function getFilteredBudgetMskuRows() {
    const { platform, store, status, keyword: rawKeyword } = budgetFilterValues();
    const keyword = rawKeyword.toLowerCase();

    return budgetMskuRows.filter((row) => {
      const haystack = `${row.month} ${row.platform} ${row.storeName} ${row.site} ${row.status} ${row.msku} ${row.asin} ${row.skuOwner}`.toLowerCase();
      if (selectedBudgetMonths.length && !selectedBudgetMonths.includes(row.month)) return false;
      if (platform && row.platform !== platform) return false;
      if (store && !row.storeName.includes(store)) return false;
      if (status && !row.status.includes(status)) return false;
      if (keyword && !haystack.includes(keyword)) return false;
      return true;
    });
  }

  function renderBudgetTargets(data) {
    if ("rows" in data) budgetTargetRows = data.rows || [];
    if ("mskuRows" in data) budgetMskuRows = data.mskuRows || [];
    const rows = getFilteredBudgetRows();
    const mskuRows = getFilteredBudgetMskuRows();
    const totals = rows.reduce(
      (acc, row) => {
        acc.storeCount += 1;
        acc.skuCount += row.skuCount || 0;
        acc.salesTarget += row.salesTarget || 0;
        acc.adBudget += row.adBudget || 0;
        acc.refundTarget += row.refundTarget || 0;
        acc.profitTarget += row.profitTarget || 0;
        return acc;
      },
      { storeCount: 0, skuCount: 0, salesTarget: 0, adBudget: 0, refundTarget: 0, profitTarget: 0 },
    );

    setText("#budget-store-count", String(totals.storeCount), root);
    setText("#budget-sales-total", formatMoney(totals.salesTarget), root);
    setText("#budget-ads-total", formatMoney(totals.adBudget), root);
    setText("#budget-profit-total", formatMoney(totals.profitTarget), root);
    setText("#budget-table-count", `共 ${rows.length} 条数据`, root);
    setText("#budget-msku-table-count", `共 ${mskuRows.length} 条数据`, root);

    const table = root?.querySelector?.("#budget-target-table");
    if (!table) return;

    if (!rows.length) {
      renderTableMessage(table, 13, "暂无预算目标，请先上传预算模板。", root, { tone: "empty" });
      return;
    }

    table.innerHTML = rows
      .map((row) => `
        <tr>
          <td class="table-col-date">${row.month || "-"}</td>
          <td class="table-col-text">${row.platform || "-"}</td>
          <td class="table-col-text">${escapeHtml(row.storeName || "-")}</td>
          <td class="table-col-text">${escapeHtml(row.site || "-")}</td>
          <td class="table-col-status">${escapeHtml(row.status || "-")}</td>
          <td class="table-col-number">${formatNumber(row.skuCount || 0)}</td>
          <td class="table-col-number">${formatNumber(row.salesQty || 0)}</td>
          <td class="table-col-money">${formatMoney(row.salesTarget)}</td>
          <td class="table-col-money">${formatMoney(row.adBudget)}</td>
          <td class="table-col-percent">${formatPercent(row.acosTarget)}</td>
          <td class="table-col-money">${formatMoney(row.refundTarget)}</td>
          <td class="table-col-money">${formatMoney(row.profitTarget)}</td>
          <td class="table-col-percent">${formatPercent(row.profitRateTarget)}</td>
        </tr>
      `)
      .join("");

    const mskuTable = root?.querySelector?.("#budget-msku-target-table");
    if (!mskuTable) return;

    if (!mskuRows.length) {
      renderTableMessage(mskuTable, 14, "暂无 MSKU 预算明细，请先上传预算模板。", root, { tone: "empty" });
      return;
    }

    mskuTable.innerHTML = mskuRows
      .map((row) => `
        <tr>
          <td class="table-col-date">${row.month || "-"}</td>
          <td class="table-col-text">${row.platform || "-"}</td>
          <td class="table-col-text">${escapeHtml(row.storeName || "-")}</td>
          <td class="table-col-text">${escapeHtml(row.site || "-")}</td>
          <td class="table-col-status">${escapeHtml(row.status || "-")}</td>
          <td class="table-col-text">${escapeHtml(row.skuOwner || "-")}</td>
          <td class="table-col-text">${escapeHtml(row.msku || "-")}</td>
          <td class="table-col-text">${escapeHtml(row.asin || "-")}</td>
          <td class="table-col-number">${formatNumber(row.salesQty || 0)}</td>
          <td class="table-col-money">${formatMoney(row.salesTarget)}</td>
          <td class="table-col-money">${formatMoney(row.adBudget)}</td>
          <td class="table-col-percent">${formatPercent(row.acosTarget)}</td>
          <td class="table-col-money">${formatMoney(row.profitTarget)}</td>
          <td class="table-col-percent">${formatPercent(row.profitRateTarget)}</td>
        </tr>
      `)
      .join("");
  }

  async function loadBudgetUploads() {
    try {
      const response = await fetch("/api/admin/budget/uploads");
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      renderBudgetUploads(data.uploads || []);
    } catch {
      renderBudgetUploads([]);
    }
  }

  async function loadBudgetTargets() {
    try {
      const response = await fetch("/api/budget-targets");
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderBudgetTargets(await response.json());
    } catch {
      renderBudgetTargets({ rows: [], totals: {} });
    }
  }

  function renderBudgetFileState(file) {
    const fileName = root?.querySelector?.("#budget-file-name");
    if (fileName) {
      fileName.innerHTML = file
        ? `<strong>${escapeHtml(file.name)}</strong><small>已选择，点击上传或重新拖拽替换文件</small>`
        : `<strong>选择预算模板</strong><small>点击选择，或拖拽 .xlsx 文件到这里后点击上传预算</small>`;
    }
    setText("#budget-upload-status", file ? "已选择，等待上传" : "未选择文件", root);
  }

  function setBudgetUploadFile(file) {
    const input = root?.querySelector?.("#budget-file-input");
    if (!input || !file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    renderBudgetFileState(file);
  }

  async function uploadBudgetTemplate() {
    const input = root?.querySelector?.("#budget-file-input");
    const monthInput = root?.querySelector?.("#budget-upload-month");
    const button = root?.querySelector?.("#budget-upload-button");
    const status = root?.querySelector?.("#budget-upload-status");
    const file = input?.files?.[0];
    const budgetMonth = monthInput?.value || "";

    if (!budgetMonth) {
      setText("#budget-upload-status", "请先选择预算月份", root);
      return;
    }

    if (!file) {
      setText("#budget-upload-status", "请先选择 .xlsx 文件", root);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setText("#budget-upload-status", "只支持 .xlsx 预算模板", root);
      return;
    }

    const restoreButton = setButtonBusy(button, "上传中", "上传预算", { disable: false });
    if (status) status.textContent = "正在上传";

    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetch("/api/admin/budget/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, base64, budgetMonth }),
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const result = await response.json();
      if (input) input.value = "";
      renderBudgetFileState(null);
      setText("#budget-upload-status", result.upload?.replacedCount ? "已覆盖旧预算" : "上传成功", root);
      await loadBudgetUploads();
      await loadBudgetTargets();
    } catch {
      setText("#budget-upload-status", "上传失败，请确认正在访问服务器地址", root);
    } finally {
      restoreButton();
    }
  }

  function resetBudgetFilters() {
    const monthInput = root?.querySelector?.("#budget-month-picker");
    const platformInput = root?.querySelector?.("#budget-platform-filter");
    const storeInput = root?.querySelector?.("#budget-store-filter");
    const statusInput = root?.querySelector?.("#budget-status-filter");
    const keywordInput = root?.querySelector?.("#budget-keyword-filter");
    selectedBudgetMonths = [];
    if (monthInput) monthInput.value = "";
    if (platformInput) platformInput.value = "";
    if (storeInput) storeInput.value = "";
    if (statusInput) statusInput.value = "";
    if (keywordInput) keywordInput.value = "";
    renderBudgetMonthChips();
    renderBudgetTargets({ rows: budgetTargetRows });
  }

  function defaultBudgetUploadMonth() {
    const now = getPacificDateParts();
    return `${now.year}-${String(now.month).padStart(2, "0")}`;
  }

  function initializeBudgetDefaults() {
    const uploadMonthInput = root?.querySelector?.("#budget-upload-month");
    if (uploadMonthInput && !uploadMonthInput.value) uploadMonthInput.value = defaultBudgetUploadMonth();
    const budgetMonthPicker = root?.querySelector?.("#budget-month-picker");
    if (budgetMonthPicker && !budgetMonthPicker.value) budgetMonthPicker.value = defaultBudgetUploadMonth();
    renderBudgetMonthChips();
  }

  function setupBudgetTargets() {
    bind(root, "#budget-upload-button", "click", uploadBudgetTemplate);
    bind(root, "#budget-add-month-button", "click", addBudgetMonth);
    bind(root, "#budget-month-picker", "keydown", (event) => {
      if (event.key === "Enter") addBudgetMonth();
    });
    bind(root, "#budget-month-chip-list", "click", handleBudgetMonthChipListClick);
    bind(root, "#budget-query-button", "click", () => renderBudgetTargets({ rows: budgetTargetRows }));
    bind(root, "#budget-reset-button", "click", resetBudgetFilters);
    bind(root, "#budget-file-input", "change", (event) => {
      const file = event.target.files?.[0];
      renderBudgetFileState(file);
    });
    bind(root, ".file-picker", "dragover", (event) => {
      event.preventDefault();
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.add("is-dragging");
      setText("#budget-upload-status", "松开即可上传预算文件", root);
    });
    bind(root, ".file-picker", "dragleave", (event) => {
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.remove("is-dragging");
    });
    bind(root, ".file-picker", "drop", async (event) => {
      event.preventDefault();
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.remove("is-dragging");
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setBudgetUploadFile(file);
      setText("#budget-upload-status", "已拖入文件，点击右侧“上传预算”完成上传", root);
    });
  }

  return {
    initializeBudgetDefaults,
    loadBudgetTargets,
    loadBudgetUploads,
    renderBudgetMonthChips,
    renderBudgetTargets,
    setupBudgetTargets,
  };
}

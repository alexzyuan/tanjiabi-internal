export function normalizeBudgetDeepLinkCountry(value) {
  const country = String(value || "").trim().replace(/站$/, "");
  return country === "澳大利亚" ? "澳洲" : country;
}

export function createBudgetTargetsFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  fieldValue,
  formatMoney,
  formatNumber,
  formatPercent,
  getPacificDateParts,
  locationRef = globalThis.location,
  normalizeCountryName = (value) => String(value || "").trim(),
  readFileAsBase64,
  renderTableMessage,
  setButtonBusy,
  setSelectOptions,
  setText,
  selectedFilterValues,
  syncAllOptionSelection,
  trimmedFieldValue,
} = {}) {
  if (typeof bind !== "function") throw new Error("createBudgetTargetsFeature requires bind.");
  if (typeof readFileAsBase64 !== "function") throw new Error("createBudgetTargetsFeature requires readFileAsBase64.");
  if (typeof setSelectOptions !== "function") throw new Error("createBudgetTargetsFeature requires setSelectOptions.");
  if (typeof selectedFilterValues !== "function") throw new Error("createBudgetTargetsFeature requires selectedFilterValues.");
  if (typeof syncAllOptionSelection !== "function") throw new Error("createBudgetTargetsFeature requires syncAllOptionSelection.");

  let budgetTargetRows = [];
  let budgetMskuRows = [];
  let selectedBudgetMonths = [];
  let budgetDeepLinkInitialized = false;
  let consumedBudgetDeepLinkSearch = "";
  let budgetDeepLinkScope = { stores: [], countries: [] };

  function uniqueValues(values = []) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function budgetRowOwner(row = {}) {
    return String(row.listingOwner || row.skuOwner || "").trim();
  }

  function budgetCountry(row = {}) {
    return normalizeCountryName(row.site || row.country || "");
  }

  function refreshBudgetFilterOptions({ selectAllStores = false } = {}) {
    const countrySelect = root?.querySelector?.("#budget-country-filter");
    const storeSelect = root?.querySelector?.("#budget-store-filter");
    const ownerSelect = root?.querySelector?.("#budget-listing-owner-filter");
    if (!countrySelect || !storeSelect || !ownerSelect) return;

    const allRows = [...budgetTargetRows, ...budgetMskuRows];
    const countries = uniqueValues(allRows.map(budgetCountry)).sort((left, right) => left.localeCompare(right, "zh-CN"));
    setSelectOptions(countrySelect, countries, "全部国家");
    const selectedCountries = selectedFilterValues(countrySelect);
    const storeOptions = [...new Map(budgetTargetRows
      .map((row) => ({ name: row.storeName, label: row.storeName, country: budgetCountry(row) }))
      .filter((row) => row.name)
      .map((row) => [row.name, row])).values()];
    setSelectOptions(storeSelect, storeOptions, "全部店铺", {
      groupByCountry: true,
      countries: selectedCountries,
      selectAllVisible: selectAllStores,
    });

    const selectedOwner = ownerSelect.value;
    const owners = uniqueValues(budgetMskuRows.map(budgetRowOwner)).sort((left, right) => left.localeCompare(right, "zh-CN"));
    ownerSelect.innerHTML = `<option value="">全部链接负责人</option>${owners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("")}`;
    if (owners.includes(selectedOwner)) ownerSelect.value = selectedOwner;

    const datalist = root?.querySelector?.("#budget-import-owner-options");
    if (datalist) datalist.innerHTML = owners.map((owner) => `<option value="${escapeHtml(owner)}"></option>`).join("");
  }

  function initializeBudgetDeepLinkScope() {
    const search = String(locationRef?.search || "");
    const params = new URLSearchParams(search);
    const deepLinkSearch = new URLSearchParams();
    params.getAll("budgetMonths").forEach((value) => deepLinkSearch.append("budgetMonths", value));
    params.getAll("budgetStores").forEach((value) => deepLinkSearch.append("budgetStores", value));
    params.getAll("budgetCountries").forEach((value) => deepLinkSearch.append("budgetCountries", value));
    const signature = deepLinkSearch.toString();
    if (budgetDeepLinkInitialized && consumedBudgetDeepLinkSearch === signature) return;
    budgetDeepLinkInitialized = true;
    consumedBudgetDeepLinkSearch = signature;
    selectedBudgetMonths = uniqueValues(
      params.getAll("budgetMonths").flatMap((value) => value.split(",")),
    ).filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)).slice(0, 12).sort();
    budgetDeepLinkScope = {
      stores: uniqueValues(params.getAll("budgetStores")),
      countries: uniqueValues(params.getAll("budgetCountries")),
    };
    const storeInput = root?.querySelector?.("#budget-store-filter");
    if (storeInput) {
      storeInput.value = budgetDeepLinkScope.stores.length === 1 ? budgetDeepLinkScope.stores[0] : "";
    }
  }

  function getBudgetDeepLinkScope() {
    return {
      stores: budgetDeepLinkScope.stores.slice(),
      countries: budgetDeepLinkScope.countries.slice(),
    };
  }

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
      countries: selectedFilterValues("#budget-country-filter", root),
      stores: selectedFilterValues("#budget-store-filter", root),
      listingOwner: fieldValue("#budget-listing-owner-filter", "", root),
      keyword: trimmedFieldValue("#budget-keyword-filter", "", root),
      linkedStores: budgetDeepLinkScope.stores,
      linkedCountries: budgetDeepLinkScope.countries,
    };
  }

  function getFilteredBudgetRows() {
    const { platform, countries, stores, listingOwner, keyword, linkedStores, linkedCountries } = budgetFilterValues();
    const normalizedKeyword = keyword.toLowerCase();
    const linkedCountrySet = new Set(linkedCountries.map(normalizeBudgetDeepLinkCountry));

    return budgetTargetRows.filter((row) => {
      const haystack = `${row.month} ${row.platform} ${row.storeName} ${row.site} ${row.status} ${row.listingOwner}`.toLowerCase();
      if (selectedBudgetMonths.length && !selectedBudgetMonths.includes(row.month)) return false;
      if (platform && row.platform !== platform) return false;
      if (countries.length && !countries.includes(budgetCountry(row))) return false;
      if (stores.length && !stores.includes(row.storeName)) return false;
      if (!stores.length && linkedStores.length && !linkedStores.includes(row.storeName)) return false;
      if (linkedCountrySet.size && !linkedCountrySet.has(normalizeBudgetDeepLinkCountry(row.site || row.country))) return false;
      if (listingOwner && row.listingOwner !== listingOwner) return false;
      if (normalizedKeyword && !haystack.includes(normalizedKeyword)) return false;
      return true;
    });
  }

  function getFilteredBudgetMskuRows() {
    const { platform, countries, stores, listingOwner, keyword: rawKeyword, linkedStores, linkedCountries } = budgetFilterValues();
    const keyword = rawKeyword.toLowerCase();
    const linkedCountrySet = new Set(linkedCountries.map(normalizeBudgetDeepLinkCountry));

    return budgetMskuRows.filter((row) => {
      const haystack = `${row.month} ${row.platform} ${row.storeName} ${row.site} ${row.status} ${row.msku} ${row.asin} ${budgetRowOwner(row)}`.toLowerCase();
      if (selectedBudgetMonths.length && !selectedBudgetMonths.includes(row.month)) return false;
      if (platform && row.platform !== platform) return false;
      if (countries.length && !countries.includes(budgetCountry(row))) return false;
      if (stores.length && !stores.includes(row.storeName)) return false;
      if (!stores.length && linkedStores.length && !linkedStores.includes(row.storeName)) return false;
      if (linkedCountrySet.size && !linkedCountrySet.has(normalizeBudgetDeepLinkCountry(row.site || row.country))) return false;
      if (listingOwner && budgetRowOwner(row) !== listingOwner) return false;
      if (keyword && !haystack.includes(keyword)) return false;
      return true;
    });
  }

  function renderBudgetTargets(data) {
    if ("rows" in data) budgetTargetRows = data.rows || [];
    if ("mskuRows" in data) budgetMskuRows = data.mskuRows || [];
    refreshBudgetFilterOptions();
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
      renderTableMessage(table, 13, "暂无预算目标，请先上传预算模板。");
      return;
    }

    table.innerHTML = rows
      .map((row) => `
        <tr>
          <td>${row.month || "-"}</td>
          <td>${row.platform || "-"}</td>
          <td>${escapeHtml(row.storeName || "-")}</td>
          <td>${escapeHtml(row.site || "-")}</td>
          <td>${escapeHtml(row.status || "-")}</td>
          <td>${formatNumber(row.skuCount || 0)}</td>
          <td>${formatNumber(row.salesQty || 0)}</td>
          <td>${formatMoney(row.salesTarget)}</td>
          <td>${formatMoney(row.adBudget)}</td>
          <td>${formatPercent(row.acosTarget)}</td>
          <td>${formatMoney(row.refundTarget)}</td>
          <td>${formatMoney(row.profitTarget)}</td>
          <td>${formatPercent(row.profitRateTarget)}</td>
        </tr>
      `)
      .join("");

    const mskuTable = root?.querySelector?.("#budget-msku-target-table");
    if (!mskuTable) return;

    if (!mskuRows.length) {
      renderTableMessage(mskuTable, 14, "暂无 MSKU 预算明细，请先上传预算模板。");
      return;
    }

    mskuTable.innerHTML = mskuRows
      .map((row) => `
        <tr>
          <td>${row.month || "-"}</td>
          <td>${row.platform || "-"}</td>
          <td>${escapeHtml(row.storeName || "-")}</td>
          <td>${escapeHtml(row.site || "-")}</td>
          <td>${escapeHtml(row.status || "-")}</td>
          <td>${escapeHtml(budgetRowOwner(row) || "-")}</td>
          <td>${escapeHtml(row.msku || "-")}</td>
          <td>${escapeHtml(row.asin || "-")}</td>
          <td>${formatNumber(row.salesQty || 0)}</td>
          <td>${formatMoney(row.salesTarget)}</td>
          <td>${formatMoney(row.adBudget)}</td>
          <td>${formatPercent(row.acosTarget)}</td>
          <td>${formatMoney(row.profitTarget)}</td>
          <td>${formatPercent(row.profitRateTarget)}</td>
        </tr>
      `)
      .join("");
  }

  async function loadBudgetUploads() {
    try {
      const response = await fetchImpl("/api/admin/budget/uploads");
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      renderBudgetUploads(data.uploads || []);
    } catch {
      renderBudgetUploads([]);
    }
  }

  async function loadBudgetTargets() {
    initializeBudgetDefaults();
    try {
      const response = await fetchImpl("/api/budget-targets");
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderBudgetTargets(await response.json());
    } catch {
      renderBudgetTargets({ rows: [], totals: {} });
    }
  }

  function renderBudgetFileState(file) {
    const fileName = root?.querySelector?.("#budget-import-file-name");
    if (fileName) {
      fileName.innerHTML = file
        ? `<strong>${escapeHtml(file.name)}</strong><small>已选择，点击上传或重新拖拽替换文件</small>`
        : `<strong>选择预算模板</strong><small>点击选择，或拖拽 .xlsx 文件到这里后点击上传预算</small>`;
    }
    setText("#budget-import-status", file ? "已选择，等待导入" : "未选择文件", root);
  }

  function setBudgetUploadFile(file) {
    const input = root?.querySelector?.("#budget-import-file-input");
    if (!input || !file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    renderBudgetFileState(file);
  }

  async function uploadBudgetTemplate() {
    const input = root?.querySelector?.("#budget-import-file-input");
    const monthInput = root?.querySelector?.("#budget-import-month");
    const ownerInput = root?.querySelector?.("#budget-import-owner");
    const button = root?.querySelector?.("#budget-import-confirm");
    const status = root?.querySelector?.("#budget-import-status");
    const file = input?.files?.[0];
    const budgetMonth = monthInput?.value || "";
    const listingOwner = String(ownerInput?.value || "").trim();

    if (!budgetMonth) {
      setText("#budget-import-status", "请先选择预算月份", root);
      return;
    }

    if (!listingOwner) {
      setText("#budget-import-status", "请先选择链接负责人", root);
      return;
    }

    if (!file) {
      setText("#budget-import-status", "请先选择 .xlsx 文件", root);
      return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setText("#budget-import-status", "只支持 .xlsx 预算模板", root);
      return;
    }

    const restoreButton = setButtonBusy(button, "导入中", "确认导入", { disable: false });
    if (status) status.textContent = "正在导入";

    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetchImpl("/api/admin/budget/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, base64, budgetMonth, listingOwner }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.message || `API ${response.status}`);
      if (input) input.value = "";
      renderBudgetFileState(null);
      setText("#budget-import-status", result.upload?.replacedCount ? "已覆盖旧预算" : "导入成功", root);
      await loadBudgetUploads();
      await loadBudgetTargets();
      closeBudgetImportDialog();
    } catch (error) {
      setText("#budget-import-status", error.message || "导入失败", root);
    } finally {
      restoreButton();
    }
  }

  function openBudgetImportDialog() {
    const dialog = root?.querySelector?.("#budget-import-dialog");
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    root?.querySelector?.("#budget-import-month")?.focus();
  }

  function closeBudgetImportDialog() {
    const dialog = root?.querySelector?.("#budget-import-dialog");
    if (dialog?.open) dialog.close();
  }

  function resetBudgetFilters() {
    const monthInput = root?.querySelector?.("#budget-month-picker");
    const platformInput = root?.querySelector?.("#budget-platform-filter");
    const countryInput = root?.querySelector?.("#budget-country-filter");
    const storeInput = root?.querySelector?.("#budget-store-filter");
    const ownerInput = root?.querySelector?.("#budget-listing-owner-filter");
    const keywordInput = root?.querySelector?.("#budget-keyword-filter");
    selectedBudgetMonths = [];
    budgetDeepLinkScope = { stores: [], countries: [] };
    if (monthInput) monthInput.value = "";
    if (platformInput) platformInput.value = "";
    [countryInput, storeInput].forEach((select) => {
      if (!select) return;
      [...select.options].forEach((option) => { option.selected = option.value === ""; });
    });
    if (ownerInput) ownerInput.value = "";
    if (keywordInput) keywordInput.value = "";
    renderBudgetMonthChips();
    renderBudgetTargets({ rows: budgetTargetRows });
  }

  function defaultBudgetUploadMonth() {
    const now = getPacificDateParts();
    return `${now.year}-${String(now.month).padStart(2, "0")}`;
  }

  function initializeBudgetDefaults() {
    initializeBudgetDeepLinkScope();
    const uploadMonthInput = root?.querySelector?.("#budget-import-month");
    if (uploadMonthInput && !uploadMonthInput.value) uploadMonthInput.value = defaultBudgetUploadMonth();
    const budgetMonthPicker = root?.querySelector?.("#budget-month-picker");
    if (budgetMonthPicker && !budgetMonthPicker.value) budgetMonthPicker.value = defaultBudgetUploadMonth();
    renderBudgetMonthChips();
  }

  function setupBudgetTargets() {
    bind(root, "#budget-import-button", "click", openBudgetImportDialog);
    bind(root, "#budget-import-confirm", "click", uploadBudgetTemplate);
    bind(root, "#budget-import-close", "click", closeBudgetImportDialog);
    bind(root, "#budget-import-cancel", "click", closeBudgetImportDialog);
    bind(root, "#budget-import-dialog", "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeBudgetImportDialog();
    });
    bind(root, "#budget-add-month-button", "click", addBudgetMonth);
    bind(root, "#budget-month-picker", "keydown", (event) => {
      if (event.key === "Enter") addBudgetMonth();
    });
    bind(root, "#budget-month-chip-list", "click", handleBudgetMonthChipListClick);
    bind(root, "#budget-query-button", "click", () => {
      budgetDeepLinkScope = { stores: [], countries: [] };
      renderBudgetTargets({ rows: budgetTargetRows });
    });
    bind(root, "#budget-reset-button", "click", resetBudgetFilters);
    bind(root, "#budget-country-filter", "change", () => {
      syncAllOptionSelection(root?.querySelector?.("#budget-country-filter"));
      refreshBudgetFilterOptions({ selectAllStores: true });
      renderBudgetTargets({ rows: budgetTargetRows });
    });
    bind(root, "#budget-store-filter", "change", () => {
      syncAllOptionSelection(root?.querySelector?.("#budget-store-filter"));
      renderBudgetTargets({ rows: budgetTargetRows });
    });
    bind(root, "#budget-listing-owner-filter", "change", () => renderBudgetTargets({ rows: budgetTargetRows }));
    bind(root, "#budget-import-file-input", "change", (event) => {
      const file = event.target.files?.[0];
      renderBudgetFileState(file);
    });
    bind(root, ".budget-import-file-picker", "dragover", (event) => {
      event.preventDefault();
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.add("is-dragging");
      setText("#budget-import-status", "松开即可导入预算文件", root);
    });
    bind(root, ".budget-import-file-picker", "dragleave", (event) => {
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.remove("is-dragging");
    });
    bind(root, ".budget-import-file-picker", "drop", async (event) => {
      event.preventDefault();
      const budgetFilePicker = event.currentTarget;
      budgetFilePicker.classList.remove("is-dragging");
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setBudgetUploadFile(file);
      setText("#budget-import-status", "已拖入文件，点击“确认导入”完成上传", root);
    });
  }

  return {
    getBudgetDeepLinkScope,
    initializeBudgetDefaults,
    loadBudgetTargets,
    loadBudgetUploads,
    openBudgetImportDialog,
    closeBudgetImportDialog,
    renderBudgetMonthChips,
    renderBudgetTargets,
    setupBudgetTargets,
  };
}

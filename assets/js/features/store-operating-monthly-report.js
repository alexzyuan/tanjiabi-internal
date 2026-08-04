const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const REPORT_FIXED_COLUMN_WIDTHS = Object.freeze({
  category: 148,
  name: 176,
  actual: 160,
  share: 104,
  budget: 160,
  achievement: 112,
});

function defaultCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function listInclusiveMonths(startMonth, endMonth) {
  if (!MONTH_PATTERN.test(startMonth || "") || !MONTH_PATTERN.test(endMonth || "")) return [];
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  const startIndex = startYear * 12 + startNumber - 1;
  const endIndex = endYear * 12 + endNumber - 1;
  if (endIndex < startIndex) return [];
  return Array.from({ length: endIndex - startIndex + 1 }, (_value, index) => {
    const monthIndex = startIndex + index;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12 + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

export function validateMonthRange(startMonth, endMonth) {
  if (!MONTH_PATTERN.test(startMonth || "") || !MONTH_PATTERN.test(endMonth || "")) {
    return { ok: false, error: "请选择有效的开始月份和结束月份" };
  }
  const months = listInclusiveMonths(startMonth, endMonth);
  if (!months.length) return { ok: false, error: "结束月份不能早于开始月份" };
  if (months.length > 12) return { ok: false, error: "统计范围最多 12 个月" };
  return { ok: true, months };
}

function normalizeStoreOption(item = {}, {
  normalizeCountryName,
  pickSellerCountry,
  pickSellerName,
} = {}) {
  if (typeof item === "string") return { name: item, label: item, country: "" };
  const selectedName = pickSellerName(item);
  const name = String(selectedName === "-" ? (item.value || item.label || "") : selectedName).trim();
  const selectedCountry = pickSellerCountry(item);
  const normalizedCountry = normalizeCountryName(selectedCountry === "-" ? "" : selectedCountry);
  return {
    name,
    label: String(item.label || name).trim(),
    country: normalizedCountry === "-" ? "" : String(normalizedCountry || "").trim(),
  };
}

function sameQuery(left, right) {
  return String(left || "") === String(right || "");
}

function compareReportSortValues(left, right) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  if (leftText === rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  const leftNumber = Number(leftText.replace(/[,%¥￥$€£]/g, ""));
  const rightNumber = Number(rightText.replace(/[,%¥￥$€£]/g, ""));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return leftText.localeCompare(rightText, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function createStoreOperatingMonthlyReportFeature({
  root = globalThis.document,
  bind,
  clickVisibleNavItem,
  downloadBlob,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  formatActualMoney,
  getCurrentMonth = defaultCurrentMonth,
  getStoreOptions = () => [],
  historyRef = globalThis.history,
  locationRef = globalThis.location,
  normalizeCountryName,
  pickSellerCountry,
  pickSellerName,
  refreshTable,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
} = {}) {
  if (typeof bind !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires bind.");
  if (typeof clickVisibleNavItem !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires clickVisibleNavItem.");
  if (typeof downloadBlob !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires downloadBlob.");
  if (typeof escapeHtml !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires escapeHtml.");
  if (typeof fetchImpl !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires fetch.");
  if (typeof formatActualMoney !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires formatActualMoney.");
  if (typeof normalizeCountryName !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires normalizeCountryName.");
  if (typeof pickSellerCountry !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires pickSellerCountry.");
  if (typeof pickSellerName !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires pickSellerName.");
  if (typeof refreshTable !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires refreshTable.");
  if (typeof selectedFilterValues !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires selectedFilterValues.");
  if (typeof setSelectOptions !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires setSelectOptions.");
  if (typeof setText !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires setText.");
  if (typeof syncAllOptionSelection !== "function") throw new Error("createStoreOperatingMonthlyReportFeature requires syncAllOptionSelection.");

  let storeOptions = [];
  let lastSuccessfulQuery = "";
  let initializedFromUrl = false;
  let initialUrlScopeApplied = false;
  let initialUrlStores = [];
  let initialUrlCountries = [];
  let activeReportAbortController = null;
  let reportLoadGeneration = 0;
  const collapsedCategories = new Set();
  const reportSortState = { key: "", direction: "asc" };

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function readFilters() {
    return {
      startMonth: String(query("#store-operating-report-start-month")?.value || "").trim(),
      endMonth: String(query("#store-operating-report-end-month")?.value || "").trim(),
      stores: selectedFilterValues(query("#store-operating-report-store")),
      countries: selectedFilterValues(query("#store-operating-report-country")),
    };
  }

  function buildReportQuery(filters = readFilters()) {
    const params = new URLSearchParams();
    params.set("startMonth", filters.startMonth);
    params.set("endMonth", filters.endMonth);
    filters.stores.forEach((value) => params.append("stores", value));
    filters.countries.forEach((value) => params.append("countries", value));
    return params.toString();
  }

  function replaceLocationSearch(params) {
    const suffix = params.toString();
    const pathname = locationRef?.pathname || "";
    historyRef?.replaceState?.({}, "", `${pathname}${suffix ? `?${suffix}` : ""}`);
  }

  function syncReportUrl(filters) {
    const params = new URLSearchParams({ view: "store-operating-monthly-report" });
    params.set("startMonth", filters.startMonth);
    params.set("endMonth", filters.endMonth);
    filters.stores.forEach((value) => params.append("stores", value));
    filters.countries.forEach((value) => params.append("countries", value));
    replaceLocationSearch(params);
  }

  function selectValues(select, values = []) {
    if (!select?.options) return;
    const selected = new Set(values);
    [...select.options].forEach((option) => {
      option.selected = option.value ? selected.has(option.value) : selected.size === 0;
    });
  }

  function refreshStoreOptions({ showScopeWarning = false } = {}) {
    storeOptions = (getStoreOptions() || [])
      .map((item) => normalizeStoreOption(item, { normalizeCountryName, pickSellerCountry, pickSellerName }))
      .filter((item) => item.name);
    const countrySelect = query("#store-operating-report-country");
    const storeSelect = query("#store-operating-report-store");
    const previousStores = [...new Set([...selectedFilterValues(storeSelect), ...initialUrlStores])];
    const countries = [...new Set([
      ...storeOptions.map((item) => item.country).filter(Boolean),
      ...initialUrlCountries,
    ])].sort((a, b) => a.localeCompare(b, "zh-CN"));
    setSelectOptions(countrySelect, countries, "全部国家");
    if (!initialUrlScopeApplied && initialUrlCountries.length) {
      selectValues(countrySelect, initialUrlCountries);
      setSelectOptions(countrySelect, countries, "全部国家");
    }

    const selectedCountries = selectedFilterValues(countrySelect);
    const visibleOptions = storeOptions.filter((item) => !selectedCountries.length || selectedCountries.includes(item.country));
    const visibleNames = new Set(visibleOptions.map((item) => item.name));
    const knownPreservedOptions = storeOptions
      .filter((item) => previousStores.includes(item.name) && !visibleNames.has(item.name));
    const knownNames = new Set([...visibleNames, ...knownPreservedOptions.map((item) => item.name)]);
    const unknownPreservedOptions = previousStores
      .filter((name) => !knownNames.has(name))
      .map((name) => ({ name, label: name, country: "" }));
    const preservedOutsideScope = [...knownPreservedOptions, ...unknownPreservedOptions]
      .map((item) => ({ ...item, label: `${item.label}（不在当前国家）` }));
    const nextStoreOptions = [...visibleOptions, ...preservedOutsideScope];
    setSelectOptions(storeSelect, nextStoreOptions, "全部店铺", { groupByCountry: true });
    if (!initialUrlScopeApplied && initialUrlStores.length) {
      selectValues(storeSelect, initialUrlStores);
      setSelectOptions(storeSelect, nextStoreOptions, "全部店铺", { groupByCountry: true });
    }
    initialUrlScopeApplied = true;

    if (showScopeWarning && preservedOutsideScope.length) {
      setText(
        "#store-operating-report-status",
        `已选店铺 ${preservedOutsideScope.map((item) => item.name).join("、")} 不在当前国家范围；点击查询将按店铺与国家交集读取。`,
        root,
      );
    }
  }

  function initializeFromLocation() {
    if (initializedFromUrl) return;
    initializedFromUrl = true;
    const params = new URLSearchParams(locationRef?.search || "");
    initialUrlStores = params.getAll("stores").filter(Boolean);
    initialUrlCountries = params.getAll("countries").filter(Boolean);
    const startMonth = params.get("startMonth");
    const endMonth = params.get("endMonth");
    const startInput = query("#store-operating-report-start-month");
    const endInput = query("#store-operating-report-end-month");
    if (startInput && MONTH_PATTERN.test(startMonth || "")) startInput.value = startMonth;
    if (endInput && MONTH_PATTERN.test(endMonth || "")) endInput.value = endMonth;
    refreshStoreOptions();
  }

  function initializeStoreOperatingMonthlyReportDefaults() {
    const currentMonth = getCurrentMonth();
    const startInput = query("#store-operating-report-start-month");
    const endInput = query("#store-operating-report-end-month");
    if (startInput && !startInput.value) startInput.value = currentMonth;
    if (endInput && !endInput.value) endInput.value = currentMonth;
    initializeFromLocation();
    refreshStoreOptions();
  }

  function formatAmount(value) {
    return value === null || value === undefined || value === "" ? "—" : formatActualMoney(value);
  }

  function formatRate(value) {
    return value === null || value === undefined || value === "" ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
  }

  function reportGroupStoreName(group, filters, index) {
    const explicitName = String(group?.storeName || "").trim();
    if (explicitName) return explicitName;
    if (filters?.stores?.length && filters.stores[index]) return filters.stores[index];
    return "全部店铺";
  }

  function reportColumnGroups(data, filters = readFilters()) {
    return reportGroups(data).map((group, index) => {
      const storeName = reportGroupStoreName(group, filters, index);
      const currency = group.currencyAvailable === false ? "币种不可用" : String(group.currencyCode || "币种不可用").trim();
      return {
        ...group,
        index,
        storeName,
        currencyLabel: currency,
        label: `${storeName} · ${currency}`,
        identity: `${storeName}\u0000${group.currencyCode || "missing"}\u0000${index}`,
      };
    });
  }

  function reportColumnCount(data) {
    return 2 + reportGroups(data).length * 4;
  }

  function reportRowIdentity(row, index = 0) {
    return String(row?.key || `${row?.category || ""}\u0000${row?.name || ""}\u0000${index}`);
  }

  function rowMapByKey(group) {
    return new Map((group?.rows || []).map((row, index) => [reportRowIdentity(row, index), row]));
  }

  function renderHeader(data, filters = readFilters()) {
    const head = query("#store-operating-report-head");
    if (!head) return;
    const groups = reportColumnGroups(data, filters);
    head.innerHTML = `
      <tr>
        <th colspan="2" data-column-sortable="false">店铺信息</th>
        ${groups.map((group) => `<th colspan="4" data-column-sortable="false" data-report-group-index="${group.index}">${escapeHtml(group.label)}</th>`).join("")}
      </tr>
      <tr>
        <th data-column-key="category" data-column-width="${REPORT_FIXED_COLUMN_WIDTHS.category}" data-column-sortable="false" data-column-profile="name">分类</th>
        <th data-column-key="name" data-column-width="${REPORT_FIXED_COLUMN_WIDTHS.name}" data-column-sortable="false" data-column-profile="name">名称</th>
        ${groups.flatMap((group) => [
          ["actual", "实际完成值"],
          ["share", "占比"],
          ["budget", "预算值"],
          ["achievement", "达成率"],
        ].map(([metric, label]) => `<th data-column-key="group-${group.index}-${metric}" data-column-width="${REPORT_FIXED_COLUMN_WIDTHS[metric]}" data-column-sortable="false" data-report-group-index="${group.index}" data-report-metric="${metric}" data-column-kind="number" data-column-profile="money-rate">${label}</th>`)).join("")}
      </tr>
    `;
  }

  function reportGroups(data) {
    if (!Array.isArray(data?.groups)) throw new Error("店铺经营月报响应缺少 groups 数组");
    return data.groups;
  }

  function renderRows(data, filters = readFilters()) {
    const body = query("#store-operating-report-body");
    if (!body) return;
    const groups = reportColumnGroups(data, filters);
    const columnCount = 2 + groups.length * 4;
    if (!groups.length) {
      body.innerHTML = `<tr><td colspan="${columnCount}">当前筛选范围暂无经营数据。</td></tr>`;
      return;
    }
    groups.forEach((group) => {
      if (!Array.isArray(group?.rows)) throw new Error("店铺经营月报分组缺少 rows 数组");
    });
    const rowMaps = groups.map(rowMapByKey);
    const baseRows = groups[0].rows;
    body.innerHTML = baseRows.map((baseRow, rowIndex) => {
      const rowIdentity = reportRowIdentity(baseRow, rowIndex);
      const categoryKeyByName = new Map(baseRows
        .filter((row) => Number(row.level) === 1)
        .map((row) => [row.name, row.key]));
      const row = baseRow;
      const categoryKey = Number(row.level) === 2 ? categoryKeyByName.get(row.category) || "" : "";
      const disclosureKey = String(row.key || "");
      const isCollapsed = Number(row.level) === 1 && collapsedCategories.has(disclosureKey);
      const profitAlwaysVisible = row.key === "sales-profit";
      const hidden = categoryKey && collapsedCategories.has(categoryKey) && !profitAlwaysVisible;
      const isExpandableCategory = Number(row.level) === 1 && row.key !== "sales-profit-category" && Array.isArray(row.children) && row.children.length;
      const categoryCell = isExpandableCategory
        ? `<button class="store-operating-report-disclosure" type="button" data-report-category-toggle="${escapeHtml(row.key || "")}" aria-expanded="${isCollapsed ? "false" : "true"}"><span aria-hidden="true">${isCollapsed ? "▸" : "▾"}</span>${escapeHtml(row.category || "—")}</button>`
        : escapeHtml(row.category || "—");
      const metricCells = groups.flatMap((group, groupIndex) => {
        const groupRow = rowMaps[groupIndex].get(rowIdentity);
        return [
          ["actual", groupRow?.actual],
          ["share", groupRow?.share],
          ["budget", groupRow?.budget],
          ["achievement", groupRow?.achievement],
        ].map(([metric, value]) => `<td data-report-group-index="${group.index}" data-report-metric="${metric}">${escapeHtml(metric === "share" || metric === "achievement" ? formatRate(value) : formatAmount(value))}</td>`);
      }).join("");
      return `
        <tr data-report-row-key="${escapeHtml(row.key || "")}" data-report-row-level="${Number(row.level || 0)}" data-report-parent-category="${escapeHtml(categoryKey)}"${hidden ? " hidden" : ""}>
          <td>${categoryCell}</td>
          <td>${escapeHtml(row.name || "—")}</td>
          ${metricCells}
        </tr>
      `;
    }).join("");
  }

  function toggleReportCategory(event) {
    const button = event?.target?.closest?.("[data-report-category-toggle]");
    if (!button) return;
    const key = button.dataset.reportCategoryToggle || "";
    if (collapsedCategories.has(key)) collapsedCategories.delete(key);
    else collapsedCategories.add(key);
    const expanded = !collapsedCategories.has(key);
    button.setAttribute("aria-expanded", String(expanded));
    const icon = button.querySelector?.("[aria-hidden='true']");
    if (icon) icon.textContent = expanded ? "▾" : "▸";
    query("#store-operating-report-body")?.querySelectorAll?.(
      `tr[data-report-parent-category="${globalThis.CSS?.escape?.(button.dataset.reportCategoryToggle || "") || button.dataset.reportCategoryToggle || ""}"]`,
    ).forEach((row) => {
      if (row.dataset.reportRowKey !== "sales-profit") row.hidden = !expanded;
    });
  }

  function applyStoreOperatingMonthlyReportSort(key = "") {
    const table = query("#store-operating-report-table");
    const body = table?.tBodies?.[0];
    if (!body || !key) return;
    reportSortState.direction = reportSortState.key === key && reportSortState.direction === "asc" ? "desc" : "asc";
    reportSortState.key = key;
    const dynamicMatch = String(key).match(/^group-(\d+)-(actual|share|budget|achievement)$/);
    const columnIndex = dynamicMatch
      ? 2 + Number(dynamicMatch[1]) * 4 + ["actual", "share", "budget", "achievement"].indexOf(dynamicMatch[2])
      : { category: 0, name: 1, actual: 2, share: 3, budget: 4, achievement: 5 }[key];
    if (columnIndex === undefined) return;
    const rows = Array.from(body.rows);
    const categoryRows = rows.filter((row) => row.dataset.reportRowLevel === "1");
    if (!categoryRows.length) return;
    const blocks = categoryRows.map((categoryRow, index) => {
      const categoryKey = categoryRow.dataset.reportRowKey || "";
      const children = rows.filter((row) => row.dataset.reportParentCategory === categoryKey);
      return { categoryRow, children, index };
    });
    const overviewRows = rows.filter((row) => row.dataset.reportRowLevel === "0");
    blocks.sort((left, right) => {
      const result = compareReportSortValues(left.categoryRow.cells[columnIndex]?.textContent, right.categoryRow.cells[columnIndex]?.textContent);
      return (result || left.index - right.index) * (reportSortState.direction === "asc" ? 1 : -1);
    });
    [...overviewRows, ...blocks.flatMap(({ categoryRow, children }) => [categoryRow, ...children])]
      .forEach((row) => body.appendChild(row));
  }

  function structuredApiError(payload, status) {
    const message = payload?.error || `API ${status}`;
    const details = payload?.details == null ? "" : `；详情：${typeof payload.details === "string" ? payload.details : JSON.stringify(payload.details)}`;
    const endpoint = payload?.endpoint ? `；接口：${payload.endpoint}` : "";
    const error = new Error(`${message}${details}${endpoint}`);
    error.status = status;
    error.details = payload?.details;
    error.endpoint = payload?.endpoint;
    return error;
  }

  async function readApiResponse(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`API ${response.status} 返回了无法解析的响应`, { cause: error });
    }
    if (!response.ok || payload?.ok === false) throw structuredApiError(payload, response.status);
    return payload;
  }

  function budgetStatusText(status = {}) {
    if (status.state === "configured") return `预算已匹配 ${status.matchCount || 0} 条`;
    if (status.state === "partial") return "预算部分可用，请检查币种或汇率";
    if (status.state === "unavailable") return "预算币种不可用";
    return "未配置预算";
  }

  function renderReport(data, filters) {
    if (!data?.meta || typeof data.meta !== "object") throw new Error("店铺经营月报响应缺少 meta 对象");
    renderHeader(data, filters);
    renderRows(data, filters);
    const currencyText = data.meta.currencyMode === "CNY"
      ? "人民币汇总"
      : `原币分币种${data.meta.currencyCodes?.length ? `（${data.meta.currencyCodes.join("、") || "币种不可用"}）` : ""}`;
    const storeText = filters.stores.length ? filters.stores.join("、") : "全部店铺";
    const countryText = filters.countries.length ? filters.countries.join("、") : "全部国家";
    const generatedAt = String(data.meta.generatedAt || "").replace("T", " ").slice(0, 19) || "时间未知";
    setText(
      "#store-operating-report-meta",
      `${filters.startMonth} 至 ${filters.endMonth} · ${storeText} · ${countryText} · ${currencyText} · 更新于 ${generatedAt}`,
      root,
    );
    const missingText = data.meta.missingExchangeRateCount
      ? ` · 缺少 ${data.meta.missingExchangeRateCount} 条汇率`
      : "";
    const unavailableText = data.meta.unavailableMetrics?.length
      ? ` · ${data.meta.unavailableMetrics.length} 个科目不可用`
      : "";
    setText(
      "#store-operating-report-status",
      `${budgetStatusText(data.budgetStatus)}${missingText}${unavailableText}`,
      root,
    );
    refreshTable(query("#store-operating-report-table"));
  }

  function invalidateActiveReportLoad() {
    reportLoadGeneration += 1;
    activeReportAbortController?.abort();
    activeReportAbortController = null;
  }

  function startReportLoad() {
    invalidateActiveReportLoad();
    const abortController = typeof globalThis.AbortController === "function"
      ? new globalThis.AbortController()
      : null;
    activeReportAbortController = abortController;
    return { generation: reportLoadGeneration, abortController };
  }

  function isCurrentReportLoad(generation) {
    return generation === reportLoadGeneration;
  }

  async function loadStoreOperatingMonthlyReport() {
    initializeStoreOperatingMonthlyReportDefaults();
    const filters = readFilters();
    const validation = validateMonthRange(filters.startMonth, filters.endMonth);
    if (!validation.ok) {
      invalidateActiveReportLoad();
      setText("#store-operating-report-status", validation.error, root);
      return null;
    }
    const { generation, abortController } = startReportLoad();
    const reportQuery = buildReportQuery(filters);
    const exportButton = query("#store-operating-report-export");
    if (exportButton) exportButton.disabled = true;
    setText("#store-operating-report-status", "正在读取店铺经营月报…", root);
    try {
      const requestOptions = { cache: "no-store" };
      if (abortController) requestOptions.signal = abortController.signal;
      const response = await fetchImpl(`/api/finance/store-operating-monthly-report?${reportQuery}`, requestOptions);
      const data = await readApiResponse(response);
      if (!isCurrentReportLoad(generation)) return null;
      renderReport(data, filters);
      lastSuccessfulQuery = reportQuery;
      syncReportUrl(filters);
      if (exportButton) exportButton.disabled = false;
      return data;
    } catch (error) {
      if (!isCurrentReportLoad(generation)) return null;
      lastSuccessfulQuery = "";
      const emptyData = { groups: [] };
      renderHeader(emptyData, filters);
      const body = query("#store-operating-report-body");
      if (body) body.innerHTML = `<tr><td colspan="${reportColumnCount(emptyData)}">加载失败：${escapeHtml(error?.message || String(error))}</td></tr>`;
      refreshTable(query("#store-operating-report-table"));
      setText("#store-operating-report-status", `店铺经营月报加载失败：${error?.message || String(error)}`, root);
      console.error("[store-operating-monthly-report] load failed", error);
      return null;
    } finally {
      if (isCurrentReportLoad(generation) && activeReportAbortController === abortController) {
        activeReportAbortController = null;
      }
    }
  }

  function handleMonthChange() {
    const filters = readFilters();
    const validation = validateMonthRange(filters.startMonth, filters.endMonth);
    if (!validation.ok) {
      invalidateActiveReportLoad();
      setText("#store-operating-report-status", validation.error, root);
      const exportButton = query("#store-operating-report-export");
      if (exportButton) exportButton.disabled = true;
      return null;
    }
    return loadStoreOperatingMonthlyReport();
  }

  function handleCountryChange() {
    invalidateActiveReportLoad();
    syncAllOptionSelection(query("#store-operating-report-country"));
    refreshStoreOptions({ showScopeWarning: true });
    const exportButton = query("#store-operating-report-export");
    if (exportButton) exportButton.disabled = !sameQuery(buildReportQuery(), lastSuccessfulQuery);
  }

  function handleStoreChange() {
    invalidateActiveReportLoad();
    syncAllOptionSelection(query("#store-operating-report-store"));
    const exportButton = query("#store-operating-report-export");
    if (exportButton) exportButton.disabled = !sameQuery(buildReportQuery(), lastSuccessfulQuery);
  }

  function resetStoreOperatingMonthlyReport() {
    const month = getCurrentMonth();
    const startInput = query("#store-operating-report-start-month");
    const endInput = query("#store-operating-report-end-month");
    if (startInput) startInput.value = month;
    if (endInput) endInput.value = month;
    selectValues(query("#store-operating-report-country"), []);
    selectValues(query("#store-operating-report-store"), []);
    refreshStoreOptions();
    return loadStoreOperatingMonthlyReport();
  }

  function openBudgetTargets() {
    const filters = readFilters();
    const validation = validateMonthRange(filters.startMonth, filters.endMonth);
    if (!validation.ok) {
      setText("#store-operating-report-status", validation.error, root);
      return;
    }
    const params = new URLSearchParams({
      view: "budget",
      budgetMonths: validation.months.join(","),
    });
    filters.stores.forEach((value) => params.append("budgetStores", value));
    filters.countries.forEach((value) => params.append("budgetCountries", value));
    replaceLocationSearch(params);
    clickVisibleNavItem("budget");
  }

  function exportFilenameFromResponse(response, filters) {
    const disposition = response.headers?.get?.("content-disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) return decodeURIComponent(encoded);
    return `店铺经营月报-${filters.startMonth}至${filters.endMonth}.xlsx`;
  }

  async function readExportError(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`API ${response.status} 返回了无法解析的错误响应`, { cause: error });
    }
    return structuredApiError(payload, response.status);
  }

  async function exportStoreOperatingMonthlyReport() {
    const filters = readFilters();
    const reportQuery = buildReportQuery(filters);
    if (!lastSuccessfulQuery || !sameQuery(reportQuery, lastSuccessfulQuery)) {
      setText("#store-operating-report-status", "筛选条件已变更，请先查询成功后再导出。", root);
      return;
    }
    const button = query("#store-operating-report-export");
    const restoreButton = typeof setButtonBusy === "function"
      ? setButtonBusy(button, "导出中…", "导出 Excel", { disable: false })
      : () => {};
    try {
      const response = await fetchImpl(`/api/finance/store-operating-monthly-report/export?${reportQuery}`);
      if (!response.ok) throw await readExportError(response);
      downloadBlob(await response.blob(), exportFilenameFromResponse(response, filters), root);
      setText("#store-operating-report-status", "当前经营月报已导出。", root);
    } catch (error) {
      setText("#store-operating-report-status", `导出失败：${error?.message || String(error)}`, root);
      console.error("[store-operating-monthly-report] export failed", error);
    } finally {
      restoreButton();
    }
  }

  function setupStoreOperatingMonthlyReport() {
    bind(root, "#store-operating-report-start-month", "change", handleMonthChange);
    bind(root, "#store-operating-report-end-month", "change", handleMonthChange);
    bind(root, "#store-operating-report-country", "change", handleCountryChange);
    bind(root, "#store-operating-report-store", "change", handleStoreChange);
    bind(root, "#store-operating-report-query", "click", loadStoreOperatingMonthlyReport);
    bind(root, "#store-operating-report-reset", "click", resetStoreOperatingMonthlyReport);
    bind(root, "#store-operating-report-export", "click", exportStoreOperatingMonthlyReport);
    bind(root, "#store-operating-report-budget", "click", openBudgetTargets);
    bind(root, "#store-operating-report-body", "click", toggleReportCategory);
  }

  return {
    exportStoreOperatingMonthlyReport,
    handleCountryChange,
    handleMonthChange,
    handleStoreChange,
    initializeStoreOperatingMonthlyReportDefaults,
    loadStoreOperatingMonthlyReport,
    openBudgetTargets,
    readFilters,
    resetStoreOperatingMonthlyReport,
    setupStoreOperatingMonthlyReport,
    toggleReportCategory,
    applyStoreOperatingMonthlyReportSort,
  };
}

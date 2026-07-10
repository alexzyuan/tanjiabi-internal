export function createSalesForecastFeature({
  root = globalThis.document,
  bind,
  bindAll,
  cachedSalesImageUrl,
  closestTarget,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  formatActualMoney,
  formatNumber,
  normalizedSalesImageUrl,
  parseNumber,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setElementsDisabled,
  setSelectedElementState,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
} = {}) {
  if (typeof bind !== "function") throw new Error("createSalesForecastFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createSalesForecastFeature requires bindAll.");
  if (typeof downloadBlob !== "function") throw new Error("createSalesForecastFeature requires downloadBlob.");
  if (typeof fetchImpl !== "function") throw new Error("createSalesForecastFeature requires fetch.");

  let salesForecastData = null;
  let salesForecastStoreFilterOptions = [];
  let salesForecastEnrichmentTimer = null;
  let salesForecastEnrichmentRetryCount = 0;
  const SALES_FORECAST_MANUAL_STORAGE_KEY = "tanjia:salesForecastManualDaily:v1";
  const SALES_FORECAST_MANUAL_MIGRATION_KEY = "tanjia:salesForecastManualDailyMigrated:v2";
  const SALES_FORECAST_FOCUS_STORAGE_KEY = "tanjia:salesForecastFocus:v1";
  const SALES_FORECAST_HIDDEN_STORAGE_KEY = "tanjia:salesForecastHiddenRows:v1";
  const SALES_FORECAST_MONTH_DAYS_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const SALES_FORECAST_CURRENT_MONTH_INDEX = new Date().getMonth();
  const SALES_FORECAST_REFERENCE_YEAR = 2025;
  let salesForecastManualDaily = loadSalesForecastManualDaily();
  let salesForecastFocusedRows = loadSalesForecastFocusedRows();
  let salesForecastHiddenRows = loadSalesForecastHiddenRows();
  let salesForecastViewMode = ["default", "focus", "hidden"].includes(globalThis.localStorage?.getItem("tanjia:salesForecastViewMode:v1"))
    ? globalThis.localStorage.getItem("tanjia:salesForecastViewMode:v1")
    : "default";
  const salesForecastManualSaveTimers = new Map();

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function queryAll(selector) {
    return [...(root?.querySelectorAll?.(selector) || [])];
  }

const salesForecastColumns = [
  { key: "focus", label: "关注", cls: "sticky-col sticky-focus text-cell", type: "focus" },
  { key: "hide", label: "隐藏", cls: "sticky-col sticky-hide text-cell", type: "hide" },
  { key: "imageUrl", label: "图片", cls: "sticky-col sticky-image text-cell", type: "image" },
  { key: "storeName", label: "店铺", cls: "sticky-col sticky-store text-cell" },
  { key: "country", label: "国家", cls: "sticky-col sticky-country text-cell" },
  { key: "productName", label: "产品名称", cls: "sticky-col sticky-product text-cell" },
  { key: "msku", label: "msku", cls: "sticky-col sticky-msku text-cell" },
  { key: "fbaAvailable", label: "FBA可售", cls: "compact-number-col" },
  { key: "fbaTransfer", label: "FBA转库", cls: "compact-number-col" },
  { key: "fbaReserved", label: "FBA预留", cls: "compact-number-col" },
  { key: "awd", label: "AWD", cls: "compact-number-col" },
  { key: "fbaInbound", label: "FBA在途", cls: "compact-number-col" },
  { key: "totalStock", label: "总库存", cls: "compact-number-col" },
  { key: "salesForecast", label: "销量预测", cls: "forecast-emphasis compact-number-col" },
  { key: "peakSeasonForecast", label: "旺季预测", cls: "forecast-emphasis compact-number-col" },
  { key: "fbaAvailableDays", label: "FBA可售天数", type: "days", cls: "compact-number-col" },
  { key: "inboundArrivalDate", label: "在途送达时间", type: "text", cls: "compact-date-col" },
  { key: "outOfStockDate", label: "断货日期", type: "text", cls: "compact-date-col" },
  { key: "shippingDate", label: "发货日期", type: "text", cls: "compact-date-col" },
  { key: "purchaseDate", label: "采购日期", type: "text", cls: "compact-date-col" },
  { key: "recommendedDaily", label: "日销建议", type: "decimal", cls: "compact-number-col" },
  { key: "replenishmentSuggestion", label: "补货建议", type: "signed", cls: "compact-number-col" },
  ...Array.from({ length: 12 - SALES_FORECAST_CURRENT_MONTH_INDEX }, (_, offset) => {
    const index = SALES_FORECAST_CURRENT_MONTH_INDEX + offset;
    return [
      { key: `monthDaily${index}`, label: `${index + 1}月日销`, type: "monthDaily", cls: "month-daily-col" },
      { key: `monthSales${index}`, label: `${index + 1}月销量`, type: "monthSales", cls: "month-sales-col" },
    ];
  }).flat(),
  { key: "daysRemainingInMonth", label: "本月剩余天数", cls: "compact-number-col" },
  { key: "days3", label: "3天日均", type: "recentDaily", cls: "compact-number-col" },
  { key: "days7", label: "7天日均", type: "recentDaily", cls: "compact-number-col" },
  { key: "days14", label: "14天日均", type: "recentDaily", cls: "compact-number-col" },
  { key: "days30", label: "30天日均", type: "recentDaily", cls: "compact-number-col" },
];

function renderSalesForecastHeader() {
  const groupRow = query("#sales-forecast-group-row");
  const row = query("#sales-forecast-head-row");
  if (!row || !groupRow || row.dataset.ready === "true") return;
  const salesColumnCount = salesForecastColumns.filter((column) => ["monthDaily", "monthSales", "recentDaily"].includes(column.type) || column.key === "daysRemainingInMonth").length;
  groupRow.innerHTML = `
    <th class="group-head product-group sticky-product-group" colspan="7">产品信息</th>
    <th class="group-head inventory-group" colspan="6">库存信息</th>
    <th class="group-head action-group" colspan="9">预测与动作</th>
    <th class="group-head sales-group" colspan="${salesColumnCount}">销量数据</th>
  `;
  row.innerHTML = salesForecastColumns
    .map((column) => `<th class="${column.cls || ""} col-${escapeHtml(column.key)}">${escapeHtml(column.label)}</th>`)
    .join("");
  row.dataset.ready = "true";
}

function buildSalesForecastQuery(options = {}) {
  const params = new URLSearchParams();
  const country = selectedFilterValue("#sales-forecast-country");
  const store = selectedFilterValue("#sales-forecast-store");
  const keyword = trimmedFieldValue("#sales-forecast-keyword");
  if (country) params.set("country", country);
  if (store) params.set("store", store);
  if (keyword) params.set("keyword", keyword);
  if (options.force) params.set("force", "1");
  return params.toString();
}

function renderSalesForecastStores(stores = [], { selectAllStores = false } = {}) {
  salesForecastStoreFilterOptions = stores || [];
  const countries = selectedFilterValues("#sales-forecast-country");
  setSelectOptions("#sales-forecast-store", salesForecastStoreFilterOptions, "全部店铺", { groupByCountry: true, countries, selectAllVisible: selectAllStores });
}

function renderSalesForecastViewToggle() {
  const selected = [...queryAll("[data-sales-forecast-view]")]
    .find((button) => button.dataset.salesForecastView === salesForecastViewMode);
  setSelectedElementState("[data-sales-forecast-view]", selected);
}

function loadSalesForecastManualDaily() {
  try {
    const data = JSON.parse(globalThis.localStorage.getItem(SALES_FORECAST_MANUAL_STORAGE_KEY) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function loadSalesForecastFocusedRows() {
  try {
    const data = JSON.parse(globalThis.localStorage.getItem(SALES_FORECAST_FOCUS_STORAGE_KEY) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function loadSalesForecastHiddenRows() {
  try {
    const data = JSON.parse(globalThis.localStorage.getItem(SALES_FORECAST_HIDDEN_STORAGE_KEY) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveSalesForecastFocusedRows() {
  globalThis.localStorage.setItem(SALES_FORECAST_FOCUS_STORAGE_KEY, JSON.stringify(salesForecastFocusedRows));
}

function saveSalesForecastHiddenRows() {
  globalThis.localStorage.setItem(SALES_FORECAST_HIDDEN_STORAGE_KEY, JSON.stringify(salesForecastHiddenRows));
}

function saveSalesForecastManualDaily() {
  globalThis.localStorage.setItem(SALES_FORECAST_MANUAL_STORAGE_KEY, JSON.stringify(salesForecastManualDaily));
}

function canonicalSalesForecastManualKey(rowKey) {
  const rawKey = String(rowKey || "").trim();
  if (!rawKey) return "";
  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey);
  } catch {
    decoded = rawKey;
  }
  const parts = decoded.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return encodeURIComponent([parts[0], parts.at(-1)].join("|"));
  return rawKey;
}

function mergeSalesForecastManualValues(existingValues, incomingValues, overwrite = false) {
  const existing = Array.isArray(existingValues) ? existingValues : Array(12).fill(0);
  const incoming = Array.isArray(incomingValues) ? incomingValues : Array(12).fill(0);
  return Array.from({ length: 12 }, (_, index) => {
    const currentValue = Number(existing[index] || 0);
    const nextValue = Number(incoming[index] || 0);
    return overwrite || (!currentValue && nextValue) ? nextValue : currentValue;
  });
}

function normalizeSalesForecastManualDailyMap(data) {
  if (!data || typeof data !== "object") return {};
  const normalized = {};
  Object.entries(data)
    .filter(([key, values]) => key && Array.isArray(values))
    .forEach(([key, values]) => {
      const canonicalKey = canonicalSalesForecastManualKey(key);
      const normalizedValues = Array.from({ length: 12 }, (_, index) => Number(values[index] || 0));
      normalized[canonicalKey] = mergeSalesForecastManualValues(normalized[canonicalKey], normalizedValues);
    });
  return normalized;
}

function normalizeSalesForecastHiddenRows(data) {
  if (!data || typeof data !== "object") return {};
  const normalized = {};
  Object.entries(data).forEach(([key, hidden]) => {
    const canonicalKey = canonicalSalesForecastManualKey(key);
    if (canonicalKey && hidden) normalized[canonicalKey] = true;
  });
  return normalized;
}

function applySalesForecastServerManualDaily(data = {}) {
  const serverRows = normalizeSalesForecastManualDailyMap(data.manualDaily || {});
  salesForecastManualDaily = serverRows;
  saveSalesForecastManualDaily();
}

function applySalesForecastServerHiddenRows(data = {}) {
  salesForecastHiddenRows = normalizeSalesForecastHiddenRows(data.hiddenRows || {});
  saveSalesForecastHiddenRows();
}

function hasSalesForecastManualDailyValues(data = {}) {
  return Object.values(data).some((values) => Array.isArray(values) && values.some((value) => Number(value || 0) !== 0));
}

function salesForecastManualDailyRowsMissingOnServer(serverRows = {}, localRows = {}) {
  const normalizedServerRows = normalizeSalesForecastManualDailyMap(serverRows);
  const normalizedLocalRows = normalizeSalesForecastManualDailyMap(localRows);
  return Object.entries(normalizedLocalRows).reduce((rows, [rowKey, localValues]) => {
    const serverValues = Array.isArray(normalizedServerRows[rowKey]) ? normalizedServerRows[rowKey] : Array(12).fill(0);
    const hasMissingValue = localValues.some((value, index) => Number(value || 0) !== 0 && Number(serverValues[index] || 0) === 0);
    if (hasMissingValue) rows[rowKey] = localValues;
    return rows;
  }, {});
}

function mergeSalesForecastManualDailyForDisplay(serverRows = {}, localRows = {}) {
  const merged = normalizeSalesForecastManualDailyMap(serverRows);
  Object.entries(normalizeSalesForecastManualDailyMap(localRows)).forEach(([rowKey, values]) => {
    const existing = Array.isArray(merged[rowKey]) ? merged[rowKey] : Array(12).fill(0);
    merged[rowKey] = mergeSalesForecastManualValues(existing, values);
  });
  return merged;
}

async function migrateSalesForecastLocalManualDaily(data = {}) {
  const localRows = normalizeSalesForecastManualDailyMap(loadSalesForecastManualDaily());
  if (!hasSalesForecastManualDailyValues(localRows)) return data;
  const rowsToMigrate = salesForecastManualDailyRowsMissingOnServer(data.manualDaily || {}, localRows);
  if (!hasSalesForecastManualDailyValues(rowsToMigrate)) return data;

  try {
    const response = await fetchImpl("/api/dashboard/sales-forecast/manual-daily/migrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: rowsToMigrate }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || "旧日销迁移失败");
    globalThis.localStorage.setItem(SALES_FORECAST_MANUAL_MIGRATION_KEY, result.updatedAt || new Date().toISOString());
    return {
      ...data,
      manualDaily: result.rows || data.manualDaily || {},
      manualDailyUpdatedAt: result.updatedAt || data.manualDailyUpdatedAt || "",
    };
  } catch (error) {
    setText("#sales-forecast-status", `旧日销迁移失败，将保留本机旧数据重试：${error.message}`);
    return {
      ...data,
      manualDaily: mergeSalesForecastManualDailyForDisplay(data.manualDaily || {}, localRows),
    };
  }
}

async function saveSalesForecastManualDailyToServer(rowKey, values) {
  const canonicalRowKey = canonicalSalesForecastManualKey(rowKey);
  const response = await fetchImpl("/api/dashboard/sales-forecast/manual-daily", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowKey: canonicalRowKey, values }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "日销保存失败");
  if (data.rowKey && Array.isArray(data.values)) {
    salesForecastManualDaily[data.rowKey] = Array.from({ length: 12 }, (_, index) => Number(data.values[index] || 0));
    saveSalesForecastManualDaily();
  }
  return data;
}

function scheduleSalesForecastManualDailySave(rowKey) {
  const canonicalRowKey = canonicalSalesForecastManualKey(rowKey);
  globalThis.clearTimeout(salesForecastManualSaveTimers.get(canonicalRowKey));
  const timer = globalThis.setTimeout(async () => {
    try {
      await saveSalesForecastManualDailyToServer(canonicalRowKey, salesForecastManualDaily[canonicalRowKey] || Array(12).fill(0));
    } catch (error) {
      setText("#sales-forecast-status", `日销保存失败：${error.message}`);
    } finally {
      salesForecastManualSaveTimers.delete(canonicalRowKey);
    }
  }, 350);
  salesForecastManualSaveTimers.set(canonicalRowKey, timer);
}

async function flushSalesForecastManualDailySave(rowKey) {
  const canonicalRowKey = canonicalSalesForecastManualKey(rowKey);
  const timer = salesForecastManualSaveTimers.get(canonicalRowKey);
  if (timer) {
    globalThis.clearTimeout(timer);
    salesForecastManualSaveTimers.delete(canonicalRowKey);
  }
  try {
    await saveSalesForecastManualDailyToServer(canonicalRowKey, salesForecastManualDaily[canonicalRowKey] || Array(12).fill(0));
  } catch (error) {
    setText("#sales-forecast-status", `日销保存失败：${error.message}`);
  }
}

function salesForecastRowKey(row) {
  return encodeURIComponent([row.sid || "", row.msku || ""].join("|"));
}

function isSalesForecastFocused(row) {
  return Boolean(salesForecastFocusedRows[row.manualKey || salesForecastRowKey(row)]);
}

function isSalesForecastHidden(row) {
  return Boolean(salesForecastHiddenRows[row.manualKey || salesForecastRowKey(row)]);
}

async function saveSalesForecastHiddenRowToServer(rowKey, hidden) {
  const canonicalRowKey = canonicalSalesForecastManualKey(rowKey);
  const response = await fetchImpl("/api/dashboard/sales-forecast/hidden-row", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowKey: canonicalRowKey, hidden }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "隐藏状态保存失败");
  if (data.rows && typeof data.rows === "object") {
    salesForecastHiddenRows = normalizeSalesForecastHiddenRows(data.rows);
  } else if (data.rowKey) {
    if (data.hidden) salesForecastHiddenRows[data.rowKey] = true;
    else delete salesForecastHiddenRows[data.rowKey];
  }
  saveSalesForecastHiddenRows();
  return data;
}

function daysInMonthOffset(base, offset) {
  return new Date(base.getFullYear(), base.getMonth() + offset + 1, 0).getDate();
}

function addForecastDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function formatForecastDate(value) {
  if (typeof value === "string") return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "-";
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function calculateSalesForecastValue(monthlySales) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const at = (index) => Number(monthlySales[((index - 1) % 12 + 12) % 12] || 0);
  const plans = {
    1: [1, 2, 3, 4],
    2: [2, 3, 4],
    3: [3, 4, 5],
    4: [4, 5, 6, 7],
    5: [5, 6, 7],
    6: [6, 7, 8],
    7: [7, 8, 9, 10, 11],
    8: [8, 9, 10, 11, 12],
    9: [9, 10, 11, 12],
    10: [10, 11, 12],
    11: [11, 12, 1],
    12: [12, 1, 2, 3, 4],
  };
  return Math.round((plans[month] || []).reduce((sum, item) => sum + at(item), 0));
}

function calculatePeakSeasonForecastValue(monthlySales, now = new Date()) {
  return Math.round(
    monthlySales
      .slice(now.getMonth(), 12)
      .reduce((sum, value) => sum + Number(value || 0), 0),
  );
}

function calculateFbaAvailableDaysValue(totalStock, monthlyDailySales) {
  const now = new Date();
  const stock = Number(totalStock || 0);
  if (stock <= 0) return 0;
  const monthIndex = now.getMonth();
  const daysRemaining = daysInMonthOffset(now, 0) - now.getDate();
  const currentDaily = Number(monthlyDailySales[monthIndex] || 0);
  if (stock <= daysRemaining * currentDaily) return currentDaily ? stock / currentDaily : 999;

  let remaining = stock - daysRemaining * currentDaily;
  let coveredDays = daysRemaining;
  for (let offset = 1; offset <= 3; offset += 1) {
    const daily = Number(monthlyDailySales[(monthIndex + offset) % 12] || 0);
    const monthDays = daysInMonthOffset(now, offset);
    if (remaining <= monthDays * daily) return coveredDays + (daily ? remaining / daily : 999);
    remaining -= monthDays * daily;
    coveredDays += monthDays;
  }
  return 999;
}

function recalculateSalesForecastRow(row) {
  const now = new Date();
  const key = salesForecastRowKey(row);
  const savedDaily = Array.isArray(salesForecastManualDaily[key]) ? salesForecastManualDaily[key] : Array(12).fill(0);
  const monthlyDailySales = Array.from({ length: 12 }, (_, index) => Number(savedDaily[index] || 0));
  const daysRemaining = daysInMonthOffset(now, 0) - now.getDate();
  const monthlySales = monthlyDailySales.map((daily, index) => Math.round(daily * (index === now.getMonth() ? daysRemaining : SALES_FORECAST_MONTH_DAYS_2026[index])));
  const totalStock = Number(row.fbaAvailable || 0) + Number(row.fbaTransfer || 0) + Number(row.fbaReserved || 0) + Number(row.awd || 0);
  const salesForecast = calculateSalesForecastValue(monthlySales);
  const peakSeasonForecast = calculatePeakSeasonForecastValue(monthlySales, now);
  const fbaAvailableDays = Number(calculateFbaAvailableDaysValue(totalStock, monthlyDailySales).toFixed(1));
  const outOfStockDate = fbaAvailableDays >= 999 ? "不缺货" : formatForecastDate(addForecastDays(now, fbaAvailableDays));
  const shippingDate = outOfStockDate === "不缺货" ? "无需发货" : formatForecastDate(addForecastDays(new Date(`${outOfStockDate}T00:00:00`), -45));
  const purchaseDate = shippingDate === "无需发货" ? "无需采购" : formatForecastDate(addForecastDays(new Date(`${shippingDate}T00:00:00`), -30));
  return {
    ...row,
    manualKey: key,
    monthlyDailySales,
    monthlySales,
    totalStock,
    salesForecast,
    peakSeasonForecast,
    fbaAvailableDays,
    outOfStockDate,
    shippingDate,
    purchaseDate,
    replenishmentSuggestion: Math.round(salesForecast - totalStock - Number(row.fbaInbound || 0)),
    daysRemainingInMonth: daysRemaining,
  };
}

function prepareSalesForecastRows(rows = []) {
  return rows.map((row) => recalculateSalesForecastRow(row));
}

function summarizeSalesForecastRows(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.salesForecast += Number(row.salesForecast || 0);
      acc.fbaInbound += Number(row.fbaInbound || 0);
      acc.lowStockCount += row.fbaAvailableDays > 0 && row.fbaAvailableDays < 14 ? 1 : 0;
      acc.replenishmentCount += row.replenishmentSuggestion > 0 ? 1 : 0;
      return acc;
    },
    { salesForecast: 0, fbaInbound: 0, lowStockCount: 0, replenishmentCount: 0 },
  );
}

function salesForecastRiskClass(row) {
  const days = Number(row.fbaAvailableDays || 0);
  if (row.replenishmentSuggestion > 0 || (days > 0 && days < 14)) return "risk-high";
  if (days > 0 && days < 30) return "risk-mid";
  return "risk-low";
}

function salesForecastCellValue(row, column) {
  if (column.type === "monthDaily") return row.monthlyDailySales?.[Number(column.key.replace("monthDaily", ""))] ?? 0;
  if (column.type === "monthSales") return row.monthlySales?.[Number(column.key.replace("monthSales", ""))] ?? 0;
  if (column.type === "recentDaily") return row.recentDaily?.[column.key] ?? 0;
  return row[column.key];
}

function salesForecastPreviousYearText(row, column) {
  if (column.type !== "monthSales") return "";
  const monthIndex = Number(column.key.replace("monthSales", ""));
  const referenceValue = row.previousYearMonthlySales?.[monthIndex];
  const monthLabel = `${monthIndex + 1}月`;
  const valueText = referenceValue === undefined || referenceValue === null || referenceValue === ""
    ? "暂无"
    : formatNumber(Number(referenceValue || 0));
  return `${monthLabel} ${SALES_FORECAST_REFERENCE_YEAR}销量：${valueText}`;
}

function formatSalesForecastCell(row, column) {
  const value = salesForecastCellValue(row, column);
  if (column.type === "focus") {
    const focused = isSalesForecastFocused(row);
    return `<button class="sales-focus-toggle ${focused ? "is-focused" : ""}" type="button" data-sales-focus-key="${escapeHtml(row.manualKey || salesForecastRowKey(row))}" aria-label="${focused ? "取消关注" : "关注"}">${focused ? "★" : ""}</button>`;
  }
  if (column.type === "hide") {
    const hidden = isSalesForecastHidden(row);
    return `<button class="sales-hide-toggle ${hidden ? "is-hidden" : ""}" type="button" data-sales-hide-key="${escapeHtml(row.manualKey || salesForecastRowKey(row))}" data-hidden="${hidden ? "1" : "0"}">${hidden ? "恢复" : "隐藏"}</button>`;
  }
  if (column.type === "image") {
    const imageUrl = cachedSalesImageUrl(value);
    const directImageUrl = normalizedSalesImageUrl(value);
    const retryOnError = directImageUrl && directImageUrl !== imageUrl
      ? "if(this.dataset.directSrc&&!this.dataset.directTried){this.dataset.directTried='1';this.src=this.dataset.directSrc}else{this.parentElement.classList.add('image-failed')}"
      : "this.parentElement.classList.add('image-failed')";
    return imageUrl
      ? `<span class="sales-product-image-frame"><img class="sales-product-image" src="${escapeHtml(imageUrl)}" data-direct-src="${escapeHtml(directImageUrl)}" alt="${escapeHtml(row.productName || row.msku || "产品图片")}" loading="lazy" referrerpolicy="no-referrer" onerror="${retryOnError}" /><span class="image-placeholder sales-image-fallback" aria-hidden="true">-</span></span>`
      : `<span class="image-placeholder">-</span>`;
  }
  if (column.type === "monthDaily") {
    const monthIndex = Number(column.key.replace("monthDaily", ""));
    const displayValue = value ? formatActualMoney(value) : "";
    return `<input class="sales-daily-input" data-sales-daily="true" data-sales-row-key="${escapeHtml(row.manualKey || salesForecastRowKey(row))}" data-sales-month="${monthIndex}" inputmode="decimal" value="${escapeHtml(displayValue)}" />`;
  }
  if (column.type === "monthSales") {
    const referenceText = salesForecastPreviousYearText(row, column);
    return `<span class="sales-month-sales-value">${formatNumber(value || 0)}</span>${referenceText ? `<span class="sales-month-sales-tooltip" role="tooltip">${escapeHtml(referenceText)}</span>` : ""}`;
  }
  if (column.type === "text") return escapeHtml(value || "-");
  if (column.type === "days") {
    if (Number(value) >= 999) return "999";
    return formatActualMoney(value || 0);
  }
  if (column.type === "decimal" || column.type === "recentDaily") {
    return formatActualMoney(value || 0);
  }
  if (column.type === "signed") {
    return Number(value || 0) > 0 ? `<span class="risk-badge ${salesForecastRiskClass(row)}">${formatNumber(value)}</span>` : formatNumber(value || 0);
  }
  return typeof value === "number" ? formatNumber(value || 0) : escapeHtml(value || "-");
}

function renderSalesForecast(data = salesForecastData) {
  renderSalesForecastHeader();
  const nextData = data || salesForecastData || { rows: [], summary: {}, meta: {} };
  const rows = prepareSalesForecastRows(nextData.rows || []);
  const visibleRows = rows.filter((row) => {
    const hidden = isSalesForecastHidden(row);
    if (salesForecastViewMode === "hidden") return hidden;
    if (hidden) return false;
    if (salesForecastViewMode === "focus") return isSalesForecastFocused(row);
    return true;
  });
  const summary = summarizeSalesForecastRows(visibleRows);
  salesForecastData = { ...nextData, rows, summary };
  renderSalesForecastStores(salesForecastData.meta?.stores || []);
  renderSalesForecastViewToggle();
  setText("#sales-forecast-total", formatNumber(summary.salesForecast || 0));
  setText("#sales-forecast-inbound", formatNumber(summary.fbaInbound || 0));
  setText("#sales-forecast-low-stock", formatNumber(summary.lowStockCount || 0));
  setText("#sales-forecast-replenishment", formatNumber(summary.replenishmentCount || 0));
  setText("#sales-forecast-status", `${salesForecastData.meta?.source || "领星 ERP"} · ${salesForecastData.meta?.syncStatus || ""} · ${salesForecastData.meta?.updatedAt || ""}`);

  const table = query("#sales-forecast-table-body");
  if (!table) return;
  table.innerHTML = visibleRows.length
    ? visibleRows.slice(0, 300).map((row) => `
      <tr data-sales-row-key="${escapeHtml(row.manualKey || salesForecastRowKey(row))}">
        ${salesForecastColumns.map((column) => {
          const referenceText = salesForecastPreviousYearText(row, column);
          const tooltipAttrs = referenceText ? ` tabindex="0" aria-label="${escapeHtml(`${salesForecastCellValue(row, column) || 0}，${referenceText}`)}"` : "";
          return `
          <td class="${column.cls || ""} col-${escapeHtml(column.key)} ${column.key === "fbaAvailableDays" ? salesForecastRiskClass(row) : ""}"${tooltipAttrs}>
            ${formatSalesForecastCell(row, column)}
          </td>`;
        }).join("")}
      </tr>
    `).join("")
    : `<tr><td colspan="${salesForecastColumns.length}">${
      salesForecastViewMode === "hidden"
        ? "当前没有隐藏产品。"
        : salesForecastViewMode === "focus"
          ? "当前没有关注产品。"
          : "当前筛选条件下没有销售预估数据。"
    }</td></tr>`;
}

function scheduleSalesForecastEnrichmentRefresh(data) {
  globalThis.clearTimeout(salesForecastEnrichmentTimer);
  if (!data?.meta?.enrichmentPending) {
    salesForecastEnrichmentRetryCount = 0;
    return;
  }
  if (salesForecastEnrichmentRetryCount >= 3) return;
  salesForecastEnrichmentRetryCount += 1;
  salesForecastEnrichmentTimer = globalThis.setTimeout(() => {
    loadSalesForecast({ silent: true, enrichmentRetry: true });
  }, 4000);
}

async function loadSalesForecast(options = {}) {
  renderSalesForecastHeader();
  const button = query("#sales-forecast-refresh");
  const table = query("#sales-forecast-table-body");
  const silent = Boolean(options.silent);
  if (options.force) salesForecastEnrichmentRetryCount = 0;
  const restoreButton = !silent ? setButtonBusy(button, "加载中", "刷新预估") : () => {};
  if (!silent) {
    setText("#sales-forecast-status", options.force ? "正在刷新领星 ERP 补货建议" : "正在读取销售预估缓存");
    renderTableMessage(table, salesForecastColumns.length, "正在加载销售预估...");
  }
  try {
    const response = await fetchImpl(`/api/dashboard/sales-forecast?${buildSalesForecastQuery(options)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "销售预估加载失败");
    const migratedData = await migrateSalesForecastLocalManualDaily(data);
    applySalesForecastServerManualDaily(migratedData);
    applySalesForecastServerHiddenRows(migratedData);
    renderSalesForecast(migratedData);
    scheduleSalesForecastEnrichmentRefresh(migratedData);
    setText("#home-purchase-pending", `${formatNumber(migratedData.summary?.replenishmentCount || 0)} 个需补货`);
  } catch (error) {
    if (!silent) {
      setText("#sales-forecast-status", `销售预估加载失败：${error.message}`);
      renderTableMessage(table, salesForecastColumns.length, "加载失败，请稍后重试。");
    }
  } finally {
    restoreButton();
  }
}

async function exportSalesForecastEstimate() {
  const button = query("#sales-forecast-export");
  const restoreButton = setButtonBusy(button, "导出中...", button?.textContent || "导出表格");
  try {
    const response = await fetchImpl(`/api/dashboard/sales-forecast/export?${buildSalesForecastQuery()}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `导出失败：${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : "销售预估旺季补货.xlsx";
    downloadBlob(blob, filename);
    setText("#sales-forecast-status", `销售预估表格已导出：${filename}`);
  } catch (error) {
    setText("#sales-forecast-status", `销售预估导出失败：${error.message}`);
  } finally {
    restoreButton();
  }
}

const scheduleSalesForecastLoad = createDebouncedAction(loadSalesForecast, 350);

function handleSalesForecastDailyInput(event) {
  const input = closestTarget(event, "[data-sales-daily]");
  if (!input) return;
  const rowKey = canonicalSalesForecastManualKey(input.dataset.salesRowKey || "");
  const monthIndex = Number(input.dataset.salesMonth);
  if (!rowKey || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return;
  const values = Array.isArray(salesForecastManualDaily[rowKey])
    ? [...salesForecastManualDaily[rowKey]]
    : Array(12).fill(0);
  values[monthIndex] = parseNumber(input.value);
  salesForecastManualDaily[rowKey] = values;
  saveSalesForecastManualDaily();
  scheduleSalesForecastManualDailySave(rowKey);
  const selectionStart = input.selectionStart;
  renderSalesForecast(salesForecastData);
  const nextInput = query(`[data-sales-row-key="${CSS.escape(rowKey)}"][data-sales-month="${monthIndex}"]`);
  if (nextInput) {
    nextInput.focus();
    if (selectionStart !== null) nextInput.setSelectionRange(selectionStart, selectionStart);
  }
}

function handleSalesForecastDailyCommit(event) {
  const input = closestTarget(event, "[data-sales-daily]");
  if (!input) return;
  const rowKey = canonicalSalesForecastManualKey(input.dataset.salesRowKey || "");
  if (!rowKey) return;
  flushSalesForecastManualDailySave(rowKey);
}

function handleSalesForecastFocusClick(event) {
  const button = closestTarget(event, "[data-sales-focus-key]");
  if (!button) return;
  const rowKey = button.dataset.salesFocusKey || "";
  if (!rowKey) return;
  if (salesForecastFocusedRows[rowKey]) delete salesForecastFocusedRows[rowKey];
  else salesForecastFocusedRows[rowKey] = true;
  saveSalesForecastFocusedRows();
  renderSalesForecast(salesForecastData);
}

async function handleSalesForecastHideClick(event) {
  const button = closestTarget(event, "[data-sales-hide-key]");
  if (!button) return;
  const rowKey = canonicalSalesForecastManualKey(button.dataset.salesHideKey || "");
  if (!rowKey) return;
  const nextHidden = button.dataset.hidden !== "1";
  setElementsDisabled(button, true);
  if (nextHidden) salesForecastHiddenRows[rowKey] = true;
  else delete salesForecastHiddenRows[rowKey];
  saveSalesForecastHiddenRows();
  renderSalesForecast(salesForecastData);
  try {
    await saveSalesForecastHiddenRowToServer(rowKey, nextHidden);
    renderSalesForecast(salesForecastData);
    setText("#sales-forecast-status", nextHidden ? "已隐藏该 MSKU，默认和关注视图将不再显示。" : "已恢复该 MSKU。");
  } catch (error) {
    if (nextHidden) delete salesForecastHiddenRows[rowKey];
    else salesForecastHiddenRows[rowKey] = true;
    saveSalesForecastHiddenRows();
    renderSalesForecast(salesForecastData);
    setText("#sales-forecast-status", `隐藏状态保存失败：${error.message}`);
  }
}

function salesForecastTooltipCell(target) {
  const cell = target?.closest?.("td.month-sales-col");
  return cell?.querySelector(".sales-month-sales-tooltip") ? cell : null;
}

function handleSalesForecastTooltipOpen(event) {
  salesForecastTooltipCell(event.target)?.classList.add("is-tooltip-open");
}

function handleSalesForecastTooltipClose(event) {
  const cell = salesForecastTooltipCell(event.target);
  if (!cell) return;
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && cell.contains(nextTarget)) return;
  cell.classList.remove("is-tooltip-open");
}

function setSalesForecastViewMode(mode) {
  salesForecastViewMode = ["default", "focus", "hidden"].includes(mode) ? mode : "default";
  globalThis.localStorage.setItem("tanjia:salesForecastViewMode:v1", salesForecastViewMode);
  renderSalesForecast(salesForecastData);
}


    function setupSalesForecast() {
    renderSalesForecastHeader();
    bind(root, "#sales-forecast-refresh", "click", () => loadSalesForecast({ force: true }));
    bind(root, "#sales-forecast-export", "click", exportSalesForecastEstimate);
    bind(root, "#sales-forecast-country", "change", () => {
      syncAllOptionSelection(query("#sales-forecast-country"));
      renderSalesForecastStores(salesForecastStoreFilterOptions, { selectAllStores: true });
      loadSalesForecast();
    });
    bind(root, "#sales-forecast-store", "change", () => {
      syncAllOptionSelection(query("#sales-forecast-store"));
      loadSalesForecast();
    });
    bind(root, "#sales-forecast-keyword", "input", scheduleSalesForecastLoad);
    bind(root, "#sales-forecast-table-body", "input", handleSalesForecastDailyInput);
    bind(root, "#sales-forecast-table-body", "change", handleSalesForecastDailyCommit);
    bind(root, "#sales-forecast-table-body", "focusout", handleSalesForecastDailyCommit);
    bind(root, "#sales-forecast-table-body", "click", handleSalesForecastFocusClick);
    bind(root, "#sales-forecast-table-body", "click", handleSalesForecastHideClick);
    bind(root, "#sales-forecast-table-body", "pointerover", handleSalesForecastTooltipOpen);
    bind(root, "#sales-forecast-table-body", "pointerout", handleSalesForecastTooltipClose);
    bind(root, "#sales-forecast-table-body", "focusin", handleSalesForecastTooltipOpen);
    bind(root, "#sales-forecast-table-body", "focusout", handleSalesForecastTooltipClose);
    bindAll(root, "[data-sales-forecast-view]", "click", function handleSalesForecastViewClick() {
      setSalesForecastViewMode(this.dataset.salesForecastView);
    });
  }

  return {
    loadSalesForecast,
    renderSalesForecastHeader,
    setupSalesForecast,
  };
}

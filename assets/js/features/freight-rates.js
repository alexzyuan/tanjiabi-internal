import { fbaLogisticsChannelNamesForCountry, fbaLogisticsChannelsByCountry } from "../fba-logistics-rules.js?v=20260720-logistics-rules-v2";

export function createFreightRatesFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  renderTableMessage,
  setText,
  windowApi = globalThis.window,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFreightRatesFeature requires bind.");
  if (typeof downloadBlob !== "function") throw new Error("createFreightRatesFeature requires downloadBlob.");
  if (typeof fetchImpl !== "function") throw new Error("createFreightRatesFeature requires fetch.");

  let freightRateRows = [];
  let freightRateOptions = {
    countries: ["美国", "加拿大", "澳洲", "德国", "英国"],
    warehouseCodesByCountry: {
      美国: ["MIT", "GEU", "POC", "TCY", "ONT", "GYR"],
      加拿大: ["YYZ", "YUX", "YOW", "YYC", "YVR", "YEG", "YHM"],
      澳洲: ["BWU", "XAU", "XBW"],
    },
    carriers: ["九方通逊", "同袍"],
    channelNamesByCountry: Object.fromEntries(
      Object.entries(fbaLogisticsChannelsByCountry).map(([country, channels]) => [country, channels.map((channel) => channel.name)]),
    ),
    transportMethods: fbaLogisticsChannelNamesForCountry("美国"),
  };
  let editingFreightRateId = "";
  let freightRatesLoaded = false;
  const tableCellControlStyle = 'style="width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box;"';
  const tableCellChannelStyle = 'style="width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; text-overflow: ellipsis;"';

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function value(selector) {
    return String(query(selector)?.value || "").trim();
  }

  function outputValue(selector) {
    const element = query(selector);
    return String(element?.value || element?.textContent || "").trim();
  }

  function todayText() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isoWeekFromDate(dateText) {
    const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const weekYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
  }

  function setFreightRateStatus(message) {
    setText("#freight-rates-status", message, root);
  }

  function setOutput(selector, text) {
    const element = query(selector);
    if (!element) return;
    element.textContent = text;
    if ("value" in element) element.value = text;
  }

  function renderSelectOptions(selector, values = [], placeholder = "") {
    const select = query(selector);
    if (!select) return;
    renderSelectOptionsElement(select, values, placeholder);
  }

  function renderSelectOptionsElement(select, values = [], placeholder = "") {
    const previous = select.value;
    select.innerHTML = `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${values
      .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
      .join("")}`;
    if (previous && values.includes(previous)) select.value = previous;
  }

  function renderFreightRateOptions() {
    renderSelectOptions("#freight-rate-inline-country", freightRateOptions.countries);
    renderSelectOptions("#freight-rate-inline-carrier", freightRateOptions.carriers);
    syncInlineChannelControl();
  }

  function warehouseOptionsForCountry(country) {
    return freightRateOptions.warehouseCodesByCountry?.[country] || [];
  }

  function channelOptionsForCountry(country) {
    return freightRateOptions.channelNamesByCountry?.[country] || fbaLogisticsChannelNamesForCountry(country);
  }

  function syncWarehouseControl({ countrySelector, selectSelector, inputSelector, warehouseCode = "" } = {}) {
    const country = value(countrySelector);
    const select = query(selectSelector);
    const input = query(inputSelector);
    syncWarehouseElements({ country, select, input, warehouseCode });
  }

  function syncWarehouseElements({ country = "", select, input, warehouseCode = "" } = {}) {
    const options = warehouseOptionsForCountry(country);
    if (!select || !input) return;
    if (options.length > 0) {
      renderSelectOptionsElement(select, options);
      const normalizedWarehouse = String(warehouseCode || input.value || select.value || "").trim().toUpperCase();
      select.value = options.includes(normalizedWarehouse) ? normalizedWarehouse : options[0];
      select.hidden = false;
      select.disabled = false;
      input.hidden = true;
      input.disabled = true;
      input.value = "";
      return;
    }
    select.hidden = true;
    select.disabled = true;
    input.hidden = false;
    input.disabled = false;
    input.value = warehouseCode || "";
  }

  function syncInlineWarehouseControl() {
    syncWarehouseControl({
      countrySelector: "#freight-rate-inline-country",
      selectSelector: "#freight-rate-inline-warehouse-select",
      inputSelector: "#freight-rate-inline-warehouse-code",
    });
  }

  function syncChannelElements({ country = "", select, channelName = "" } = {}) {
    if (!select) return;
    const options = channelOptionsForCountry(country);
    renderSelectOptionsElement(select, options);
    const normalizedChannel = String(channelName || select.value || "").trim();
    select.value = options.includes(normalizedChannel) ? normalizedChannel : (options[0] || "");
  }

  function syncInlineChannelControl() {
    syncChannelElements({
      country: value("#freight-rate-inline-country"),
      select: query("#freight-rate-inline-transport-method"),
    });
  }

  function syncInlineCountryControls() {
    syncInlineWarehouseControl();
    syncInlineChannelControl();
  }

  function resetInlineFreightRateEntry({ keepSelections = true } = {}) {
    const date = todayText();
    setOutput("#freight-rate-inline-date", date);
    setOutput("#freight-rate-inline-week", isoWeekFromDate(date) || "-");
    if (!keepSelections) {
      const country = query("#freight-rate-inline-country");
      if (country) country.value = freightRateOptions.countries[0] || "";
      const carrier = query("#freight-rate-inline-carrier");
      if (carrier) carrier.value = "九方通逊";
    }
    const warehouseCode = query("#freight-rate-inline-warehouse-code");
    if (warehouseCode) warehouseCode.value = "";
    syncInlineWarehouseControl();
    syncInlineChannelControl();
    const price = query("#freight-rate-inline-price");
    if (price) price.value = "";
  }

  function optionsHtml(values = [], selected = "", placeholder = "") {
    const selectedText = String(selected || "");
    return `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${values
      .map((item) => `<option value="${escapeHtml(item)}"${item === selectedText ? " selected" : ""}>${escapeHtml(item)}</option>`)
      .join("")}`;
  }

  function warehouseEditCellHtml(row = {}) {
    const options = warehouseOptionsForCountry(row.country);
    const warehouseCode = String(row.warehouseCode || "").trim().toUpperCase();
    const selectHidden = options.length > 0 ? "" : " hidden disabled";
    const inputHidden = options.length > 0 ? " hidden disabled" : "";
    return `
      <select class="table-select" ${tableCellControlStyle} aria-label="仓库代码选项" data-freight-rate-field="warehouseSelect"${selectHidden}>
        ${optionsHtml(options, warehouseCode)}
      </select>
      <input class="table-select" ${tableCellControlStyle} aria-label="仓库代码" placeholder="手填仓库" data-freight-rate-field="warehouseCode" value="${escapeHtml(options.length > 0 ? "" : warehouseCode)}"${inputHidden} />
    `;
  }

  function rowOperator(row = {}) {
    return row.operator || row.updatedBy || row.createdBy || "-";
  }

  function editRowHtml(row = {}) {
    return `
      <tr data-freight-rate-edit-row="${escapeHtml(row.id || "")}">
        <td><output class="table-select" style="display: inline-flex; align-items: center; white-space: nowrap; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box" data-freight-rate-field="week">${escapeHtml(row.week || "-")}</output></td>
        <td><input class="table-select" ${tableCellControlStyle} type="date" data-freight-rate-field="date" value="${escapeHtml(row.date || todayText())}" /></td>
        <td><select class="table-select" ${tableCellControlStyle} aria-label="国家" data-freight-rate-field="country">${optionsHtml(freightRateOptions.countries, row.country)}</select></td>
        <td>${warehouseEditCellHtml(row)}</td>
        <td><select class="table-select" ${tableCellControlStyle} aria-label="承运商" data-freight-rate-field="carrier">${optionsHtml(freightRateOptions.carriers, row.carrier || "九方通逊")}</select></td>
        <td><select class="table-select" ${tableCellChannelStyle} aria-label="渠道名称" data-freight-rate-field="transportMethod">${optionsHtml(channelOptionsForCountry(row.country), row.transportMethod)}</select></td>
        <td><input class="table-select" ${tableCellControlStyle} type="number" min="0" step="0.0001" aria-label="价格" data-freight-rate-field="price" value="${escapeHtml(row.price ?? "")}" /></td>
        <td>${escapeHtml(rowOperator(row))}</td>
        <td class="table-actions">
          <button class="primary-button compact-button" type="button" data-freight-rate-edit-save="${escapeHtml(row.id || "")}">保存</button>
          <button class="secondary-button compact-button" type="button" data-freight-rate-edit-cancel>取消</button>
          <button class="secondary-button compact-button" type="button" data-freight-rate-delete="${escapeHtml(row.id || "")}">删除</button>
        </td>
      </tr>`;
  }

  function groupedRowsHtml(rows = []) {
    let currentWeek = "";
    return rows.map((row) => {
      const group = row.week !== currentWeek
        ? (() => {
            currentWeek = row.week;
            const count = rows.filter((item) => item.week === row.week).length;
            return `<tr class="freight-rate-week-divider"><td colspan="9"><strong>${escapeHtml(row.week)}</strong><small> ${count} 条</small></td></tr>`;
          })()
        : "";
      if (editingFreightRateId && row.id === editingFreightRateId) return `${group}${editRowHtml(row)}`;
      return `${group}
        <tr>
          <td><strong>${escapeHtml(row.week || "-")}</strong></td>
          <td>${escapeHtml(row.date || "-")}</td>
          <td>${escapeHtml(row.country || "-")}</td>
          <td>${escapeHtml(row.warehouseCode || "-")}</td>
          <td>${escapeHtml(row.carrier || "-")}</td>
          <td>${escapeHtml(row.transportMethod || "-")}</td>
          <td>${escapeHtml(row.price ?? "-")}</td>
          <td>${escapeHtml(rowOperator(row))}</td>
          <td class="table-actions">
            <button class="secondary-button compact-button" type="button" data-freight-rate-edit="${escapeHtml(row.id)}">编辑</button>
            <button class="secondary-button compact-button" type="button" data-freight-rate-delete="${escapeHtml(row.id)}">删除</button>
          </td>
        </tr>`;
    }).join("");
  }

  function renderFreightRateRows() {
    const table = query("#freight-rates-table");
    if (!table) return;
    setText("#freight-rates-count", `共 ${freightRateRows.length} 条`, root);
    if (!freightRateRows.length) {
      renderTableMessage(table, 9, "暂无运费记录，可直接在第一行录入。", root, { tone: "empty" });
      return;
    }
    table.innerHTML = groupedRowsHtml(freightRateRows);
  }

  function buildFreightRateQuery() {
    const params = new URLSearchParams();
    return params;
  }

  function filenameFromDisposition(response, fallback) {
    const disposition = response.headers?.get?.("content-disposition") || "";
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    return plainMatch ? plainMatch[1] : fallback;
  }

  async function loadFreightRatesDashboard() {
    setFreightRateStatus("正在读取运费看板");
    try {
      const queryText = buildFreightRateQuery().toString();
      const response = await fetchImpl(`/api/fba/freight-rates${queryText ? `?${queryText}` : ""}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      freightRateRows = Array.isArray(data.rows) ? data.rows : [];
      freightRateOptions = data.options || freightRateOptions;
      editingFreightRateId = "";
      freightRatesLoaded = true;
      renderFreightRateOptions();
      resetInlineFreightRateEntry();
      renderFreightRateRows();
      setFreightRateStatus(`已读取 ${freightRateRows.length} 条运费记录`);
    } catch (error) {
      freightRateRows = [];
      renderFreightRateRows();
      setFreightRateStatus(`读取失败：${error.message || error}`);
    }
  }

  async function exportFreightRateLogs() {
    setFreightRateStatus("正在导出操作日志");
    try {
      const response = await fetchImpl("/api/fba/freight-rates/logs/export");
      const blob = await response.blob();
      if (!response.ok) {
        const message = await blob.text().catch(() => "");
        throw new Error(message || `API ${response.status}`);
      }
      downloadBlob(blob, filenameFromDisposition(response, `运费看板操作日志-${todayText()}.csv`), root);
      setFreightRateStatus("操作日志已导出");
    } catch (error) {
      setFreightRateStatus(`导出日志失败：${error.message || error}`);
    }
  }

  function inlineFreightRatePayload() {
    return {
      date: outputValue("#freight-rate-inline-date"),
      country: value("#freight-rate-inline-country"),
      warehouseCode: warehouseControlValue("#freight-rate-inline-warehouse-select", "#freight-rate-inline-warehouse-code"),
      carrier: value("#freight-rate-inline-carrier"),
      transportMethod: value("#freight-rate-inline-transport-method"),
      price: value("#freight-rate-inline-price"),
    };
  }

  function warehouseControlValue(selectSelector, inputSelector) {
    const select = query(selectSelector);
    if (select && !select.disabled && !select.hidden) return String(select.value || "").trim();
    return value(inputSelector);
  }

  async function saveInlineFreightRate() {
    setFreightRateStatus("正在保存运费记录");
    try {
      const response = await fetchImpl("/api/fba/freight-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inlineFreightRatePayload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || `API ${response.status}`);
      resetInlineFreightRateEntry();
      await loadFreightRatesDashboard();
    } catch (error) {
      setFreightRateStatus(`保存失败：${error.message || error}`);
    }
  }

  function editFieldValue(rowElement, field) {
    const element = rowElement?.querySelector?.(`[data-freight-rate-field="${field}"]`);
    if (!element) throw new Error(`编辑行缺少字段：${field}`);
    return String(element.value || element.textContent || "").trim();
  }

  function editWarehouseValue(rowElement) {
    const select = rowElement?.querySelector?.('[data-freight-rate-field="warehouseSelect"]');
    const input = rowElement?.querySelector?.('[data-freight-rate-field="warehouseCode"]');
    if (select && !select.disabled && !select.hidden) return String(select.value || "").trim();
    if (!input) throw new Error("编辑行缺少字段：warehouseCode");
    return String(input.value || "").trim();
  }

  function editFreightRatePayload(rowElement) {
    return {
      date: editFieldValue(rowElement, "date"),
      country: editFieldValue(rowElement, "country"),
      warehouseCode: editWarehouseValue(rowElement),
      carrier: editFieldValue(rowElement, "carrier"),
      transportMethod: editFieldValue(rowElement, "transportMethod"),
      price: editFieldValue(rowElement, "price"),
    };
  }

  function startInlineEdit(id) {
    editingFreightRateId = String(id || "").trim();
    renderFreightRateRows();
    setFreightRateStatus(editingFreightRateId ? "正在编辑运费记录" : `已读取 ${freightRateRows.length} 条运费记录`);
  }

  function syncEditWarehouseControl(rowElement, warehouseCode = "") {
    const country = rowElement?.querySelector?.('[data-freight-rate-field="country"]')?.value || "";
    const select = rowElement?.querySelector?.('[data-freight-rate-field="warehouseSelect"]');
    const input = rowElement?.querySelector?.('[data-freight-rate-field="warehouseCode"]');
    syncWarehouseElements({ country, select, input, warehouseCode });
  }

  function syncEditChannelControl(rowElement, channelName = "") {
    const country = rowElement?.querySelector?.('[data-freight-rate-field="country"]')?.value || "";
    const select = rowElement?.querySelector?.('[data-freight-rate-field="transportMethod"]');
    syncChannelElements({ country, select, channelName });
  }

  function updateEditWeekPreview(rowElement) {
    const week = rowElement?.querySelector?.('[data-freight-rate-field="week"]');
    const date = rowElement?.querySelector?.('[data-freight-rate-field="date"]');
    if (!week || !date) return;
    week.textContent = isoWeekFromDate(date.value) || "-";
    if ("value" in week) week.value = week.textContent;
  }

  async function saveInlineEdit(id, rowElement) {
    const targetId = String(id || "").trim();
    if (!targetId) throw new Error("运费记录 ID 不能为空。");
    setFreightRateStatus("正在保存运费记录");
    try {
      const response = await fetchImpl(`/api/fba/freight-rates/${encodeURIComponent(targetId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editFreightRatePayload(rowElement)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || `API ${response.status}`);
      editingFreightRateId = "";
      await loadFreightRatesDashboard();
    } catch (error) {
      setFreightRateStatus(`保存失败：${error.message || error}`);
    }
  }

  async function deleteFreightRateById(id) {
    const targetId = String(id || "").trim();
    if (!targetId || !windowApi?.confirm?.("确定删除这条运费记录？")) return;
    try {
      const response = await fetchImpl(`/api/fba/freight-rates/${encodeURIComponent(targetId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || `API ${response.status}`);
      editingFreightRateId = "";
      await loadFreightRatesDashboard();
    } catch (error) {
      setFreightRateStatus(`删除失败：${error.message || error}`);
    }
  }

  function setupFreightRatesDashboard() {
    bind(root, "#freight-rates-refresh", "click", loadFreightRatesDashboard);
    bind(root, "#freight-rates-export-logs", "click", exportFreightRateLogs);
    bind(root, "#freight-rate-inline-save", "click", saveInlineFreightRate);
    bind(root, "#freight-rate-inline-country", "change", syncInlineCountryControls);
    bind(root, "#freight-rates-table", "click", (event) => {
      const editButton = closestTarget(event, "[data-freight-rate-edit]");
      if (editButton) {
        startInlineEdit(editButton.dataset.freightRateEdit);
        return;
      }
      const saveButton = closestTarget(event, "[data-freight-rate-edit-save]");
      if (saveButton) {
        saveInlineEdit(saveButton.dataset.freightRateEditSave, closestTarget(event, "[data-freight-rate-edit-row]"));
        return;
      }
      const cancelButton = closestTarget(event, "[data-freight-rate-edit-cancel]");
      if (cancelButton) {
        editingFreightRateId = "";
        renderFreightRateRows();
        setFreightRateStatus(`已读取 ${freightRateRows.length} 条运费记录`);
        return;
      }
      const deleteButton = closestTarget(event, "[data-freight-rate-delete]");
      if (!deleteButton) return;
      deleteFreightRateById(deleteButton.dataset.freightRateDelete);
    });
    bind(root, "#freight-rates-table", "change", (event) => {
      const rowElement = closestTarget(event, "[data-freight-rate-edit-row]");
      if (!rowElement) return;
      if (closestTarget(event, '[data-freight-rate-field="country"]')) {
        syncEditWarehouseControl(rowElement);
        syncEditChannelControl(rowElement);
      }
      if (closestTarget(event, '[data-freight-rate-field="date"]')) updateEditWeekPreview(rowElement);
    });
  }

  async function loadFreightRatesInitial() {
    renderFreightRateOptions();
    resetInlineFreightRateEntry({ keepSelections: false });
    if (!freightRatesLoaded) await loadFreightRatesDashboard();
    else renderFreightRateRows();
  }

  return {
    loadFreightRatesDashboard,
    loadFreightRatesInitial,
    setupFreightRatesDashboard,
  };
}

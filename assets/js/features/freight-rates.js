export function createFreightRatesFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  renderTableMessage,
  setModalOpenState,
  setText,
  windowApi = globalThis.window,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFreightRatesFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFreightRatesFeature requires fetch.");

  let freightRateRows = [];
  let freightRateOptions = {
    countries: ["美国", "加拿大", "澳洲", "德国", "英国"],
    carriers: ["九方通逊", "同袍"],
    transportMethods: ["普船", "快船", "空运", "快递"],
  };
  let editingFreightRateId = "";
  let freightRatesLoaded = false;

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
    const previous = select.value;
    select.innerHTML = `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${values
      .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
      .join("")}`;
    if (previous && values.includes(previous)) select.value = previous;
  }

  function renderFreightRateOptions() {
    renderSelectOptions("#freight-rate-inline-country", freightRateOptions.countries);
    renderSelectOptions("#freight-rate-country", freightRateOptions.countries);
    renderSelectOptions("#freight-rate-inline-carrier", freightRateOptions.carriers);
    renderSelectOptions("#freight-rate-carrier", freightRateOptions.carriers);
    renderSelectOptions("#freight-rate-inline-transport-method", freightRateOptions.transportMethods);
    renderSelectOptions("#freight-rate-transport-method", freightRateOptions.transportMethods);
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
      const transportMethod = query("#freight-rate-inline-transport-method");
      if (transportMethod) transportMethod.value = "普船";
    }
    const warehouseCode = query("#freight-rate-inline-warehouse-code");
    if (warehouseCode) warehouseCode.value = "";
    const price = query("#freight-rate-inline-price");
    if (price) price.value = "";
  }

  function groupedRowsHtml(rows = []) {
    let currentWeek = "";
    return rows.map((row) => {
      const group = row.week !== currentWeek
        ? (() => {
            currentWeek = row.week;
            const count = rows.filter((item) => item.week === row.week).length;
            return `<tr class="freight-rate-week-divider"><td colspan="8"><strong>${escapeHtml(row.week)}</strong><small> ${count} 条</small></td></tr>`;
          })()
        : "";
      return `${group}
        <tr>
          <td><strong>${escapeHtml(row.week || "-")}</strong></td>
          <td>${escapeHtml(row.date || "-")}</td>
          <td>${escapeHtml(row.country || "-")}</td>
          <td>${escapeHtml(row.warehouseCode || "-")}</td>
          <td>${escapeHtml(row.carrier || "-")}</td>
          <td>${escapeHtml(row.transportMethod || "-")}</td>
          <td>${escapeHtml(row.price ?? "-")}</td>
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
      renderTableMessage(table, 8, "暂无运费记录，可直接在第一行录入。");
      return;
    }
    table.innerHTML = groupedRowsHtml(freightRateRows);
  }

  function buildFreightRateQuery() {
    const params = new URLSearchParams();
    return params;
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

  function updateWeekPreview() {
    setText("#freight-rate-week-preview", isoWeekFromDate(value("#freight-rate-date")) || "-", root);
  }

  function openFreightRateModal(row = {}) {
    editingFreightRateId = String(row.id || "");
    setText("#freight-rate-modal-title", editingFreightRateId ? "编辑运费" : "新增运费", root);
    const fields = {
      "#freight-rate-date": row.date || todayText(),
      "#freight-rate-country": row.country || "",
      "#freight-rate-warehouse-code": row.warehouseCode || "",
      "#freight-rate-carrier": row.carrier || "九方通逊",
      "#freight-rate-transport-method": row.transportMethod || "普船",
      "#freight-rate-price": row.price ?? "",
    };
    Object.entries(fields).forEach(([selector, fieldValue]) => {
      const element = query(selector);
      if (element) element.value = fieldValue;
    });
    updateWeekPreview();
    const deleteButton = query("#freight-rate-delete");
    if (deleteButton) deleteButton.hidden = !editingFreightRateId;
    setModalOpenState(query("#freight-rate-modal"), true);
  }

  function closeFreightRateModal() {
    setModalOpenState(query("#freight-rate-modal"), false);
    editingFreightRateId = "";
  }

  function freightRatePayload() {
    return {
      date: value("#freight-rate-date"),
      country: value("#freight-rate-country"),
      warehouseCode: value("#freight-rate-warehouse-code"),
      carrier: value("#freight-rate-carrier"),
      transportMethod: value("#freight-rate-transport-method"),
      price: value("#freight-rate-price"),
    };
  }

  function inlineFreightRatePayload() {
    return {
      date: outputValue("#freight-rate-inline-date"),
      country: value("#freight-rate-inline-country"),
      warehouseCode: value("#freight-rate-inline-warehouse-code"),
      carrier: value("#freight-rate-inline-carrier"),
      transportMethod: value("#freight-rate-inline-transport-method"),
      price: value("#freight-rate-inline-price"),
    };
  }

  async function saveFreightRateForm(event) {
    event.preventDefault();
    const url = editingFreightRateId ? `/api/fba/freight-rates/${encodeURIComponent(editingFreightRateId)}` : "/api/fba/freight-rates";
    const method = editingFreightRateId ? "PUT" : "POST";
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(freightRatePayload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || `API ${response.status}`);
      closeFreightRateModal();
      await loadFreightRatesDashboard();
    } catch (error) {
      setFreightRateStatus(`保存失败：${error.message || error}`);
    }
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

  async function deleteFreightRateById(id) {
    const targetId = String(id || "").trim();
    if (!targetId || !windowApi?.confirm?.("确定删除这条运费记录？")) return;
    try {
      const response = await fetchImpl(`/api/fba/freight-rates/${encodeURIComponent(targetId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || `API ${response.status}`);
      closeFreightRateModal();
      await loadFreightRatesDashboard();
    } catch (error) {
      setFreightRateStatus(`删除失败：${error.message || error}`);
    }
  }

  function setupFreightRatesDashboard() {
    bind(root, "#freight-rates-refresh", "click", loadFreightRatesDashboard);
    bind(root, "#freight-rate-inline-save", "click", saveInlineFreightRate);
    bind(root, "#freight-rate-form", "submit", saveFreightRateForm);
    bind(root, "#freight-rate-date", "change", updateWeekPreview);
    bind(root, "#freight-rate-close", "click", closeFreightRateModal);
    bind(root, "#freight-rate-cancel", "click", closeFreightRateModal);
    bind(root, "#freight-rate-delete", "click", () => deleteFreightRateById(editingFreightRateId));
    bind(root, "#freight-rates-table", "click", (event) => {
      const editButton = closestTarget(event, "[data-freight-rate-edit]");
      if (editButton) {
        const row = freightRateRows.find((item) => item.id === editButton.dataset.freightRateEdit);
        if (row) openFreightRateModal(row);
        return;
      }
      const deleteButton = closestTarget(event, "[data-freight-rate-delete]");
      if (!deleteButton) return;
      deleteFreightRateById(deleteButton.dataset.freightRateDelete);
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

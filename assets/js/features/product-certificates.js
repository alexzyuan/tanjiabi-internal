export function createProductCertificatesFeature({
  root = globalThis.document,
  bind,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  readFileAsBase64,
  refreshTable,
  setButtonBusy,
  setStatusMessage,
} = {}) {
  if (typeof bind !== "function") throw new Error("createProductCertificatesFeature requires bind.");
  if (typeof escapeHtml !== "function") throw new Error("createProductCertificatesFeature requires escapeHtml.");
  if (typeof fetchImpl !== "function") throw new Error("createProductCertificatesFeature requires fetchImpl.");
  if (typeof readFileAsBase64 !== "function") throw new Error("createProductCertificatesFeature requires readFileAsBase64.");
  if (typeof refreshTable !== "function") throw new Error("createProductCertificatesFeature requires refreshTable.");

  let certificateData = { rows: [], summary: {}, filters: {} };
  let initialized = false;
  const query = (selector) => root?.querySelector?.(selector);

  function setText(selector, value) {
    const element = query(selector);
    if (element) element.textContent = String(value ?? "");
  }

  function setStatus(selector, message, tone = "") {
    setStatusMessage(selector, message, tone, root);
  }

  function statusClass(status) {
    return { "有效": "active", "预警": "warning", "注意": "info", "已过期": "danger" }[status] || "muted";
  }

  function filteredRows() {
    const country = query("#certificate-country-filter")?.value || "";
    const type = query("#certificate-type-filter")?.value || "";
    const status = query("#certificate-status-filter")?.value || "";
    const keyword = (query("#certificate-keyword-filter")?.value || "").trim().toLocaleLowerCase("en-US");
    return (certificateData.rows || []).filter((row) => {
      if (country && row.country !== country) return false;
      if (type && row.certificateType !== type) return false;
      if (status && row.status !== status) return false;
      return !keyword || `${row.productSku || ""} ${row.certificateNumber || ""}`.toLocaleLowerCase("en-US").includes(keyword);
    });
  }

  function selectOptions(selector, values, placeholder) {
    const select = query(selector);
    if (!select) return;
    const selected = select.value;
    select.innerHTML = [`<option value="">${escapeHtml(placeholder)}</option>`, ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
    if (values.includes(selected)) select.value = selected;
  }

  function renderSummary() {
    const summary = certificateData.summary || {};
    setText("#certificate-valid-count", summary.valid || 0);
    setText("#certificate-warning-count", summary.warning || 0);
    setText("#certificate-attention-count", summary.attention || 0);
    setText("#certificate-expired-count", summary.expired || 0);
  }

  function renderCertificates() {
    selectOptions("#certificate-country-filter", certificateData.filters?.countries || [], "全部国家");
    selectOptions("#certificate-type-filter", certificateData.filters?.certificateTypes || [], "全部类型");
    renderSummary();
    const rows = filteredRows();
    const body = query("#certificate-table-body");
    if (body) body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.country)}</td><td><strong>${escapeHtml(row.productSku)}</strong></td><td>${escapeHtml(row.certificateType)}</td><td>${escapeHtml(row.certificateNumber)}</td><td>${escapeHtml(row.issuedDate || "-")}</td><td>${escapeHtml(row.expiryDate)}</td><td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td><td class="table-actions"><button class="table-action" type="button" data-certificate-edit="${escapeHtml(row.id)}">编辑</button><button class="table-action danger" type="button" data-certificate-delete="${escapeHtml(row.id)}">删除</button></td></tr>`).join("") : '<tr><td colspan="8">暂无匹配的证书记录。</td></tr>';
    setText("#certificate-table-count", `共 ${rows.length} 条记录`);
    refreshTable(query("#certificate-table"));
  }

  async function parseResponse(response) {
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `请求失败（${response.status}）`);
    return data;
  }

  async function loadProductCertificates() {
    setStatus("#certificate-status", "正在读取证书台账。");
    try {
      certificateData = await parseResponse(await fetchImpl("/api/product-certificates"));
      setStatus("#certificate-status", `已加载 ${certificateData.rows?.length || 0} 条证书记录。`, "success");
    } catch (error) {
      certificateData = { rows: [], summary: {}, filters: {} };
      setStatus("#certificate-status", `读取失败：${error.message}`, "danger");
      console.error("[product-certificates] load failed", error);
    }
    renderCertificates();
  }

  function formValue(selector) { return query(selector)?.value?.trim?.() || ""; }

  function openEditor(row = null) {
    const dialog = query("#certificate-editor-dialog");
    query("#certificate-editor-form")?.reset();
    setText("#certificate-editor-title", row ? "编辑证书" : "新增证书");
    const values = [["#certificate-editor-id", row?.id], ["#certificate-editor-country", row?.country], ["#certificate-editor-product-sku", row?.productSku], ["#certificate-editor-type", row?.certificateType], ["#certificate-editor-number", row?.certificateNumber], ["#certificate-editor-issued-date", row?.issuedDate], ["#certificate-editor-expiry-date", row?.expiryDate]];
    values.forEach(([selector, value]) => { const field = query(selector); if (field) field.value = value || ""; });
    setStatus("#certificate-editor-status", "");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(selector) { query(selector)?.close(); }

  function editorPayload() {
    return { country: formValue("#certificate-editor-country"), productSku: formValue("#certificate-editor-product-sku"), certificateType: formValue("#certificate-editor-type"), certificateNumber: formValue("#certificate-editor-number"), issuedDate: formValue("#certificate-editor-issued-date"), expiryDate: formValue("#certificate-editor-expiry-date") };
  }

  async function saveEditor(event) {
    event.preventDefault();
    const id = formValue("#certificate-editor-id");
    const button = query("#certificate-editor-save");
    setButtonBusy(button, true);
    try {
      await parseResponse(await fetchImpl(id ? `/api/product-certificates/${encodeURIComponent(id)}` : "/api/product-certificates", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editorPayload()) }));
      closeDialog("#certificate-editor-dialog");
      await loadProductCertificates();
    } catch (error) {
      setStatus("#certificate-editor-status", error.message, "danger");
    } finally { setButtonBusy(button, false); }
  }

  async function removeCertificate(id) {
    if (!globalThis.confirm?.("确定删除这条证书记录吗？")) return;
    try {
      await parseResponse(await fetchImpl(`/api/product-certificates/${encodeURIComponent(id)}`, { method: "DELETE" }));
      await loadProductCertificates();
    } catch (error) { setStatus("#certificate-status", `删除失败：${error.message}`, "danger"); }
  }

  async function submitImport(event) {
    event.preventDefault();
    const file = query("#certificate-import-file")?.files?.[0];
    const button = query("#certificate-import-submit");
    if (!file) { setStatus("#certificate-import-status", "请选择 .xlsx 文件。", "danger"); return; }
    setButtonBusy(button, true);
    try {
      const base64 = await readFileAsBase64(file);
      const result = await parseResponse(await fetchImpl("/api/product-certificates/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, base64 }) }));
      closeDialog("#certificate-import-dialog");
      await loadProductCertificates();
      setStatus("#certificate-status", `导入完成：${result.result?.importedCount || 0} 条。`, "success");
    } catch (error) { setStatus("#certificate-import-status", error.message, "danger"); } finally { setButtonBusy(button, false); }
  }

  function setupProductCertificates() {
    if (initialized) return;
    initialized = true;
    bind(root, "#certificate-add-button", "click", () => openEditor());
    bind(root, "#certificate-import-button", "click", () => { query("#certificate-import-form")?.reset(); setStatus("#certificate-import-status", ""); query("#certificate-import-dialog")?.showModal(); });
    bind(root, "#certificate-editor-form", "submit", saveEditor);
    bind(root, "#certificate-import-form", "submit", submitImport);
    ["#certificate-editor-close", "#certificate-editor-cancel"].forEach((selector) => bind(root, selector, "click", () => closeDialog("#certificate-editor-dialog")));
    ["#certificate-import-close", "#certificate-import-cancel"].forEach((selector) => bind(root, selector, "click", () => closeDialog("#certificate-import-dialog")));
    ["#certificate-country-filter", "#certificate-type-filter", "#certificate-status-filter", "#certificate-keyword-filter"].forEach((selector) => bind(root, selector, "input", renderCertificates));
    bind(root, "#certificate-filter-reset", "click", () => { ["#certificate-country-filter", "#certificate-type-filter", "#certificate-status-filter", "#certificate-keyword-filter"].forEach((selector) => { const element = query(selector); if (element) element.value = ""; }); renderCertificates(); });
    bind(root, "#certificate-table-body", "click", (event) => { const button = event.target.closest("button[data-certificate-edit], button[data-certificate-delete]"); if (!button) return; const id = button.dataset.certificateEdit || button.dataset.certificateDelete; const row = certificateData.rows.find((item) => item.id === id); if (button.dataset.certificateEdit) openEditor(row); else removeCertificate(id); });
  }

  return { loadProductCertificates, setupProductCertificates };
}

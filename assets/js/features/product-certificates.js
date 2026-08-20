const CERTIFICATE_COUNTRIES = ["美国", "加拿大", "德国", "英国"];
const CERTIFICATE_TYPES_BY_COUNTRY = {
  美国: ["CPC全套"],
  加拿大: ["CCPSA"],
  德国: ["EN71 + 62115"],
  英国: ["EN71 + 62115"],
};

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
  let certificateOptionData = { countries: CERTIFICATE_COUNTRIES, certificateTypes: [], productSkus: [] };
  let recommendedCertificateTypes = [];
  let selectedProductSku = "";
  let skuSearchTimer = null;
  let skuSearchRequest = 0;
  let skuDropdownCloseTimer = null;
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

  function localCertificateTypes(country = "") {
    return country && CERTIFICATE_TYPES_BY_COUNTRY[country]
      ? [...CERTIFICATE_TYPES_BY_COUNTRY[country]]
      : [...new Set(Object.values(CERTIFICATE_TYPES_BY_COUNTRY).flat())];
  }

  function renderCertificateTypeOptions(country = "", { resetType = false } = {}) {
    const datalist = query("#certificate-editor-type-options");
    const typeField = query("#certificate-editor-type");
    if (!datalist) return;
    const previousTypes = recommendedCertificateTypes;
    const apiTypes = certificateOptionData.certificateTypes || [];
    const types = country && CERTIFICATE_TYPES_BY_COUNTRY[country]
      ? localCertificateTypes(country)
      : (apiTypes.length ? apiTypes : localCertificateTypes(country));
    recommendedCertificateTypes = [...new Set(types.map((value) => String(value).trim()).filter(Boolean))];
    datalist.innerHTML = recommendedCertificateTypes.map((value) => `<option value="${escapeHtml(value)}">`).join("");
    if (resetType && typeField && (!typeField.value.trim() || previousTypes.includes(typeField.value.trim()))) {
      typeField.value = recommendedCertificateTypes[0] || "";
    }
  }

  function setSkuDropdownOpen(open) {
    const input = query("#certificate-editor-product-sku");
    const listbox = query("#certificate-editor-product-sku-options");
    if (!input || !listbox) return;
    input.setAttribute("aria-autocomplete", "list");
    const shouldOpen = Boolean(open && listbox.querySelector("[data-certificate-sku-option]"));
    listbox.hidden = !shouldOpen;
    input.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }

  function renderSkuOptions(rows = [], { open = false } = {}) {
    const listbox = query("#certificate-editor-product-sku-options");
    if (!listbox) return;
    const unique = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const sku = String(row?.sku || "").trim();
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      unique.push({ sku, productName: String(row?.productName || "").trim() });
    }
    listbox.innerHTML = unique.length
      ? unique.map((row) => `<button class="search-result-item" type="button" role="option" data-certificate-sku-option="${escapeHtml(row.sku)}"><strong>${escapeHtml(row.sku)}</strong>${row.productName ? ` <span>${escapeHtml(row.productName)}</span>` : ""}</button>`).join("")
      : "";
    setSkuDropdownOpen(open && unique.length > 0);
  }

  async function loadCertificateOptions({ country = "", keyword = "", renderTypes = true } = {}) {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (keyword) params.set("keyword", keyword);
    const queryString = params.toString();
    const data = await parseResponse(await fetchImpl(`/api/product-certificates/options${queryString ? `?${queryString}` : ""}`));
    if (!Array.isArray(data.countries) || !Array.isArray(data.certificateTypes) || !Array.isArray(data.productSkus)) {
      throw new Error("证书选项接口返回数据无效。");
    }
    certificateOptionData = data;
    if (renderTypes) renderCertificateTypeOptions(country);
    return data;
  }

  async function loadSkuSuggestions({ open = true } = {}) {
    const request = ++skuSearchRequest;
    const country = query("#certificate-editor-country")?.value || "";
    const keyword = query("#certificate-editor-product-sku")?.value?.trim?.() || "";
    try {
      const data = await loadCertificateOptions({ country, keyword, renderTypes: false });
      if (request !== skuSearchRequest) return;
      renderSkuOptions(data.productSkus, { open });
    } catch (error) {
      if (request !== skuSearchRequest) return;
      renderSkuOptions([]);
      setStatus("#certificate-editor-status", `SKU 选项读取失败：${error.message}`, "danger");
    }
  }

  function scheduleSkuSuggestions({ open = true } = {}) {
    if (skuSearchTimer !== null) globalThis.clearTimeout?.(skuSearchTimer);
    skuSearchTimer = globalThis.setTimeout(() => {
      skuSearchTimer = null;
      void loadSkuSuggestions({ open });
    }, 180);
  }

  function selectSku(sku) {
    const input = query("#certificate-editor-product-sku");
    if (!input) return;
    input.value = sku;
    selectedProductSku = sku;
    setSkuDropdownOpen(false);
    input.focus();
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
    selectedProductSku = row?.productSku || "";
    setText("#certificate-editor-title", row ? "编辑证书" : "新增证书");
    const values = [["#certificate-editor-id", row?.id], ["#certificate-editor-country", row?.country], ["#certificate-editor-product-sku", row?.productSku], ["#certificate-editor-type", row?.certificateType], ["#certificate-editor-number", row?.certificateNumber], ["#certificate-editor-issued-date", row?.issuedDate], ["#certificate-editor-expiry-date", row?.expiryDate]];
    values.forEach(([selector, value]) => { const field = query(selector); if (field) field.value = value || ""; });
    renderCertificateTypeOptions(row?.country || "", { resetType: !row });
    renderSkuOptions([], { open: false });
    setStatus("#certificate-editor-status", "");
    if (dialog && !dialog.open) dialog.showModal();
    void loadCertificateOptions({ country: row?.country || "", keyword: "", renderTypes: true }).catch((error) => {
      setStatus("#certificate-editor-status", `证书选项读取失败：${error.message}`, "danger");
    });
  }

  function closeDialog(selector) { query(selector)?.close(); }

  function editorPayload() {
    const productSku = formValue("#certificate-editor-product-sku");
    if (!productSku || selectedProductSku !== productSku) throw new Error("请从产品管理搜索结果中选择产品 SKU。");
    const country = formValue("#certificate-editor-country");
    if (!CERTIFICATE_COUNTRIES.includes(country)) throw new Error("请选择有效国家。");
    return { country, productSku, certificateType: formValue("#certificate-editor-type"), certificateNumber: formValue("#certificate-editor-number"), issuedDate: formValue("#certificate-editor-issued-date"), expiryDate: formValue("#certificate-editor-expiry-date") };
  }

  async function saveEditor(event) {
    event.preventDefault();
    const button = query("#certificate-editor-save");
    setButtonBusy(button, true);
    try {
      const id = formValue("#certificate-editor-id");
      const payload = editorPayload();
      await parseResponse(await fetchImpl(id ? `/api/product-certificates/${encodeURIComponent(id)}` : "/api/product-certificates", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
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
    bind(root, "#certificate-editor-country", "change", () => {
      renderCertificateTypeOptions(formValue("#certificate-editor-country"), { resetType: true });
      scheduleSkuSuggestions({ open: false });
    });
    bind(root, "#certificate-editor-product-sku", "input", () => {
      const value = formValue("#certificate-editor-product-sku");
      if (value !== selectedProductSku) selectedProductSku = "";
      scheduleSkuSuggestions({ open: true });
    });
    bind(root, "#certificate-editor-product-sku", "focus", () => scheduleSkuSuggestions({ open: true }));
    bind(root, "#certificate-editor-product-sku", "keydown", (event) => {
      if (event.key === "Escape") setSkuDropdownOpen(false);
      if (event.key === "ArrowDown") {
        const option = query("#certificate-editor-product-sku-options [data-certificate-sku-option]");
        if (option) { event.preventDefault(); option.focus(); }
      }
    });
    bind(root, "#certificate-editor-product-sku", "blur", () => {
      if (skuDropdownCloseTimer !== null) globalThis.clearTimeout?.(skuDropdownCloseTimer);
      skuDropdownCloseTimer = globalThis.setTimeout(() => setSkuDropdownOpen(false), 120);
    });
    bind(root, "#certificate-editor-product-sku-options", "click", (event) => {
      const option = event.target?.closest?.("[data-certificate-sku-option]");
      if (option) selectSku(option.dataset.certificateSkuOption || "");
    });
    bind(root, "#certificate-table-body", "click", (event) => { const button = event.target.closest("button[data-certificate-edit], button[data-certificate-delete]"); if (!button) return; const id = button.dataset.certificateEdit || button.dataset.certificateDelete; const row = certificateData.rows.find((item) => item.id === id); if (button.dataset.certificateEdit) openEditor(row); else removeCertificate(id); });
  }

  return { loadProductCertificates, setupProductCertificates };
}

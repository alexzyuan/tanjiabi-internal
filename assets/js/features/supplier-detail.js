export function createSupplierDetailFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  bindBackdropClose,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  readFileAsBase64,
  setText,
  trimmedFieldValue,
  windowApi = globalThis.window,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createSupplierDetailFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createSupplierDetailFeature requires bind.");
  if (typeof bindBackdropClose !== "function") throw new Error("createSupplierDetailFeature requires bindBackdropClose.");

  let supplierDetailData = { rows: [], summary: {}, options: {} };
  let editingSupplierDetailId = "";
  const supplierDetailColumns = [
    ["supplier", "供应商"],
    ["qualification", "供应商资质"],
    ["paymentTermType", "账期类型"],
    ["invoiceType", "开票类型"],
    ["taxRate", "税率"],
  ];

  function formatSupplierDetailTaxRate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "-";
  }

  function supplierDetailQuery() {
    const params = new URLSearchParams();
    const keyword = trimmedFieldValue("#supplier-detail-keyword", "", root);
    const qualification = fieldValue("#supplier-detail-qualification-filter", "", root);
    const paymentTermType = fieldValue("#supplier-detail-payment-filter", "", root);
    const invoiceType = fieldValue("#supplier-detail-invoice-filter", "", root);
    if (keyword) params.set("keyword", keyword);
    if (qualification) params.set("qualification", qualification);
    if (paymentTermType) params.set("paymentTermType", paymentTermType);
    if (invoiceType) params.set("invoiceType", invoiceType);
    return params.toString();
  }

  function fillSupplierDetailOptions() {
    const configs = [
      ["#supplier-detail-qualification-filter", supplierDetailData.options?.qualifications || [], "全部资质"],
      ["#supplier-detail-payment-filter", supplierDetailData.options?.paymentTermTypes || [], "全部账期"],
      ["#supplier-detail-invoice-filter", supplierDetailData.options?.invoiceTypes || [], "全部开票类型"],
    ];
    configs.forEach(([selector, options, placeholder]) => {
      const select = root?.querySelector?.(selector);
      if (!select) return;
      const current = select.value;
      select.innerHTML = [`<option value="">${placeholder}</option>`, ...options.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)].join("");
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    });
  }

  function renderSupplierDetail() {
    const rows = supplierDetailData.rows || [];
    fillSupplierDetailOptions();
    setText("#supplier-detail-count", formatActualMoney(supplierDetailData.summary?.supplierCount || 0), root);
    setText("#supplier-detail-qualification-count", formatActualMoney(supplierDetailData.summary?.qualificationCount || 0), root);
    setText("#supplier-detail-payment-count", formatActualMoney(supplierDetailData.summary?.paymentTermCount || 0), root);
    setText("#supplier-detail-invoice-count", formatActualMoney(supplierDetailData.summary?.invoiceTypeCount || 0), root);
    setText("#supplier-detail-table-count", `共 ${rows.length} 条数据`, root);
    const tbody = root?.querySelector?.("#supplier-detail-table tbody");
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.supplier || "-")}</strong></td>
        <td>${escapeHtml(row.qualification || "-")}</td>
        <td>${escapeHtml(row.paymentTermType || "-")}</td>
        <td>${escapeHtml(row.invoiceType || "-")}</td>
        <td>${formatSupplierDetailTaxRate(row.taxRate)}</td>
        <td><button class="table-action" type="button" data-supplier-detail-edit="${escapeHtml(row.id)}">编辑</button></td>
      </tr>
    `).join("") : `<tr><td colspan="6">暂无供应商明细，请手动填写或导入模板。</td></tr>`;
  }

  function handleSupplierDetailTableClick(event) {
    const button = closestTarget(event, "[data-supplier-detail-edit]");
    if (!button) return;
    const row = (supplierDetailData.rows || []).find((item) => item.id === button.dataset.supplierDetailEdit);
    openSupplierDetailModal(row);
  }

  async function loadSupplierDetail() {
    await loadDashboardSection({
      endpoint: `/api/purchase/supplier-details?${supplierDetailQuery()}`,
      statusSelector: "#supplier-detail-status",
      loadingStatus: "正在读取供应商明细",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || `API ${response.status}`,
      onData: (data) => {
        supplierDetailData = data;
        setText("#supplier-detail-status", `已加载 ${supplierDetailData.rows?.length || 0} 条`, root);
      },
      onError: (error) => {
        supplierDetailData = { rows: [], summary: {}, options: {} };
        setText("#supplier-detail-status", `读取失败：${error.message}`, root);
      },
      onFinally: renderSupplierDetail,
      root,
    });
  }

  function openSupplierDetailModal(row = null) {
    editingSupplierDetailId = row?.id || "";
    setText("#supplier-detail-modal-title", row ? "编辑供应商明细" : "新增供应商明细", root);
    const values = {
      "#supplier-detail-id": row?.id || "",
      "#supplier-detail-supplier": row?.supplier || "",
      "#supplier-detail-qualification": row?.qualification || "一般纳税人",
      "#supplier-detail-payment-term": row?.paymentTermType || "",
      "#supplier-detail-invoice-type": row?.invoiceType || "专票",
      "#supplier-detail-tax-rate": row?.taxRate !== null && row?.taxRate !== undefined ? formatSupplierDetailTaxRate(row.taxRate) : "",
    };
    Object.entries(values).forEach(([selector, value]) => {
      const element = root?.querySelector?.(selector);
      if (element) element.value = value;
    });
    const deleteButton = root?.querySelector?.("#supplier-detail-delete");
    if (deleteButton) deleteButton.hidden = !row;
    root?.querySelector?.("#supplier-detail-modal")?.removeAttribute("hidden");
    root?.body?.classList?.add("modal-open");
  }

  function closeSupplierDetailModal() {
    root?.querySelector?.("#supplier-detail-modal")?.setAttribute("hidden", "");
    root?.body?.classList?.remove("modal-open");
    editingSupplierDetailId = "";
  }

  function buildSupplierDetailPayload() {
    return {
      id: fieldValue("#supplier-detail-id", "", root),
      supplier: fieldValue("#supplier-detail-supplier", "", root),
      qualification: fieldValue("#supplier-detail-qualification", "", root),
      paymentTermType: fieldValue("#supplier-detail-payment-term", "", root),
      invoiceType: fieldValue("#supplier-detail-invoice-type", "", root),
      taxRate: fieldValue("#supplier-detail-tax-rate", "", root),
    };
  }

  async function saveSupplierDetailForm(event) {
    event.preventDefault();
    const payload = buildSupplierDetailPayload();
    const url = payload.id ? `/api/purchase/supplier-details/${encodeURIComponent(payload.id)}` : "/api/purchase/supplier-details";
    const method = payload.id ? "PUT" : "POST";
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      windowApi?.alert?.(result.error || "保存失败");
      return;
    }
    closeSupplierDetailModal();
    await loadSupplierDetail();
  }

  async function deleteCurrentSupplierDetail() {
    if (!editingSupplierDetailId || !windowApi?.confirm?.("确定删除这条供应商明细？")) return;
    const response = await fetch(`/api/purchase/supplier-details/${encodeURIComponent(editingSupplierDetailId)}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      windowApi?.alert?.(result.error || "删除失败");
      return;
    }
    closeSupplierDetailModal();
    await loadSupplierDetail();
  }

  function supplierDetailWorkbookHtml(rows) {
    const headerHtml = supplierDetailColumns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
    const rowsHtml = rows.map((row) => `<tr>${supplierDetailColumns.map(([key]) => `<td>${escapeHtml(key === "taxRate" ? formatSupplierDetailTaxRate(row[key]).replace("-", "") : row[key] || "")}</td>`).join("")}</tr>`).join("");
    return `<html><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
  }

  function downloadHtmlExcel(filename, html) {
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    downloadBlob(blob, filename, root);
  }

  function downloadSupplierDetailTemplate() {
    const rows = [{ supplier: "汕头市澄海区鹏翔玩具有限公司", qualification: "一般纳税人", paymentTermType: "2月结", invoiceType: "专票", taxRate: 0.13 }];
    downloadHtmlExcel("供应商明细导入模板.xls", supplierDetailWorkbookHtml(rows));
  }

  function exportSupplierDetail() {
    downloadHtmlExcel("供应商明细导出.xls", supplierDetailWorkbookHtml(supplierDetailData.rows || []));
  }

  async function importSupplierDetailFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setText("#supplier-detail-status", "只支持 .xlsx / .xls 文件", root);
      return;
    }
    setText("#supplier-detail-status", "正在导入表格", root);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const response = await fetch("/api/purchase/supplier-details/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "导入失败");
      setText("#supplier-detail-status", `导入成功：${result.result?.imported || 0} 条`, root);
      await loadSupplierDetail();
    } catch (error) {
      setText("#supplier-detail-status", `导入失败：${error.message}`, root);
    } finally {
      const input = root?.querySelector?.("#supplier-detail-file-input");
      if (input) input.value = "";
    }
  }

  function resetSupplierDetailFilters() {
    ["#supplier-detail-keyword", "#supplier-detail-qualification-filter", "#supplier-detail-payment-filter", "#supplier-detail-invoice-filter"].forEach((selector) => {
      const element = root?.querySelector?.(selector);
      if (element) element.value = "";
    });
    loadSupplierDetail();
  }

  function setupSupplierDetail() {
    bind(root, "#supplier-detail-open-modal", "click", () => openSupplierDetailModal());
    bind(root, "#supplier-detail-close-modal", "click", closeSupplierDetailModal);
    bindBackdropClose(root, "#supplier-detail-modal", closeSupplierDetailModal);
    bind(root, "#supplier-detail-table tbody", "click", handleSupplierDetailTableClick);
    bind(root, "#supplier-detail-form", "submit", saveSupplierDetailForm);
    bind(root, "#supplier-detail-delete", "click", deleteCurrentSupplierDetail);
    bind(root, "#supplier-detail-download-template", "click", downloadSupplierDetailTemplate);
    bind(root, "#supplier-detail-export", "click", exportSupplierDetail);
    bind(root, "#supplier-detail-file-input", "change", (event) => {
      importSupplierDetailFile(event.target.files?.[0]);
    });
    bind(root, "#supplier-detail-reset", "click", resetSupplierDetailFilters);
    bind(root, "#supplier-detail-keyword", "input", () => loadSupplierDetail());
    bind(root, "#supplier-detail-qualification-filter", "change", () => loadSupplierDetail());
    bind(root, "#supplier-detail-payment-filter", "change", () => loadSupplierDetail());
    bind(root, "#supplier-detail-invoice-filter", "change", () => loadSupplierDetail());
  }

  return {
    loadSupplierDetail,
    setupSupplierDetail,
  };
}

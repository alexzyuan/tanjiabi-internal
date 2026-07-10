export function createFbaFreightFeature({
  root = globalThis.document,
  bind,
  bindBackdropClose,
  cachedSalesImageUrl,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fallbackFbaShops = [],
  fbaValue,
  fetchImpl = globalThis.fetch,
  formatDate,
  formatNumber,
  getFbaShops,
  loadFbaShops,
  normalizeFbaShop,
  renderTableMessage,
  setModalOpenState,
  setText,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaFreightFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaFreightFeature requires fetch.");

  let fbaFreightRows = [];
  let fbaFreightLoaded = false;
  let fbaFreightTemplates = [];
  let selectedFbaFreightShipmentIds = new Set();
  let pendingFbaFreightConvertShipmentIds = [];

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function fbaFreightTodayDateText() {
    return formatDate(new Date());
  }

  function firstDayOfCurrentMonthText() {
    const now = new Date();
    return formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  function setDefaultFbaFreightDates() {
    const startInput = query("#fba-freight-start-date");
    const endInput = query("#fba-freight-end-date");
    if (startInput && !startInput.value) startInput.value = firstDayOfCurrentMonthText();
    if (endInput && !endInput.value) endInput.value = fbaFreightTodayDateText();
  }

  function renderFbaFreightShopOptions() {
    const select = query("#fba-freight-sid");
    if (!select) return;
    const previous = select.value;
    const currentShops = typeof getFbaShops === "function" ? getFbaShops() : [];
    const options = currentShops.length ? currentShops : fallbackFbaShops.map(normalizeFbaShop).filter((shop) => shop.sid);
    select.innerHTML = `<option value="">全部店铺</option>${options
      .map((shop) => `<option value="${escapeHtml(shop.sid)}">${escapeHtml(shop.name)} · ${escapeHtml(shop.country)}</option>`)
      .join("")}`;
    if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function buildFbaFreightQuery() {
    const params = new URLSearchParams();
    const startDate = fbaValue("#fba-freight-start-date");
    const endDate = fbaValue("#fba-freight-end-date");
    const sid = fbaValue("#fba-freight-sid");
    const shipmentId = fbaValue("#fba-freight-shipment-id");
    const status = fbaValue("#fba-freight-status-filter");
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (sid) params.set("sids", sid);
    if (shipmentId) params.set("shipmentId", shipmentId);
    if (status) params.set("shipmentStatus", status);
    params.set("length", "500");
    return params;
  }

  function fbaFreightFiltersObject() {
    return Object.fromEntries(buildFbaFreightQuery().entries());
  }

  function setFbaFreightStatus(message) {
    setText("#fba-freight-status", message, root);
  }

  function fbaFreightRowId(row = {}) {
    return String(row.shipmentId || row.staShipmentId || row.id || "").trim();
  }

  function selectedFbaFreightTemplateId() {
    return fbaValue("#fba-freight-template-select");
  }

  function renderFbaFreightTemplateOptions() {
    const select = query("#fba-freight-template-select");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="">请选择货代模板</option>${fbaFreightTemplates
      .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
      .join("")}`;
    if (previous && fbaFreightTemplates.some((template) => template.id === previous)) select.value = previous;
  }

  async function loadFbaFreightTemplates() {
    try {
      const response = await fetchImpl("/api/fba/freight/templates");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      fbaFreightTemplates = data.templates || [];
    } catch {
      fbaFreightTemplates = [
        { id: "jiufang", name: "九方通逊" },
        { id: "tongpao", name: "同袍物流" },
      ];
    }
    renderFbaFreightTemplateOptions();
  }

  function fbaFreightImageHtml(row) {
    const imageUrl = cachedSalesImageUrl(row.productImageUrl);
    if (!imageUrl) return `<span class="image-placeholder fba-freight-image-placeholder" aria-hidden="true">-</span>`;
    return `<span class="fba-freight-product-image-frame"><img class="fba-freight-product-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(row.shipmentName || "发货产品图片")}" loading="lazy" referrerpolicy="no-referrer" /></span>`;
  }

  function renderFbaFreightRows() {
    const table = query("#fba-freight-table");
    if (!table) return;
    const rows = fbaFreightRows || [];
    setText("#fba-freight-count", formatNumber(rows.length), root);
    setText("#fba-freight-quantity", formatNumber(rows.reduce((sum, row) => sum + Number(row.shippedQuantity || 0), 0)), root);
    setText("#fba-freight-store-count", formatNumber(new Set(rows.map((row) => row.sid || row.storeName).filter(Boolean)).size), root);
    if (!rows.length) {
      renderTableMessage(table, 11, "当前筛选没有货件。");
      updateFbaFreightSelectionState();
      return;
    }
    table.innerHTML = rows
      .map((row, index) => {
        const rowId = fbaFreightRowId(row);
        return `
        <tr>
          <td><input class="fba-freight-row-check" type="checkbox" data-fba-freight-select="${escapeHtml(rowId)}" ${selectedFbaFreightShipmentIds.has(rowId) ? "checked" : ""} aria-label="选择货件 ${escapeHtml(row.shipmentId || "")}" /></td>
          <td>${escapeHtml(row.country || "-")}</td>
          <td>${escapeHtml(row.storeName || "-")}</td>
          <td>${fbaFreightImageHtml(row)}</td>
          <td><strong>${escapeHtml(row.shipmentName || "-")}</strong><br /><small>${escapeHtml(row.inboundPlanId || "")}</small></td>
          <td>${escapeHtml(row.shipmentId || row.staShipmentId || "-")}</td>
          <td>${formatNumber(row.shippedQuantity || 0)}</td>
          <td><span class="risk-badge">${escapeHtml(row.shipmentStatus || "-")}</span></td>
          <td>${escapeHtml(row.fulfillmentCenterCode || "-")}</td>
          <td>${escapeHtml(row.createdAt || "-")}</td>
          <td class="table-actions">
            <button class="secondary-button compact-button" type="button" data-fba-freight-detail-index="${index}">预览</button>
            <button class="primary-button compact-button" type="button" data-fba-freight-convert="${escapeHtml(rowId)}">转表格</button>
          </td>
        </tr>
      `;
      })
      .join("");
    updateFbaFreightSelectionState();
  }

  async function loadFbaFreightInitial() {
    setDefaultFbaFreightDates();
    await Promise.allSettled([loadFbaShops(), loadFbaFreightTemplates()]);
    renderFbaFreightShopOptions();
    if (!fbaFreightLoaded) await loadFbaFreightShipments();
    else renderFbaFreightRows();
  }

  async function loadFbaFreightShipments() {
    setDefaultFbaFreightDates();
    setFbaFreightStatus("正在读取领星 fbaCargo 货件...");
    try {
      const response = await fetchImpl(`/api/fba/freight/shipments?${buildFbaFreightQuery().toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      fbaFreightRows = data.rows || data.shipments || [];
      selectedFbaFreightShipmentIds = new Set();
      fbaFreightLoaded = true;
      renderFbaFreightRows();
      setFbaFreightStatus(`已读取 ${formatNumber(fbaFreightRows.length)} 个货件`);
    } catch (error) {
      fbaFreightRows = [];
      renderFbaFreightRows();
      setFbaFreightStatus(`读取失败：${error.message || error}`);
    }
  }

  function updateFbaFreightSelectionState() {
    const rowIds = fbaFreightRows.map(fbaFreightRowId).filter(Boolean);
    const selectedCount = rowIds.filter((id) => selectedFbaFreightShipmentIds.has(id)).length;
    const selectAll = query("#fba-freight-select-all");
    if (selectAll) {
      selectAll.checked = Boolean(rowIds.length && selectedCount === rowIds.length);
      selectAll.indeterminate = Boolean(selectedCount && selectedCount < rowIds.length);
    }
    const batchButton = query("#fba-freight-batch-convert");
    if (batchButton) batchButton.disabled = selectedCount === 0;
  }

  function setFbaFreightRowSelection(rowId, selected) {
    if (!rowId) return;
    if (selected) selectedFbaFreightShipmentIds.add(rowId);
    else selectedFbaFreightShipmentIds.delete(rowId);
    updateFbaFreightSelectionState();
  }

  function setAllFbaFreightRowSelection(selected) {
    const rowIds = fbaFreightRows.map(fbaFreightRowId).filter(Boolean);
    selectedFbaFreightShipmentIds = selected ? new Set(rowIds) : new Set();
    renderFbaFreightRows();
  }

  function renderFbaFreightDetail(row) {
    const items = row.items || [];
    const address = row.shipToAddress || {};
    return `
      <section class="fba-freight-detail-grid">
        <div><span>国家</span><strong>${escapeHtml(row.country || "-")}</strong></div>
        <div><span>店铺</span><strong>${escapeHtml(row.storeName || "-")}</strong></div>
        <div><span>货件单号</span><strong>${escapeHtml(row.shipmentId || row.staShipmentId || "-")}</strong></div>
        <div><span>物流中心</span><strong>${escapeHtml(row.fulfillmentCenterCode || "-")}</strong></div>
        <div><span>货件状态</span><strong>${escapeHtml(row.shipmentStatus || "-")}</strong></div>
        <div><span>发货数量</span><strong>${formatNumber(row.shippedQuantity || 0)}</strong></div>
        <div><span>创建时间</span><strong>${escapeHtml(row.createdAt || "-")}</strong></div>
        <div><span>收货地址</span><strong>${escapeHtml([address.name, address.addressLine1, address.city, address.stateOrProvinceCode, address.postalCode, address.countryCode].filter(Boolean).join("，") || "-")}</strong></div>
      </section>
      <div class="fba-freight-items">
        <h3>发货产品</h3>
        <table class="data-table">
          <thead><tr><th>图片</th><th>MSKU</th><th>ASIN/FNSKU</th><th>发货数量</th></tr></thead>
          <tbody>${items.length ? items
            .map((item) => `
              <tr>
                <td>${fbaFreightImageHtml({ productImageUrl: item.imageUrl, shipmentName: item.msku || row.shipmentName })}</td>
                <td>${escapeHtml(item.msku || item.sellerSku || "-")}<br /><small>${escapeHtml(item.title || item.productName || "")}</small></td>
                <td>${escapeHtml(item.asin || "-")}<br /><small>${escapeHtml(item.fnsku || "")}</small></td>
                <td>${formatNumber(item.shippedQuantity || item.quantity || 0)}</td>
              </tr>
            `)
            .join("") : `<tr><td colspan="4">领星列表未返回产品明细。</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  function openFbaFreightDetail(index) {
    const row = fbaFreightRows[Number(index)];
    if (!row) return;
    setText("#fba-freight-detail-title", row.shipmentName || "货件详情", root);
    const content = query("#fba-freight-detail-content");
    if (content) content.innerHTML = renderFbaFreightDetail(row);
    const modal = query("#fba-freight-detail-modal");
    if (modal) setModalOpenState(modal, true);
  }

  function closeFbaFreightDetail() {
    setModalOpenState(query("#fba-freight-detail-modal"), false);
  }

  function updateFbaFreightTemplateConfirmState() {
    const confirmButton = query("#fba-freight-template-confirm");
    if (confirmButton) confirmButton.disabled = !selectedFbaFreightTemplateId() || !pendingFbaFreightConvertShipmentIds.length;
  }

  function openFbaFreightTemplateModal(shipmentIds = []) {
    const ids = shipmentIds.filter(Boolean);
    if (!ids.length) {
      setFbaFreightStatus("请先勾选要转表格的货件。");
      return;
    }
    pendingFbaFreightConvertShipmentIds = ids;
    renderFbaFreightTemplateOptions();
    const select = query("#fba-freight-template-select");
    if (select) select.value = "";
    setText("#fba-freight-template-hint", `已选择 ${formatNumber(ids.length)} 个货件，请选择货代模板后生成。`, root);
    updateFbaFreightTemplateConfirmState();
    const modal = query("#fba-freight-template-modal");
    if (modal) setModalOpenState(modal, true);
  }

  function closeFbaFreightTemplateModal() {
    setModalOpenState(query("#fba-freight-template-modal"), false);
    pendingFbaFreightConvertShipmentIds = [];
  }

  function filenameFromDisposition(response, fallback) {
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    return filenameMatch ? decodeURIComponent(filenameMatch[1]) : fallback;
  }

  async function exportFbaFreightWorkbook() {
    setDefaultFbaFreightDates();
    setFbaFreightStatus("正在生成货代表格...");
    try {
      const response = await fetchImpl(`/api/fba/freight/export?${buildFbaFreightQuery().toString()}`);
      const blob = await response.blob();
      if (!response.ok) {
        const message = await blob.text().catch(() => "");
        throw new Error(message || `API ${response.status}`);
      }
      downloadBlob(blob, filenameFromDisposition(response, `货代表格-${fbaFreightTodayDateText()}.xlsx`));
      setFbaFreightStatus("货代表格已生成");
    } catch (error) {
      setFbaFreightStatus(`生成失败：${error.message || error}`);
    }
  }

  async function convertFbaFreightWorkbook(shipmentIds = [], templateId = selectedFbaFreightTemplateId()) {
    if (!templateId) {
      setFbaFreightStatus("请先选择货代模板。");
      return;
    }
    const ids = shipmentIds.filter(Boolean);
    if (!ids.length) {
      setFbaFreightStatus("请先勾选要转表格的货件。");
      return;
    }
    setFbaFreightStatus("正在按货代模板转表格...");
    try {
      const response = await fetchImpl("/api/fba/freight/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId,
          shipmentIds: ids,
          filters: fbaFreightFiltersObject(),
        }),
      });
      const blob = await response.blob();
      if (!response.ok) {
        const message = await blob.text().catch(() => "");
        throw new Error(message || `API ${response.status}`);
      }
      downloadBlob(blob, filenameFromDisposition(response, `货代模板-${fbaFreightTodayDateText()}.xlsx`));
      setFbaFreightStatus(`已转出 ${formatNumber(ids.length)} 个货件`);
      closeFbaFreightTemplateModal();
    } catch (error) {
      setFbaFreightStatus(`转表格失败：${error.message || error}`);
    }
  }

  function setupFbaFreight() {
    bind(root, "#fba-freight-refresh", "click", loadFbaFreightShipments);
    bind(root, "#fba-freight-export", "click", exportFbaFreightWorkbook);
    bind(root, "#fba-freight-template-select", "change", updateFbaFreightTemplateConfirmState);
    bind(root, "#fba-freight-select-all", "change", (event) => {
      setAllFbaFreightRowSelection(event.target.checked);
    });
    bind(root, "#fba-freight-batch-convert", "click", () => {
      openFbaFreightTemplateModal([...selectedFbaFreightShipmentIds]);
    });
    bind(root, "#fba-freight-detail-close", "click", closeFbaFreightDetail);
    bindBackdropClose(root, "#fba-freight-detail-modal", closeFbaFreightDetail);
    bind(root, "#fba-freight-template-close", "click", closeFbaFreightTemplateModal);
    bind(root, "#fba-freight-template-cancel", "click", closeFbaFreightTemplateModal);
    bindBackdropClose(root, "#fba-freight-template-modal", closeFbaFreightTemplateModal);
    bind(root, "#fba-freight-template-confirm", "click", () => {
      convertFbaFreightWorkbook([...pendingFbaFreightConvertShipmentIds], selectedFbaFreightTemplateId());
    });
    bind(root, "#fba-freight-table", "change", (event) => {
      const checkbox = closestTarget(event, "[data-fba-freight-select]");
      if (!checkbox) return;
      setFbaFreightRowSelection(checkbox.dataset.fbaFreightSelect, checkbox.checked);
    });
    bind(root, "#fba-freight-table", "click", (event) => {
      const button = closestTarget(event, "[data-fba-freight-detail-index]");
      if (button) {
        openFbaFreightDetail(button.dataset.fbaFreightDetailIndex);
        return;
      }
      const convertButton = closestTarget(event, "[data-fba-freight-convert]");
      if (!convertButton) return;
      openFbaFreightTemplateModal([convertButton.dataset.fbaFreightConvert]);
    });
  }

  return {
    loadFbaFreightInitial,
    loadFbaFreightShipments,
    renderFbaFreightShopOptions,
    setupFbaFreight,
  };
}

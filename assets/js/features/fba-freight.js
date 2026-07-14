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
  let fbaFreightWarehouses = [];
  let fbaFreightJiufangChannels = [];
  let selectedFbaFreightShipmentIds = new Set();
  let pendingFbaFreightConvertShipmentIds = [];
  let pendingFbaFreightJiufangShipmentIds = [];
  let pendingFbaFreightJiufangDryRunResult = null;
  let fbaFreightLoading = false;
  let fbaFreightOrderCreating = false;
  let fbaFreightJiufangSubmitting = false;
  const fbaFreightOrderResults = new Map();
  const fbaFreightJiufangResults = new Map();

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

  function buildFbaFreightQuery({ forceRefresh = false } = {}) {
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
    if (forceRefresh) params.set("forceRefresh", "true");
    params.set("length", "500");
    return params;
  }

  function fbaFreightFiltersObject() {
    return Object.fromEntries(buildFbaFreightQuery().entries());
  }

  function setFbaFreightStatus(message) {
    setText("#fba-freight-status", message, root);
  }

  function setFbaFreightLoading(loading) {
    fbaFreightLoading = Boolean(loading);
    const refreshButton = query("#fba-freight-refresh");
    if (refreshButton) refreshButton.disabled = fbaFreightLoading;
  }

  function fbaFreightRowId(row = {}) {
    return String(row.shipmentId || row.staShipmentId || row.id || "").trim();
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function selectedFbaFreightTemplateId() {
    return fbaValue("#fba-freight-template-select");
  }

  function selectedFbaFreightWarehouse() {
    const value = fbaValue("#fba-freight-warehouse");
    return value ? { sysWid: Number(value) } : {};
  }

  function selectedFbaFreightJiufangChannel() {
    return fbaValue("#fba-freight-jiufang-channel");
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

  function renderFbaFreightWarehouseOptions() {
    const select = query("#fba-freight-warehouse");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="">请选择发货仓库</option>${fbaFreightWarehouses
      .map((warehouse) => `<option value="${escapeHtml(warehouse.sysWid || warehouse.wid)}">${escapeHtml(warehouse.name)}</option>`)
      .join("")}`;
    if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
    else if (!previous && fbaFreightWarehouses.length === 1) select.value = String(fbaFreightWarehouses[0].sysWid || fbaFreightWarehouses[0].wid);
  }

  function renderFbaFreightJiufangChannelOptions() {
    const select = query("#fba-freight-jiufang-channel");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="">请选择九方渠道</option>${fbaFreightJiufangChannels
      .map((channel) => `<option value="${escapeHtml(channel.code)}">${escapeHtml(channel.name || channel.code)}</option>`)
      .join("")}`;
    const defaultChannel = fbaFreightJiufangChannels.find((channel) => channel.isDefault) || fbaFreightJiufangChannels[0];
    if (previous && fbaFreightJiufangChannels.some((channel) => channel.code === previous)) select.value = previous;
    else if (defaultChannel) select.value = defaultChannel.code;
  }

  async function ensureFbaFreightJiufangChannelSelected() {
    let channelCode = selectedFbaFreightJiufangChannel();
    if (channelCode) return channelCode;
    setFbaFreightStatus("正在连接九方读取渠道...");
    await loadFbaFreightJiufangChannels();
    channelCode = selectedFbaFreightJiufangChannel();
    if (!channelCode) throw new Error("九方未返回可用渠道，无法预检下单。");
    return channelCode;
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

  async function loadFbaFreightWarehouses() {
    const response = await fetchImpl("/api/fba/warehouses");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "读取发货仓库失败");
    fbaFreightWarehouses = data.warehouses || [];
    renderFbaFreightWarehouseOptions();
    updateFbaFreightSelectionState();
  }

  async function loadFbaFreightJiufangChannels() {
    const response = await fetchImpl("/api/fba/jiufang/channels");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "读取九方渠道失败");
    fbaFreightJiufangChannels = data.channels || [];
    renderFbaFreightJiufangChannelOptions();
    updateFbaFreightSelectionState();
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
      renderTableMessage(table, 12, "当前筛选没有货件。");
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
          <td data-fba-freight-order-result="${escapeHtml(rowId)}">${escapeHtml(renderFbaFreightCombinedOrderResult(rowId))}</td>
          <td class="table-actions">
            <button class="primary-button compact-button" type="button" data-fba-freight-jiufang="${escapeHtml(rowId)}">九方</button>
            <button class="secondary-button compact-button" type="button" data-fba-freight-detail-index="${index}">预览</button>
            <button class="primary-button compact-button" type="button" data-fba-freight-convert="${escapeHtml(rowId)}">转表格</button>
            <button class="primary-button compact-button" type="button" data-fba-freight-create-order="${escapeHtml(rowId)}">转发货单</button>
          </td>
        </tr>
      `;
      })
      .join("");
    updateFbaFreightSelectionState();
  }

  async function loadFbaFreightInitial() {
    setDefaultFbaFreightDates();
    const [, , warehouseResult] = await Promise.allSettled([loadFbaShops(), loadFbaFreightTemplates(), loadFbaFreightWarehouses()]);
    if (warehouseResult.status === "rejected") {
      console.error("[fba-freight] load shipment order warehouses failed", { error: warehouseResult.reason?.message || String(warehouseResult.reason) });
      setFbaFreightStatus(`发货仓库读取失败：${warehouseResult.reason?.message || warehouseResult.reason}`);
    }
    renderFbaFreightShopOptions();
    if (!fbaFreightLoaded) await loadFbaFreightShipments();
    else renderFbaFreightRows();
  }

  async function loadFbaFreightShipments({ forceRefresh = false } = {}) {
    if (fbaFreightLoading) return;
    setDefaultFbaFreightDates();
    setFbaFreightLoading(true);
    setFbaFreightStatus(forceRefresh ? "正在强制读取领星 fbaCargo 货件..." : "正在读取领星 fbaCargo 货件...");
    try {
      const response = await fetchImpl(`/api/fba/freight/shipments?${buildFbaFreightQuery({ forceRefresh }).toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      fbaFreightRows = data.rows || data.shipments || [];
      selectedFbaFreightShipmentIds = new Set();
      fbaFreightOrderResults.clear();
      fbaFreightJiufangResults.clear();
      fbaFreightLoaded = true;
      renderFbaFreightRows();
      setFbaFreightStatus(`已读取 ${formatNumber(fbaFreightRows.length)} 个货件`);
    } catch (error) {
      fbaFreightRows = [];
      renderFbaFreightRows();
      setFbaFreightStatus(`读取失败：${error.message || error}`);
    } finally {
      setFbaFreightLoading(false);
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
    root.querySelectorAll?.("[data-fba-freight-jiufang]")?.forEach((button) => {
      button.disabled = fbaFreightJiufangSubmitting;
    });
    root.querySelectorAll?.("[data-fba-freight-create-order]")?.forEach((button) => {
      button.disabled = fbaFreightOrderCreating || !selectedFbaFreightWarehouse().sysWid;
    });
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

  function setFbaFreightOrderResultCell(shipmentId, message) {
    if (!shipmentId) return;
    fbaFreightOrderResults.set(shipmentId, message);
    const cell = query(`[data-fba-freight-order-result="${cssEscape(shipmentId)}"]`);
    if (cell) cell.textContent = renderFbaFreightCombinedOrderResult(shipmentId);
  }

  function setFbaFreightOrderResults(shipmentIds = [], message) {
    shipmentIds.forEach((shipmentId) => setFbaFreightOrderResultCell(shipmentId, message));
  }

  function setFbaFreightJiufangResultCell(shipmentId, message) {
    if (!shipmentId) return;
    fbaFreightJiufangResults.set(shipmentId, message);
    const cell = query(`[data-fba-freight-order-result="${cssEscape(shipmentId)}"]`);
    if (cell) cell.textContent = renderFbaFreightCombinedOrderResult(shipmentId);
  }

  function setFbaFreightJiufangResults(shipmentIds = [], message) {
    shipmentIds.forEach((shipmentId) => setFbaFreightJiufangResultCell(shipmentId, message));
  }

  function renderFbaFreightOrderResult(result = {}) {
    if (result.status === "created") return `完成 ${result.orderSn || ""}`.trim();
    if (result.status === "skipped") return `完成：${result.reason || "已存在"} ${result.orderSn || ""}`.trim();
    return `失败：${result.error || "未知错误"}`;
  }

  function renderFbaFreightCombinedOrderResult(shipmentId) {
    const orderResult = fbaFreightOrderResults.get(shipmentId) || "-";
    const jiufangResult = fbaFreightJiufangResults.get(shipmentId) || "";
    return jiufangResult ? `${orderResult}；九方：${jiufangResult}` : orderResult;
  }

  function renderFbaFreightJiufangResult(result = {}) {
    if (result.status === "ready") return `预检通过：${formatNumber(result.summary?.boxCount || 0)} 箱`;
    if (result.status === "created") return `已下单 ${result.jiufangOrderNumber || ""}`.trim();
    if (result.status === "skipped") return `跳过：${result.reason || "已存在"} ${result.jiufangOrderNumber || ""}`.trim();
    const missing = Array.isArray(result.missingFields) && result.missingFields.length ? result.missingFields.slice(0, 2).join("；") : "";
    return `失败：${missing || result.error || "未知错误"}`;
  }

  function renderFbaFreightJiufangSummary(data = {}) {
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return "<p class=\"modal-tip\">九方预检没有返回结果。</p>";
    return `
      <div class="fba-jiufang-summary-grid">
        <span>可提交 <strong>${escapeHtml(formatNumber(data.readyCount || 0))}</strong></span>
        <span>已跳过 <strong>${escapeHtml(formatNumber(data.skippedCount || 0))}</strong></span>
        <span>失败 <strong>${escapeHtml(formatNumber(data.failedCount || 0))}</strong></span>
      </div>
      <div class="fba-jiufang-result-list">
        ${results.map((result) => `
          <div class="fba-jiufang-result-row">
            <strong>${escapeHtml(result.shipmentId || "-")}</strong>
            <span>${escapeHtml(renderFbaFreightJiufangResult(result))}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function setFbaFreightJiufangConfirmState(data = {}) {
    const confirmButton = query("#fba-freight-jiufang-confirm");
    if (!confirmButton) return;
    confirmButton.disabled = !pendingFbaFreightJiufangShipmentIds.length || fbaFreightJiufangSubmitting || Number(data.failedCount || 0) > 0;
  }

  function closeFbaFreightJiufangModal() {
    setModalOpenState(query("#fba-freight-jiufang-modal"), false);
    pendingFbaFreightJiufangShipmentIds = [];
    pendingFbaFreightJiufangDryRunResult = null;
  }

  async function dryRunFbaFreightJiufangOrders(shipmentIds = [...selectedFbaFreightShipmentIds]) {
    const ids = [...shipmentIds].filter(Boolean);
    if (!ids.length) {
      setFbaFreightStatus("请先选择要提交九方的货件。");
      return;
    }
    fbaFreightJiufangSubmitting = true;
    updateFbaFreightSelectionState();
    setFbaFreightJiufangResults(ids, "预检中");
    try {
      const channelCode = await ensureFbaFreightJiufangChannelSelected();
      setFbaFreightStatus(`九方下单预检中：${formatNumber(ids.length)} 个货件`);
      const response = await fetchImpl("/api/fba/jiufang/orders/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: fbaFreightFiltersObject(),
          shipmentIds: ids,
          channelCode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const results = Array.isArray(data.results) ? data.results : null;
      if (!results) throw new Error(data.error || "接口没有返回九方预检结果");
      results.forEach((result) => setFbaFreightJiufangResultCell(result.shipmentId, renderFbaFreightJiufangResult(result)));
      pendingFbaFreightJiufangShipmentIds = results
        .filter((result) => result.status === "ready")
        .map((result) => result.shipmentId)
        .filter(Boolean);
      pendingFbaFreightJiufangDryRunResult = data;
      const content = query("#fba-freight-jiufang-summary");
      if (content) content.innerHTML = renderFbaFreightJiufangSummary(data);
      setFbaFreightJiufangConfirmState(data);
      setModalOpenState(query("#fba-freight-jiufang-modal"), true);
      setFbaFreightStatus(`九方预检完成：可提交 ${formatNumber(data.readyCount || 0)}，失败 ${formatNumber(data.failedCount || 0)}`);
    } catch (error) {
      const message = `失败：${error.message || error}`;
      setFbaFreightJiufangResults(ids, message);
      setFbaFreightStatus(`九方预检失败：${error.message || error}`);
    } finally {
      fbaFreightJiufangSubmitting = false;
      updateFbaFreightSelectionState();
      setFbaFreightJiufangConfirmState(pendingFbaFreightJiufangDryRunResult || {});
    }
  }

  async function createFbaFreightJiufangOrders() {
    const ids = pendingFbaFreightJiufangShipmentIds.filter(Boolean);
    const channelCode = selectedFbaFreightJiufangChannel();
    if (!ids.length || !channelCode || fbaFreightJiufangSubmitting) return;
    fbaFreightJiufangSubmitting = true;
    updateFbaFreightSelectionState();
    setFbaFreightJiufangConfirmState();
    setFbaFreightStatus(`正在提交九方：${formatNumber(ids.length)} 个货件`);
    setFbaFreightJiufangResults(ids, "提交中");
    try {
      const response = await fetchImpl("/api/fba/jiufang/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: fbaFreightFiltersObject(),
          shipmentIds: ids,
          channelCode,
          confirmed: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const results = Array.isArray(data.results) ? data.results : null;
      if (!results) throw new Error(data.error || "接口没有返回九方下单结果");
      results.forEach((result) => setFbaFreightJiufangResultCell(result.shipmentId, renderFbaFreightJiufangResult(result)));
      setFbaFreightStatus(`九方提交完成：成功 ${formatNumber(data.createdCount || 0)}，失败 ${formatNumber(data.failedCount || 0)}`);
      closeFbaFreightJiufangModal();
    } catch (error) {
      const message = `失败：${error.message || error}`;
      setFbaFreightJiufangResults(ids, message);
      setFbaFreightStatus(`九方提交失败：${error.message || error}`);
    } finally {
      fbaFreightJiufangSubmitting = false;
      updateFbaFreightSelectionState();
      setFbaFreightJiufangConfirmState(pendingFbaFreightJiufangDryRunResult || {});
    }
  }

  async function createFbaFreightShipmentOrders(shipmentIds = [...selectedFbaFreightShipmentIds]) {
    if (fbaFreightOrderCreating) {
      setFbaFreightStatus("发货单创建中，请稍候。");
      return;
    }
    const ids = [...shipmentIds].filter(Boolean);
    if (!ids.length) {
      setFbaFreightStatus("请先选择要转发货单的货件。");
      return;
    }
    const warehouse = selectedFbaFreightWarehouse();
    if (!warehouse.sysWid && !warehouse.wid) {
      setFbaFreightStatus("请先选择发货仓库。");
      updateFbaFreightSelectionState();
      return;
    }
    fbaFreightOrderCreating = true;
    updateFbaFreightSelectionState();
    setFbaFreightStatus(`发货单创建中：${formatNumber(ids.length)} 个货件`);
    setFbaFreightOrderResults(ids, "进行中");
    try {
      const response = await fetchImpl("/api/fba/shipment-orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: fbaFreightFiltersObject(),
          shipmentIds: ids,
          warehouse,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const results = Array.isArray(data.results) ? data.results : null;
      if (!results) throw new Error(data.error || "接口没有返回创建结果");
      if (!response.ok && !results.length) throw new Error(data.error || `API ${response.status}`);
      const resultShipmentIds = new Set();
      results.forEach((result) => {
        if (result.shipmentId) resultShipmentIds.add(String(result.shipmentId));
        setFbaFreightOrderResultCell(result.shipmentId, renderFbaFreightOrderResult(result));
      });
      const missingResultIds = ids.filter((id) => !resultShipmentIds.has(String(id)));
      missingResultIds.forEach((id) => setFbaFreightOrderResultCell(id, "失败：接口没有返回创建结果"));
      if (missingResultIds.length) {
        console.error("[fba-freight] missing shipment order create results", { shipmentIds: missingResultIds });
      }
      setFbaFreightStatus(
        `发货单创建完成：完成 ${formatNumber((data.createdCount || 0) + (data.skippedCount || 0))}，失败 ${formatNumber((data.failedCount || 0) + missingResultIds.length)}`,
      );
    } catch (error) {
      const message = `失败：${error.message || error}`;
      setFbaFreightOrderResults(ids, message);
      setFbaFreightStatus(`发货单创建失败：${error.message || error}`);
    } finally {
      fbaFreightOrderCreating = false;
      updateFbaFreightSelectionState();
    }
  }

  function setupFbaFreight() {
    bind(root, "#fba-freight-refresh", "click", () => loadFbaFreightShipments({ forceRefresh: true }));
    bind(root, "#fba-freight-export", "click", exportFbaFreightWorkbook);
    bind(root, "#fba-freight-warehouse", "change", updateFbaFreightSelectionState);
    bind(root, "#fba-freight-jiufang-channel", "change", updateFbaFreightSelectionState);
    bind(root, "#fba-freight-template-select", "change", updateFbaFreightTemplateConfirmState);
    bind(root, "#fba-freight-select-all", "change", (event) => {
      setAllFbaFreightRowSelection(event.target.checked);
    });
    bind(root, "#fba-freight-batch-convert", "click", () => {
      openFbaFreightTemplateModal([...selectedFbaFreightShipmentIds]);
    });
    bind(root, "#fba-freight-jiufang-confirm", "click", createFbaFreightJiufangOrders);
    bind(root, "#fba-freight-jiufang-cancel", "click", closeFbaFreightJiufangModal);
    bind(root, "#fba-freight-jiufang-close", "click", closeFbaFreightJiufangModal);
    bindBackdropClose(root, "#fba-freight-jiufang-modal", closeFbaFreightJiufangModal);
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
      const jiufangButton = closestTarget(event, "[data-fba-freight-jiufang]");
      if (jiufangButton) {
        return dryRunFbaFreightJiufangOrders([jiufangButton.dataset.fbaFreightJiufang]);
      }
      const button = closestTarget(event, "[data-fba-freight-detail-index]");
      if (button) {
        openFbaFreightDetail(button.dataset.fbaFreightDetailIndex);
        return;
      }
      const convertButton = closestTarget(event, "[data-fba-freight-convert]");
      if (convertButton) {
        openFbaFreightTemplateModal([convertButton.dataset.fbaFreightConvert]);
        return;
      }
      const createOrderButton = closestTarget(event, "[data-fba-freight-create-order]");
      if (!createOrderButton) return;
      createFbaFreightShipmentOrders([createOrderButton.dataset.fbaFreightCreateOrder]);
    });
  }

  return {
    loadFbaFreightInitial,
    loadFbaFreightShipments,
    renderFbaFreightShopOptions,
    setupFbaFreight,
  };
}

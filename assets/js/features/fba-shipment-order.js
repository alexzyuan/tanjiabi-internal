export function createFbaShipmentOrderFeature({
  root,
  bind,
  closestTarget,
  escapeHtml,
  fallbackFbaShops = [],
  fbaValue,
  fetchImpl,
  formatNumber,
  getFbaShops,
  loadFbaShops,
  renderTableMessage,
  setText,
  confirmImpl,
} = {}) {
  if (!root) throw new Error("createFbaShipmentOrderFeature requires root.");
  if (typeof bind !== "function") throw new Error("createFbaShipmentOrderFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaShipmentOrderFeature requires fetch.");

  let rows = [];
  let warehouses = [];
  let loaded = false;
  let selectedShipmentIds = new Set();

  function todayDateText() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function monthStartText() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function setDefaultDates() {
    const start = root.querySelector("#fba-shipment-order-start-date");
    const end = root.querySelector("#fba-shipment-order-end-date");
    if (start && !start.value) start.value = monthStartText();
    if (end && !end.value) end.value = todayDateText();
  }

  function setStatus(message) {
    setText("#fba-shipment-order-status", message, root);
  }

  function rowId(row = {}) {
    return String(row.shipmentId || row.staShipmentId || row.id || "").trim();
  }

  function buildQuery(forceRefresh = false) {
    const params = new URLSearchParams();
    const startDate = fbaValue("#fba-shipment-order-start-date");
    const endDate = fbaValue("#fba-shipment-order-end-date");
    const sid = fbaValue("#fba-shipment-order-sid");
    const shipmentId = fbaValue("#fba-shipment-order-shipment-id");
    const status = fbaValue("#fba-shipment-order-status-filter");
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (sid) params.set("sid", sid);
    if (shipmentId) params.set("shipmentId", shipmentId);
    if (status) params.set("shipmentStatus", status);
    if (forceRefresh) params.set("forceRefresh", "true");
    return params;
  }

  function filtersObject() {
    return Object.fromEntries(buildQuery(false).entries());
  }

  function selectedWarehouse() {
    const value = fbaValue("#fba-shipment-order-warehouse");
    return value ? { sysWid: Number(value) } : {};
  }

  function renderShopOptions() {
    const select = root.querySelector("#fba-shipment-order-sid");
    if (!select) return;
    const shops = typeof getFbaShops === "function" ? getFbaShops() : fallbackFbaShops;
    const current = select.value;
    select.innerHTML = `<option value="">全部核心店铺</option>${shops.map((shop) => {
      const sid = shop.sid || shop.id || "";
      const label = shop.displayName || shop.name || shop.seller || sid;
      return `<option value="${escapeHtml(sid)}">${escapeHtml(label)}</option>`;
    }).join("")}`;
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderWarehouses() {
    const select = root.querySelector("#fba-shipment-order-warehouse");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">请选择发货仓库</option>${warehouses.map((warehouse) =>
      `<option value="${escapeHtml(warehouse.wid)}">${escapeHtml(warehouse.name)}</option>`,
    ).join("")}`;
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  }

  async function loadWarehouses() {
    const response = await fetchImpl("/api/fba/warehouses");
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "读取仓库失败");
    warehouses = data.warehouses || [];
    renderWarehouses();
  }

  function updateSelectionState() {
    const ids = rows.map(rowId).filter(Boolean);
    const selectedCount = ids.filter((id) => selectedShipmentIds.has(id)).length;
    setText("#fba-shipment-order-count", formatNumber(rows.length), root);
    setText("#fba-shipment-order-selected-count", formatNumber(selectedCount), root);
    setText("#fba-shipment-order-quantity", formatNumber(rows.reduce((sum, row) => sum + Number(row.shippedQuantity || 0), 0)), root);
    const all = root.querySelector("#fba-shipment-order-select-all");
    if (all) {
      all.checked = Boolean(ids.length && selectedCount === ids.length);
      all.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    }
    const createButton = root.querySelector("#fba-shipment-order-create");
    if (createButton) createButton.disabled = selectedCount === 0 || !fbaValue("#fba-shipment-order-warehouse");
  }

  function mappingLabel(row = {}) {
    const missing = [];
    if (!row.sellerId) missing.push("seller_id");
    if (!row.marketplaceId) missing.push("marketplace_id");
    const items = row.items || [];
    if (items.some((item) => !item.sku)) missing.push("SKU");
    if (items.some((item) => !item.fnsku)) missing.push("FNSKU");
    if (items.some((item) => Number(item.shippedQuantity || 0) <= 0)) missing.push("数量");
    return missing.length ? `缺少 ${missing.join("、")}` : "完整";
  }

  function renderRows() {
    const tbody = root.querySelector("#fba-shipment-order-table");
    if (!tbody) return;
    if (!rows.length) {
      renderTableMessage(tbody, 9, "没有匹配的 FBA 货件。");
      updateSelectionState();
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const id = rowId(row);
      const itemCount = (row.items || []).length;
      return `
        <tr>
          <td><input class="fba-shipment-order-row-check" type="checkbox" data-fba-shipment-order-select="${escapeHtml(id)}" ${selectedShipmentIds.has(id) ? "checked" : ""} aria-label="选择货件 ${escapeHtml(row.shipmentId || "")}" /></td>
          <td>${escapeHtml(row.storeName || row.sid || "-")}</td>
          <td><strong>${escapeHtml(row.shipmentId || row.staShipmentId || "-")}</strong></td>
          <td>${escapeHtml(row.shipmentName || "-")}</td>
          <td><span class="risk-badge">${escapeHtml(row.shipmentStatus || "-")}</span></td>
          <td>${formatNumber(itemCount)}</td>
          <td>${formatNumber(row.shippedQuantity || 0)}</td>
          <td>${escapeHtml(mappingLabel(row))}</td>
          <td data-fba-shipment-order-result="${escapeHtml(id)}">-</td>
        </tr>`;
    }).join("");
    updateSelectionState();
  }

  async function loadShipmentOrders(forceRefresh = false) {
    setDefaultDates();
    setStatus("正在读取 FBA 货件...");
    try {
      const response = await fetchImpl(`/api/fba/shipment-candidates?${buildQuery(forceRefresh).toString()}`);
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "读取 FBA 货件失败");
      rows = data.rows || [];
      selectedShipmentIds = new Set();
      loaded = true;
      renderRows();
      setStatus(`已读取 ${formatNumber(rows.length)} 个货件${data.cache?.hit ? "（缓存）" : ""}`);
    } catch (error) {
      rows = [];
      selectedShipmentIds = new Set();
      renderRows();
      setStatus(`读取失败：${error.message || error}`);
    }
  }

  function setResultCell(result = {}) {
    const id = result.shipmentId;
    const cell = root.querySelector(`[data-fba-shipment-order-result="${CSS.escape(id)}"]`);
    if (!cell) return;
    if (result.status === "created") cell.textContent = `已创建 ${result.orderSn || ""}`.trim();
    else if (result.status === "skipped") cell.textContent = `已跳过：${result.reason || ""} ${result.orderSn || ""}`.trim();
    else cell.textContent = `失败：${result.error || "未知错误"}`;
  }

  async function createOrders() {
    const ids = [...selectedShipmentIds];
    if (!ids.length) {
      setStatus("请先勾选要创建发货单的货件。");
      return;
    }
    const warehouse = selectedWarehouse();
    if (!warehouse.sysWid && !warehouse.wid) {
      setStatus("请先选择发货仓库。");
      updateSelectionState();
      return;
    }
    const confirmed = confirmImpl(`确认创建 ${ids.length} 个待发货发货单？第一版只创建待发货单，不扣减库存。`);
    if (!confirmed) return;
    setStatus("正在串行创建待发货单...");
    try {
      const response = await fetchImpl("/api/fba/shipment-orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: filtersObject(), shipmentIds: ids, warehouse }),
      });
      const data = await response.json();
      if (!response.ok && !data.results) throw new Error(data.error || "创建发货单失败");
      (data.results || []).forEach(setResultCell);
      setStatus(`创建完成：成功 ${formatNumber(data.createdCount || 0)}，跳过 ${formatNumber(data.skippedCount || 0)}，失败 ${formatNumber(data.failedCount || 0)}`);
    } catch (error) {
      setStatus(`创建失败：${error.message || error}`);
    }
  }

  async function loadInitial() {
    setDefaultDates();
    await Promise.allSettled([loadFbaShops(), loadWarehouses()]);
    renderShopOptions();
    if (!loaded) await loadShipmentOrders(false);
    else renderRows();
  }

  function setupFbaShipmentOrder() {
    bind(root, "#fba-shipment-order-refresh", "click", () => loadShipmentOrders(true));
    bind(root, "#fba-shipment-order-create", "click", createOrders);
    bind(root, "#fba-shipment-order-warehouse", "change", updateSelectionState);
    bind(root, "#fba-shipment-order-select-all", "change", (event) => {
      const ids = rows.map(rowId).filter(Boolean);
      selectedShipmentIds = event.target.checked ? new Set(ids) : new Set();
      renderRows();
    });
    bind(root, "#fba-shipment-order-table", "change", (event) => {
      const checkbox = closestTarget(event, "[data-fba-shipment-order-select]");
      if (!checkbox) return;
      const id = checkbox.dataset.fbaShipmentOrderSelect;
      if (checkbox.checked) selectedShipmentIds.add(id);
      else selectedShipmentIds.delete(id);
      updateSelectionState();
    });
  }

  return {
    loadFbaShipmentOrderInitial: loadInitial,
    renderFbaShipmentOrderShopOptions: renderShopOptions,
    setupFbaShipmentOrder,
  };
}

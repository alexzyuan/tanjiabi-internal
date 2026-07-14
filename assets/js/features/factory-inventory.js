export function createFactoryInventoryFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  bindAll,
  checkedField,
  closestTarget,
  compareTableSortableValues,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  renderTableMessage,
  setTableSortButtonGroupState,
  setText,
  trimmedFieldValue,
  cachedSalesImageUrl = (value) => value,
  windowApi = globalThis.window,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createFactoryInventoryFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createFactoryInventoryFeature requires bind.");
  if (typeof bindAll !== "function") throw new Error("createFactoryInventoryFeature requires bindAll.");
  if (typeof closestTarget !== "function") throw new Error("createFactoryInventoryFeature requires closestTarget.");
  if (typeof createDebouncedAction !== "function") throw new Error("createFactoryInventoryFeature requires createDebouncedAction.");

  let factoryInventoryData = {
    meta: { source: "领星 ERP purchaseOrder 采购单", syncStatus: "等待加载" },
    summary: {},
    rows: [],
    options: { factories: [] },
  };
  let factoryInventorySort = { key: "orderTime", direction: "desc" };
  let factoryInventoryLoadPromise = null;
  let factoryInventoryLoadKey = "";
  const factoryInventoryShippedSaveTimers = new Map();
  const factoryInventoryShippedSaveVersions = new Map();
  const visibleLimit = 500;
  const numericSortKeys = new Set([
    "unitPrice",
    "purchaseQuantity",
    "purchaseAmount",
    "shippedQuantity",
    "factoryRemainingQuantity",
    "fbaAvailable",
    "fbaTransfer",
    "fbaInbound",
    "fbaTotalStock",
  ]);
  const exportHeaders = [
    ["purchaseOrderNo", "采购单号"],
    ["factoryName", "工厂信息"],
    ["warehouseName", "仓库"],
    ["purchaserName", "采购员"],
    ["productName", "品名"],
    ["sku", "SKU"],
    ["msku", "MSKU"],
    ["storeName", "店铺"],
    ["country", "国家"],
    ["imageUrl", "图片链接"],
    ["orderTime", "采购时间"],
    ["expectedArrivalTime", "预计到货时间"],
    ["unitPrice", "单价"],
    ["purchaseQuantity", "采购数量"],
    ["purchaseAmount", "采购金额"],
    ["shippedQuantity", "已发数量"],
    ["factoryRemainingQuantity", "工厂剩余库存"],
    ["fbaAvailable", "FBA可售"],
    ["fbaTransfer", "FBA转库"],
    ["fbaInbound", "FBA在途"],
  ];

  function todayDateText() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function setDefaultFactoryInventoryDates() {
    const startInput = root?.querySelector?.("#factory-inventory-start-date");
    const endInput = root?.querySelector?.("#factory-inventory-end-date");
    if (startInput && !startInput.value) startInput.value = "2026-03-01";
    if (endInput && !endInput.value) endInput.value = todayDateText();
  }

  function buildFactoryInventoryQuery({ forceRefresh = false } = {}) {
    const params = new URLSearchParams();
    const startDate = fieldValue("#factory-inventory-start-date", "", root) || "2026-03-01";
    const endDate = fieldValue("#factory-inventory-end-date", "", root);
    const factory = trimmedFieldValue("#factory-inventory-factory", "", root);
    const keyword = trimmedFieldValue("#factory-inventory-keyword", "", root);
    const onlyRemaining = checkedField("#factory-inventory-only-remaining", root);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (factory) params.set("factory", factory);
    if (keyword) params.set("keyword", keyword);
    if (onlyRemaining) params.set("onlyRemaining", "1");
    if (forceRefresh) params.set("forceRefresh", "1");
    return params.toString();
  }

  function populateFactoryInventoryOptions() {
    const datalist = root?.querySelector?.("#factory-inventory-factory-options");
    if (!datalist) return;
    const factories = factoryInventoryData.options?.factories?.length
      ? factoryInventoryData.options.factories
      : [...new Set((factoryInventoryData.rows || []).map((row) => row.factoryName).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
    datalist.innerHTML = factories.map((factory) => `<option value="${escapeHtml(factory)}"></option>`).join("");
  }

  function factoryInventorySortValue(row, key) {
    if (key === "productName") return `${row.productName || ""} ${row.sku || ""} ${row.msku || ""}`;
    return row?.[key];
  }

  function compareFactoryInventoryRows(left, right, key) {
    const leftValue = factoryInventorySortValue(left, key);
    const rightValue = factoryInventorySortValue(right, key);
    if (numericSortKeys.has(key)) {
      const leftNumber = Number(leftValue);
      const rightNumber = Number(rightValue);
      const leftValid = Number.isFinite(leftNumber);
      const rightValid = Number.isFinite(rightNumber);
      if (leftValid && rightValid) return leftNumber - rightNumber;
      if (leftValid) return -1;
      if (rightValid) return 1;
    }
    return compareTableSortableValues(leftValue, rightValue);
  }

  function getFactoryInventoryDisplayRows() {
    const rows = factoryInventoryData.rows || [];
    if (!factoryInventorySort.key) return rows;
    const multiplier = factoryInventorySort.direction === "asc" ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const result = compareFactoryInventoryRows(left.row, right.row, factoryInventorySort.key);
        return result === 0 ? left.index - right.index : result * multiplier;
      })
      .map(({ row }) => row);
  }

  function groupFactoryInventoryRows(rows = []) {
    const groups = [];
    const groupMap = new Map();
    rows.forEach((row) => {
      const key = row.purchaseOrderNo || row.id || "未关联采购单";
      let group = groupMap.get(key);
      if (!group) {
        group = {
          key,
          purchaseOrderNo: row.purchaseOrderNo || "-",
          factoryName: row.factoryName || "-",
          warehouseName: row.warehouseName || "",
          purchaserName: row.purchaserName || "",
          orderTime: row.orderTime || "",
          rows: [],
        };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.rows.push(row);
    });
    return groups.map((group) => {
      const purchaseQuantity = group.rows.reduce((total, row) => total + Number(row.purchaseQuantity || 0), 0);
      const purchaseAmount = group.rows.reduce((total, row) => total + Number(row.purchaseAmount || 0), 0);
      const entryQuantity = group.rows.reduce((total, row) => total + Number(row.entryQuantity || 0), 0);
      return {
        ...group,
        purchaseQuantity,
        purchaseAmount,
        entryQuantity,
        receiveQuantity: group.rows.reduce((total, row) => total + Number(row.receiveQuantity || 0), 0),
        expectedArrivalTime: group.rows.find((row) => row.expectedArrivalTime)?.expectedArrivalTime || "",
      };
    });
  }

  function summarizeFactoryInventoryRows(rows) {
    return {
      orderLineCount: rows.length,
      purchaseQuantity: rows.reduce((total, row) => total + Number(row.purchaseQuantity || 0), 0),
      purchaseAmount: rows.reduce((total, row) => total + Number(row.purchaseAmount || 0), 0),
      shippedQuantity: rows.reduce((total, row) => total + Number(row.shippedQuantity || 0), 0),
      factoryRemainingQuantity: rows.reduce((total, row) => total + Number(row.factoryRemainingQuantity || 0), 0),
      fbaAvailable: rows.reduce((total, row) => total + Number(row.fbaAvailable || 0), 0),
      fbaTransfer: rows.reduce((total, row) => total + Number(row.fbaTransfer || 0), 0),
      fbaInbound: rows.reduce((total, row) => total + Number(row.fbaInbound || 0), 0),
      fbaTotalStock: rows.reduce((total, row) => total + Number(row.fbaTotalStock || 0), 0),
    };
  }

  function formatFactoryInventoryPrice(value) {
    const number = Number(value || 0);
    if (!number) return "-";
    return `¥${formatActualMoney(number)}`;
  }

  function renderFactoryInventoryOrderGroup(group) {
    const orderMeta = [
      `供应商：${escapeHtml(group.factoryName || "-")}`,
      group.warehouseName ? `仓库：${escapeHtml(group.warehouseName)}` : "",
      group.purchaserName ? `采购员：${escapeHtml(group.purchaserName)}` : "",
      `总金额：¥${formatActualMoney(group.purchaseAmount || 0)}`,
      `到货量：${formatActualMoney(group.entryQuantity || 0)}/${formatActualMoney(group.purchaseQuantity || 0)}`,
    ].filter(Boolean).join("　");
    return `
      <tr class="factory-order-row">
        <td colspan="13">
          <div class="factory-order-strip">
            <strong>${escapeHtml(group.purchaseOrderNo || "-")}</strong>
            <span>${orderMeta}</span>
          </div>
        </td>
      </tr>
    `;
  }

  function renderFactoryInventoryItemRow(row) {
    const shippedStatus = row.shippedQuantitySource === "manual"
      ? `已手填${row.shippedQuantityUpdatedBy ? ` · ${escapeHtml(row.shippedQuantityUpdatedBy)}` : ""}`
      : "未手填";
    return `
      <tr class="factory-item-row">
        <td>${row.imageUrl ? `<img class="factory-inventory-image" src="${escapeHtml(cachedSalesImageUrl(row.imageUrl))}" alt="">` : `<span class="factory-image-placeholder">-</span>`}</td>
        <td><strong>${escapeHtml(row.productName || "-")}</strong><small>${escapeHtml(row.sku || "-")}</small></td>
        <td><strong>${escapeHtml(row.storeName || "-")}</strong><small>${escapeHtml(row.country || "")}</small></td>
        <td>${formatFactoryInventoryPrice(row.unitPrice)}</td>
        <td>${formatActualMoney(row.purchaseQuantity || 0)}</td>
        <td>¥${formatActualMoney(row.purchaseAmount || 0)}</td>
        <td><span>${escapeHtml(row.orderDate || row.orderTime || "-")}</span>${row.expectedArrivalTime ? `<small>预计 ${escapeHtml(row.expectedArrivalTime)}</small>` : ""}</td>
        <td><strong>${escapeHtml(row.msku || "-")}</strong></td>
        <td><input class="factory-shipped-input" data-factory-shipped-key="${escapeHtml(row.manualKey || "")}" inputmode="decimal" value="${escapeHtml(row.shippedQuantity || 0)}" aria-label="已发数量 ${escapeHtml(row.purchaseOrderNo || row.sku || "")}" /><small>${shippedStatus}</small></td>
        <td><strong>${formatActualMoney(row.factoryRemainingQuantity || 0)}</strong></td>
        <td>${formatActualMoney(row.fbaAvailable || 0)}</td>
        <td>${formatActualMoney(row.fbaTransfer || 0)}</td>
        <td>${formatActualMoney(row.fbaInbound || 0)}</td>
      </tr>
    `;
  }

  function renderFactoryInventorySortState() {
    setTableSortButtonGroupState("#factory-inventory-table button[data-factory-sort]", "factorySort", factoryInventorySort.key, factoryInventorySort.direction, root);
  }

  function applyFactoryInventorySort(key) {
    if (!key) return;
    factoryInventorySort = {
      key,
      direction: factoryInventorySort.key === key && factoryInventorySort.direction === "asc" ? "desc" : "asc",
    };
    renderFactoryInventory();
  }

  function renderFactoryInventory() {
    populateFactoryInventoryOptions();
    const rows = getFactoryInventoryDisplayRows();
    const visibleRows = rows.slice(0, visibleLimit);
    const summary = summarizeFactoryInventoryRows(rows);
    renderFactoryInventorySortState();
    setText("#factory-inventory-status", `${factoryInventoryData.meta?.source || "领星 ERP"} · ${factoryInventoryData.meta?.syncStatus || ""}`, root);
    setText("#factory-inventory-line-count", formatActualMoney(summary.orderLineCount || 0), root);
    setText("#factory-inventory-purchase-qty", formatActualMoney(summary.purchaseQuantity || 0), root);
    setText("#factory-inventory-purchase-amount", `¥ ${formatActualMoney(summary.purchaseAmount || 0)}`, root);
    setText("#factory-inventory-shipped-qty", formatActualMoney(summary.shippedQuantity || 0), root);
    setText("#factory-inventory-remaining-qty", formatActualMoney(summary.factoryRemainingQuantity || 0), root);
    setText("#factory-inventory-fba-available", formatActualMoney(summary.fbaAvailable || 0), root);
    setText("#factory-inventory-fba-transfer", formatActualMoney(summary.fbaTransfer || 0), root);
    setText("#factory-inventory-fba-inbound", formatActualMoney(summary.fbaInbound || 0), root);
    setText(
      "#factory-inventory-count",
      rows.length > visibleRows.length
        ? `共 ${rows.length} 条数据，当前显示前 ${visibleRows.length} 条`
        : `共 ${rows.length} 条数据`,
      root,
    );
    const tbody = root?.querySelector?.("#factory-inventory-table tbody");
    if (!tbody) return;
    if (!visibleRows.length) {
      renderTableMessage(tbody, 13, "暂无符合筛选条件的工厂库存数据。", root);
      return;
    }
    tbody.innerHTML = groupFactoryInventoryRows(visibleRows)
      .map((group) => `${renderFactoryInventoryOrderGroup(group)}${group.rows.map(renderFactoryInventoryItemRow).join("")}`)
      .join("");
  }

  async function loadFactoryInventory({ forceRefresh = false } = {}) {
    setDefaultFactoryInventoryDates();
    const query = buildFactoryInventoryQuery({ forceRefresh });
    const loadKey = query || "default";
    if (factoryInventoryLoadPromise && factoryInventoryLoadKey === loadKey) {
      return factoryInventoryLoadPromise;
    }
    const run = loadDashboardSection({
      endpoint: `/api/dashboard/factory-inventory?${query}`,
      buttonSelector: "#factory-inventory-refresh",
      busyText: "刷新中...",
      restoreText: "刷新库存",
      statusSelector: "#factory-inventory-status",
      loadingStatus: forceRefresh ? "正在实时读取采购单并复用销售预估 FBA 库存" : "正在读取工厂库存",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || data.meta?.syncStatus || "工厂库存读取失败",
      onData: (data) => {
        factoryInventoryData = data;
      },
      onError: (error) => {
        factoryInventoryData = { rows: [], summary: {}, options: { factories: [] }, meta: { source: "领星 ERP", syncStatus: `读取失败：${error.message}` } };
      },
      onFinally: renderFactoryInventory,
      root,
    });
    factoryInventoryLoadPromise = run;
    factoryInventoryLoadKey = loadKey;
    try {
      return await run;
    } finally {
      if (factoryInventoryLoadPromise === run) {
        factoryInventoryLoadPromise = null;
        factoryInventoryLoadKey = "";
      }
    }
  }

  function updateFactoryInventoryRowShippedQuantity(manualKey, shippedQuantity, savedRow = {}) {
    const row = (factoryInventoryData.rows || []).find((item) => item.manualKey === manualKey);
    if (!row) return;
    const quantity = Math.max(0, Number(shippedQuantity || 0));
    row.shippedQuantity = quantity;
    row.shippedQuantitySource = "manual";
    row.shippedQuantityUpdatedAt = savedRow.updatedAt || "";
    row.shippedQuantityUpdatedBy = savedRow.updatedBy || "";
    row.factoryRemainingQuantity = Math.max(0, Number(row.purchaseQuantity || 0) - quantity);
  }

  async function saveFactoryInventoryShippedQuantity(manualKey, shippedQuantity) {
    const response = await fetch("/api/dashboard/factory-inventory/shipped-quantity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manualKey, shippedQuantity }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "已发数量保存失败");
    updateFactoryInventoryRowShippedQuantity(data.manualKey || manualKey, data.row?.shippedQuantity ?? shippedQuantity, data.row || {});
    return data;
  }

  function scheduleFactoryInventoryShippedSave(input, { immediate = false, renderNow = false } = {}) {
    const manualKey = input?.dataset?.factoryShippedKey || "";
    if (!manualKey) return;
    const rawValue = String(input.value || "").trim();
    if (!rawValue && !immediate) return;
    const shippedQuantity = Number(rawValue || 0);
    if (!Number.isFinite(shippedQuantity)) return;
    const version = (factoryInventoryShippedSaveVersions.get(manualKey) || 0) + 1;
    factoryInventoryShippedSaveVersions.set(manualKey, version);
    updateFactoryInventoryRowShippedQuantity(manualKey, shippedQuantity);
    if (renderNow) renderFactoryInventory();
    windowApi?.clearTimeout?.(factoryInventoryShippedSaveTimers.get(manualKey));
    const timer = windowApi?.setTimeout?.(async () => {
      try {
        const result = await saveFactoryInventoryShippedQuantity(manualKey, shippedQuantity);
        if (factoryInventoryShippedSaveVersions.get(manualKey) !== version) return;
        setText("#factory-inventory-status", `已保存已发数量 · ${result.updatedAt || ""}`, root);
        renderFactoryInventory();
      } catch (error) {
        if (factoryInventoryShippedSaveVersions.get(manualKey) !== version) return;
        setText("#factory-inventory-status", `已发数量保存失败：${error.message}`, root);
      } finally {
        if (factoryInventoryShippedSaveVersions.get(manualKey) === version) {
          factoryInventoryShippedSaveTimers.delete(manualKey);
        }
      }
    }, immediate ? 0 : 500);
    factoryInventoryShippedSaveTimers.set(manualKey, timer);
  }

  function buildFactoryInventoryExportHtml(rows) {
    const headerHtml = exportHeaders.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
    const rowsHtml = rows.map((row) => `
      <tr>
        ${exportHeaders.map(([key]) => `<td>${escapeHtml(row[key] ?? "")}</td>`).join("")}
      </tr>
    `).join("");
    return `
      <html>
        <head><meta charset="UTF-8"></head>
        <body>
          <table border="1">
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="${exportHeaders.length}">暂无符合筛选条件的数据</td></tr>`}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  function exportFactoryInventoryExcel() {
    const rows = getFactoryInventoryDisplayRows();
    const startDate = fieldValue("#factory-inventory-start-date", "", root) || "2026-03-01";
    const endDate = fieldValue("#factory-inventory-end-date", "", root);
    const filename = `工厂库存_${startDate}_${endDate || "至今"}.xls`.replace(/[\\/:*?"<>|]/g, "-");
    const blob = new Blob([buildFactoryInventoryExportHtml(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
    downloadBlob(blob, filename, root);
  }

  const scheduleFactoryInventoryLoad = createDebouncedAction(() => loadFactoryInventory(), 350);

  function setupFactoryInventory() {
    bind(root, "#factory-inventory-refresh", "click", () => loadFactoryInventory({ forceRefresh: true }));
    bind(root, "#factory-inventory-export", "click", exportFactoryInventoryExcel);
    bind(root, "#factory-inventory-table thead", "click", (event) => {
      const header = closestTarget(event, "th[data-factory-sort]");
      if (!header) return;
      applyFactoryInventorySort(header.dataset.factorySort || "");
    });
    bind(root, "#factory-inventory-table tbody", "input", (event) => {
      const input = closestTarget(event, "[data-factory-shipped-key]");
      if (!input) return;
      scheduleFactoryInventoryShippedSave(input);
    });
    bind(root, "#factory-inventory-table tbody", "change", (event) => {
      const input = closestTarget(event, "[data-factory-shipped-key]");
      if (!input) return;
      scheduleFactoryInventoryShippedSave(input, { immediate: true, renderNow: true });
    });
    bind(root, "#factory-inventory-table tbody", "focusout", (event) => {
      const input = closestTarget(event, "[data-factory-shipped-key]");
      if (!input) return;
      scheduleFactoryInventoryShippedSave(input, { immediate: true, renderNow: true });
    });
    bindAll(root, "#factory-inventory-table .factory-inventory-sort-button", "click", function handleFactoryInventorySortButtonClick(event) {
      event.preventDefault();
      event.stopPropagation();
      applyFactoryInventorySort(this.dataset.factorySort || "");
    });
    bind(root, "#factory-inventory-start-date", "change", scheduleFactoryInventoryLoad);
    bind(root, "#factory-inventory-end-date", "change", scheduleFactoryInventoryLoad);
    bind(root, "#factory-inventory-factory", "input", scheduleFactoryInventoryLoad);
    bind(root, "#factory-inventory-keyword", "input", scheduleFactoryInventoryLoad);
    bind(root, "#factory-inventory-only-remaining", "change", scheduleFactoryInventoryLoad);
  }

  return {
    applyFactoryInventorySort,
    exportFactoryInventoryExcel,
    loadFactoryInventory,
    renderFactoryInventory,
    scheduleFactoryInventoryShippedSave,
    setDefaultFactoryInventoryDates,
    setupFactoryInventory,
  };
}

const TABLE_SELECTOR = ".table-wrap table, .table-scroll table, table.data-table";
const MIN_COLUMN_WIDTH = 44;
const DEFAULT_COLUMN_WIDTH = 112;
const DEFAULT_SCROLL_HINT = "横向滚动查看更多列";

const numericHeaderPattern = /(金额|销售额|采购额|应付额|实付额|未付额|数量|销量|采购量|库存|在库|可售|转库|在途|成本|费用|费率|毛利率|净利率|退款率|达成率|占比|税点|采购价|单价|价格|天数|ACOS|ROAS|CPC|CTR|CVR|订单|目标|实际|利润|收入|支出|回款|结算|余额|计提|货件数|店铺数|MSKU\s*数|SKU\s*数|总数|小计|合计|比例|率)$/i;
const textHeaderPattern = /(名称|产品|店铺|国家|负责人|供应商|图片|状态|操作|时间|日期|币种|编码|单号|型号|备注|内容|链接|目录|文件夹|标题|账号|角色|来源|阶段|建议|结论|周期|模块|对象|指标|类型|仓库|承运商|运输方式|feedback|review|ASIN|MSKU|SKU|FNSKU)$/i;
const errorStatePattern = /失败|错误|异常|缺少|missing|error/i;
const loadingStatePattern = /正在|等待|读取|加载|同步|生成中/;

export function normalizeColumnWidth(value, fallback = DEFAULT_COLUMN_WIDTH) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(MIN_COLUMN_WIDTH, Math.round(number));
}

export function inferTableColumnKind(label = "") {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text) return "text";
  if (textHeaderPattern.test(text)) return "text";
  if (numericHeaderPattern.test(text)) return "number";
  return "text";
}

export function inferTableStateTone(message = "") {
  const text = String(message || "");
  if (errorStatePattern.test(text)) return "error";
  if (loadingStatePattern.test(text)) return "loading";
  return "empty";
}

export function classifyDataTableVariant({ className = "", columnCount = 0 } = {}) {
  const classes = String(className || "");
  if (classes.includes("sales-forecast-table")) return "matrix";
  if (columnCount >= 14) return "wide";
  return "standard";
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function getLeafHeaderCells(table) {
  const rows = Array.from(table?.tHead?.rows || []);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const cells = Array.from(rows[index].cells || []).filter((cell) => cell.tagName === "TH" && Number(cell.colSpan || 1) === 1);
    if (cells.length) return cells;
  }
  return Array.from(table?.querySelectorAll?.("thead th") || []).filter((cell) => Number(cell.colSpan || 1) === 1);
}

function getColumnCount(table) {
  const leafHeaders = getLeafHeaderCells(table);
  if (leafHeaders.length) return leafHeaders.length;
  return Math.max(0, ...Array.from(table?.rows || []).map((row) => Array.from(row.cells || []).reduce((sum, cell) => sum + Number(cell.colSpan || 1), 0)));
}

function getTableWrap(table) {
  return table?.closest?.(".table-wrap, .table-scroll") || table?.parentElement || null;
}

function setColumnWidth(table, index, width) {
  const col = table?.querySelector?.(`colgroup col[data-column-index="${cssEscape(index)}"]`);
  if (!col) return;
  const normalized = normalizeColumnWidth(width);
  col.style.width = `${normalized}px`;
  col.dataset.userWidth = String(normalized);
  table.classList.add("is-column-resized");
}

function ensureColGroup(table, columnCount) {
  let colgroup = table.querySelector(":scope > colgroup");
  if (!colgroup) {
    colgroup = table.ownerDocument.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < columnCount) {
    const col = table.ownerDocument.createElement("col");
    col.dataset.columnIndex = String(colgroup.children.length);
    colgroup.appendChild(col);
  }
  while (colgroup.children.length > columnCount) {
    colgroup.lastElementChild.remove();
  }
  Array.from(colgroup.children).forEach((col, index) => {
    col.dataset.columnIndex = String(index);
  });
  return colgroup;
}

function columnWidthFromCell(cell) {
  const rectWidth = cell?.getBoundingClientRect?.().width;
  if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
  const offsetWidth = cell?.offsetWidth;
  if (Number.isFinite(offsetWidth) && offsetWidth > 0) return offsetWidth;
  return DEFAULT_COLUMN_WIDTH;
}

function lockCurrentColumnWidths(table) {
  const headers = getLeafHeaderCells(table);
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  columns.forEach((col, index) => {
    if (col.dataset.userWidth) return;
    const width = columnWidthFromCell(headers[index]) || DEFAULT_COLUMN_WIDTH;
    col.style.width = `${normalizeColumnWidth(width)}px`;
  });
  table.classList.add("is-column-resized");
}

function markColumnKinds(table) {
  const headers = getLeafHeaderCells(table);
  const kinds = headers.map((header) => inferTableColumnKind(header.textContent || ""));
  headers.forEach((header, index) => {
    header.dataset.columnIndex = String(index);
    header.dataset.columnKind = kinds[index];
    header.classList.toggle("table-cell--number", kinds[index] === "number");
  });
  Array.from(table.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      Array.from(row.cells || []).forEach((cell, index) => {
        if (Number(cell.colSpan || 1) > 1) return;
        const kind = kinds[index] || "text";
        cell.dataset.columnKind = kind;
        cell.classList.toggle("table-cell--number", kind === "number");
      });
    });
  });
  return kinds;
}

function markStateRows(table) {
  Array.from(table.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      const firstCell = row.cells?.[0];
      if (!firstCell || Number(firstCell.colSpan || 1) <= 1 || row.cells.length !== 1) return;
      const tone = inferTableStateTone(firstCell.textContent || "");
      row.classList.remove("table-state-row--loading", "table-state-row--empty", "table-state-row--error");
      firstCell.classList.remove("table-state-cell--loading", "table-state-cell--empty", "table-state-cell--error");
      row.classList.add("table-state-row", `table-state-row--${tone}`);
      firstCell.classList.add("table-state-cell", `table-state-cell--${tone}`);
    });
  });
}

function ensureResizeHandles(table) {
  getLeafHeaderCells(table).forEach((header, index) => {
    header.dataset.columnIndex = String(index);
    if (header.querySelector(":scope > .table-resize-handle")) return;
    const handle = table.ownerDocument.createElement("span");
    handle.className = "table-resize-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", `调整 ${String(header.textContent || "").trim() || `第 ${index + 1} 列`} 列宽`);
    handle.dataset.columnIndex = String(index);
    header.appendChild(handle);
  });
}

function getColumnPixelWidth(table, index) {
  const col = table.querySelector(`:scope > colgroup > col[data-column-index="${cssEscape(index)}"]`);
  const explicit = Number.parseFloat(col?.style?.width || "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const header = getLeafHeaderCells(table)[index];
  return normalizeColumnWidth(columnWidthFromCell(header));
}

function updateStickyOffsets(table) {
  const headers = getLeafHeaderCells(table);
  const stickyIndexes = headers
    .map((header, index) => (header.classList.contains("sticky-col") ? index : -1))
    .filter((index) => index >= 0);
  if (!stickyIndexes.length) return;

  let left = 0;
  stickyIndexes.forEach((index) => {
    const width = getColumnPixelWidth(table, index);
    const selector = `thead tr:last-child th:nth-child(${index + 1}), tbody tr > td:nth-child(${index + 1})`;
    table.querySelectorAll(selector).forEach((cell) => {
      if (!cell.classList.contains("sticky-col")) return;
      cell.style.left = `${left}px`;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
    });
    left += width;
  });

  table.querySelectorAll(".sticky-product-group").forEach((cell) => {
    cell.style.left = "0px";
    cell.style.minWidth = `${left}px`;
  });
}

function updateScrollHint(table) {
  const wrap = getTableWrap(table);
  if (!wrap) return;
  const hasOverflow = wrap.scrollWidth > wrap.clientWidth + 2;
  wrap.classList.toggle("has-horizontal-overflow", hasOverflow);
  wrap.classList.toggle("is-scrolled-start", !hasOverflow || wrap.scrollLeft <= 1);
  wrap.classList.toggle("is-scrolled-end", !hasOverflow || wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1);
  if (hasOverflow && !wrap.dataset.scrollHint) wrap.dataset.scrollHint = DEFAULT_SCROLL_HINT;
}

function enhanceTable(table) {
  if (!table || table.closest(".login-body")) return null;
  const columnCount = getColumnCount(table);
  if (!columnCount) return null;
  const wrap = getTableWrap(table);
  const variant = classifyDataTableVariant({ className: table.className, columnCount });
  table.classList.add("data-table", `data-table--${variant}`);
  table.dataset.tableManaged = "true";
  table.dataset.columnCount = String(columnCount);
  if (wrap) {
    wrap.classList.add("data-table-wrap");
    wrap.dataset.tableVariant = variant;
  }
  ensureColGroup(table, columnCount);
  markColumnKinds(table);
  markStateRows(table);
  ensureResizeHandles(table);
  updateStickyOffsets(table);
  updateScrollHint(table);
  return table;
}

export function createDataTableManager({
  root = globalThis.document,
  windowRef = globalThis,
  tableSelector = TABLE_SELECTOR,
} = {}) {
  let activeResize = null;
  let mutationObserver = null;

  function enhanceAll() {
    const tables = Array.from(root?.querySelectorAll?.(tableSelector) || []);
    return tables.map(enhanceTable).filter(Boolean);
  }

  function refreshTable(table) {
    const enhanced = enhanceTable(table);
    if (enhanced) updateStickyOffsets(enhanced);
    return enhanced;
  }

  function handlePointerDown(event) {
    const handle = event.target?.closest?.(".table-resize-handle");
    if (!handle) return;
    const table = handle.closest("table");
    const header = handle.closest("th");
    if (!table || !header) return;
    const columnIndex = Number.parseInt(handle.dataset.columnIndex || header.dataset.columnIndex || "", 10);
    if (!Number.isFinite(columnIndex)) return;
    lockCurrentColumnWidths(table);
    const startWidth = getColumnPixelWidth(table, columnIndex);
    activeResize = {
      table,
      columnIndex,
      startX: event.clientX,
      startWidth,
    };
    table.classList.add("is-resizing-column");
    root?.body?.classList?.add("is-table-column-resizing");
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!activeResize) return;
    const nextWidth = activeResize.startWidth + (event.clientX - activeResize.startX);
    setColumnWidth(activeResize.table, activeResize.columnIndex, nextWidth);
    updateStickyOffsets(activeResize.table);
    updateScrollHint(activeResize.table);
  }

  function finishResize() {
    if (!activeResize) return;
    activeResize.table.classList.remove("is-resizing-column");
    updateStickyOffsets(activeResize.table);
    updateScrollHint(activeResize.table);
    activeResize = null;
    root?.body?.classList?.remove("is-table-column-resizing");
  }

  function bindTableWrapScroll() {
    root?.querySelectorAll?.(".table-wrap, .table-scroll").forEach((wrap) => {
      if (wrap.dataset.tableScrollBound === "true") return;
      wrap.dataset.tableScrollBound = "true";
      wrap.addEventListener("scroll", () => {
        wrap.querySelectorAll("table").forEach(updateScrollHint);
      }, { passive: true });
    });
  }

  function setupMutationObserver() {
    if (!windowRef.MutationObserver || !root?.body || mutationObserver) return null;
    mutationObserver = new windowRef.MutationObserver((mutations) => {
      if (!mutations.some((mutation) => mutation.type === "childList")) return;
      enhanceAll();
      bindTableWrapScroll();
    });
    mutationObserver.observe(root.body, { childList: true, subtree: true });
    return mutationObserver;
  }

  function setupDataTables() {
    enhanceAll();
    bindTableWrapScroll();
    root?.addEventListener?.("pointerdown", handlePointerDown);
    windowRef?.addEventListener?.("pointermove", handlePointerMove);
    windowRef?.addEventListener?.("pointerup", finishResize);
    windowRef?.addEventListener?.("resize", () => {
      enhanceAll();
      bindTableWrapScroll();
    });
    setupMutationObserver();
    return {
      enhanceAll,
      refreshTable,
      teardown,
    };
  }

  function teardown() {
    root?.removeEventListener?.("pointerdown", handlePointerDown);
    windowRef?.removeEventListener?.("pointermove", handlePointerMove);
    windowRef?.removeEventListener?.("pointerup", finishResize);
    mutationObserver?.disconnect?.();
    mutationObserver = null;
  }

  return {
    enhanceAll,
    refreshTable,
    setupDataTables,
    teardown,
  };
}

export default createDataTableManager;

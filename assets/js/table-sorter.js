export function getTableCellSortableText(row, index) {
  return String(row?.cells?.[index]?.textContent || "").replace(/\s+/g, " ").trim();
}

export function parseTableSortableNumber(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return null;
  const hasYi = raw.includes("亿");
  const hasWan = raw.includes("万");
  const normalized = raw
    .replace(/[¥￥$€£,%]/g, "")
    .replace(/[,\s]/g, "")
    .replace(/[亿万]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  if (hasYi) return number * 100000000;
  if (hasWan) return number * 10000;
  return number;
}

export function parseTableSortableDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/年](\d{1,2})(?:[-/月](\d{1,2}))?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] || 1);
  const time = new Date(year, month - 1, day).getTime();
  return Number.isFinite(time) ? time : null;
}

export function compareTableSortableValues(left, right) {
  const leftText = String(left || "").trim();
  const rightText = String(right || "").trim();
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  const leftNumber = parseTableSortableNumber(leftText);
  const rightNumber = parseTableSortableNumber(rightText);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  const leftDate = parseTableSortableDate(leftText);
  const rightDate = parseTableSortableDate(rightText);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  return leftText.localeCompare(rightText, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function isFixedSortRow(row) {
  const firstCell = String(row?.cells?.[0]?.textContent || "").trim();
  return row?.querySelector("td[colspan]") || /^(合计|总计|汇总)$/.test(firstCell);
}

export function createTableSorter({
  bindEventTarget = null,
  closestTarget = null,
  getApplyFactoryInventorySort = () => null,
  getApplyMskuDetailSort = () => null,
  getApplySupplierBoardSort = () => null,
  getApplyStoreOperatingMonthlyReportSort = () => null,
  root = globalThis.document,
  setTableSortState,
} = {}) {
  if (typeof setTableSortState !== "function") throw new Error("createTableSorter requires setTableSortState.");

  function isFeatureOwnedSortButton(button) {
    return Boolean(button?.dataset?.mskuSort || button?.dataset?.supplierSort || button?.dataset?.factorySort);
  }

  function sortTableByHeader(th) {
    if (!th || th.closest(".login-body")) return;
    const table = th.closest("table");
    if (table?.id === "supplier-board-table") {
      getApplySupplierBoardSort()?.(th.dataset.supplierSort || th.querySelector("[data-supplier-sort]")?.dataset.supplierSort || "");
      return;
    }
    if (table?.id === "factory-inventory-table") {
      getApplyFactoryInventorySort()?.(th.dataset.factorySort || th.querySelector("[data-factory-sort]")?.dataset.factorySort || "");
      return;
    }
    if (table?.id === "store-operating-report-table") {
      getApplyStoreOperatingMonthlyReportSort()?.(th.dataset.columnKey || "");
      return;
    }
    const mskuSortButton = th.querySelector("[data-msku-sort]");
    if (mskuSortButton) {
      getApplyMskuDetailSort()?.(mskuSortButton.dataset.mskuSort);
      return;
    }
    const tbody = table?.tBodies?.[0];
    const headerRow = th.parentElement;
    if (!table || !tbody || !headerRow || th.colSpan > 1) return;
    const columnIndex = Array.from(headerRow.children).indexOf(th);
    if (columnIndex < 0) return;
    const nextDirection = table.dataset.sortColumn === String(columnIndex) && table.dataset.sortDirection === "asc" ? "desc" : "asc";
    const multiplier = nextDirection === "asc" ? 1 : -1;
    const sortableRows = [];
    const fixedRows = [];
    Array.from(tbody.rows).forEach((row, index) => {
      if (isFixedSortRow(row) || row.cells.length <= columnIndex) {
        fixedRows.push(row);
        return;
      }
      sortableRows.push({ row, index });
    });
    if (!sortableRows.length) return;
    sortableRows.sort((left, right) => {
      const result = compareTableSortableValues(
        getTableCellSortableText(left.row, columnIndex),
        getTableCellSortableText(right.row, columnIndex),
      );
      return result === 0 ? left.index - right.index : result * multiplier;
    });
    Array.from(headerRow.children).forEach((header) => {
      setTableSortState(header, false, nextDirection, header.querySelector?.(".sort-button") || null);
    });
    setTableSortState(th, true, nextDirection, th.querySelector?.(".sort-button") || null);
    table.dataset.sortColumn = String(columnIndex);
    table.dataset.sortDirection = nextDirection;
    sortableRows.forEach(({ row }) => tbody.appendChild(row));
    fixedRows.forEach((row) => tbody.appendChild(row));
  }

  function setupTableSortBridge() {
    if (typeof bindEventTarget !== "function") throw new Error("setupTableSortBridge requires bindEventTarget.");
    if (typeof closestTarget !== "function") throw new Error("setupTableSortBridge requires closestTarget.");
    return bindEventTarget(root, "click", (event) => {
      const sortButton = closestTarget(event, ".sort-button");
      if (sortButton) {
        if (isFeatureOwnedSortButton(sortButton)) return;
        sortTableByHeader(sortButton.closest?.("th"));
        return;
      }
      sortTableByHeader(closestTarget(event, "th"));
    });
  }

  return {
    setupTableSortBridge,
    sortTableByHeader,
  };
}

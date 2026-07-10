export function createSalesShell({
  root = globalThis.document,
  bind,
  bindAll,
  bindClickOutside,
  fieldValue,
  formatDate,
  getDateRangeByPreset,
  getDefaultFrontDateRange,
  onDateRangeChange = () => {},
  setElementsHidden,
  setText,
} = {}) {
  if (typeof bind !== "function") throw new Error("createSalesShell requires bind.");
  if (typeof bindAll !== "function") throw new Error("createSalesShell requires bindAll.");
  if (typeof bindClickOutside !== "function") throw new Error("createSalesShell requires bindClickOutside.");
  if (typeof fieldValue !== "function") throw new Error("createSalesShell requires fieldValue.");
  if (typeof formatDate !== "function") throw new Error("createSalesShell requires formatDate.");
  if (typeof getDateRangeByPreset !== "function") throw new Error("createSalesShell requires getDateRangeByPreset.");
  if (typeof getDefaultFrontDateRange !== "function") throw new Error("createSalesShell requires getDefaultFrontDateRange.");
  if (typeof setElementsHidden !== "function") throw new Error("createSalesShell requires setElementsHidden.");
  if (typeof setText !== "function") throw new Error("createSalesShell requires setText.");

  let frontDateRange = getDefaultFrontDateRange();

  function getFrontDateRange() {
    return { ...frontDateRange };
  }

  function getFrontDateEnd() {
    return frontDateRange.end;
  }

  function showLocalFileWarning() {
    const warning = root.createElement("div");
    warning.className = "environment-warning";
    warning.innerHTML = `
      <strong>当前打开的是本地预览文件，无法连接领星 ERP。</strong>
      <span>请改用服务器地址访问：<a href="http://47.107.92.14/">http://47.107.92.14/</a></span>
    `;
    root.body.prepend(warning);
  }

  function removeLegacySalesLayout() {
    root.querySelector("#view-sales .insight-row")?.remove();
    root.querySelector("#updated-at")?.remove();
  }

  function updateFrontDateRange(start, end) {
    frontDateRange = { start, end };
    const startInput = root.querySelector("#front-date-start");
    const endInput = root.querySelector("#front-date-end");
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;
    setText("#front-date-range-button", `${start} - ${end}`, root);
    return getFrontDateRange();
  }

  function resetFrontDateRange() {
    const nextRange = getDefaultFrontDateRange();
    return updateFrontDateRange(nextRange.start, nextRange.end);
  }

  function setFrontDatePopoverOpen(open) {
    const popover = root.querySelector("#front-date-range-popover");
    return setElementsHidden(popover, !open)[0] || null;
  }

  function closeFrontDatePopover() {
    return setFrontDatePopoverOpen(false);
  }

  function toggleFrontDatePopover() {
    const popover = root.querySelector("#front-date-range-popover");
    if (!popover) return null;
    return setFrontDatePopoverOpen(popover.hidden);
  }

  function applyFrontDatePreset(preset) {
    const [start, end] = getDateRangeByPreset(preset);
    updateFrontDateRange(formatDate(start), formatDate(end));
    closeFrontDatePopover();
    return getFrontDateRange();
  }

  function applyFrontDateInputs() {
    const start = fieldValue("#front-date-start", frontDateRange.start, root) || frontDateRange.start;
    const end = fieldValue("#front-date-end", frontDateRange.end, root) || frontDateRange.end;
    updateFrontDateRange(start <= end ? start : end, start <= end ? end : start);
    closeFrontDatePopover();
    return getFrontDateRange();
  }

  function syncSalesToolbarVisibility(viewOrActive) {
    const salesActive = typeof viewOrActive === "boolean" ? viewOrActive : viewOrActive === "sales";
    setElementsHidden("#sales-global-filters", !salesActive, root);
  }

  function placeSalesFiltersAfterBreadcrumb() {
    const filters = root.querySelector("#sales-global-filters");
    const salesHero = root.querySelector("#view-sales > .module-hero");
    if (!filters || !salesHero || filters.previousElementSibling === salesHero) return;
    salesHero.after(filters);
  }

  function setupFrontDateRangeControls() {
    bind(root, "#front-date-range-button", "click", toggleFrontDatePopover);
    bindAll(root, "[data-range-preset]", "click", function handleDateRangePresetClick() {
      applyFrontDatePreset(this.dataset.rangePreset);
      onDateRangeChange();
    });
    bind(root, "#front-date-apply", "click", () => {
      applyFrontDateInputs();
      onDateRangeChange();
    });
    bindClickOutside(root, ".date-range-control", () => {
      if (!root.querySelector(".date-range-control")) return;
      closeFrontDatePopover();
    });
  }

  return {
    applyFrontDateInputs,
    applyFrontDatePreset,
    closeFrontDatePopover,
    getFrontDateEnd,
    getFrontDateRange,
    placeSalesFiltersAfterBreadcrumb,
    removeLegacySalesLayout,
    resetFrontDateRange,
    setupFrontDateRangeControls,
    showLocalFileWarning,
    syncSalesToolbarVisibility,
    toggleFrontDatePopover,
    updateFrontDateRange,
  };
}

const tanjiaUiGlobal = globalThis.window || globalThis;

  function formatNumber(value) {
    return typeof value === "number" ? value.toLocaleString("zh-CN") : value;
  }

  function setText(selector, value, root = tanjiaUiGlobal.document) {
    const element = root?.querySelector?.(selector);
    if (element) element.textContent = value;
    return element || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function renderDataValueButtonsHtml(items = [], dataAttribute, activeValue = "", { allLabel = "", allValue = "" } = {}) {
    const normalizedActiveValue = String(activeValue ?? "");
    const buttonHtml = (label, value) => {
      const normalizedValue = String(value ?? "");
      const activeClass = normalizedValue === normalizedActiveValue ? ` class="active"` : "";
      return `<button${activeClass} type="button" ${dataAttribute}="${escapeHtml(normalizedValue)}">${escapeHtml(label)}</button>`;
    };
    return [
      allLabel ? buttonHtml(allLabel, allValue) : "",
      ...(items || []).map((item) => buttonHtml(item, item)),
    ].filter(Boolean).join("");
  }

  function resolveElement(selectorOrElement, root = tanjiaUiGlobal.document) {
    return typeof selectorOrElement === "string" ? root?.querySelector?.(selectorOrElement) : selectorOrElement;
  }

  function resolveElements(selectorOrElements, root = tanjiaUiGlobal.document) {
    if (typeof selectorOrElements === "string") return [...(root?.querySelectorAll?.(selectorOrElements) || [])];
    if (!selectorOrElements) return [];
    if (selectorOrElements?.[Symbol.iterator]) return [...selectorOrElements].filter(Boolean);
    return [selectorOrElements].filter(Boolean);
  }

  function fieldValue(selectorOrElement, fallback = "", root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element) return fallback;
    return element.value ?? fallback;
  }

  function trimmedFieldValue(selectorOrElement, fallback = "", root = tanjiaUiGlobal.document) {
    return String(fieldValue(selectorOrElement, fallback, root)).trim();
  }

  function checkedField(selectorOrElement, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    return element?.checked === true;
  }

  function formatMoney(value) {
    const number = Number(value || 0);
    if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
    return number.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }

  function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(2)}%`;
  }

  function formatActualMoney(value) {
    return Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function formatRateNullable(value) {
    return value === null || value === undefined || value === "" ? "-" : `${(Number(value || 0) * 100).toFixed(2)}%`;
  }

  function formatMetricNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function parseNumber(value) {
    const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function parseDisplayPercent(value) {
    const number = Number(String(value || "").replace("%", ""));
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeCountryName(country) {
    const value = String(country || "").trim();
    const map = {
      AU: "澳洲",
      BR: "巴西",
      CA: "加拿大",
      MX: "墨西哥",
      US: "美国",
      USA: "美国",
    };
    return map[value.toUpperCase()] || value || "-";
  }

  function selectedFilterValues(selectorOrElement, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element) return [];
    if (!element.multiple) {
      const value = String(element.value || "").trim();
      return value ? [value] : [];
    }
    return [...element.selectedOptions]
      .map((option) => String(option.value || "").trim())
      .filter(Boolean);
  }

  function selectedFilterValue(selectorOrElement, root = tanjiaUiGlobal.document) {
    return selectedFilterValues(selectorOrElement, root).join(",");
  }

  function normalizeFilterOption(item) {
    if (typeof item === "string") return { value: item, label: item, country: "" };
    const value = String(item?.value ?? item?.name ?? item?.label ?? "").trim();
    const rawCountry = String(item?.country || "").trim();
    return {
      value,
      label: String(item?.label ?? item?.name ?? value).trim(),
      country: rawCountry ? normalizeCountryName(rawCountry) : "",
    };
  }

  function normalizeFilterOptions(options = []) {
    return (options || [])
      .map(normalizeFilterOption)
      .filter((item) => item.value && item.label);
  }

  function filterStoreOptionsByCountries(storeOptions = [], countries = []) {
    const countrySet = new Set((countries || []).map(normalizeCountryName).filter((item) => item && item !== "-"));
    return normalizeFilterOptions(storeOptions).filter((item) => !countrySet.size || countrySet.has(item.country));
  }

  function bind(root, selector, eventName, handler, options) {
    const element = root?.querySelector?.(selector);
    if (!element) return null;
    element.addEventListener(eventName, handler, options);
    return element;
  }

  function bindAll(root, selector, eventName, handler, options) {
    const elements = [...(root?.querySelectorAll?.(selector) || [])];
    elements.forEach((element) => element.addEventListener(eventName, handler, options));
    return elements;
  }

  function bindDelegated(root, selector, eventName, targetSelector, handler, options) {
    return bind(root, selector, eventName, (event) => {
      const target = closestTarget(event, targetSelector);
      if (!target) return;
      if (event.currentTarget?.contains && !event.currentTarget.contains(target)) return;
      handler(target, event);
    }, options);
  }

  function bindEventTarget(target, eventName, handler, options) {
    if (!target?.addEventListener) return null;
    target.addEventListener(eventName, handler, options);
    return target;
  }

  function isVisibleElement(selectorOrElement, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    return Boolean(element && !element.hidden && !element.closest?.("[hidden]"));
  }

  function setAriaExpanded(selectorOrElement, expanded, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element?.setAttribute) return null;
    element.setAttribute("aria-expanded", String(Boolean(expanded)));
    return element;
  }

  function setDisclosureState(panelTarget, toggleTarget, expanded, root = tanjiaUiGlobal.document) {
    const panel = resolveElement(panelTarget, root);
    const toggle = setAriaExpanded(toggleTarget, expanded, root);
    if (panel) panel.hidden = !Boolean(expanded);
    return { panel: panel || null, toggle };
  }

  function setDisclosureGroupState(panelsTarget, expanded, { except = null, toggleForPanel = null, root = tanjiaUiGlobal.document } = {}) {
    const panels = resolveElements(panelsTarget, root);
    const exceptPanel = resolveElement(except, root);
    panels.forEach((panel) => {
      if (panel === exceptPanel) return;
      const toggle = typeof toggleForPanel === "function" ? toggleForPanel(panel) : null;
      setDisclosureState(panel, toggle, expanded, root);
    });
    return panels;
  }

  function setModalOpenState(modalTarget, open, root = tanjiaUiGlobal.document) {
    const modal = resolveElement(modalTarget, root);
    if (!modal) {
      if (!open) root?.body?.classList?.remove?.("modal-open");
      return null;
    }
    const dialog = modal.matches?.("article") ? modal : modal.querySelector?.("article");
    if (dialog?.setAttribute) {
      dialog.setAttribute("role", dialog.getAttribute?.("role") || "dialog");
      dialog.setAttribute("aria-modal", dialog.getAttribute?.("aria-modal") || "true");
    }
    modal.hidden = !Boolean(open);
    root?.body?.classList?.toggle("modal-open", Boolean(open));
    return modal;
  }

  function setExpandedClassState(containerTarget, toggleTarget, expanded, className = "is-open", root = tanjiaUiGlobal.document) {
    const container = resolveElement(containerTarget, root);
    const toggle = setAriaExpanded(toggleTarget, expanded, root);
    if (container?.classList) container.classList.toggle(className, Boolean(expanded));
    return { container: container || null, toggle };
  }

  function setTableSortState(headerTarget, active, direction = "", buttonTarget = null, root = tanjiaUiGlobal.document) {
    const header = resolveElement(headerTarget, root);
    const button = resolveElement(buttonTarget, root);
    const isActive = Boolean(active);
    const normalizedDirection = isActive && direction === "desc" ? "desc" : isActive ? "asc" : "";
    if (header?.classList) {
      header.classList.toggle("table-sort-active", isActive);
      header.classList.toggle("table-sort-asc", normalizedDirection === "asc");
      header.classList.toggle("table-sort-desc", normalizedDirection === "desc");
      if (isActive) {
        header.setAttribute?.("aria-sort", normalizedDirection === "asc" ? "ascending" : "descending");
      } else {
        header.removeAttribute?.("aria-sort");
      }
    }
    if (button?.classList) {
      button.classList.toggle("active", isActive);
      if (button.dataset) button.dataset.direction = normalizedDirection;
    }
    return { header: header || null, button: button || null };
  }

  function setTableSortButtonGroupState(buttonsTarget, datasetKey, activeKey, direction = "asc", root = tanjiaUiGlobal.document) {
    const buttons = resolveElements(buttonsTarget, root);
    const normalizedActiveKey = String(activeKey ?? "");
    buttons.forEach((button) => {
      const header = button?.closest?.("th") || null;
      const isActive = String(button?.dataset?.[datasetKey] ?? "") === normalizedActiveKey;
      setTableSortState(header, isActive, direction, button, root);
    });
    return buttons;
  }

  function setActiveElementState(targets, activeTarget, className = "active", root = tanjiaUiGlobal.document) {
    const elements = resolveElements(targets, root);
    const activeElement = resolveElement(activeTarget, root);
    elements.forEach((element) => {
      element?.classList?.toggle(className, element === activeElement);
    });
    return elements;
  }

  function setActiveDatasetValueState(targets, datasetKey, activeValue, root = tanjiaUiGlobal.document, className = "active") {
    const elements = resolveElements(targets, root);
    const normalizedActiveValue = String(activeValue ?? "");
    elements.forEach((element) => {
      element?.classList?.toggle(className, String(element?.dataset?.[datasetKey] ?? "") === normalizedActiveValue);
    });
    return elements;
  }

  function setClassStateMap(selectorOrElement, classStates = {}, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element?.classList) return element || null;
    Object.entries(classStates || {}).forEach(([className, active]) => {
      element.classList.toggle(className, Boolean(active));
    });
    return element;
  }

  function setExclusiveClassState(selectorOrElement, classNames = [], activeClass = "", root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element?.classList) return element || null;
    (classNames || []).forEach((className) => {
      if (className) element.classList.remove(className);
    });
    if (activeClass) element.classList.add(activeClass);
    return element;
  }

  function setStatusMessage(selectorOrElement, message, tone = "", root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element) return null;
    element.textContent = message;
    element.classList?.toggle("status-danger", tone === "danger");
    element.classList?.toggle("status-success", tone === "success");
    return element;
  }

  function setSelectedElementState(targets, selectedTarget, root = tanjiaUiGlobal.document) {
    const elements = setActiveElementState(targets, selectedTarget, "active", root);
    const selectedElement = resolveElement(selectedTarget, root);
    elements.forEach((element) => {
      element?.setAttribute?.("aria-selected", String(element === selectedElement));
    });
    return elements;
  }

  function clickVisibleElement(selectorOrElement, root = tanjiaUiGlobal.document) {
    const element = resolveElement(selectorOrElement, root);
    if (!element?.click || !isVisibleElement(element)) return null;
    element.click();
    return element;
  }

  function closestFromTarget(target, selector) {
    return target?.closest?.(selector) || target?.parentElement?.closest?.(selector) || null;
  }

  function closestTarget(eventOrTarget, selector) {
    return closestFromTarget(eventOrTarget?.target || eventOrTarget, selector);
  }

  function bindClickOutside(root, insideTarget, handler, options) {
    if (!root?.addEventListener) return null;
    const listener = (event) => {
      const target = event?.target;
      const isInside = typeof insideTarget === "string"
        ? Boolean(closestFromTarget(target, insideTarget))
        : Boolean(insideTarget?.contains?.(target));
      if (isInside) return;
      handler(event);
    };
    root.addEventListener("click", listener, options);
    return listener;
  }

  function bindBackdropClose(root, selectorOrElement, handler, options) {
    const backdrop = resolveElement(selectorOrElement, root);
    if (!backdrop?.addEventListener) return null;
    const listener = (event) => {
      if (event?.target === backdrop) handler(event);
    };
    backdrop.addEventListener("click", listener, options);
    return listener;
  }

  function createDebouncedAction(callback, delayMs = 350, timerApi = tanjiaUiGlobal) {
    let timer = null;
    function schedule(...args) {
      if (timer !== null) timerApi.clearTimeout(timer);
      timer = timerApi.setTimeout(() => {
        callback(...args);
      }, delayMs);
      return timer;
    }
    schedule.cancel = () => {
      if (timer === null) return;
      timerApi.clearTimeout(timer);
      timer = null;
    };
    return schedule;
  }

  function renderTableMessage(target, colspan, message, root = tanjiaUiGlobal.document) {
    const element = resolveElement(target, root);
    if (!element) return null;
    const span = Math.max(1, Number.parseInt(colspan, 10) || 1);
    element.innerHTML = `<tr><td colspan="${span}">${escapeHtml(message)}</td></tr>`;
    return element;
  }

  function normalizeElementTargets(targets) {
    if (typeof targets === "string" || !targets?.[Symbol.iterator]) return [targets];
    return [...targets];
  }

  function setElementsDisabled(targets, disabled, root = tanjiaUiGlobal.document) {
    return normalizeElementTargets(targets)
      .map((target) => resolveElement(target, root))
      .filter(Boolean)
      .map((element) => {
        element.disabled = Boolean(disabled);
        return element;
      });
  }

  function setElementsHidden(targets, hidden, root = tanjiaUiGlobal.document) {
    return normalizeElementTargets(targets)
      .map((target) => resolveElement(target, root))
      .filter(Boolean)
      .map((element) => {
        element.hidden = Boolean(hidden);
        return element;
      });
  }

  function setButtonBusy(button, busyText, restoreText = button?.textContent || "", options = {}) {
    if (!button) return () => {};
    const shouldDisable = options.disable !== false;
    if (shouldDisable) button.disabled = true;
    button.textContent = busyText;
    return () => {
      if (shouldDisable) button.disabled = false;
      button.textContent = restoreText;
    };
  }

  function downloadBlob(blob, filename, root = tanjiaUiGlobal.document, urlApi = tanjiaUiGlobal.URL) {
    const url = urlApi.createObjectURL(blob);
    const link = root.createElement("a");
    link.href = url;
    link.download = filename;
    root.body.appendChild(link);
    link.click();
    link.remove();
    urlApi.revokeObjectURL(url);
  }

const TanjiaUiUtils = {
  bind,
  bindAll,
  bindBackdropClose,
  bindClickOutside,
  bindDelegated,
  bindEventTarget,
  checkedField,
  clickVisibleElement,
  closestTarget,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fieldValue,
  filterStoreOptionsByCountries,
  formatActualMoney,
  formatMetricNumber,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRateNullable,
  isVisibleElement,
  normalizeCountryName,
  normalizeFilterOption,
  normalizeFilterOptions,
  normalizeText,
  parseDisplayPercent,
  parseNumber,
  renderDataValueButtonsHtml,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setActiveDatasetValueState,
  setActiveElementState,
  setAriaExpanded,
  setButtonBusy,
  setClassStateMap,
  setDisclosureGroupState,
  setDisclosureState,
  setElementsDisabled,
  setElementsHidden,
  setExclusiveClassState,
  setExpandedClassState,
  setModalOpenState,
  setSelectedElementState,
  setStatusMessage,
  setTableSortButtonGroupState,
  setTableSortState,
  setText,
  trimmedFieldValue,
};

tanjiaUiGlobal.TanjiaUiUtils = TanjiaUiUtils;

export {
  bind,
  bindAll,
  bindBackdropClose,
  bindClickOutside,
  bindDelegated,
  bindEventTarget,
  checkedField,
  clickVisibleElement,
  closestTarget,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fieldValue,
  filterStoreOptionsByCountries,
  formatActualMoney,
  formatMetricNumber,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRateNullable,
  isVisibleElement,
  normalizeCountryName,
  normalizeFilterOption,
  normalizeFilterOptions,
  normalizeText,
  parseDisplayPercent,
  parseNumber,
  renderDataValueButtonsHtml,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setActiveDatasetValueState,
  setActiveElementState,
  setAriaExpanded,
  setButtonBusy,
  setClassStateMap,
  setDisclosureGroupState,
  setDisclosureState,
  setElementsDisabled,
  setElementsHidden,
  setExclusiveClassState,
  setExpandedClassState,
  setModalOpenState,
  setSelectedElementState,
  setStatusMessage,
  setTableSortButtonGroupState,
  setTableSortState,
  setText,
  trimmedFieldValue,
};

export default TanjiaUiUtils;

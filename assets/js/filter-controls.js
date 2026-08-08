function getSelectedFilterLabels(select) {
  return [...(select?.selectedOptions || [])]
    .filter((option) => option?.value)
    .map((option) => String(option.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function getFilterDropdownSummary(select) {
  const labels = getSelectedFilterLabels(select);
  const allText = select?.options?.[0]?.textContent?.trim() || "全部";
  if (!labels.length) {
    return { text: allText, accessibleText: allText, title: allText };
  }
  const title = labels.join("、");
  const countText = `已选 ${labels.length} 项`;
  return {
    text: labels.length === 1 ? labels[0] : countText,
    accessibleText: `${countText}：${title}`,
    title,
  };
}

export function getFilterDropdownMenuAlignment(menuRect, viewportWidth, gutter = 16) {
  return menuRect.right > viewportWidth - gutter ? "end" : "start";
}

export function updateFilterDropdownMenuAlignment(menu, viewportWidth) {
  menu.classList.remove("filter-dropdown-menu--align-end");
  const alignment = getFilterDropdownMenuAlignment(menu.getBoundingClientRect(), viewportWidth);
  menu.classList.toggle("filter-dropdown-menu--align-end", alignment === "end");
  return alignment;
}

export function createFilterControls({
  root = document,
  globalObject = root?.defaultView || window,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  normalizeCountryName,
  normalizeFilterOptions,
  selectedFilterValues,
  setDisclosureGroupState,
  setDisclosureState,
} = {}) {
  function syncAllOptionSelection(select) {
    if (!select?.multiple) return;
    const selected = [...select.selectedOptions];
    const allOption = [...select.options].find((option) => option.value === "");
    if (!allOption) return;
    if (selected.length > 1 && allOption.selected) allOption.selected = false;
  }

  function selectedFilterLabels(select) {
    return getSelectedFilterLabels(select);
  }

  function updateFilterDropdownButton(select) {
    const dropdown = select?.nextElementSibling?.classList?.contains("filter-dropdown")
      ? select.nextElementSibling
      : null;
    const button = dropdown?.querySelector(".filter-dropdown-button");
    if (!button) return;
    const label = button.querySelector(".filter-dropdown-button-label");
    if (!label) throw new Error("Filter dropdown button is missing its label span");
    const summary = getFilterDropdownSummary(select);
    label.textContent = summary.text;
    button.setAttribute("aria-label", summary.accessibleText);
    button.setAttribute("title", summary.title);
    dropdown.classList?.toggle?.("filter-dropdown--has-selection", selectedFilterLabels(select).length > 0);
  }

  function resetFilterDropdownSelection(select) {
    if (!select?.multiple) throw new Error("resetFilterDropdownSelection requires a multiple select.");
    [...select.options].forEach((option) => {
      option.selected = option.value === "";
    });
    if (select.nextElementSibling?.classList?.contains("filter-dropdown")) renderFilterDropdown(select);
  }

  function clearFilterDropdownSelection(select) {
    resetFilterDropdownSelection(select);
    const linkedSelector = String(select.dataset?.filterClearTarget || "").trim();
    if (linkedSelector) {
      const linkedSelect = root.querySelector(linkedSelector);
      if (!linkedSelect) throw new Error(`Filter clear target was not found: ${linkedSelector}`);
      resetFilterDropdownSelection(linkedSelect);
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function handleFilterDropdownOptionChange(select, input) {
    const changedValue = input.value;
    [...select.options].forEach((option) => {
      if (!changedValue) {
        option.selected = option.value === "";
      } else if (option.value === changedValue) {
        option.selected = input.checked;
      } else if (!option.value) {
        option.selected = false;
      }
    });
    const allOption = [...select.options].find((option) => option.value === "");
    if (allOption) allOption.selected = ![...select.options].some((option) => option.value && option.selected);
    updateFilterDropdownButton(select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function createFilterDropdown(select) {
    if (!select || select.nextElementSibling?.classList?.contains("filter-dropdown")) return select?.nextElementSibling;
    select.classList.add("enhanced-filter-select");
    const dropdown = root.createElement("div");
    dropdown.className = "filter-dropdown";
    dropdown.innerHTML = `
      <button class="filter-dropdown-button multi-select-button" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="filter-dropdown-button-label"></span></button>
      <button class="filter-dropdown-clear" type="button" aria-label="清除已选项" title="清除已选项"><span aria-hidden="true">&#215;</span></button>
      <div class="filter-dropdown-menu multi-select-menu" hidden>
        <div class="filter-dropdown-options multi-select-options" role="listbox" aria-multiselectable="true"></div>
      </div>
    `;
    select.insertAdjacentElement("afterend", dropdown);
    bind(dropdown, ".filter-dropdown-button", "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = dropdown.querySelector(".filter-dropdown-menu");
      const opening = menu.hidden;
      setDisclosureGroupState(".filter-dropdown-menu:not([hidden])", false, {
        except: menu,
        toggleForPanel: (panel) => panel.closest(".filter-dropdown")?.querySelector(".filter-dropdown-button"),
      });
      setDisclosureState(menu, event.currentTarget, opening);
      if (opening) {
        updateFilterDropdownMenuAlignment(menu, globalObject.innerWidth);
      }
    });
    bind(dropdown, ".filter-dropdown-button", "keydown", (event) => {
      const menu = dropdown.querySelector(".filter-dropdown-menu");
      if (event.key !== "Escape" || !menu || menu.hidden) return;
      event.preventDefault();
      setDisclosureState(menu, event.currentTarget, false);
      event.currentTarget.focus?.();
    });
    bind(dropdown, ".filter-dropdown-clear", "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearFilterDropdownSelection(select);
    });
    bind(dropdown, ".filter-dropdown-options", "change", (event) => {
      const input = closestTarget(event, "input[type='checkbox']");
      if (!input) return;
      handleFilterDropdownOptionChange(select, input);
    });
    return dropdown;
  }

  function renderFilterDropdown(select) {
    if (!select?.multiple) return;
    const dropdown = createFilterDropdown(select);
    const container = dropdown?.querySelector(".filter-dropdown-options");
    if (!container) return;
    const renderOption = (option) => `
      <label class="multi-select-option filter-dropdown-option">
        <input type="checkbox" value="${escapeHtml(option.value)}" ${option.selected ? "checked" : ""} />
        <span>${escapeHtml(option.textContent.trim())}</span>
      </label>
    `;
    const rendered = [...select.childNodes].map((node) => {
      if (node.tagName === "OPTGROUP") {
        const optionHtml = [...node.children]
          .filter((option) => option.value)
          .map(renderOption)
          .join("");
        if (!optionHtml) return "";
        return `
          <div class="filter-dropdown-group">
            <strong>${escapeHtml(node.label || "未分组")}</strong>
            ${optionHtml}
          </div>
        `;
      }
      if (node.tagName === "OPTION") return renderOption(node);
      return "";
    }).join("");
    container.innerHTML = rendered || `<div class="filter-dropdown-empty">暂无可选项</div>`;
    updateFilterDropdownButton(select);
  }

  function initializeFilterDropdowns() {
    root.querySelectorAll(".filters select[multiple], .filter-toolbar select[multiple]").forEach(renderFilterDropdown);
    if (globalObject.__tanjiaFilterDropdownOutsideClickReady) return;
    globalObject.__tanjiaFilterDropdownOutsideClickReady = true;
    bindClickOutside(root, ".filter-dropdown", () => {
      setDisclosureGroupState(".filter-dropdown-menu:not([hidden])", false, {
        toggleForPanel: (menu) => menu.closest(".filter-dropdown")?.querySelector(".filter-dropdown-button"),
      });
    });
  }

  function setSelectOptions(selectorOrElement, options = [], allLabel = "全部", { groupByCountry = false, countries = [], selectAllVisible = false } = {}) {
    const select = typeof selectorOrElement === "string" ? root.querySelector(selectorOrElement) : selectorOrElement;
    if (!select) return;
    const previousValues = selectedFilterValues(select);
    const countrySet = new Set((countries || []).map(normalizeCountryName).filter((item) => item && item !== "-"));
    const normalizedOptions = normalizeFilterOptions(options)
      .filter((item) => !countrySet.size || countrySet.has(item.country));
    const optionHtml = (item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}${item.country && item.country !== "-" && !groupByCountry ? ` · ${escapeHtml(item.country)}` : ""}</option>`;
    if (groupByCountry) {
      const groups = normalizedOptions.reduce((map, item) => {
        const key = item.country || "未分组";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
        return map;
      }, new Map());
      select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${[...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
        .map(([country, items]) => `<optgroup label="${escapeHtml(country)}">${items.map(optionHtml).join("")}</optgroup>`)
        .join("")}`;
    } else {
      select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${normalizedOptions.map(optionHtml).join("")}`;
    }
    const validValues = new Set(normalizedOptions.map((item) => item.value));
    const nextValues = selectAllVisible
      ? (countrySet.size ? normalizedOptions.map((item) => item.value) : [])
      : previousValues.filter((value) => validValues.has(value));
    [...select.options].forEach((option) => {
      option.selected = option.value ? nextValues.includes(option.value) : !nextValues.length;
    });
    renderFilterDropdown(select);
  }

  function syncCountryStoreSelection({ countrySelect, storeSelect, storeOptions = [], setSelectOptionsImpl = setSelectOptions } = {}) {
    if (!countrySelect) throw new Error("syncCountryStoreSelection requires a country select.");
    if (!storeSelect) throw new Error("syncCountryStoreSelection requires a store select.");
    if (!Array.isArray(storeOptions)) throw new Error("syncCountryStoreSelection requires storeOptions to be an array.");
    if (typeof setSelectOptionsImpl !== "function") throw new Error("syncCountryStoreSelection requires a setSelectOptions implementation.");

    syncAllOptionSelection(countrySelect);
    const countries = selectedFilterValues(countrySelect);
    setSelectOptionsImpl(storeSelect, storeOptions, "全部店铺", {
      groupByCountry: true,
      countries,
      selectAllVisible: true,
    });
  }

  return {
    createFilterDropdown,
    clearFilterDropdownSelection,
    handleFilterDropdownOptionChange,
    initializeFilterDropdowns,
    renderFilterDropdown,
    resetFilterDropdownSelection,
    selectedFilterLabels,
    setSelectOptions,
    syncAllOptionSelection,
    syncCountryStoreSelection,
    updateFilterDropdownButton,
  };
}

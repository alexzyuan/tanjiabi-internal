const fbaWarehousePrefixGroups = {
  "加拿大": ["YYZ", "YVR", "YYC"],
  "美国": ["MIT", "GEU", "POC", "TCY"],
};

export function createFbaMskuFeature({
  root = globalThis.document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  fbaValue,
  fetchImpl = globalThis.fetch,
  formatNumber,
  getSelectedFbaShops,
  setButtonBusy,
  setElementsHidden,
  setFbaShopMenuOpen,
  setText,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaMskuFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaMskuFeature requires fetch.");

  let fbaMskuOptions = [];
  let fbaMskuLoadTimer = null;
  let fbaMskuLoading = false;
  let fbaLastMskuLoadKey = "";

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function setFbaInputValue(selector, value) {
    const input = query(selector);
    if (input) input.value = value ?? "";
  }

  function filterLocalFbaMskus() {
    const keyword = fbaValue("#fba-msku").toLowerCase();
    const matchMode = fbaValue("#fba-msku-match") || "fuzzy";
    if (!keyword) return fbaMskuOptions.slice(0, 30);
    return fbaMskuOptions.filter((item) => {
      const fields = [item.msku, item.asin, item.sku, item.title, item.shopName, item.displayName].map((field) => String(field || "").toLowerCase());
      if (matchMode === "exact") return fields.some((field) => field === keyword);
      return fields.some((field) => field.includes(keyword));
    }).slice(0, 30);
  }

  function setFbaMskuSuggestionsOpen(open) {
    return setElementsHidden("#fba-msku-suggest", !open, root)[0] || null;
  }

  function renderFbaMskuSuggestions(items = filterLocalFbaMskus(), forceOpen = false) {
    const panel = query("#fba-msku-suggest");
    if (!panel) return;
    const inputFocused = root?.activeElement?.id === "fba-msku";
    const shouldOpen = forceOpen || inputFocused;
    if (!shouldOpen) {
      setFbaMskuSuggestionsOpen(false);
      return;
    }

    if (!fbaMskuOptions.length) {
      panel.innerHTML = `<div class="search-result-item">正在准备候选；也可以直接手填准确 MSKU。</div>`;
      setFbaMskuSuggestionsOpen(true);
      return;
    }

    panel.innerHTML = items.length
      ? items.slice(0, 20).map((item) => `
          <button class="search-result-item" type="button" data-fba-msku="${escapeHtml(item.msku)}">
            <strong>${escapeHtml(item.msku)}</strong><br />
            ${escapeHtml(item.displayName || item.shopName || "-")}${item.asin ? ` · ${escapeHtml(item.asin)}` : ""}${item.title ? ` · ${escapeHtml(item.title)}` : ""}${item.packQuantity ? ` · 装箱${formatNumber(item.packQuantity)}` : ""}${item.boxSource && item.boxSource !== "missing" ? ` · 箱规${item.boxSource === "erp" ? "ERP" : "模板"}` : " · 箱规待补"}
          </button>
        `).join("")
      : `<div class="search-result-item">没有匹配候选，可直接手填准确 MSKU。</div>`;
    setFbaMskuSuggestionsOpen(true);
  }

  function renderFbaMskuOptions(items = filterLocalFbaMskus()) {
    renderFbaMskuSuggestions(items);
    const results = query("#fba-msku-results");
    if (!results) return;
    if (!fbaMskuOptions.length) {
      results.textContent = "正在准备 MSKU 候选；如果暂时未加载到，也可以直接在输入框手填准确 MSKU。";
      return;
    }
    results.innerHTML = items.length
      ? items.map((item) => `
          <button class="search-result-item" type="button" data-fba-msku="${escapeHtml(item.msku)}">
            ${escapeHtml(item.msku)} · ${escapeHtml(item.displayName || item.shopName || "-")}${item.asin ? ` · ${escapeHtml(item.asin)}` : ""}${item.packQuantity ? ` · 装箱${formatNumber(item.packQuantity)}` : ""}${item.boxSource && item.boxSource !== "missing" ? ` · 箱规${item.boxSource === "erp" ? "ERP" : "模板"}` : " · 箱规待补"}
          </button>
        `).join("")
      : "没有匹配的 MSKU。你仍然可以直接手填准确 MSKU 后测试刷仓。";
  }

  function getFbaMskuLoadKey() {
    return getSelectedFbaShops().map((shop) => Number(shop.sid)).filter(Boolean).sort((a, b) => a - b).join(",");
  }

  function scheduleFbaMskuLoad(delay = 350) {
    if (fbaMskuLoadTimer) clearTimeout(fbaMskuLoadTimer);
    fbaMskuLoadTimer = setTimeout(() => {
      loadFbaMskus();
    }, delay);
  }

  async function loadFbaMskus({ force = false } = {}) {
    if (fbaMskuLoading) return;
    const loadKey = getFbaMskuLoadKey();
    if (!force && loadKey && loadKey === fbaLastMskuLoadKey && fbaMskuOptions.length) {
      renderFbaMskuOptions();
      return;
    }

    const button = query("#fba-load-mskus-button");
    const restoreButton = setButtonBusy(button, "刷新中", "刷新MSKU", { disable: false });
    fbaMskuLoading = true;
    const selectedSids = getSelectedFbaShops().map((shop) => shop.sid).filter(Boolean);
    const params = new URLSearchParams();
    if (selectedSids.length) params.set("sids", selectedSids.join(","));
    setText("#fba-status", "正在自动加载 MSKU", root);

    try {
      const response = await fetchImpl(`/api/fba/mskus?${params.toString()}`);
      const data = await response.json();
      fbaMskuOptions = data.items || [];
      fbaLastMskuLoadKey = loadKey;
      renderFbaMskuOptions();
      syncFbaQuantityFields();
      const status = data.errors?.length ? `已加载 ${fbaMskuOptions.length} 个，部分店铺失败` : `已加载 ${fbaMskuOptions.length} 个 MSKU`;
      setText("#fba-status", status, root);
      if (!fbaMskuOptions.length && data.errors?.length) {
        const results = query("#fba-msku-results");
        if (results) results.textContent = `领星MSKU读取暂未成功：${data.errors[0]}。你可以先直接手填准确 MSKU 测试刷仓。`;
      }
    } catch (error) {
      const results = query("#fba-msku-results");
      if (results) results.textContent = `MSKU加载失败：${error.message}`;
    } finally {
      fbaMskuLoading = false;
      restoreButton();
    }
  }

  function renderFbaWarehouseOptions() {
    const list = query("#fba-target-warehouse-options");
    if (!list) return;
    const shop = getSelectedFbaShops()[0];
    const country = shop?.country || "";
    const matchedPrefixes = fbaWarehousePrefixGroups[country];
    const groups = matchedPrefixes
      ? [[country, matchedPrefixes]]
      : Object.entries(fbaWarehousePrefixGroups);

    list.innerHTML = groups.flatMap(([label, prefixes]) =>
      prefixes.map((prefix) => `<option value="${escapeHtml(prefix)}" label="${escapeHtml(`${label} · ${prefix}`)}"></option>`),
    ).join("");
  }

  function findSelectedFbaMskuOption() {
    const selectedShopIds = new Set(getSelectedFbaShops().map((shop) => Number(shop.sid)));
    const msku = fbaValue("#fba-msku").toLowerCase();
    if (!msku) return null;
    return fbaMskuOptions.find((item) =>
      String(item.msku || "").toLowerCase() === msku
      && (!selectedShopIds.size || selectedShopIds.has(Number(item.sid))),
    ) || fbaMskuOptions.find((item) => String(item.msku || "").toLowerCase() === msku) || null;
  }

  function readFbaBoxSpecFromForm() {
    return {
      boxDimensions: {
        length: Number(fbaValue("#fba-box-length") || 0),
        width: Number(fbaValue("#fba-box-width") || 0),
        height: Number(fbaValue("#fba-box-height") || 0),
        unitOfMeasurement: "CM",
      },
      boxWeight: {
        value: Number(fbaValue("#fba-box-weight") || 0),
        unit: "KG",
      },
    };
  }

  function hasCompleteFbaBoxSpec(spec = readFbaBoxSpecFromForm()) {
    return Boolean(
      Number(spec.boxDimensions?.length || 0) > 0
      && Number(spec.boxDimensions?.width || 0) > 0
      && Number(spec.boxDimensions?.height || 0) > 0
      && Number(spec.boxWeight?.value || 0) > 0
    );
  }

  function setFbaBoxSpecFields(spec = {}, source = "") {
    const dimensions = spec.boxDimensions || spec.dimensions || {};
    const weight = spec.boxWeight || spec.weight || {};
    setFbaInputValue("#fba-box-length", dimensions.length || "");
    setFbaInputValue("#fba-box-width", dimensions.width || "");
    setFbaInputValue("#fba-box-height", dimensions.height || "");
    setFbaInputValue("#fba-box-weight", weight.value || "");
    const status = query("#fba-box-spec-status");
    if (status) {
      const sourceText = source === "erp" ? "已读取 ERP 产品管理外箱规格和外箱实重" : source === "template" ? "已读取本地外箱规模板" : "ERP未返回外箱规格/外箱实重，请手填，系统会按店铺+MSKU保存模板";
      status.textContent = sourceText;
    }
  }

  function syncFbaBoxSpecFields() {
    const selected = findSelectedFbaMskuOption();
    if (!selected) return;
    const current = readFbaBoxSpecFromForm();
    if (hasCompleteFbaBoxSpec(current)) return;
    const hasAnyManualValue = [
      current.boxDimensions.length,
      current.boxDimensions.width,
      current.boxDimensions.height,
      current.boxWeight.value,
    ].some((value) => Number(value || 0) > 0);
    if (hasAnyManualValue) return;
    if (selected.boxDimensions && selected.boxWeight) {
      setFbaBoxSpecFields({
        boxDimensions: selected.boxDimensions,
        boxWeight: selected.boxWeight,
      }, selected.boxSource || "erp");
    } else {
      const status = query("#fba-box-spec-status");
      if (status) status.textContent = "ERP未返回外箱规格/外箱实重，请手填，系统会按店铺+MSKU保存模板";
    }
  }

  function syncFbaQuantityFields() {
    const boxInput = query("#fba-box-count");
    const packInput = query("#fba-pack-quantity");
    const quantityInput = query("#fba-quantity");
    const selected = findSelectedFbaMskuOption();
    const boxCount = Number(boxInput?.value || 0);
    const packQuantity = Number(selected?.packQuantity || packInput?.value || 0);
    if (packInput) {
      packInput.value = packQuantity > 0 ? String(packQuantity) : "";
      packInput.placeholder = packQuantity > 0 ? "" : "ERP暂未返回装箱数量";
    }
    if (quantityInput) {
      quantityInput.value = boxCount > 0 && packQuantity > 0 ? String(boxCount * packQuantity) : "";
      quantityInput.placeholder = boxCount > 0 && !packQuantity ? "等待ERP装箱数量" : "箱数 × 装箱数量";
    }
    syncFbaBoxSpecFields();
  }

  function handleFbaShopSelectionChange() {
    renderFbaWarehouseOptions();
    setFbaShopMenuOpen(false);
    fbaMskuOptions = [];
    fbaLastMskuLoadKey = "";
    setFbaBoxSpecFields({}, "");
    renderFbaMskuOptions();
    syncFbaQuantityFields();
    scheduleFbaMskuLoad(50);
  }

  function pickFbaMsku(event) {
    const item = closestTarget(event, "[data-fba-msku]");
    if (!item) return;
    const input = query("#fba-msku");
    if (input) input.value = item.dataset.fbaMsku;
    setFbaMskuSuggestionsOpen(false);
    setFbaBoxSpecFields({}, "");
    renderFbaMskuOptions();
    syncFbaQuantityFields();
  }

  function setupFbaMskuPicker() {
    bindClickOutside(root, ".msku-search", () => {
      setFbaMskuSuggestionsOpen(false);
    });
    bind(root, "#fba-load-mskus-button", "click", () => loadFbaMskus({ force: true }));
    bind(root, "#fba-msku", "input", () => {
      const items = filterLocalFbaMskus();
      renderFbaMskuOptions(items);
      renderFbaMskuSuggestions(items, true);
      syncFbaQuantityFields();
    });
    bind(root, "#fba-msku", "focus", () => renderFbaMskuSuggestions(filterLocalFbaMskus(), true));
    bind(root, "#fba-msku", "keydown", (event) => {
      if (event.key === "Escape") {
        setFbaMskuSuggestionsOpen(false);
      }
    });
    bind(root, "#fba-msku-match", "change", () => renderFbaMskuOptions());
    bind(root, "#fba-msku-results", "click", pickFbaMsku);
    bind(root, "#fba-msku-suggest", "click", pickFbaMsku);
    bind(root, "#fba-box-count", "input", syncFbaQuantityFields);
    ["#fba-box-length", "#fba-box-width", "#fba-box-height", "#fba-box-weight"].forEach((selector) => {
      bind(root, selector, "input", () => {
        const status = query("#fba-box-spec-status");
        if (status) status.textContent = "手填外箱规格会按店铺+MSKU保存为模板。";
      });
    });
  }

  return {
    findSelectedFbaMskuOption,
    handleFbaShopSelectionChange,
    hasCompleteFbaBoxSpec,
    loadFbaMskus,
    readFbaBoxSpecFromForm,
    renderFbaMskuOptions,
    renderFbaWarehouseOptions,
    scheduleFbaMskuLoad,
    setFbaBoxSpecFields,
    setFbaMskuSuggestionsOpen,
    setupFbaMskuPicker,
    syncFbaQuantityFields,
  };
}

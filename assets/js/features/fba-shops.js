export function createFbaShopsFeature({
  root = globalThis.document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  fbaValue,
  fetchImpl = globalThis.fetch,
  getDisplayShopName,
  normalizeCountryName,
  onDirectoryError = () => {},
  onShopChange = () => {},
  onShopListChange = () => {},
  pickSellerCountry,
  pickSellerName,
  setElementsHidden,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaShopsFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaShopsFeature requires fetch.");

  let fbaShops = [];
  let selectedFbaShopSids = new Set();

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function normalizeFbaShop(shop = {}) {
    const candidate = shop && typeof shop === "object" ? shop : {};
    const name = String(candidate.name || pickSellerName?.(candidate) || "").trim();
    const sid = Number(candidate.sid ?? candidate.id ?? 0);
    if (!name || !Number.isInteger(sid) || sid <= 0) return null;
    const country = normalizeCountryName(candidate.country || pickSellerCountry?.(candidate));
    return {
      sid,
      name,
      country,
      displayName: candidate.displayName || getDisplayShopName?.(name, country) || name,
    };
  }

  function getFbaShops() {
    return fbaShops.slice();
  }

  function getSelectedFbaShops() {
    return fbaShops.filter((shop) => selectedFbaShopSids.has(Number(shop.sid)));
  }

  function updateFbaShopButton() {
    const button = query("#fba-shop-button");
    if (!button) return;
    const label = button.querySelector(".filter-dropdown-button-label");
    if (!label) throw new Error("FBA shop button requires .filter-dropdown-button-label.");
    const selected = getSelectedFbaShops();
    if (!selected.length) {
      label.textContent = "请选择店铺";
    } else {
      const shop = selected[0];
      label.textContent = `${shop.name} · ${shop.country}`;
    }
  }

  function setFbaShopMenuOpen(open) {
    return setElementsHidden("#fba-shop-menu", !open, root)[0] || null;
  }

  function toggleFbaShopMenu() {
    const menu = query("#fba-shop-menu");
    if (!menu) return null;
    return setFbaShopMenuOpen(menu.hidden);
  }

  function renderFbaShopOptions() {
    const container = query("#fba-shop-options");
    if (!container) return;
    const keyword = String(fbaValue("#fba-shop-search") || "").toLowerCase();
    const source = fbaShops.filter((shop) => {
      if (!keyword) return true;
      return [shop.name, shop.displayName, shop.country, shop.sid].some((field) => String(field || "").toLowerCase().includes(keyword));
    });

    container.innerHTML = source.length
      ? source.map((shop) => `
          <label class="multi-select-option">
            <input type="radio" name="fba-shop-radio" data-fba-shop-sid="${shop.sid}" ${selectedFbaShopSids.has(Number(shop.sid)) ? "checked" : ""} />
            <span class="shop-option-name">${escapeHtml(shop.name)}</span>
            <small>${escapeHtml(shop.country)}</small>
          </label>
        `).join("")
      : `<div class="multi-select-option">未找到店铺</div>`;
  }

  function selectFbaShopSids(sids = [], { notify = false } = {}) {
    const availableSids = new Set(fbaShops.map((shop) => Number(shop.sid)));
    selectedFbaShopSids = new Set(sids.map(Number).filter((sid) => availableSids.has(sid)));
    renderFbaShopOptions();
    updateFbaShopButton();
    if (notify) onShopChange(getSelectedFbaShops());
  }

  function populateFbaShopSelect(sellers = []) {
    if (!Array.isArray(sellers)) throw new TypeError("FBA 店铺目录必须是数组。");
    fbaShops = sellers.map(normalizeFbaShop).filter(Boolean);
    const availableSids = new Set(fbaShops.map((shop) => Number(shop.sid)));
    selectedFbaShopSids = new Set([...selectedFbaShopSids].filter((sid) => availableSids.has(sid)));
    renderFbaShopOptions();
    updateFbaShopButton();
    onShopListChange(fbaShops.slice());
  }

  async function loadFbaShops() {
    try {
      const response = await fetchImpl("/api/fba/shops");
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.shops) || !data.shops.length) throw new Error("FBA 店铺目录为空。");
      populateFbaShopSelect(data.shops);
      if (!fbaShops.length) throw new Error("FBA 店铺目录为空。");
    } catch (error) {
      populateFbaShopSelect([]);
      onDirectoryError(error);
      throw error;
    }
  }

  function setupFbaShopPicker() {
    bindClickOutside(root, "#fba-shop-picker", () => {
      setFbaShopMenuOpen(false);
    });
    bind(root, "#fba-shop-button", "click", toggleFbaShopMenu);
    bind(root, "#fba-shop-search", "input", renderFbaShopOptions);
    bind(root, "#fba-shop-options", "change", (event) => {
      const input = closestTarget(event, "[data-fba-shop-sid]");
      if (!input) return;
      selectFbaShopSids([Number(input.dataset.fbaShopSid)], { notify: true });
    });
  }

  return {
    getFbaShops,
    getSelectedFbaShops,
    loadFbaShops,
    normalizeFbaShop,
    populateFbaShopSelect,
    renderFbaShopOptions,
    selectFbaShopSids,
    setFbaShopMenuOpen,
    setupFbaShopPicker,
    updateFbaShopButton,
  };
}

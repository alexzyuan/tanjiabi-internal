const fallbackFbaShops = [
  { name: "tandanbo-AU", country: "澳洲", sid: 11503, displayName: "坦蛋伯澳洲" },
  { name: "xiamentanjia-US", country: "美国", sid: 8708, displayName: "探嘉美国" },
  { name: "xiamentanjia-CA", country: "加拿大", sid: 8709, displayName: "探嘉加拿大" },
  { name: "tandanbo-US", country: "美国", sid: 11500, displayName: "坦蛋伯美国" },
  { name: "tandanbo-CA", country: "加拿大", sid: 11501, displayName: "坦蛋伯加拿大" },
  { name: "xiamentanjia-AU", country: "澳洲", sid: 11499, displayName: "探嘉澳洲" },
];

const fallbackFbaAddresses = {
  tandanbo: {
    label: "坦蛋伯发货地址",
    shipperName: "Xiamen tandanbo wangluokeji youxiangongsi",
    companyName: "Xiamen tandanbo wangluokeji youxiangongsi",
    addressLine1: "Room 623-40, No. 89, Anling 2nd Road",
    addressLine2: "",
    city: "Xiamen",
    stateOrProvinceCode: "Fujian",
    postalCode: "361006",
    countryCode: "CN",
    phoneNumber: "8615759601196",
  },
  xiamentanjia: {
    label: "厦门探嘉发货地址",
    shipperName: "Xiamen Tanjia wangluo keji youxian gongsi",
    companyName: "Xiamen Tanjia wangluo keji youxian gongsi",
    addressLine1: "No.1 Taiwen street",
    addressLine2: "Room 239-9, Huli",
    city: "Xiamen",
    stateOrProvinceCode: "Fujian",
    postalCode: "361006",
    countryCode: "CN",
    phoneNumber: "+86 13235037039",
  },
};

export function createFbaShopsFeature({
  root = globalThis.document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  fbaValue,
  fetchImpl = globalThis.fetch,
  getDisplayShopName,
  getFrontShopSellers = () => [],
  normalizeCountryName,
  onShopChange = () => {},
  onShopListChange = () => {},
  pickSellerCountry,
  pickSellerName,
  setElementsHidden,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaShopsFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaShopsFeature requires fetch.");

  let fbaShops = [];
  let selectedFbaShopSids = new Set([11501]);

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function getFallbackFbaAddress(shopName) {
    return String(shopName || "").toLowerCase().startsWith("xiamentanjia") ? fallbackFbaAddresses.xiamentanjia : fallbackFbaAddresses.tandanbo;
  }

  function normalizeFbaShop(shop) {
    const name = shop.name || pickSellerName(shop);
    const country = normalizeCountryName(shop.country || pickSellerCountry(shop));
    const sid = Number(shop.sid || shop.id || 0);
    return {
      name,
      country,
      sid,
      displayName: shop.displayName || getDisplayShopName(name, country),
      addressProfile: shop.addressProfile || getFallbackFbaAddress(name),
    };
  }

  function getFbaShops() {
    return fbaShops.slice();
  }

  function getFallbackFbaShops() {
    return fallbackFbaShops.slice();
  }

  function getFallbackFbaShop(index = 0) {
    return normalizeFbaShop(fallbackFbaShops[index] || fallbackFbaShops[0]);
  }

  function getSelectedFbaShops() {
    return fbaShops.filter((shop) => selectedFbaShopSids.has(Number(shop.sid)));
  }

  function updateFbaShopButton() {
    const button = query("#fba-shop-button");
    if (!button) return;
    const selected = getSelectedFbaShops();
    if (!selected.length) {
      button.textContent = "请选择店铺";
    } else {
      const shop = selected[0];
      button.textContent = `${shop.name} · ${shop.country}`;
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
    const keyword = fbaValue("#fba-shop-search").toLowerCase();
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
    const normalized = sids.map(Number).filter(Boolean);
    selectedFbaShopSids = new Set(normalized);
    renderFbaShopOptions();
    updateFbaShopButton();
    if (notify) onShopChange(getSelectedFbaShops());
  }

  function populateFbaShopSelect(sellers = []) {
    const source = sellers.length ? sellers : fallbackFbaShops;
    fbaShops = source.map(normalizeFbaShop).filter((shop) => shop.sid);
    if (!fbaShops.some((shop) => selectedFbaShopSids.has(Number(shop.sid)))) {
      selectedFbaShopSids = new Set([fbaShops[0]?.sid || 11501]);
    }
    renderFbaShopOptions();
    updateFbaShopButton();
    onShopListChange(fbaShops.slice());
  }

  async function loadFbaShops() {
    try {
      const response = await fetchImpl("/api/fba/shops");
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      populateFbaShopSelect(data.shops || []);
    } catch {
      const frontShopSellers = getFrontShopSellers();
      populateFbaShopSelect(frontShopSellers.length ? frontShopSellers : fallbackFbaShops);
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
    getFallbackFbaShop,
    getFallbackFbaShops,
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

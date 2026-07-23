export function pickSellerName(seller = {}) {
  return seller.name || seller.seller_name || seller.account_name || seller.shop_name || seller.store_name || seller.sid || "-";
}

export function pickSellerCountry(seller = {}) {
  return seller.country || seller.country_name || seller.marketplace || seller.region || seller.site || "-";
}

export function getDisplayShopName(name, country) {
  const normalized = String(name || "").toLowerCase();
  const countryName = String(country || "");
  const brand = normalized.includes("tandanbo") ? "坦蛋伯" : normalized.includes("xiamentanjia") ? "探嘉" : name;
  const siteMap = {
    AU: "澳洲",
    BR: "巴西",
    CA: "加拿大",
    MX: "墨西哥",
    US: "美国",
  };
  const code = Object.keys(siteMap).find((item) => normalized.endsWith(`-${item.toLowerCase()}`));
  const site = code ? siteMap[code] : countryName;
  return brand && site ? `${brand}${site}` : brand || "-";
}

export const FRONT_OWNER_QUICK_FILTERS = ["林芃", "熊丹轩", "黄超"];

export function createFrontShopFilters({
  root = globalThis.document,
  bind,
  bindClickOutside,
  fieldValue,
  getFrontDateRange,
  normalizeCountryName,
  onFiltersChange = async () => {},
  selectedFilterValue,
  selectedFilterValues,
  setSelectOptions,
  syncAllOptionSelection,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFrontShopFilters requires bind.");
  if (bindClickOutside != null && typeof bindClickOutside !== "function") throw new Error("createFrontShopFilters requires bindClickOutside.");
  if (typeof fieldValue !== "function") throw new Error("createFrontShopFilters requires fieldValue.");
  if (typeof getFrontDateRange !== "function") throw new Error("createFrontShopFilters requires getFrontDateRange.");
  if (typeof normalizeCountryName !== "function") throw new Error("createFrontShopFilters requires normalizeCountryName.");
  if (typeof selectedFilterValue !== "function") throw new Error("createFrontShopFilters requires selectedFilterValue.");
  if (typeof selectedFilterValues !== "function") throw new Error("createFrontShopFilters requires selectedFilterValues.");
  if (typeof setSelectOptions !== "function") throw new Error("createFrontShopFilters requires setSelectOptions.");
  if (typeof syncAllOptionSelection !== "function") throw new Error("createFrontShopFilters requires syncAllOptionSelection.");

  let frontShopSellers = [];

  function getFrontShopSellers() {
    return frontShopSellers.slice();
  }

  function populateFrontShopFilters(sellers = frontShopSellers, { selectAllStores = false } = {}) {
    frontShopSellers = sellers || [];
    const countrySelect = root?.querySelector?.("#front-country-filter");
    const shopSelect = root?.querySelector?.("#front-shop-filter");
    if (!countrySelect || !shopSelect) return;

    const countries = [...new Set(frontShopSellers
      .map((seller) => normalizeCountryName(pickSellerCountry(seller)))
      .filter((item) => item && item !== "-"))]
      .sort();
    setSelectOptions(countrySelect, countries, "全部国家");
    const selectedCountries = selectedFilterValues(countrySelect);
    const shopOptions = frontShopSellers.map((seller) => {
      const name = pickSellerName(seller);
      const country = normalizeCountryName(pickSellerCountry(seller));
      return { name, label: name, country };
    });
    setSelectOptions(shopSelect, shopOptions, "全部店铺", {
      groupByCountry: true,
      countries: selectedCountries,
      selectAllVisible: selectAllStores,
    });
  }

  function getSelectedFrontSids() {
    const countries = selectedFilterValues("#front-country-filter", root);
    const shops = selectedFilterValues("#front-shop-filter", root);

    return frontShopSellers
      .filter((seller) => {
        if (countries.length && !countries.includes(normalizeCountryName(pickSellerCountry(seller)))) return false;
        if (shops.length && !shops.includes(pickSellerName(seller))) return false;
        return true;
      })
      .map((seller) => Number(seller.sid || seller.id))
      .filter(Boolean);
  }

  function getFrontOwnerQuickFilterElement() {
    return root?.querySelector?.("#front-owner-quick-filter");
  }

  function updateFrontOwnerQuickFilterState() {
    const quickFilter = getFrontOwnerQuickFilterElement();
    const select = root?.querySelector?.("#front-owner-filter");
    if (!quickFilter || !select) return;
    const button = quickFilter.querySelector?.(".filter-dropdown-button");
    const label = button?.querySelector?.(".filter-dropdown-button-label");
    const menu = quickFilter.querySelector?.(".filter-dropdown-menu");
    const selectedValue = String(select.value || "");
    const selectedLabel = selectedValue || "负责人快捷筛选";
    if (label) label.textContent = selectedLabel;
    if (button) {
      button.setAttribute?.("aria-label", selectedValue ? `销售负责人快捷筛选：${selectedValue}` : "销售负责人快捷筛选");
      button.setAttribute?.("title", selectedLabel);
      button.setAttribute?.("aria-expanded", menu?.hidden ? "false" : "true");
    }
    quickFilter.querySelectorAll?.("input[type='radio']").forEach((input) => {
      input.checked = input.value === selectedValue;
    });
  }

  async function handleFrontOwnerFilterChange() {
    updateFrontOwnerQuickFilterState();
    await onFiltersChange();
  }

  function setFrontOwnerQuickFilterValue(value) {
    const select = root?.querySelector?.("#front-owner-filter");
    if (!select) throw new Error("front owner filter is missing.");
    const nextValue = String(value || "");
    select.value = nextValue;
    if (select.value !== nextValue) {
      throw new Error(`front owner quick filter value ${nextValue} is not available in #front-owner-filter.`);
    }
  }

  function setFrontOwnerQuickFilterMenuOpen(open) {
    const quickFilter = getFrontOwnerQuickFilterElement();
    if (!quickFilter) return;
    const button = quickFilter.querySelector?.(".filter-dropdown-button");
    const menu = quickFilter.querySelector?.(".filter-dropdown-menu");
    if (!button || !menu) return;
    menu.hidden = !open;
    button.setAttribute?.("aria-expanded", open ? "true" : "false");
  }

  function buildDashboardQuery() {
    const dateRange = getFrontDateRange();
    const params = new URLSearchParams();
    params.set("startDate", dateRange.start);
    params.set("endDate", dateRange.end);

    const sids = getSelectedFrontSids();
    const country = selectedFilterValue("#front-country-filter", root);
    const shop = selectedFilterValue("#front-shop-filter", root);
    params.set("currencyCode", fieldValue("#front-currency-filter", "ORIGINAL", root) || "ORIGINAL");
    const listingOwner = fieldValue("#front-owner-filter", "", root);
    if ((country || shop) && sids.length) {
      params.set("sids", sids.join(","));
    }
    if (listingOwner) params.set("listingOwner", listingOwner);

    return params.toString();
  }

  function setupFrontShopFilterControls() {
    bind(root, "#front-country-filter", "change", async () => {
      syncAllOptionSelection(root.querySelector("#front-country-filter"));
      populateFrontShopFilters(getFrontShopSellers(), { selectAllStores: true });
      await onFiltersChange();
    });
    bind(root, "#front-shop-filter", "change", () => {
      syncAllOptionSelection(root.querySelector("#front-shop-filter"));
      onFiltersChange();
    });
    bind(root, "#front-owner-filter", "change", handleFrontOwnerFilterChange);
    bind(root, "#front-currency-filter", "change", onFiltersChange);

    const quickFilter = getFrontOwnerQuickFilterElement();
    if (quickFilter) {
      updateFrontOwnerQuickFilterState();
      bind(quickFilter, ".filter-dropdown-button", "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = quickFilter.querySelector?.(".filter-dropdown-menu");
        if (!menu) return;
        setFrontOwnerQuickFilterMenuOpen(menu.hidden);
      });
      bind(quickFilter, ".filter-dropdown-button", "keydown", (event) => {
        if (event.key !== "Escape") return;
        const menu = quickFilter.querySelector?.(".filter-dropdown-menu");
        if (!menu || menu.hidden) return;
        event.preventDefault();
        setFrontOwnerQuickFilterMenuOpen(false);
      });
      bind(quickFilter, ".filter-dropdown-menu", "change", async (event) => {
        const input = event.target;
        if (!input || input.type !== "radio" || !input.checked) return;
        setFrontOwnerQuickFilterValue(input.value);
        setFrontOwnerQuickFilterMenuOpen(false);
        await handleFrontOwnerFilterChange();
      });
      if (typeof bindClickOutside === "function") {
        bindClickOutside(root, "#front-owner-quick-filter", () => {
          const menu = quickFilter.querySelector?.(".filter-dropdown-menu");
          if (!menu || menu.hidden) return;
          setFrontOwnerQuickFilterMenuOpen(false);
        });
      }
    }
  }

  return {
    buildDashboardQuery,
    getFrontShopSellers,
    getSelectedFrontSids,
    populateFrontShopFilters,
    setupFrontShopFilterControls,
    updateFrontOwnerQuickFilterState,
  };
}

import { encodeSharedFilterState } from "./shared-filter-state.js";

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

export function createFrontShopFilters({
  root = globalThis.document,
  bind,
  fieldValue,
  getFrontDateRange,
  normalizeCountryName,
  onFiltersChange = async () => {},
  onOwnerFilterChange = () => {},
  selectedFilterValue,
  selectedFilterValues,
  setSelectOptions,
  sharedFilterState = null,
  featureRegistry = null,
  featureId = "sales-dashboard",
  onSharedFilterProjection = () => {},
  syncAllOptionSelection,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFrontShopFilters requires bind.");
  if (typeof fieldValue !== "function") throw new Error("createFrontShopFilters requires fieldValue.");
  if (typeof getFrontDateRange !== "function") throw new Error("createFrontShopFilters requires getFrontDateRange.");
  if (typeof normalizeCountryName !== "function") throw new Error("createFrontShopFilters requires normalizeCountryName.");
  if (typeof onOwnerFilterChange !== "function") throw new Error("createFrontShopFilters requires onOwnerFilterChange to be a function.");
  if (typeof selectedFilterValue !== "function") throw new Error("createFrontShopFilters requires selectedFilterValue.");
  if (typeof selectedFilterValues !== "function") throw new Error("createFrontShopFilters requires selectedFilterValues.");
  if (typeof setSelectOptions !== "function") throw new Error("createFrontShopFilters requires setSelectOptions.");
  if (typeof syncAllOptionSelection !== "function") throw new Error("createFrontShopFilters requires syncAllOptionSelection.");
  if (sharedFilterState && typeof sharedFilterState.patch !== "function") {
    throw new Error("createFrontShopFilters requires sharedFilterState.patch.");
  }
  if (featureRegistry && typeof featureRegistry.projectState !== "function") {
    throw new Error("createFrontShopFilters requires featureRegistry.projectState.");
  }
  if (typeof onSharedFilterProjection !== "function") {
    throw new Error("createFrontShopFilters requires onSharedFilterProjection.");
  }

  let frontShopSellers = [];
  let sharedStateApplied = false;
  let pendingSharedOwner = sharedFilterState?.get?.()?.owner?.slice?.() || [];

  function selectValues(select, values = []) {
    if (!select?.options) return;
    const selected = new Set(values);
    [...select.options].forEach((option) => {
      option.selected = option.value ? selected.has(option.value) : selected.size === 0;
    });
  }

  function applySharedFilterStateToControls() {
    if (!sharedFilterState || sharedStateApplied) return;
    const state = sharedFilterState.get();
    const countrySelect = root?.querySelector?.("#front-country-filter");
    const shopSelect = root?.querySelector?.("#front-shop-filter");
    const currencySelect = root?.querySelector?.("#front-currency-filter");
    selectValues(countrySelect, state.country);
    if (state.country.length || state.store.length) {
      const shopOptions = frontShopSellers.map((seller) => ({
        name: pickSellerName(seller),
        label: pickSellerName(seller),
        country: normalizeCountryName(pickSellerCountry(seller)),
      }));
      setSelectOptions(shopSelect, shopOptions, "全部店铺", {
        groupByCountry: true,
        countries: state.country,
      });
    }
    selectValues(shopSelect, state.store);
    if (currencySelect && state.currency && (!currencySelect.value || state.currency !== "CNY")) {
      currencySelect.value = state.currency;
    }
    pendingSharedOwner = state.owner.slice();
    sharedStateApplied = true;
  }

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
    applySharedFilterStateToControls();
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

  async function handleFrontOwnerFilterChange() {
    await onFiltersChange();
    onOwnerFilterChange();
  }

  function buildDashboardQuery() {
    const dateRange = getFrontDateRange();
    const sharedStateBeforeHydration = sharedFilterState?.get?.() || null;
    const selectedSids = getSelectedFrontSids();
    const selectedCountries = selectedFilterValues("#front-country-filter", root);
    const selectedStores = selectedFilterValues("#front-shop-filter", root);
    const useInitialSharedContext = Boolean(sharedFilterState && !sharedStateApplied);
    const sids = useInitialSharedContext && !selectedSids.length
      ? sharedStateBeforeHydration.sid.map(Number)
      : selectedSids;
    const countries = useInitialSharedContext && !selectedCountries.length
      ? sharedStateBeforeHydration.country.slice()
      : selectedCountries;
    const stores = useInitialSharedContext && !selectedStores.length
      ? sharedStateBeforeHydration.store.slice()
      : selectedStores;
    const selectedOwner = fieldValue("#front-owner-filter", "", root).trim();
    const ownerValues = selectedOwner
      ? [selectedOwner]
      : pendingSharedOwner.slice();
    const selectedCurrency = fieldValue("#front-currency-filter", "CNY", root) || "CNY";
    const currency = useInitialSharedContext && sharedStateBeforeHydration.currency !== "CNY" && selectedCurrency === "CNY"
      ? sharedStateBeforeHydration.currency
      : selectedCurrency;
    const nextContext = {
      date: { start: dateRange.start, end: dateRange.end },
      country: countries,
      sid: sids,
      store: stores,
      owner: ownerValues,
      currency,
    };
    const state = sharedFilterState
      ? sharedFilterState.patch(nextContext, { source: "sales-dashboard-filters" })
      : nextContext;
    if (!featureRegistry) {
      const params = new URLSearchParams();
      params.set("startDate", dateRange.start);
      params.set("endDate", dateRange.end);
      params.set("currencyCode", currency);
      if ((countries.length || stores.length) && sids.length) params.set("sids", sids.join(","));
      if (ownerValues.length) params.set("listingOwner", ownerValues[0]);
      return params.toString();
    }
    const projection = featureRegistry.projectState(featureId, state, { purpose: "query" });
    onSharedFilterProjection(projection);
    return encodeSharedFilterState(projection.state, { include: projection.feature.queryFilters }).toString();
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
    bind(root, "#front-owner-filter", "change", async (...args) => {
      pendingSharedOwner = [];
      return handleFrontOwnerFilterChange(...args);
    });
    bind(root, "#front-currency-filter", "change", onFiltersChange);
  }

  return {
    buildDashboardQuery,
    getFrontShopSellers,
    getSelectedFrontSids,
    populateFrontShopFilters,
    setupFrontShopFilterControls,
  };
}

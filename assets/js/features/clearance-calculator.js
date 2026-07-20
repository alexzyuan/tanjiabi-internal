const CLEARANCE_SAMPLE_ROWS = [
  ["店铺", "MSKU", "品名", "库存量", "近30天销量", "日销", "可售天数", "单位成本", "月仓储费", "日仓储费"],
  ["US探嘉", "JM-DGC-BLUE", "灯光船蓝色", "539", "120", "", "", "8.20", "28.4", ""],
  ["US探嘉", "JM-9006Truck", "玩具车", "320", "36", "", "", "7.80", "84.7", ""],
  ["CA探嘉", "CAJM-HDPPJ", "花朵泡泡机", "122", "12", "", "", "6.40", "12.5", ""],
].map((row) => row.join("\t")).join("\n");

const CLEARANCE_HEADER_ALIASES = {
  storeName: ["店铺", "店铺名", "账号", "store", "storeName", "shop", "shopName"],
  msku: ["msku", "MSKU", "seller sku", "seller_sku", "sellerSku"],
  productName: ["品名", "商品名", "产品", "产品名称", "product", "productName", "title"],
  ageDays: ["库龄", "库龄天数", "age", "ageDays", "inventory age", "storage days"],
  inventory: ["库存", "库存量", "FBA在库", "数量", "inventory", "quantity", "qty"],
  recent30Sales: ["近30天销量", "30天销量", "最近30天销量", "recent30", "sales30", "last30sales"],
  dailyVelocity: ["日销", "销售速度", "日均销量", "daily", "dailyVelocity", "velocity"],
  saleableDays: ["可售天数", "预计卖完", "预计卖完天数", "可售", "saleableDays", "availableDays", "daysOfSupply"],
  price: ["售价", "销售价", "单价", "price", "salePrice"],
  unitCost: ["单位成本", "成本", "采购成本", "cost", "unitCost"],
  cubicFeet: ["体积", "立方英尺", "体积(cuft/件)", "cuft", "cubicFeet", "volume"],
  monthlyStorageFee: ["月仓储费", "ERP月仓储费", "预计月仓储费", "月仓储成本", "monthlyStorageFee", "storageFeeMonthly"],
  dailyStorageFee: ["日仓储费", "ERP日仓储费", "每日仓储费", "日仓储成本", "dailyStorageFee", "storageFeeDaily"],
};

export function createClearanceCalculatorFeature({
  root = globalThis.document,
  bind,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  selectedFilterValue,
  selectedFilterValues,
  renderTableMessage,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
} = {}) {
  let clearanceRealInventoryLoaded = false;
  let clearanceRows = [];
  let clearanceCountryFilterOptions = [];
  let clearanceStoreFilterOptions = [];
  let clearanceOwnerFilterOptions = [];

  function normalizeClearanceHeader(value) {
    return String(value || "").trim().replace(/\s+/g, "").replace(/[()（）/\\_-]/g, "").toLowerCase();
  }

  function parseClearanceLine(line) {
    const text = String(line || "").trim();
    if (!text) return [];
    if (text.includes("\t")) return text.split("\t").map((item) => item.trim());
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  }

  function clearanceHeaderMap(cells) {
    const normalizedCells = cells.map(normalizeClearanceHeader);
    const map = {};
    Object.entries(CLEARANCE_HEADER_ALIASES).forEach(([key, aliases]) => {
      const normalizedAliases = aliases.map(normalizeClearanceHeader);
      const index = normalizedCells.findIndex((cell) => normalizedAliases.includes(cell));
      if (index >= 0) map[key] = index;
    });
    return Object.keys(map).length >= 4 ? map : null;
  }

  function clearanceCell(cells, header, key, fallbackIndex) {
    const index = header?.[key] ?? fallbackIndex;
    return cells[index] ?? "";
  }

  function clearanceCurrency(value) {
    const number = Number(value || 0);
    const prefix = number < 0 ? "-$" : "$";
    return `${prefix}${formatActualMoney(Math.abs(number))}`;
  }

  function readClearanceRates() {
    return {
      exchangeRate: 0,
    };
  }

  function parseClearanceRows() {
    return Array.isArray(clearanceRows) ? clearanceRows : [];
  }

  function clearanceDailyCost(row) {
    if (Number(row.dailyStorageFee || 0) > 0) return Number(row.dailyStorageFee || 0);
    if (Number(row.monthlyStorageFee || 0) > 0) return Number(row.monthlyStorageFee || 0) / 30.44;
    return 0;
  }

  function clearanceDaysText(value) {
    return Number.isFinite(value) ? `${formatActualMoney(value)}天` : "无日销";
  }

  function buildClearanceResults(rows, rates) {
    return rows
      .map((row) => {
        const saleableDays = row.saleableDays === Infinity || (row.saleableDays == null && Number(row.dailyVelocity || 0) <= 0)
          ? Infinity
          : Number(row.saleableDays || 0);
        const currentDailyCost = clearanceDailyCost(row);
        const holdingCost = Number.isFinite(saleableDays) ? saleableDays * currentDailyCost : Infinity;
        const landedCostFallback = Number(row.averagePurchaseCost || row.purchaseCost || 0) + Number(row.averageFirstLegCost || row.firstLegCost || 0);
        const landedUnitCost = Number(row.landedUnitCost ?? landedCostFallback);
        const inventoryCost = Number(row.landedInventoryCost || 0) || landedUnitCost * Number(row.inventory || 0);
        const averageGrossProfit = Number(row.averageGrossProfit || 0);
        const averageGrossProfitAbs = Math.abs(averageGrossProfit);
        const hasRecentSales = Number(row.recent30Sales || 0) > 0;
        const grossProfitGap = hasRecentSales ? Number(row.grossProfitGap ?? (averageGrossProfitAbs - landedUnitCost)) : null;
        const costRate = inventoryCost > 0 && Number.isFinite(holdingCost) ? holdingCost / inventoryCost : null;
        const storageCostMinusInventoryCost = inventoryCost > 0 && Number.isFinite(holdingCost) ? holdingCost - inventoryCost : null;
        let riskLevel = "可观察";
        if (!hasRecentSales) riskLevel = "无销量";
        else if (grossProfitGap > 0) riskLevel = "建议清";
        return {
          ...row,
          saleableDays,
          currentDailyCost,
          holdingDays: saleableDays,
          holdingCost,
          landedUnitCost,
          averageGrossProfit,
          averageGrossProfitAbs,
          grossProfitGap,
          inventoryCost,
          storageCostToInventoryCostRate: costRate,
          storageCostMinusInventoryCost,
          riskLevel,
        };
      })
      .filter((row) => Number(row.recent30Sales || 0) > 0 && Number(row.averageGrossProfit || 0) < 0 && Number(row.inventory || 0) > 10)
      .sort((left, right) => {
        const leftDays = left.saleableDays === Infinity ? Number.POSITIVE_INFINITY : Number(left.saleableDays || 0);
        const rightDays = right.saleableDays === Infinity ? Number.POSITIVE_INFINITY : Number(right.saleableDays || 0);
        const leftPriority = left.riskLevel === "建议清" ? 2 : left.riskLevel === "无销量" ? 1 : 0;
        const rightPriority = right.riskLevel === "建议清" ? 2 : right.riskLevel === "无销量" ? 1 : 0;
        return rightPriority - leftPriority
          || Number(right.grossProfitGap ?? -999999) - Number(left.grossProfitGap ?? -999999)
          || rightDays - leftDays
          || Number(right.holdingCost || 0) - Number(left.holdingCost || 0);
      });
  }

  function renderClearanceCalculator() {
    const rates = readClearanceRates();
    const rows = parseClearanceRows();
    const results = buildClearanceResults(rows, rates);
    const totals = results.reduce((acc, row) => {
      acc.inventory += row.inventory || 0;
      acc.currentDailyCost += row.currentDailyCost || 0;
      if (Number.isFinite(row.holdingCost)) acc.holdingCost += row.holdingCost || 0;
      acc.inventoryCost += row.inventoryCost || 0;
      acc.recent30Sales += Number(row.recent30Sales || 0);
      acc.recent30GrossProfit += Number(row.recent30GrossProfit || 0);
      acc.recent7GrossProfit += Number(row.recent7GrossProfit || 0);
      acc.recent30PurchaseCost += Number(row.recent30PurchaseCost || 0);
      acc.recent30FirstLegCost += Number(row.recent30FirstLegCost || 0);
      acc.landedInventoryCost += Number(row.inventoryCost || 0);
      if (row.grossProfitGap !== null) acc.totalGrossProfitGap += Number(row.grossProfitGap || 0) * Number(row.inventory || 0);
      if (row.riskLevel === "建议清") acc.candidateCount += 1;
      if (row.saleableDays === Infinity) acc.noSalesCount += 1;
      return acc;
    }, { inventory: 0, currentDailyCost: 0, holdingCost: 0, inventoryCost: 0, recent30Sales: 0, recent30GrossProfit: 0, recent7GrossProfit: 0, recent30PurchaseCost: 0, recent30FirstLegCost: 0, landedInventoryCost: 0, totalGrossProfitGap: 0, candidateCount: 0, noSalesCount: 0 });
    const weightedAverageGrossProfit = totals.recent30Sales
      ? results.reduce((sum, row) => sum + Number(row.averageGrossProfit || 0) * Number(row.recent30Sales || 0), 0) / totals.recent30Sales
      : 0;
    const weightedAverageLandedCost = totals.recent30Sales ? (totals.recent30PurchaseCost + totals.recent30FirstLegCost) / totals.recent30Sales : 0;

    setText("#clearance-msku-count", formatNumber(results.length), root);
    setText("#clearance-daily-cost", formatNumber(totals.candidateCount), root);
    setText("#clearance-daily-cost-cny", "均毛利为负，库存>10", root);
    setText("#clearance-hold-cost", clearanceCurrency(weightedAverageGrossProfit), root);
    setText("#clearance-loss", totals.landedInventoryCost ? clearanceCurrency(weightedAverageLandedCost) : "-", root);
    setText("#clearance-delta", totals.landedInventoryCost ? clearanceCurrency(totals.totalGrossProfitGap) : "-", root);
    setText("#clearance-delta-note", "按 |均毛利| - 单只货值 加权", root);
    setText("#clearance-input-status", results.length ? `已读取 ${results.length} 个近30天均毛利为负且库存>10的 MSKU，FBA库存 ${formatActualMoney(totals.inventory)} 件` : "未读取到近30天均毛利为负且库存>10的库存行", root);
    setText("#clearance-rule-status", "", root);
    setText("#clearance-result-status", results.length ? `共 ${results.length} 条，建议清货 ${totals.candidateCount} 条` : "等待计算", root);

    const table = root?.querySelector?.("#clearance-table");
    if (!table) return;
    if (!results.length) {
      renderTableMessage?.(table, 13, "未读取到近30天均毛利为负且库存>10的库存行。", root, { tone: "empty" });
      return;
    }
    table.innerHTML = results.map((row) => {
      const isHighRisk = row.riskLevel === "建议清" || row.riskLevel === "无销量";
      const hasLandedCost = Number(row.landedUnitCost || 0) > 0;
      return `
        <tr class="${isHighRisk ? "clearance-action-row" : ""}">
          <td><span class="risk-badge ${isHighRisk ? "risk-high" : "risk-low"}">${escapeHtml(row.riskLevel)}</span></td>
          <td>${escapeHtml(row.country || "-")}</td>
          <td>${escapeHtml(row.storeName || "-")}</td>
          <td>${escapeHtml(row.listingOwner || "-")}</td>
          <td><strong>${escapeHtml(row.msku)}</strong><br /><small>${escapeHtml(row.productName || "")}</small></td>
          <td>${formatActualMoney(row.inventory)}</td>
          <td>${formatActualMoney(row.dailyVelocity)}</td>
          <td>${clearanceDaysText(row.saleableDays)}</td>
          <td>${row.recent30Sales ? clearanceCurrency(row.averageGrossProfit) : "-"}</td>
          <td>${clearanceCurrency(row.recent7AverageGrossProfit || 0)}</td>
          <td>${hasLandedCost ? clearanceCurrency(row.landedUnitCost) : "-"}</td>
          <td class="${row.grossProfitGap > 0 ? "clearance-negative" : "clearance-positive"}">${row.grossProfitGap === null ? "-" : clearanceCurrency(row.grossProfitGap)}</td>
          <td>${hasLandedCost ? clearanceCurrency(row.inventoryCost) : "-"}</td>
        </tr>
      `;
    }).join("");
  }

  function resetClearanceCalculator() {
    const input = root?.querySelector?.("#clearance-input");
    if (input) input.value = "";
    clearanceRealInventoryLoaded = false;
    setText("#clearance-real-status", "未读取动销预警", root);
    renderClearanceCalculator();
  }

  function fillClearanceSample() {
    const input = root?.querySelector?.("#clearance-input");
    if (input) input.value = CLEARANCE_SAMPLE_ROWS;
    renderClearanceCalculator();
  }

  function clearanceInputRowsFromRealData(rows = []) {
    const header = ["店铺", "MSKU", "品名", "库存量", "近30天销量", "日销", "可售天数", "单位成本", "月仓储费", "日仓储费"];
    const body = rows.map((row) => [
      row.storeName || "",
      row.msku || "",
      row.productName || row.ageBucket || "",
      row.inventory || "",
      row.recent30Sales || "",
      row.dailyVelocity || "",
      row.saleableDays || "",
      row.unitCost || "",
      row.monthlyStorageFee || "",
      row.dailyStorageFee || "",
    ]);
    return [header, ...body].map((line) => line.map((cell) => String(cell ?? "")).join("\t")).join("\n");
  }

  function setClearanceSelectOptions(selector, options = [], allLabel = "全部") {
    const select = root?.querySelector?.(selector);
    if (!select) return;
    const normalizedOptions = (options || [])
      .map((item) => ({
        value: String(item?.value ?? item?.name ?? item ?? "").trim(),
        label: String(item?.name ?? item?.label ?? item ?? "").trim(),
      }))
      .filter((item) => item.value && item.label);
    if (select.multiple) {
      const isStoreFilter = selector.includes("store");
      setSelectOptions(select, normalizedOptions, allLabel, {
        groupByCountry: isStoreFilter,
        countries: isStoreFilter ? selectedFilterValues("#clearance-country-filter") : [],
      });
      return;
    }
    const previousValue = select.value;
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${normalizedOptions
      .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
      .join("")}`;
    if ([...select.options].some((option) => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  function populateClearanceStoreOptions({ selectAllStores = false } = {}) {
    const countries = selectedFilterValues("#clearance-country-filter");
    setSelectOptions("#clearance-store-filter", clearanceStoreFilterOptions, "全部店铺", { groupByCountry: true, countries, selectAllVisible: selectAllStores });
  }

  function populateClearanceFilters(filters = {}) {
    if (filters.countryOptions?.length) clearanceCountryFilterOptions = filters.countryOptions;
    if (filters.storeOptions?.length) clearanceStoreFilterOptions = filters.storeOptions;
    if (filters.ownerOptions?.length) clearanceOwnerFilterOptions = filters.ownerOptions;
    setClearanceSelectOptions("#clearance-country-filter", clearanceCountryFilterOptions, "全部国家");
    populateClearanceStoreOptions();
    setClearanceSelectOptions("#clearance-owner-filter", clearanceOwnerFilterOptions, "全部运营");
  }

  function buildClearanceQuery() {
    const params = new URLSearchParams();
    const country = selectedFilterValue("#clearance-country-filter");
    const storeName = selectedFilterValue("#clearance-store-filter");
    const listingOwner = fieldValue("#clearance-owner-filter", "", root);
    if (country) params.set("country", country);
    if (storeName) params.set("storeName", storeName);
    if (listingOwner) params.set("listingOwner", listingOwner);
    return params;
  }

  async function loadClearanceInventory() {
    const button = root?.querySelector?.("#clearance-load-real-button");
    const restoreButton = setButtonBusy(button, "读取中...", button?.textContent || "刷新数据");
    const query = buildClearanceQuery();
    setText("#clearance-real-status", "正在读取动销预警", root);
    try {
      const response = await fetch(`/api/dashboard/clearance-inventory?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      const rows = data.rows || [];
      clearanceRows = rows;
      populateClearanceFilters(data.filters || {});
      clearanceRealInventoryLoaded = true;
      renderClearanceCalculator();
      setText(
        "#clearance-real-status",
        rows.length
          ? `预警 ${rows.length} 条，建议清货 ${formatActualMoney(data.kpis?.clearanceCandidateCount || 0)} 条 · ${data.meta?.clearanceCacheHit ? "已用今日缓存" : "已更新今日缓存"}`
          : "未找到近30天均毛利为负且库存>10的库存",
        root,
      );
      setText("#clearance-result-status", rows.length
        ? `动销预警 ${rows.length} 条 · ${data.meta?.clearanceCachePolicy || data.meta?.source || ""}`
        : "暂无近30天均毛利为负且库存>10的库存数据", root);
    } catch (error) {
      setText("#clearance-real-status", `动销预警读取失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function loadClearanceView() {
    if (!clearanceRealInventoryLoaded) {
      await loadClearanceInventory();
      return;
    }
    renderClearanceCalculator();
  }

  function handleClearanceCountryChange() {
    syncAllOptionSelection(root?.querySelector?.("#clearance-country-filter"));
    populateClearanceStoreOptions({ selectAllStores: true });
    loadClearanceInventory();
  }

  function handleClearanceStoreChange() {
    syncAllOptionSelection(root?.querySelector?.("#clearance-store-filter"));
    loadClearanceInventory();
  }

  function setupClearanceCalculator() {
    bind(root, "#clearance-load-real-button", "click", loadClearanceInventory);
    bind(root, "#clearance-country-filter", "change", handleClearanceCountryChange);
    bind(root, "#clearance-store-filter", "change", handleClearanceStoreChange);
    bind(root, "#clearance-owner-filter", "change", loadClearanceInventory);
  }

  return {
    buildClearanceResults,
    clearanceHeaderMap,
    clearanceInputRowsFromRealData,
    fillClearanceSample,
    loadClearanceInventory,
    loadClearanceView,
    parseClearanceLine,
    renderClearanceCalculator,
    resetClearanceCalculator,
    setupClearanceCalculator,
  };
}

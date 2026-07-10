import { chartBucketClass, renderChartSwatch } from "../ui-components.js?v=20260707-ui-components-v1";

export function createInventoryProvisionFeature({
  root = globalThis.document,
  loadDashboardSection,
  bind,
  downloadBlob,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  fieldValue,
  formatActualMoney,
  formatNumber,
  getDefaultMonth,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
} = {}) {
  if (typeof loadDashboardSection !== "function") throw new Error("createInventoryProvisionFeature requires loadDashboardSection.");
  if (typeof bind !== "function") throw new Error("createInventoryProvisionFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createInventoryProvisionFeature requires fetch.");

  let inventoryStoreFilterOptions = [];

  function shortMoney(value) {
    const number = Number(value || 0);
    if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1)}万`;
    return Math.round(number).toLocaleString("zh-CN");
  }

  function drawStackedColumnChart(id, rows, buckets, options = {}) {
    const svg = root?.querySelector?.(id);
    if (!svg) return;
    if (!rows?.length) {
      svg.innerHTML = `<text class="label" x="24" y="44">暂无库龄数据</text>`;
      return;
    }
    const width = 720;
    const height = 340;
    const left = 58;
    const right = 28;
    const top = 58;
    const bottom = 54;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maxTotal = Math.max(1, ...rows.map((row) => buckets.reduce((sum, bucket) => sum + Number(row.values?.[bucket.key] || 0), 0))) * 1.18;
    const step = chartWidth / rows.length;
    const barWidth = Math.min(54, step * 0.52);
    const legend = buckets.map((bucket, index) => {
      const x = 74 + (index % 3) * 150;
      const y = 16 + Math.floor(index / 3) * 22;
      return `<rect class="${chartBucketClass(bucket.key, index)}" x="${x}" y="${y}" width="12" height="12" rx="2"></rect><text class="legend" x="${x + 18}" y="${y + 11}">${bucket.label}</text>`;
    }).join("");
    const grid = [0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = top + chartHeight * ratio;
      const value = maxTotal * (1 - ratio);
      return `<line class="grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="label" x="8" y="${y + 4}">${shortMoney(value)}</text>`;
    }).join("");
    const bars = rows.map((row, rowIndex) => {
      const x = left + rowIndex * step + (step - barWidth) / 2;
      let yCursor = top + chartHeight;
      const segments = buckets.map((bucket, bucketIndex) => {
        const value = Number(row.values?.[bucket.key] || 0);
        const segmentHeight = (value / maxTotal) * chartHeight;
        yCursor -= segmentHeight;
        return `<rect class="${chartBucketClass(bucket.key, bucketIndex)}" x="${x}" y="${yCursor}" width="${barWidth}" height="${segmentHeight}" rx="3"><title>${bucket.label} ${shortMoney(value)}</title></rect>`;
      }).join("");
      const label = row[options.labelKey || "month"] || "";
      const rotate = options.rotateLabels ? `transform="rotate(-32 ${x + barWidth / 2} ${height - 18})"` : "";
      return `${segments}<text class="label" x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" ${rotate}>${escapeHtml(label)}</text>`;
    }).join("");

    svg.innerHTML = `
      ${legend}
      ${grid}
      <line class="axis" x1="${left}" y1="${top + chartHeight}" x2="${width - right}" y2="${top + chartHeight}"></line>
      ${bars}
    `;
  }

  function drawDonutChart(id, summary, buckets) {
    const svg = root?.querySelector?.(id);
    if (!svg) return;
    const total = summary.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (!total) {
      svg.innerHTML = `<text class="label" x="24" y="44">暂无库龄数据</text>`;
      return;
    }
    const cx = 190;
    const cy = 156;
    const radius = 74;
    const strokeWidth = 28;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const circles = summary.map((item) => {
      const bucket = buckets.find((candidate) => candidate.key === item.key) || item;
      const bucketIndex = Math.max(0, buckets.findIndex((candidate) => candidate.key === item.key));
      const dash = (Number(item.amount || 0) / total) * circumference;
      const circle = `
        <circle class="${chartBucketClass(bucket.key, bucketIndex)}" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke-width="${strokeWidth}"
          stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})">
          <title>${bucket.label} ${shortMoney(item.amount)} · ${item.percent}%</title>
        </circle>
      `;
      offset += dash;
      return circle;
    }).join("");
    const labels = summary.map((item, index) => {
      const bucket = buckets.find((candidate) => candidate.key === item.key) || item;
      const bucketIndex = Math.max(0, buckets.findIndex((candidate) => candidate.key === item.key));
      const x = 325;
      const y = 74 + index * 34;
      return `<rect class="${chartBucketClass(bucket.key, bucketIndex)}" x="${x}" y="${y - 11}" width="12" height="12" rx="2"></rect><text class="legend" x="${x + 18}" y="${y}">${bucket.label} ${shortMoney(item.amount)} · ${item.percent}%</text>`;
    }).join("");
    svg.innerHTML = `
      <circle class="inventory-donut-track" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke-width="${strokeWidth}"></circle>
      ${circles}
      <text class="value-label" x="${cx}" y="${cy - 4}" text-anchor="middle">合计</text>
      <text class="value-label" x="${cx}" y="${cy + 22}" text-anchor="middle">${shortMoney(total)}</text>
      ${labels}
    `;
  }

  function populateInventoryCountryOptions(options = []) {
    setSelectOptions("#inventory-provision-country", options, "全部国家");
  }

  function populateInventoryStoreOptions(options = [], { selectAllStores = false } = {}) {
    inventoryStoreFilterOptions = options || [];
    const countries = selectedFilterValues("#inventory-provision-country", root);
    setSelectOptions("#inventory-provision-store", inventoryStoreFilterOptions, "全部店铺", { groupByCountry: true, countries, selectAllVisible: selectAllStores });
  }

  function populateInventoryOwnerOptions(options = []) {
    const select = root?.querySelector?.("#inventory-provision-owner");
    if (!select) return;
    const selected = select.value;
    select.innerHTML = `<option value="">全部负责人</option>${options
      .map((item) => `<option value="${escapeHtml(item.value || item.name)}">${escapeHtml(item.name)}</option>`)
      .join("")}`;
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function setDefaultInventoryProvisionDate() {
    const dateInput = root?.querySelector?.("#inventory-provision-date");
    const today = getDefaultMonth();
    if (!dateInput) return;
    dateInput.max = today;
    if (!dateInput.value) dateInput.value = today;
  }

  function renderInventoryProvision(data) {
    const buckets = data.buckets || [];
    const kpis = data.kpis || {};
    const costModeLabel = data.meta?.costModeLabel || "采购成本";
    const snapshotAvailable = data.meta?.snapshotAvailable !== false;
    setText("#inventory-total-amount", `¥${formatActualMoney(kpis.inventoryAmount || 0)}`, root);
    setText("#inventory-provision-amount", `¥${formatActualMoney(kpis.provisionAmount || 0)}`, root);
    setText("#inventory-monthly-provision-amount", `¥${formatActualMoney(kpis.monthlyProvisionAmount || 0)}`, root);
    setText("#inventory-reversal-amount", `¥${formatActualMoney(kpis.reversalAmount || 0)}`, root);
    setText("#inventory-net-provision-amount", `¥${formatActualMoney(kpis.netProvisionAmount || 0)}`, root);
    const netProvisionAmount = Number(kpis.netProvisionAmount || 0);
    setText("#inventory-net-provision-note", netProvisionAmount < 0 ? "需要加回利润" : netProvisionAmount > 0 ? "需要扣减利润" : "无需影响利润", root);
    const bucketSummaryByKey = Object.fromEntries((data.bucketSummary || []).map((item) => [item.key, item]));
    setText("#inventory-age-91-180-amount", `¥${formatActualMoney(bucketSummaryByKey["91_180"]?.amount || 0)}`, root);
    setText("#inventory-age-181-270-amount", `¥${formatActualMoney(bucketSummaryByKey["181_270"]?.amount || 0)}`, root);
    setText("#inventory-age-271-plus-amount", `¥${formatActualMoney(bucketSummaryByKey["271_plus"]?.amount || 0)}`, root);
    setText("#inventory-cost-mode-note", costModeLabel, root);
    setText("#inventory-unit-cost-head", costModeLabel, root);
    setText("#inventory-provision-status", `${data.meta?.source || "数据源"} · ${data.meta?.date || ""} · ${data.meta?.syncStatus || ""}${data.meta?.reversalStatus ? ` · ${data.meta.reversalStatus}` : ""}`, root);
    const availableDates = data.meta?.availableDates || [];
    setText(
      "#inventory-provision-date-note",
      snapshotAvailable
        ? data.meta?.historicalMode
          ? `历史月末库存 · 库龄按库存分类账 FIFO 重建${data.meta?.snapshotUpdatedAt ? ` · 缓存 ${data.meta.snapshotUpdatedAt}` : ""}`
          : "当前月份为实时库存"
        : availableDates.length
          ? `历史月报读取失败；本地快照：${availableDates.slice(-5).join("、")}`
          : "历史月报读取失败，请稍后重试",
      root,
    );
    populateInventoryCountryOptions(data.filters?.countryOptions || []);
    populateInventoryStoreOptions(data.filters?.storeOptions || []);
    populateInventoryOwnerOptions(data.filters?.ownerOptions || []);

    drawStackedColumnChart("#inventory-age-trend-chart", data.monthTrend || [], buckets, { labelKey: "month" });
    drawDonutChart("#inventory-age-donut-chart", data.bucketSummary || [], buckets);
    drawStackedColumnChart("#inventory-store-chart", data.storeDistribution || [], buckets, { labelKey: "storeName", rotateLabels: true });

    const bucketTable = root?.querySelector?.("#inventory-bucket-table");
    if (bucketTable) {
      bucketTable.innerHTML = (data.bucketSummary || []).map((item) => `
        <tr class="${item.rate > 0 ? "provision-risk-row" : ""}">
          <td>${renderChartSwatch({
            key: item.key,
            index: Math.max(0, data.buckets?.findIndex?.((bucket) => bucket.key === item.key) ?? 0),
            label: item.label,
          })}</td>
          <td>${Math.round(Number(item.rate || 0) * 100)}%</td>
          <td>¥${formatActualMoney(item.amount || 0)}</td>
          <td>${Number(item.percent || 0).toFixed(2)}%</td>
          <td>¥${formatActualMoney(item.provisionAmount || 0)}</td>
          <td>¥${formatActualMoney(item.monthlyProvisionAmount || 0)}</td>
          <td>¥${formatActualMoney(item.reversalAmount || 0)}</td>
          <td>¥${formatActualMoney(item.netProvisionAmount || 0)}</td>
        </tr>
      `).join("");
    }

    const detailTable = root?.querySelector?.("#inventory-detail-table");
    if (detailTable) {
      const rows = data.detailRows || [];
      detailTable.innerHTML = rows.length ? rows.map((item) => `
        <tr class="${item.provisionRate > 0 ? "provision-risk-row" : ""}">
          <td>${escapeHtml(item.storeName)}</td>
          <td>${escapeHtml(item.country)}</td>
          <td><strong>${escapeHtml(item.msku)}</strong><br /><small>${escapeHtml(item.skuName || "")}</small></td>
          <td>${escapeHtml(item.listingOwner && item.listingOwner !== "-" ? item.listingOwner : "负责人留空")}</td>
          <td>${item.ageDays}天 · ${escapeHtml(item.bucketLabel)}</td>
          <td>${formatNumber(item.quantity || 0)}</td>
          <td>¥${formatActualMoney(item.purchaseCost || 0)}</td>
          <td>¥${formatActualMoney(item.firstLegCost || 0)}</td>
          <td>¥${formatActualMoney(item.unitCost || 0)}</td>
          <td>¥${formatActualMoney(item.amount || 0)}</td>
          <td>${Math.round(Number(item.provisionRate || 0) * 100)}%</td>
          <td>¥${formatActualMoney(item.provisionAmount || 0)}</td>
          <td>¥${formatActualMoney(item.monthlyProvisionAmount || 0)}</td>
          <td>¥${formatActualMoney(item.reversalAmount || 0)}</td>
          <td>¥${formatActualMoney(item.netProvisionAmount || 0)}</td>
        </tr>
      `).join("") : `<tr><td colspan="15">暂无符合条件的库存计提数据。</td></tr>`;
    }
  }

  function buildInventoryProvisionQuery() {
    const params = new URLSearchParams();
    const date = fieldValue("#inventory-provision-date", "", root) || getDefaultMonth();
    const country = selectedFilterValue("#inventory-provision-country", root);
    const storeName = selectedFilterValue("#inventory-provision-store", root);
    const listingOwner = fieldValue("#inventory-provision-owner", "", root);
    const costMode = fieldValue("#inventory-provision-cost-mode", "", root) || "purchase";
    const keyword = trimmedFieldValue("#inventory-provision-keyword", "", root);
    if (date) params.set("date", date);
    if (country) params.set("country", country);
    if (storeName) params.set("storeName", storeName);
    if (listingOwner) params.set("listingOwner", listingOwner);
    if (costMode) params.set("costMode", costMode);
    if (keyword) params.set("keyword", keyword);
    return params.toString();
  }

  async function loadInventoryProvision() {
    setDefaultInventoryProvisionDate();
    await loadDashboardSection({
      endpoint: `/api/dashboard/inventory-provision?${buildInventoryProvisionQuery()}`,
      buttonSelector: "#inventory-provision-refresh",
      busyText: "刷新中...",
      restoreText: "刷新计提",
      buttonBusyOptions: { disable: false },
      statusSelector: "#inventory-provision-status",
      loadingStatus: "正在读取FBA在库库龄数据",
      validate: (response) => response.ok,
      errorMessage: (response, data) => data.error || `API ${response.status}`,
      onData: renderInventoryProvision,
      onError: (error) => {
        setText("#inventory-provision-status", `库存计提加载失败：${error.message}`, root);
        const bucketTable = root?.querySelector?.("#inventory-bucket-table");
        const detailTable = root?.querySelector?.("#inventory-detail-table");
        renderTableMessage(bucketTable, 8, "加载失败，请稍后重试。");
        renderTableMessage(detailTable, 15, "加载失败，请稍后重试。");
      },
      root,
    });
  }

  async function exportInventoryProvisionDetail() {
    const button = root?.querySelector?.("#inventory-provision-export");
    const restoreButton = setButtonBusy(button, "导出中...", button?.textContent || "导出文件");
    try {
      const response = await fetchImpl(`/api/dashboard/inventory-provision/export?${buildInventoryProvisionQuery()}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `导出失败：${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const exportMonth = fieldValue("#inventory-provision-date", "", root) || "未选择月份";
      const filename = match ? decodeURIComponent(match[1]) : `库存减值明细-${exportMonth}.xlsx`;
      downloadBlob(blob, filename);
      setText("#inventory-provision-status", `库存减值明细已导出：${filename}`, root);
    } catch (error) {
      setText("#inventory-provision-status", `库存减值明细导出失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  function handleInventoryProvisionCountryChange() {
    syncAllOptionSelection(root?.querySelector?.("#inventory-provision-country"));
    populateInventoryStoreOptions(inventoryStoreFilterOptions, { selectAllStores: true });
    loadInventoryProvision();
  }

  function handleInventoryProvisionStoreChange() {
    syncAllOptionSelection(root?.querySelector?.("#inventory-provision-store"));
    loadInventoryProvision();
  }

  function handleInventoryProvisionKeywordKeydown(event) {
    if (event.key === "Enter") loadInventoryProvision();
  }

  function setupInventoryProvision() {
    bind(root, "#inventory-provision-refresh", "click", loadInventoryProvision);
    bind(root, "#inventory-provision-export", "click", exportInventoryProvisionDetail);
    bind(root, "#inventory-provision-date", "change", loadInventoryProvision);
    bind(root, "#inventory-provision-country", "change", handleInventoryProvisionCountryChange);
    bind(root, "#inventory-provision-store", "change", handleInventoryProvisionStoreChange);
    bind(root, "#inventory-provision-owner", "change", loadInventoryProvision);
    bind(root, "#inventory-provision-cost-mode", "change", loadInventoryProvision);
    bind(root, "#inventory-provision-keyword", "keydown", handleInventoryProvisionKeywordKeydown);
  }

  return {
    buildInventoryProvisionQuery,
    loadInventoryProvision,
    renderInventoryProvision,
    setDefaultInventoryProvisionDate,
    setupInventoryProvision,
  };
}

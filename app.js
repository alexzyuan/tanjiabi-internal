import TanjiaUiUtils from "./assets/js/ui-utils.js?v=20260706-frontend-refactor-v41";
import { installDashboardLoadingFetchOverlay, loadDashboardSection } from "./assets/js/dashboard-loader.js?v=20260803-global-page-loading-v1";
import { createFilterControls } from "./assets/js/filter-controls.js?v=20260707-frontend-refactor-v1";
import {
  createFrontShopFilters,
  getDisplayShopName,
  pickSellerCountry,
  pickSellerName,
} from "./assets/js/front-shop-filters.js?v=20260724-sales-owner-detail-jump-v1";
import { readFileAsBase64 } from "./assets/js/file-utils.js?v=20260707-frontend-refactor-v1";
import { cachedSalesImageUrl, normalizedSalesImageUrl } from "./assets/js/image-url.js?v=20260707-frontend-refactor-v1";
import { createFbaUtils } from "./assets/js/fba-utils.js?v=20260707-frontend-refactor-v1";
import {
  BEIJING_TIME_ZONE,
  addDays,
  formatCompactDateTime,
  formatDate,
  getDateRangeByPreset,
  getDefaultFrontDateRange,
  getPacificDateParts,
  getPacificTodayDate,
  getPacificTodayText,
} from "./assets/js/date-utils.js?v=20260707-frontend-refactor-v1";
import { createSalesShell } from "./assets/js/sales-shell.js?v=20260717-date-range-window-v3";
import { createNavigationUtils } from "./assets/js/navigation-utils.js?v=20260707-frontend-refactor-v1";
import { compareTableSortableValues, createTableSorter } from "./assets/js/table-sorter.js?v=20260707-frontend-refactor-v1";
import { createDataTableManager } from "./assets/js/data-table-manager.js?v=20260717-resize-sort-guard-v1";
import { createAftersalesDashboardFeature } from "./assets/js/features/aftersales-dashboard.js?v=20260706-frontend-refactor-v1";
import { createAftersalesMailFeature } from "./assets/js/features/aftersales-mail.js?v=20260706-frontend-refactor-v1";
import { createCashflowDashboardFeature } from "./assets/js/features/cashflow-dashboard.js?v=20260706-frontend-refactor-v1";
import { createAdKeywordFeature } from "./assets/js/features/ad-keywords.js?v=20260706-frontend-refactor-v1";
import { createAdPerformanceReviewFeature } from "./assets/js/features/ad-performance-review.js?v=20260706-frontend-refactor-v1";
import { createAdPortfolioFeature } from "./assets/js/features/ad-portfolios.js?v=20260706-frontend-refactor-v1";
import { createHomeQuickLinksFeature } from "./assets/js/features/home-quick-links.js?v=20260706-frontend-refactor-v1";
import { createInventoryProvisionFeature } from "./assets/js/features/inventory-provision.js?v=20260706-frontend-refactor-v1";
import { createLowInventoryFeeFeature } from "./assets/js/features/low-inventory-fee.js?v=20260706-frontend-refactor-v1";
import { createProductPulseFeature } from "./assets/js/features/product-pulse.js?v=20260706-frontend-refactor-v1";
import { createSupplierBoardFeature } from "./assets/js/features/supplier-board.js?v=20260706-frontend-refactor-v1";
import { createFactoryInventoryFeature } from "./assets/js/features/factory-inventory.js?v=20260706-frontend-refactor-v1";
import { createSupplierDetailFeature } from "./assets/js/features/supplier-detail.js?v=20260706-frontend-refactor-v1";
import { createPayablesDashboardFeature } from "./assets/js/features/payables-dashboard.js?v=20260706-frontend-refactor-v1";
import { createReviewRatingFeature } from "./assets/js/features/review-rating.js?v=20260706-frontend-refactor-v1";
import { createStoreInspectionFeature } from "./assets/js/features/store-inspection.js?v=20260706-frontend-refactor-v1";
import { createSlowMovingRiskFeature } from "./assets/js/features/slow-moving-risk.js?v=20260731-slow-moving-risk-v1";
import { createKnowledgeLibraryFeature } from "./assets/js/features/knowledge-library.js?v=20260706-frontend-refactor-v1";
import { createAiImageWorkflowFeature } from "./assets/js/features/ai-image-workflow.js?v=20260706-frontend-refactor-v1";
import { createAdminSettingsFeature } from "./assets/js/features/admin-settings.js?v=20260706-frontend-refactor-v1";
import { createWebhookAssistantFeature } from "./assets/js/features/webhook-assistant.js?v=20260720-webhook-assistant-v1";
import { createBudgetTargetsFeature } from "./assets/js/features/budget-targets.js?v=20260706-frontend-refactor-v1";
import { createStoreOperatingMonthlyReportFeature } from "./assets/js/features/store-operating-monthly-report.js?v=20260803-store-operating-monthly-report-v3";
import { createSyncCenterFeature } from "./assets/js/features/sync-center.js?v=20260706-frontend-refactor-v1";
import { createFbaFreightFeature } from "./assets/js/features/fba-freight.js?v=20260717-shared-logistics-channels";
import { createFbaShipmentVarianceFeature } from "./assets/js/features/fba-shipment-variance.js?v=20260803-shipment-variance-v1";
import { createFbaShopsFeature } from "./assets/js/features/fba-shops.js?v=20260706-frontend-refactor-v1";
import { createFbaMskuFeature } from "./assets/js/features/fba-msku.js?v=20260707-frontend-refactor-v1";
import { createFbaAutomationFeature } from "./assets/js/features/fba-automation.js?v=20260707-frontend-refactor-v1";
import { createFbaTaskFormFeature } from "./assets/js/features/fba-task-form.js?v=20260707-frontend-refactor-v1";
import { createFreightRatesFeature } from "./assets/js/features/freight-rates.js?v=20260724-freight-rate-au-xys";
import { createSalesForecastFeature } from "./assets/js/features/sales-forecast.js?v=20260713-sales-forecast-locator-v2";
import { createSalesDashboardFeature } from "./assets/js/features/sales-dashboard.js?v=20260724-sales-owner-detail-jump-v1";
import { createSidebarShellFeature } from "./assets/js/features/sidebar-shell.js?v=20260707-frontend-refactor-v1";
import { createTopbarStatusFeature } from "./assets/js/features/topbar-status.js?v=20260707-frontend-refactor-v1";
import { createBreadcrumbShellFeature } from "./assets/js/features/breadcrumb-shell.js?v=20260707-frontend-refactor-v1";
import {
  ACCESS_ROLES,
  canAccessFinance,
  canManageAdminSettings,
  createAuthShellFeature,
  normalizeAccessRole,
  redirectToLogin,
} from "./assets/js/features/auth-shell.js?v=20260707-frontend-refactor-v1";

if (!TanjiaUiUtils) {
  throw new Error("TanjiaUiUtils 未加载，请确认 assets/js/ui-utils.js 已在 app.js 前加载。");
}

installDashboardLoadingFetchOverlay({ root: document });

const {
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
} = TanjiaUiUtils;

const {
  initializeFilterDropdowns,
  setSelectOptions,
  syncAllOptionSelection,
} = createFilterControls({
  root: document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  normalizeCountryName,
  normalizeFilterOptions,
  selectedFilterValues,
  setDisclosureGroupState,
  setDisclosureState,
});

const { fbaValue } = createFbaUtils({
  root: document,
  trimmedFieldValue,
});

const {
  closeFrontDatePopover,
  getFrontDateEnd,
  getFrontDateRange,
  placeSalesFiltersAfterBreadcrumb,
  removeLegacySalesLayout,
  resetFrontDateRange,
  setupFrontDateRangeControls,
  showLocalFileWarning,
  syncSalesToolbarVisibility,
  updateFrontDateRange,
} = createSalesShell({
  root: document,
  bind,
  bindAll,
  bindClickOutside,
  fieldValue,
  formatDate,
  getDateRangeByPreset,
  getDefaultFrontDateRange,
  onDateRangeChange: refreshDashboardFromFilters,
  setElementsHidden,
  setText,
});
const {
  buildDashboardQuery,
  getFrontShopSellers,
  populateFrontShopFilters,
  setupFrontShopFilterControls,
} = createFrontShopFilters({
  root: document,
  bind,
  bindClickOutside,
  fieldValue,
  getFrontDateRange,
  normalizeCountryName,
  onFiltersChange: refreshDashboardFromFilters,
  onOwnerFilterChange: () => revealMskuDetailPanel(),
  selectedFilterValue,
  selectedFilterValues,
  setSelectOptions,
  syncAllOptionSelection,
});

const {
  clickVisibleNavItem,
  setupNavClickBinding,
  setupNavGroupTitleBinding,
  updateNavGroupActiveStates,
} = createNavigationUtils({
  root: document,
  bind,
  bindEventTarget,
  closestTarget,
  clickVisibleElement,
  setExpandedClassState,
});

let loadAdPerformanceReview = async () => {};
let loadDashboard = async () => {};
let revealMskuDetailPanel = () => {};
let setDefaultAdReviewDates = () => {};
let setupAdPerformanceReview = () => {};
let applyFactoryInventorySort = () => {};
let applyMskuDetailSort = () => {};
let applySupplierBoardSort = () => {};
let applyStoreOperatingMonthlyReportSort = () => {};
let calculateReviewRating = () => {};
let closeKnowledgeExternalDocument = () => {};
let collapseSidebar = () => {};
let expandSidebarGroup = () => false;
let loadFactoryInventory = async () => {};
let loadAdPortfolios = async () => {};
let setupAdPortfolios = () => {};
let loadAdKeywordDashboard = async () => {};
let setupAdKeywordDashboard = () => {};
let loadAdminAccounts = async () => {};
let loadAdminOverview = async () => {};
let loadWebhookTasks = async () => {};
let loadAftersalesDashboard = async () => {};
let loadAftersalesMailDashboard = async () => {};
let loadBudgetUploads = async () => {};
let loadBudgetTargets = async () => {};
let loadStoreOperatingMonthlyReport = async () => {};
let loadCashflowDashboard = async () => {};
let loadSlowMovingRiskView = async () => {};
let loadInventoryProvision = async () => {};
let loadKnowledgeLibrary = async () => {};
let loadLowInventoryFee = async () => {};
let loadPayablesDashboard = async () => {};
let loadProductPulse = async () => {};
let setupProductPulse = () => {};
let loadSupplierBoard = async () => {};
let loadSupplierDetail = async () => {};
let loadHealthStatus = async () => {};
let loadLingxingShops = async () => {};
let loadSyncStatus = async () => {};
let loadSalesForecast = async () => {};
let loadFbaFreightInitial = async () => {};
let loadFbaShipmentVarianceInitial = async () => {};
let loadFreightRatesDashboard = async () => {};
let loadFreightRatesInitial = async () => {};
let openSupplierDetailModal = () => {};
let renderPayableDetail = () => {};
let renderSyncStatus = () => {};
let renderSalesForecastHeader = () => {};
let renderFbaFreightShopOptions = () => {};
let renderHomeQuickLinks = () => {};
let renderStoreInspectionPreview = () => {};
let renderStoreInspectionRecords = () => {};
let setupSupplierDetail = () => {};
let setupPayablesDashboard = () => {};
let setupCashflowDashboard = () => {};
let setupLowInventoryFee = () => {};
let setupInventoryProvision = () => {};
let setDefaultFactoryInventoryDates = () => {};
let setDefaultAdPortfolioDate = () => {};
let setDefaultAdKeywordDate = () => {};
let setupHomeQuickLinks = () => {};
let setupSlowMovingRisk = () => {};
let setupKnowledgeLibrary = () => {};
let setupAiImageWorkflow = () => {};
let setupAdminSettings = () => {};
let setupWebhookAssistant = () => {};
let setupBreadcrumbNavigation = () => {};
let setupBudgetTargets = () => {};
let setupStoreOperatingMonthlyReport = () => {};
let setupFbaFreight = () => {};
let setupFbaShipmentVariance = () => {};
let setupFreightRatesDashboard = () => {};
let setupFbaShopPicker = () => {};
let setupReviewRatingCalculator = () => {};
let setupSalesDashboard = () => {};
let setupSalesForecast = () => {};
let setupSidebarShell = () => {};
let setupSyncCenter = () => {};
let setupStoreInspectionModule = () => {};
let initializeBudgetDefaults = () => {};
let initializeStoreOperatingMonthlyReportDefaults = () => {};
let loadDingtalkAuthUsers = async () => {};
let setDefaultAftersalesDates = () => {};
let setupAftersalesDashboard = () => {};
let setupAftersalesMail = () => {};
let setDefaultCashflowDates = () => {};
let setDefaultInventoryProvisionDate = () => {};
let setDefaultLowInventoryFeeDate = () => {};
let setDefaultSupplierBoardDates = () => {};
let setupSupplierBoard = () => {};
let setupFactoryInventory = () => {};
let getFallbackFbaShop = () => ({});
let getFallbackFbaShops = () => [];
let getFbaShops = () => [];
let getSelectedFbaShops = () => [];
let findSelectedFbaMskuOption = () => null;
let handleFbaShopSelectionChange = () => {};
let hasCompleteFbaBoxSpec = () => false;
let loadFbaAutomationState = async () => {};
let loadFbaShops = async () => {};
let normalizeFbaShop = (shop) => shop;
let populateFbaShopSelect = () => {};
let readFbaBoxSpecFromForm = () => ({ boxDimensions: {}, boxWeight: {} });
let renderFbaAutomationState = () => {};
let renderFbaLoadingState = () => {};
let renderFbaResult = () => {};
let renderDashboard = () => {};
let renderFbaShopOptions = () => {};
let renderFbaWarehouseOptions = () => {};
let renderTopbarBreadcrumb = () => {};
let scheduleFbaMskuLoad = () => {};
let selectFbaShopSids = () => {};
let setFbaBoxSpecFields = () => {};
let setFbaShopMenuOpen = () => {};
let setupFbaAutomationBoard = () => {};
let setupFbaMskuPicker = () => {};
let setupFbaTaskForm = () => {};
let syncFbaQuantityFields = () => {};
let updateFbaShopButton = () => {};
let closeFbaTaskModal = () => {};
let deleteFbaTask = async () => {};
let openFbaTaskModal = () => {};
let renderTopbarSyncStatus = () => {};
let runFbaTask = async () => {};
let syncToneClasses = [];
let updateWorldClock = () => {};
let updateFbaTask = async () => {};
let applyModuleBreadcrumbs = () => {};
const runningFromLocalFile = window.location.protocol === "file:";
let applyAuthVisibility = () => ({ canEnterAdmin: false, canEnterFinance: false });
let getCurrentAuthUser = () => null;
let loadAuthStatus = async () => ({ enabled: false, authenticated: true });
let setupAuthShell = () => {};
let setupTableSortBridge = () => {};
let setupDataTables = () => {};
let refreshTable = () => null;
let makeUnavailableDashboard = (message) => ({
  meta: { syncStatus: message },
  kpis: [],
  siteRows: [],
  miniMetrics: [],
  summary: [],
  dailyRows: [],
  detailRows: [],
  filters: {},
});

({ setupTableSortBridge } = createTableSorter({
  root: document,
  bindEventTarget,
  closestTarget,
  getApplyFactoryInventorySort: () => applyFactoryInventorySort,
  getApplyMskuDetailSort: () => applyMskuDetailSort,
  getApplySupplierBoardSort: () => applySupplierBoardSort,
  getApplyStoreOperatingMonthlyReportSort: () => applyStoreOperatingMonthlyReportSort,
  setTableSortState,
}));
({ refreshTable, setupDataTables } = createDataTableManager({
  root: document,
  windowRef: window,
}));

({
  applyMskuDetailSort,
  loadDashboard,
  makeUnavailableDashboard,
  revealMskuDetailPanel,
  renderDashboard,
  setupSalesDashboard,
} = createSalesDashboardFeature({
  root: document,
  bind,
  bindAll,
  buildDashboardQuery,
  canAccessFinance,
  closestTarget,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  formatActualMoney,
  formatNumber,
  getCurrentAuthUser: () => getCurrentAuthUser(),
  parseDisplayPercent,
  parseNumber,
  redirectToLogin,
  renderDataValueButtonsHtml,
  setTableSortButtonGroupState,
  setText,
}));

({ loadProductPulse, setupProductPulse } = createProductPulseFeature({
  root: document,
  loadDashboardSection,
  bind,
  buildDashboardQuery,
  getFrontDateEnd,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  formatPercent,
  renderTableMessage,
  setText,
}));

async function refreshDashboardFromFilters() {
  const dashboard = await loadDashboard();
  renderDashboard(dashboard);
  const currentRange = getFrontDateRange();
  updateFrontDateRange(currentRange.start, currentRange.end);
}

({ loadSalesForecast, renderSalesForecastHeader, setupSalesForecast } = createSalesForecastFeature({
  root: document,
  bind,
  bindAll,
  cachedSalesImageUrl,
  closestTarget,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  formatActualMoney,
  formatNumber,
  normalizedSalesImageUrl,
  parseNumber,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setElementsDisabled,
  setSelectedElementState,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
}));

({
  loadAdPortfolios,
  setDefaultAdPortfolioDate,
  setupAdPortfolios,
} = createAdPortfolioFeature({
  root: document,
  loadDashboardSection,
  addDays,
  bind,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatMoney,
  formatRateNullable,
  setText,
  trimmedFieldValue,
}));

({ loadAdPerformanceReview, setDefaultAdReviewDates, setupAdPerformanceReview } = createAdPerformanceReviewFeature({
  root: document,
  loadDashboardSection,
  addDays,
  bind,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatRateNullable,
  setText,
  trimmedFieldValue,
}));

({ loadAdKeywordDashboard, setDefaultAdKeywordDate, setupAdKeywordDashboard } = createAdKeywordFeature({
  root: document,
  loadDashboardSection,
  addDays,
  bind,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatMetricNumber,
  formatRateNullable,
  setText,
  trimmedFieldValue,
}));

({ loadAftersalesDashboard, setDefaultAftersalesDates, setupAftersalesDashboard } = createAftersalesDashboardFeature({
  root: document,
  loadDashboardSection,
  bind,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  formatNumber,
  formatPercent,
  getPacificTodayText,
  setText,
  trimmedFieldValue,
}));

({
  loadAftersalesMailDashboard,
  setupAftersalesMail,
} = createAftersalesMailFeature({
  root: document,
  bind,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatNumber,
  setButtonBusy,
  setElementsDisabled,
  setText,
  trimmedFieldValue,
}));

({
  loadInventoryProvision,
  setDefaultInventoryProvisionDate,
  setupInventoryProvision,
} = createInventoryProvisionFeature({
  root: document,
  loadDashboardSection,
  bind,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  getDefaultMonth: () => getPacificTodayText().slice(0, 7),
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
}));

({
  loadLowInventoryFee,
  setDefaultLowInventoryFeeDate,
  setupLowInventoryFee,
} = createLowInventoryFeeFeature({
  root: document,
  loadDashboardSection,
  bind,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatNumber,
  getDefaultDate: () => getFrontDateEnd() || getPacificTodayText(),
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
}));

({
  loadCashflowDashboard,
  setDefaultCashflowDates,
  setupCashflowDashboard,
} = createCashflowDashboardFeature({
  root: document,
  loadDashboardSection,
  addDays,
  bind,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatDate,
  getPacificTodayDate,
  renderTableMessage,
  selectedFilterValue,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
}));

({
  applySupplierBoardSort,
  loadSupplierBoard,
  setDefaultSupplierBoardDates,
  setupSupplierBoard,
} = createSupplierBoardFeature({
  root: document,
  loadDashboardSection,
  bind,
  bindAll,
  closestTarget,
  compareTableSortableValues,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  formatRateNullable,
  normalizeCountryName,
  selectedFilterValues,
  setSelectOptions,
  setTableSortButtonGroupState,
  setText,
  syncAllOptionSelection,
  trimmedFieldValue,
}));

({
  applyFactoryInventorySort,
  loadFactoryInventory,
  setDefaultFactoryInventoryDates,
  setupFactoryInventory,
} = createFactoryInventoryFeature({
  root: document,
  loadDashboardSection,
  bind,
  bindAll,
  checkedField,
  closestTarget,
  compareTableSortableValues,
  createDebouncedAction,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  renderTableMessage,
  setTableSortButtonGroupState,
  setText,
  trimmedFieldValue,
  cachedSalesImageUrl,
}));

({
  loadSupplierDetail,
  setupSupplierDetail,
} = createSupplierDetailFeature({
  root: document,
  loadDashboardSection,
  bind,
  bindBackdropClose,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fieldValue,
  formatActualMoney,
  readFileAsBase64,
  setText,
  trimmedFieldValue,
}));

({
  loadPayablesDashboard,
  renderPayableDetail,
  setupPayablesDashboard,
} = createPayablesDashboardFeature({
  root: document,
  loadDashboardSection,
  bind,
  bindAll,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatDate,
  setActiveElementState,
  setText,
  trimmedFieldValue,
}));

({ loadAdminAccounts, loadAdminOverview, loadDingtalkAuthUsers, setupAdminSettings } = createAdminSettingsFeature({
  root: document,
  accessRoles: ACCESS_ROLES,
  beijingTimeZone: BEIJING_TIME_ZONE,
  bind,
  closestTarget,
  escapeHtml,
  fieldValue,
  normalizeAccessRole,
  renderTableMessage,
  setButtonBusy,
  setElementsDisabled,
  setStatusMessage,
  trimmedFieldValue,
}));

({ loadWebhookTasks, setupWebhookAssistant } = createWebhookAssistantFeature({
  root: document,
  bind,
  closestTarget,
  escapeHtml,
  fieldValue,
  renderTableMessage,
  setButtonBusy,
  setElementsHidden,
  setStatusMessage,
  trimmedFieldValue,
}));

({ closeKnowledgeExternalDocument, loadKnowledgeLibrary, setupKnowledgeLibrary } = createKnowledgeLibraryFeature({
  root: document,
  bind,
  bindAll,
  bindBackdropClose,
  closestTarget,
  escapeHtml,
  fieldValue,
  formatCompactDateTime,
  normalizeText,
  renderTableMessage,
  setActiveElementState,
  setButtonBusy,
  setModalOpenState,
  setStatusMessage,
  trimmedFieldValue,
}));
({ initializeBudgetDefaults, loadBudgetTargets, loadBudgetUploads, setupBudgetTargets } = createBudgetTargetsFeature({
  root: document,
  bind,
  closestTarget,
  escapeHtml,
  fieldValue,
  formatMoney,
  formatNumber,
  formatPercent,
  getPacificDateParts,
  locationRef: location,
  renderTableMessage,
  readFileAsBase64,
  setButtonBusy,
  setText,
  trimmedFieldValue,
}));

({
  applyStoreOperatingMonthlyReportSort,
  initializeStoreOperatingMonthlyReportDefaults,
  loadStoreOperatingMonthlyReport,
  setupStoreOperatingMonthlyReport,
} = createStoreOperatingMonthlyReportFeature({
  root: document,
  bind,
  clickVisibleNavItem,
  downloadBlob,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  formatActualMoney,
  getStoreOptions: getFrontShopSellers,
  historyRef: history,
  locationRef: location,
  normalizeCountryName,
  pickSellerCountry,
  pickSellerName,
  refreshTable,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
}));

({ renderTopbarSyncStatus, syncToneClasses, updateWorldClock } = createTopbarStatusFeature({
  root: document,
  escapeHtml,
  setExclusiveClassState,
  setText,
}));

({ loadHealthStatus, loadLingxingShops, loadSyncStatus, renderSyncStatus, setupSyncCenter } = createSyncCenterFeature({
  root: document,
  bind,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  getDisplayShopName,
  normalizeCountryName,
  pickSellerCountry,
  pickSellerName,
  populateFbaShopSelect,
  populateFrontShopFilters,
  redirectToLogin,
  renderTableMessage,
  renderTopbarSyncStatus,
  runningFromLocalFile,
  setButtonBusy,
  setExclusiveClassState,
  setText,
  syncToneClasses,
}));

({
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
} = createFbaShopsFeature({
  root: document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  fbaValue,
  fetchImpl: fetch.bind(window),
  getDisplayShopName,
  getFrontShopSellers,
  normalizeCountryName,
  onShopChange: (...args) => handleFbaShopSelectionChange(...args),
  onShopListChange: () => {
    renderFbaFreightShopOptions();
  },
  pickSellerCountry,
  pickSellerName,
  setElementsHidden,
}));

({
  findSelectedFbaMskuOption,
  handleFbaShopSelectionChange,
  hasCompleteFbaBoxSpec,
  readFbaBoxSpecFromForm,
  renderFbaWarehouseOptions,
  scheduleFbaMskuLoad,
  setFbaBoxSpecFields,
  setupFbaMskuPicker,
  syncFbaQuantityFields,
} = createFbaMskuFeature({
  root: document,
  bind,
  bindClickOutside,
  closestTarget,
  escapeHtml,
  fbaValue,
  fetchImpl: fetch.bind(window),
  formatNumber,
  getSelectedFbaShops,
  setButtonBusy,
  setElementsHidden,
  setFbaShopMenuOpen,
  setText,
}));

({
  loadFbaAutomationState,
  renderFbaAutomationState,
  renderFbaLoadingState,
  renderFbaResult,
  setupFbaAutomationBoard,
} = createFbaAutomationFeature({
  root: document,
  bind,
  closestTarget,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  formatCompactDateTime,
  formatNumber,
  renderFbaWarehouseOptions,
  renderTableMessage,
  setActiveDatasetValueState,
  setText,
  storage: localStorage,
  timer: window,
  onDeleteTask: (...args) => deleteFbaTask(...args),
  onEditTask: (...args) => openFbaTaskModal(...args),
  onRunTask: (...args) => runFbaTask(...args),
  onToggleTask: (...args) => updateFbaTask(...args),
}));

({
  closeFbaTaskModal,
  deleteFbaTask,
  openFbaTaskModal,
  runFbaTask,
  setupFbaTaskForm,
  updateFbaTask,
} = createFbaTaskFormFeature({
  root: document,
  alertImpl: alert.bind(window),
  bind,
  bindBackdropClose,
  checkedField,
  confirmImpl: confirm.bind(window),
  fetchImpl: fetch.bind(window),
  fieldValue,
  findSelectedFbaMskuOption,
  fbaValue,
  getFallbackFbaShop,
  getSelectedFbaShops,
  hasCompleteFbaBoxSpec,
  loadFbaAutomationState,
  readFbaBoxSpecFromForm,
  renderFbaAutomationState,
  renderFbaResult,
  renderFbaShopOptions,
  renderFbaWarehouseOptions,
  scheduleFbaMskuLoad,
  selectFbaShopSids,
  setButtonBusy,
  setFbaBoxSpecFields,
  setModalOpenState,
  setText,
  syncFbaQuantityFields,
  timer: window,
  updateFbaShopButton,
}));

({ loadFbaFreightInitial, renderFbaFreightShopOptions, setupFbaFreight } = createFbaFreightFeature({
  root: document,
  bind,
  bindBackdropClose,
  cachedSalesImageUrl,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fallbackFbaShops: getFallbackFbaShops(),
  fbaValue,
  fetchImpl: fetch.bind(window),
  formatDate,
  formatNumber,
  getFbaShops,
  loadFbaShops,
  normalizeFbaShop,
  renderTableMessage,
  setModalOpenState,
  setText,
}));

({ loadFbaShipmentVarianceInitial, setupFbaShipmentVariance } = createFbaShipmentVarianceFeature({
  root: document, bind, bindBackdropClose, closestTarget, escapeHtml, fbaValue,
  fetchImpl: fetch.bind(window), formatDate, formatNumber, getFbaShops, getCurrentAuthUser: () => getCurrentAuthUser(), loadFbaShops,
  normalizeFbaShop, renderTableMessage, setModalOpenState, setText,
}));

({ loadFreightRatesDashboard, loadFreightRatesInitial, setupFreightRatesDashboard } = createFreightRatesFeature({
  root: document,
  bind,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  renderTableMessage,
  setModalOpenState,
  setText,
  windowApi: window,
}));

({ applyAuthVisibility, getCurrentAuthUser, loadAuthStatus, setupAuthShell } = createAuthShellFeature({
  root: document,
  windowObj: window,
  bind,
  bindClickOutside,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  redirectToLogin,
  setElementsHidden,
  setExpandedClassState,
  updateNavGroupActiveStates,
}));

({ calculateReviewRating, setupReviewRatingCalculator } = createReviewRatingFeature({
  root: document,
  bind,
  bindAll,
  fieldValue,
  formatNumber,
  parseNumber,
  setExclusiveClassState,
  setText,
}));

({ loadSlowMovingRiskView, setupSlowMovingRisk } = createSlowMovingRiskFeature({
  root: document,
  bind,
  bindAll,
  escapeHtml,
  fetchImpl: fetch.bind(window),
  formatActualMoney,
  formatNumber,
  formatPercent,
  selectedFilterValues,
  setButtonBusy,
  setSelectOptions,
  setText,
  syncAllOptionSelection,
}));

({ setupAiImageWorkflow } = createAiImageWorkflowFeature({
  root: document,
  bind,
  closestTarget,
  downloadBlob,
  escapeHtml,
  fieldValue,
  setElementsDisabled,
  setText,
  trimmedFieldValue,
}));
({ renderStoreInspectionPreview, renderStoreInspectionRecords, setupStoreInspectionModule } = createStoreInspectionFeature({
  root: document,
  bind,
  checkedField,
  escapeHtml,
  fieldValue,
  redirectToLogin,
  setButtonBusy,
  setText,
}));

({ renderHomeQuickLinks, setupHomeQuickLinks } = createHomeQuickLinksFeature({
  root: document,
  applyAuthVisibility,
  bind,
  bindDelegated,
  canAccessFinance,
  clickVisibleNavItem,
  escapeHtml,
  getCurrentAuthUser: () => getCurrentAuthUser(),
  isVisibleElement,
  setDisclosureState,
}));

({ collapseSidebar, expandSidebarGroup, setupSidebarShell } = createSidebarShellFeature({
  root: document,
  windowObj: window,
  bind,
  bindClickOutside,
  bindEventTarget,
  closestTarget,
  isVisibleElement,
  normalizeText,
  setAriaExpanded,
  setDisclosureState,
  setExpandedClassState,
}));

({ applyModuleBreadcrumbs, renderTopbarBreadcrumb, setupBreadcrumbNavigation } = createBreadcrumbShellFeature({
  root: document,
  bindEventTarget,
  clickVisibleNavItem,
  closestTarget,
  escapeHtml,
  expandSidebarGroup,
  setExpandedClassState,
}));

function setupNavigation() {
  const titles = {
    home: "",
    sales: "",
    pulse: "",
    "store-inspection": "",
    ads: "",
    "review-rating": "",
    clearance: "",
    "ai-image-workflow": "",
    "fba-freight": "",
    "fba-shipment-variance": "",
    "product-progress": "",
    aftersales: "",
    "aftersales-mail": "",
    certificates: "",
	    "product-design": "",
	    "supplier-board": "",
	    "factory-inventory": "",
	    "supplier-detail": "",
	    purchase: "",
    provision: "",
    lowfee: "",
    cashflow: "",
    "store-operating-monthly-report": "",
    payables: "",
    guide: "",
    budget: "",
    fba: "",
    admin: "",
    "webhook-assistant": "",
    sync: "",
    "freight-rates": "",
  };

  setupSidebarShell();
  setupNavGroupTitleBinding();

  async function handleNavigationItem(button) {
    if (!isVisibleElement(button)) return;
    const view = button.dataset.view;
    const currentAuthUser = getCurrentAuthUser();
    if (["cashflow", "store-operating-monthly-report"].includes(view) && !canAccessFinance(currentAuthUser)) {
      applyAuthVisibility(currentAuthUser);
      document.querySelector('.nav-item[data-view="home"]')?.click();
      return;
    }
    if (view === "admin" && !canManageAdminSettings(currentAuthUser)) {
      applyAuthVisibility(currentAuthUser);
      document.querySelector('.nav-item[data-view="home"]')?.click();
      return;
    }
    setActiveElementState(".nav-item", button);
    updateNavGroupActiveStates();
    setActiveElementState(".view", `#view-${view}`);
    if (view !== "guide") closeKnowledgeExternalDocument();
    renderTopbarBreadcrumb(view);
    setClassStateMap(document.body, {
      "sales-view": view === "sales",
      "factory-inventory-view": view === "factory-inventory",
    });
    syncSalesToolbarVisibility(view);
    closeFrontDatePopover();
    setText("#period-text", titles[view]);
    if (view === "sales") {
      const currentRange = getFrontDateRange();
      updateFrontDateRange(currentRange.start, currentRange.end);
    }
    if (view === "pulse") {
      const pulseDate = document.querySelector("#pulse-date");
      if (pulseDate && !pulseDate.value) pulseDate.value = getFrontDateEnd();
      await loadProductPulse();
    }
    if (view === "store-inspection") {
      renderStoreInspectionPreview();
      renderStoreInspectionRecords();
    }
    if (view === "ads") {
      setDefaultAdPortfolioDate();
      setDefaultAdReviewDates();
      setDefaultAdKeywordDate();
      await Promise.allSettled([loadAdPortfolios(), loadAdPerformanceReview(), loadAdKeywordDashboard()]);
    }
    if (view === "aftersales") {
      setDefaultAftersalesDates();
      await loadAftersalesDashboard();
    }
    if (view === "aftersales-mail") {
      await loadAftersalesMailDashboard();
    }
    if (view === "supplier-board") {
      setDefaultSupplierBoardDates();
      await loadSupplierBoard();
    }
    if (view === "factory-inventory") {
      setDefaultFactoryInventoryDates();
      await loadFactoryInventory();
    }
    if (view === "supplier-detail") {
      await loadSupplierDetail();
    }
    if (view === "purchase") {
      await loadSalesForecast();
    }
    if (view === "review-rating") {
      calculateReviewRating();
    }
    if (view === "clearance") {
      await loadSlowMovingRiskView();
    }
    if (view === "provision") {
      setDefaultInventoryProvisionDate();
      await loadInventoryProvision();
    }
    if (view === "lowfee") {
      setDefaultLowInventoryFeeDate();
      await loadLowInventoryFee();
    }
    if (view === "cashflow") {
      setDefaultCashflowDates();
      await loadCashflowDashboard();
    }
    if (view === "store-operating-monthly-report") {
      initializeStoreOperatingMonthlyReportDefaults();
      await loadStoreOperatingMonthlyReport();
    }
    if (view === "payables") {
      await loadPayablesDashboard();
    }
    if (view === "guide") {
      await loadKnowledgeLibrary();
    }
    if (view === "admin") {
      loadAdminOverview();
      loadAdminAccounts();
      loadDingtalkAuthUsers();
      loadKnowledgeLibrary({ renderAdmin: true });
    }
    if (view === "webhook-assistant") {
      await loadWebhookTasks();
    }
    if (view === "budget") {
      loadBudgetUploads();
      loadBudgetTargets();
    }
    if (view === "fba") {
      renderFbaLoadingState();
      await Promise.allSettled([loadFbaShops(), loadFbaAutomationState()]);
    }
    if (view === "fba-freight") {
      await loadFbaFreightInitial();
    }
    if (view === "fba-shipment-variance") await loadFbaShipmentVarianceInitial();
    if (view === "freight-rates") {
      await loadFreightRatesInitial();
    }
    if (view === "sync") loadSyncStatus();
    if (view === "sync") loadLingxingShops();
    window.__tanjiaHideSidebarFlyout?.();
    collapseSidebar();
  }

  setupNavClickBinding(handleNavigationItem);

  applyModuleBreadcrumbs();
  renderTopbarBreadcrumb(document.querySelector(".nav-item.active")?.dataset.view || "home");
  placeSalesFiltersAfterBreadcrumb();
  setupSalesDashboard();
  setupSalesForecast();
  setupHomeQuickLinks();
  setupBreadcrumbNavigation();
  setupAuthShell();
  updateNavGroupActiveStates();
  setupSlowMovingRisk();
  setupKnowledgeLibrary();
  setupReviewRatingCalculator();
  setupAiImageWorkflow();
  setupProductPulse();
  setupAdPortfolios();
  setupAdPerformanceReview();
  setupAdKeywordDashboard();
  setupAftersalesDashboard();
  setupAftersalesMail();
  setupStoreInspectionModule();
  setupSupplierDetail();
  setupPayablesDashboard();
  setupCashflowDashboard();
  setupLowInventoryFee();
  setupInventoryProvision();
  setupSupplierBoard();
  setupFactoryInventory();
  setupFrontDateRangeControls();
  setupFrontShopFilterControls();
  initializeFilterDropdowns();
  setupDataTables();
  setupTableSortBridge();
  setupAdminSettings();
  setupWebhookAssistant();
  setupStoreOperatingMonthlyReport();

  setupSyncCenter();
  setupFbaFreight();
  setupFbaShipmentVariance();
  setupFreightRatesDashboard();
  setupFbaShopPicker();
  setupFbaMskuPicker();
  setupFbaAutomationBoard();
  setupFbaTaskForm();
  setupBudgetTargets();

}

function openRequestedViewFromLocation() {
  const requestedView = new URLSearchParams(location.search).get("view");
  if (!["store-operating-monthly-report", "budget"].includes(requestedView)) return null;
  return clickVisibleNavItem(requestedView);
}

async function init() {
  removeLegacySalesLayout();
  updateWorldClock();
  window.setInterval(updateWorldClock, 60 * 1000);
  setupNavigation();
  await loadHealthStatus();
  if (runningFromLocalFile) {
    showLocalFileWarning();
    renderDashboard(makeUnavailableDashboard("当前是 file:// 本地预览，无法连接服务器和领星 ERP。"));
    renderSyncStatus({
      provider: "接口未连接",
      intervalHours: 12,
      lastStatus: "请打开 http://47.107.92.14/ 使用真实数据",
      running: false,
    });
    return;
  }
  const authState = await loadAuthStatus({ redirectIfNeeded: true });
  if (authState?.enabled && !authState.authenticated) return;
  openRequestedViewFromLocation();
  renderHomeQuickLinks();
  resetFrontDateRange();
  renderDashboard(makeUnavailableDashboard("正在读取销售看板真实数据，请稍候。"));
  const salesActive = Boolean(document.querySelector("#view-sales")?.classList.contains("active"));
  const factoryInventoryActive = Boolean(document.querySelector("#view-factory-inventory")?.classList.contains("active"));
  setClassStateMap(document.body, {
    "sales-view": salesActive,
    "factory-inventory-view": factoryInventoryActive,
  });
  syncSalesToolbarVisibility(salesActive);
  initializeBudgetDefaults();
  initializeStoreOperatingMonthlyReportDefaults();
  const pulseDateInput = document.querySelector("#pulse-date");
  if (pulseDateInput && !pulseDateInput.value) pulseDateInput.value = getFrontDateEnd();
  setDefaultInventoryProvisionDate();
  setDefaultLowInventoryFeeDate();
  setDefaultCashflowDates();

  const dashboardPromise = loadDashboard()
    .then(renderDashboard)
    .catch((error) => {
      renderDashboard(makeUnavailableDashboard(`销售看板初始化失败：${error.message}`));
    });

  Promise.allSettled([loadSyncStatus(), loadLingxingShops()])
    .then(() => initializeStoreOperatingMonthlyReportDefaults());

  Promise.allSettled([
    loadAdminOverview(),
    loadAdminAccounts(),
    loadDingtalkAuthUsers(),
    loadBudgetUploads(),
    loadBudgetTargets(),
  ]);

  await dashboardPromise;
  await loadHealthStatus();
  await loadSyncStatus();
}

init().catch((error) => {
  console.error("探嘉 BI 前端初始化失败", error);
  const message = error?.message || "前端初始化失败，请刷新页面或重新登录。";
  setText("#data-source", "页面初始化失败");
  setText("#data-source-note", message);
  renderTopbarSyncStatus("页面异常", "请刷新", "sync-error");
  const warning = document.createElement("div");
  warning.className = "environment-warning";
  warning.innerHTML = `
    <strong>页面脚本没有完整启动。</strong>
    <span>${escapeHtml(message)} 请先强制刷新，若仍失败请重新登录。</span>
  `;
  document.body.prepend(warning);
});

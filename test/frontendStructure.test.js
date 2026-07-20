import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("index.html startup health check centralizes sync tone class switching", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const healthStart = source.indexOf("window.__tanjiaBasicNavigationReady = true;");
  const appScriptStart = source.indexOf('<script type="module" src="./assets/js/ui-utils.js', healthStart);
  assert.notEqual(healthStart, -1, "missing startup health check script");
  assert.notEqual(appScriptStart, -1, "missing module ui-utils script after startup health check");
  const startupScript = source.slice(healthStart, appScriptStart);

  assert.match(startupScript, /function setSyncTone\(element, tone\)/);
  assert.equal(
    startupScript.includes('classList.remove("sync-success", "sync-error", "sync-running", "sync-pending")'),
    false,
    "startup sync status should use setSyncTone instead of repeating classList remove/add blocks",
  );
});

test("index.html loads frontend scripts as native modules in dependency order", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const uiUtilsScript = source.indexOf('<script type="module" src="./assets/js/ui-utils.js');
  const appScript = source.indexOf('<script type="module" src="./app.js');

  assert.notEqual(uiUtilsScript, -1, "ui-utils should load as a module");
  assert.notEqual(appScript, -1, "app.js should load as a module");
  assert.ok(uiUtilsScript < appScript, "ui-utils module must be evaluated before app.js");
});

test("frontend module cache-bust versions stay aligned", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const dashboardLoaderSource = await readFile(new URL("../assets/js/dashboard-loader.js", import.meta.url), "utf8");
  const indexUiUtilsVersion = indexSource.match(/\.\/assets\/js\/ui-utils\.js\?v=([^"]+)/)?.[1];
  const appUiUtilsVersion = appSource.match(/\.\/assets\/js\/ui-utils\.js\?v=([^"]+)/)?.[1];
  const dashboardLoaderUiUtilsVersion = dashboardLoaderSource.match(/\.\/ui-utils\.js\?v=([^"]+)/)?.[1];

  assert.ok(indexUiUtilsVersion, "index.html should cache-bust ui-utils.js");
  assert.ok(appUiUtilsVersion, "app.js should import the same cache-busted ui-utils.js");
  assert.ok(dashboardLoaderUiUtilsVersion, "dashboard-loader.js should import the same cache-busted ui-utils.js");
  assert.equal(appUiUtilsVersion, indexUiUtilsVersion);
  assert.equal(dashboardLoaderUiUtilsVersion, indexUiUtilsVersion);
});

test("ui-utils.js exposes ES module exports while keeping the legacy global", async () => {
  const source = await readFile(new URL("../assets/js/ui-utils.js", import.meta.url), "utf8");

  assert.match(source, /const TanjiaUiUtils = \{/);
  assert.match(source, /tanjiaUiGlobal\.TanjiaUiUtils = TanjiaUiUtils/);
  assert.match(source, /export \{[\s\S]*setElementsHidden[\s\S]*\}/);
  assert.match(source, /export default TanjiaUiUtils/);
  assert.equal(source.includes("(function initTanjiaUiUtils"), false);
});

test("modal close buttons and dialogs expose accessible names", async () => {
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const modalCloseButtons = [...source.matchAll(/<button class="modal-close-button"[^>]*>/g)].map((match) => match[0]);
  const dialogArticles = [...source.matchAll(/<article class="[^"]*(?:modal|dialog)[^"]*"[^>]*>/g)].map((match) => match[0]);

  assert.ok(modalCloseButtons.length >= 5, "expected modal close buttons to be present");
  for (const button of modalCloseButtons) {
    assert.match(button, /aria-label="[^"]+"/, `${button} needs an accessible close label`);
  }

  assert.ok(dialogArticles.length >= 5, "expected modal dialog articles to be present");
  for (const article of dialogArticles) {
    assert.match(article, /role="dialog"/, `${article} needs role="dialog"`);
    assert.match(article, /aria-modal="true"/, `${article} needs aria-modal="true"`);
    assert.match(article, /aria-labelledby="[^"]+"/, `${article} needs aria-labelledby`);
  }
});

test("data visual helpers own tone classes instead of page-local inline colors", async () => {
  const salesSource = await readFile(new URL("../assets/js/features/sales-dashboard.js", import.meta.url), "utf8");
  const payablesSource = await readFile(new URL("../assets/js/features/payables-dashboard.js", import.meta.url), "utf8");
  const inventorySource = await readFile(new URL("../assets/js/features/inventory-provision.js", import.meta.url), "utf8");
  const componentsSource = await readFile(new URL("../assets/js/ui-components.js", import.meta.url), "utf8");

  assert.match(salesSource, /renderKpiProgress/);
  assert.equal(salesSource.includes("function progressStyle"), false);
  assert.match(payablesSource, /renderMeterBar/);
  assert.equal(payablesSource.includes('style="width:'), false);
  assert.match(inventorySource, /chartBucketClass/);
  assert.match(inventorySource, /renderChartSwatch/);
  assert.equal(/fill="#|stroke="#|--bucket-color/.test(inventorySource), false);
  assert.match(componentsSource, /function renderKpiProgress/);
  assert.match(componentsSource, /function renderMeterBar/);
  assert.match(componentsSource, /function renderChartSwatch/);
});

test("app.js starts using shared dashboard section loader", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const helperSource = await readFile(new URL("../assets/js/dashboard-loader.js", import.meta.url), "utf8");
  const dateUtilsSource = await readFile(new URL("../assets/js/date-utils.js", import.meta.url), "utf8");
  const fbaUtilsSource = await readFile(new URL("../assets/js/fba-utils.js", import.meta.url), "utf8");
  const fileUtilsSource = await readFile(new URL("../assets/js/file-utils.js", import.meta.url), "utf8");
  const frontShopFiltersSource = await readFile(new URL("../assets/js/front-shop-filters.js", import.meta.url), "utf8");
  const imageUrlSource = await readFile(new URL("../assets/js/image-url.js", import.meta.url), "utf8");
  const navigationUtilsSource = await readFile(new URL("../assets/js/navigation-utils.js", import.meta.url), "utf8");
  const salesShellSource = await readFile(new URL("../assets/js/sales-shell.js", import.meta.url), "utf8");
  const tableSorterSource = await readFile(new URL("../assets/js/table-sorter.js", import.meta.url), "utf8");
  const adminSettingsFeatureSource = await readFile(new URL("../assets/js/features/admin-settings.js", import.meta.url), "utf8");
  const webhookAssistantFeatureSource = await readFile(new URL("../assets/js/features/webhook-assistant.js", import.meta.url), "utf8");
  const aftersalesFeatureSource = await readFile(new URL("../assets/js/features/aftersales-dashboard.js", import.meta.url), "utf8");
  const aftersalesMailFeatureSource = await readFile(new URL("../assets/js/features/aftersales-mail.js", import.meta.url), "utf8");
  const aiImageWorkflowFeatureSource = await readFile(new URL("../assets/js/features/ai-image-workflow.js", import.meta.url), "utf8");
  const authShellFeatureSource = await readFile(new URL("../assets/js/features/auth-shell.js", import.meta.url), "utf8");
  const budgetTargetsFeatureSource = await readFile(new URL("../assets/js/features/budget-targets.js", import.meta.url), "utf8");
  const cashflowFeatureSource = await readFile(new URL("../assets/js/features/cashflow-dashboard.js", import.meta.url), "utf8");
  const clearanceFeatureSource = await readFile(new URL("../assets/js/features/clearance-calculator.js", import.meta.url), "utf8");
  const knowledgeFeatureSource = await readFile(new URL("../assets/js/features/knowledge-library.js", import.meta.url), "utf8");
  const inventoryProvisionFeatureSource = await readFile(new URL("../assets/js/features/inventory-provision.js", import.meta.url), "utf8");
  const lowFeeFeatureSource = await readFile(new URL("../assets/js/features/low-inventory-fee.js", import.meta.url), "utf8");
  const adKeywordFeatureSource = await readFile(new URL("../assets/js/features/ad-keywords.js", import.meta.url), "utf8");
  const adPerformanceReviewFeatureSource = await readFile(new URL("../assets/js/features/ad-performance-review.js", import.meta.url), "utf8");
  const adPortfolioFeatureSource = await readFile(new URL("../assets/js/features/ad-portfolios.js", import.meta.url), "utf8");
  const homeQuickLinksFeatureSource = await readFile(new URL("../assets/js/features/home-quick-links.js", import.meta.url), "utf8");
  const productPulseSource = await readFile(new URL("../assets/js/features/product-pulse.js", import.meta.url), "utf8");
  const reviewRatingFeatureSource = await readFile(new URL("../assets/js/features/review-rating.js", import.meta.url), "utf8");
  const salesDashboardFeatureSource = await readFile(new URL("../assets/js/features/sales-dashboard.js", import.meta.url), "utf8");
  const salesForecastFeatureSource = await readFile(new URL("../assets/js/features/sales-forecast.js", import.meta.url), "utf8");
  const sidebarShellFeatureSource = await readFile(new URL("../assets/js/features/sidebar-shell.js", import.meta.url), "utf8");
  const breadcrumbShellFeatureSource = await readFile(new URL("../assets/js/features/breadcrumb-shell.js", import.meta.url), "utf8");
  const supplierBoardFeatureSource = await readFile(new URL("../assets/js/features/supplier-board.js", import.meta.url), "utf8");
  const factoryInventoryFeatureSource = await readFile(new URL("../assets/js/features/factory-inventory.js", import.meta.url), "utf8");
  const supplierDetailFeatureSource = await readFile(new URL("../assets/js/features/supplier-detail.js", import.meta.url), "utf8");
  const payablesFeatureSource = await readFile(new URL("../assets/js/features/payables-dashboard.js", import.meta.url), "utf8");
  const storeInspectionFeatureSource = await readFile(new URL("../assets/js/features/store-inspection.js", import.meta.url), "utf8");
  const syncCenterFeatureSource = await readFile(new URL("../assets/js/features/sync-center.js", import.meta.url), "utf8");
  const topbarStatusFeatureSource = await readFile(new URL("../assets/js/features/topbar-status.js", import.meta.url), "utf8");
  const fbaFreightFeatureSource = await readFile(new URL("../assets/js/features/fba-freight.js", import.meta.url), "utf8");
  const fbaShopsFeatureSource = await readFile(new URL("../assets/js/features/fba-shops.js", import.meta.url), "utf8");
  const fbaMskuFeatureSource = await readFile(new URL("../assets/js/features/fba-msku.js", import.meta.url), "utf8");
  const fbaAutomationFeatureSource = await readFile(new URL("../assets/js/features/fba-automation.js", import.meta.url), "utf8");
  const fbaTaskFormFeatureSource = await readFile(new URL("../assets/js/features/fba-task-form.js", import.meta.url), "utf8");
  const supplierBoardSource = appSource.slice(
    appSource.indexOf("createSupplierBoardFeature({"),
    appSource.indexOf("createFactoryInventoryFeature({"),
  );
  const factoryInventorySource = appSource.slice(
    appSource.indexOf("createFactoryInventoryFeature({"),
    appSource.indexOf("createSupplierDetailFeature({"),
  );
  const supplierDetailSource = appSource.slice(
    appSource.indexOf("createSupplierDetailFeature({"),
    appSource.indexOf("const scheduleSupplierBoardLoad"),
  );
  const adPortfolioSource = appSource.slice(
    appSource.indexOf("createAdPortfolioFeature({"),
    appSource.indexOf("createAdPerformanceReviewFeature({"),
  );
  const adKeywordSource = appSource.slice(
    appSource.indexOf("createAdKeywordFeature({"),
    appSource.indexOf("const scheduleAdKeywordLoad"),
  );
  const adPerformanceReviewSource = appSource.slice(
    appSource.indexOf("createAdPerformanceReviewFeature({"),
    appSource.indexOf("createAdKeywordFeature({"),
  );
  const adPerformanceReviewLoadSource = adPerformanceReviewFeatureSource.slice(
    adPerformanceReviewFeatureSource.indexOf("async function loadAdPerformanceReview"),
    adPerformanceReviewFeatureSource.indexOf("return {"),
  );
  const aftersalesSource = appSource.slice(
    appSource.indexOf("createAftersalesDashboardFeature({"),
    appSource.indexOf("createAftersalesMailFeature({"),
  );
  const aftersalesMailSource = appSource.slice(
    appSource.indexOf("createAftersalesMailFeature({"),
    appSource.indexOf("function normalizeSiteCells"),
  );
  const payablesSource = appSource.slice(
    appSource.indexOf("createPayablesDashboardFeature({"),
    appSource.indexOf("createAdminSettingsFeature({"),
  );
  const storeInspectionSource = appSource.slice(
    appSource.indexOf("createStoreInspectionFeature({"),
    appSource.indexOf("createHomeQuickLinksFeature({"),
  );
  const homeQuickLinksSource = appSource.slice(
    appSource.indexOf("createHomeQuickLinksFeature({"),
    appSource.indexOf("createSidebarShellFeature({"),
  );
  const reviewRatingSource = appSource.slice(
    appSource.indexOf("createReviewRatingFeature({"),
    appSource.indexOf("createClearanceCalculatorFeature({"),
  );
  const clearanceSource = appSource.slice(
    appSource.indexOf("createClearanceCalculatorFeature({"),
    appSource.indexOf("createAiImageWorkflowFeature({"),
  );
  const aiImageWorkflowSource = appSource.slice(
    appSource.indexOf("createAiImageWorkflowFeature({"),
    appSource.indexOf("createStoreInspectionFeature({"),
  );
  const knowledgeSource = appSource.slice(
    appSource.indexOf("createKnowledgeLibraryFeature({"),
    appSource.indexOf("createBudgetTargetsFeature({"),
  );
  const budgetTargetsSource = appSource.slice(
    appSource.indexOf("createBudgetTargetsFeature({"),
    appSource.indexOf("createSyncCenterFeature({"),
  );
  const syncCenterSource = appSource.slice(
    appSource.indexOf("createSyncCenterFeature({"),
    appSource.indexOf("createFbaShopsFeature({"),
  );
  const fbaFreightSource = appSource.slice(
    appSource.indexOf("createFbaFreightFeature({"),
    appSource.indexOf("createAuthShellFeature({"),
  );
  const fbaMskuSource = appSource.slice(
    appSource.indexOf("createFbaMskuFeature({"),
    appSource.indexOf("createFbaAutomationFeature({"),
  );
  const fbaAutomationSource = appSource.slice(
    appSource.indexOf("createFbaAutomationFeature({"),
    appSource.indexOf("createFbaTaskFormFeature({"),
  );
  const fbaTaskFormSource = appSource.slice(
    appSource.indexOf("createFbaTaskFormFeature({"),
    appSource.indexOf("createFbaFreightFeature({"),
  );
  const fbaShopsSource = appSource.slice(
    appSource.indexOf("createFbaShopsFeature({"),
    appSource.indexOf("createFbaMskuFeature({"),
  );
  const cashflowSource = appSource.slice(
    appSource.indexOf("createCashflowDashboardFeature({"),
    appSource.indexOf("createSupplierBoardFeature({"),
  );
  const cashflowLoadSource = cashflowFeatureSource.slice(
    cashflowFeatureSource.indexOf("async function loadCashflowDashboard"),
    cashflowFeatureSource.indexOf("async function captureCashflowSnapshot"),
  );
  const payablesLoadSource = payablesFeatureSource.slice(
    payablesFeatureSource.indexOf("async function loadPayablesDashboard"),
    payablesFeatureSource.indexOf("function handlePayableTabsClick"),
  );
  const lowFeeSource = appSource.slice(
    appSource.indexOf("createLowInventoryFeeFeature({"),
    appSource.indexOf("createCashflowDashboardFeature({"),
  );
  const lowFeeLoadSource = lowFeeFeatureSource.slice(
    lowFeeFeatureSource.indexOf("async function loadLowInventoryFee"),
    lowFeeFeatureSource.indexOf("function handleLowFeeCountryChange"),
  );
  const inventoryProvisionSource = appSource.slice(
    appSource.indexOf("createInventoryProvisionFeature({"),
    appSource.indexOf("createLowInventoryFeeFeature({"),
  );
  const inventoryProvisionLoadSource = inventoryProvisionFeatureSource.slice(
    inventoryProvisionFeatureSource.indexOf("async function loadInventoryProvision"),
    inventoryProvisionFeatureSource.indexOf("async function exportInventoryProvisionDetail"),
  );
  const supplierDetailLoadSource = supplierDetailFeatureSource.slice(
    supplierDetailFeatureSource.indexOf("async function loadSupplierDetail"),
    supplierDetailFeatureSource.indexOf("function openSupplierDetailModal"),
  );
  const adminSettingsSource = appSource.slice(
    appSource.indexOf("createAdminSettingsFeature({"),
    appSource.indexOf("createKnowledgeLibraryFeature({"),
  );
  const salesDashboardSource = appSource.slice(
    appSource.indexOf("createSalesDashboardFeature({"),
    appSource.indexOf("createProductPulseFeature({"),
  );
  const salesForecastSource = appSource.slice(
    appSource.indexOf("createSalesForecastFeature({"),
    appSource.indexOf("createAdPortfolioFeature({"),
  );
  const sidebarShellSource = appSource.slice(
    appSource.indexOf("createSidebarShellFeature({"),
    appSource.indexOf("createBreadcrumbShellFeature({"),
  );
  const breadcrumbShellSource = appSource.slice(
    appSource.indexOf("createBreadcrumbShellFeature({"),
    appSource.indexOf("function setupNavigation"),
  );
  const topbarStatusSource = appSource.slice(
    appSource.indexOf("createTopbarStatusFeature({"),
    appSource.indexOf("createSyncCenterFeature({"),
  );

  assert.match(appSource, /import \{ loadDashboardSection \} from "\.\/assets\/js\/dashboard-loader\.js/);
  assert.match(appSource, /from "\.\/assets\/js\/date-utils\.js/);
  assert.match(appSource, /import \{ createFbaUtils \} from "\.\/assets\/js\/fba-utils\.js/);
  assert.match(appSource, /from "\.\/assets\/js\/front-shop-filters\.js/);
  assert.match(appSource, /import \{ createSalesShell \} from "\.\/assets\/js\/sales-shell\.js/);
  assert.match(appSource, /import \{ createNavigationUtils \} from "\.\/assets\/js\/navigation-utils\.js/);
  assert.match(appSource, /import \{ readFileAsBase64 \} from "\.\/assets\/js\/file-utils\.js/);
  assert.match(appSource, /import \{ cachedSalesImageUrl, normalizedSalesImageUrl \} from "\.\/assets\/js\/image-url\.js/);
  assert.match(appSource, /import \{ compareTableSortableValues, createTableSorter \} from "\.\/assets\/js\/table-sorter\.js/);
  assert.match(appSource, /import \{ createAdminSettingsFeature \} from "\.\/assets\/js\/features\/admin-settings\.js/);
  assert.match(appSource, /import \{ createWebhookAssistantFeature \} from "\.\/assets\/js\/features\/webhook-assistant\.js/);
  assert.match(appSource, /import \{ createAftersalesDashboardFeature \} from "\.\/assets\/js\/features\/aftersales-dashboard\.js/);
  assert.match(appSource, /import \{ createAftersalesMailFeature \} from "\.\/assets\/js\/features\/aftersales-mail\.js/);
  assert.match(appSource, /import \{ createAiImageWorkflowFeature \} from "\.\/assets\/js\/features\/ai-image-workflow\.js/);
  assert.match(appSource, /from "\.\/assets\/js\/features\/auth-shell\.js/);
  assert.match(appSource, /import \{ createBudgetTargetsFeature \} from "\.\/assets\/js\/features\/budget-targets\.js/);
  assert.match(appSource, /import \{ createCashflowDashboardFeature \} from "\.\/assets\/js\/features\/cashflow-dashboard\.js/);
  assert.match(appSource, /import \{ createAdKeywordFeature \} from "\.\/assets\/js\/features\/ad-keywords\.js/);
  assert.match(appSource, /import \{ createAdPerformanceReviewFeature \} from "\.\/assets\/js\/features\/ad-performance-review\.js/);
  assert.match(appSource, /import \{ createAdPortfolioFeature \} from "\.\/assets\/js\/features\/ad-portfolios\.js/);
  assert.match(appSource, /import \{ createHomeQuickLinksFeature \} from "\.\/assets\/js\/features\/home-quick-links\.js/);
  assert.match(appSource, /import \{ createInventoryProvisionFeature \} from "\.\/assets\/js\/features\/inventory-provision\.js/);
  assert.match(appSource, /import \{ createLowInventoryFeeFeature \} from "\.\/assets\/js\/features\/low-inventory-fee\.js/);
  assert.match(appSource, /import \{ createProductPulseFeature \} from "\.\/assets\/js\/features\/product-pulse\.js/);
  assert.match(appSource, /import \{ createSupplierBoardFeature \} from "\.\/assets\/js\/features\/supplier-board\.js/);
  assert.match(appSource, /import \{ createFactoryInventoryFeature \} from "\.\/assets\/js\/features\/factory-inventory\.js/);
  assert.match(appSource, /import \{ createSupplierDetailFeature \} from "\.\/assets\/js\/features\/supplier-detail\.js/);
  assert.match(appSource, /import \{ createPayablesDashboardFeature \} from "\.\/assets\/js\/features\/payables-dashboard\.js/);
  assert.match(appSource, /import \{ createReviewRatingFeature \} from "\.\/assets\/js\/features\/review-rating\.js/);
  assert.match(appSource, /import \{ createSalesDashboardFeature \} from "\.\/assets\/js\/features\/sales-dashboard\.js/);
  assert.match(appSource, /import \{ createSalesForecastFeature \} from "\.\/assets\/js\/features\/sales-forecast\.js/);
  assert.match(appSource, /import \{ createSidebarShellFeature \} from "\.\/assets\/js\/features\/sidebar-shell\.js/);
  assert.match(appSource, /import \{ createBreadcrumbShellFeature \} from "\.\/assets\/js\/features\/breadcrumb-shell\.js/);
  assert.match(appSource, /import \{ createStoreInspectionFeature \} from "\.\/assets\/js\/features\/store-inspection\.js/);
  assert.match(appSource, /import \{ createClearanceCalculatorFeature \} from "\.\/assets\/js\/features\/clearance-calculator\.js/);
  assert.match(appSource, /import \{ createKnowledgeLibraryFeature \} from "\.\/assets\/js\/features\/knowledge-library\.js/);
  assert.match(appSource, /import \{ createSyncCenterFeature \} from "\.\/assets\/js\/features\/sync-center\.js/);
  assert.match(appSource, /import \{ createTopbarStatusFeature \} from "\.\/assets\/js\/features\/topbar-status\.js/);
  assert.match(appSource, /import \{ createFbaFreightFeature \} from "\.\/assets\/js\/features\/fba-freight\.js/);
  assert.match(appSource, /import \{ createFbaShopsFeature \} from "\.\/assets\/js\/features\/fba-shops\.js/);
  assert.match(appSource, /import \{ createFbaMskuFeature \} from "\.\/assets\/js\/features\/fba-msku\.js/);
  assert.match(appSource, /import \{ createFbaAutomationFeature \} from "\.\/assets\/js\/features\/fba-automation\.js/);
  assert.match(appSource, /import \{ createFbaTaskFormFeature \} from "\.\/assets\/js\/features\/fba-task-form\.js/);
  assert.match(appSource, /createAftersalesDashboardFeature\(\{/);
  assert.match(appSource, /createAftersalesMailFeature\(\{/);
  assert.match(appSource, /createAiImageWorkflowFeature\(\{/);
  assert.match(appSource, /createAuthShellFeature\(\{/);
  assert.match(appSource, /createBudgetTargetsFeature\(\{/);
  assert.match(appSource, /createAdminSettingsFeature\(\{/);
  assert.match(appSource, /createWebhookAssistantFeature\(\{/);
  assert.match(appSource, /createCashflowDashboardFeature\(\{/);
  assert.match(appSource, /createAdKeywordFeature\(\{/);
  assert.match(appSource, /createAdPerformanceReviewFeature\(\{/);
  assert.match(appSource, /createAdPortfolioFeature\(\{/);
  assert.match(appSource, /createHomeQuickLinksFeature\(\{/);
  assert.match(appSource, /createInventoryProvisionFeature\(\{/);
  assert.match(appSource, /createLowInventoryFeeFeature\(\{/);
  assert.match(appSource, /createProductPulseFeature\(\{/);
  assert.match(appSource, /createSupplierBoardFeature\(\{/);
  assert.match(appSource, /createFactoryInventoryFeature\(\{/);
  assert.match(appSource, /createSupplierDetailFeature\(\{/);
  assert.match(appSource, /createPayablesDashboardFeature\(\{/);
  assert.match(appSource, /createReviewRatingFeature\(\{/);
  assert.match(appSource, /createSalesDashboardFeature\(\{/);
  assert.match(appSource, /createSalesForecastFeature\(\{/);
  assert.match(salesForecastSource, /downloadBlob,/);
  assert.match(appSource, /createSidebarShellFeature\(\{/);
  assert.match(appSource, /createBreadcrumbShellFeature\(\{/);
  assert.match(appSource, /createStoreInspectionFeature\(\{/);
  assert.match(appSource, /createClearanceCalculatorFeature\(\{/);
  assert.match(appSource, /createKnowledgeLibraryFeature\(\{/);
  assert.match(appSource, /createSyncCenterFeature\(\{/);
  assert.match(appSource, /createTopbarStatusFeature\(\{/);
  assert.match(appSource, /createFbaFreightFeature\(\{/);
  assert.match(appSource, /createFbaShopsFeature\(\{/);
  assert.match(appSource, /createFbaMskuFeature\(\{/);
  assert.match(appSource, /createFbaAutomationFeature\(\{/);
  assert.match(appSource, /createFbaTaskFormFeature\(\{/);
  assert.equal(appSource.includes("async function loadAftersalesDashboard"), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-refresh-button"'), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-start-date"'), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-end-date"'), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-date-type"'), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-keyword"'), false);
  assert.equal(appSource.includes("async function loadAftersalesMailDashboard"), false);
  assert.equal(appSource.includes('bind(document, "#aftersales-mail'), false);
  assert.equal(appSource.includes("async function loadCashflowDashboard"), false);
  assert.equal(appSource.includes("async function captureCashflowSnapshot"), false);
  assert.equal(appSource.includes("async function loadInventoryProvision"), false);
  assert.equal(appSource.includes("async function exportInventoryProvisionDetail"), false);
  assert.equal(appSource.includes("async function loadLowInventoryFee"), false);
  assert.equal(appSource.includes("async function loadAdKeywordDashboard"), false);
  assert.equal(appSource.includes("async function loadAdPerformanceReview"), false);
  assert.equal(appSource.includes('bind(document, "#ads-review'), false);
  assert.equal(appSource.includes("async function loadAdPortfolios"), false);
  assert.equal(appSource.includes('bind(document, "#ads-portfolio'), false);
  assert.equal(appSource.includes("async function loadProductPulse"), false);
  assert.equal(appSource.includes("async function loadSupplierBoard"), false);
  assert.equal(appSource.includes('bind(document, "#supplier-board'), false);
  assert.equal(appSource.includes('bindAll(document, "#supplier-board'), false);
  assert.equal(appSource.includes("async function loadFactoryInventory"), false);
  assert.equal(appSource.includes('bind(document, "#factory-inventory'), false);
  assert.equal(appSource.includes('bindAll(document, "#factory-inventory'), false);
  assert.equal(appSource.includes("async function loadSupplierDetail"), false);
  assert.equal(appSource.includes("async function loadPayablesDashboard"), false);
  assert.equal(appSource.includes("async function loadSalesForecast"), false);
  assert.equal(appSource.includes("async function loadStoreInspectionDashboard"), false);
  assert.equal(appSource.includes("async function loadClearanceInventory"), false);
  assert.equal(appSource.includes("function renderClearanceCalculator"), false);
  assert.equal(appSource.includes('bind(document, "#front-country-filter"'), false);
  assert.equal(appSource.includes('bind(document, "#front-shop-filter"'), false);
  assert.equal(appSource.includes('bind(document, "#front-owner-filter"'), false);
  assert.equal(appSource.includes('bind(document, "#front-currency-filter"'), false);
  assert.match(helperSource, /export async function loadDashboardSection/);
  assert.match(dateUtilsSource, /export function getDateRangeByPreset/);
  assert.match(dateUtilsSource, /export function formatCompactDateTime/);
  assert.match(fbaUtilsSource, /export function createFbaUtils/);
  assert.match(fileUtilsSource, /export function readFileAsBase64/);
  assert.match(frontShopFiltersSource, /export function createFrontShopFilters/);
  assert.match(frontShopFiltersSource, /export function pickSellerName/);
  assert.match(frontShopFiltersSource, /export function getDisplayShopName/);
  assert.ok(frontShopFiltersSource.includes("function setupFrontShopFilterControls"), "missing setupFrontShopFilterControls filter setup");
  assert.ok(frontShopFiltersSource.includes('bind(root, "#front-country-filter", "change"'), "front country filter binding should live in front-shop-filters");
  assert.match(navigationUtilsSource, /export function createNavigationUtils/);
  assert.match(navigationUtilsSource, /function clickVisibleNavItem\(target\)/);
  assert.match(navigationUtilsSource, /function setupNavClickBinding\(onNavItem\)/);
  assert.match(navigationUtilsSource, /function setupNavGroupTitleBinding\(\)/);
  assert.match(navigationUtilsSource, /function updateNavGroupActiveStates\(\)/);
  assert.match(salesShellSource, /export function createSalesShell/);
  assert.match(imageUrlSource, /export function normalizedSalesImageUrl/);
  assert.match(imageUrlSource, /export function cachedSalesImageUrl/);
  assert.match(tableSorterSource, /export function compareTableSortableValues/);
  assert.match(tableSorterSource, /export function createTableSorter/);
  assert.match(aftersalesFeatureSource, /export function createAftersalesDashboardFeature/);
  assert.match(aftersalesMailFeatureSource, /export function createAftersalesMailFeature/);
  assert.match(aiImageWorkflowFeatureSource, /export function createAiImageWorkflowFeature/);
  assert.match(authShellFeatureSource, /export function createAuthShellFeature/);
  assert.match(budgetTargetsFeatureSource, /export function createBudgetTargetsFeature/);
  assert.match(cashflowFeatureSource, /export function createCashflowDashboardFeature/);
  assert.match(inventoryProvisionFeatureSource, /export function createInventoryProvisionFeature/);
  assert.match(lowFeeFeatureSource, /export function createLowInventoryFeeFeature/);
  assert.match(adKeywordFeatureSource, /export function createAdKeywordFeature/);
  assert.match(adPerformanceReviewFeatureSource, /export function createAdPerformanceReviewFeature/);
  assert.match(adPortfolioFeatureSource, /export function createAdPortfolioFeature/);
  assert.match(homeQuickLinksFeatureSource, /export function createHomeQuickLinksFeature/);
  assert.match(productPulseSource, /export function createProductPulseFeature/);
  assert.match(supplierBoardFeatureSource, /export function createSupplierBoardFeature/);
  assert.match(factoryInventoryFeatureSource, /export function createFactoryInventoryFeature/);
  assert.match(supplierDetailFeatureSource, /export function createSupplierDetailFeature/);
  assert.match(payablesFeatureSource, /export function createPayablesDashboardFeature/);
  assert.match(reviewRatingFeatureSource, /export function createReviewRatingFeature/);
  assert.match(salesDashboardFeatureSource, /export function createSalesDashboardFeature/);
  assert.match(salesForecastFeatureSource, /export function createSalesForecastFeature/);
  assert.match(sidebarShellFeatureSource, /export function createSidebarShellFeature/);
  assert.match(breadcrumbShellFeatureSource, /export function createBreadcrumbShellFeature/);
  assert.match(storeInspectionFeatureSource, /export function createStoreInspectionFeature/);
  assert.match(clearanceFeatureSource, /export function createClearanceCalculatorFeature/);
  assert.match(knowledgeFeatureSource, /export function createKnowledgeLibraryFeature/);
  assert.match(adminSettingsFeatureSource, /export function createAdminSettingsFeature/);
  assert.match(syncCenterFeatureSource, /export function createSyncCenterFeature/);
  assert.match(topbarStatusFeatureSource, /export function createTopbarStatusFeature/);
  assert.match(fbaFreightFeatureSource, /export function createFbaFreightFeature/);
  assert.match(fbaShopsFeatureSource, /export function createFbaShopsFeature/);
  assert.match(fbaMskuFeatureSource, /export function createFbaMskuFeature/);
  assert.match(fbaAutomationFeatureSource, /export function createFbaAutomationFeature/);
  assert.match(fbaTaskFormFeatureSource, /export function createFbaTaskFormFeature/);
  assert.ok(supplierBoardFeatureSource.includes("async function loadSupplierBoard"), "missing loadSupplierBoard feature loader");
  assert.ok(supplierBoardFeatureSource.includes("function setupSupplierBoard"), "missing setupSupplierBoard feature setup");
  assert.ok(supplierBoardFeatureSource.includes('bind(root, "#supplier-board-refresh", "click"'), "supplier board refresh binding should live in feature");
  assert.ok(factoryInventoryFeatureSource.includes("async function loadFactoryInventory"), "missing loadFactoryInventory feature loader");
  assert.ok(factoryInventoryFeatureSource.includes("function setupFactoryInventory"), "missing setupFactoryInventory feature setup");
  assert.ok(factoryInventoryFeatureSource.includes('bind(root, "#factory-inventory-refresh", "click"'), "factory inventory refresh binding should live in feature");
  assert.ok(supplierDetailFeatureSource.includes("async function loadSupplierDetail"), "missing loadSupplierDetail feature loader");
  assert.ok(supplierDetailFeatureSource.includes("function setupSupplierDetail"), "missing setupSupplierDetail feature setup");
  assert.ok(payablesFeatureSource.includes("async function loadPayablesDashboard"), "missing loadPayablesDashboard feature loader");
  assert.ok(payablesFeatureSource.includes("function setupPayablesDashboard"), "missing setupPayablesDashboard feature setup");
  assert.ok(storeInspectionFeatureSource.includes("async function loadStoreInspectionDashboard"), "missing loadStoreInspectionDashboard feature loader");
  assert.ok(storeInspectionFeatureSource.includes("function setupStoreInspectionModule"), "missing setupStoreInspectionModule feature setup");
  assert.ok(productPulseSource.includes("async function loadProductPulse"), "missing loadProductPulse feature loader");
  assert.ok(productPulseSource.includes("function setupProductPulse"), "missing setupProductPulse feature setup");
  assert.ok(adPortfolioFeatureSource.includes("async function loadAdPortfolios"), "missing loadAdPortfolios feature loader");
  assert.ok(adPortfolioFeatureSource.includes("function setupAdPortfolios"), "missing setupAdPortfolios feature setup");
  assert.ok(adPortfolioFeatureSource.includes('bind(root, "#ads-portfolio-refresh", "click"'), "ad portfolio refresh binding should live in feature");
  assert.ok(adKeywordFeatureSource.includes("async function loadAdKeywordDashboard"), "missing loadAdKeywordDashboard feature loader");
  assert.ok(adKeywordFeatureSource.includes("function setupAdKeywordDashboard"), "missing setupAdKeywordDashboard feature setup");
  assert.ok(adPerformanceReviewFeatureSource.includes("async function loadAdPerformanceReview"), "missing loadAdPerformanceReview feature loader");
  assert.ok(adPerformanceReviewFeatureSource.includes("function setupAdPerformanceReview"), "missing setupAdPerformanceReview feature setup");
  assert.ok(adPerformanceReviewFeatureSource.includes('bind(root, "#ads-review-refresh", "click"'), "ad performance review refresh binding should live in feature");
  assert.ok(homeQuickLinksFeatureSource.includes("function renderHomeQuickLinks"), "missing renderHomeQuickLinks feature renderer");
  assert.ok(homeQuickLinksFeatureSource.includes("function setupHomeQuickLinks"), "missing setupHomeQuickLinks feature setup");
  assert.ok(reviewRatingFeatureSource.includes("function calculateReviewRating"), "missing calculateReviewRating feature action");
  assert.ok(reviewRatingFeatureSource.includes("function setupReviewRatingCalculator"), "missing setupReviewRatingCalculator feature setup");
  assert.ok(salesDashboardFeatureSource.includes("function makeUnavailableDashboard"), "missing sales dashboard fallback builder");
  assert.ok(salesDashboardFeatureSource.includes("function renderDashboard"), "missing renderDashboard feature renderer");
  assert.ok(salesDashboardFeatureSource.includes("async function loadDashboard"), "missing sales dashboard feature loader");
  assert.ok(salesDashboardFeatureSource.includes("function renderMskuDetailTable"), "missing MSKU detail feature renderer");
  assert.ok(salesDashboardFeatureSource.includes("function applyMskuDetailSort"), "missing MSKU detail sort action");
  assert.ok(salesDashboardFeatureSource.includes("function setupSalesDashboard"), "missing sales dashboard setup");
  assert.ok(salesForecastFeatureSource.includes("async function loadSalesForecast"), "missing loadSalesForecast feature loader");
  assert.ok(salesForecastFeatureSource.includes("function renderSalesForecast"), "missing renderSalesForecast feature renderer");
  assert.ok(salesForecastFeatureSource.includes("function renderSalesForecastHeader"), "missing renderSalesForecastHeader feature renderer");
  assert.ok(salesForecastFeatureSource.includes("function setSalesForecastViewMode"), "missing setSalesForecastViewMode feature action");
  assert.ok(salesForecastFeatureSource.includes("function setupSalesForecast"), "missing setupSalesForecast feature setup");
  assert.ok(sidebarShellFeatureSource.includes("function collapseSidebar"), "missing collapseSidebar shell action");
  assert.ok(sidebarShellFeatureSource.includes("function expandSidebarGroup"), "missing expandSidebarGroup shell action");
  assert.ok(sidebarShellFeatureSource.includes("function setupSidebarShell"), "missing setupSidebarShell setup");
  assert.ok(breadcrumbShellFeatureSource.includes("const viewBreadcrumbs"), "missing breadcrumb view map");
  assert.ok(breadcrumbShellFeatureSource.includes("function renderBreadcrumbMarkup"), "missing breadcrumb renderer");
  assert.ok(breadcrumbShellFeatureSource.includes("function renderTopbarBreadcrumb"), "missing topbar breadcrumb renderer");
  assert.ok(breadcrumbShellFeatureSource.includes("function applyModuleBreadcrumbs"), "missing module breadcrumb applier");
  assert.ok(breadcrumbShellFeatureSource.includes("function setupBreadcrumbNavigation"), "missing breadcrumb navigation setup");
  assert.ok(clearanceFeatureSource.includes("async function loadClearanceInventory"), "missing loadClearanceInventory feature loader");
  assert.ok(clearanceFeatureSource.includes("async function loadClearanceView"), "missing loadClearanceView feature entry");
  assert.ok(clearanceFeatureSource.includes("function renderClearanceCalculator"), "missing renderClearanceCalculator feature renderer");
  assert.ok(clearanceFeatureSource.includes("function setupClearanceCalculator"), "missing setupClearanceCalculator feature setup");
  assert.ok(knowledgeFeatureSource.includes("async function loadKnowledgeLibrary"), "missing loadKnowledgeLibrary feature loader");
  assert.ok(knowledgeFeatureSource.includes("function renderKnowledgeLibrary"), "missing renderKnowledgeLibrary feature renderer");
  assert.ok(knowledgeFeatureSource.includes("function closeKnowledgeExternalDocument"), "missing closeKnowledgeExternalDocument feature action");
  assert.ok(knowledgeFeatureSource.includes("function setupKnowledgeLibrary"), "missing setupKnowledgeLibrary feature setup");
  assert.ok(aftersalesFeatureSource.includes("async function loadAftersalesDashboard"), "missing loadAftersalesDashboard feature loader");
  assert.ok(aftersalesFeatureSource.includes("function setupAftersalesDashboard"), "missing setupAftersalesDashboard feature setup");
  assert.ok(aftersalesFeatureSource.includes('bind(root, "#aftersales-refresh-button", "click"'), "aftersales dashboard refresh binding should live in feature");
  assert.ok(aftersalesMailFeatureSource.includes("async function loadAftersalesMailDashboard"), "missing loadAftersalesMailDashboard feature loader");
  assert.ok(aftersalesMailFeatureSource.includes("async function generateAftersalesMailAiSuggestion"), "missing generateAftersalesMailAiSuggestion feature action");
  assert.ok(aftersalesMailFeatureSource.includes("async function sendAftersalesMailReply"), "missing sendAftersalesMailReply feature action");
  assert.ok(aftersalesMailFeatureSource.includes("function setupAftersalesMail"), "missing setupAftersalesMail feature setup");
  assert.ok(aftersalesMailFeatureSource.includes('bind(root, "#aftersales-mail-refresh", "click"'), "aftersales mail refresh binding should live in feature");
  assert.ok(aiImageWorkflowFeatureSource.includes("function setupAiImageWorkflow"), "missing setupAiImageWorkflow feature setup");
  assert.ok(aiImageWorkflowFeatureSource.includes("async function generateAiImageWorkflow"), "missing generateAiImageWorkflow feature action");
  assert.ok(aiImageWorkflowFeatureSource.includes("function renderAiListingCopy"), "missing renderAiListingCopy feature renderer");
  assert.ok(authShellFeatureSource.includes("function syncPermissionVisibility"), "missing auth shell permission visibility helper");
  assert.ok(authShellFeatureSource.includes("function applyAuthVisibility"), "missing auth shell visibility action");
  assert.ok(authShellFeatureSource.includes("async function loadAuthStatus"), "missing auth shell status loader");
  assert.ok(authShellFeatureSource.includes("function setupAuthShell"), "missing auth shell setup");
  assert.ok(budgetTargetsFeatureSource.includes("async function loadBudgetUploads"), "missing loadBudgetUploads feature loader");
  assert.ok(budgetTargetsFeatureSource.includes("async function loadBudgetTargets"), "missing loadBudgetTargets feature loader");
  assert.ok(budgetTargetsFeatureSource.includes("function renderBudgetTargets"), "missing renderBudgetTargets feature renderer");
  assert.ok(budgetTargetsFeatureSource.includes("function setupBudgetTargets"), "missing setupBudgetTargets feature setup");
  assert.equal(appSource.includes("function readFileAsBase64"), false);
  assert.equal(budgetTargetsFeatureSource.includes("function readFileAsBase64"), false);
  assert.equal(appSource.includes("let frontShopSellers"), false);
  assert.equal(appSource.includes("function pickSellerName"), false);
  assert.equal(appSource.includes("function pickSellerCountry"), false);
  assert.equal(appSource.includes("function getDisplayShopName"), false);
  assert.equal(appSource.includes("function populateFrontShopFilters"), false);
  assert.equal(appSource.includes("function getSelectedFrontSids"), false);
  assert.equal(appSource.includes("function buildDashboardQuery"), false);
  assert.equal(appSource.includes("let frontDateRange"), false);
  assert.equal(appSource.includes("function showLocalFileWarning"), false);
  assert.equal(appSource.includes("function removeLegacySalesLayout"), false);
  assert.equal(appSource.includes("function updateFrontDateRange"), false);
  assert.equal(appSource.includes("function closeFrontDatePopover"), false);
  assert.equal(appSource.includes("function toggleFrontDatePopover"), false);
  assert.equal(appSource.includes("function syncSalesToolbarVisibility"), false);
  assert.equal(appSource.includes("function placeSalesFiltersAfterBreadcrumb"), false);
  assert.ok(adminSettingsFeatureSource.includes("async function loadAdminOverview"), "missing loadAdminOverview feature loader");
  assert.ok(adminSettingsFeatureSource.includes("async function loadAdminAccounts"), "missing loadAdminAccounts feature loader");
  assert.ok(adminSettingsFeatureSource.includes("async function loadDingtalkAuthUsers"), "missing loadDingtalkAuthUsers feature loader");
  assert.ok(adminSettingsFeatureSource.includes("function setupAdminSettings"), "missing setupAdminSettings feature setup");
  assert.ok(syncCenterFeatureSource.includes("async function loadSyncStatus"), "missing loadSyncStatus feature loader");
  assert.ok(syncCenterFeatureSource.includes("async function loadHealthStatus"), "missing loadHealthStatus feature loader");
  assert.ok(syncCenterFeatureSource.includes("async function loadLingxingShops"), "missing loadLingxingShops feature loader");
  assert.ok(syncCenterFeatureSource.includes("function renderSyncStatus"), "missing renderSyncStatus feature renderer");
  assert.ok(syncCenterFeatureSource.includes("function renderLingxingShops"), "missing renderLingxingShops feature renderer");
  assert.ok(syncCenterFeatureSource.includes("function setupSyncCenter"), "missing setupSyncCenter feature setup");
  assert.ok(topbarStatusFeatureSource.includes("function updateWorldClock"), "missing updateWorldClock topbar renderer");
  assert.ok(topbarStatusFeatureSource.includes("function renderTopbarSyncStatus"), "missing renderTopbarSyncStatus topbar renderer");
  assert.ok(fbaFreightFeatureSource.includes("async function loadFbaFreightInitial"), "missing loadFbaFreightInitial feature entry");
  assert.ok(fbaFreightFeatureSource.includes("async function loadFbaFreightShipments"), "missing loadFbaFreightShipments feature loader");
  assert.ok(fbaFreightFeatureSource.includes("function renderFbaFreightRows"), "missing renderFbaFreightRows feature renderer");
  assert.ok(fbaFreightFeatureSource.includes("function setupFbaFreight"), "missing setupFbaFreight feature setup");
  assert.ok(fbaShopsFeatureSource.includes("async function loadFbaShops"), "missing loadFbaShops feature loader");
  assert.ok(fbaShopsFeatureSource.includes("function populateFbaShopSelect"), "missing populateFbaShopSelect feature action");
  assert.ok(fbaShopsFeatureSource.includes("function renderFbaShopOptions"), "missing renderFbaShopOptions feature renderer");
  assert.ok(fbaShopsFeatureSource.includes("function setupFbaShopPicker"), "missing setupFbaShopPicker feature setup");
  assert.ok(fbaMskuFeatureSource.includes("async function loadFbaMskus"), "missing loadFbaMskus feature loader");
  assert.ok(fbaMskuFeatureSource.includes("function renderFbaMskuOptions"), "missing renderFbaMskuOptions feature renderer");
  assert.ok(fbaMskuFeatureSource.includes("function renderFbaWarehouseOptions"), "missing renderFbaWarehouseOptions feature renderer");
  assert.ok(fbaMskuFeatureSource.includes("function setupFbaMskuPicker"), "missing setupFbaMskuPicker feature setup");
  assert.ok(fbaAutomationFeatureSource.includes("async function loadFbaAutomationState"), "missing loadFbaAutomationState feature loader");
  assert.ok(fbaAutomationFeatureSource.includes("function renderFbaTaskBoard"), "missing renderFbaTaskBoard feature renderer");
  assert.ok(fbaAutomationFeatureSource.includes("function renderFbaResultHistory"), "missing renderFbaResultHistory feature renderer");
  assert.ok(fbaAutomationFeatureSource.includes("function setupFbaAutomationBoard"), "missing setupFbaAutomationBoard feature setup");
  assert.ok(fbaTaskFormFeatureSource.includes("function buildFbaPayload"), "missing buildFbaPayload feature action");
  assert.ok(fbaTaskFormFeatureSource.includes("async function createFbaTask"), "missing createFbaTask feature action");
  assert.ok(fbaTaskFormFeatureSource.includes("async function runFbaWarehouseProbe"), "missing runFbaWarehouseProbe feature action");
  assert.ok(fbaTaskFormFeatureSource.includes("function setupFbaTaskForm"), "missing setupFbaTaskForm feature setup");
  assert.ok(cashflowFeatureSource.includes("async function loadCashflowDashboard"), "missing loadCashflowDashboard feature loader");
  assert.ok(cashflowFeatureSource.includes("async function captureCashflowSnapshot"), "missing captureCashflowSnapshot feature action");
  assert.ok(cashflowFeatureSource.includes("function setupCashflowDashboard"), "missing setupCashflowDashboard feature setup");
  assert.ok(payablesFeatureSource.includes("async function loadPayablesDashboard"), "missing loadPayablesDashboard");
  assert.ok(inventoryProvisionFeatureSource.includes("async function loadInventoryProvision"), "missing loadInventoryProvision feature loader");
  assert.ok(inventoryProvisionFeatureSource.includes("async function exportInventoryProvisionDetail"), "missing exportInventoryProvisionDetail feature action");
  assert.ok(inventoryProvisionFeatureSource.includes("function setupInventoryProvision"), "missing setupInventoryProvision feature setup");
  assert.ok(lowFeeFeatureSource.includes("async function loadLowInventoryFee"), "missing loadLowInventoryFee feature loader");
  assert.ok(lowFeeFeatureSource.includes("function setupLowInventoryFee"), "missing setupLowInventoryFee feature setup");

  assert.match(supplierBoardFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(supplierBoardSource.includes("fetch(`/api/dashboard/supplier-board"), false);
  assert.equal(supplierBoardFeatureSource.includes("fetch(`/api/dashboard/supplier-board"), false);
  assert.equal(supplierBoardSource.includes("setButtonBusy("), false);
  assert.equal(supplierBoardFeatureSource.includes("setButtonBusy("), false);

  assert.match(factoryInventoryFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(factoryInventorySource.includes("fetch(`/api/dashboard/factory-inventory"), false);
  assert.equal(factoryInventoryFeatureSource.includes("fetch(`/api/dashboard/factory-inventory"), false);
  assert.equal(factoryInventorySource.includes("setElementsDisabled("), false);
  assert.equal(factoryInventoryFeatureSource.includes("setElementsDisabled("), false);

  assert.match(supplierDetailFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(supplierDetailSource.includes("fetch(`/api/purchase/supplier-details"), false);
  assert.equal(supplierDetailLoadSource.includes("fetch("), false);
  assert.equal(appSource.includes('bind(document, "#supplier-detail'), false);
  assert.equal(appSource.includes('bindBackdropClose(document, "#supplier-detail'), false);
  assert.equal(supplierDetailSource.includes('bind(document, "#supplier-detail'), false);
  assert.match(supplierDetailFeatureSource, /bind\(root, "#supplier-detail-open-modal", "click"/);
  assert.match(supplierDetailFeatureSource, /bindBackdropClose\(root, "#supplier-detail-modal"/);

  assert.match(productPulseSource, /loadDashboardSection\(\{/);
  assert.equal(productPulseSource.includes("fetch(`/api/dashboard/product-pulse"), false);
  assert.equal(productPulseSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes('bind(document, "#pulse-'), false);
  assert.match(productPulseSource, /bind\(root, "#pulse-refresh-button", "click"/);

  assert.match(adPortfolioFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(adPortfolioSource.includes("fetch(`/api/dashboard/ad-portfolios"), false);
  assert.equal(adPortfolioFeatureSource.includes("fetch(`/api/dashboard/ad-portfolios"), false);
  assert.equal(adPortfolioSource.includes("setButtonBusy("), false);
  assert.equal(adPortfolioFeatureSource.includes("setButtonBusy("), false);

  assert.match(adKeywordFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(adKeywordSource.includes("fetch(`/api/dashboard/ad-keywords"), false);
  assert.equal(adKeywordFeatureSource.includes("fetch(`/api/dashboard/ad-keywords"), false);
  assert.equal(adKeywordSource.includes("setButtonBusy("), false);
  assert.equal(adKeywordFeatureSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes("const scheduleAdKeywordLoad"), false);
  assert.equal(appSource.includes('bind(document, "#ads-keyword'), false);
  assert.match(adKeywordFeatureSource, /bind\(root, "#ads-keyword-refresh", "click"/);
  assert.match(adKeywordFeatureSource, /createDebouncedAction\(loadAdKeywordDashboard, 350\)/);

  assert.match(adPerformanceReviewFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(adPerformanceReviewSource.includes("fetch(`/api/dashboard/ad-performance-review"), false);
  assert.equal(adPerformanceReviewLoadSource.includes("fetch("), false);
  assert.equal(adPerformanceReviewSource.includes("setButtonBusy("), false);
  assert.equal(adPerformanceReviewFeatureSource.includes("setButtonBusy("), false);

  assert.match(aftersalesFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(aftersalesSource.includes("fetch(`/api/dashboard/aftersales"), false);
  assert.equal(aftersalesFeatureSource.includes("fetch(`/api/dashboard/aftersales"), false);
  assert.equal(aftersalesSource.includes("setButtonBusy("), false);
  assert.equal(aftersalesFeatureSource.includes("setButtonBusy("), false);

  assert.equal(appSource.includes("let aftersalesMailDashboardData"), false);
  assert.equal(appSource.includes("let aftersalesMailSelectedUid"), false);
  assert.equal(appSource.includes("let aftersalesMailAttachmentObjectUrls"), false);
  assert.equal(appSource.includes("function renderAftersalesMailDashboard"), false);
  assert.equal(aftersalesMailSource.includes("fetch(`/api/aftersales-mail"), false);

  assert.match(payablesFeatureSource, /loadDashboardSection\(\{/);
  assert.equal(payablesSource.includes("fetch(`/api/dashboard/payables"), false);
  assert.equal(payablesLoadSource.includes("fetch("), false);
  assert.equal(payablesSource.includes("setButtonBusy("), false);
  assert.equal(payablesFeatureSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes("const schedulePayablesLoad"), false);
  assert.equal(appSource.includes('bind(document, "#payables'), false);
  assert.equal(appSource.includes('bindAll(document, ".payable-tabs"'), false);
  assert.match(payablesFeatureSource, /bind\(root, "#payables-refresh-button", "click"/);
  assert.match(payablesFeatureSource, /bindAll\(root, "\.payable-tabs", "click"/);

  assert.equal(appSource.includes("let storeInspectionDashboard"), false);
  assert.equal(appSource.includes("let storeInspectionReportMarkdown"), false);
  assert.equal(appSource.includes("function renderStoreInspectionPreview"), false);
  assert.equal(appSource.includes("function renderStoreInspectionRecords"), false);
  assert.equal(storeInspectionSource.includes("fetch(\"/api/store-inspection"), false);
  assert.equal(storeInspectionSource.includes("setButtonBusy("), false);

  assert.equal(appSource.includes("const HOME_QUICK_LINKS_STORAGE_KEY"), false);
  assert.equal(appSource.includes("const homeQuickLinkCatalog"), false);
  assert.equal(appSource.includes("let homeQuickConfig"), false);
  assert.equal(appSource.includes("function renderHomeQuickLinks"), false);
  assert.equal(appSource.includes("function setupHomeQuickLinks"), false);
  assert.equal(homeQuickLinksSource.includes("localStorage.getItem"), false);

  assert.equal(appSource.includes("const REVIEW_PERCENT_TONE_CLASSES"), false);
  assert.equal(appSource.includes("function parseReviewPercent"), false);
  assert.equal(appSource.includes("function calculateReviewRating"), false);
  assert.equal(appSource.includes("function resetReviewRatingCalculator"), false);
  assert.equal(reviewRatingSource.includes("#review-total, #review-target, .review-percent-input"), false);

  assert.equal(appSource.includes("const fallbackDashboard"), false);
  assert.equal(appSource.includes("function normalizeDashboardPayload"), false);
  assert.equal(appSource.includes("async function loadDashboard"), false);
  assert.equal(appSource.includes("function normalizeKpi"), false);
  assert.equal(appSource.includes("function progressStyle"), false);
  assert.equal(appSource.includes("function fillTables"), false);
  assert.equal(appSource.includes("function fillCards"), false);
  assert.equal(appSource.includes("function renderMskuStoreTabs"), false);
  assert.equal(appSource.includes("function renderMskuDetailTable"), false);
  assert.equal(appSource.includes("function populateFrontOwnerOptions"), false);
  assert.equal(appSource.includes("function renderHomeOverview"), false);
  assert.equal(salesDashboardSource.includes("fetch(`/api/dashboard/sales-weekly"), false);
  assert.equal(salesDashboardSource.includes("bind(document, \"#msku-store-tabs"), false);
  assert.equal(salesDashboardSource.includes("bindAll(document, \"[data-msku-sort]"), false);

  assert.equal(appSource.includes("function syncSidebarToggleState"), false);
  assert.equal(appSource.includes("function findSidebarNavButton"), false);
  assert.equal(appSource.includes("function bindSidebarFlyoutClick"), false);
  assert.equal(appSource.includes("function ensureSidebarFlyout"), false);
  assert.equal(appSource.includes("function hideSidebarFlyout"), false);
  assert.equal(appSource.includes("function showSidebarFlyout"), false);
  assert.equal(appSource.includes("function setupSidebarFlyout"), false);
  assert.equal(appSource.includes("function setupSidebarHoverFeedback"), false);
  assert.equal(sidebarShellSource.includes("bind(document, \"#sidebar-toggle"), false);
  assert.equal(sidebarShellSource.includes("bindClickOutside(document, \".sidebar\""), false);

  assert.equal(appSource.includes("const viewBreadcrumbs"), false);
  assert.equal(appSource.includes("const breadcrumbGroups"), false);
  assert.equal(appSource.includes("function renderBreadcrumbMarkup"), false);
  assert.equal(appSource.includes("function applyModuleBreadcrumbs"), false);
  assert.equal(appSource.includes("function setupBreadcrumbNavigation"), false);
  assert.equal(breadcrumbShellSource.includes("document.querySelector"), false);
  assert.equal(breadcrumbShellSource.includes("bindEventTarget(document"), false);
  assert.equal(appSource.includes("function clickVisibleNavItem"), false);
  assert.equal(appSource.includes('bind(document, ".nav"'), false);
  assert.equal(appSource.includes("__tanjiaNavigationGroupsReady"), false);
  assert.equal(appSource.includes('querySelectorAll(".nav-group-title")'), false);
  assert.equal(appSource.includes("function updateNavGroupActiveStates"), false);
  assert.match(appSource, /createNavigationUtils\(\{/);

  assert.equal(appSource.includes("let currentAuthUser"), false);
  assert.equal(appSource.includes("function normalizeAccessRole"), false);
  assert.equal(appSource.includes("function canAccessFinance"), false);
  assert.equal(appSource.includes("function canManageAdminSettings"), false);
  assert.equal(appSource.includes("function syncPermissionVisibility"), false);
  assert.equal(appSource.includes("function applyAuthVisibility"), false);
  assert.equal(appSource.includes("async function loadAuthStatus"), false);
  assert.equal(appSource.includes("async function logout"), false);
  assert.equal(appSource.includes("bind(document, \"#auth-user-chip"), false);
  assert.equal(appSource.includes("bindClickOutside(document, \"#account-menu"), false);

  assert.equal(appSource.includes("function getTableCellSortableText"), false);
  assert.equal(appSource.includes("function parseTableSortableNumber"), false);
  assert.equal(appSource.includes("function parseTableSortableDate"), false);
  assert.equal(appSource.includes("function compareTableSortableValues"), false);
  assert.equal(appSource.includes("function isFixedSortRow"), false);
  assert.equal(appSource.includes("function sortTableByHeader"), false);
  assert.equal(appSource.includes("bindEventTarget(document"), false);
  assert.match(appSource, /createTableSorter\(\{/);
  assert.match(tableSorterSource, /function setupTableSortBridge\(\) \{[\s\S]*?bindEventTarget\(root, "click"/);

  assert.equal(appSource.includes("const PACIFIC_TIME_ZONE"), false);
  assert.equal(appSource.includes("function formatDate"), false);
  assert.equal(appSource.includes("function getPacificDateParts"), false);
  assert.equal(appSource.includes("function getPacificTodayDate"), false);
  assert.equal(appSource.includes("function getPacificTodayText"), false);
  assert.equal(appSource.includes("function formatCompactDateTime"), false);
  assert.equal(appSource.includes("function getDefaultFrontDateRange"), false);
  assert.equal(appSource.includes("function addDays"), false);
  assert.equal(appSource.includes("function getWeekStart"), false);
  assert.equal(appSource.includes("function getDateRangeByPreset"), false);
  assert.equal(appSource.includes("function normalizedSalesImageUrl"), false);
  assert.equal(appSource.includes("function cachedSalesImageUrl"), false);

  assert.equal(appSource.includes("const dashboardTimeZones"), false);
  assert.equal(appSource.includes("const dashboardTimeFormatters"), false);
  assert.equal(appSource.includes("const SYNC_TONE_CLASSES"), false);
  assert.equal(appSource.includes("let topbarSyncState"), false);
  assert.equal(appSource.includes("function formatTimeInZone"), false);
  assert.equal(appSource.includes("function updateWorldClock"), false);
  assert.equal(appSource.includes("function renderTopbarSyncStatus"), false);
  assert.equal(topbarStatusSource.includes("document.querySelector(\"#world-clock\")"), false);

  assert.equal(appSource.includes("let salesForecastData"), false);
  assert.equal(appSource.includes("let salesForecastStoreFilterOptions"), false);
  assert.equal(appSource.includes("const SALES_FORECAST_MANUAL_STORAGE_KEY"), false);
  assert.equal(appSource.includes("const salesForecastColumns"), false);
  assert.equal(appSource.includes("function renderSalesForecastHeader"), false);
  assert.equal(appSource.includes("function renderSalesForecast"), false);
  assert.equal(appSource.includes("function setSalesForecastViewMode"), false);
  assert.equal(appSource.includes("function setupSalesForecast"), false);
  assert.equal(salesForecastSource.includes("bind(document, \"#sales-forecast"), false);
  assert.equal(salesForecastSource.includes("bindAll(document, \"[data-sales-forecast-view]"), false);

  assert.equal(appSource.includes("let clearanceRealInventoryLoaded"), false);
  assert.equal(appSource.includes("let clearanceRows"), false);
  assert.equal(appSource.includes("let clearanceCountryFilterOptions"), false);
  assert.equal(appSource.includes("let clearanceStoreFilterOptions"), false);
  assert.equal(appSource.includes("let clearanceOwnerFilterOptions"), false);
  assert.equal(appSource.includes("const CLEARANCE_SAMPLE_ROWS"), false);
  assert.equal(appSource.includes("function buildClearanceResults"), false);
  assert.equal(appSource.includes("function populateClearanceStoreOptions"), false);
  assert.equal(clearanceSource.includes("fetch(`/api/dashboard/clearance-inventory"), false);
  assert.equal(clearanceSource.includes("setButtonBusy("), false);

  assert.equal(appSource.includes("const KNOWLEDGE_CATEGORIES"), false);
  assert.equal(appSource.includes("const KNOWLEDGE_BUILT_IN_DOCUMENTS"), false);
  assert.equal(appSource.includes("let knowledgeDocuments"), false);
  assert.equal(appSource.includes("let knowledgeBrowserState"), false);
  assert.equal(appSource.includes("let knowledgeExpandedCategories"), false);
  assert.equal(appSource.includes("function knowledgeCategoryName"), false);
  assert.equal(appSource.includes("function renderKnowledgeLibrary"), false);
  assert.equal(appSource.includes("function handleKnowledgeSidebarTreeClick"), false);
  assert.equal(appSource.includes("async function submitKnowledgeDocumentForm"), false);
  assert.equal(appSource.includes("async function deleteKnowledgeDocument"), false);
  assert.equal(knowledgeSource.includes("fetch(\"/api/knowledge"), false);
  assert.equal(knowledgeSource.includes("bind(document, \"#knowledge"), false);

  assert.equal(appSource.includes("const AI_WORKFLOW_STORAGE_KEY"), false);
  assert.equal(appSource.includes("let currentAiImageWorkflow"), false);
  assert.equal(appSource.includes("let currentAiListingCopy"), false);
  assert.equal(appSource.includes("let currentAiProductImages"), false);
  assert.equal(appSource.includes("const aiProductLineTemplates"), false);
  assert.equal(appSource.includes("function buildAiImageWorkflow"), false);
  assert.equal(appSource.includes("async function generateAiImageWorkflow"), false);
  assert.equal(appSource.includes("function renderAiListingCopy"), false);
  assert.equal(appSource.includes("function setupAiImageWorkflow"), false);
  assert.equal(aiImageWorkflowSource.includes("fetch(\"/api/ai/listing-copy"), false);
  assert.equal(aiImageWorkflowSource.includes("bind(document, \"#ai"), false);

  assert.equal(appSource.includes("let budgetTargetRows"), false);
  assert.equal(appSource.includes("let budgetMskuRows"), false);
  assert.equal(appSource.includes("let selectedBudgetMonths"), false);
  assert.equal(appSource.includes("function renderBudgetUploads"), false);
  assert.equal(appSource.includes("function renderBudgetTargets"), false);
  assert.equal(appSource.includes("async function loadBudgetUploads"), false);
  assert.equal(appSource.includes("async function loadBudgetTargets"), false);
  assert.equal(appSource.includes("async function uploadBudgetTemplate"), false);
  assert.equal(appSource.includes("function defaultBudgetUploadMonth"), false);
  assert.equal(budgetTargetsSource.includes("bind(document, \"#budget"), false);

  assert.equal(appSource.includes("function renderAdminOverview"), false);
  assert.equal(appSource.includes("function renderAdminAccounts"), false);
  assert.equal(appSource.includes("function resetAdminAccountForm"), false);
  assert.equal(appSource.includes("async function submitAdminAccountForm"), false);
  assert.equal(appSource.includes("function renderDingtalkAuthUsers"), false);
  assert.equal(appSource.includes("async function loadDingtalkAuthUsers"), false);
  assert.equal(appSource.includes("async function loadAdminOverview"), false);
  assert.equal(appSource.includes("let adminAccountRows"), false);
  assert.equal(adminSettingsSource.includes("bind(document, \"#admin"), false);
  assert.equal(adminSettingsSource.includes("bind(document, \"#dingtalk"), false);
  assert.equal(appSource.includes("function renderWebhookTasks"), false);
  assert.equal(appSource.includes("async function loadWebhookTasks"), false);
  assert.equal(webhookAssistantFeatureSource.includes("bind(document, \"#webhook"), false);

  assert.equal(appSource.includes("function formatSidebarSyncTime"), false);
  assert.equal(appSource.includes("function renderSyncStatus"), false);
  assert.equal(appSource.includes("function renderLingxingShops"), false);
  assert.equal(appSource.includes("async function loadSyncStatus"), false);
  assert.equal(appSource.includes("async function loadHealthStatus"), false);
  assert.equal(appSource.includes("async function loadLingxingShops"), false);
  assert.equal(appSource.includes("async function triggerManualSync"), false);
  assert.equal(syncCenterSource.includes("fetch(\"/api/sync/status"), false);
  assert.equal(syncCenterSource.includes("fetch(\"/api/health"), false);
  assert.equal(syncCenterSource.includes("fetch(\"/api/lingxing/shops"), false);

  assert.equal(appSource.includes("let fbaFreightRows"), false);
  assert.equal(appSource.includes("function fbaValue"), false);
  assert.equal(appSource.includes("let fbaFreightLoaded"), false);
  assert.equal(appSource.includes("let fbaFreightTemplates"), false);
  assert.equal(appSource.includes("let selectedFbaFreightShipmentIds"), false);
  assert.equal(appSource.includes("let pendingFbaFreightConvertShipmentIds"), false);
  assert.equal(appSource.includes("async function loadFbaFreightInitial"), false);
  assert.equal(appSource.includes("async function loadFbaFreightShipments"), false);
  assert.equal(appSource.includes("function renderFbaFreightRows"), false);
  assert.equal(appSource.includes("function openFbaFreightTemplateModal"), false);
  assert.equal(appSource.includes("function convertFbaFreightWorkbook"), false);
  assert.equal(fbaFreightSource.includes("bind(document, \"#fba-freight"), false);

  assert.equal(appSource.includes("let fbaShops"), false);
  assert.equal(appSource.includes("let selectedFbaShopSids"), false);
  assert.equal(appSource.includes("const fallbackFbaShops"), false);
  assert.equal(appSource.includes("const fallbackFbaAddresses"), false);
  assert.equal(appSource.includes("function normalizeFbaShop"), false);
  assert.equal(appSource.includes("function populateFbaShopSelect"), false);
  assert.equal(appSource.includes("function renderFbaShopOptions"), false);
  assert.equal(appSource.includes("function updateFbaShopButton"), false);
  assert.equal(fbaShopsSource.includes("bind(document, \"#fba-shop"), false);

  assert.equal(appSource.includes("let fbaMskuOptions"), false);
  assert.equal(appSource.includes("let fbaMskuLoadTimer"), false);
  assert.equal(appSource.includes("let fbaMskuLoading"), false);
  assert.equal(appSource.includes("let fbaLastMskuLoadKey"), false);
  assert.equal(appSource.includes("const fbaWarehousePrefixGroups"), false);
  assert.equal(appSource.includes("function filterLocalFbaMskus"), false);
  assert.equal(appSource.includes("function renderFbaMskuSuggestions"), false);
  assert.equal(appSource.includes("function getFbaMskuLoadKey"), false);
  assert.equal(appSource.includes("function syncFbaBoxSpecFields"), false);
  assert.equal(fbaMskuSource.includes("bind(document, \"#fba-msku"), false);

  assert.equal(appSource.includes("let fbaAutomationState"), false);
  assert.equal(appSource.includes("let fbaTaskFilter"), false);
  assert.equal(appSource.includes("let fbaTaskSearch"), false);
  assert.equal(appSource.includes("let fbaHistoryPage"), false);
  assert.equal(appSource.includes("const FBA_AUTOMATION_CACHE_KEY"), false);
  assert.equal(appSource.includes("function getFbaTaskBucket"), false);
  assert.equal(appSource.includes("function renderFbaTaskBoard"), false);
  assert.equal(appSource.includes("function readCachedFbaAutomationState"), false);
  assert.equal(appSource.includes("function renderFbaResultHistory"), false);
  assert.equal(fbaAutomationSource.includes("bind(document, \"#fba-"), false);

  assert.equal(appSource.includes("let editingFbaTaskId"), false);
  assert.equal(appSource.includes("function saveFbaBoxTemplateIfNeeded"), false);
  assert.equal(appSource.includes("function defaultFbaShipDate"), false);
  assert.equal(appSource.includes("function syncFbaDeliveryDate"), false);
  assert.equal(appSource.includes("function setFbaInputValue"), false);
  assert.equal(appSource.includes("function setFbaNotificationPolicy"), false);
  assert.equal(appSource.includes("function normalizeFbaShippingModeForForm"), false);
  assert.equal(appSource.includes("function resetFbaTaskForm"), false);
  assert.equal(appSource.includes("function fillFbaTaskForm"), false);
  assert.equal(appSource.includes("function openFbaTaskModal"), false);
  assert.equal(appSource.includes("function closeFbaTaskModal"), false);
  assert.equal(appSource.includes("function validateFbaPayload"), false);
  assert.equal(appSource.includes("function getFbaNotificationPolicy"), false);
  assert.equal(appSource.includes("async function createFbaTask"), false);
  assert.equal(appSource.includes("async function updateFbaTask"), false);
  assert.equal(appSource.includes("async function runFbaTask"), false);
  assert.equal(appSource.includes("async function deleteFbaTask"), false);
  assert.equal(appSource.includes("function buildFbaPayload"), false);
  assert.equal(appSource.includes("async function runFbaWarehouseProbe"), false);
  assert.equal(fbaTaskFormSource.includes("bind(document, \"#fba-"), false);

  assert.match(cashflowLoadSource, /loadDashboardSection\(\{/);
  assert.equal(cashflowSource.includes("fetch(`/api/dashboard/platform-cashflow"), false);
  assert.equal(cashflowLoadSource.includes("fetch(`/api/dashboard/platform-cashflow"), false);
  assert.equal(cashflowSource.includes("setButtonBusy("), false);
  assert.equal(cashflowLoadSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes('bind(document, "#cashflow'), false);
  assert.match(cashflowFeatureSource, /bind\(root, "#cashflow-refresh-button", "click"/);
  assert.match(cashflowFeatureSource, /bind\(root, "#cashflow-capture-button", "click"/);

  assert.match(lowFeeLoadSource, /loadDashboardSection\(\{/);
  assert.equal(lowFeeSource.includes("fetch(`/api/dashboard/low-inventory-fee"), false);
  assert.equal(lowFeeLoadSource.includes("fetch(`/api/dashboard/low-inventory-fee"), false);
  assert.equal(lowFeeSource.includes("setButtonBusy("), false);
  assert.equal(lowFeeLoadSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes('bind(document, "#lowfee'), false);
  assert.match(lowFeeFeatureSource, /bind\(root, "#lowfee-refresh", "click"/);
  assert.match(lowFeeFeatureSource, /bind\(root, "#lowfee-keyword", "keydown"/);

  assert.match(inventoryProvisionLoadSource, /loadDashboardSection\(\{/);
  assert.equal(inventoryProvisionSource.includes("fetch(`/api/dashboard/inventory-provision"), false);
  assert.equal(inventoryProvisionLoadSource.includes("fetch(`/api/dashboard/inventory-provision"), false);
  assert.equal(inventoryProvisionSource.includes("setButtonBusy("), false);
  assert.equal(inventoryProvisionLoadSource.includes("setButtonBusy("), false);
  assert.equal(appSource.includes('bind(document, "#inventory-provision'), false);
  assert.match(inventoryProvisionFeatureSource, /bind\(root, "#inventory-provision-refresh", "click"/);
  assert.match(inventoryProvisionFeatureSource, /bind\(root, "#inventory-provision-keyword", "keydown"/);
});

test("shared filter controls live outside app.js", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const filterControlsSource = await readFile(new URL("../assets/js/filter-controls.js", import.meta.url), "utf8");

  assert.match(appSource, /import \{ createFilterControls \} from "\.\/assets\/js\/filter-controls\.js/);
  assert.match(appSource, /createFilterControls\(\{/);
  assert.match(filterControlsSource, /export function createFilterControls\(/);
  assert.match(filterControlsSource, /function syncAllOptionSelection\(select\)/);
  assert.match(filterControlsSource, /function selectedFilterLabels\(select\)/);
  assert.match(filterControlsSource, /function updateFilterDropdownButton\(select\)/);
  assert.match(filterControlsSource, /function handleFilterDropdownOptionChange\(select, input\)/);
  assert.match(filterControlsSource, /function createFilterDropdown\(select\)/);
  assert.match(filterControlsSource, /function renderFilterDropdown\(select\)/);
  assert.match(filterControlsSource, /function initializeFilterDropdowns\(\)/);
  assert.match(filterControlsSource, /function setSelectOptions\(selectorOrElement, options = \[\]/);
  assert.match(filterControlsSource, /return \{[\s\S]*setSelectOptions[\s\S]*syncAllOptionSelection[\s\S]*\}/);

  [
    "function syncAllOptionSelection(select)",
    "function selectedFilterLabels(select)",
    "function updateFilterDropdownButton(select)",
    "function handleFilterDropdownOptionChange(select, input)",
    "function createFilterDropdown(select)",
    "function renderFilterDropdown(select)",
    "function initializeFilterDropdowns()",
    "function setSelectOptions(selectorOrElement",
  ].forEach((signature) => {
    assert.equal(appSource.includes(signature), false, `${signature} should be owned by assets/js/filter-controls.js`);
  });
});

test("sales shell centralizes sales toolbar visibility state", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../assets/js/sales-shell.js", import.meta.url), "utf8");
  const helperMatch = source.match(/function syncSalesToolbarVisibility\(viewOrActive\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, "missing syncSalesToolbarVisibility helper");
  assert.match(helperMatch[0], /setElementsHidden\("#sales-global-filters", !salesActive, root\)/);

  assert.equal(appSource.includes("function syncSalesToolbarVisibility"), false);
  assert.equal(appSource.includes('bind(document, "#refresh-button"'), false);
  assert.equal(source.includes("#refresh-button"), false);
  assert.equal(source.includes('const salesFilters = document.querySelector("#sales-global-filters");'), false);
});

test("auth shell centralizes role-based visibility toggles", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../assets/js/features/auth-shell.js", import.meta.url), "utf8");
  const helperMatch = source.match(/function syncPermissionVisibility\(\{ canEnterAdmin, canEnterFinance \}\) \{[\s\S]*?\n  \}/);
  assert.ok(helperMatch, "missing syncPermissionVisibility helper");
  assert.match(helperMatch[0], /setElementsHidden\(adminNav, !canEnterAdmin, root\)/);
  assert.match(helperMatch[0], /setElementsHidden\(financeGroups, !canEnterFinance, root\)/);
  assert.match(helperMatch[0], /setElementsHidden\(financeCards, !canEnterFinance, root\)/);

  assert.equal(source.includes("adminNav.hidden = !canEnterAdmin"), false);
  assert.equal(source.includes("group.hidden = !canEnterFinance"), false);
  assert.equal(source.includes("card.hidden = !canEnterFinance"), false);
  assert.equal(appSource.includes("function syncPermissionVisibility"), false);
});

test("app.js centralizes FBA floating panel visibility", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const fbaShopsFeatureSource = await readFile(new URL("../assets/js/features/fba-shops.js", import.meta.url), "utf8");
  const fbaMskuFeatureSource = await readFile(new URL("../assets/js/features/fba-msku.js", import.meta.url), "utf8");

  assert.match(fbaShopsFeatureSource, /function setFbaShopMenuOpen\(open\) \{[\s\S]*?setElementsHidden\("#fba-shop-menu", !open, root\)/);
  assert.match(fbaMskuFeatureSource, /function setFbaMskuSuggestionsOpen\(open\) \{[\s\S]*?setElementsHidden\("#fba-msku-suggest", !open, root\)/);
  assert.match(fbaShopsFeatureSource, /bind\(root, "#fba-shop-button", "click", toggleFbaShopMenu\)/);
  assert.match(source, /setupFbaShopPicker\(\)/);
  assert.match(source, /setupFbaMskuPicker\(\)/);

  assert.equal(source.includes('const shopMenu = document.querySelector("#fba-shop-menu");'), false);
  assert.equal(source.includes("shopMenu.hidden = true"), false);
  assert.equal(source.includes("if (menu) menu.hidden = true"), false);
  assert.equal(source.includes("if (menu) menu.hidden = !menu.hidden"), false);
});

test("sales shell centralizes front date popover visibility", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../assets/js/sales-shell.js", import.meta.url), "utf8");
  assert.match(source, /function setFrontDatePopoverOpen\(open\) \{[\s\S]*?setElementsHidden\(popover, !open\)/);
  assert.match(source, /function toggleFrontDatePopover\(\) \{[\s\S]*?setFrontDatePopoverOpen\(popover.hidden\)/);
  assert.match(source, /function setupFrontDateRangeControls\(\) \{[\s\S]*?bind\(root, "#front-date-range-button", "click", toggleFrontDatePopover\)/);
  assert.equal(appSource.includes('bind(document, "#front-date-range-button"'), false);
  assert.equal(appSource.includes('bindAll(document, "[data-range-preset]"'), false);
  assert.equal(appSource.includes('bind(document, "#front-date-apply"'), false);

  assert.equal(appSource.includes("function setFrontDatePopoverOpen"), false);
  assert.equal(appSource.includes("function toggleFrontDatePopover"), false);
  assert.equal(source.includes("popover.hidden = true"), false);
  assert.equal(source.includes("popover.hidden = !popover.hidden"), false);
});

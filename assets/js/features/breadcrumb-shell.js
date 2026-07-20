export function createBreadcrumbShellFeature({
  root = globalThis.document,
  bindEventTarget,
  clickVisibleNavItem,
  closestTarget,
  escapeHtml,
  expandSidebarGroup,
  setExpandedClassState,
} = {}) {
  if (typeof bindEventTarget !== "function") throw new Error("createBreadcrumbShellFeature requires bindEventTarget.");
  if (typeof clickVisibleNavItem !== "function") throw new Error("createBreadcrumbShellFeature requires clickVisibleNavItem.");
  if (typeof closestTarget !== "function") throw new Error("createBreadcrumbShellFeature requires closestTarget.");
  if (typeof escapeHtml !== "function") throw new Error("createBreadcrumbShellFeature requires escapeHtml.");
  if (typeof expandSidebarGroup !== "function") throw new Error("createBreadcrumbShellFeature requires expandSidebarGroup.");
  if (typeof setExpandedClassState !== "function") throw new Error("createBreadcrumbShellFeature requires setExpandedClassState.");

  const viewBreadcrumbs = {
    home: ["首页"],
    sales: ["首页", "销售", "销售复盘"],
    pulse: ["首页", "销售", "即时表现"],
    "store-inspection": ["首页", "销售", "店铺巡检"],
    ads: ["首页", "销售", "广告复盘"],
    budget: ["首页", "销售", "预算目标"],
    purchase: ["首页", "销售", "销售预估"],
    "review-rating": ["首页", "工具", "review计算"],
    clearance: ["首页", "销售", "动销预警"],
    "ai-image-workflow": ["首页", "工具", "AI图片工作流"],
    "fba-freight": ["首页", "工具", "货代表格"],
    fba: ["首页", "工具", "FBA刷仓"],
    "product-progress": ["首页", "产品", "产品进度"],
    aftersales: ["首页", "产品", "售后数据"],
    "aftersales-mail": ["首页", "售后", "站外售后邮箱"],
    certificates: ["首页", "产品", "证书有效期"],
    "product-design": ["首页", "产品", "产品设计需求"],
    lowfee: ["首页", "库存", "低库存费"],
    provision: ["首页", "库存", "库存计提"],
    "supplier-board": ["首页", "采购", "供应商看板"],
    "factory-inventory": ["首页", "库存", "工厂库存"],
    "supplier-detail": ["首页", "采购", "供应商明细"],
    payables: ["首页", "采购", "应付账款"],
    cashflow: ["首页", "财务", "平台回款"],
    guide: ["首页", "知识库"],
    admin: ["首页", "设置", "后台管理"],
    "webhook-assistant": ["首页", "设置", "Webhook 助手"],
    sync: ["首页", "设置", "同步中心"],
  };

  const breadcrumbGroups = new Set(["销售", "工具", "产品", "库存", "采购", "财务", "知识库", "设置"]);

  function renderBreadcrumbMarkup(parts = []) {
    return `<ol>${parts
      .map((part, index) => {
        const isCurrent = index === parts.length - 1;
        const label = escapeHtml(part);
        const homeAction = index === 0 ? ' data-breadcrumb-target="home"' : "";
        const groupAction = !isCurrent && breadcrumbGroups.has(part) ? ` data-breadcrumb-group="${label}"` : "";
        const action = homeAction || groupAction;
        const content = isCurrent || !action
          ? `<span class="module-breadcrumb-current" aria-current="page">${label}</span>`
          : `<button type="button"${action}>${index === 0 ? '<span class="breadcrumb-home-dot" aria-hidden="true"></span>' : ""}<span>${label}</span></button>`;
        return `<li>${content}</li>`;
      })
      .join('<li class="module-breadcrumb-separator" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></li>')}</ol>`;
  }

  function renderTopbarBreadcrumb(view = "home") {
    const breadcrumb = root?.querySelector?.("#topbar-breadcrumb");
    if (!breadcrumb) return;
    const parts = viewBreadcrumbs[view] || viewBreadcrumbs.home;
    breadcrumb.innerHTML = renderBreadcrumbMarkup(parts);
  }

  function applyModuleBreadcrumbs() {
    Object.entries(viewBreadcrumbs).forEach(([view, parts]) => {
      if (view === "home") return;
      const viewRoot = root?.querySelector?.(`#view-${view}`);
      const hero = viewRoot?.querySelector(":scope > .module-hero") || viewRoot?.querySelector(".module-hero");
      if (!hero) return;
      const intro = hero.querySelector(":scope > div:first-child");
      const oldEyebrow = intro?.querySelector(":scope > span");
      if (oldEyebrow) oldEyebrow.classList.add("module-eyebrow");
      let breadcrumb = hero.querySelector(".module-breadcrumb");
      if (!breadcrumb) {
        breadcrumb = root.createElement("nav");
        breadcrumb.className = "module-breadcrumb";
        breadcrumb.setAttribute("aria-label", "页面路径");
      }
      if (intro && breadcrumb.parentElement !== intro) intro.prepend(breadcrumb);
      breadcrumb.innerHTML = renderBreadcrumbMarkup(parts);
    });
  }

  function setupBreadcrumbNavigation() {
    bindEventTarget(root, "click", (event) => {
      const button = closestTarget(event, "[data-breadcrumb-target]");
      if (button) {
        clickVisibleNavItem(button.dataset.breadcrumbTarget);
        return;
      }
      const groupButton = closestTarget(event, "[data-breadcrumb-group]");
      if (!groupButton) return;
      event.stopPropagation();
      const groupName = groupButton.dataset.breadcrumbGroup;
      const group = [...(root?.querySelectorAll?.(".nav-group") || [])]
        .find((item) => item.getAttribute("aria-label") === groupName);
      if (!group || group.hidden) return;
      const shell = root?.querySelector?.(".app-shell");
      if (shell?.classList.contains("sidebar-collapsed")) {
        expandSidebarGroup(group);
        return;
      }
      root?.querySelectorAll?.(".nav-group").forEach((item) => {
        const isCurrent = item === group;
        setExpandedClassState(item, item.querySelector(".nav-group-title"), isCurrent);
      });
    }, true);
  }

  return {
    applyModuleBreadcrumbs,
    renderTopbarBreadcrumb,
    setupBreadcrumbNavigation,
  };
}

const HOME_QUICK_LINKS_STORAGE_KEY = "tanjia:homeQuickLinks:v1";

const homeQuickLinkCatalog = [
  { target: "sales", group: "销售", title: "销售复盘", description: "收入、利润、广告与达成率" },
  { target: "pulse", group: "销售", title: "即时表现", description: "销量、广告、库存异动" },
  { target: "store-inspection", group: "销售", title: "店铺巡检", description: "feedback、review、买家之声与账户健康" },
  { target: "ads", group: "销售", title: "广告复盘", description: "广告组合与关键词" },
  { target: "budget", group: "销售", title: "预算目标", description: "店铺目标与完成度" },
  { target: "purchase", group: "销售", title: "销售预估", description: "库存天数与补货建议" },
  { target: "clearance", group: "销售", title: "动销预警", description: "毛利差额与清货建议" },
  { target: "review-rating", group: "工具", title: "review计算", description: "星级占比、目标分与补量" },
  { target: "ai-image-workflow", group: "工具", title: "AI图片工作流", description: "产品图与文案流程" },
  { target: "fba-freight", group: "物流", title: "FBA货件处理", description: "货代表格与领星发货单" },
  { target: "freight-rates", group: "物流", title: "运费看板", description: "每周承运商运费" },
  { target: "fba", group: "工具", title: "FBA刷仓", description: "仓库命中与自动任务" },
  { target: "product-progress", group: "产品", title: "产品进度", description: "开发状态与节点" },
  { target: "aftersales", group: "产品", title: "售后数据", description: "售后与退款趋势" },
  { target: "certificates", group: "产品", title: "证书有效期", description: "证书状态提醒" },
  { target: "product-design", group: "产品", title: "产品设计需求", description: "设计需求与跟进" },
  { target: "aftersales-mail", group: "售后", title: "站外售后邮箱", description: "JM售后邮件与AI回复建议" },
  { target: "lowfee", group: "库存", title: "低库存费", description: "费用风险与补货优先级" },
  { target: "provision", group: "库存", title: "库存计提", description: "库龄与计提风险" },
  { target: "supplier-board", group: "采购", title: "供应商看板", description: "销量、采购价与税点" },
  { target: "factory-inventory", group: "库存", title: "工厂库存", description: "采购单剩余库存" },
  { target: "supplier-detail", group: "采购", title: "供应商明细", description: "资质、账期与发票" },
  { target: "payables", group: "采购", title: "应付账款", description: "请款与账期状态" },
  { target: "cashflow", group: "财务", title: "平台回款", description: "待结算与回款预测", permission: "finance" },
  { target: "guide", group: "知识库", title: "知识库", description: "账号、数据与常用看板" },
  { target: "sync", group: "设置", title: "同步中心", description: "接口状态与同步记录" },
];

const defaultHomeQuickTargets = ["sales", "pulse", "store-inspection", "purchase", "clearance", "review-rating", "lowfee", "supplier-board", "cashflow", "sync"];

export function createHomeQuickLinksFeature({
  root = globalThis.document,
  applyAuthVisibility,
  bind,
  bindDelegated,
  canAccessFinance,
  clickVisibleNavItem,
  escapeHtml,
  getCurrentAuthUser = () => null,
  isVisibleElement,
  setDisclosureState,
} = {}) {
  const storage = root?.defaultView?.localStorage || globalThis.localStorage;
  let homeQuickConfig = loadHomeQuickConfig();

  function loadHomeQuickConfig() {
    try {
      const parsed = JSON.parse(storage.getItem(HOME_QUICK_LINKS_STORAGE_KEY) || "null");
      const order = Array.isArray(parsed?.order) ? parsed.order.filter(Boolean) : [...defaultHomeQuickTargets];
      const visible = Array.isArray(parsed?.visible) ? parsed.visible.filter(Boolean) : [...defaultHomeQuickTargets];
      return { order, visible };
    } catch {
      return { order: [...defaultHomeQuickTargets], visible: [...defaultHomeQuickTargets] };
    }
  }

  function saveHomeQuickConfig() {
    storage.setItem(HOME_QUICK_LINKS_STORAGE_KEY, JSON.stringify(homeQuickConfig));
  }

  function availableHomeQuickLinks() {
    const currentAuthUser = getCurrentAuthUser();
    return homeQuickLinkCatalog.filter((item) => {
      if (item.permission === "finance") return currentAuthUser && canAccessFinance(currentAuthUser);
      const navButton = root?.querySelector?.(`.nav-item[data-view="${item.target}"]`);
      return isVisibleElement(navButton);
    });
  }

  function orderedHomeQuickLinks() {
    const availableLinks = availableHomeQuickLinks();
    const byTarget = new Map(availableLinks.map((item) => [item.target, item]));
    const targets = [...homeQuickConfig.order, ...availableLinks.map((item) => item.target)];
    const seen = new Set();
    return targets
      .filter((target) => {
        if (!byTarget.has(target) || seen.has(target)) return false;
        seen.add(target);
        return true;
      })
      .map((target) => byTarget.get(target));
  }

  function visibleHomeQuickLinks() {
    const visibleTargets = new Set(homeQuickConfig.visible);
    return orderedHomeQuickLinks().filter((item) => visibleTargets.has(item.target));
  }

  function moveHomeQuickTarget(target, direction) {
    const orderedTargets = orderedHomeQuickLinks().map((item) => item.target);
    const fromIndex = orderedTargets.indexOf(target);
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= orderedTargets.length) return;
    const [moved] = orderedTargets.splice(fromIndex, 1);
    orderedTargets.splice(toIndex, 0, moved);
    homeQuickConfig.order = orderedTargets;
    saveHomeQuickConfig();
    renderHomeQuickLinks();
  }

  function renderHomeQuickLinks() {
    const grid = root?.querySelector?.("#home-quick-grid");
    const configPanel = root?.querySelector?.("#home-quick-config");
    const summary = root?.querySelector?.("#home-quick-summary");
    const allLinks = orderedHomeQuickLinks();
    const visibleLinks = visibleHomeQuickLinks();
    const visibleTargets = new Set(homeQuickConfig.visible);

    if (summary) summary.textContent = `已显示 ${visibleLinks.length} / ${allLinks.length} 个入口`;
    if (grid) {
      grid.innerHTML = visibleLinks.length
        ? visibleLinks.map((item) => `
          <button type="button" data-home-target="${escapeHtml(item.target)}"${item.permission ? ` data-permission-card="${escapeHtml(item.permission)}"` : ""}>
            <span>${escapeHtml(item.group)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.description)}</small>
          </button>
        `).join("")
        : `<div class="home-quick-empty">请在设置中选择快捷入口。</div>`;
    }
    if (configPanel) {
      configPanel.innerHTML = allLinks.map((item, index) => `
        <div class="home-quick-config-row">
          <label>
            <input type="checkbox" data-home-quick-visible="${escapeHtml(item.target)}" ${visibleTargets.has(item.target) ? "checked" : ""} />
            <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.group)}</small></span>
          </label>
          <div class="home-quick-order-actions">
            <button type="button" data-home-quick-move="up" data-home-quick-target="${escapeHtml(item.target)}" aria-label="上移 ${escapeHtml(item.title)}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-home-quick-move="down" data-home-quick-target="${escapeHtml(item.target)}" aria-label="下移 ${escapeHtml(item.title)}" ${index === allLinks.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `).join("");
    }
    applyAuthVisibility(getCurrentAuthUser());
  }

  function setupHomeQuickLinks() {
    renderHomeQuickLinks();
    bind(root, "#home-quick-config-toggle", "click", () => {
      const panel = root?.querySelector?.("#home-quick-config");
      const toggle = root?.querySelector?.("#home-quick-config-toggle");
      if (!panel || !toggle) return;
      const opened = panel.hidden;
      setDisclosureState(panel, toggle, opened);
    });
    bindDelegated(root, "#home-quick-grid", "click", "[data-home-target]", (button) => {
      clickVisibleNavItem(button.dataset.homeTarget);
    });
    bindDelegated(root, "#home-quick-config", "change", "[data-home-quick-visible]", (checkbox) => {
      const target = checkbox.dataset.homeQuickVisible;
      const visibleTargets = new Set(homeQuickConfig.visible);
      if (checkbox.checked) {
        visibleTargets.add(target);
      } else {
        visibleTargets.delete(target);
      }
      homeQuickConfig.visible = Array.from(visibleTargets);
      saveHomeQuickConfig();
      renderHomeQuickLinks();
    });
    bindDelegated(root, "#home-quick-config", "click", "[data-home-quick-move]", (button) => {
      moveHomeQuickTarget(button.dataset.homeQuickTarget, button.dataset.homeQuickMove);
    });
  }

  return {
    renderHomeQuickLinks,
    setupHomeQuickLinks,
  };
}

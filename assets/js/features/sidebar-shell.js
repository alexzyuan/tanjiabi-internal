export function createSidebarShellFeature({
  root = globalThis.document,
  windowObj = globalThis,
  bind,
  bindClickOutside,
  bindEventTarget,
  closestTarget,
  isVisibleElement,
  normalizeText,
  setAriaExpanded,
  setDisclosureState,
  setExpandedClassState,
} = {}) {
  if (typeof bind !== "function") throw new Error("createSidebarShellFeature requires bind.");
  if (typeof bindClickOutside !== "function") throw new Error("createSidebarShellFeature requires bindClickOutside.");
  if (typeof bindEventTarget !== "function") throw new Error("createSidebarShellFeature requires bindEventTarget.");

  function syncSidebarToggleState(collapsed) {
    const toggle = root?.querySelector?.("#sidebar-toggle");
    if (!toggle) return;
    setAriaExpanded(toggle, !collapsed);
    toggle.title = collapsed ? "展开侧边栏" : "折叠侧边栏";
    toggle.textContent = collapsed ? "›" : "‹";
  }

  function hideSidebarFlyout() {
    const flyout = root?.querySelector?.("#sidebar-flyout");
    if (flyout) flyout.hidden = true;
    root?.querySelectorAll?.(".nav-group.is-flyout-open").forEach((group) => {
      group.classList.remove("is-flyout-open");
      setAriaExpanded(group.querySelector(".nav-group-title"), false);
    });
  }

  function collapseSidebar() {
    const shell = root?.querySelector?.(".app-shell");
    if (!shell || shell.classList.contains("sidebar-collapsed")) return;
    shell.classList.add("sidebar-collapsed");
    windowObj.__tanjiaHideSidebarFlyout?.();
    syncSidebarToggleState(true);
  }

  function showSidebarFlyout(group) {
    const shell = root?.querySelector?.(".app-shell");
    if (!shell || !group || !shell.classList.contains("sidebar-collapsed")) return false;
    const items = [...group.querySelectorAll(".nav-item[data-view]")]
      .filter(isVisibleElement);
    if (!items.length) return false;
    const title = group.querySelector(".nav-group-title");
    const rect = (title || group).getBoundingClientRect();
    const flyout = ensureSidebarFlyout();
    flyout.innerHTML = "";
    items.forEach((item) => {
      const button = root.createElement("button");
      button.type = "button";
      button.setAttribute("data-flyout-view", item.getAttribute("data-view") || "");
      button.textContent = normalizeText((item.querySelector(".nav-label") || item).textContent);
      if (item.classList.contains("active")) button.classList.add("active");
      flyout.appendChild(button);
    });
    hideSidebarFlyout();
    group.classList.add("is-flyout-open");
    setDisclosureState(flyout, title, true);
    const top = Math.max(8, Math.min(rect.top - 4, windowObj.innerHeight - flyout.offsetHeight - 8));
    flyout.style.top = `${top}px`;
    flyout.style.left = `${rect.right + 12}px`;
    return true;
  }

  function expandSidebarGroup(group) {
    const shell = root?.querySelector?.(".app-shell");
    if (!shell || !group || !shell.classList.contains("sidebar-collapsed")) return false;
    if (windowObj.__tanjiaShowSidebarFlyout?.(group)) return true;
    shell.classList.remove("sidebar-collapsed");
    root?.querySelectorAll?.(".nav-group").forEach((item) => {
      const itemButton = item.querySelector(".nav-group-title");
      const isCurrent = item === group;
      setExpandedClassState(item, itemButton, isCurrent);
    });
    syncSidebarToggleState(false);
    return true;
  }

  function findSidebarNavButton(view) {
    return [...(root?.querySelectorAll?.(".nav-item[data-view]") || [])]
      .find((button) => button.getAttribute("data-view") === view) || null;
  }

  function bindSidebarFlyoutClick(flyout) {
    if (!flyout || flyout.dataset.tanjiaAppFlyoutBound === "true") return;
    flyout.dataset.tanjiaAppFlyoutBound = "true";
    bindEventTarget(flyout, "click", (event) => {
      const button = closestTarget(event, "[data-flyout-view]");
      if (!button || !flyout.contains(button)) return;
      event.stopPropagation();
      const original = findSidebarNavButton(button.getAttribute("data-flyout-view"));
      if (original) original.click();
      hideSidebarFlyout();
    });
  }

  function ensureSidebarFlyout() {
    let flyout = root?.querySelector?.("#sidebar-flyout");
    if (!flyout) {
      flyout = root.createElement("div");
      flyout.id = "sidebar-flyout";
      flyout.className = "sidebar-flyout";
      flyout.hidden = true;
      root.body?.appendChild(flyout);
    }
    bindSidebarFlyoutClick(flyout);
    return flyout;
  }

  function setupSidebarFlyout() {
    if (windowObj.__tanjiaSidebarFlyoutReady) return;
    windowObj.__tanjiaSidebarFlyoutReady = true;
    windowObj.__tanjiaShowSidebarFlyout = showSidebarFlyout;
    windowObj.__tanjiaHideSidebarFlyout = hideSidebarFlyout;
    bindClickOutside(root, "#sidebar-flyout", (event) => {
      const flyout = root?.querySelector?.("#sidebar-flyout");
      if (!flyout || flyout.hidden) return;
      if (closestTarget(event, ".nav-group-title")) return;
      hideSidebarFlyout();
    });
    bindEventTarget(root, "keydown", (event) => {
      if (event.key === "Escape") hideSidebarFlyout();
    });
  }

  function setupSidebarHoverFeedback() {
    if (windowObj.__tanjiaSidebarHoverFeedbackReady) return;
    windowObj.__tanjiaSidebarHoverFeedbackReady = true;
    bindEventTarget(root, "mouseover", (event) => {
      const title = closestTarget(event, ".nav-group-title");
      const group = title?.closest(".nav-group");
      const shell = root?.querySelector?.(".app-shell");
      if (!group || !shell?.classList.contains("sidebar-collapsed")) return;
      group.classList.add("is-hovered");
    });
    bindEventTarget(root, "mouseout", (event) => {
      const title = closestTarget(event, ".nav-group-title");
      const group = title?.closest(".nav-group");
      if (!group) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && group.contains(nextTarget)) return;
      if (!group.classList.contains("is-flyout-open")) group.classList.remove("is-hovered");
    });
    bindClickOutside(root, ".nav-group-title", () => {
      root?.querySelectorAll?.(".nav-group.is-hovered:not(.is-flyout-open)").forEach((group) => {
        group.classList.remove("is-hovered");
      });
    });
  }

  function setupSidebarShell() {
    setupSidebarFlyout();
    setupSidebarHoverFeedback();
    bind(root, "#sidebar-toggle", "click", () => {
      const shell = root?.querySelector?.(".app-shell");
      windowObj.__tanjiaHideSidebarFlyout?.();
      shell?.classList.toggle("sidebar-collapsed");
      const collapsed = shell?.classList.contains("sidebar-collapsed");
      syncSidebarToggleState(Boolean(collapsed));
    });
    if (!windowObj.__tanjiaSidebarOutsideCollapseReady) {
      windowObj.__tanjiaSidebarOutsideCollapseReady = true;
      bindClickOutside(root, ".sidebar", () => {
        const shell = root?.querySelector?.(".app-shell");
        if (!shell || shell.classList.contains("sidebar-collapsed")) return;
        collapseSidebar();
      });
    }
  }

  return {
    collapseSidebar,
    expandSidebarGroup,
    hideSidebarFlyout,
    setupSidebarShell,
  };
}

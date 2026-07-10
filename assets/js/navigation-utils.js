export function createNavigationUtils({
  root = globalThis.document,
  bind,
  bindEventTarget,
  closestTarget,
  clickVisibleElement,
  global = globalThis,
  setExpandedClassState,
} = {}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new Error("createNavigationUtils requires a root with querySelector.");
  }
  if (typeof root.querySelectorAll !== "function") {
    throw new Error("createNavigationUtils requires a root with querySelectorAll.");
  }
  if (typeof bind !== "function") {
    throw new Error("createNavigationUtils requires bind.");
  }
  if (typeof bindEventTarget !== "function") {
    throw new Error("createNavigationUtils requires bindEventTarget.");
  }
  if (typeof closestTarget !== "function") {
    throw new Error("createNavigationUtils requires closestTarget.");
  }
  if (typeof clickVisibleElement !== "function") {
    throw new Error("createNavigationUtils requires clickVisibleElement.");
  }
  if (typeof setExpandedClassState !== "function") {
    throw new Error("createNavigationUtils requires setExpandedClassState.");
  }

  function clickVisibleNavItem(target) {
    if (!target) return null;
    return clickVisibleElement(root.querySelector(`.nav-item[data-view="${target}"]`));
  }

  function updateNavGroupActiveStates() {
    root.querySelectorAll(".nav-group").forEach((group) => {
      group.classList.toggle("is-active", Boolean(group.querySelector(".nav-item.active")));
    });
  }

  function setupNavClickBinding(onNavItem) {
    if (typeof onNavItem !== "function") throw new Error("setupNavClickBinding requires onNavItem.");
    if (global.__tanjiaAppNavigationReady) return null;
    global.__tanjiaAppNavigationReady = true;
    return bind(root, ".nav", "click", (event) => {
      const button = closestTarget(event, ".nav-item[data-view]");
      if (!button || !event.currentTarget.contains(button)) return;
      onNavItem(button, event);
    });
  }

  function setupNavGroupTitleBinding() {
    if (global.__tanjiaNavigationGroupsReady) return [];
    global.__tanjiaNavigationGroupsReady = true;
    return Array.from(root.querySelectorAll(".nav-group-title")).map((button) => bindEventTarget(button, "click", () => {
      const group = button.closest(".nav-group");
      if (!group) return;
      if (root.querySelector(".app-shell")?.classList.contains("sidebar-collapsed")) {
        global.__tanjiaShowSidebarFlyout?.(group);
        return;
      }
      setExpandedClassState(group, button, !group.classList.contains("is-open"));
    }));
  }

  return {
    clickVisibleNavItem,
    setupNavClickBinding,
    setupNavGroupTitleBinding,
    updateNavGroupActiveStates,
  };
}

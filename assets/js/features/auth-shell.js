export const ACCESS_ROLES = ["子账号", "主账号", "系统管理员"];

export function normalizeAccessRole(role, accessRoles = ACCESS_ROLES) {
  const value = String(role || "").trim();
  if (["财务", "主账户", "owner"].includes(value)) return "主账号";
  if (["系统管理员", "管理员", "admin"].includes(value)) return "系统管理员";
  if (["子账", "子账户", "sub"].includes(value)) return "子账号";
  return accessRoles.includes(value) ? value : "子账号";
}

export function canAccessFinance(user) {
  return ["主账号", "系统管理员"].includes(normalizeAccessRole(user?.role));
}

export function canManageAdminSettings(user) {
  return normalizeAccessRole(user?.role) === "系统管理员";
}

export function redirectToLogin(message = "登录状态已失效，请重新登录。", windowObj = globalThis.window) {
  const next = encodeURIComponent(windowObj.location.pathname + windowObj.location.search);
  windowObj.location.href = `/login?error=${encodeURIComponent(message)}&next=${next}`;
}

export function createAuthShellFeature({
  root = globalThis.document,
  windowObj = globalThis.window,
  bind,
  bindClickOutside,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  redirectToLogin: redirectToLoginImpl = redirectToLogin,
  setElementsHidden,
  setExpandedClassState,
  updateNavGroupActiveStates,
} = {}) {
  if (typeof bind !== "function") throw new Error("createAuthShellFeature requires bind.");
  if (typeof bindClickOutside !== "function") throw new Error("createAuthShellFeature requires bindClickOutside.");
  if (typeof escapeHtml !== "function") throw new Error("createAuthShellFeature requires escapeHtml.");
  if (typeof fetchImpl !== "function") throw new Error("createAuthShellFeature requires fetch.");
  if (typeof setElementsHidden !== "function") throw new Error("createAuthShellFeature requires setElementsHidden.");
  if (typeof setExpandedClassState !== "function") throw new Error("createAuthShellFeature requires setExpandedClassState.");

  let currentAuthUser = null;

  function getCurrentAuthUser() {
    return currentAuthUser;
  }

  function moveToDefaultViewIfRestricted({ canEnterAdmin, canEnterFinance }) {
    const activeAdminNav = root?.querySelector?.('.nav-item[data-view="admin"].active, .nav-item[data-permission="admin"].active');
    const activeFinanceNav = root?.querySelector?.('.nav-group[data-permission="finance"] .nav-item.active');
    if ((!canEnterAdmin && activeAdminNav) || (!canEnterFinance && activeFinanceNav)) {
      root?.querySelector?.('.nav-item[data-view="home"]')?.click();
    }
  }

  function syncPermissionVisibility({ canEnterAdmin, canEnterFinance }) {
    const adminNav = root?.querySelectorAll?.('.nav-item[data-view="admin"], .nav-item[data-permission="admin"]') || [];
    const financeGroups = root?.querySelectorAll?.('.nav-group[data-permission="finance"]') || [];
    const financeCards = root?.querySelectorAll?.('[data-permission-card="finance"]') || [];
    setElementsHidden(adminNav, !canEnterAdmin, root);
    setElementsHidden(financeGroups, !canEnterFinance, root);
    setElementsHidden(financeCards, !canEnterFinance, root);
  }

  function applyAuthVisibility(user = currentAuthUser) {
    const canEnterAdmin = canManageAdminSettings(user);
    const canEnterFinance = canAccessFinance(user);
    syncPermissionVisibility({ canEnterAdmin, canEnterFinance });
    moveToDefaultViewIfRestricted({ canEnterAdmin, canEnterFinance });
    updateNavGroupActiveStates?.();
    return { canEnterAdmin, canEnterFinance };
  }

  async function loadAuthStatus({ redirectIfNeeded = false } = {}) {
    const chip = root?.querySelector?.("#auth-user-chip");
    const logoutButton = root?.querySelector?.("#logout-button");
    const accountMenu = root?.querySelector?.("#account-menu");
    try {
      const response = await fetchImpl("/api/auth/me");
      const data = await response.json();
      if (!data.enabled || !data.authenticated) {
        currentAuthUser = data.enabled ? null : { role: "系统管理员", displayName: "本地预览" };
        setElementsHidden([chip, logoutButton, accountMenu], true, root);
        applyAuthVisibility(currentAuthUser);
        if (redirectIfNeeded && data.enabled && !data.authenticated) {
          redirectToLoginImpl("登录状态已失效，请重新登录。", windowObj);
        }
        return data;
      }
      currentAuthUser = data.user || null;
      applyAuthVisibility(currentAuthUser);
      if (chip) {
        const displayName = data.user?.displayName || data.user?.nick || data.user?.username || "已登录";
        setElementsHidden(chip, false, root);
        chip.innerHTML = `
          <span class="account-avatar" aria-hidden="true"></span>
          <span class="account-name">${escapeHtml(displayName)}</span>
          <span class="account-caret" aria-hidden="true"></span>
        `;
        chip.setAttribute("aria-label", `${displayName}，打开账号菜单`);
      }
      setElementsHidden([accountMenu, logoutButton], false, root);
      return data;
    } catch {
      currentAuthUser = null;
      setElementsHidden([chip, logoutButton, accountMenu], true, root);
      applyAuthVisibility(null);
      if (redirectIfNeeded) redirectToLoginImpl("登录状态检查失败，请重新登录。", windowObj);
      return { enabled: true, authenticated: false };
    }
  }

  async function logout() {
    await fetchImpl("/api/auth/logout", { method: "POST" }).catch(() => null);
    windowObj.location.href = "/login";
  }

  function setupAuthShell() {
    bind(root, "#logout-button", "click", logout);
    bind(root, "#auth-user-chip", "click", (event) => {
      event.stopPropagation();
      const menu = root?.querySelector?.("#account-menu");
      if (!menu) return;
      setExpandedClassState(menu, "#auth-user-chip", !menu.classList.contains("is-open"), "is-open", root);
    });
    bindClickOutside(root, "#account-menu", () => {
      const menu = root?.querySelector?.("#account-menu");
      if (!menu || menu.hidden) return;
      setExpandedClassState(menu, "#auth-user-chip", false, "is-open", root);
    });
  }

  return {
    applyAuthVisibility,
    getCurrentAuthUser,
    loadAuthStatus,
    logout,
    setupAuthShell,
  };
}

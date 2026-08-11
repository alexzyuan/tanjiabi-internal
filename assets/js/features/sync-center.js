export function createSyncCenterFeature({
  root = globalThis.document,
  bind,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  getDisplayShopName,
  normalizeCountryName,
  pickSellerCountry,
  pickSellerName,
  populateFbaShopSelect,
  populateFrontShopFilters,
  redirectToLogin,
  renderTableMessage,
  renderTopbarSyncStatus,
  runningFromLocalFile = false,
  setButtonBusy,
  setExclusiveClassState,
  setStatusMessage = (selector, message, tone = "", targetRoot = root) => {
    const element = targetRoot?.querySelector?.(selector);
    if (!element) return null;
    element.textContent = message;
    element.classList?.toggle("status-danger", tone === "danger");
    element.classList?.toggle("status-success", tone === "success");
    return element;
  },
  setText,
  syncToneClasses = [],
} = {}) {
  if (typeof bind !== "function") throw new Error("createSyncCenterFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createSyncCenterFeature requires fetch.");

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function clearAftersalesMailPassword() {
    const password = query("#aftersales-mail-password");
    if (password) password.value = "";
  }

  function currentAftersalesMailPassword() {
    const value = query("#aftersales-mail-password")?.value;
    return typeof value === "string" && value ? value : "";
  }

  function setAftersalesMailStatus(message, tone = "") {
    setStatusMessage("#aftersales-mail-status", message, tone, root);
  }

  function renderAftersalesMailSettings(data = {}) {
    clearAftersalesMailPassword();
    const account = query("#aftersales-mail-account");
    if (account) account.value = data.account || "jmcustomer@163.com";
    const enabled = query("#aftersales-mail-enabled");
    if (enabled) enabled.checked = data.enabled === true;
    const summary = query("#aftersales-mail-summary");
    if (!summary) return;
    const lastTest = data.lastTest || {};
    const lastChange = data.lastChange || {};
    const changedAt = lastChange.changedAt || lastChange.at || "-";
    const changedBy = lastChange.actor ? ` · ${lastChange.actor}` : "";
    summary.innerHTML = `
      <div><strong>${data.passwordConfigured ? "授权码已配置" : "授权码未配置"}</strong><span>${escapeHtml(lastTest.message || "尚未测试")}</span></div>
      <div><strong>最近测试</strong><span>${escapeHtml(lastTest.checkedAt || "-")}</span></div>
      <div><strong>最近修改</strong><span>${escapeHtml(`${changedAt}${changedBy}`)}</span></div>
    `;
  }

  async function parseApiResponse(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    return data;
  }

  function formatSidebarSyncTime(value) {
    if (!value) return "暂无记录";
    const text = String(value);
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      const hour = String(parsed.getHours()).padStart(2, "0");
      const minute = String(parsed.getMinutes()).padStart(2, "0");
      return `${month}/${day} ${hour}:${minute}`;
    }
    const match = text.match(/(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (match) return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")} ${match[3].padStart(2, "0")}:${match[4]}`;
    return text.length > 12 ? text.slice(0, 12) : text;
  }

  function renderSyncStatus(sync = {}) {
    setText("#sync-interval", `${sync.intervalHours || 12} 小时`, root);
    setText("#sync-provider", sync.provider || "未连接", root);
    setText("#sync-last-success", sync.lastSuccessAt || "-", root);
    setText("#sync-running", sync.running ? "运行中" : "空闲", root);
    const sidebarCard = query("#sidebar-sync-card");
    const hasError = Boolean(sync.lastError) || String(sync.lastStatus || "").includes("失败") || sync.provider === "接口未连接";
    const hasSuccess = Boolean(sync.lastSuccessAt);
    const sidebarStatus = sync.running ? "同步中" : hasError ? "同步异常" : hasSuccess ? "同步成功" : "待同步";
    const sidebarTone = sync.running ? "sync-running" : hasError ? "sync-error" : hasSuccess ? "sync-success" : "sync-pending";
    const latestSyncTime = sync.lastSuccessAt || sync.lastFinishedAt || sync.lastStartedAt || "暂无记录";
    const formattedSyncTime = formatSidebarSyncTime(latestSyncTime);
    setText("#data-source", sidebarStatus, root);
    setText("#data-source-note", formattedSyncTime, root);
    renderTopbarSyncStatus(sidebarStatus, formattedSyncTime, sidebarTone);
    setText("#home-sync-state", sidebarStatus, root);
    setText("#home-sync-time", `最近同步：${formattedSyncTime}`, root);
    setExclusiveClassState(sidebarCard, syncToneClasses, sidebarTone);
    setExclusiveClassState(query("#home-sync-pill"), syncToneClasses, sidebarTone);

    const log = query("#sync-log");
    if (!log) return;
    log.innerHTML = `
      <div><strong>最近状态</strong><span>${escapeHtml(sync.lastStatus || "等待首次同步")}</span></div>
      <div><strong>最近开始</strong><span>${escapeHtml(sync.lastStartedAt || "-")}</span></div>
      <div><strong>最近结束</strong><span>${escapeHtml(sync.lastFinishedAt || "-")}</span></div>
      <div><strong>错误信息</strong><span>${escapeHtml(sync.lastError || "暂无错误")}</span></div>
    `;
  }

  function renderLingxingShops(data = {}) {
    const sellers = data.sellers || [];
    const table = query("#lingxing-shop-table");
    populateFrontShopFilters(sellers);
    populateFbaShopSelect(sellers);
    setText("#lingxing-shop-count", sellers.length ? `共 ${sellers.length} 个店铺，同步于 ${data.updatedAt || "-"}` : "暂无店铺缓存，请先手动同步", root);
    if (!table) return;

    if (!sellers.length) {
      renderTableMessage(table, 5, "暂无领星店铺数据，请点击上方“手动同步”。");
      return;
    }

    table.innerHTML = sellers
      .map((seller) => {
        const name = pickSellerName(seller);
        const country = normalizeCountryName(pickSellerCountry(seller));
        const status = seller.status === 0 ? "停用" : "启用";
        return `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(country)}</td>
            <td>${escapeHtml(seller.sid || seller.id || "-")}</td>
            <td>${escapeHtml(status)}</td>
            <td>${escapeHtml(getDisplayShopName(name, country))}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadSyncStatus() {
    try {
      const response = await fetchImpl("/api/sync/status");
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderSyncStatus(await response.json());
    } catch {
      renderSyncStatus({
        provider: "接口未连接",
        intervalHours: 12,
        lastStatus: runningFromLocalFile ? "当前是 file:// 本地页面，请打开 http://47.107.92.14/" : "无法连接服务器接口",
        running: false,
      });
    }
  }

  async function loadHealthStatus() {
    try {
      const response = await fetchImpl("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      if (data.sync) {
        renderSyncStatus(data.sync);
        return data;
      }
      renderSyncStatus({
        provider: data.provider || "接口未连接",
        intervalHours: 12,
        lastStatus: data.provider === "lingxing" ? "已连接领星 ERP 数据源" : "正在检查领星 ERP 数据源",
        running: false,
      });
      return data;
    } catch (error) {
      renderSyncStatus({
        provider: "接口未连接",
        intervalHours: 12,
        lastStatus: `健康检查失败：${error.message}`,
        running: false,
      });
      return null;
    }
  }

  async function loadLingxingShops() {
    try {
      const response = await fetchImpl("/api/lingxing/shops");
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderLingxingShops(await response.json());
    } catch (error) {
      const table = query("#lingxing-shop-table");
      if (table) renderTableMessage(table, 5, `读取失败：${error.message || error}`);
      setText("#lingxing-shop-count", `读取失败：${error.message || error}`, root);
    }
  }

  async function loadAftersalesMailSettings() {
    try {
      const response = await fetchImpl("/api/admin/aftersales-mail-config", { cache: "no-store" });
      renderAftersalesMailSettings(await parseApiResponse(response));
    } catch (error) {
      renderAftersalesMailSettings({});
      setAftersalesMailStatus(error.message || "售后邮箱设置读取失败", "danger");
    } finally {
      clearAftersalesMailPassword();
    }
  }

  async function testAftersalesMailSettings() {
    const password = currentAftersalesMailPassword();
    const payload = password ? { password } : {};
    try {
      const response = await fetchImpl("/api/admin/aftersales-mail-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse(response);
      if (data.ok === false) {
        setAftersalesMailStatus(data.message || "连接测试失败", "danger");
        return;
      }
      setAftersalesMailStatus(data.message || "连接测试成功。", "success");
      clearAftersalesMailPassword();
      await loadAftersalesMailSettings();
    } catch (error) {
      setAftersalesMailStatus(error.message || "连接测试失败", "danger");
    } finally {
      clearAftersalesMailPassword();
    }
  }

  async function saveAftersalesMailSettings(event) {
    event?.preventDefault?.();
    const password = currentAftersalesMailPassword();
    const payload = { enabled: query("#aftersales-mail-enabled")?.checked === true };
    if (password) payload.password = password;
    try {
      const response = await fetchImpl("/api/admin/aftersales-mail-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse(response);
      if (data.ok === false) {
        setAftersalesMailStatus(data.message || "设置保存失败", "danger");
        return;
      }
      setAftersalesMailStatus(data.message || "售后邮箱设置已保存。", "success");
      clearAftersalesMailPassword();
      await loadAftersalesMailSettings();
    } catch (error) {
      setAftersalesMailStatus(error.message || "设置保存失败", "danger");
    } finally {
      clearAftersalesMailPassword();
    }
  }

  async function triggerManualSync() {
    const button = query("#manual-sync-button");
    const restoreButton = setButtonBusy(button, "同步中", "手动同步", { disable: false });
    try {
      await fetchImpl("/api/sync/lingxing/manual", { method: "POST" });
      await loadSyncStatus();
      await loadLingxingShops();
    } finally {
      restoreButton();
    }
  }

  function setupSyncCenter() {
    bind(root, "#manual-sync-button", "click", triggerManualSync);
    bind(root, "#aftersales-mail-test", "click", testAftersalesMailSettings);
    bind(root, "#aftersales-mail-settings-form", "submit", saveAftersalesMailSettings);
  }

  return {
    loadAftersalesMailSettings,
    loadHealthStatus,
    loadLingxingShops,
    loadSyncStatus,
    renderLingxingShops,
    renderSyncStatus,
    saveAftersalesMailSettings,
    setupSyncCenter,
    testAftersalesMailSettings,
    triggerManualSync,
  };
}

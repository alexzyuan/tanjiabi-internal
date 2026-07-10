export function createAdminSettingsFeature({
  root = globalThis.document,
  accessRoles = [],
  beijingTimeZone = "Asia/Shanghai",
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
} = {}) {
  if (typeof bind !== "function") throw new Error("createAdminSettingsFeature requires bind.");

  let adminAccountEditingUsername = "";
  let adminAccountRows = [];

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function renderAdminOverview(data) {
    const users = query("#admin-users");
    const shops = query("#admin-shops");
    const targets = query("#admin-targets");
    if (!users || !shops || !targets) return;

    users.innerHTML = (data.users || [])
      .map((item) => `<div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.role)} · ${escapeHtml(item.scope)}</span></div>`)
      .join("");
    shops.innerHTML = (data.shops || [])
      .map((item) => `<div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.owner)} · ${escapeHtml(item.status)}</span></div>`)
      .join("");
    targets.innerHTML = (data.targets || [])
      .map((item) => `<div><strong>${escapeHtml(item.month)} · ${escapeHtml(item.scope)}</strong><span>销售目标 ${escapeHtml(item.salesTarget)} · 利润目标 ${escapeHtml(item.profitTarget)}</span></div>`)
      .join("");
  }

  function setAdminAiStatus(message, tone = "") {
    setStatusMessage("#admin-ai-status", message, tone, root);
  }

  function renderAdminAiConfig(data = {}) {
    const modelscopeInput = query("#admin-ai-modelscope-model");
    const list = query("#admin-ai-provider-list");
    const providers = data.providers || [];
    const modelscope = providers.find((item) => item.id === "modelscope");
    if (modelscopeInput) modelscopeInput.value = modelscope?.model || "deepseek-ai/DeepSeek-V4-Flash";
    if (list) {
      if (modelscope) {
        const keyStatus = modelscope.apiKeyConfigured ? "Key 已配置" : "Key 未配置";
        const lastTest = modelscope.lastTest
          ? `${modelscope.lastTest.ok ? "连接成功" : "连接失败"} · ${modelscope.lastTest.message || "-"} · ${modelscope.lastTest.checkedAt || "-"}`
          : "尚未测试";
        list.innerHTML = `
          <div>
            <strong>${escapeHtml(modelscope.label)} · 当前启用</strong>
            <span>${escapeHtml(modelscope.endpoint || "-")} · ${escapeHtml(modelscope.model || "-")} · ${keyStatus}</span>
            <small>${escapeHtml(lastTest)}</small>
          </div>
        `;
      } else {
        list.innerHTML = `<div><strong>暂无 AI 配置</strong><span>请检查服务器环境变量。</span></div>`;
      }
    }
    setAdminAiStatus(modelscope ? `当前：${modelscope.label} · ${modelscope.model}` : "ModelScope 未配置", modelscope?.apiKeyConfigured ? "success" : "danger");
  }

  async function loadAdminAiConfig() {
    try {
      const response = await fetch("/api/admin/ai-config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      renderAdminAiConfig(data);
    } catch (error) {
      renderAdminAiConfig({ providers: [] });
      setAdminAiStatus(error.message || "AI 配置读取失败", "danger");
    }
  }

  async function submitAdminAiConfig(event) {
    event.preventDefault();
    const button = query("#admin-ai-save");
    const payload = {
      modelscopeModel: trimmedFieldValue("#admin-ai-modelscope-model", "", root),
    };
    const restoreButton = setButtonBusy(button, "保存中...", "保存模型", { disable: false });
    setAdminAiStatus("正在保存 AI 服务商设置");
    try {
      const response = await fetch("/api/admin/ai-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      renderAdminAiConfig(data);
      setAdminAiStatus("AI 服务商设置已保存。", "success");
    } catch (error) {
      setAdminAiStatus(error.message || "保存失败", "danger");
    } finally {
      restoreButton();
    }
  }

  async function testAdminAiConfig() {
    const button = query("#admin-ai-test");
    const restoreButton = setButtonBusy(button, "测试中...", "测试连接", { disable: false });
    setAdminAiStatus("正在测试 AI 服务连接");
    try {
      const response = await fetch("/api/admin/ai-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "modelscope" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      await loadAdminAiConfig();
      setAdminAiStatus(data.ok ? data.message || "连接测试成功。" : data.message || "连接测试失败。", data.ok ? "success" : "danger");
    } catch (error) {
      setAdminAiStatus(error.message || "连接测试失败", "danger");
    } finally {
      restoreButton();
    }
  }

  function setAdminAccountStatus(message, tone = "") {
    setStatusMessage("#admin-account-status", message, tone, root);
  }

  function resetAdminAccountForm() {
    adminAccountEditingUsername = "";
    const form = query("#admin-account-form");
    const username = query("#admin-account-username");
    const saveButton = query("#admin-account-save");
    form?.reset();
    if (username) {
      setElementsDisabled(username, false);
      username.focus();
    }
    if (saveButton) saveButton.textContent = "新增账号";
    setAdminAccountStatus("新增、改密、启用/禁用、删除；后台管理仅系统管理员可见");
  }

  function renderAdminAccounts(accounts) {
    const table = query("#admin-account-table");
    if (!table) return;
    adminAccountRows = accounts || [];

    if (!adminAccountRows.length) {
      renderTableMessage(table, 6, "暂无账号。请先新增一个后台账号。");
      return;
    }

    table.innerHTML = adminAccountRows
      .map((account) => {
        const isReadonly = Boolean(account.readonly);
        const statusText = account.status === "disabled" ? "禁用" : "启用";
        const sourceText = account.source === "env" ? "环境变量" : "后台创建";
        const actions = isReadonly
          ? `<span class="muted-text">初始管理员，不可在页面删除</span>`
          : `<button class="table-action" type="button" data-admin-edit="${escapeHtml(account.username)}">编辑</button>
             <button class="table-action danger" type="button" data-admin-delete="${escapeHtml(account.username)}">删除</button>`;
        return `
          <tr>
            <td>${escapeHtml(account.username)}</td>
            <td>${escapeHtml(account.displayName || account.nick || account.username)}</td>
            <td>${escapeHtml(normalizeAccessRole(account.role))}</td>
            <td><span class="status-pill ${account.status === "disabled" ? "disabled" : "active"}">${statusText}</span></td>
            <td>${sourceText}</td>
            <td>${actions}</td>
          </tr>
        `;
      })
      .join("");
  }

  function editAdminAccount(username, accounts) {
    const account = accounts.find((item) => item.username === username);
    if (!account || account.readonly) return;
    adminAccountEditingUsername = account.username;
    const usernameInput = query("#admin-account-username");
    const displayInput = query("#admin-account-display-name");
    const passwordInput = query("#admin-account-password");
    const roleInput = query("#admin-account-role");
    const statusInput = query("#admin-account-status-select");
    const saveButton = query("#admin-account-save");
    if (usernameInput) {
      usernameInput.value = account.username;
      setElementsDisabled(usernameInput, true);
    }
    if (displayInput) displayInput.value = account.displayName || account.nick || account.username;
    if (passwordInput) passwordInput.value = "";
    if (roleInput) roleInput.value = normalizeAccessRole(account.role);
    if (statusInput) statusInput.value = account.status || "active";
    if (saveButton) saveButton.textContent = "保存修改";
    setAdminAccountStatus(`正在编辑 ${account.username}，密码留空表示不修改。`);
  }

  function handleAdminAccountTableClick(event) {
    const editButton = closestTarget(event, "[data-admin-edit]");
    if (editButton) {
      editAdminAccount(editButton.dataset.adminEdit || "", adminAccountRows);
      return;
    }

    const deleteButton = closestTarget(event, "[data-admin-delete]");
    if (deleteButton) deleteAdminAccount(deleteButton.dataset.adminDelete || "");
  }

  async function loadAdminAccounts() {
    try {
      const response = await fetch("/api/admin/accounts");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      renderAdminAccounts(data.accounts || []);
    } catch (error) {
      renderAdminAccounts([]);
      setAdminAccountStatus(error.message || "账号列表读取失败", "danger");
    }
  }

  async function submitAdminAccountForm(event) {
    event.preventDefault();
    const button = query("#admin-account-save");
    const payload = {
      username: trimmedFieldValue("#admin-account-username", "", root),
      displayName: trimmedFieldValue("#admin-account-display-name", "", root),
      password: fieldValue("#admin-account-password", "", root),
      role: fieldValue("#admin-account-role", "", root) || "子账号",
      status: fieldValue("#admin-account-status-select", "", root) || "active",
    };
    if (!adminAccountEditingUsername && !payload.password) {
      setAdminAccountStatus("新增账号时需要填写密码，至少 8 位。", "danger");
      return;
    }

    const editing = Boolean(adminAccountEditingUsername);
    if (button) button.textContent = editing ? "保存中..." : "新增中...";
    try {
      const response = await fetch(editing ? `/api/admin/accounts/${encodeURIComponent(adminAccountEditingUsername)}` : "/api/admin/accounts", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      resetAdminAccountForm();
      setAdminAccountStatus(editing ? "账号已更新。" : "账号已新增。", "success");
      await loadAdminAccounts();
    } catch (error) {
      setAdminAccountStatus(error.message || "保存失败", "danger");
    } finally {
      if (button) button.textContent = adminAccountEditingUsername ? "保存修改" : "新增账号";
    }
  }

  async function deleteAdminAccount(username) {
    if (!username || !globalThis.confirm?.(`确定删除账号 ${username} 吗？删除后这个账号不能再登录。`)) return;
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");
      if (adminAccountEditingUsername === username) resetAdminAccountForm();
      setAdminAccountStatus("账号已删除。", "success");
      await loadAdminAccounts();
    } catch (error) {
      setAdminAccountStatus(error.message || "删除失败", "danger");
    }
  }

  function setDingtalkAuthStatus(message, tone = "") {
    setStatusMessage("#dingtalk-auth-status", message, tone, root);
  }

  function dingtalkStatusText(status) {
    return {
      pending: "待审核",
      active: "已通过",
      disabled: "已禁用",
      rejected: "已拒绝",
    }[status] || "待审核";
  }

  function formatCompactDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: beijingTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date).replace(/\//g, "-");
  }

  function renderDingtalkAuthUsers(users) {
    const table = query("#dingtalk-auth-table");
    if (!table) return;

    if (!users.length) {
      renderTableMessage(table, 7, "暂无钉钉扫码用户。员工第一次扫码后会出现在这里。");
      return;
    }

    table.innerHTML = users
      .map((user) => {
        const id = user.id || user.unionId || user.openId || user.mobile || "";
        const status = user.status || "pending";
        const canApprove = status !== "active";
        const canDisable = status !== "disabled";
        const identity = user.unionId || user.openId || id || "-";
        return `
          <tr>
            <td><strong>${escapeHtml(user.displayName || user.nick || "钉钉用户")}</strong><br /><small>${escapeHtml(user.nick || "")}</small></td>
            <td>${escapeHtml(user.mobile || "-")}</td>
            <td><span class="status-pill ${escapeHtml(status)}">${dingtalkStatusText(status)}</span></td>
            <td>
              <select class="table-select" data-dingtalk-role="${escapeHtml(id)}">
                ${accessRoles.map((role) => (
                  `<option value="${role}" ${role === normalizeAccessRole(user.role) ? "selected" : ""}>${role}</option>`
                )).join("")}
              </select>
            </td>
            <td>${formatCompactDateTime(user.lastLoginAt)}</td>
            <td><small>${escapeHtml(identity)}</small></td>
            <td>
              ${canApprove ? `<button class="table-action" type="button" data-dingtalk-approve="${escapeHtml(id)}">通过</button>` : ""}
              ${canDisable ? `<button class="table-action danger" type="button" data-dingtalk-disable="${escapeHtml(id)}">禁用</button>` : ""}
              <button class="table-action" type="button" data-dingtalk-save-role="${escapeHtml(id)}">保存角色</button>
              <button class="table-action danger" type="button" data-dingtalk-delete="${escapeHtml(id)}">删除</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function handleDingtalkAuthTableClick(event) {
    const approveButton = closestTarget(event, "[data-dingtalk-approve]");
    if (approveButton) {
      updateDingtalkAuthUser(approveButton.dataset.dingtalkApprove || "", { status: "active" });
      return;
    }

    const disableButton = closestTarget(event, "[data-dingtalk-disable]");
    if (disableButton) {
      updateDingtalkAuthUser(disableButton.dataset.dingtalkDisable || "", { status: "disabled" });
      return;
    }

    const saveRoleButton = closestTarget(event, "[data-dingtalk-save-role]");
    if (saveRoleButton) {
      const id = saveRoleButton.dataset.dingtalkSaveRole || "";
      const role = fieldValue(`[data-dingtalk-role="${CSS.escape(id)}"]`, "", root) || "子账号";
      updateDingtalkAuthUser(id, { role });
      return;
    }

    const deleteButton = closestTarget(event, "[data-dingtalk-delete]");
    if (deleteButton) deleteDingtalkAuthUser(deleteButton.dataset.dingtalkDelete || "");
  }

  async function loadDingtalkAuthUsers() {
    try {
      const response = await fetch("/api/admin/dingtalk-users");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      renderDingtalkAuthUsers(data.users || []);
      setDingtalkAuthStatus("新员工首次扫码后会进入待审核");
    } catch (error) {
      renderDingtalkAuthUsers([]);
      setDingtalkAuthStatus(error.message || "钉钉授权列表读取失败", "danger");
    }
  }

  async function updateDingtalkAuthUser(id, patch) {
    if (!id) return;
    try {
      const rowRole = fieldValue(`[data-dingtalk-role="${CSS.escape(id)}"]`, "", root);
      const payload = { role: rowRole || "子账号", ...patch };
      const response = await fetch(`/api/admin/dingtalk-users/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setDingtalkAuthStatus("钉钉授权已更新。", "success");
      await loadDingtalkAuthUsers();
    } catch (error) {
      setDingtalkAuthStatus(error.message || "保存失败", "danger");
    }
  }

  async function deleteDingtalkAuthUser(id) {
    if (!id || !globalThis.confirm?.("确定删除这个钉钉授权记录吗？删除后员工重新扫码会再次进入待审核。")) return;
    try {
      const response = await fetch(`/api/admin/dingtalk-users/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");
      setDingtalkAuthStatus("钉钉授权记录已删除。", "success");
      await loadDingtalkAuthUsers();
    } catch (error) {
      setDingtalkAuthStatus(error.message || "删除失败", "danger");
    }
  }

  async function loadAdminOverview() {
    try {
      const response = await fetch("/api/admin/overview");
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderAdminOverview(await response.json());
      loadAdminAiConfig();
    } catch {
      renderAdminOverview({
        users: [
          { name: "系统管理员", role: "系统管理员", scope: "全部店铺" },
          { name: "主账号", role: "主账号", scope: "全部业务板块，不含后台管理" },
          { name: "子账号", role: "子账号", scope: "业务板块，不含财务和后台管理" },
        ],
        shops: [
          { name: "Amazon-美国4", owner: "销售主管", status: "启用" },
          { name: "Amazon-加拿大4", owner: "销售主管", status: "启用" },
        ],
        targets: [
          { month: "2026-04", scope: "美国站", salesTarget: "324.51万", profitTarget: "5.68万" },
        ],
      });
      loadAdminAiConfig();
    }
  }

  function setupAdminSettings() {
    bind(root, "#admin-account-form", "submit", submitAdminAccountForm);
    bind(root, "#admin-account-reset", "click", resetAdminAccountForm);
    bind(root, "#admin-account-table", "click", handleAdminAccountTableClick);
    bind(root, "#dingtalk-auth-table", "click", handleDingtalkAuthTableClick);
    bind(root, "#admin-ai-form", "submit", submitAdminAiConfig);
    bind(root, "#admin-ai-test", "click", testAdminAiConfig);
  }

  return {
    loadAdminAccounts,
    loadAdminAiConfig,
    loadAdminOverview,
    loadDingtalkAuthUsers,
    setupAdminSettings,
  };
}

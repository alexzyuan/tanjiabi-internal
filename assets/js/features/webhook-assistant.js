export function createWebhookAssistantFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  escapeHtml,
  fieldValue,
  renderTableMessage,
  setButtonBusy,
  setElementsHidden,
  setStatusMessage,
  trimmedFieldValue,
} = {}) {
  if (typeof bind !== "function") throw new Error("createWebhookAssistantFeature requires bind.");

  let webhookTaskRows = [];

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function setWebhookStatus(message, tone = "") {
    setStatusMessage("#webhook-assistant-status", message, tone, root);
  }

  function scheduleText(task = {}) {
    if (task.scheduleMode === "once") return `一次性 · ${task.runAt || task.nextRunAt || "-"}`;
    if (task.scheduleMode === "daily") return `每日 · ${task.sendTime || "-"}`;
    if (task.scheduleMode === "interval") return `循环 · 每 ${task.intervalMinutes || "-"} 分钟`;
    return "-";
  }

  function renderWebhookTasks(tasks = []) {
    const table = query("#webhook-task-table");
    if (!table) return;
    webhookTaskRows = tasks;
    if (!tasks.length) {
      renderTableMessage(table, 7, "暂无 webhook 发送任务。");
      return;
    }
    table.innerHTML = tasks.map((task) => `
      <tr>
        <td><strong>${escapeHtml(task.name || "-")}</strong><br /><small>${escapeHtml(task.id || "-")}</small></td>
        <td><span class="status-pill ${task.enabled ? "active" : "disabled"}">${task.enabled ? "启用" : "暂停"}</span></td>
        <td>${escapeHtml(scheduleText(task))}<br /><small>下次：${escapeHtml(task.nextRunAt || "-")}</small></td>
        <td><small>${escapeHtml(task.webhook || "-")}</small><br /><small>${task.secretConfigured ? "密钥已配置" : "未配置密钥"}</small></td>
        <td>${escapeHtml(task.lastStatus || "-")}<br /><small>${escapeHtml(task.lastRunAt || task.lastError || "-")}</small></td>
        <td>${escapeHtml(String(task.runCount || 0))}</td>
        <td>
          <button class="table-action" type="button" data-webhook-send="${escapeHtml(task.id)}">立即发送</button>
          <button class="table-action" type="button" data-webhook-toggle="${escapeHtml(task.id)}">${task.enabled ? "暂停" : "启用"}</button>
          <button class="table-action danger" type="button" data-webhook-delete="${escapeHtml(task.id)}">删除</button>
        </td>
      </tr>
    `).join("");
  }

  function syncScheduleFields() {
    const mode = fieldValue("#webhook-schedule-mode", "", root) || "once";
    root?.querySelectorAll?.("[data-webhook-schedule-field]").forEach((field) => {
      setElementsHidden(field, field.dataset.webhookScheduleField !== mode, root);
    });
  }

  function resetWebhookForm() {
    query("#webhook-task-form")?.reset();
    syncScheduleFields();
    setWebhookStatus("可新增钉钉群机器人发送任务");
  }

  function webhookPayload() {
    const mode = fieldValue("#webhook-schedule-mode", "", root) || "once";
    return {
      name: trimmedFieldValue("#webhook-task-name", "", root),
      webhook: trimmedFieldValue("#webhook-url", "", root),
      secret: trimmedFieldValue("#webhook-secret", "", root),
      message: trimmedFieldValue("#webhook-message", "", root),
      scheduleMode: mode,
      runAt: fieldValue("#webhook-run-at", "", root),
      sendTime: fieldValue("#webhook-send-time", "", root),
      intervalMinutes: Number(fieldValue("#webhook-interval-minutes", "0", root) || 0),
      enabled: query("#webhook-enabled")?.checked !== false,
      atAll: query("#webhook-at-all")?.checked === true,
      atMobiles: trimmedFieldValue("#webhook-at-mobiles", "", root),
      atUserIds: trimmedFieldValue("#webhook-at-user-ids", "", root),
    };
  }

  async function loadWebhookTasks() {
    try {
      const response = await fetch("/api/webhook-assistant/tasks", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      renderWebhookTasks(data.tasks || []);
      setWebhookStatus("Webhook 发送任务已刷新。", "success");
    } catch (error) {
      renderWebhookTasks([]);
      setWebhookStatus(error.message || "Webhook 任务读取失败", "danger");
    }
  }

  async function submitWebhookTask(event) {
    event.preventDefault();
    const button = query("#webhook-task-save");
    const restoreButton = setButtonBusy(button, "保存中...", "新增任务", { disable: false });
    setWebhookStatus("正在保存 webhook 任务");
    try {
      const response = await fetch("/api/webhook-assistant/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(webhookPayload()),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      resetWebhookForm();
      setWebhookStatus("Webhook 任务已新增。", "success");
      await loadWebhookTasks();
    } catch (error) {
      setWebhookStatus(error.message || "保存失败", "danger");
    } finally {
      restoreButton();
    }
  }

  async function updateWebhookEnabled(id, enabled) {
    const task = webhookTaskRows.find((item) => item.id === id);
    if (!task) return;
    try {
      const response = await fetch(`/api/webhook-assistant/tasks/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...task, webhook: undefined, secret: undefined, enabled }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      setWebhookStatus(enabled ? "任务已启用。" : "任务已暂停。", "success");
      await loadWebhookTasks();
    } catch (error) {
      setWebhookStatus(error.message || "任务状态更新失败", "danger");
    }
  }

  async function sendWebhookNow(id) {
    try {
      setWebhookStatus("正在发送测试消息");
      const response = await fetch(`/api/webhook-assistant/tasks/${encodeURIComponent(id)}/send`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "发送失败");
      setWebhookStatus("Webhook 消息已发送。", "success");
      await loadWebhookTasks();
    } catch (error) {
      setWebhookStatus(error.message || "发送失败", "danger");
      await loadWebhookTasks();
    }
  }

  async function deleteWebhookTask(id) {
    if (!id || !globalThis.confirm?.("确定删除这个 webhook 发送任务吗？")) return;
    try {
      const response = await fetch(`/api/webhook-assistant/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "删除失败");
      setWebhookStatus("Webhook 任务已删除。", "success");
      await loadWebhookTasks();
    } catch (error) {
      setWebhookStatus(error.message || "删除失败", "danger");
    }
  }

  function handleWebhookTableClick(event) {
    const sendButton = closestTarget(event, "[data-webhook-send]");
    if (sendButton) {
      sendWebhookNow(sendButton.dataset.webhookSend || "");
      return;
    }
    const toggleButton = closestTarget(event, "[data-webhook-toggle]");
    if (toggleButton) {
      const id = toggleButton.dataset.webhookToggle || "";
      const task = webhookTaskRows.find((item) => item.id === id);
      updateWebhookEnabled(id, !task?.enabled);
      return;
    }
    const deleteButton = closestTarget(event, "[data-webhook-delete]");
    if (deleteButton) deleteWebhookTask(deleteButton.dataset.webhookDelete || "");
  }

  function setupWebhookAssistant() {
    bind(root, "#webhook-task-form", "submit", submitWebhookTask);
    bind(root, "#webhook-task-reset", "click", resetWebhookForm);
    bind(root, "#webhook-schedule-mode", "change", syncScheduleFields);
    bind(root, "#webhook-task-table", "click", handleWebhookTableClick);
    syncScheduleFields();
  }

  return {
    loadWebhookTasks,
    setupWebhookAssistant,
  };
}

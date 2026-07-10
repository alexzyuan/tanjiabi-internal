const FBA_AUTOMATION_CACHE_KEY = "tanjia:fbaAutomationState:v1";
const fbaHistoryPageSize = 20;

export function createFbaAutomationFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  escapeHtml,
  fetchImpl = globalThis.fetch,
  formatCompactDateTime,
  formatNumber,
  renderFbaWarehouseOptions,
  renderTableMessage,
  setActiveDatasetValueState,
  setText,
  storage = globalThis.localStorage,
  timer = globalThis,
  onDeleteTask = async () => {},
  onEditTask = () => {},
  onRunTask = async () => {},
  onToggleTask = async () => {},
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaAutomationFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaAutomationFeature requires fetch.");

  let fbaAutomationState = { automation: {}, tasks: [], warehouses: [] };
  let fbaTaskFilter = "all";
  let fbaTaskSearch = "";
  let fbaHistoryPage = 1;

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function getFbaAutomationState() {
    return fbaAutomationState;
  }

  function getFbaTaskBucket(task) {
    if (task.status === "matched_confirmed") return "completed";
    if (task.status === "failed") return "failed";
    if (task.status === "running") return "running";
    if (task.status === "warehouse_mismatch" && !task.enabled) return "completed";
    if (task.enabled && Number(task.runCount || 0) > 0) return "running";
    return "pending";
  }

  function getFbaTaskMeta(bucket) {
    return {
      running: { label: "进行中", className: "info" },
      pending: { label: "待启动", className: "warning" },
      completed: { label: "已完成", className: "success" },
      failed: { label: "启动失败", className: "danger" },
      history: { label: "历史", className: "muted" },
    }[bucket] || { label: "待启动", className: "warning" };
  }

  function fbaTaskMatchesSearch(task, keyword) {
    if (!keyword) return true;
    const fields = [
      task.shop?.name,
      task.shop?.displayName,
      task.shop?.country,
      task.targetWarehouseCode,
      task.msku,
      task.operator,
      task.lastStatus,
      task.status,
    ];
    return fields.some((field) => String(field || "").toLowerCase().includes(keyword));
  }

  function fbaHistoryMatchesSearch(item, keyword) {
    if (!keyword) return true;
    const fields = [item.country, item.shopName, item.displayName, item.msku, item.operator, item.taskName, item.status, item.message, item.targetWarehouseCode, (item.warehouseCodes || []).join(",")];
    return fields.some((field) => String(field || "").toLowerCase().includes(keyword));
  }

  function renderFbaTaskCard(task, index) {
    const bucket = getFbaTaskBucket(task);
    const meta = getFbaTaskMeta(bucket);
    const scheduleText = task.scheduleEnabled === false
      ? "一次性"
      : `北京时间 ${String(task.startHour ?? 0).padStart(2, "0")}:00-${Number(task.endHour ?? 24) >= 24 ? "23:59" : `${String(task.endHour).padStart(2, "0")}:00`} / ${task.runIntervalMinutes || 20}分钟`;
    return `
      <div class="fba-task-row">
        <span class="row-index">${index + 1}</span>
        <div class="task-main">
          <strong>${escapeHtml(task.msku || "-")}</strong>
          <small>${escapeHtml(task.shop?.name || "-")} · ${escapeHtml(task.shop?.country || task.shop?.displayName || "-")}</small>
        </div>
        <div><span class="status-pill ${meta.className}">${meta.label}</span></div>
        <div class="task-cell"><span>目标仓</span><strong>${escapeHtml(task.targetWarehouseCode || "-")}</strong></div>
        <div class="task-cell"><span>创建人</span><strong>${escapeHtml(task.operator || "-")}</strong></div>
        <div class="task-cell"><span>箱数/数量</span><strong>${formatNumber(task.boxCount || 0)} / ${formatNumber(task.quantity || 0)}</strong></div>
        <div class="task-cell"><span>下次运行</span><strong>${formatCompactDateTime(task.nextRunAt)}</strong></div>
        <div class="task-cell wide"><span>刷仓时间与频率</span><strong>${escapeHtml(scheduleText)}</strong></div>
        <div class="task-actions">
          <button class="table-action" type="button" data-fba-task-run="${task.id}">运行一次</button>
          <button class="table-action" type="button" data-fba-task-edit="${task.id}">编辑</button>
          <button class="table-action" type="button" data-fba-task-toggle="${task.id}" data-enabled="${task.enabled ? "false" : "true"}">${task.enabled ? "暂停" : "启用"}</button>
          <button class="table-action danger" type="button" data-fba-task-delete="${task.id}">删除</button>
        </div>
      </div>
    `;
  }

  function renderFbaQueuePanel(queue = []) {
    const panel = query("#fba-queue-panel");
    if (!panel) return;
    const items = Array.isArray(queue) ? queue : [];
    panel.hidden = items.length === 0;
    if (!items.length) {
      panel.innerHTML = "";
      return;
    }
    panel.innerHTML = `
      <div class="queue-head"><strong>运行队列</strong><span>${items.length} 个任务正在运行或排队</span></div>
      <div class="queue-list">
        ${items.map((item) => `
          <div class="queue-item ${item.queueStatus === "running" ? "running" : "queued"}">
            <span class="status-pill ${item.queueStatus === "running" ? "info" : "warning"}">${item.queueStatus === "running" ? "运行中" : "排队中"}</span>
            <div class="queue-info">
              <strong>${escapeHtml(item.msku || "-")}</strong>
              <span>${escapeHtml(item.displayName || item.shopName || "-")} · ${escapeHtml(item.targetWarehouseCode || "-")}</span>
              <small>${escapeHtml(item.operator || "-")} · ${escapeHtml(item.progress || "-")}</small>
            </div>
            <i class="${item.queueStatus === "running" ? "queue-spinner" : "queue-pulse"}" aria-hidden="true"></i>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderFbaHistoryRow(item, index) {
    const meta = getFbaTaskMeta(item.status === "matched_confirmed" ? "completed" : (item.status === "failed" ? "failed" : "history"));
    return `
      <div class="fba-task-row history-row">
        <span class="row-index">${index + 1}</span>
        <div class="task-main">
          <strong>${escapeHtml(item.msku || item.taskName || "-")}</strong>
          <small>${escapeHtml(item.displayName || item.shopName || "-")} · ${escapeHtml(item.country || "-")}</small>
        </div>
        <div><span class="status-pill ${meta.className}">${escapeHtml(meta.label)}</span></div>
        <div class="task-cell"><span>FBA仓库</span><strong>${escapeHtml((item.warehouseCodes || []).join(", ") || item.actualWarehouseCode || "-")}</strong></div>
        <div class="task-cell"><span>货件ID</span><strong>${escapeHtml((item.shipmentIds || []).join(", ") || "-")}</strong></div>
        <div class="task-cell"><span>数量</span><strong>${formatNumber(item.quantity || 0)}</strong></div>
        <div class="task-cell wide"><span>操作人 / 时间</span><strong>${escapeHtml(item.operator || "-")} · ${formatCompactDateTime(item.ranAt)}</strong></div>
        <div class="task-actions muted-text">${escapeHtml(item.message || "-")}</div>
      </div>
    `;
  }

  function renderFbaTaskBoard(tasks = []) {
    const board = query("#fba-board-groups");
    if (!board) return;
    const keyword = fbaTaskSearch.trim().toLowerCase();
    const taskCount = tasks.length;
    const history = (fbaAutomationState.history || []).filter((item) => fbaHistoryMatchesSearch(item, keyword));
    setText("#fba-board-count", fbaTaskFilter === "history" ? `${history.length} 条历史` : `${taskCount} 个任务`, root);

    setActiveDatasetValueState("[data-fba-filter]", "fbaFilter", fbaTaskFilter, root);

    if (fbaTaskFilter === "history") {
      board.innerHTML = history.length
        ? `<section class="task-group"><div class="task-group-head"><span class="status-pill muted">历史</span><small>${history.length} 条记录</small></div>${history.map(renderFbaHistoryRow).join("")}</section>`
        : `<div class="empty-state">暂无匹配的历史记录</div>`;
      return;
    }

    const visibleTasks = tasks.filter((task) => {
      const bucket = getFbaTaskBucket(task);
      return (fbaTaskFilter === "all" || fbaTaskFilter === bucket) && fbaTaskMatchesSearch(task, keyword);
    });
    const groupOrder = ["running", "pending", "failed", "completed"];
    const groups = groupOrder
      .map((bucket) => ({
        bucket,
        tasks: visibleTasks.filter((task) => getFbaTaskBucket(task) === bucket),
      }))
      .filter((group) => group.tasks.length);

    board.innerHTML = groups.length
      ? groups.map((group) => {
          const meta = getFbaTaskMeta(group.bucket);
          return `
            <section class="task-group">
              <div class="task-group-head"><span class="status-pill ${meta.className}">${meta.label}</span><small>${group.tasks.length} 条记录</small></div>
              ${group.tasks.map(renderFbaTaskCard).join("")}
            </section>
          `;
        }).join("")
      : `<div class="empty-state">暂无匹配的刷仓任务</div>`;
  }

  function readCachedFbaAutomationState() {
    try {
      const cached = JSON.parse(storage.getItem(FBA_AUTOMATION_CACHE_KEY) || "null");
      if (!cached || typeof cached !== "object") return null;
      if (!Array.isArray(cached.tasks) && !Array.isArray(cached.history)) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function cacheFbaAutomationState(state) {
    try {
      if (!state || typeof state !== "object") return;
      storage.setItem(FBA_AUTOMATION_CACHE_KEY, JSON.stringify({
        ...state,
        cachedAt: new Date().toISOString(),
      }));
    } catch {
      // localStorage may be disabled or full; the live API result is still rendered.
    }
  }

  function renderFbaResultHistory(history = []) {
    const table = query("#fba-warehouse-table");
    if (!table) return;
    const rows = (history || []).slice(0, 60);
    const totalPages = Math.max(1, Math.ceil(rows.length / fbaHistoryPageSize));
    fbaHistoryPage = Math.min(Math.max(1, fbaHistoryPage), totalPages);
    const start = (fbaHistoryPage - 1) * fbaHistoryPageSize;
    const pageRows = rows.slice(start, start + fbaHistoryPageSize);
    table.innerHTML = rows.length
      ? pageRows.map((item) => {
          const actualWarehouseText = [((item.warehouseCodes || [])[0] || item.actualWarehouseCode || ""), item.actualWarehouseRegion || ""].filter(Boolean).join("，") || "-";
          const shipmentText = item.status === "matched_confirmed" ? ((item.shipmentNames || []).join(", ") || (item.shipmentIds || []).join(", ") || "无") : "无";
          const statusText = item.status === "matched_confirmed" ? (item.message || "已命中目标仓并确认货件方案") : `未命中目标仓，实际仓：${actualWarehouseText}`;
          return `
            <tr>
              <td>${escapeHtml(item.country || "-")}</td>
              <td>${escapeHtml(item.displayName || item.shopName || "-")}</td>
              <td>${escapeHtml(item.msku || "-")}</td>
              <td>${escapeHtml(actualWarehouseText)}</td>
              <td>${escapeHtml(item.operator || "-")}</td>
              <td>${escapeHtml(formatCompactDateTime(item.ranAt || item.lastRunAt || ""))}</td>
              <td>${escapeHtml(shipmentText)}</td>
              <td>${formatNumber(item.quantity || 0)}</td>
              <td>${escapeHtml(statusText)}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="9">暂无最近60次刷仓结果</td></tr>`;
    const pager = query("#fba-result-pagination");
    if (pager) {
      pager.innerHTML = rows.length
        ? `
          <span>共 ${rows.length} 条 · 第 ${fbaHistoryPage}/${totalPages} 页</span>
          <button class="table-action" type="button" data-fba-history-page="${fbaHistoryPage - 1}" ${fbaHistoryPage <= 1 ? "disabled" : ""}>上一页</button>
          <button class="table-action" type="button" data-fba-history-page="${fbaHistoryPage + 1}" ${fbaHistoryPage >= totalPages ? "disabled" : ""}>下一页</button>
        `
        : "";
    }
  }

  function renderFbaLoadingState() {
    const cached = readCachedFbaAutomationState();
    if (cached && ((cached.tasks || []).length || (cached.history || []).length)) {
      renderFbaAutomationState(cached, { cache: false });
      setText("#fba-status", "正在刷新刷仓任务...", root);
      return;
    }
    setText("#fba-board-count", "正在加载任务", root);
    const queuePanel = query("#fba-queue-panel");
    if (queuePanel) {
      queuePanel.hidden = true;
      queuePanel.innerHTML = "";
    }
    const board = query("#fba-board-groups");
    if (board) {
      board.innerHTML = `
        <section class="task-group fba-loading-group" aria-busy="true">
          <div class="task-group-head"><span class="status-pill muted">加载中</span><small>正在读取任务列表</small></div>
          ${Array.from({ length: 3 }).map(() => `
            <div class="fba-task-row fba-task-skeleton">
              <span></span><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
            </div>
          `).join("")}
        </section>
      `;
    }
    const table = query("#fba-warehouse-table");
    renderTableMessage(table, 9, "正在读取最近任务执行结果...");
    const pager = query("#fba-result-pagination");
    if (pager) pager.innerHTML = "";
    setText("#fba-status", "正在读取刷仓任务...", root);
  }

  function renderFbaAutomationState(state = fbaAutomationState, { cache = true } = {}) {
    fbaAutomationState = state || { automation: {}, tasks: [], warehouses: [] };
    if (cache) cacheFbaAutomationState(fbaAutomationState);
    renderFbaWarehouseOptions();
    renderFbaQueuePanel(fbaAutomationState.scheduler?.queue || []);
    renderFbaTaskBoard(fbaAutomationState.tasks || []);
    renderFbaResultHistory(fbaAutomationState.history || []);
  }

  async function loadFbaAutomationState({ showLoading = false } = {}) {
    if (showLoading) renderFbaLoadingState();
    try {
      const response = await fetchImpl("/api/fba/sta/automation");
      if (!response.ok) throw new Error(`API ${response.status}`);
      renderFbaAutomationState(await response.json());
    } catch (error) {
      setText("#fba-status", `任务看板读取失败：${error.message}`, root);
    }
  }

  function renderFbaResult(result) {
    const displayWarehouses = result.displayWarehouses?.length
      ? result.displayWarehouses
      : (result.selectedWarehouses?.length ? result.selectedWarehouses : result.warehouses || []);
    const rows = displayWarehouses.map((item) => ({
      country: result.request?.country || item.country || "-",
      displayName: item.displayName || result.request?.displayName || result.request?.shopName || "-",
      shopName: item.shopName || result.request?.shopName || "-",
      msku: item.msku || result.request?.msku || "-",
      warehouseCodes: [item.wareHouseId].filter(Boolean),
      actualWarehouseRegion: item.regionLabel || "",
      operator: result.operator || "测试刷仓",
      shipmentIds: result.targetMatched ? [item.shipmentId].filter(Boolean) : [],
      shipmentNames: result.targetMatched ? [result.request?.planName || item.shipmentName].filter(Boolean) : [],
      quantity: item.quantity || result.request?.quantity || 0,
      status: result.targetMatched ? "matched_confirmed" : "warehouse_mismatch",
      message: result.targetMatched ? "已命中" : "未命中",
      ranAt: new Date().toISOString(),
    }));
    renderFbaResultHistory(rows);

    setText("#fba-status", result.ok ? `测试完成${result.total ? `：${result.successCount}/${result.total}` : ""}` : "测试失败", root);
  }

  function setupFbaAutomationBoard() {
    bind(root, "#fba-refresh-tasks-button", "click", () => loadFbaAutomationState({ showLoading: true }));
    bind(root, "#fba-result-pagination", "click", (event) => {
      const button = closestTarget(event, "[data-fba-history-page]");
      if (!button || button.disabled) return;
      fbaHistoryPage = Number(button.dataset.fbaHistoryPage || 1);
      renderFbaResultHistory(fbaAutomationState.history || []);
    });
    bind(root, "#fba-task-search", "input", (event) => {
      fbaTaskSearch = event.target.value || "";
      renderFbaTaskBoard(fbaAutomationState.tasks || []);
    });
    bind(root, "#fba-status-tabs", "click", (event) => {
      const button = closestTarget(event, "[data-fba-filter]");
      if (!button) return;
      fbaTaskFilter = button.dataset.fbaFilter || "all";
      renderFbaTaskBoard(fbaAutomationState.tasks || []);
    });
    bind(root, "#fba-board-groups", "click", async (event) => {
      const runButton = closestTarget(event, "[data-fba-task-run]");
      const editButton = closestTarget(event, "[data-fba-task-edit]");
      const toggleButton = closestTarget(event, "[data-fba-task-toggle]");
      const deleteButton = closestTarget(event, "[data-fba-task-delete]");
      try {
        if (runButton) await onRunTask(runButton.dataset.fbaTaskRun);
        if (editButton) {
          const task = (fbaAutomationState.tasks || []).find((item) => item.id === editButton.dataset.fbaTaskEdit);
          if (task) onEditTask(task);
        }
        if (toggleButton) await onToggleTask(toggleButton.dataset.fbaTaskToggle, { enabled: toggleButton.dataset.enabled === "true", nextRunAt: new Date().toISOString() });
        if (deleteButton) await onDeleteTask(deleteButton.dataset.fbaTaskDelete);
      } catch (error) {
        setText("#fba-status", `任务操作失败：${error.message}`, root);
      }
    });
  }

  return {
    getFbaAutomationState,
    loadFbaAutomationState,
    renderFbaAutomationState,
    renderFbaLoadingState,
    renderFbaResult,
    renderFbaResultHistory,
    renderFbaTaskBoard,
    setupFbaAutomationBoard,
  };
}

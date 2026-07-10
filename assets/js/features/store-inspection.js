export function createStoreInspectionFeature({
  root = globalThis.document,
  bind,
  checkedField,
  escapeHtml,
  fieldValue,
  redirectToLogin,
  setButtonBusy,
  setText,
} = {}) {
  let storeInspectionDashboard = null;
  let storeInspectionReportMarkdown = "";

  function autoInspectionBadgeClass(status) {
    if (["risk", "error", "danger"].includes(status)) return "inspection-badge-high";
    if (["warning", "unavailable"].includes(status)) return "inspection-badge-mid";
    return "inspection-badge-low";
  }

  function autoInspectionStatusText(status) {
    const map = {
      risk: "需处理",
      error: "读取失败",
      warning: "需复核",
      unavailable: "未接入",
      ok: "正常",
      success: "正常",
    };
    return map[status] || status || "-";
  }

  function renderStoreInspectionPreview() {
    const latest = storeInspectionDashboard?.latest;
    const status = root?.querySelector?.("#store-inspection-overall-status");
    const focus = root?.querySelector?.("#store-inspection-focus");
    const summary = root?.querySelector?.("#store-inspection-check-summary");
    const stateText = root?.querySelector?.("#store-inspection-status-text");
    const updatedAt = root?.querySelector?.("#store-inspection-updated-at");
    const notifyStatus = root?.querySelector?.("#store-inspection-notify-status");
    const state = storeInspectionDashboard?.state || {};
    if (stateText) stateText.textContent = state.running ? "自动巡检运行中" : (state.lastStatus || "等待读取自动巡检结果");
    if (status) {
      const overall = latest?.overall || "warning";
      status.className = `store-inspection-status ${autoInspectionBadgeClass(overall)}`;
      status.textContent = latest?.overallLabel || (state.running ? "巡检中" : "等待巡检");
    }
    if (updatedAt) updatedAt.textContent = latest?.meta?.updatedAt ? `最近巡检：${latest.meta.updatedAt}` : "等待巡检";
    if (notifyStatus) {
      const notification = latest?.notification;
      notifyStatus.textContent = notification ? (notification.ok ? "通知已发送" : notification.message || "通知未发送") : "通知状态";
    }
    if (focus) {
      if (!latest) {
        focus.innerHTML = `<div class="inspection-focus-card inspection-badge-mid"><span>等待自动巡检</span><strong>暂无结果</strong><small>点击“立即巡检”或等待后台定时任务。</small></div>`;
      } else {
        const cards = [
          {
            title: "feedback",
            value: latest.feedback?.count ? `低星 ${latest.feedback.count} 条` : autoInspectionStatusText(latest.feedback?.status),
            level: latest.feedback?.status || "warning",
            note: latest.feedback?.detail || "-",
          },
          {
            title: "review",
            value: latest.review?.count ? `新增 ${latest.review.count} 条` : autoInspectionStatusText(latest.review?.status),
            level: latest.review?.status || "warning",
            note: latest.review?.detail || "-",
          },
          {
            title: "买家之声",
            value: latest.voiceOfBuyer?.count ? `异常 ${latest.voiceOfBuyer.count} 条` : autoInspectionStatusText(latest.voiceOfBuyer?.status),
            level: latest.voiceOfBuyer?.status || "warning",
            note: latest.voiceOfBuyer?.detail || "-",
          },
          {
            title: "Account Health",
            value: latest.accountHealth?.count ? `风险 ${latest.accountHealth.count} 店铺` : autoInspectionStatusText(latest.accountHealth?.status),
            level: latest.accountHealth?.status || "warning",
            note: latest.accountHealth?.detail || "-",
          },
          {
            title: "站外售后邮箱",
            value: latest.aftersalesMail?.newCount ? `新增 ${latest.aftersalesMail.newCount} 封` : latest.aftersalesMail?.count ? `待回复 ${latest.aftersalesMail.count} 封` : autoInspectionStatusText(latest.aftersalesMail?.status),
            level: latest.aftersalesMail?.status || "warning",
            note: latest.aftersalesMail?.detail || "-",
          },
        ];
        focus.innerHTML = cards.map((item) => `
          <div class="inspection-focus-card ${autoInspectionBadgeClass(item.level)}">
            <span>${escapeHtml(item.title)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.note)}</small>
          </div>
        `).join("");
      }
    }
    if (summary) {
      const checks = latest?.checks || [];
      summary.innerHTML = checks.length
        ? checks.map((item) => `<span class="inspection-check-pill ${autoInspectionBadgeClass(item.status)}"><b>${escapeHtml(item.label)}</b>${escapeHtml(autoInspectionStatusText(item.status))}</span>`).join("")
        : `<span class="inspection-check-pill inspection-badge-mid"><b>接口状态</b>等待巡检</span>`;
    }
  }

  function renderStoreInspectionRecords() {
    const latest = storeInspectionDashboard?.latest;
    const history = storeInspectionDashboard?.history || [];
    const feedback = latest?.feedback?.rows || [];
    const reviews = latest?.review?.rows || [];
    const voiceRows = latest?.voiceOfBuyer?.rows || [];
    const accountRows = latest?.accountHealth?.rows || [];
    const erpMailRows = latest?.erpBuyerMessages?.rows || [];
    const mailRows = latest?.aftersalesMail?.rows || [];
    const riskRows = [
      ...feedback.map((item) => ({ type: "feedback", storeName: item.storeName, object: item.asin, actor: item.rating === "-" ? "-" : `${item.rating}星`, content: item.content, createdAt: item.createdAt, status: "低星" })),
      ...reviews.map((item) => ({ type: "review", storeName: item.storeName, object: item.asin, actor: item.rating === "-" ? "-" : `${item.rating}星`, content: item.content, createdAt: item.createdAt, status: "低星" })),
      ...voiceRows.map((item) => ({ type: "买家之声", storeName: item.storeName, object: item.asin || item.msku, actor: item.rating, content: item.content, createdAt: item.createdAt, status: "异常" })),
      ...accountRows.map((item) => ({ type: "Account Health", storeName: item.storeName, object: item.asin || "-", actor: item.rating, content: item.content, createdAt: item.createdAt, status: "需处理" })),
      ...erpMailRows.map((item) => ({ type: "亚马逊站内信", storeName: item.storeName, object: item.item, actor: item.from || item.type, content: item.detail, createdAt: item.createdAt || "-", status: "新增" })),
      ...mailRows.map((item) => ({ type: "站外售后邮箱", storeName: item.storeName, object: item.item, actor: item.type, content: item.detail, createdAt: "-", status: item.type || "待回复" })),
    ];
    setText("#inspection-feedback-count", latest?.feedback?.count || 0, root);
    setText("#inspection-review-count", latest?.review?.count || 0, root);
    const reviewRange = latest?.meta?.startDate && latest?.meta?.endDate ? `${latest.meta.startDate} 至 ${latest.meta.endDate}` : "巡检范围内新增";
    setText("#inspection-review-note", latest?.review?.lowCount ? `低星 ${latest.review.lowCount} 条` : reviewRange, root);
    setText("#inspection-voice-count", latest?.voiceOfBuyer?.count || 0, root);
    setText("#inspection-account-health-count", latest?.accountHealth?.count || 0, root);
    setText("#store-inspection-table-count", riskRows.length ? `共 ${riskRows.length} 条待处理` : latest ? "未发现待处理记录" : "暂无巡检结果", root);
    const table = root?.querySelector?.("#store-inspection-table");
    if (table) {
      table.innerHTML = riskRows.length
        ? riskRows.map((item) => `
          <tr>
            <td>${escapeHtml(item.type)}</td>
            <td>${escapeHtml(item.storeName || "-")}</td>
            <td>${escapeHtml(item.object || "-")}</td>
            <td>${escapeHtml(item.actor || "-")}</td>
            <td>${escapeHtml(item.content || "-")}</td>
            <td>${escapeHtml(item.createdAt || "-")}</td>
            <td><span class="inspection-table-badge inspection-badge-high">${escapeHtml(item.status)}</span></td>
          </tr>
        `).join("")
        : `<tr><td colspan="7">${latest ? "未发现 feedback、review、买家之声、Account Health 或售后邮件待处理记录。" : "等待自动巡检结果。"}</td></tr>`;
    }
    setText("#store-inspection-history-count", history.length ? `最近 ${history.length} 次` : "暂无历史", root);
    const historyTable = root?.querySelector?.("#store-inspection-history");
    if (historyTable) {
      historyTable.innerHTML = history.length
        ? history.map((item) => `
          <tr>
            <td>${escapeHtml(item.meta?.updatedAt || "-")}</td>
            <td><span class="inspection-table-badge ${autoInspectionBadgeClass(item.overall)}">${escapeHtml(item.overallLabel || "-")}</span></td>
            <td>${escapeHtml(item.meta?.storeCount ?? "-")}</td>
            <td>${escapeHtml(item.feedback?.count ?? 0)}</td>
            <td>${escapeHtml(item.review?.lowCount ?? 0)} / ${escapeHtml(item.review?.count ?? 0)}</td>
            <td>${escapeHtml(item.voiceOfBuyer?.count ?? 0)}</td>
            <td>${escapeHtml(item.accountHealth?.count ?? 0)}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="7">暂无历史巡检。</td></tr>`;
    }
  }

  function renderStoreInspectionSchedule(schedule = {}) {
    const enabled = root?.querySelector?.("#store-inspection-schedule-enabled");
    const sendTime = root?.querySelector?.("#store-inspection-send-time");
    if (enabled) enabled.checked = schedule.enabled !== false;
    if (sendTime) sendTime.value = schedule.sendTime || "08:30";
    setText(
      "#store-inspection-schedule-status",
      schedule.enabled === false
        ? "自动巡检已关闭"
        : `每日 ${schedule.sendTime || "08:30"} 发送${schedule.nextRunAt ? `，下次 ${schedule.nextRunAt}` : ""}`,
      root,
    );
  }

  async function loadStoreInspectionDashboard() {
    setText("#store-inspection-status-text", "正在读取自动巡检结果", root);
    try {
      const response = await fetch("/api/store-inspection/status", { cache: "no-store" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      storeInspectionDashboard = data;
      renderStoreInspectionSchedule(data.schedule);
      renderStoreInspectionPreview();
      renderStoreInspectionRecords();
    } catch (error) {
      setText("#store-inspection-status-text", `读取失败：${error.message}`, root);
    }
  }

  async function saveStoreInspectionSchedule(event) {
    event?.preventDefault();
    const button = root?.querySelector?.("#store-inspection-save-schedule");
    const enabled = !root?.querySelector?.("#store-inspection-schedule-enabled") || checkedField("#store-inspection-schedule-enabled", root);
    const sendTime = fieldValue("#store-inspection-send-time", "", root) || "08:30";
    const restoreButton = setButtonBusy(button, "保存中", "保存设置", { disable: false });
    setText("#store-inspection-schedule-status", "正在保存定时设置", root);
    try {
      const response = await fetch("/api/store-inspection/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, sendTime }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      storeInspectionDashboard = { ...(storeInspectionDashboard || {}), schedule: data.settings };
      renderStoreInspectionSchedule(data.settings);
    } catch (error) {
      setText("#store-inspection-schedule-status", `保存失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function runStoreInspectionNow() {
    const button = root?.querySelector?.("#store-inspection-run");
    const restoreButton = setButtonBusy(button, "巡检中", "立即巡检", { disable: false });
    setText("#store-inspection-status-text", "正在自动巡检", root);
    try {
      const response = await fetch("/api/store-inspection/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notify: false }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `API ${response.status}`);
      storeInspectionDashboard = { ...(storeInspectionDashboard || {}), latest: data, state: data.state || storeInspectionDashboard?.state, history: [data, ...(storeInspectionDashboard?.history || [])].slice(0, 30) };
      renderStoreInspectionPreview();
      renderStoreInspectionRecords();
      await loadStoreInspectionReport();
    } catch (error) {
      setText("#store-inspection-status-text", `巡检失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function copyStoreInspectionMarkdown(markdown) {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const textarea = root.createElement("textarea");
      textarea.value = markdown;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      root.body.appendChild(textarea);
      textarea.select();
      root.execCommand("copy");
      textarea.remove();
    }
  }

  async function loadStoreInspectionReport({ copy = false } = {}) {
    const button = root?.querySelector?.("#store-inspection-generate-report");
    const output = root?.querySelector?.("#store-inspection-report-output");
    const restoreButton = setButtonBusy(button, "生成中", "生成日报", { disable: false });
    setText("#store-inspection-report-status", "正在生成 Markdown 日报", root);
    try {
      const response = await fetch("/api/store-inspection/markdown", { cache: "no-store" });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `API ${response.status}`);
      storeInspectionReportMarkdown = data.markdown || "";
      if (output) output.value = storeInspectionReportMarkdown;
      if (copy) await copyStoreInspectionMarkdown(storeInspectionReportMarkdown);
      setText("#store-inspection-report-status", copy ? "日报已复制" : "日报已生成", root);
    } catch (error) {
      setText("#store-inspection-report-status", `日报生成失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function copyCurrentStoreInspectionReport() {
    const output = root?.querySelector?.("#store-inspection-report-output");
    const markdown = output?.value || storeInspectionReportMarkdown;
    if (markdown) {
      await copyStoreInspectionMarkdown(markdown);
      setText("#store-inspection-report-status", "日报已复制", root);
      return;
    }
    await loadStoreInspectionReport({ copy: true });
  }

  function setupStoreInspectionModule() {
    bind(root, "#store-inspection-refresh", "click", loadStoreInspectionDashboard);
    bind(root, "#store-inspection-run", "click", runStoreInspectionNow);
    bind(root, "#store-inspection-generate-report", "click", () => loadStoreInspectionReport());
    bind(root, "#store-inspection-copy-report", "click", copyCurrentStoreInspectionReport);
    bind(root, "#store-inspection-schedule-form", "submit", saveStoreInspectionSchedule);
    loadStoreInspectionDashboard();
  }

  return {
    loadStoreInspectionDashboard,
    renderStoreInspectionPreview,
    renderStoreInspectionRecords,
    setupStoreInspectionModule,
  };
}

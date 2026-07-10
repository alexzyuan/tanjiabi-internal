export function createAftersalesMailFeature({
  root = globalThis.document,
  bind,
  closestTarget,
  createDebouncedAction,
  escapeHtml,
  fieldValue,
  formatNumber,
  setButtonBusy,
  setElementsDisabled,
  setText,
  trimmedFieldValue,
} = {}) {
  if (typeof bind !== "function") throw new Error("createAftersalesMailFeature requires bind.");
  if (typeof createDebouncedAction !== "function") throw new Error("createAftersalesMailFeature requires createDebouncedAction.");

  let aftersalesMailDashboardData = null;
  let aftersalesMailSelectedUid = "";
  let aftersalesMailAttachmentObjectUrls = [];

  function aftersalesMailStatusText(status) {
    const map = {
      new: "新邮件",
      pending: "待回复",
      replied: "已回复",
    };
    return map[status] || status || "-";
  }

  function aftersalesMailStatusClass(status) {
    if (status === "replied") return "risk-low";
    if (status === "new") return "risk-high";
    return "risk-mid";
  }

  function aftersalesMailInitial(row = {}) {
    const source = String(row.from || row.fromAddress || "?").trim();
    return (source.match(/[a-zA-Z0-9]/)?.[0] || source[0] || "?").toUpperCase();
  }

  function formatAftersalesMailDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function filteredAftersalesMailRows() {
    const rows = aftersalesMailDashboardData?.messages || [];
    const status = fieldValue("#aftersales-mail-status-filter", "", root);
    const keyword = trimmedFieldValue("#aftersales-mail-keyword", "", root).toLowerCase();
    return rows.filter((row) => {
      if (status && row.status !== status) return false;
      if (!keyword) return true;
      return [row.from, row.fromAddress, row.subject, row.snippet, row.text].join(" ").toLowerCase().includes(keyword);
    });
  }

  function renderAftersalesMailDashboard() {
    const data = aftersalesMailDashboardData || {};
    const stats = data.stats || {};
    const meta = data.meta || {};
    setText("#aftersales-mail-new-count", formatNumber(stats.newCount || 0), root);
    setText("#aftersales-mail-pending-count", formatNumber(stats.pendingCount || 0), root);
    setText("#aftersales-mail-replied-count", formatNumber(stats.repliedCount || 0), root);
    setText("#aftersales-mail-synced-at", meta.updatedAt || "-", root);
    setText("#aftersales-mail-account", meta.account || "JM售后邮箱", root);
    setText("#aftersales-mail-status", `${meta.source || "站外售后邮箱"} · ${meta.syncStatus || "等待同步"}`, root);

    const rows = filteredAftersalesMailRows();
    setText("#aftersales-mail-table-count", rows.length ? `共 ${rows.length} 封邮件` : "暂无匹配邮件", root);
    const list = root?.querySelector?.("#aftersales-mail-table");
    if (!list) return;
    list.innerHTML = rows.length ? rows.map((row) => `
      <article data-aftersales-mail-uid="${escapeHtml(row.uid)}" class="aftersales-mail-item ${row.uid === aftersalesMailSelectedUid ? "is-selected" : ""}">
        <span class="aftersales-mail-avatar" aria-hidden="true">${escapeHtml(aftersalesMailInitial(row))}</span>
        <div class="aftersales-mail-item-main">
          <div class="aftersales-mail-item-top">
            <strong>${escapeHtml(row.from || row.fromAddress || "-")}</strong>
            <time>${escapeHtml(formatAftersalesMailDate(row.date))}</time>
          </div>
          <div class="aftersales-mail-item-subject">${escapeHtml(row.subject || "(无主题)")}</div>
          <div class="aftersales-mail-item-snippet">${escapeHtml(row.snippet || "-")}</div>
          <div class="aftersales-mail-item-foot">
            <span class="risk-badge ${aftersalesMailStatusClass(row.status)}">${escapeHtml(aftersalesMailStatusText(row.status))}</span>
            ${row.attachments?.length ? `<span>${row.attachments.length} 张附图</span>` : ""}
          </div>
        </div>
      </article>
    `).join("") : `<div class="aftersales-mail-empty">${data.configured === false ? "邮箱未配置，请先配置 163 授权码。" : "暂无匹配邮件。"}</div>`;
  }

  async function loadAftersalesMailDashboard({ sync = false } = {}) {
    const syncButton = root?.querySelector?.("#aftersales-mail-sync");
    const refreshButton = root?.querySelector?.("#aftersales-mail-refresh");
    const busyButtons = setElementsDisabled([syncButton, refreshButton], true, root);
    setText("#aftersales-mail-status", sync ? "正在同步 163 邮箱" : "正在读取邮箱缓存", root);
    try {
      const response = await fetch(sync ? "/api/aftersales-mail/sync" : "/api/aftersales-mail/dashboard", {
        method: sync ? "POST" : "GET",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.meta?.syncStatus || `API ${response.status}`);
      aftersalesMailDashboardData = data;
      if (!aftersalesMailSelectedUid && data.messages?.[0]?.uid) aftersalesMailSelectedUid = data.messages[0].uid;
      renderAftersalesMailDashboard();
      if (aftersalesMailSelectedUid) await loadAftersalesMailDetail(aftersalesMailSelectedUid);
    } catch (error) {
      aftersalesMailDashboardData = {
        configured: false,
        messages: [],
        stats: {},
        meta: { source: "站外售后邮箱", syncStatus: `读取失败：${error.message}` },
      };
      renderAftersalesMailDashboard();
    } finally {
      setElementsDisabled(busyButtons, false, root);
    }
  }

  function clearAftersalesMailAttachmentObjectUrls() {
    aftersalesMailAttachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    aftersalesMailAttachmentObjectUrls = [];
  }

  async function loadAftersalesMailAttachmentImages(container) {
    const images = Array.from(container?.querySelectorAll("img[data-aftersales-mail-attachment-url]") || []);
    await Promise.all(images.map(async (image) => {
      const url = image.dataset.aftersalesMailAttachmentUrl;
      if (!url) return;
      try {
        const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        aftersalesMailAttachmentObjectUrls.push(objectUrl);
        image.src = objectUrl;
        image.classList.remove("is-loading");
      } catch {
        image.classList.remove("is-loading");
        image.classList.add("is-error");
        image.alt = "图片加载失败";
        const link = image.closest("a");
        if (link) link.title = "图片加载失败，请重新同步邮箱后再试";
      }
    }));
  }

  function renderAftersalesMailDetail(data) {
    const mail = data?.mail;
    if (!mail) return;
    setText("#aftersales-mail-detail-status", aftersalesMailStatusText(mail.status), root);
    const meta = root?.querySelector?.("#aftersales-mail-meta");
    if (meta) {
      meta.innerHTML = `
        <strong>${escapeHtml(mail.subject || "(无主题)")}</strong>
        <span>${escapeHtml(mail.from || mail.fromAddress || "-")}</span>
        <small>${escapeHtml(String(mail.date || "-"))}</small>
      `;
    }
    const body = root?.querySelector?.("#aftersales-mail-body");
    if (body) body.textContent = mail.text || mail.snippet || "这封邮件没有可解析的正文。";
    const attachments = root?.querySelector?.("#aftersales-mail-attachments");
    if (attachments) {
      clearAftersalesMailAttachmentObjectUrls();
      const rows = mail.attachments || [];
      attachments.innerHTML = rows.length ? `
        <h3>邮件附图</h3>
        <div class="aftersales-mail-attachment-grid">
          ${rows.map((item) => `
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.filename || "邮件附图")}">
              <img class="is-loading" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-aftersales-mail-attachment-url="${escapeHtml(item.url)}" alt="${escapeHtml(item.filename || "邮件附图")}" loading="lazy" />
              <span>${escapeHtml(item.filename || "邮件附图")}</span>
            </a>
          `).join("")}
        </div>
      ` : "";
      loadAftersalesMailAttachmentImages(attachments);
    }
    const suggestion = root?.querySelector?.("#aftersales-mail-ai-suggestion");
    if (suggestion) suggestion.value = data.suggestion?.suggestion || "";
    const replies = root?.querySelector?.("#aftersales-mail-replies");
    if (replies) {
      const rows = data.replies || [];
      replies.innerHTML = rows.length ? rows.map((reply) => `
        <article>
          <strong>${escapeHtml(reply.subject || "-")}</strong>
          <span>${escapeHtml(reply.sentAt || "-")} · ${escapeHtml(reply.operator || "ERP")}</span>
          <p>${escapeHtml(reply.bodySnippet || "")}</p>
        </article>
      `).join("") : "暂无 ERP 回复记录。";
    }
  }

  async function loadAftersalesMailDetail(uid) {
    aftersalesMailSelectedUid = String(uid || "");
    renderAftersalesMailDashboard();
    if (!aftersalesMailSelectedUid) return;
    setText("#aftersales-mail-detail-status", "正在读取邮件详情", root);
    try {
      const response = await fetch(`/api/aftersales-mail/messages/${encodeURIComponent(aftersalesMailSelectedUid)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      renderAftersalesMailDetail(data);
    } catch (error) {
      setText("#aftersales-mail-detail-status", `读取失败：${error.message}`, root);
    }
  }

  async function generateAftersalesMailAiSuggestion() {
    if (!aftersalesMailSelectedUid) {
      const firstUid = (aftersalesMailDashboardData?.messages || [])[0]?.uid;
      if (firstUid) {
        await loadAftersalesMailDetail(firstUid);
      } else {
        setText("#aftersales-mail-detail-status", "请先选择一封邮件", root);
        const textarea = root?.querySelector?.("#aftersales-mail-ai-suggestion");
        if (textarea) textarea.value = "请先选择一封邮件后再生成 AI 回复建议。";
        return;
      }
    }
    const button = root?.querySelector?.("#aftersales-mail-ai-refresh");
    const textarea = root?.querySelector?.("#aftersales-mail-ai-suggestion");
    const restoreButton = setButtonBusy(button, "生成中...", "生成建议");
    if (textarea) textarea.value = "AI 正在基于这封邮件全文提取有效内容，并生成英文回复建议...";
    try {
      const response = await fetch(`/api/aftersales-mail/messages/${encodeURIComponent(aftersalesMailSelectedUid)}/ai-suggestion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      if (textarea) textarea.value = data.suggestion?.suggestion || "AI 未返回可用回复建议。";
      setText("#aftersales-mail-detail-status", "AI 回复建议已生成", root);
    } catch (error) {
      if (textarea) textarea.value = `AI 暂不可用：${error.message}`;
      setText("#aftersales-mail-detail-status", `AI 暂不可用：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  function useAftersalesMailAiSuggestion() {
    const suggestion = fieldValue("#aftersales-mail-ai-suggestion", "", root);
    const reply = root?.querySelector?.("#aftersales-mail-reply-body");
    if (reply && suggestion) reply.value = suggestion;
  }

  async function sendAftersalesMailReply() {
    if (!aftersalesMailSelectedUid) return;
    const body = fieldValue("#aftersales-mail-reply-body", "", root);
    if (!body.trim()) {
      setText("#aftersales-mail-detail-status", "请先填写回复正文", root);
      return;
    }
    const button = root?.querySelector?.("#aftersales-mail-send-reply");
    const restoreButton = setButtonBusy(button, "发送中...", "发送回复");
    try {
      const response = await fetch(`/api/aftersales-mail/messages/${encodeURIComponent(aftersalesMailSelectedUid)}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      const reply = root?.querySelector?.("#aftersales-mail-reply-body");
      if (reply) reply.value = "";
      setText("#aftersales-mail-detail-status", "回复已发送", root);
      await loadAftersalesMailDashboard();
      await loadAftersalesMailDetail(aftersalesMailSelectedUid);
    } catch (error) {
      setText("#aftersales-mail-detail-status", `发送失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function updateAftersalesMailManualStatus(status, successText) {
    if (!aftersalesMailSelectedUid) return;
    try {
      const response = await fetch(`/api/aftersales-mail/messages/${encodeURIComponent(aftersalesMailSelectedUid)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      aftersalesMailDashboardData = data.dashboard;
      setText("#aftersales-mail-detail-status", successText, root);
      renderAftersalesMailDashboard();
      await loadAftersalesMailDetail(aftersalesMailSelectedUid);
    } catch (error) {
      setText("#aftersales-mail-detail-status", `标记失败：${error.message}`, root);
    }
  }

  async function markAftersalesMailPending() {
    return updateAftersalesMailManualStatus("pending", "已标记待处理");
  }

  async function markAftersalesMailReplied() {
    return updateAftersalesMailManualStatus("replied", "已标记已回复");
  }

  function handleAftersalesMailTableClick(event) {
    const row = closestTarget(event, "[data-aftersales-mail-uid]");
    if (row) loadAftersalesMailDetail(row.dataset.aftersalesMailUid);
  }

  const scheduleAftersalesMailRender = createDebouncedAction(renderAftersalesMailDashboard, 200);

  function setupAftersalesMail() {
    bind(root, "#aftersales-mail-refresh", "click", () => loadAftersalesMailDashboard());
    bind(root, "#aftersales-mail-sync", "click", () => loadAftersalesMailDashboard({ sync: true }));
    bind(root, "#aftersales-mail-status-filter", "change", scheduleAftersalesMailRender);
    bind(root, "#aftersales-mail-keyword", "input", scheduleAftersalesMailRender);
    bind(root, "#aftersales-mail-table", "click", handleAftersalesMailTableClick);
    bind(root, "#aftersales-mail-ai-refresh", "click", generateAftersalesMailAiSuggestion);
    bind(root, "#aftersales-mail-use-ai", "click", useAftersalesMailAiSuggestion);
    bind(root, "#aftersales-mail-send-reply", "click", sendAftersalesMailReply);
    bind(root, "#aftersales-mail-mark-pending", "click", markAftersalesMailPending);
    bind(root, "#aftersales-mail-mark-replied", "click", markAftersalesMailReplied);
  }

  return {
    generateAftersalesMailAiSuggestion,
    handleAftersalesMailTableClick,
    loadAftersalesMailDashboard,
    loadAftersalesMailDetail,
    markAftersalesMailPending,
    markAftersalesMailReplied,
    renderAftersalesMailDashboard,
    scheduleAftersalesMailRender,
    sendAftersalesMailReply,
    setupAftersalesMail,
    useAftersalesMailAiSuggestion,
  };
}

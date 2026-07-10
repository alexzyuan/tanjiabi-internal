export function createTopbarStatusFeature({
  root = globalThis.document,
  timeZones = [
    { label: "北京时间", timeZone: "Asia/Shanghai" },
    { label: "美西时间", timeZone: "America/Los_Angeles" },
    { label: "德国时间", timeZone: "Europe/Berlin" },
    { label: "澳洲时间", timeZone: "Australia/Sydney" },
  ],
  escapeHtml,
  setExclusiveClassState,
  setText,
} = {}) {
  if (typeof escapeHtml !== "function") throw new Error("createTopbarStatusFeature requires escapeHtml.");
  if (typeof setExclusiveClassState !== "function") throw new Error("createTopbarStatusFeature requires setExclusiveClassState.");
  if (typeof setText !== "function") throw new Error("createTopbarStatusFeature requires setText.");

  const syncToneClasses = ["sync-success", "sync-error", "sync-running", "sync-pending"];
  const timeFormatters = new Map();
  let topbarSyncState = { status: "待同步", time: "暂无记录", tone: "sync-pending" };

  function formatTimeInZone(timeZone, date = new Date()) {
    if (!timeFormatters.has(timeZone)) {
      timeFormatters.set(timeZone, new Intl.DateTimeFormat("zh-CN", {
        timeZone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }));
    }
    return timeFormatters.get(timeZone).format(date);
  }

  function updateWorldClock() {
    const clock = root?.querySelector?.("#world-clock");
    if (!clock) return;
    const periodText = root?.querySelector?.("#period-text");
    const syncTone = topbarSyncState.tone || "sync-pending";
    clock.innerHTML = `${timeZones
      .map((item) => `<span>${item.label}：${formatTimeInZone(item.timeZone)}</span>`)
      .join("")}<span class="topbar-sync ${syncTone}" id="topbar-sync-card"><i class="sync-dot" aria-hidden="true"></i><strong id="topbar-sync-state">${escapeHtml(topbarSyncState.status || "待同步")}</strong><small id="topbar-sync-time">${escapeHtml(topbarSyncState.time || "暂无记录")}</small></span>`;
    if (periodText) clock.appendChild(periodText);
  }

  function renderTopbarSyncStatus(status, time, tone = "sync-pending") {
    topbarSyncState = {
      status: status || "待同步",
      time: time || "暂无记录",
      tone: tone || "sync-pending",
    };
    const card = root?.querySelector?.("#topbar-sync-card");
    setText("#topbar-sync-state", topbarSyncState.status, root);
    setText("#topbar-sync-time", topbarSyncState.time, root);
    setExclusiveClassState(card, syncToneClasses, topbarSyncState.tone);
  }

  return {
    renderTopbarSyncStatus,
    syncToneClasses,
    updateWorldClock,
  };
}

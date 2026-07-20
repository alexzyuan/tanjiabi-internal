import { randomUUID } from "node:crypto";
import path from "node:path";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";
import { sendDingTalkTextToWebhook } from "./dingtalkService.js";

const schedulerPollMs = 30 * 1000;
const scheduleModes = new Set(["once", "daily", "interval"]);
let defaultService = null;
let schedulerStarted = false;

function nowIso(now) {
  return now.toISOString();
}

function listValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireText(payload, key, label) {
  const value = String(payload?.[key] || "").trim();
  if (!value) throw new Error(`${label}不能为空。`);
  return value;
}

function requireValue(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function normalizeWebhook(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Webhook 地址不能为空。");
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Webhook 地址必须是 http 或 https。");
  return url.toString();
}

function normalizeSendTime(value) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error("每日定时发送时间格式必须是 HH:mm。");
  const [hour, minute] = text.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("每日定时发送时间不合法。");
  return text;
}

function normalizeRunAt(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("一次性发送时间不能为空。");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("一次性发送时间不合法。");
  return date.toISOString();
}

function normalizeIntervalMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new Error("循环发送间隔必须是 1 到 10080 分钟。");
  }
  return minutes;
}

function beijingDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addBeijingDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  return beijingDateParts(new Date(date.getTime() + days * 24 * 60 * 60 * 1000));
}

function nextDailyRun(sendTime, now) {
  const today = beijingDateParts(now);
  const candidate = `${today}T${sendTime}:00+08:00`;
  if (new Date(candidate).getTime() > now.getTime()) return candidate;
  return `${addBeijingDays(today, 1)}T${sendTime}:00+08:00`;
}

function calculateNextRunAt(task, now = new Date()) {
  if (task.scheduleMode === "once") return task.runAt || "";
  if (task.scheduleMode === "daily") return nextDailyRun(task.sendTime, now);
  if (task.scheduleMode === "interval") {
    return new Date(now.getTime() + task.intervalMinutes * 60 * 1000).toISOString();
  }
  return "";
}

function maskWebhook(webhook) {
  try {
    const url = new URL(webhook);
    const token = url.searchParams.get("access_token");
    if (token) url.searchParams.set("access_token", `${token.slice(0, 4)}...${token.slice(-4)}`);
    return url.toString();
  } catch {
    return webhook ? "已配置" : "";
  }
}

function sanitizeTask(task) {
  const { secret: _secret, rawWebhook: _rawWebhook, ...safe } = task;
  return {
    ...safe,
    webhook: maskWebhook(task.webhook),
    secretConfigured: Boolean(task.secret),
  };
}

function normalizeTaskPayload(payload = {}, previous = null, now = new Date()) {
  const scheduleMode = String(payload.scheduleMode || previous?.scheduleMode || "once").trim();
  if (!scheduleModes.has(scheduleMode)) throw new Error("发送方式必须是 once、daily 或 interval。");
  const next = {
    ...(previous || {}),
    name: requireValue(payload.name ?? previous?.name, "任务名称"),
    webhook: payload.webhook ? normalizeWebhook(payload.webhook) : previous?.webhook || normalizeWebhook(payload.webhook),
    secret: payload.secret === undefined || payload.secret === "" ? previous?.secret || "" : String(payload.secret || "").trim(),
    message: requireValue(payload.message ?? previous?.message, "发送内容"),
    scheduleMode,
    atAll: payload.atAll === undefined ? previous?.atAll === true : payload.atAll === true,
    atMobiles: payload.atMobiles === undefined ? previous?.atMobiles || [] : listValue(payload.atMobiles),
    atUserIds: payload.atUserIds === undefined ? previous?.atUserIds || [] : listValue(payload.atUserIds),
    enabled: payload.enabled === undefined ? previous?.enabled !== false : payload.enabled === true,
  };

  if (scheduleMode === "once") {
    next.runAt = payload.runAt === undefined && previous?.runAt ? previous.runAt : normalizeRunAt(payload.runAt);
    next.sendTime = "";
    next.intervalMinutes = 0;
  } else if (scheduleMode === "daily") {
    next.sendTime = payload.sendTime === undefined && previous?.sendTime ? previous.sendTime : normalizeSendTime(payload.sendTime);
    next.runAt = "";
    next.intervalMinutes = 0;
  } else {
    next.intervalMinutes = payload.intervalMinutes === undefined && previous?.intervalMinutes
      ? previous.intervalMinutes
      : normalizeIntervalMinutes(payload.intervalMinutes);
    next.runAt = "";
    next.sendTime = "";
  }
  next.nextRunAt = calculateNextRunAt(next, now);
  return next;
}

export function createWebhookAssistantService({
  dataDir = path.join(process.cwd(), "data-cache"),
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const storePath = path.join(dataDir, "webhook-assistant-tasks.json");

  async function readState() {
    const state = await readJson(storePath, { tasks: [] });
    return { tasks: Array.isArray(state.tasks) ? state.tasks : [] };
  }

  async function updateState(updater) {
    return updateJsonAtomic(storePath, async (current) => {
      const draft = { tasks: Array.isArray(current?.tasks) ? current.tasks : [] };
      await updater(draft);
      return draft;
    }, { tasks: [] });
  }

  async function listWebhookTasks() {
    const state = await readState();
    return { ok: true, tasks: state.tasks.map(sanitizeTask) };
  }

  async function createWebhookTask(payload = {}) {
    const createdAt = nowIso(now());
    let task = null;
    await updateState((draft) => {
      task = {
        id: randomUUID(),
        ...normalizeTaskPayload(payload, null, now()),
        status: "idle",
        lastStatus: "等待发送",
        lastError: "",
        lastRunAt: "",
        runCount: 0,
        createdAt,
        updatedAt: createdAt,
      };
      draft.tasks.unshift(task);
    });
    return { ok: true, task: sanitizeTask(task) };
  }

  async function updateWebhookTask(id, payload = {}) {
    let task = null;
    await updateState((draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("Webhook 任务不存在。");
      task = {
        ...normalizeTaskPayload(payload, draft.tasks[index], now()),
        id: draft.tasks[index].id,
        createdAt: draft.tasks[index].createdAt,
        updatedAt: nowIso(now()),
      };
      draft.tasks[index] = task;
    });
    return { ok: true, task: sanitizeTask(task) };
  }

  async function deleteWebhookTask(id) {
    let removed = null;
    await updateState((draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("Webhook 任务不存在。");
      [removed] = draft.tasks.splice(index, 1);
    });
    return { ok: true, task: sanitizeTask(removed) };
  }

  async function sendWebhookTask(task, trigger = "manual") {
    return sendDingTalkTextToWebhook({
      webhook: task.webhook,
      secret: task.secret,
      atMobiles: task.atMobiles,
      atUserIds: task.atUserIds,
    }, task.message, { atAll: task.atAll }, "WEBHOOK", fetchImpl);
  }

  async function persistSendResult(id, result, error, trigger) {
    let task = null;
    await updateState((draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("Webhook 任务不存在。");
      const current = draft.tasks[index];
      const sentAt = nowIso(now());
      const ok = !error && result?.ok;
      task = {
        ...current,
        enabled: current.scheduleMode === "once" && ok ? false : current.enabled,
        status: ok ? "success" : "failed",
        lastStatus: ok ? "发送成功" : "发送失败",
        lastError: ok ? "" : error?.message || result?.payload?.errmsg || "钉钉返回失败",
        lastRunAt: sentAt,
        runCount: Number(current.runCount || 0) + (ok ? 1 : 0),
        updatedAt: sentAt,
      };
      task.nextRunAt = task.enabled ? calculateNextRunAt(task, now()) : "";
      draft.tasks[index] = task;
    });
    return sanitizeTask(task);
  }

  async function sendWebhookTaskNow(id, trigger = "manual") {
    const state = await readState();
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new Error("Webhook 任务不存在。");
    try {
      const result = await sendWebhookTask(task, trigger);
      return { ok: Boolean(result.ok), task: await persistSendResult(id, result, null, trigger), result };
    } catch (error) {
      console.error("[webhook-assistant] send failed", { id, name: task.name, trigger, error: error.message });
      return { ok: false, task: await persistSendResult(id, null, error, trigger), error: error.message };
    }
  }

  async function runDueWebhookTasks() {
    const state = await readState();
    const currentTime = now().getTime();
    const due = state.tasks.filter((task) => task.enabled && task.nextRunAt && new Date(task.nextRunAt).getTime() <= currentTime);
    let sent = 0;
    for (const task of due) {
      const result = await sendWebhookTaskNow(task.id, "scheduler");
      if (result.ok) sent += 1;
    }
    return { ok: true, checked: state.tasks.length, due: due.length, sent };
  }

  return {
    createWebhookTask,
    deleteWebhookTask,
    listWebhookTasks,
    runDueWebhookTasks,
    sendWebhookTaskNow,
    updateWebhookTask,
  };
}

function getDefaultService() {
  if (!defaultService) defaultService = createWebhookAssistantService();
  return defaultService;
}

export function listWebhookTasks() {
  return getDefaultService().listWebhookTasks();
}

export function createWebhookTask(payload) {
  return getDefaultService().createWebhookTask(payload);
}

export function updateWebhookTask(id, payload) {
  return getDefaultService().updateWebhookTask(id, payload);
}

export function deleteWebhookTask(id) {
  return getDefaultService().deleteWebhookTask(id);
}

export function sendWebhookTaskNow(id, trigger) {
  return getDefaultService().sendWebhookTaskNow(id, trigger);
}

export function runDueWebhookTasks() {
  return getDefaultService().runDueWebhookTasks();
}

export function startWebhookAssistantScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => {
    runDueWebhookTasks().catch((error) => {
      console.error("[webhook-assistant] scheduler tick failed", { error: error.message });
    });
  }, schedulerPollMs);
}

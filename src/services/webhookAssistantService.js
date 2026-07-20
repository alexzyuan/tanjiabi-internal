import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "../config/index.js";
import { readJson, updateJsonAtomic } from "../utils/jsonStore.js";
import { sendDingTalkTextToWebhook } from "./dingtalkService.js";

const schedulerPollMs = 30 * 1000;
const scheduleModes = new Set(["daily", "weekly", "monthly"]);
const defaultTargetKey = "fba-sta";
let defaultService = null;
let schedulerStarted = false;

function nowIso(now) {
  return now.toISOString();
}

function requireValue(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function normalizeMessage(value, previous = null) {
  if (value === undefined && previous?.message) return previous.message;
  return requireValue(value, "消息内容");
}

function normalizeSendTime(value) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error("发送时间格式必须是 HH:mm。");
  const [hour, minute] = text.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("发送时间不合法。");
  return text;
}

function normalizeWeekday(value) {
  const weekday = Number(value || 0);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("每周发送日必须是 1 到 7。");
  return weekday;
}

function normalizeMonthDay(value) {
  const day = Number(value || 0);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("每月发送日期必须是 1 到 31。");
  return day;
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

function beijingWeekday(dateText) {
  const day = new Date(`${dateText}T12:00:00+08:00`).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysInBeijingMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextDailyRun(sendTime, now) {
  const today = beijingDateParts(now);
  const candidate = `${today}T${sendTime}:00+08:00`;
  if (new Date(candidate).getTime() > now.getTime()) return candidate;
  return `${addBeijingDays(today, 1)}T${sendTime}:00+08:00`;
}

function nextWeeklyRun(weekday, sendTime, now) {
  const today = beijingDateParts(now);
  const currentWeekday = beijingWeekday(today);
  const offset = (weekday - currentWeekday + 7) % 7;
  const candidateDate = addBeijingDays(today, offset);
  const candidate = `${candidateDate}T${sendTime}:00+08:00`;
  if (new Date(candidate).getTime() > now.getTime()) return candidate;
  return `${addBeijingDays(candidateDate, 7)}T${sendTime}:00+08:00`;
}

function nextMonthlyRun(monthDay, sendTime, now) {
  const today = beijingDateParts(now);
  const [yearText, monthText] = today.split("-");
  let year = Number(yearText);
  let month = Number(monthText);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const clampedDay = Math.min(monthDay, daysInBeijingMonth(year, month));
    const candidateDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
    const candidate = `${candidateDate}T${sendTime}:00+08:00`;
    if (new Date(candidate).getTime() > now.getTime()) return candidate;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  throw new Error("无法计算下次每月发送时间。");
}

function calculateNextRunAt(task, now = new Date()) {
  if (task.scheduleMode === "daily") return nextDailyRun(task.sendTime, now);
  if (task.scheduleMode === "weekly") return nextWeeklyRun(task.weekday, task.sendTime, now);
  if (task.scheduleMode === "monthly") return nextMonthlyRun(task.monthDay, task.sendTime, now);
  return "";
}

function resolveDefaultWebhookTargets(config = getConfig()) {
  return {
    "fba-sta": {
      key: "fba-sta",
      label: "FBA刷仓",
      webhook: config.dingtalk?.fba?.webhook || "",
      secret: config.dingtalk?.fba?.secret || "",
    },
    default: {
      key: "default",
      label: "企业总群",
      webhook: config.dingtalk?.webhook || "",
      secret: config.dingtalk?.secret || "",
    },
  };
}

function normalizeTargets(targets) {
  return Object.entries(targets || {}).reduce((acc, [key, target]) => {
    acc[key] = {
      key,
      label: String(target?.label || key).trim(),
      webhook: String(target?.webhook || "").trim(),
      secret: String(target?.secret || "").trim(),
    };
    return acc;
  }, {});
}

function sanitizeTargets(targets) {
  return Object.values(targets).map((target) => ({
    key: target.key,
    label: target.label,
    configured: Boolean(target.webhook),
    secretConfigured: Boolean(target.secret),
  }));
}

function inferTargetKeyFromTask(task, targets = {}) {
  if (task.targetKey && targets[task.targetKey]) return task.targetKey;
  const webhook = String(task.webhook || "").trim();
  if (!webhook) return "";
  return Object.values(targets).find((target) => target.webhook === webhook)?.key || "";
}

function sanitizeTask(task, targets = {}) {
  const { secret: _secret, webhook: _webhook, rawWebhook: _rawWebhook, ...safe } = task;
  const targetKey = inferTargetKeyFromTask(task, targets);
  const target = targets[targetKey] || {};
  return {
    ...safe,
    targetKey,
    targetLabel: target.label || targetKey || "",
    targetConfigured: Boolean(target.webhook),
  };
}

function normalizeTargetKey(value, previous, targets) {
  const targetKey = String(value || previous?.targetKey || defaultTargetKey).trim();
  const target = targets[targetKey];
  if (!target) throw new Error("Webhook 目标不存在。");
  if (!target.webhook) throw new Error(`${target.label} webhook 未配置。`);
  return targetKey;
}

function normalizeTaskPayload(payload = {}, previous = null, now = new Date(), targets = {}) {
  const scheduleMode = String(payload.scheduleMode || previous?.scheduleMode || "daily").trim();
  if (!scheduleModes.has(scheduleMode)) throw new Error("发送方式必须是 daily、weekly 或 monthly。");
  const next = {
    ...(previous || {}),
    name: requireValue(payload.name ?? previous?.name, "任务名称"),
    message: normalizeMessage(payload.message, previous),
    atAll: payload.atAll === undefined ? previous?.atAll === true : payload.atAll === true,
    targetKey: normalizeTargetKey(payload.targetKey, previous, targets),
    scheduleMode,
    enabled: payload.enabled === undefined ? previous?.enabled !== false : payload.enabled === true,
    sendTime: payload.sendTime === undefined && previous?.sendTime ? previous.sendTime : normalizeSendTime(payload.sendTime),
  };

  if (scheduleMode === "weekly") {
    next.weekday = payload.weekday === undefined && previous?.weekday ? previous.weekday : normalizeWeekday(payload.weekday);
    next.monthDay = 0;
  } else if (scheduleMode === "monthly") {
    next.monthDay = payload.monthDay === undefined && previous?.monthDay ? previous.monthDay : normalizeMonthDay(payload.monthDay);
    next.weekday = 0;
  } else {
    next.weekday = 0;
    next.monthDay = 0;
  }
  next.nextRunAt = calculateNextRunAt(next, now);
  return next;
}

export function createWebhookAssistantService({
  dataDir = path.join(process.cwd(), "data-cache"),
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  webhookTargets = null,
  config = getConfig(),
} = {}) {
  const storePath = path.join(dataDir, "webhook-assistant-tasks.json");
  const targets = normalizeTargets(webhookTargets || resolveDefaultWebhookTargets(config));

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
    return { ok: true, targets: sanitizeTargets(targets), tasks: state.tasks.map((task) => sanitizeTask(task, targets)) };
  }

  async function createWebhookTask(payload = {}) {
    const createdAt = nowIso(now());
    let task = null;
    await updateState((draft) => {
      task = {
        id: randomUUID(),
        ...normalizeTaskPayload(payload, null, now(), targets),
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
    return { ok: true, task: sanitizeTask(task, targets) };
  }

  async function updateWebhookTask(id, payload = {}) {
    let task = null;
    await updateState((draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("Webhook 任务不存在。");
      task = {
        ...normalizeTaskPayload(payload, draft.tasks[index], now(), targets),
        id: draft.tasks[index].id,
        createdAt: draft.tasks[index].createdAt,
        updatedAt: nowIso(now()),
      };
      draft.tasks[index] = task;
    });
    return { ok: true, task: sanitizeTask(task, targets) };
  }

  async function deleteWebhookTask(id) {
    let removed = null;
    await updateState((draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("Webhook 任务不存在。");
      [removed] = draft.tasks.splice(index, 1);
    });
    return { ok: true, task: sanitizeTask(removed, targets) };
  }

  async function sendWebhookTask(task, trigger = "manual") {
    const targetKey = inferTargetKeyFromTask(task, targets);
    const target = targets[targetKey];
    if (!target?.webhook) throw new Error(`${target?.label || targetKey || "Webhook 目标"} webhook 未配置。`);
    return sendDingTalkTextToWebhook({
      webhook: target.webhook,
      secret: target.secret,
      atMobiles: [],
      atUserIds: [],
    }, task.message || task.name, { atAll: task.atAll === true }, "WEBHOOK", fetchImpl);
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
        enabled: current.enabled,
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
    return sanitizeTask(task, targets);
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

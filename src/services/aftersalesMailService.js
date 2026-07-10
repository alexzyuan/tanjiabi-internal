import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { getConfig } from "../config/index.js";
import { generateAftersalesReplySuggestion } from "./modelscopeService.js";
import { resolveActiveAiProviderConfig } from "./aiProviderService.js";

const cacheDir = path.join(process.cwd(), "data-cache");
const latestFile = path.join(cacheDir, "aftersales-mail-latest.json");
const repliesFile = path.join(cacheDir, "aftersales-mail-replies.json");
const suggestionsFile = path.join(cacheDir, "aftersales-mail-ai-suggestions.json");
const attachmentsDir = path.join(cacheDir, "aftersales-mail-attachments");

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function isoNow() {
  return new Date().toISOString();
}

function safeText(value, maxLength = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeFileName(value, fallback = "attachment") {
  const name = String(value || fallback).normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return name || fallback;
}

function imageExtensionFromType(contentType = "", filename = "") {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("svg")) return ".svg";
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(ext) ? ext : ".jpg";
}

function isImageAttachment(attachment = {}) {
  return String(attachment.contentType || "").toLowerCase().startsWith("image/");
}

function messageUid(value) {
  return String(value ?? "").trim();
}

function normalizeMessageId(value) {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function uidSetHas(set, uid) {
  if (!set) return false;
  return set.has(uid) || set.has(Number(uid));
}

function firstAddress(value) {
  const item = Array.isArray(value) ? value[0] : value;
  if (!item) return { name: "", address: "" };
  if (typeof item === "string") return { name: "", address: item };
  return {
    name: String(item.name || "").trim(),
    address: String(item.address || "").trim(),
  };
}

function formatAddress(value) {
  const address = firstAddress(value);
  if (!address.name) return address.address;
  if (!address.address) return address.name;
  return `${address.name} <${address.address}>`;
}

function formatAddressList(value) {
  return (Array.isArray(value) ? value : [value]).map(formatAddress).filter(Boolean).join("; ");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mailConfigured(config = getConfig().aftersalesMail) {
  return Boolean(config?.enabled && config?.user && config?.password && config?.imapHost && config?.smtpHost);
}

function defaultLatest(config = getConfig().aftersalesMail) {
  return {
    ok: mailConfigured(config),
    configured: mailConfigured(config),
    messages: [],
    stats: summarizeMailRows([]),
    meta: {
      account: config?.user || "jmcustomer@163.com",
      source: "站外售后邮箱",
      syncStatus: mailConfigured(config) ? "等待首次同步" : "邮箱未配置",
      updatedAt: "",
    },
  };
}

export function normalizeMailRecord(raw = {}, state = {}) {
  const uid = messageUid(raw.uid);
  const envelope = raw.envelope || {};
  const fromValue = raw.from || envelope.from || raw.fromAddress || "";
  const fromAddress = firstAddress(fromValue).address || String(raw.fromAddress || "").trim();
  const text = String(raw.text || raw.html || "").trim();
  const replied = uidSetHas(state.repliedUids, uid);
  const known = uidSetHas(state.knownUids, uid);
  const status = replied ? "replied" : known ? "pending" : "new";
  return {
    uid,
    messageId: raw.messageId || envelope.messageId || "",
    date: raw.date || envelope.date || "",
    from: raw.from ? String(raw.from) : formatAddress(fromValue),
    fromAddress,
    subject: String(raw.subject || envelope.subject || "(无主题)").trim() || "(无主题)",
    snippet: safeText(raw.snippet || text, 240),
    text,
    attachments: normalizeMailAttachments(raw.attachments || []),
    seen: raw.seen === true || raw.flags?.has?.("\\Seen") || raw.flags?.has?.("Seen") || false,
    isNew: !known && !replied,
    status,
    lastSyncedAt: raw.lastSyncedAt || isoNow(),
  };
}

function normalizeMailAttachments(attachments = []) {
  return attachments
    .filter(isImageAttachment)
    .map((attachment) => ({
      id: safeText(attachment.id || attachment.cid || attachment.contentId || attachment.filename, 120),
      filename: safeText(attachment.filename || "image.jpg", 240),
      storedName: safeText(attachment.storedName || storedNameFromAttachmentUrl(attachment.url), 240),
      contentType: safeText(attachment.contentType || "image/jpeg", 120),
      size: Number(attachment.size || 0),
      url: attachment.url || "",
    }))
    .filter((attachment) => attachment.url);
}

function storedNameFromAttachmentUrl(url = "") {
  try {
    return path.basename(new URL(String(url), "http://local.test").pathname);
  } catch {
    return "";
  }
}

export function summarizeMailRows(rows = []) {
  return rows.reduce((acc, row) => {
    acc.totalCount += 1;
    if (row.isNew || row.status === "new") acc.newCount += 1;
    if (row.status === "new" || row.status === "pending") acc.pendingCount += 1;
    if (row.status === "replied") acc.repliedCount += 1;
    return acc;
  }, {
    totalCount: 0,
    newCount: 0,
    pendingCount: 0,
    repliedCount: 0,
  });
}

export function buildReplyMessage(mail = {}, payload = {}) {
  const subject = String(mail.subject || "").trim();
  const message = {
    from: payload.user,
    to: mail.fromAddress,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject || "(无主题)"}`,
    text: String(payload.body || "").trim(),
  };
  if (mail.messageId) {
    message.inReplyTo = mail.messageId;
    message.references = [mail.messageId];
  }
  return message;
}

function referenceMessageIds(message = {}) {
  const references = Array.isArray(message.references)
    ? message.references
    : String(message.references || "").split(/\s+/);
  return [
    message.inReplyTo,
    ...references,
  ].map(normalizeMessageId).filter(Boolean);
}

export function buildExternalSentReplies(inboxRows = [], sentMessages = [], { operator = "邮箱已发送" } = {}) {
  const inboxByMessageId = new Map(
    inboxRows
      .map((row) => [normalizeMessageId(row.messageId), row])
      .filter(([messageId]) => messageId),
  );
  return sentMessages.flatMap((message) => {
    const original = referenceMessageIds(message).map((messageId) => inboxByMessageId.get(messageId)).find(Boolean);
    if (!original) return [];
    const mailbox = message.mailbox || "已发送";
    const externalUid = messageUid(message.uid);
    return [{
      id: `sent-mailbox:${mailbox}:${externalUid || normalizeMessageId(message.messageId)}`,
      uid: original.uid,
      messageId: original.messageId || "",
      replyMessageId: message.messageId || "",
      externalUid,
      mailbox,
      source: "sent-mailbox",
      to: message.to || original.fromAddress || "",
      subject: message.subject || "",
      body: String(message.text || "").trim(),
      bodySnippet: safeText(message.text || message.subject, 240),
      operator,
      sentAt: message.date ? new Date(message.date).toLocaleString("zh-CN", { hour12: false }) : nowText(),
      smtpResult: { messageId: message.messageId || "", accepted: [], rejected: [] },
    }];
  });
}

export function mergeMailReplies(existingReplies = [], syncedReplies = []) {
  const byId = new Map();
  const keptMessageIds = new Set();
  const replyMessageId = (reply = {}) => normalizeMessageId(reply.replyMessageId || reply.smtpResult?.messageId);
  existingReplies.forEach((reply) => {
    if (!reply?.id || byId.has(reply.id)) return;
    byId.set(reply.id, reply);
    const messageId = replyMessageId(reply);
    if (messageId) keptMessageIds.add(messageId);
  });
  syncedReplies.forEach((reply) => {
    if (!reply?.id || byId.has(reply.id)) return;
    const messageId = replyMessageId(reply);
    if (messageId && keptMessageIds.has(messageId)) return;
    byId.set(reply.id, reply);
    if (messageId) keptMessageIds.add(messageId);
  });
  return [...byId.values()].sort((left, right) => String(right.sentAt || "").localeCompare(String(left.sentAt || "")));
}

async function readReplies() {
  return readJson(repliesFile, []);
}

async function writeReplies(replies) {
  await writeJson(repliesFile, replies);
}

async function readSuggestions() {
  return readJson(suggestionsFile, {});
}

async function writeSuggestions(suggestions) {
  await writeJson(suggestionsFile, suggestions);
}

async function readLatest() {
  const latest = await readJson(latestFile, null);
  if (!latest) return defaultLatest();
  return {
    ...defaultLatest(),
    ...latest,
    messages: Array.isArray(latest.messages) ? latest.messages : [],
    stats: latest.stats || summarizeMailRows(latest.messages || []),
  };
}

async function writeLatest(latest) {
  const payload = {
    ...latest,
    stats: summarizeMailRows(latest.messages || []),
  };
  await writeJson(latestFile, payload);
  return payload;
}

function parserReferences(parsed = {}) {
  if (Array.isArray(parsed.references)) return parsed.references;
  if (parsed.references) return String(parsed.references).split(/\s+/).filter(Boolean);
  return [];
}

async function parseFetchedMessage(message, { mailbox = "INBOX", saveAttachments = true } = {}) {
  let parsed = {};
  if (message.source) {
    parsed = await simpleParser(message.source).catch(() => ({}));
  }
  const attachments = saveAttachments ? await saveParsedImageAttachments(message.uid, parsed.attachments || []) : [];
  return {
    uid: message.uid,
    mailbox,
    envelope: message.envelope,
    flags: message.flags,
    messageId: message.envelope?.messageId || parsed.messageId || "",
    inReplyTo: parsed.inReplyTo || "",
    references: parserReferences(parsed),
    from: message.envelope?.from || parsed.from?.value || "",
    fromAddress: firstAddress(message.envelope?.from || parsed.from?.value || "").address,
    to: formatAddressList(message.envelope?.to || parsed.to?.value || ""),
    subject: message.envelope?.subject || parsed.subject || "",
    date: message.envelope?.date || parsed.date || "",
    text: parsed.text || "",
    attachments,
  };
}

async function fetchMailboxMessages(client, mailbox, { since, maxMessages = 100, saveAttachments = true } = {}) {
  const messages = [];
  const lock = await client.getMailboxLock(mailbox);
  try {
    for await (const message of client.fetch({ since }, { uid: true, envelope: true, flags: true, source: true })) {
      messages.push(await parseFetchedMessage(message, { mailbox, saveAttachments }));
      if (messages.length >= maxMessages) break;
    }
  } finally {
    lock.release();
  }
  return messages;
}

async function saveParsedImageAttachments(uid, attachments = []) {
  const mailUid = messageUid(uid);
  const rows = [];
  for (const attachment of attachments.filter(isImageAttachment)) {
    const originalName = attachment.filename || attachment.contentId || "image";
    const hash = crypto
      .createHash("sha1")
      .update(Buffer.concat([
        Buffer.from(mailUid),
        Buffer.from(String(attachment.contentId || "")),
        Buffer.from(String(originalName)),
        Buffer.from(attachment.content || []),
      ]))
      .digest("hex")
      .slice(0, 16);
    const ext = imageExtensionFromType(attachment.contentType, originalName);
    const storedName = `${hash}-${safeFileName(path.basename(originalName, path.extname(originalName)), "image")}${ext}`;
    const dir = path.join(attachmentsDir, mailUid);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, storedName), attachment.content);
    rows.push({
      id: hash,
      filename: originalName,
      storedName,
      contentType: attachment.contentType || "image/jpeg",
      size: Number(attachment.size || attachment.content?.length || 0),
      contentId: attachment.contentId || "",
      related: attachment.related === true,
      url: `/api/aftersales-mail/attachments/${encodeURIComponent(mailUid)}/${encodeURIComponent(storedName)}`,
    });
  }
  return rows;
}

export async function getAftersalesMailDashboard({ refresh = false } = {}) {
  if (refresh) return syncAftersalesMail();
  return readLatest();
}

export async function syncAftersalesMail() {
  const config = getConfig().aftersalesMail;
  if (!mailConfigured(config)) {
    return writeLatest(defaultLatest(config));
  }

  const previous = await readLatest();
  const existingReplies = await readReplies();
  const knownUids = new Set((previous.messages || []).map((row) => messageUid(row.uid)));
  const previousStatus = new Map((previous.messages || []).map((row) => [messageUid(row.uid), row.status]));
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  try {
    await client.connect();
    const since = new Date();
    since.setDate(since.getDate() - Number(config.lookbackDays || 14));
    const inboxMessages = await fetchMailboxMessages(client, "INBOX", {
      since,
      maxMessages: Number(config.maxMessages || 100),
      saveAttachments: true,
    });
    let sentMessages = [];
    let sentMailboxError = null;
    if (config.sentMailbox) {
      try {
        sentMessages = await fetchMailboxMessages(client, config.sentMailbox, {
          since,
          maxMessages: Number(config.maxMessages || 100),
          saveAttachments: false,
        });
      } catch (error) {
        sentMailboxError = error;
      }
    }
    const inboxRowsForLinking = inboxMessages.map((message) => normalizeMailRecord(message, { knownUids, repliedUids: new Set() }));
    const syncedReplies = buildExternalSentReplies(inboxRowsForLinking, sentMessages, { operator: "163已发送" });
    const replies = mergeMailReplies(existingReplies, syncedReplies);
    await writeReplies(replies);
    const repliedUids = new Set(replies.map((reply) => messageUid(reply.uid)));
    const rows = inboxMessages
      .map((message) => {
        const row = normalizeMailRecord(message, { knownUids, repliedUids });
        if (previousStatus.get(row.uid) === "replied") row.status = "replied";
        if (previousStatus.get(row.uid) === "pending" && row.status === "new") row.status = "pending";
        return row;
      })
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return writeLatest({
      ok: !sentMailboxError,
      configured: true,
      messages: rows,
      meta: {
        account: config.user,
        source: "站外售后邮箱",
        syncStatus: sentMailboxError
          ? `收件箱同步完成，已发送箱同步失败：${sentMailboxError.message}`
          : `邮箱同步完成，已同步已发送箱 ${sentMessages.length} 封。`,
        updatedAt: nowText(),
        syncedAt: isoNow(),
        sentMailbox: config.sentMailbox,
        sentSyncedCount: sentMessages.length,
        externalReplyCount: syncedReplies.length,
      },
    });
  } catch (error) {
    return writeLatest({
      ...previous,
      ok: false,
      configured: true,
      meta: {
        ...(previous.meta || {}),
        account: config.user,
        source: "站外售后邮箱",
        syncStatus: `邮箱同步失败：${error.message}`,
        updatedAt: nowText(),
        error: error.message,
      },
    });
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function getAftersalesMailMessage(uid) {
  const latest = await readLatest();
  const mail = (latest.messages || []).find((row) => row.uid === messageUid(uid));
  if (!mail) {
    const error = new Error("邮件不存在或尚未同步。");
    error.statusCode = 404;
    throw error;
  }
  const replies = (await readReplies()).filter((reply) => messageUid(reply.uid) === mail.uid);
  const suggestions = await readSuggestions();
  return {
    ok: true,
    mail,
    replies,
    suggestion: suggestions[mail.uid] || null,
  };
}

export async function getAftersalesMailAttachment(uid, storedName) {
  const targetUid = messageUid(uid);
  const safeName = path.basename(String(storedName || ""));
  if (!targetUid || !safeName || safeName !== storedName) {
    const error = new Error("附件地址无效。");
    error.statusCode = 400;
    throw error;
  }
  const latest = await readLatest();
  const mail = (latest.messages || []).find((row) => row.uid === targetUid);
  const attachment = (mail?.attachments || []).find((item) => (item.storedName || storedNameFromAttachmentUrl(item.url)) === safeName);
  if (!attachment) {
    const error = new Error("附件不存在或尚未同步。");
    error.statusCode = 404;
    throw error;
  }
  return {
    bytes: await readFile(path.join(attachmentsDir, targetUid, safeName)),
    contentType: attachment.contentType || "application/octet-stream",
    filename: attachment.filename || safeName,
  };
}

export async function generateAftersalesMailSuggestion(uid, { refresh = false } = {}) {
  const detail = await getAftersalesMailMessage(uid);
  const suggestions = await readSuggestions();
  if (suggestions[detail.mail.uid] && !refresh) return { ok: true, suggestion: suggestions[detail.mail.uid] };
  const activeAi = await resolveActiveAiProviderConfig(getConfig());
  const result = await generateAftersalesReplySuggestion(activeAi.config, detail.mail);
  const suggestion = {
    uid: detail.mail.uid,
    messageId: detail.mail.messageId,
    suggestion: result.suggestion,
    model: result.model,
    provider: activeAi.provider,
    providerLabel: activeAi.label,
    generatedAt: result.generatedAt,
    status: "ready",
  };
  suggestions[detail.mail.uid] = suggestion;
  await writeSuggestions(suggestions);
  return { ok: true, suggestion };
}

export async function updateAftersalesMailStatus(uid, status) {
  if (!["pending", "replied"].includes(status)) {
    const error = new Error("邮件状态无效。");
    error.statusCode = 400;
    throw error;
  }
  const latest = await readLatest();
  const targetUid = messageUid(uid);
  const messages = (latest.messages || []).map((row) => row.uid === targetUid ? { ...row, status, isNew: false } : row);
  if (!messages.some((row) => row.uid === targetUid)) {
    const error = new Error("邮件不存在或尚未同步。");
    error.statusCode = 404;
    throw error;
  }
  return writeLatest({ ...latest, messages });
}

export async function sendAftersalesMailReply(uid, payload = {}) {
  const config = getConfig().aftersalesMail;
  if (!mailConfigured(config)) {
    const error = new Error("售后邮箱未配置，无法发送回复。");
    error.statusCode = 503;
    throw error;
  }
  const body = String(payload.body || "").trim();
  if (!body) {
    const error = new Error("回复正文不能为空。");
    error.statusCode = 400;
    throw error;
  }
  const detail = await getAftersalesMailMessage(uid);
  const message = buildReplyMessage(detail.mail, { body, user: config.user });
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: true,
    auth: { user: config.user, pass: config.password },
  });
  const smtpResult = await transporter.sendMail(message);
  const replies = await readReplies();
  const reply = {
    id: crypto.randomUUID(),
    uid: detail.mail.uid,
    messageId: detail.mail.messageId,
    to: message.to,
    subject: message.subject,
    body,
    bodySnippet: safeText(body, 240),
    operator: payload.operator || "ERP",
    sentAt: nowText(),
    smtpResult: {
      messageId: smtpResult.messageId || "",
      accepted: smtpResult.accepted || [],
      rejected: smtpResult.rejected || [],
    },
  };
  await writeReplies([reply, ...replies]);
  await updateAftersalesMailStatus(uid, "replied");
  return { ok: true, reply };
}

export function buildAftersalesMailInspectionSummary(latest = defaultLatest()) {
  if (!latest.configured) {
    return {
      key: "aftersalesMail",
      label: "站外售后邮箱",
      status: "unavailable",
      tone: "warning",
      count: 0,
      detail: "站外售后邮箱未配置，暂未自动巡检。",
      rows: [],
    };
  }
  const stats = latest.stats || summarizeMailRows(latest.messages || []);
  const hasError = latest.ok === false;
  const count = Number(stats.pendingCount || 0);
  return {
    key: "aftersalesMail",
    label: "站外售后邮箱",
    status: hasError ? "error" : count > 0 ? "risk" : "ok",
    tone: hasError ? "danger" : count > 0 ? "warning" : "success",
    count,
    newCount: Number(stats.newCount || 0),
    pendingCount: count,
    detail: hasError
      ? latest.meta?.syncStatus || "站外售后邮箱同步失败。"
      : count > 0
        ? `新增 ${stats.newCount || 0} 封，待回复 ${count} 封，最近同步 ${latest.meta?.updatedAt || "-"}。`
        : `无待回复邮件，最近同步 ${latest.meta?.updatedAt || "-"}。`,
    rows: (latest.messages || [])
      .filter((row) => row.status === "new" || row.status === "pending")
      .slice(0, 10)
      .map((row) => ({
        source: "站外售后邮箱",
        storeName: "JM售后邮箱",
        type: row.status === "new" ? "新邮件" : "待回复",
        item: row.subject,
        detail: `${row.from || "-"} · ${row.snippet || ""}`,
        level: row.status === "new" ? "高" : "中",
        action: "进入售后邮箱查看并回复",
      })),
  };
}

export async function getAftersalesMailInspectionSummary({ refresh = false } = {}) {
  const latest = refresh ? await syncAftersalesMail() : await readLatest();
  return buildAftersalesMailInspectionSummary(latest);
}

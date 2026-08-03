import crypto from "node:crypto";
import { getConfig } from "../config/index.js";

function buildDingTalkWebhookUrl(webhook, secret) {
  const url = new URL(webhook);
  if (!secret) return url;
  const timestamp = Date.now();
  const sign = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url;
}

function buildAtPayload(configAt = {}, options = {}) {
  const atAll = options.atAll === true;
  const inheritedMobiles = options.inheritConfiguredMentions === false ? [] : (configAt.atMobiles || []);
  const inheritedUserIds = options.inheritConfiguredMentions === false ? [] : (configAt.atUserIds || []);
  return {
    isAtAll: atAll,
    atMobiles: atAll ? [] : [...new Set([...inheritedMobiles, ...(options.atMobiles || [])])],
    atUserIds: atAll ? [] : [...new Set([...inheritedUserIds, ...(options.atUserIds || [])])],
  };
}

function appendMentionText(content, at = {}) {
  if (at.isAtAll) return content;
  const text = String(content || "");
  const missingMentions = [...(at.atMobiles || []), ...(at.atUserIds || [])]
    .map((item) => `@${item}`)
    .filter((item) => !text.includes(item));
  if (!missingMentions.length) return content;
  return `${content}\n${missingMentions.join(" ")}`;
}

async function sendConfiguredDingTalkText(config, content, options = {}, missingWebhookName = "DINGTALK_WEBHOOK", fetchImpl = globalThis.fetch) {
  const { webhook, secret, ...configAt } = config;
  if (!webhook) {
    return { ok: false, skipped: true, message: `${missingWebhookName} 未配置，已跳过钉钉通知。` };
  }
  const at = buildAtPayload(configAt, options);

  const response = await fetchImpl(buildDingTalkWebhookUrl(webhook, secret), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: appendMentionText(content, at) },
      at,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok && Number(payload?.errcode || 0) === 0,
    status: response.status,
    payload,
  };
}

export async function sendDingTalkText(content, { atAll = false, atMobiles = [], atUserIds = [] } = {}) {
  return sendConfiguredDingTalkText(getConfig().dingtalk, content, { atAll, atMobiles, atUserIds });
}

export async function sendDingTalkTextToWebhook(config, content, options = {}, missingWebhookName = "WEBHOOK", fetchImpl = globalThis.fetch) {
  return sendConfiguredDingTalkText(config, content, options, missingWebhookName, fetchImpl);
}

export async function sendDingTalkMarkdown({ title, text, atAll = false, atMobiles = [], atUserIds = [], inheritConfiguredMentions = true }) {
  const { webhook, secret, ...configAt } = getConfig().dingtalk;
  if (!webhook) {
    return { ok: false, skipped: true, message: "DINGTALK_WEBHOOK 未配置，已跳过钉钉通知。" };
  }
  const at = buildAtPayload(configAt, { atAll, atMobiles, atUserIds, inheritConfiguredMentions });

  const response = await fetch(buildDingTalkWebhookUrl(webhook, secret), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title,
        text: appendMentionText(text, at),
      },
      at,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok && Number(payload?.errcode || 0) === 0,
    status: response.status,
    payload,
  };
}

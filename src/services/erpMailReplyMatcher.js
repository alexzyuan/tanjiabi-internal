import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function safeText(value, maxLength = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAddress(value = "") {
  return String(value || "").trim().toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function firstText(value) {
  return asArray(value).map((item) => String(item ?? "").trim()).find(Boolean) || "";
}

function formatAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const name = String(value.name || "").trim();
  const address = String(value.address || "").trim();
  if (!name) return address;
  if (!address) return name;
  return `${name} <${address}>`;
}

function formatAddressList(value) {
  return asArray(value).map(formatAddress).filter(Boolean).join("; ");
}

function dateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function extractAmazonOrderId(value = "") {
  return String(value || "").match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] || "";
}

function stripReplyPrefix(subject = "") {
  return String(subject || "")
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function erpIncomingAddress(row = {}) {
  return normalizeAddress(row.from_address || row.fromAddress || row.from);
}

function sentRecipientText(message = {}) {
  return normalizeAddress([
    message.to,
    message.cc,
    message.bcc,
  ].filter(Boolean).join("; "));
}

export function matchesErpBuyerMessageReply(row = {}, sentMessage = {}) {
  const receivedAt = dateMs(row.date || row.createdAt || row.created_at || row.create_time);
  const sentAt = dateMs(sentMessage.date || sentMessage.sentAt);
  if (receivedAt && sentAt && sentAt < receivedAt) return false;

  const erpFromAddress = erpIncomingAddress(row);
  const recipientText = sentRecipientText(sentMessage);
  if (erpFromAddress && recipientText.includes(erpFromAddress)) return true;

  const orderId = extractAmazonOrderId(row.subject || row.title || row.text_plain || row.text || "");
  if (orderId) {
    const sentText = normalizeAddress(`${sentMessage.subject || ""} ${sentMessage.text || ""} ${recipientText}`);
    if (sentText.includes(orderId.toLowerCase())) return true;
  }

  const rowSubject = stripReplyPrefix(row.subject || row.title);
  const sentSubject = stripReplyPrefix(sentMessage.subject);
  return Boolean(rowSubject && sentSubject && rowSubject === sentSubject && /@marketplace\.amazon\./i.test(recipientText));
}

export function applyErpBuyerMessageReplyStatus(rows = [], sentMessages = []) {
  return rows.map((row) => {
    const reply = sentMessages.find((message) => matchesErpBuyerMessageReply(row, message));
    if (!reply) return { ...row, _replyStatus: "pending" };
    return {
      ...row,
      _replyStatus: "replied",
      _replySource: "netease-sent",
      _replySentAt: reply.date || reply.sentAt || "",
      _replySubject: reply.subject || "",
      _replyMailbox: reply.account || "",
    };
  });
}

async function parseFetchedMessage(message, { mailbox = "已发送", account = "" } = {}) {
  const parsed = message.source ? await simpleParser(message.source).catch(() => ({})) : {};
  return {
    uid: String(message.uid ?? ""),
    account,
    mailbox,
    messageId: message.envelope?.messageId || parsed.messageId || "",
    inReplyTo: parsed.inReplyTo || "",
    references: Array.isArray(parsed.references) ? parsed.references : String(parsed.references || "").split(/\s+/).filter(Boolean),
    from: formatAddressList(message.envelope?.from || parsed.from?.value || ""),
    to: formatAddressList(message.envelope?.to || parsed.to?.value || ""),
    cc: formatAddressList(message.envelope?.cc || parsed.cc?.value || ""),
    bcc: formatAddressList(message.envelope?.bcc || parsed.bcc?.value || ""),
    subject: message.envelope?.subject || parsed.subject || "",
    date: message.envelope?.date || parsed.date || "",
    text: safeText(parsed.text || "", 4000),
  };
}

export async function fetchErpReplySentMessages(config = {}) {
  const accounts = Array.isArray(config.mailboxes) ? config.mailboxes : [];
  const allMessages = [];
  const errors = [];
  const since = new Date();
  since.setDate(since.getDate() - Number(config.lookbackDays || 14));

  for (const account of accounts) {
    const client = new ImapFlow({
      host: config.imapHost || "imap.163.com",
      port: Number(config.imapPort || 993),
      secure: true,
      auth: { user: account.user, pass: account.password },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.sentMailbox || "已发送");
      try {
        const messages = [];
        for await (const message of client.fetch({ since }, { uid: true, envelope: true, flags: true, source: true })) {
          messages.push(await parseFetchedMessage(message, {
            mailbox: config.sentMailbox || "已发送",
            account: account.user,
          }));
          if (messages.length >= Number(config.maxMessages || 200)) break;
        }
        allMessages.push(...messages);
      } finally {
        lock.release();
      }
    } catch (error) {
      errors.push({ account: account.user, message: error.message });
    } finally {
      await client.logout().catch(() => {});
    }
  }

  return {
    messages: allMessages,
    errors,
  };
}

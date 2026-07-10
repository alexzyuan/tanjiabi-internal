import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAftersalesMailInspectionSummary,
  buildExternalSentReplies,
  buildReplyMessage,
  mergeMailReplies,
  normalizeMailRecord,
  summarizeMailRows,
} from "../src/services/aftersalesMailService.js";

test("normalizeMailRecord creates searchable售后 mail row", () => {
  const row = normalizeMailRecord({
    uid: 42,
    envelope: {
      messageId: "<message-1@example.com>",
      date: new Date("2026-06-29T01:00:00.000Z"),
      subject: "Product question",
      from: [{ name: "Buyer", address: "buyer@example.com" }],
    },
    flags: new Set(["\\Seen"]),
    text: "Hello, the remote control does not work. Please help.",
  }, { knownUids: new Set([42]), repliedUids: new Set() });

  assert.equal(row.uid, "42");
  assert.equal(row.messageId, "<message-1@example.com>");
  assert.equal(row.from, "Buyer <buyer@example.com>");
  assert.equal(row.fromAddress, "buyer@example.com");
  assert.equal(row.subject, "Product question");
  assert.equal(row.seen, true);
  assert.equal(row.isNew, false);
  assert.equal(row.status, "pending");
  assert.match(row.snippet, /remote control/);
});

test("normalizeMailRecord keeps image attachment metadata", () => {
  const row = normalizeMailRecord({
    uid: 88,
    envelope: { subject: "Photo issue" },
    attachments: [
      {
        id: "img-1",
        filename: "broken.jpg",
        storedName: "img-1.jpg",
        contentType: "image/jpeg",
        size: 1200,
        url: "/api/aftersales-mail/attachments/88/img-1.jpg",
      },
      {
        id: "doc-1",
        filename: "note.txt",
        contentType: "text/plain",
        size: 20,
        url: "/ignore",
      },
    ],
    text: "Please see photo.",
  });

  assert.equal(row.attachments.length, 1);
  assert.equal(row.attachments[0].filename, "broken.jpg");
  assert.equal(row.attachments[0].storedName, "img-1.jpg");
  assert.equal(row.attachments[0].contentType, "image/jpeg");
  assert.equal(row.attachments[0].url, "/api/aftersales-mail/attachments/88/img-1.jpg");
});

test("normalizeMailRecord recovers stored attachment name from URL", () => {
  const row = normalizeMailRecord({
    uid: 89,
    attachments: [
      {
        id: "img-2",
        filename: "box.jpg",
        contentType: "image/jpeg",
        size: 2200,
        url: "/api/aftersales-mail/attachments/89/hash-box.jpg",
      },
    ],
  });

  assert.equal(row.attachments[0].storedName, "hash-box.jpg");
});

test("summarizeMailRows counts new pending and replied messages", () => {
  const summary = summarizeMailRows([
    { uid: "1", isNew: true, status: "new" },
    { uid: "2", isNew: false, status: "pending" },
    { uid: "3", isNew: false, status: "replied" },
  ]);

  assert.deepEqual(summary, {
    totalCount: 3,
    newCount: 1,
    pendingCount: 2,
    repliedCount: 1,
  });
});

test("buildAftersalesMailInspectionSummary highlights new mail for daily inspection", () => {
  const summary = buildAftersalesMailInspectionSummary({
    ok: true,
    configured: true,
    stats: { totalCount: 2, newCount: 1, pendingCount: 2, repliedCount: 0 },
    meta: { updatedAt: "2026/6/30 08:30:00" },
    messages: [
      { uid: "101", status: "new", subject: "Boat will not turn on", from: "Rob <rob@example.com>", snippet: "Where is the on switch?" },
      { uid: "100", status: "pending", subject: "Charging cable", from: "Carol <carol@example.com>", snippet: "The cable light is off." },
    ],
  });

  assert.equal(summary.status, "risk");
  assert.equal(summary.count, 2);
  assert.equal(summary.newCount, 1);
  assert.match(summary.detail, /新增 1 封/);
  assert.equal(summary.rows[0].type, "新邮件");
  assert.equal(summary.rows[0].item, "Boat will not turn on");
});

test("buildReplyMessage addresses original sender and preserves Re subject", () => {
  const message = buildReplyMessage({
    fromAddress: "buyer@example.com",
    subject: "Need help",
    messageId: "<original@example.com>",
  }, {
    body: "您好，已收到您的邮件。",
    user: "jmcustomer@163.com",
  });

  assert.equal(message.from, "jmcustomer@163.com");
  assert.equal(message.to, "buyer@example.com");
  assert.equal(message.subject, "Re: Need help");
  assert.equal(message.text, "您好，已收到您的邮件。");
  assert.equal(message.inReplyTo, "<original@example.com>");
  assert.deepEqual(message.references, ["<original@example.com>"]);
});

test("buildExternalSentReplies links sent mailbox replies by In-Reply-To", () => {
  const replies = buildExternalSentReplies([
    {
      uid: "42",
      messageId: "<original@example.com>",
      fromAddress: "buyer@example.com",
      subject: "Need help",
    },
  ], [
    {
      uid: "8",
      mailbox: "已发送",
      messageId: "<reply@example.com>",
      inReplyTo: "<original@example.com>",
      references: ["<original@example.com>"],
      to: "Buyer <buyer@example.com>",
      subject: "Re: Need help",
      text: "We have received your message.",
      date: "2026-06-30 08:20:00",
    },
  ], { operator: "163邮箱" });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].uid, "42");
  assert.equal(replies[0].source, "sent-mailbox");
  assert.equal(replies[0].externalUid, "8");
  assert.equal(replies[0].operator, "163邮箱");
  assert.match(replies[0].bodySnippet, /received/);
});

test("mergeMailReplies keeps ERP replies and deduplicates sent mailbox replies", () => {
  const merged = mergeMailReplies([
    { id: "erp-1", uid: "42", source: "erp", body: "ERP reply" },
    { id: "sent-mailbox:已发送:8", uid: "42", source: "sent-mailbox", externalUid: "8", sentAt: "2026/6/30 08:20:00" },
  ], [
    { id: "sent-mailbox:已发送:8", uid: "42", source: "sent-mailbox", externalUid: "8", sentAt: "2026/6/30 08:20:00" },
    { id: "sent-mailbox:已发送:9", uid: "42", source: "sent-mailbox", externalUid: "9", sentAt: "2026/6/30 08:30:00" },
  ]);

  assert.deepEqual(merged.map((reply) => reply.id), [
    "sent-mailbox:已发送:9",
    "sent-mailbox:已发送:8",
    "erp-1",
  ]);
});

test("mergeMailReplies avoids duplicating ERP sent replies found in sent mailbox", () => {
  const merged = mergeMailReplies([
    {
      id: "erp-1",
      uid: "42",
      source: "erp",
      smtpResult: { messageId: "<reply@example.com>" },
      sentAt: "2026/6/30 08:30:00",
    },
  ], [
    {
      id: "sent-mailbox:已发送:9",
      uid: "42",
      source: "sent-mailbox",
      replyMessageId: "<reply@example.com>",
      sentAt: "2026/6/30 08:30:00",
    },
  ]);

  assert.deepEqual(merged.map((reply) => reply.id), ["erp-1"]);
});

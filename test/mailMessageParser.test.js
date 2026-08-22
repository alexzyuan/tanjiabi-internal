import assert from "node:assert/strict";
import test from "node:test";
import { parseMailSource } from "../src/services/mailMessageParser.js";
import { parseFetchedMessage as parseAftersalesFetchedMessage } from "../src/services/aftersalesMailService.js";
import { parseErpReplySentMessage } from "../src/services/erpMailReplyMatcher.js";

test("parseMailSource exposes a structured error instead of returning an empty message", async () => {
  const logs = [];
  const source = "raw-message-content-must-not-be-logged";
  const parser = async () => {
    throw new Error("malformed MIME boundary");
  };

  await assert.rejects(
    () => parseMailSource(source, { mailbox: "INBOX", uid: "42", parser, logger: { error: (...args) => logs.push(args) } }),
    (error) => {
      assert.equal(error.code, "MAIL_PARSE_FAILED");
      assert.equal(error.mailbox, "INBOX");
      assert.equal(error.uid, "42");
      return true;
    },
  );

  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[mail-parse]");
  assert.equal(logs[0][1].mailbox, "INBOX");
  assert.equal(logs[0][1].uid, "42");
  assert.equal(logs[0][1].code, "MAIL_PARSE_FAILED");
  assert.ok(!JSON.stringify(logs).includes(source));
});

test("parseMailSource keeps missing source compatible with envelope-only messages", async () => {
  const parsed = await parseMailSource(null, { mailbox: "INBOX", uid: "43", parser: async () => ({ shouldNotRun: true }) });

  assert.deepEqual(parsed, {});
});

test("aftersales mailbox parsing propagates a source parse failure", async () => {
  await assert.rejects(
    () => parseAftersalesFetchedMessage(
      { uid: "af-1", source: Buffer.from("malformed") },
      { mailbox: "INBOX", saveAttachments: false, parser: async () => { throw new Error("bad MIME"); }, logger: { error() {} } },
    ),
    (error) => error.code === "MAIL_PARSE_FAILED" && error.mailbox === "INBOX" && error.uid === "af-1",
  );
});

test("ERP sent-mail parsing propagates a source parse failure", async () => {
  await assert.rejects(
    () => parseErpReplySentMessage(
      { uid: "erp-1", source: Buffer.from("malformed") },
      { mailbox: "已发送", account: "user@example.com", parser: async () => { throw new Error("bad MIME"); }, logger: { error() {} } },
    ),
    (error) => error.code === "MAIL_PARSE_FAILED" && error.mailbox === "已发送" && error.uid === "erp-1",
  );
});

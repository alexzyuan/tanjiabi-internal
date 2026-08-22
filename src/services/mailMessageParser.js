import { simpleParser } from "mailparser";

export class MailParseError extends Error {
  constructor({ mailbox, uid, account = "", cause }) {
    super(`Mail source parse failed: mailbox=${mailbox || "unknown"} uid=${uid || "unknown"}`);
    this.name = "MailParseError";
    this.code = "MAIL_PARSE_FAILED";
    this.mailbox = String(mailbox || "");
    this.uid = String(uid ?? "");
    this.account = String(account || "");
    this.cause = cause;
  }
}

function mailParseFailure({ mailbox, uid, account, cause, logger }) {
  const error = new MailParseError({ mailbox, uid, account, cause });
  logger?.error?.("[mail-parse]", {
    mailbox: error.mailbox,
    uid: error.uid,
    code: error.code,
    errorName: cause?.name || "Error",
    account: error.account,
  });
  return error;
}

function isWhitespaceByte(value) {
  return value === 9 || value === 10 || value === 11 || value === 12 || value === 13 || value === 32;
}

function isEmptyMailSource(source) {
  if (source === null || source === undefined) return true;
  if (typeof source === "string") return source.trim().length === 0;
  if (ArrayBuffer.isView(source)) {
    if (source.byteLength === 0) return true;
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).every(isWhitespaceByte);
  }
  if (source instanceof ArrayBuffer) {
    if (source.byteLength === 0) return true;
    return new Uint8Array(source).every(isWhitespaceByte);
  }
  return false;
}

export async function parseMailSource(source, {
  mailbox = "INBOX",
  uid = "",
  account = "",
  parser = simpleParser,
  logger = console,
} = {}) {
  if (isEmptyMailSource(source)) {
    throw mailParseFailure({ mailbox, uid, account, cause: new Error("Mail source missing or empty"), logger });
  }
  try {
    return await parser(source);
  } catch (cause) {
    throw mailParseFailure({ mailbox, uid, account, cause, logger });
  }
}

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

export async function parseMailSource(source, {
  mailbox = "INBOX",
  uid = "",
  account = "",
  parser = simpleParser,
  logger = console,
} = {}) {
  if (source === null || source === undefined || source === "") return {};
  try {
    return await parser(source);
  } catch (cause) {
    const error = new MailParseError({ mailbox, uid, account, cause });
    logger?.error?.("[mail-parse]", {
      mailbox: error.mailbox,
      uid: error.uid,
      code: error.code,
      errorName: cause?.name || "Error",
      account: error.account,
    });
    throw error;
  }
}

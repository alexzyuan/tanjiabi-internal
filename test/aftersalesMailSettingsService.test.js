import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAftersalesMailSettingsService } from "../src/services/aftersalesMailSettingsService.js";

const initialEnv = [
  "DATA_PROVIDER=mock",
  "AFTERSALES_MAIL_ENABLED=true",
  "AFTERSALES_MAIL_USER=jmcustomer@163.com",
  "AFTERSALES_MAIL_PASSWORD=secret-163-code",
  "AFTERSALES_MAIL_IMAP_HOST=mail.test.invalid",
  "AFTERSALES_MAIL_SMTP_HOST=mail.test.invalid",
].join("\n");

function readMailboxConfig(envPath) {
  const values = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  return {
    aftersalesMail: {
      enabled: values.AFTERSALES_MAIL_ENABLED === "true",
      user: values.AFTERSALES_MAIL_USER,
      password: values.AFTERSALES_MAIL_PASSWORD,
      imapHost: values.AFTERSALES_MAIL_IMAP_HOST,
      imapPort: 993,
      smtpHost: values.AFTERSALES_MAIL_SMTP_HOST,
      smtpPort: 465,
    },
  };
}

async function withTempMailboxSettings(callback, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aftersales-mail-settings-"));
  const envPath = path.join(root, ".env");
  const auditPath = path.join(root, "data-cache", "aftersales-mail-settings-audit.json");
  await writeFile(envPath, initialEnv, "utf8");

  const service = createAftersalesMailSettingsService({
    envPath,
    auditPath,
    getConfig: () => readMailboxConfig(envPath),
    reloadConfig: () => ({}),
    verifyImap: async ({ password }) => {
      if (password === "bad-code") throw new Error("IMAP authentication failed");
    },
    verifySmtp: async ({ password }) => {
      if (password === "bad-code") throw new Error("SMTP authentication failed");
    },
    now: () => "2026-08-11T08:00:00.000Z",
    ...options,
  });

  try {
    return await callback({ service, envPath, auditPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("mail settings status never returns the configured authorization code", async () => {
  await withTempMailboxSettings(async ({ service }) => {
    const status = await service.getStatus();
    assert.equal(status.account, "jmcustomer@163.com");
    assert.equal(status.passwordConfigured, true);
    assert.equal(JSON.stringify(status).includes("secret-163-code"), false);
  });
});

test("a failed candidate test does not overwrite the prior .env code", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    await assert.rejects(
      service.saveSettings({ enabled: true, password: "bad-code" }, { name: "系统管理员" }),
      /SMTP authentication failed/,
    );
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=secret-163-code/);
  }, {
    verifyImap: async () => {},
    verifySmtp: async ({ password }) => {
      if (password === "bad-code") throw new Error("SMTP authentication failed");
    },
  });
});

test("a verified replacement is persisted atomically and audit rows contain no code", async () => {
  await withTempMailboxSettings(async ({ service, envPath, auditPath }) => {
    const status = await service.saveSettings({ enabled: true, password: "rotated-code" }, { name: "系统管理员" });
    assert.equal(status.enabled, true);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=rotated-code/);
    assert.equal((await readFile(auditPath, "utf8")).includes("rotated-code"), false);
    assert.equal(JSON.stringify(status).includes("rotated-code"), false);
  });
});

test("test-only passwords are neither saved nor recorded", async () => {
  await withTempMailboxSettings(async ({ service, envPath, auditPath }) => {
    const result = await service.testConnection({ password: "test-only-code" });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(await service.getStatus()).includes("test-only-code"), false);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=secret-163-code/);
    await assert.rejects(readFile(auditPath, "utf8"), { code: "ENOENT" });
  });
});

test("disabling mail keeps its saved authorization code while changing only the enabled flag", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    const status = await service.saveSettings({ enabled: false }, { name: "系统管理员" });
    const envText = await readFile(envPath, "utf8");
    assert.equal(status.enabled, false);
    assert.match(envText, /AFTERSALES_MAIL_ENABLED=false/);
    assert.match(envText, /AFTERSALES_MAIL_PASSWORD=secret-163-code/);
  });
});

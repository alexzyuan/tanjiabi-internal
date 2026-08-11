import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAftersalesMailSettingsService } from "../src/services/aftersalesMailSettingsService.js";

const initialEnv = [
  "DATA_PROVIDER=mock",
  "AFTERSALES_MAIL_ENABLED=true",
  "AFTERSALES_MAIL_USER=jmcustomer@163.com",
  "AFTERSALES_MAIL_PASSWORD=fixture-original-value-001",
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
      if (password === "fixture-invalid-value-002") throw new Error("IMAP authentication failed");
    },
    verifySmtp: async ({ password }) => {
      if (password === "fixture-invalid-value-002") throw new Error("SMTP authentication failed");
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
    assert.equal(JSON.stringify(status).includes("fixture-original-value-001"), false);
  });
});

test("a failed candidate test does not overwrite the prior .env code", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    await assert.rejects(
      service.saveSettings({ enabled: true, password: "fixture-invalid-value-002" }, { name: "系统管理员" }),
      /SMTP authentication failed/,
    );
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=fixture-original-value-001/);
  }, {
    verifyImap: async () => {},
    verifySmtp: async ({ password }) => {
      if (password === "fixture-invalid-value-002") throw new Error("SMTP authentication failed");
    },
  });
});

test("a verified replacement is persisted atomically and audit rows contain no code", async () => {
  await withTempMailboxSettings(async ({ service, envPath, auditPath }) => {
    const status = await service.saveSettings({ enabled: true, password: "fixture-replacement-value-003" }, { name: "系统管理员" });
    assert.equal(status.enabled, true);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=fixture-replacement-value-003/);
    assert.equal((await readFile(auditPath, "utf8")).includes("fixture-replacement-value-003"), false);
    assert.equal(JSON.stringify(status).includes("fixture-replacement-value-003"), false);
  });
});

test("test-only passwords are neither saved nor recorded", async () => {
  await withTempMailboxSettings(async ({ service, envPath, auditPath }) => {
    const result = await service.testConnection({ password: "fixture-probe-value-004" });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(await service.getStatus()).includes("fixture-probe-value-004"), false);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD=fixture-original-value-001/);
    await assert.rejects(readFile(auditPath, "utf8"), { code: "ENOENT" });
  });
});

test("disabling mail keeps its saved authorization code while changing only the enabled flag", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    const status = await service.saveSettings({ enabled: false }, { name: "系统管理员" });
    const envText = await readFile(envPath, "utf8");
    assert.equal(status.enabled, false);
    assert.match(envText, /AFTERSALES_MAIL_ENABLED=false/);
    assert.match(envText, /AFTERSALES_MAIL_PASSWORD=fixture-original-value-001/);
  });
});

test("managed dotenv values win after reload while unrelated process values keep precedence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aftersales-config-reload-"));
  const previousCwd = process.cwd();
  const previousEnabled = process.env.AFTERSALES_MAIL_ENABLED;
  const previousPassword = process.env.AFTERSALES_MAIL_PASSWORD;
  const previousProvider = process.env.DATA_PROVIDER;
  try {
    await writeFile(path.join(root, ".env"), [
      "AFTERSALES_MAIL_ENABLED=false",
      "AFTERSALES_MAIL_PASSWORD=fixture-file-value-005",
      "DATA_PROVIDER=lingxing",
    ].join("\n"), "utf8");
    process.env.AFTERSALES_MAIL_ENABLED = "true";
    process.env.AFTERSALES_MAIL_PASSWORD = "fixture-process-value-006";
    process.env.DATA_PROVIDER = "mock";
    process.chdir(root);
    const config = await import(`../src/config/index.js?managed-reload=${Date.now()}`);
    assert.equal(config.getConfig().aftersalesMail.enabled, true);
    await writeFile(path.join(root, ".env"), [
      "AFTERSALES_MAIL_ENABLED=false",
      "AFTERSALES_MAIL_PASSWORD= fixture-updated-file-value-007 ",
      "DATA_PROVIDER=lingxing",
    ].join("\n"), "utf8");
    config.reloadDotEnv();
    assert.equal(config.getConfig().aftersalesMail.enabled, false);
    assert.equal(config.getConfig().aftersalesMail.password, " fixture-updated-file-value-007 ");
    assert.equal(config.getConfig().dataProvider, "mock");
    assert.equal(config.getConfig().runtime.envLoaded, true);
    await rm(path.join(root, ".env"));
    config.reloadDotEnv();
    assert.equal(config.getConfig().runtime.envLoaded, false);
  } finally {
    process.chdir(previousCwd);
    if (previousEnabled === undefined) delete process.env.AFTERSALES_MAIL_ENABLED;
    else process.env.AFTERSALES_MAIL_ENABLED = previousEnabled;
    if (previousPassword === undefined) delete process.env.AFTERSALES_MAIL_PASSWORD;
    else process.env.AFTERSALES_MAIL_PASSWORD = previousPassword;
    if (previousProvider === undefined) delete process.env.DATA_PROVIDER;
    else process.env.DATA_PROVIDER = previousProvider;
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic dotenv replacement preserves the existing file mode", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    await chmod(envPath, 0o640);
    await service.saveSettings({ enabled: false }, { name: "系统管理员" });
    assert.equal((await stat(envPath)).mode & 0o777, 0o640);
  });
});

test("password bytes are passed and persisted unchanged, while CR/LF is rejected", async () => {
  await withTempMailboxSettings(async ({ service, envPath }) => {
    const candidate = " fixture-preserve-value-008 ";
    const observed = [];
    const replacementService = createAftersalesMailSettingsService({
      envPath,
      auditPath: path.join(path.dirname(envPath), "data-cache", "replacement-audit.json"),
      getConfig: () => readMailboxConfig(envPath),
      reloadConfig: () => ({}),
      verifyImap: async ({ password }) => observed.push(password),
      verifySmtp: async ({ password }) => observed.push(password),
      now: () => "2026-08-11T08:00:00.000Z",
    });
    await replacementService.saveSettings({ enabled: true, password: candidate }, { name: "系统管理员" });
    assert.deepEqual(observed, [candidate, candidate]);
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD= fixture-preserve-value-008 \n/);
    await assert.rejects(
      replacementService.testConnection({ password: "fixture-invalid-\rvalue-013" }),
      /不得包含换行符/,
    );
    await assert.rejects(
      replacementService.saveSettings({ enabled: true, password: "fixture-invalid-\nvalue-009" }, { name: "系统管理员" }),
      /不得包含换行符/,
    );
    assert.match(await readFile(envPath, "utf8"), /AFTERSALES_MAIL_PASSWORD= fixture-preserve-value-008 \n/);
  });
});

test("save operations are serialized and an unavailable audit target leaves .env unchanged", async () => {
  await withTempMailboxSettings(async ({ envPath }) => {
    const auditPath = path.join(path.dirname(envPath), "audit-target");
    await mkdir(auditPath);
    let active = 0;
    let maxActive = 0;
    const service = createAftersalesMailSettingsService({
      envPath,
      auditPath: path.join(path.dirname(envPath), "serial-audit.json"),
      getConfig: () => readMailboxConfig(envPath),
      reloadConfig: () => ({}),
      verifyImap: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
      verifySmtp: async () => {},
      now: () => "2026-08-11T08:00:00.000Z",
    });
    await Promise.all([
      service.saveSettings({ enabled: true, password: "fixture-serial-value-010" }, { name: "系统管理员" }),
      service.saveSettings({ enabled: false, password: "fixture-serial-value-011" }, { name: "系统管理员" }),
    ]);
    assert.equal(maxActive, 1);

    const failingService = createAftersalesMailSettingsService({
      envPath,
      auditPath,
      getConfig: () => readMailboxConfig(envPath),
      reloadConfig: () => ({}),
      verifyImap: async () => {},
      verifySmtp: async () => {},
      now: () => "2026-08-11T08:00:00.000Z",
    });
    const before = await readFile(envPath, "utf8");
    await assert.rejects(
      failingService.saveSettings({ enabled: true, password: "fixture-audit-failure-value-012" }, { name: "系统管理员" }),
      /EISDIR|directory/,
    );
    assert.equal(await readFile(envPath, "utf8"), before);
  });
});

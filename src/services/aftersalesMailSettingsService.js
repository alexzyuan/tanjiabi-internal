import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { getConfig as getRuntimeConfig, reloadDotEnv } from "../config/index.js";

const managedKeys = ["AFTERSALES_MAIL_ENABLED", "AFTERSALES_MAIL_PASSWORD"];

function safeProviderMessage(error, passwords = []) {
  let message = String(error?.message || "未知错误").trim();
  for (const password of passwords.filter(Boolean)) {
    message = message.replaceAll(String(password), "[已隐藏]");
  }
  return message
    .replace(/\b(pass(?:word)?|authorization|token)\s*[=:]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 500) || "未知错误";
}

function connectionResult(ok, checkedAt, message) {
  return { ok, checkedAt, message };
}

function configuredPassword(config = {}) {
  return typeof config.password === "string" ? config.password : String(config.password || "");
}

function configuredAccount(config = {}) {
  return String(config.user || "").trim();
}

function requiresConnectionConfig(config = {}) {
  return Boolean(
    configuredAccount(config)
    && configuredPassword(config)
    && String(config.imapHost || "").trim()
    && String(config.smtpHost || "").trim(),
  );
}

function safeActorName(actor = {}) {
  const value = typeof actor === "string" ? actor : actor?.name || actor?.username || actor?.id;
  return String(value || "未知操作人").trim().slice(0, 200) || "未知操作人";
}

function assertSafePassword(value) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error("售后邮箱授权码必须为字符串。");
  }
  if (typeof value === "string" && /[\r\n]/.test(value)) {
    throw new Error("售后邮箱授权码不得包含换行符。");
  }
}

function passwordFromPayload(payload = {}, config = {}) {
  assertSafePassword(payload.password);
  const password = payload.password || configuredPassword(config);
  assertSafePassword(password);
  return password;
}

function updateEnvValue(envText, key, value) {
  const expression = new RegExp(`^(\\s*${key}\\s*=).*?$`);
  const lines = String(envText || "").split(/\r?\n/);
  let found = false;
  const nextLines = lines.map((line) => {
    if (!expression.test(line)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) nextLines.push(`${key}=${value}`);
  return `${nextLines.filter((line, index) => line || index < nextLines.length - 1).join("\n").replace(/\n*$/, "")}\n`;
}

async function readAuditRows(auditPath) {
  try {
    const parsed = JSON.parse(await readFile(auditPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("售后邮箱设置审计文件格式无效。");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAtomically(filePath, content, options = {}) {
  const tempPath = await stageAtomically(filePath, content, options);
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await removeTemp(tempPath, error);
    throw error;
  }
}

async function stageAtomically(filePath, content, { mode } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, content, "utf8");
    if (mode !== undefined) await chmod(tempPath, mode);
    return tempPath;
  } catch (error) {
    await removeTemp(tempPath, error);
    throw error;
  }
}

async function removeTemp(tempPath, originalError) {
  try {
    await rm(tempPath, { force: true });
  } catch (cleanupError) {
    originalError.cleanupError = cleanupError;
  }
}

async function existingFileSnapshot(filePath) {
  try {
    const [content, metadata] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath),
    ]);
    return {
      exists: true,
      content,
      mode: metadata.mode & 0o7777,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, content: "", mode: undefined };
    throw error;
  }
}

export async function defaultVerifyImap(config = {}) {
  const client = new ImapFlow({
    host: config.imapHost,
    port: Number(config.imapPort || 993),
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
  } finally {
    if (connected) await client.logout();
  }
}

export async function defaultVerifySmtp(config = {}) {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: Number(config.smtpPort || 465),
    secure: true,
    auth: { user: config.user, pass: config.password },
  });
  await transporter.verify();
}

export function createAftersalesMailSettingsService({
  envPath = path.join(process.cwd(), ".env"),
  auditPath = path.join(process.cwd(), "data-cache", "aftersales-mail-settings-audit.json"),
  getConfig = getRuntimeConfig,
  reloadConfig = reloadDotEnv,
  verifyImap = defaultVerifyImap,
  verifySmtp = defaultVerifySmtp,
  now = () => new Date().toISOString(),
} = {}) {
  let lastTest = null;
  let saveQueue = Promise.resolve();

  function mailConfig() {
    const config = getConfig();
    if (!config || typeof config !== "object" || !config.aftersalesMail || typeof config.aftersalesMail !== "object") {
      throw new Error("售后邮箱配置不可用。");
    }
    return config.aftersalesMail;
  }

  async function getStatus() {
    const config = mailConfig();
    const auditRows = await readAuditRows(auditPath);
    const latest = auditRows.at(-1) || {};
    return {
      account: configuredAccount(config),
      enabled: config.enabled === true,
      passwordConfigured: Boolean(configuredPassword(config)),
      lastTest: lastTest || latest.lastTest || null,
      lastChange: latest.lastChange || null,
    };
  }

  async function testConnection(payload = {}) {
    const config = mailConfig();
    const password = passwordFromPayload(payload, config);
    const candidate = { ...config, password };
    const checkedAt = now();

    if (!requiresConnectionConfig(candidate)) {
      lastTest = connectionResult(false, checkedAt, "售后邮箱配置不完整，无法测试连接。");
      return lastTest;
    }

    try {
      await verifyImap(candidate);
    } catch (error) {
      lastTest = connectionResult(false, checkedAt, `IMAP 登录失败：${safeProviderMessage(error, [password, configuredPassword(config)])}`);
      return lastTest;
    }

    try {
      await verifySmtp(candidate);
    } catch (error) {
      lastTest = connectionResult(false, checkedAt, `SMTP 登录失败：${safeProviderMessage(error, [password, configuredPassword(config)])}`);
      return lastTest;
    }

    lastTest = connectionResult(true, checkedAt, "IMAP 和 SMTP 连接验证成功。");
    return lastTest;
  }

  async function saveSettingsInternal(payload = {}, actor = {}) {
    if (typeof payload.enabled !== "boolean") throw new Error("售后邮箱启用状态必须为布尔值。");

    const config = mailConfig();
    assertSafePassword(payload.password);
    const suppliedPassword = payload.password || "";
    const candidatePassword = suppliedPassword || configuredPassword(config);
    const requiresVerification = Boolean(suppliedPassword || payload.enabled);
    if (requiresVerification) {
      const result = await testConnection({ password: candidatePassword });
      if (!result.ok) throw new Error(result.message);
    }

    const auditRows = await readAuditRows(auditPath);
    const previous = auditRows.at(-1) || {};
    const [envSnapshot, auditSnapshot] = await Promise.all([
      existingFileSnapshot(envPath),
      existingFileSnapshot(auditPath),
    ]);

    let nextEnvText = updateEnvValue(envSnapshot.content, managedKeys[0], String(payload.enabled));
    if (suppliedPassword) nextEnvText = updateEnvValue(nextEnvText, managedKeys[1], suppliedPassword);

    const changedAt = now();
    const auditRow = {
      changedAt,
      actor: safeActorName(actor),
      enabled: payload.enabled,
      passwordConfigured: Boolean(suppliedPassword || configuredPassword(config)),
      lastTest: lastTest || previous.lastTest || null,
      lastChange: {
        changedAt,
        actor: safeActorName(actor),
      },
    };

    const envTempPath = await stageAtomically(envPath, nextEnvText, { mode: envSnapshot.mode });
    let auditTempPath = null;
    let auditCommitted = false;
    let envCommitted = false;
    try {
      auditTempPath = await stageAtomically(auditPath, `${JSON.stringify([...auditRows, auditRow], null, 2)}\n`, {
        mode: auditSnapshot.mode,
      });
      await rename(auditTempPath, auditPath);
      auditCommitted = true;
      auditTempPath = null;
      await rename(envTempPath, envPath);
      envCommitted = true;
      reloadConfig();
    } catch (error) {
      if (auditTempPath) await removeTemp(auditTempPath, error);
      if (!envCommitted) await removeTemp(envTempPath, error);
      if (auditCommitted && !envCommitted) {
        try {
          if (auditSnapshot.exists) {
            await writeAtomically(auditPath, auditSnapshot.content, { mode: auditSnapshot.mode });
          } else {
            await rm(auditPath, { force: true });
          }
        } catch (rollbackError) {
          error.auditRollbackError = rollbackError;
        }
      }
      throw error;
    }
    return getStatus();
  }

  function saveSettings(payload = {}, actor = {}) {
    const operation = saveQueue.then(() => saveSettingsInternal(payload, actor));
    saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return { getStatus, testConnection, saveSettings };
}

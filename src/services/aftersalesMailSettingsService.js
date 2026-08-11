import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { getConfig as getRuntimeConfig, reloadDotEnv } from "../config/index.js";

const managedKeys = ["AFTERSALES_MAIL_ENABLED", "AFTERSALES_MAIL_PASSWORD"];
const saveQueuesByPath = new Map();
const testOperation = "testConnection";
const testOperationType = "aftersales-mail-connection-test";

function safeProviderMessage(error, passwords = []) {
  let message = String(error?.message || "未知错误");
  const secrets = [...new Set(passwords
    .filter((password) => password !== undefined && password !== null && String(password) !== "")
    .map((password) => String(password)))];
  for (const secret of secrets) {
    message = message.replaceAll(secret, "[已隐藏]");
    const normalizedSecret = secret.trim();
    if (normalizedSecret && normalizedSecret !== secret) message = message.replaceAll(normalizedSecret, "[已隐藏]");
  }
  return message
    .replace(/\b(pass(?:word)?|authorization|token)\s*[=:]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 500) || "未知错误";
}

function sharedSaveQueueKey(envPath, auditPath) {
  return `${path.resolve(envPath)}\u0000${path.resolve(auditPath)}`;
}

function enqueueSave(queueKey, operation) {
  const previous = saveQueuesByPath.get(queueKey) || Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => {
      if (saveQueuesByPath.get(queueKey) === settled) saveQueuesByPath.delete(queueKey);
    },
    () => {
      if (saveQueuesByPath.get(queueKey) === settled) saveQueuesByPath.delete(queueKey);
    },
  );
  saveQueuesByPath.set(queueKey, settled);
  return result;
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
  const value = typeof actor === "string" ? actor : actor?.displayName || actor?.name || actor?.nick || actor?.username || actor?.id;
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

function latestTestResult(auditRows = []) {
  for (let index = auditRows.length - 1; index >= 0; index -= 1) {
    const row = auditRows[index];
    if (row?.operation === testOperation || row?.operationType === testOperationType) return row.result || null;
  }
  return null;
}

function latestLastChange(auditRows = []) {
  for (let index = auditRows.length - 1; index >= 0; index -= 1) {
    if (auditRows[index]?.lastChange) return auditRows[index].lastChange;
  }
  return null;
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

async function appendConnectionTestAudit(auditPath, { result, actor, passwords }) {
  const [auditRows, auditSnapshot] = await Promise.all([
    readAuditRows(auditPath),
    existingFileSnapshot(auditPath),
  ]);
  const errorSummary = result.ok ? "" : safeProviderMessage({ message: result.message }, passwords);
  const row = {
    operation: testOperation,
    operationType: testOperationType,
    actor: safeActorName(actor),
    time: result.checkedAt,
    result: { ...result },
    errorSummary,
  };
  await writeAtomically(
    auditPath,
    `${JSON.stringify([...auditRows, row], null, 2)}\n`,
    { mode: auditSnapshot.mode },
  );
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
  const saveQueueKey = sharedSaveQueueKey(envPath, auditPath);

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
      lastTest: latestTestResult(auditRows) || lastTest || latest.lastTest || null,
      lastChange: latestLastChange(auditRows),
    };
  }

  async function runConnectionTest(payload = {}, actor = {}, { persistAudit = true } = {}) {
    const config = mailConfig();
    const password = passwordFromPayload(payload, config);
    const candidate = { ...config, password };
    const checkedAt = now();

    const complete = async (result) => {
      if (persistAudit) {
        await appendConnectionTestAudit(auditPath, {
          result,
          actor,
          passwords: [password, configuredPassword(config)],
        });
      }
      lastTest = result;
      return result;
    };

    if (!requiresConnectionConfig(candidate)) {
      return complete(connectionResult(false, checkedAt, "售后邮箱配置不完整，无法测试连接。"));
    }

    try {
      await verifyImap(candidate);
    } catch (error) {
      return complete(connectionResult(false, checkedAt, `IMAP 登录失败：${safeProviderMessage(error, [password, configuredPassword(config)])}`));
    }

    try {
      await verifySmtp(candidate);
    } catch (error) {
      return complete(connectionResult(false, checkedAt, `SMTP 登录失败：${safeProviderMessage(error, [password, configuredPassword(config)])}`));
    }

    return complete(connectionResult(true, checkedAt, "IMAP 和 SMTP 连接验证成功。"));
  }

  function testConnection(payload = {}, actor = {}) {
    return enqueueSave(saveQueueKey, () => runConnectionTest(payload, actor));
  }

  async function saveSettingsInternal(payload = {}, actor = {}) {
    if (typeof payload.enabled !== "boolean") throw new Error("售后邮箱启用状态必须为布尔值。");

    const config = mailConfig();
    assertSafePassword(payload.password);
    const suppliedPassword = payload.password || "";
    const candidatePassword = suppliedPassword || configuredPassword(config);
    const requiresVerification = Boolean(suppliedPassword || payload.enabled);
    if (requiresVerification) {
      const result = await runConnectionTest({ password: candidatePassword }, actor, { persistAudit: false });
      if (!result.ok) throw new Error(result.message);
    }

    const auditRows = await readAuditRows(auditPath);
    const previous = auditRows.at(-1) || {};
    const durableLastTest = latestTestResult(auditRows);
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
      lastTest: durableLastTest || lastTest || previous.lastTest || null,
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
    return enqueueSave(saveQueueKey, () => saveSettingsInternal(payload, actor));
  }

  return { getStatus, testConnection, saveSettings };
}

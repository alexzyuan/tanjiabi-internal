import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/index.js";

const providerId = "modelscope";
const providerLabel = "ModelScope";
const defaultModel = "deepseek-ai/DeepSeek-V4-Flash";

function settingsFile() {
  return path.join(process.cwd(), "data-cache", "ai-provider-settings.json");
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeBaseUrl(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function baseProviderConfig(config = getConfig()) {
  const source = config.ai?.modelscope || {};
  return {
    endpoint: normalizeBaseUrl(source.endpoint),
    apiKey: source.apiKey || "",
    model: source.model || defaultModel,
    timeoutMs: Number(source.timeoutMs || 120000),
    maxOutputTokens: Number(source.maxOutputTokens || 3000),
    provider: providerId,
    providerLabel,
  };
}

export async function readAiProviderSettings(config = getConfig()) {
  const saved = await readJson(settingsFile(), {});
  return {
    provider: providerId,
    modelscopeModel: saved.modelscopeModel || config.ai?.modelscope?.model || defaultModel,
    lastTests: saved.lastTests?.modelscope ? { modelscope: saved.lastTests.modelscope } : {},
    updatedAt: saved.updatedAt || "",
  };
}

export async function updateAiProviderSettings(payload = {}, config = getConfig()) {
  const current = await readAiProviderSettings(config);
  const next = {
    ...current,
    provider: providerId,
    modelscopeModel: String(payload.modelscopeModel || current.modelscopeModel || "").trim() || current.modelscopeModel,
    updatedAt: nowText(),
  };
  await writeJson(settingsFile(), next);
  return getAiProviderStatus(config);
}

export async function resolveActiveAiProviderConfig(config = getConfig()) {
  const settings = await readAiProviderSettings(config);
  const providerConfig = baseProviderConfig(config);
  providerConfig.model = settings.modelscopeModel || providerConfig.model;
  return {
    provider: providerId,
    label: providerLabel,
    config: providerConfig,
  };
}

function safeProviderStatus(settings, config) {
  const providerConfig = baseProviderConfig(config);
  return {
    id: providerId,
    label: providerLabel,
    endpoint: providerConfig.endpoint,
    model: settings.modelscopeModel || providerConfig.model,
    apiKeyConfigured: Boolean(providerConfig.apiKey),
    lastTest: settings.lastTests?.modelscope || null,
  };
}

export async function getAiProviderStatus(config = getConfig()) {
  const settings = await readAiProviderSettings(config);
  return {
    ok: true,
    activeProvider: providerId,
    updatedAt: settings.updatedAt,
    providers: [safeProviderStatus(settings, config)],
  };
}

async function probeModelsEndpoint(providerConfig, fetchImpl) {
  const response = await fetchImpl(`${providerConfig.endpoint}/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${providerConfig.apiKey}`,
      accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `${providerLabel} /models 测试失败：${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

async function probeChatCompletion(providerConfig, fetchImpl) {
  const response = await fetchImpl(`${providerConfig.endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${providerConfig.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: providerConfig.model,
      messages: [{ role: "user", content: "ping" }],
      temperature: 0,
      max_tokens: 8,
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `${providerLabel} chat 测试失败：${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

export async function testAiProviderConnection(provider = "", config = getConfig(), options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const providerConfig = baseProviderConfig(config);
  const settings = await readAiProviderSettings(config);
  providerConfig.model = settings.modelscopeModel || providerConfig.model;
  if (!providerConfig.apiKey) {
    const result = {
      ok: false,
      provider: providerId,
      label: providerLabel,
      model: providerConfig.model,
      endpoint: providerConfig.endpoint,
      checkedAt: nowText(),
      message: `${providerLabel} API Key 未配置。`,
    };
    await updateLastTest(result, config);
    return result;
  }
  try {
    let models = [];
    try {
      models = await probeModelsEndpoint(providerConfig, fetchImpl);
    } catch {
      await probeChatCompletion(providerConfig, fetchImpl);
    }
    const result = {
      ok: true,
      provider: providerId,
      label: providerLabel,
      model: providerConfig.model,
      endpoint: providerConfig.endpoint,
      modelCount: models.length,
      sampleModels: models.slice(0, 5).map((item) => item.id || item.name || item.model).filter(Boolean),
      checkedAt: nowText(),
      message: models.length ? `连接成功，读取到 ${models.length} 个模型。` : "连接成功。",
    };
    await updateLastTest(result, config);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      provider: providerId,
      label: providerLabel,
      model: providerConfig.model,
      endpoint: providerConfig.endpoint,
      checkedAt: nowText(),
      message: error.message || "连接测试失败。",
    };
    await updateLastTest(result, config);
    return result;
  }
}

async function updateLastTest(result, config) {
  const settings = await readAiProviderSettings(config);
  await writeJson(settingsFile(), {
    ...settings,
    provider: providerId,
    lastTests: {
      modelscope: result,
    },
    updatedAt: nowText(),
  });
}

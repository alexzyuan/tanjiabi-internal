import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getAiProviderStatus,
  resolveActiveAiProviderConfig,
  testAiProviderConnection,
  updateAiProviderSettings,
} from "../src/services/aiProviderService.js";

async function withTempCwd(fn) {
  const original = process.cwd();
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-ai-provider-"));
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(original);
    await rm(dir, { recursive: true, force: true });
  }
}

function sampleConfig() {
  return {
    ai: {
      provider: "modelscope",
      modelscope: {
        endpoint: "https://api-inference.modelscope.cn/v1",
        apiKey: "ms-key",
        model: "deepseek-ai/DeepSeek-V4-Flash",
        timeoutMs: 1000,
        maxOutputTokens: 300,
      },
    },
  };
}

test("resolveActiveAiProviderConfig defaults to ModelScope and masks keys in status", async () => {
  await withTempCwd(async () => {
    const config = sampleConfig();
    const active = await resolveActiveAiProviderConfig(config);
    const status = await getAiProviderStatus(config);

    assert.equal(active.provider, "modelscope");
    assert.equal(active.config.endpoint, "https://api-inference.modelscope.cn/v1");
    assert.equal(active.config.model, "deepseek-ai/DeepSeek-V4-Flash");
    assert.equal(status.activeProvider, "modelscope");
    assert.equal(status.providers.find((item) => item.id === "modelscope").apiKeyConfigured, true);
    assert.equal(JSON.stringify(status).includes("ms-key"), false);
    assert.equal(status.providers.length, 1);
  });
});

test("updateAiProviderSettings only updates the ModelScope model", async () => {
  await withTempCwd(async () => {
    const config = sampleConfig();
    await updateAiProviderSettings({ provider: "other", modelscopeModel: "deepseek-ai/DeepSeek-V4-Flash" }, config);
    const active = await resolveActiveAiProviderConfig(config);

    assert.equal(active.provider, "modelscope");
    assert.equal(active.config.endpoint, "https://api-inference.modelscope.cn/v1");
    assert.equal(active.config.apiKey, "ms-key");
    assert.equal(active.config.model, "deepseek-ai/DeepSeek-V4-Flash");
  });
});

test("testAiProviderConnection probes OpenAI compatible models endpoint", async () => {
  await withTempCwd(async () => {
    const calls = [];
    const result = await testAiProviderConnection("modelscope", sampleConfig(), {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: "deepseek-chat" }, { id: "moonshot-v1-8k" }] }),
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "modelscope");
    assert.equal(result.modelCount, 2);
    assert.equal(calls[0].url, "https://api-inference.modelscope.cn/v1/models");
    assert.equal(calls[0].options.headers.authorization, "Bearer ms-key");
  });
});

test("testAiProviderConnection falls back to chat completion when models endpoint is unavailable", async () => {
  await withTempCwd(async () => {
    const calls = [];
    const result = await testAiProviderConnection("modelscope", sampleConfig(), {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (String(url).endsWith("/models")) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ message: "not found" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "ok" } }],
          }),
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "modelscope");
    assert.equal(result.message, "连接成功。");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "https://api-inference.modelscope.cn/v1/chat/completions");
    assert.equal(calls[1].options.headers.authorization, "Bearer ms-key");
  });
});

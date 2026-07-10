import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelScopeText,
  generateAftersalesReplySuggestion,
  generateModelScopeText,
} from "../src/services/modelscopeService.js";

test("ModelScope service reports unavailable when API key is missing", async () => {
  await assert.rejects(
    () => generateModelScopeText({ apiKey: "", model: "deepseek-ai/DeepSeek-V4-Flash" }, "hello", { fetchImpl: async () => ({}) }),
    /ModelScope API 尚未配置/,
  );
});

test("ModelScope service sends OpenAI compatible chat completion request", async () => {
  const calls = [];
  const result = await generateModelScopeText(
    {
      apiKey: "test-key",
      model: "deepseek-ai/DeepSeek-V4-Flash",
      endpoint: "https://api-inference.modelscope.cn/v1",
      timeoutMs: 1000,
      maxOutputTokens: 300,
    },
    "你好",
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            model: "deepseek-ai/DeepSeek-V4-Flash",
            choices: [{ message: { content: "您好，已收到您的邮件。", reasoning_content: "思考" }, finish_reason: "stop" }],
          }),
        };
      },
    },
  );

  assert.equal(result.text, "您好，已收到您的邮件。");
  assert.equal(result.reasoning, "思考");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api-inference.modelscope.cn/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 300);
  assert.match(body.messages[0].content, /你好/);
});

test("extractModelScopeText reads content and reasoning", () => {
  assert.deepEqual(
    extractModelScopeText({
      choices: [{ message: { content: "最终回答", reasoning_content: "推理过程" } }],
    }),
    { text: "最终回答", reasoning: "推理过程" },
  );
});

test("after-sales ModelScope prompt includes email context and safety limits", async () => {
  const calls = [];
  const result = await generateAftersalesReplySuggestion(
    { apiKey: "test-key", model: "deepseek-ai/DeepSeek-V4-Flash", endpoint: "https://example.test", timeoutMs: 1000 },
    {
      subject: "Broken item",
      from: "buyer@example.com",
      text: "The toy stopped working after one day.",
      status: "new",
    },
    {
      fetchImpl: async (url, options) => {
        calls.push(JSON.parse(options.body));
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "您好，很抱歉给您带来不便。" } }] }),
        };
      },
    },
  );

  assert.equal(result.suggestion, "您好，很抱歉给您带来不便。");
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /JOI MEW/);
  assert.match(prompt, /美国客户|American/);
  assert.match(prompt, /美式英语|American English/);
  assert.match(prompt, /专业、简洁、清晰|professional, concise, and clear/);
  assert.match(prompt, /完整邮件正文/);
  assert.match(prompt, /提取.*有效客户/);
  assert.match(prompt, /不需要人工选中/);
  assert.match(prompt, /Broken item/);
  assert.match(prompt, /buyer@example\.com/);
  assert.match(prompt, /不要承诺退款、补发或赔偿/);
});

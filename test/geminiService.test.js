import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGeminiText,
  generateAftersalesReplySuggestion,
  generateGeminiText,
} from "../src/services/geminiService.js";

test("Gemini service reports unavailable when API key is missing", async () => {
  await assert.rejects(
    () => generateGeminiText({ apiKey: "", model: "gemini-2.5-flash" }, "hello", { fetchImpl: async () => ({}) }),
    /Gemini API 尚未配置/,
  );
});

test("Gemini service sends generateContent request with API key header", async () => {
  const calls = [];
  const result = await generateGeminiText(
    {
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      timeoutMs: 1000,
      maxOutputTokens: 300,
    },
    "请生成回复",
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "您好，已收到您的邮件。" }] } }],
            modelVersion: "gemini-2.5-flash",
          }),
        };
      },
    },
  );

  assert.equal(result.text, "您好，已收到您的邮件。");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.generationConfig.maxOutputTokens, 300);
  assert.match(body.contents[0].parts[0].text, /请生成回复/);
});

test("Gemini service attaches proxy dispatcher when proxy URL is configured", async () => {
  const calls = [];
  await generateGeminiText(
    {
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      proxyUrl: "http://127.0.0.1:7890",
    },
    "hello",
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        };
      },
    },
  );

  assert.ok(calls[0].options.dispatcher);
});

test("extractGeminiText reads text from Gemini candidates", () => {
  assert.equal(
    extractGeminiText({
      candidates: [{ content: { parts: [{ text: "第一段" }, { text: "第二段" }] } }],
    }),
    "第一段\n第二段",
  );
});

test("after-sales suggestion prompt includes email context and safety limits", async () => {
  const calls = [];
  const result = await generateAftersalesReplySuggestion(
    { apiKey: "test-key", model: "gemini-2.5-flash", endpoint: "https://example.test", timeoutMs: 1000 },
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
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "您好，很抱歉给您带来不便。" }] } }],
          }),
        };
      },
    },
  );

  assert.equal(result.suggestion, "您好，很抱歉给您带来不便。");
  const prompt = calls[0].contents[0].parts[0].text;
  assert.match(prompt, /Broken item/);
  assert.match(prompt, /buyer@example\.com/);
  assert.match(prompt, /不要承诺退款、补发或赔偿/);
});

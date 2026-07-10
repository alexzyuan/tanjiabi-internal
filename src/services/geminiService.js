import { ProxyAgent } from "undici";

const DEFAULT_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

function normalizeText(value, maxLength = 6000) {
  return String(value || "").trim().slice(0, maxLength);
}

function geminiEndpoint(config = {}) {
  const base = String(config.endpoint || DEFAULT_GEMINI_ENDPOINT).replace(/\/+$/, "");
  const model = encodeURIComponent(config.model || "gemini-2.5-flash");
  return `${base}/models/${model}:generateContent`;
}

export function extractGeminiText(payload = {}) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part?.text || "").filter(Boolean).join("\n").trim();
}

function extractJsonObject(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Gemini 返回内容不是有效 JSON。");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export async function generateGeminiText(config = {}, prompt = "", options = {}) {
  if (!config?.apiKey) {
    const error = new Error("Gemini API 尚未配置。");
    error.statusCode = 503;
    throw error;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs || 120000));
  try {
    const requestOptions = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: normalizeText(prompt, options.maxPromptLength || 12000) }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: Number(config.maxOutputTokens || options.maxOutputTokens || 1200),
        },
      }),
      signal: controller.signal,
    };
    if (config.proxyUrl) requestOptions.dispatcher = new ProxyAgent(config.proxyUrl);
    const response = await fetchImpl(geminiEndpoint(config), requestOptions);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `Gemini API 请求失败：${response.status}`);
      error.statusCode = 502;
      throw error;
    }
    const text = extractGeminiText(payload);
    if (!text) throw new Error("Gemini 未返回可用文本。");
    return { text, model: payload.modelVersion || config.model };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Gemini API 请求超时。");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAftersalesReplySuggestion(config = {}, mail = {}, options = {}) {
  const prompt = [
    "你是探嘉 ERP 的中文售后客服助手。",
    "请根据站外售后邮件生成一段可直接编辑的中文回复草稿。",
    "语气要礼貌、具体、简洁，先表达已收到并理解问题。",
    "不要承诺退款、补发或赔偿；如信息不足，请请求客户补充订单号、产品照片、视频、物流单号或问题细节。",
    "只输出回复正文，不要输出标题、解释或项目符号。",
    "",
    `邮件状态：${normalizeText(mail.status, 40) || "new"}`,
    `发件人：${normalizeText(mail.from || mail.fromAddress, 300)}`,
    `主题：${normalizeText(mail.subject, 500)}`,
    "邮件正文：",
    normalizeText(mail.text || mail.snippet, 8000),
  ].join("\n");
  const result = await generateGeminiText(config, prompt, { ...options, temperature: 0.25, maxPromptLength: 12000 });
  return {
    suggestion: result.text,
    model: result.model,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeListing(value) {
  const bullets = Array.isArray(value?.bullets)
    ? value.bullets.map((item) => normalizeText(item, 600)).filter(Boolean).slice(0, 5)
    : [];
  if (bullets.length !== 5) throw new Error("Gemini 未返回完整的五点描述。");
  const listing = {
    oldTitle: normalizeText(value?.oldTitle, 200),
    title: normalizeText(value?.title, 75),
    highlights: normalizeText(value?.highlights, 125),
    bullets,
    description: normalizeText(value?.description, 4000),
    keywords: normalizeText(value?.keywords, 1000),
  };
  if (!listing.oldTitle || !listing.title || !listing.highlights || !listing.description || !listing.keywords) {
    throw new Error("Gemini 返回的 Listing 字段不完整。");
  }
  return listing;
}

function buildProductBrief(payload) {
  return [
    `产品线：${normalizeText(payload.productLine, 100)}`,
    `商品名称：${normalizeText(payload.productName, 300)}`,
    `产品类目：${normalizeText(payload.category, 300)}`,
    `目标站点：${normalizeText(payload.market, 50)}`,
    `适用人群：${normalizeText(payload.audience, 1000)}`,
    `使用场景：${normalizeText(payload.scenes, 1500)}`,
    `核心功能：${normalizeText(payload.features, 2000)}`,
    `规格参数：${normalizeText(payload.parameters, 2500)}`,
    `竞品链接：${normalizeText(payload.competitor, 1500)}`,
    `文案风格：${normalizeText(payload.style, 100)}`,
  ].join("\n");
}

export async function generateGeminiListingCopy(config = {}, payload = {}, options = {}) {
  const prompt = [
    "You are an Amazon listing copywriter. Follow the supplied facts exactly and output valid JSON only.",
    "Create an Amazon US English listing. Do not invent specifications, quantities, certifications or performance claims that are not provided.",
    "Return both the current legacy title and Amazon's new product-name layout: a concise title plus a separate searchable Item Highlights field.",
    "Return JSON only with this exact shape:",
    '{"oldTitle":"string","title":"string","highlights":"string","bullets":["string","string","string","string","string"],"description":"string","keywords":"string"}',
    "Legacy title: maximum 200 characters. New title: maximum 75 characters including spaces. Item Highlights: maximum 125 characters including spaces. Bullets: exactly 5. Keywords: space-separated search terms.",
    "",
    buildProductBrief(payload),
  ].join("\n");
  const result = await generateGeminiText(config, prompt, { ...options, temperature: 0.35, maxPromptLength: 16000 });
  return {
    listing: normalizeListing(extractJsonObject(result.text)),
    model: result.model,
    imageCount: Array.isArray(payload.images) ? payload.images.length : 0,
  };
}

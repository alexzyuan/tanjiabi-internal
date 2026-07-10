const DEFAULT_MODELSCOPE_ENDPOINT = "https://api-inference.modelscope.cn/v1";
const DEFAULT_MODELSCOPE_MODEL = "deepseek-ai/DeepSeek-V4-Flash";

function normalizeText(value, maxLength = 6000) {
  return String(value || "").trim().slice(0, maxLength);
}

function modelScopeEndpoint(config = {}) {
  const base = String(config.endpoint || DEFAULT_MODELSCOPE_ENDPOINT).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

export function extractModelScopeText(payload = {}) {
  const message = payload?.choices?.[0]?.message || {};
  return {
    text: normalizeText(message.content, 20000),
    reasoning: normalizeText(message.reasoning_content, 20000),
  };
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
    if (start === -1 || end <= start) throw new Error("ModelScope 返回内容不是有效 JSON。");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export async function generateModelScopeText(config = {}, prompt = "", options = {}) {
  if (!config?.apiKey) {
    const error = new Error("ModelScope API 尚未配置。");
    error.statusCode = 503;
    throw error;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs || 120000));
  try {
    const response = await fetchImpl(modelScopeEndpoint(config), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODELSCOPE_MODEL,
        messages: [{ role: "user", content: normalizeText(prompt, options.maxPromptLength || 12000) }],
        stream: false,
        temperature: options.temperature ?? 0.4,
        max_tokens: Number(config.maxOutputTokens || options.maxOutputTokens || 1200),
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `ModelScope API 请求失败：${response.status}`);
      error.statusCode = 502;
      throw error;
    }
    const result = extractModelScopeText(payload);
    if (!result.text) throw new Error("ModelScope 未返回可用文本。");
    return {
      ...result,
      model: payload.model || config.model || DEFAULT_MODELSCOPE_MODEL,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("ModelScope API 请求超时。");
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
    "你是 JOI MEW 店铺的英文邮箱客服，主要面对美国客户，负责处理站外售后邮件、产品咨询、使用问题、物流/订单协助和基础客诉安抚。",
    "请生成一段可直接粘贴发送给客户的英文邮件正文。",
    "系统已经提供这封邮件的完整邮件正文，不需要人工选中任何文本。",
    "你必须先从完整邮件正文中提取有效客户问题，只关注客户真实诉求和关键信息。",
    "请忽略邮件签名、历史引用、转发头、系统提示、免责声明、重复内容、图片文件名等噪音；不要把提取过程输出。",
    "回复必须使用自然、礼貌、专业、简洁、清晰易懂的美式英语（professional, concise, and clear American English）。",
    "先明确表示已收到并理解客户的问题，必要时表达歉意和同理心。",
    "根据邮件内容给出清晰、可执行的下一步，不要空泛回复。",
    "如果信息不足，请一次性请求客户补充必要信息，例如订单号、购买平台、产品照片/视频、故障现象、收件信息或物流单号。",
    "不要承诺退款、补发或赔偿，也不要主动承诺折扣或平台外交易；如客户要求退款/补发，只能表示会核实并提交团队处理。",
    "不要编造政策、库存、物流时效、订单状态、产品参数或责任归属。",
    "避免使用中文、内部系统词、AI 自称、标题、解释或项目符号。",
    "",
    `邮件状态：${normalizeText(mail.status, 40) || "new"}`,
    `发件人：${normalizeText(mail.from || mail.fromAddress, 300)}`,
    `主题：${normalizeText(mail.subject, 500)}`,
    "完整邮件正文：",
    normalizeText(mail.text || mail.snippet, 8000),
  ].join("\n");
  const result = await generateModelScopeText(config, prompt, { ...options, temperature: 0.25, maxPromptLength: 12000 });
  return {
    suggestion: result.text,
    reasoning: result.reasoning,
    model: result.model,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeListing(value) {
  const bullets = Array.isArray(value?.bullets)
    ? value.bullets.map((item) => normalizeText(item, 600)).filter(Boolean).slice(0, 5)
    : [];
  if (bullets.length !== 5) throw new Error("ModelScope 未返回完整的五点描述。");
  const listing = {
    oldTitle: normalizeText(value?.oldTitle, 200),
    title: normalizeText(value?.title, 75),
    highlights: normalizeText(value?.highlights, 125),
    bullets,
    description: normalizeText(value?.description, 4000),
    keywords: normalizeText(value?.keywords, 1000),
  };
  if (!listing.oldTitle || !listing.title || !listing.highlights || !listing.description || !listing.keywords) {
    throw new Error("ModelScope 返回的 Listing 字段不完整。");
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

export async function generateModelScopeListingCopy(config = {}, payload = {}, options = {}) {
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
  const result = await generateModelScopeText(config, prompt, { ...options, temperature: 0.35, maxPromptLength: 16000 });
  return {
    listing: normalizeListing(extractJsonObject(result.text)),
    model: result.model,
    imageCount: Array.isArray(payload.images) ? payload.images.length : 0,
  };
}

import { generateModelScopeListingCopy } from "./modelscopeService.js";

const MAX_IMAGES = 3;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalizeText(value, maxLength = 6000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeImages(images) {
  if (!Array.isArray(images) || !images.length) return [];
  if (images.length > MAX_IMAGES) {
    throw new Error(`产品图片最多上传 ${MAX_IMAGES} 张。`);
  }
  return images.map((image, index) => {
    const dataUrl = String(image?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
    if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1])) {
      throw new Error(`第 ${index + 1} 张图片格式无效。`);
    }
    return {
      dataUrl,
      name: normalizeText(image?.name || `product-${index + 1}`, 200),
      type: match[1],
    };
  });
}

export async function generateAiListingCopy(config, payload) {
  if (!config?.apiKey) {
    const error = new Error("ModelScope API 尚未配置。");
    error.statusCode = 503;
    throw error;
  }

  const images = normalizeImages(payload.images);
  return generateModelScopeListingCopy(config, { ...payload, images });
}

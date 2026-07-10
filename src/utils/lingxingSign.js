import crypto from "node:crypto";

function normalizeValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  return String(value);
}

function getAesAlgorithm(key) {
  const length = Buffer.byteLength(key);
  if (length === 16) return "aes-128-ecb";
  if (length === 24) return "aes-192-ecb";
  if (length === 32) return "aes-256-ecb";
  throw new Error("Lingxing AppId must be 16, 24, or 32 bytes for AES signing.");
}

export function createLingxingSign(params, appId) {
  const signText = Object.keys(params)
    .sort()
    .filter((key) => params[key] !== "")
    .map((key) => `${key}=${normalizeValue(params[key])}`)
    .join("&");

  const md5 = crypto.createHash("md5").update(signText, "utf8").digest("hex").toUpperCase();
  const cipher = crypto.createCipheriv(getAesAlgorithm(appId), Buffer.from(appId), null);
  cipher.setAutoPadding(true);
  return cipher.update(md5, "utf8", "base64") + cipher.final("base64");
}

export function normalizedSalesImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("/")) return text;
  const imageUrl = text.startsWith("//") ? `https:${text}` : text;
  if (!/^https?:\/\//i.test(imageUrl)) return "";
  return imageUrl;
}

export function cachedSalesImageUrl(value) {
  const imageUrl = normalizedSalesImageUrl(value);
  if (!imageUrl) return "";
  if (imageUrl.startsWith("/")) return imageUrl;
  return `/api/image-cache?url=${encodeURIComponent(imageUrl)}`;
}

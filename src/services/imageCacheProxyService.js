import crypto from "node:crypto";
import dns from "node:dns/promises";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { readJson, writeJsonAtomic } from "../utils/jsonStore.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SAFE_IMAGE_EXTENSIONS = new Map([
  ["image/apng", ".png"],
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function imageProxyError(message, code, statusCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isPrivateIpv4(address) {
  const parts = String(address || "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts;
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized || normalized === "::" || normalized === "::1") return true;
  const firstGroup = Number.parseInt(normalized.split(":", 1)[0], 16);
  if (
    (firstGroup & 0xfe00) === 0xfc00
    || (firstGroup & 0xffc0) === 0xfe80
    || (firstGroup & 0xff00) === 0xff00
    || normalized.startsWith("2001:db8:")
  ) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return normalized.startsWith("::ffff:");
}

function isBlockedIpAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function parseImageUrl(imageUrl) {
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (error) {
    throw imageProxyError("图片地址无效。", "IMAGE_CACHE_INVALID_URL", 400, error);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw imageProxyError("只支持 http/https 图片。", "IMAGE_CACHE_INVALID_PROTOCOL", 400);
  }
  return parsed;
}

async function validateTarget(parsed, lookup) {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw imageProxyError("图片地址不允许指向本机或内网。", "IMAGE_CACHE_PRIVATE_TARGET", 400);
  }

  if (net.isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw imageProxyError("图片地址不允许指向本机或内网。", "IMAGE_CACHE_PRIVATE_TARGET", 400);
    }
    return;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw imageProxyError("图片地址解析失败。", "IMAGE_CACHE_DNS_FAILED", 502, error);
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => isBlockedIpAddress(entry?.address))) {
    throw imageProxyError("图片地址不允许指向本机或内网。", "IMAGE_CACHE_PRIVATE_TARGET", 400);
  }
}

function normalizeContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function imageExtension(contentType) {
  return SAFE_IMAGE_EXTENSIONS.get(contentType) || ".img";
}

function assertImageContentType(value) {
  const contentType = normalizeContentType(value);
  if (!SAFE_IMAGE_EXTENSIONS.has(contentType)) {
    throw imageProxyError("图片读取失败：返回内容不是安全的图片格式。", "IMAGE_CACHE_UNSAFE_TYPE", 502);
  }
  return contentType;
}

function validateContentLength(value, maxBytes) {
  if (value === null || value === undefined || value === "") return;
  if (!/^\d+$/.test(String(value))) {
    throw imageProxyError("图片读取失败：响应大小无效。", "IMAGE_CACHE_INVALID_LENGTH", 502);
  }
  if (Number(value) > maxBytes) {
    throw imageProxyError("图片超过缓存大小限制。", "IMAGE_CACHE_TOO_LARGE", 413);
  }
}

async function readCachedImage(cacheDir, metaPath, key, maxBytes) {
  const meta = await readJson(metaPath, null);
  if (!meta) return null;
  const expectedFilePrefix = `${key}.`;
  if (
    typeof meta !== "object"
    || typeof meta.file !== "string"
    || path.basename(meta.file) !== meta.file
    || !meta.file.startsWith(expectedFilePrefix)
  ) {
    throw imageProxyError("图片缓存元数据无效。", "IMAGE_CACHE_METADATA_INVALID", 500);
  }
  const contentType = assertImageContentType(meta.contentType);
  const bytes = await readFile(path.join(cacheDir, meta.file));
  if (bytes.length > maxBytes) {
    throw imageProxyError("图片缓存超过大小限制。", "IMAGE_CACHE_TOO_LARGE", 413);
  }
  return {
    bytes,
    contentType,
    cacheHit: true,
    sourceUrl: "",
  };
}

function startTimedFetch(fetchImpl, parsed, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stopTimeout = () => clearTimeout(timer);
  const request = fetchImpl(parsed.href, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "manual",
    signal: controller.signal,
  }).catch((error) => {
    if (controller.signal.aborted) {
      throw imageProxyError("图片读取超时。", "IMAGE_CACHE_TIMEOUT", 504, error);
    }
    throw imageProxyError("图片读取失败。", "IMAGE_CACHE_FETCH_FAILED", 502, error);
  });
  return { controller, request, stopTimeout };
}

async function writeResponseBody({ response, controller, tempPath, maxBytes }) {
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    throw imageProxyError("图片读取失败：响应内容为空。", "IMAGE_CACHE_EMPTY_BODY", 502);
  }

  const fileHandle = await open(tempPath, "wx");
  const iterator = response.body[Symbol.asyncIterator]();
  let totalBytes = 0;
  let abortListener;
  const abortPromise = new Promise((_, reject) => {
    abortListener = () => reject(imageProxyError("图片读取超时。", "IMAGE_CACHE_TIMEOUT", 504));
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    while (true) {
      const { done, value } = await Promise.race([iterator.next(), abortPromise]);
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw imageProxyError("图片超过缓存大小限制。", "IMAGE_CACHE_TOO_LARGE", 413);
      }
      await fileHandle.write(chunk);
    }
    if (!totalBytes) {
      throw imageProxyError("图片读取失败：响应内容为空。", "IMAGE_CACHE_EMPTY_BODY", 502);
    }
    await fileHandle.sync();
    return totalBytes;
  } finally {
    controller.signal.removeEventListener("abort", abortListener);
    await iterator.return?.().catch(() => undefined);
    await fileHandle.close();
  }
}

export function createImageCacheProxyService({
  cacheDir,
  fetchImpl = globalThis.fetch,
  lookup = dns.lookup,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
  if (!cacheDir) throw new Error("createImageCacheProxyService requires cacheDir.");
  if (typeof fetchImpl !== "function") throw new Error("createImageCacheProxyService requires fetch.");

  return {
    async getImage(imageUrl) {
      const original = parseImageUrl(imageUrl);
      const key = crypto.createHash("sha256").update(original.href).digest("hex");
      const metaPath = path.join(cacheDir, `${key}.json`);
      const cached = await readCachedImage(cacheDir, metaPath, key, maxBytes);
      if (cached) return cached;

      await mkdir(cacheDir, { recursive: true });
      let current = original;
      let redirectCount = 0;

      while (true) {
        await validateTarget(current, lookup);
        const timedFetch = startTimedFetch(fetchImpl, current, timeoutMs);
        let response;
        try {
          response = await timedFetch.request;
          if (REDIRECT_STATUSES.has(response.status)) {
            timedFetch.stopTimeout();
            await response.body?.cancel?.();
            if (redirectCount >= maxRedirects) {
              throw imageProxyError("图片重定向次数过多。", "IMAGE_CACHE_REDIRECT_LIMIT", 502);
            }
            const location = response.headers.get("location");
            if (!location) {
              throw imageProxyError("图片重定向地址无效。", "IMAGE_CACHE_REDIRECT_INVALID", 502);
            }
            current = parseImageUrl(new URL(location, current).href);
            redirectCount += 1;
            continue;
          }
          if (!response.ok) {
            throw imageProxyError(`图片读取失败：上游状态 ${response.status}。`, "IMAGE_CACHE_UPSTREAM_STATUS", 502);
          }

          const contentType = assertImageContentType(response.headers.get("content-type"));
          validateContentLength(response.headers.get("content-length"), maxBytes);
          const file = `${key}${imageExtension(contentType)}`;
          const filePath = path.join(cacheDir, file);
          const tempPath = path.join(cacheDir, `.${key}.${process.pid}.${crypto.randomUUID()}.tmp`);
          let committed = false;
          try {
            const totalBytes = await writeResponseBody({
              response,
              controller: timedFetch.controller,
              tempPath,
              maxBytes,
            });
            await rename(tempPath, filePath);
            await writeJsonAtomic(metaPath, {
              file,
              contentType,
              bytes: totalBytes,
            });
            committed = true;
            return {
              bytes: await readFile(filePath),
              contentType,
              cacheHit: false,
              sourceUrl: current.href,
            };
          } finally {
            timedFetch.stopTimeout();
            await rm(tempPath, { force: true });
            if (!committed) await rm(filePath, { force: true });
          }
        } finally {
          timedFetch.stopTimeout();
        }
      }
    },
  };
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createImageCacheProxyService } from "../src/services/imageCacheProxyService.js";

function response({ status = 200, headers = {}, chunks = [] } = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: normalizedHeaders,
    body: Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
  };
}

function publicLookup(hostname) {
  assert.match(hostname, /example\.com$/);
  return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
}

async function withService(options, callback) {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "image-cache-proxy-"));
  const service = createImageCacheProxyService({ cacheDir, lookup: publicLookup, ...options });
  try {
    await callback(service, cacheDir);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

test("image proxy revalidates every redirect target before fetching it", async () => {
  const calls = [];
  await withService({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), redirect: options.redirect });
      return response({ status: 302, headers: { location: "http://127.0.0.1/private.png" } });
    },
  }, async (service) => {
    await assert.rejects(
      () => service.getImage("https://images.example.com/start.png"),
      (error) => error?.code === "IMAGE_CACHE_PRIVATE_TARGET" && error?.statusCode === 400,
    );
  });

  assert.deepEqual(calls, [{ url: "https://images.example.com/start.png", redirect: "manual" }]);
});

test("image proxy rejects IPv6 loopback targets without fetching them", async () => {
  let called = false;
  await withService({
    fetchImpl: async () => {
      called = true;
      return response();
    },
  }, async (service) => {
    await assert.rejects(
      () => service.getImage("http://[::1]/private.png"),
      (error) => error?.code === "IMAGE_CACHE_PRIVATE_TARGET" && error?.statusCode === 400,
    );
  });
  assert.equal(called, false);
});

test("image proxy rejects redirect chains beyond the configured limit", async () => {
  let callCount = 0;
  await withService({
    maxRedirects: 2,
    fetchImpl: async () => {
      callCount += 1;
      return response({ status: 302, headers: { location: `/hop-${callCount}.png` } });
    },
  }, async (service) => {
    await assert.rejects(
      () => service.getImage("https://images.example.com/start.png"),
      (error) => error?.code === "IMAGE_CACHE_REDIRECT_LIMIT",
    );
  });

  assert.equal(callCount, 3);
});

test("image proxy aborts an upstream request after its timeout", async () => {
  await withService({
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  }, async (service) => {
    await assert.rejects(
      () => service.getImage("https://images.example.com/slow.png"),
      (error) => error?.code === "IMAGE_CACHE_TIMEOUT" && error?.statusCode === 504,
    );
  });
});

test("image proxy rejects declared and streamed responses over the byte limit", async () => {
  await withService({
    maxBytes: 6,
    fetchImpl: async (url) => String(url).includes("declared")
      ? response({
        headers: { "content-type": "image/png", "content-length": "7" },
        chunks: ["1234567"],
      })
      : response({ headers: { "content-type": "image/png" }, chunks: ["1234", "5678"] }),
  }, async (service, cacheDir) => {
    for (const filename of ["declared.png", "streamed.png"]) {
      await assert.rejects(
        () => service.getImage(`https://images.example.com/${filename}`),
        (error) => error?.code === "IMAGE_CACHE_TOO_LARGE" && error?.statusCode === 413,
      );
    }
    assert.deepEqual(await readdir(cacheDir), []);
  });
});

test("image proxy rejects active SVG content instead of serving it from the application origin", async () => {
  await withService({
    fetchImpl: async () => response({
      headers: { "content-type": "image/svg+xml" },
      chunks: ["<svg><script>alert(1)</script></svg>"],
    }),
  }, async (service, cacheDir) => {
    await assert.rejects(
      () => service.getImage("https://images.example.com/active.svg"),
      (error) => error?.code === "IMAGE_CACHE_UNSAFE_TYPE" && error?.statusCode === 502,
    );
    assert.deepEqual(await readdir(cacheDir), []);
  });
});

test("image proxy atomically caches a bounded image and reuses it", async () => {
  let callCount = 0;
  await withService({
    maxBytes: 64,
    fetchImpl: async () => {
      callCount += 1;
      return response({
        headers: { "content-type": "image/png", "content-length": "8" },
        chunks: ["1234", "5678"],
      });
    },
  }, async (service, cacheDir) => {
    const signedUrl = "https://images.example.com/product.png?token=must-not-be-persisted";
    const first = await service.getImage(signedUrl);
    const second = await service.getImage(signedUrl);

    assert.equal(first.bytes.toString("utf8"), "12345678");
    assert.equal(first.contentType, "image/png");
    assert.equal(first.cacheHit, false);
    assert.equal(second.bytes.toString("utf8"), "12345678");
    assert.equal(second.cacheHit, true);
    assert.equal(callCount, 1);
    const cacheFiles = await readdir(cacheDir);
    assert.equal(cacheFiles.some((name) => name.endsWith(".tmp")), false);
    const metadataFile = cacheFiles.find((name) => name.endsWith(".json"));
    const metadata = await readFile(path.join(cacheDir, metadataFile), "utf8");
    assert.equal(metadata.includes("must-not-be-persisted"), false);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPaginatedRecords,
  createLingxingClient,
  normalizeLingxingError,
  redactSensitive,
} from "../src/adapters/lingxing/index.js";

const testConfig = {
  baseUrl: "https://openapi.test/",
  appKey: "1234567890abcdef",
  appSecret: "app-secret-value",
};

function jsonResponse(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return payload;
    },
  };
}

test("Lingxing error redaction removes app secrets and tokens from nested details", () => {
  const redacted = redactSensitive({
    url: "https://example.test?access_token=abc123&app_secret=super",
    access_token: "abc123",
    refreshToken: "refresh-123",
    nested: {
      appSecret: "super-secret",
      message: "token abc123 failed",
    },
  });

  const text = JSON.stringify(redacted);
  assert.equal(text.includes("abc123"), false);
  assert.equal(text.includes("refresh-123"), false);
  assert.equal(text.includes("super-secret"), false);
  assert.match(text, /\[REDACTED\]/);
});

test("Lingxing API errors normalize status, code, retryability, and safe details", () => {
  const error = normalizeLingxingError({
    endpoint: "/erp/sc/data/seller/lists",
    response: { status: 429, statusText: "Too Many Requests" },
    payload: {
      code: "LIMIT",
      message: "access_token abc123 rate limited",
      access_token: "abc123",
    },
  });

  assert.equal(error.source, "lingxing");
  assert.equal(error.endpoint, "/erp/sc/data/seller/lists");
  assert.equal(error.status, 429);
  assert.equal(error.code, "LIMIT");
  assert.equal(error.retryable, true);
  assert.equal(error.message.includes("abc123"), false);
  assert.equal(JSON.stringify(error.details).includes("abc123"), false);
});

test("Lingxing client retries retryable failures and returns parsed payload", async () => {
  let attempts = 0;
  const client = createLingxingClient({
    config: testConfig,
    auth: { ensureAccessToken: async () => "access-token" },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ code: 500, message: "busy" }, { ok: false, status: 503, statusText: "Unavailable" });
      }
      return jsonResponse({ code: 0, data: [{ sid: 1 }] });
    },
    retryDelayMs: 0,
  });

  const payload = await client.performSignedRequest("/erp/sc/data/seller/lists", { retries: 1 });

  assert.equal(attempts, 2);
  assert.deepEqual(payload.data, [{ sid: 1 }]);
});

test("Lingxing client classifies timeout failures", async () => {
  const client = createLingxingClient({
    config: testConfig,
    auth: { ensureAccessToken: async () => "access-token" },
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }),
    timeoutMs: 1,
    retryDelayMs: 0,
  });

  await assert.rejects(
    () => client.performSignedRequest("/timeout", { retries: 0 }),
    (error) => {
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.retryable, true);
      assert.equal(error.endpoint, "/timeout");
      return true;
    },
  );
});

test("collectPaginatedRecords follows offset pagination until total is reached", async () => {
  const offsets = [];
  const rows = await collectPaginatedRecords({
    length: 2,
    maxRows: 10,
    fetchPage: async ({ offset, length }) => {
      offsets.push(offset);
      return {
        data: {
          total: 3,
          records: Array.from({ length }, (_, index) => ({ id: offset + index + 1 })).filter((item) => item.id <= 3),
        },
      };
    },
  });

  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

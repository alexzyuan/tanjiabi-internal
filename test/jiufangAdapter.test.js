import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "../src/config/index.js";
import {
  JiufangApiError,
  createJiufangAdapter,
  redactJiufangPayload,
} from "../src/adapters/jiufangAdapter.js";

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("getConfig exposes Jiufang credentials without raw password storage", () => withEnv({
  JIUFANG_API_BASE_URL: "https://cgi.jiufanglogistics.cn/api/",
  JIUFANG_USERNAME: "JF_TEST_USER",
  JIUFANG_PASSWORD_MD5: "0123456789abcdef0123456789abcdef",
  JIUFANG_TOKEN: "token-secret",
  JIUFANG_DEFAULT_DEPARTURE_CODE: "SZ",
  JIUFANG_DEFAULT_SERVICE_CODE: "SEA-US-07",
  JIUFANG_PASSWORD: "raw-password-must-not-be-read",
}, () => {
  const config = getConfig().jiufang;

  assert.equal(config.baseUrl, "https://cgi.jiufanglogistics.cn/api/");
  assert.equal(config.username, "JF_TEST_USER");
  assert.equal(config.passwordMd5, "0123456789abcdef0123456789abcdef");
  assert.equal(config.token, "token-secret");
  assert.equal(config.defaultDepartureCode, "SZ");
  assert.equal(config.defaultServiceCode, "SEA-US-07");
  assert.equal("password" in config, false);
}));

test("redactJiufangPayload masks token and password fields recursively", () => {
  const redacted = redactJiufangPayload({
    Security: { Username: "JF_TEST_USER", Password: "0123456789abcdef0123456789abcdef" },
    Authorization: "Bearer token-secret",
    nested: { token: "token-secret", keep: "visible" },
  });

  assert.equal(redacted.Security.Username, "JF_TEST_USER");
  assert.equal(redacted.Security.Password, "[REDACTED]");
  assert.equal(redacted.Authorization, "[REDACTED]");
  assert.equal(redacted.nested.token, "[REDACTED]");
  assert.equal(redacted.nested.keep, "visible");
});

test("Jiufang adapter sends Bearer token and request Security", async () => {
  const requests = [];
  const adapter = createJiufangAdapter({
    config: {
      baseUrl: "https://cgi.jiufanglogistics.cn/api/",
      username: "JF_TEST_USER",
      passwordMd5: "0123456789abcdef0123456789abcdef",
      token: "token-secret",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({
        ResponseStatus: { Code: 200, Description: "Success" },
        ProductResponse: { Products: [{ Code: "SEA-US-07", Name: "九方海派--包税" }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await adapter.listProducts({ ShippingWay: "LCL" });

  assert.equal(result.ProductResponse.Products[0].Code, "SEA-US-07");
  assert.equal(requests[0].url, "https://cgi.jiufanglogistics.cn/api/v3/product?lang=zh_CN");
  assert.equal(requests[0].options.headers.Authorization, "Bearer token-secret");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.Username, "JF_TEST_USER");
  assert.equal(body.Password, "0123456789abcdef0123456789abcdef");
  assert.equal(body.ShippingWay, "LCL");
});

test("Jiufang adapter fails fast on API Error payload with redacted details", async () => {
  const adapter = createJiufangAdapter({
    config: {
      baseUrl: "https://cgi.jiufanglogistics.cn/api/",
      username: "JF_TEST_USER",
      passwordMd5: "0123456789abcdef0123456789abcdef",
      token: "token-secret",
    },
    fetchImpl: async () => new Response(JSON.stringify({
      ResponseStatus: { Code: 200, Description: "Success" },
      Error: { Code: 200000, Description: "接口：shipment，请求体为空" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  await assert.rejects(
    () => adapter.createShipment({ ShipmentRequest: { ReferenceNumber: { Value: "FBA123" } } }),
    (error) => {
      assert.equal(error instanceof JiufangApiError, true);
      assert.equal(error.endpoint, "/v3/shipment");
      assert.equal(error.code, 200000);
      assert.match(error.message, /接口：shipment/);
      assert.equal(error.details.Security.Password, "[REDACTED]");
      assert.equal(error.details.headers.Authorization, "[REDACTED]");
      return true;
    },
  );
});

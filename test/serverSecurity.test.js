import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(projectRoot, "server.js");
const managedUsername = "finance.viewer";
const managedPassword = "managed-password-123";

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
}

async function writeManagedUser(cwd) {
  const dataDir = path.join(cwd, "data-cache");
  await mkdir(dataDir, { recursive: true });
  const salt = "server-security-test-salt";
  await writeFile(path.join(dataDir, "auth-users.json"), JSON.stringify({
    users: [{
      username: managedUsername,
      displayName: "财务只读子账号",
      role: "子账号",
      status: "active",
      adminAccess: false,
      passwordHash: hashPassword(managedPassword, salt),
      salt,
      algorithm: "scrypt",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
    }],
  }, null, 2), "utf8");
}

async function startServerWithCorruptManagedStore() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tanjia-bi-corrupt-auth-"));
  const dataDir = path.join(cwd, "data-cache");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "auth-users.json"), "{\"users\":[", "utf8");
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      DATA_PROVIDER: "lingxing",
      LINGXING_APP_KEY: "server-security-app-key",
      LINGXING_APP_SECRET: "server-security-app-secret",
      SESSION_SECRET: "server-security-test-secret",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const appendOutput = (chunk) => {
    output += String(chunk);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);

  const outcome = await Promise.race([
    new Promise((resolve) => child.once("exit", (code) => resolve({ started: false, code }))),
    new Promise((resolve) => {
      const onReady = (chunk) => {
        if (!String(chunk).includes(`localhost:${port}`)) return;
        child.stdout.off("data", onReady);
        resolve({ started: true, code: null });
      };
      child.stdout.on("data", onReady);
    }),
  ]);

  if (outcome.started) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(cwd, { recursive: true, force: true });
  return { ...outcome, output };
}

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`server did not start on ${port}`));
    }, 5000);

    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready: ${code}`));
    });
  });
}

async function startServer({ withSessionSecret = true, withIncompleteAftersalesMailConfig = false } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tanjia-bi-security-"));
  await writeManagedUser(cwd);
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      AUTH_ENABLED: "true",
      AUTH_USERNAME: "env-admin",
      AUTH_PASSWORD: "env-password-123",
      SESSION_SECRET: withSessionSecret ? "server-security-test-secret" : "",
      DATA_PROVIDER: "mock",
      ...(withIncompleteAftersalesMailConfig ? { AFTERSALES_MAIL_SMTP_HOST: " " } : {}),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServer(child, port);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

async function login(baseUrl, { username = managedUsername, password = managedPassword } = {}) {
  const response = await fetch(`${baseUrl}/api/auth/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

function signWithHistoricalDevSecret(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", "tanjia-bi-dev-session-secret")
    .update(body)
    .digest("base64url");
  return `tanjia_session=${encodeURIComponent(`v1.${body}.${signature}`)}`;
}

function postChunked(baseUrl, path, cookie, chunks) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, baseUrl);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        // Deliberately omit Content-Length so the body-limit test exercises chunked input.
      },
    }, (response) => {
      const body = [];
      response.on("data", (chunk) => body.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(body).toString("utf8"),
      }));
    });
    request.once("error", reject);
    chunks.forEach((chunk) => request.write(chunk));
    request.end();
  });
}

test("password login accepts active managed users instead of only the env admin", async () => {
  const server = await startServer();
  try {
    const result = await login(server.baseUrl);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.user.username, managedUsername);
    assert.equal(result.body.user.role, "子账号");
    assert.match(result.cookie, /^tanjia_session=/);
  } finally {
    await server.stop();
  }
});

test("production refuses to start with a corrupt managed-user store", async () => {
  const outcome = await startServerWithCorruptManagedStore();

  assert.equal(outcome.started, false);
  assert.notEqual(outcome.code, 0);
  assert.match(outcome.output, /auth-users\.json/);
  assert.equal(outcome.output.includes("server-security-app-secret"), false);
});

test("public health and auth status routes remain available without a session", async () => {
  const server = await startServer();
  try {
    const healthResponse = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.deepEqual(health.runtime, {
      environment: "test",
      production: false,
      dataProviderExplicit: true,
    });

    const authResponse = await fetch(`${server.baseUrl}/api/auth/me`);
    assert.equal(authResponse.status, 200);
    const auth = await authResponse.json();
    assert.equal(auth.ok, true);
    assert.equal(auth.authenticated, false);
  } finally {
    await server.stop();
  }
});

test("static assets use etag revalidation instead of sending unchanged bundles", async () => {
  const server = await startServer();
  try {
    const firstResponse = await fetch(`${server.baseUrl}/styles.css`);
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.text();
    assert.ok(firstBody.length > 100_000);
    const etag = firstResponse.headers.get("etag");
    assert.ok(etag, "styles.css should include an etag");
    assert.match(firstResponse.headers.get("cache-control") || "", /no-cache/);

    const revalidatedResponse = await fetch(`${server.baseUrl}/styles.css`, {
      headers: { "if-none-match": etag },
    });
    assert.equal(revalidatedResponse.status, 304);
    assert.equal(await revalidatedResponse.text(), "");
    assert.equal(revalidatedResponse.headers.get("etag"), etag);
  } finally {
    await server.stop();
  }
});

test("core settings routes reject authenticated subaccounts", async () => {
  const server = await startServer();
  try {
    const settingsRoutes = ["/api/sync/status", "/api/lingxing/shops"];

    for (const path of settingsRoutes) {
      const unauthenticatedResponse = await fetch(`${server.baseUrl}${path}`);
      assert.equal(unauthenticatedResponse.status, 401, path);
    }

    const subaccount = await login(server.baseUrl);
    assert.equal(subaccount.status, 200);

    for (const path of settingsRoutes) {
      const subaccountResponse = await fetch(`${server.baseUrl}${path}`, {
        headers: { cookie: subaccount.cookie },
      });
      assert.equal(subaccountResponse.status, 403, path);
    }
  } finally {
    await server.stop();
  }
});

test("product catalog refresh uses the standard session gate", async () => {
  const server = await startServer();
  try {
    const body = { feature: "supplier-board", items: [{ sid: 8708, msku: "A" }] };
    const unauthenticatedResponse = await fetch(`${server.baseUrl}/api/product-catalog/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(unauthenticatedResponse.status, 401);

    const session = await login(server.baseUrl);
    assert.equal(session.status, 200);
    const authenticatedResponse = await fetch(`${server.baseUrl}/api/product-catalog/refresh`, {
      method: "POST",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.notEqual(authenticatedResponse.status, 401);
  } finally {
    await server.stop();
  }
});

test("product catalog refresh rejects oversized chunked JSON with controlled 413", async () => {
  const server = await startServer();
  try {
    const session = await login(server.baseUrl);
    assert.equal(session.status, 200);
    const padding = "x".repeat(300 * 1024);
    const body = JSON.stringify({
      feature: "supplier-board",
      items: [{ sid: 8708, msku: "A" }],
      padding,
      token: "oversized-secret",
    });
    const chunks = [body.slice(0, 32), body.slice(32, 128), body.slice(128)];
    const response = await postChunked(server.baseUrl, "/api/product-catalog/refresh", session.cookie, chunks);
    assert.equal(response.status, 413);
    assert.equal(response.body.includes("oversized-secret"), false);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.includes("oversized-secret"), false);
  } finally {
    await server.stop();
  }
});

test("product catalog refresh rejects malformed JSON with controlled 400", async () => {
  const server = await startServer();
  try {
    const session = await login(server.baseUrl);
    assert.equal(session.status, 200);
    const response = await postChunked(server.baseUrl, "/api/product-catalog/refresh", session.cookie, ["{\"feature\":"]);
    assert.equal(response.status, 400);
    assert.equal(response.body.includes("SyntaxError"), false);
    assert.equal(response.body.includes("feature"), false);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, false);
  } finally {
    await server.stop();
  }
});

test("route table admin routes reject subaccounts and allow the environment admin", async () => {
  const server = await startServer({ withIncompleteAftersalesMailConfig: true });
  try {
    const subaccount = await login(server.baseUrl);
    assert.equal(subaccount.status, 200);

    const settingsRoutes = [
      "/api/sync/status",
      "/api/lingxing/shops",
      "/api/store-inspection/status",
      "/api/store-inspection/settings",
      "/api/admin/aftersales-mail-config",
    ];
    for (const path of settingsRoutes) {
      const subaccountResponse = await fetch(`${server.baseUrl}${path}`, {
        headers: { cookie: subaccount.cookie },
      });
      assert.equal(subaccountResponse.status, 403, path);
    }

    const admin = await login(server.baseUrl, {
      username: "env-admin",
      password: "env-password-123",
    });
    assert.equal(admin.status, 200);

    const overviewResponse = await fetch(`${server.baseUrl}/api/admin/overview`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.ok(Array.isArray(overview.users));
    assert.equal(overview.users[0].role, "系统管理员");

    const aiConfigResponse = await fetch(`${server.baseUrl}/api/admin/ai-config`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(aiConfigResponse.status, 200);
    const aiConfig = await aiConfigResponse.json();
    assert.equal(aiConfig.ok, true);

    const configResponse = await fetch(`${server.baseUrl}/api/admin/aftersales-mail-config`, {
      headers: { cookie: admin.cookie },
    });
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.passwordConfigured, false);
    assert.equal(Object.hasOwn(config, "password"), false);

    const secret = "test-mail-secret-should-not-leak";
    const testResponse = await fetch(`${server.baseUrl}/api/admin/aftersales-mail-config/test`, {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: secret }),
    });
    assert.equal(testResponse.status, 200);
    const testBody = await testResponse.json();
    assert.equal(Object.hasOwn(testBody, "password"), false);
    assert.equal(JSON.stringify(testBody).includes(secret), false);

    const saveResponse = await fetch(`${server.baseUrl}/api/admin/aftersales-mail-config`, {
      method: "PUT",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(saveResponse.status, 200);
    const saveBody = await saveResponse.json();
    assert.equal(Object.hasOwn(saveBody, "password"), false);
    assert.equal(JSON.stringify(saveBody).includes(secret), false);
  } finally {
    await server.stop();
  }
});

test("finance dashboard routes reject authenticated subaccounts", async () => {
  const server = await startServer();
  try {
    const result = await login(server.baseUrl);
    assert.equal(result.status, 200);

    const protectedRoutes = [
      { method: "GET", path: "/api/dashboard/payables" },
      { method: "GET", path: "/api/dashboard/supplier-board" },
    ];

    for (const route of protectedRoutes) {
      const response = await fetch(`${server.baseUrl}${route.path}`, {
        method: route.method,
        headers: {
          cookie: result.cookie,
          ...(route.body ? { "content-type": "application/json" } : {}),
        },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
    }
  } finally {
    await server.stop();
  }
});

test("default-open purchase and budget routes are not blocked by role guards", async () => {
  const server = await startServer();
  try {
    const result = await login(server.baseUrl);
    assert.equal(result.status, 200);

    const listResponse = await fetch(`${server.baseUrl}/api/purchase/supplier-details`, {
      headers: { cookie: result.cookie },
    });
    assert.equal(listResponse.status, 200);

    const createResponse = await fetch(`${server.baseUrl}/api/purchase/supplier-details`, {
      method: "POST",
      headers: { cookie: result.cookie, "content-type": "application/json" },
      body: JSON.stringify({ supplier: "测试供应商", qualification: "一般纳税人" }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.row.id);

    const updateResponse = await fetch(`${server.baseUrl}/api/purchase/supplier-details/${encodeURIComponent(created.row.id)}`, {
      method: "PUT",
      headers: { cookie: result.cookie, "content-type": "application/json" },
      body: JSON.stringify({ supplier: "测试供应商", invoiceType: "专票" }),
    });
    assert.equal(updateResponse.status, 200);

    const deleteResponse = await fetch(`${server.baseUrl}/api/purchase/supplier-details/${encodeURIComponent(created.row.id)}`, {
      method: "DELETE",
      headers: { cookie: result.cookie },
    });
    assert.equal(deleteResponse.status, 200);

    const uploadsResponse = await fetch(`${server.baseUrl}/api/admin/budget/uploads`, {
      headers: { cookie: result.cookie },
    });
    assert.equal(uploadsResponse.status, 200);

    const templateResponse = await fetch(`${server.baseUrl}/api/admin/budget/template`, {
      headers: { cookie: result.cookie },
    });
    assert.equal(templateResponse.status, 200);
    assert.match(templateResponse.headers.get("content-type") || "", /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
    assert.match(templateResponse.headers.get("content-disposition") || "", /attachment/);

    const uploadResponse = await fetch(`${server.baseUrl}/api/admin/budget/upload`, {
      method: "POST",
      headers: { cookie: result.cookie, "content-type": "application/json" },
      body: JSON.stringify({ fileName: "预算.xlsx", base64: "", budgetMonth: "2026-07" }),
    });
    assert.notEqual(uploadResponse.status, 403);
  } finally {
    await server.stop();
  }
});

test("sessions cannot be forged with the historical development fallback secret", async () => {
  const server = await startServer({ withSessionSecret: false });
  try {
    const forgedCookie = signWithHistoricalDevSecret({
      user: {
        username: "forged-admin",
        displayName: "forged-admin",
        role: "系统管理员",
        adminAccess: true,
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const response = await fetch(`${server.baseUrl}/api/admin/budget/uploads`, {
      headers: { cookie: forgedCookie },
    });
    assert.equal(response.status, 401);
  } finally {
    await server.stop();
  }
});

test("image cache rejects loopback and private network targets before fetching", async () => {
  const server = await startServer();
  try {
    const result = await login(server.baseUrl);
    assert.equal(result.status, 200);

    const blockedUrls = [
      "http://127.0.0.1:1/image.png",
      "http://localhost:1/image.png",
      "http://10.0.0.1/image.png",
      "http://169.254.169.254/latest/meta-data/",
    ];

    for (const imageUrl of blockedUrls) {
      const response = await fetch(`${server.baseUrl}/api/image-cache?url=${encodeURIComponent(imageUrl)}`, {
        headers: { cookie: result.cookie },
      });
      assert.equal(response.status, 400, imageUrl);
    }
  } finally {
    await server.stop();
  }
});

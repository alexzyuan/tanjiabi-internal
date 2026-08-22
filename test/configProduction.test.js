import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const configUrl = pathToFileURL(path.resolve("src/config/index.js"));
const controlledKeys = [
  "NODE_ENV",
  "DATA_PROVIDER",
  "LINGXING_APP_KEY",
  "LINGXING_APP_SECRET",
  "AUTH_ENABLED",
  "AUTH_USERNAME",
  "AUTH_PASSWORD",
  "LINGXING_FINANCE_DEBUG_ENABLED",
];

async function loadConfig(env = {}) {
  const originalCwd = process.cwd();
  const originalEnv = Object.fromEntries(controlledKeys.map((key) => [key, process.env[key]]));
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-config-production-"));
  process.chdir(dir);
  controlledKeys.forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);
  try {
    const configModule = await import(`${configUrl.href}?case=${Date.now()}-${Math.random()}`);
    return configModule.getConfig();
  } finally {
    process.chdir(originalCwd);
    controlledKeys.forEach((key) => {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    await rm(dir, { recursive: true, force: true });
  }
}

test("production requires an explicit Lingxing data provider", async () => {
  for (const env of [
    { NODE_ENV: "production", LINGXING_APP_KEY: "app-key", LINGXING_APP_SECRET: "app-secret" },
    { NODE_ENV: "production", DATA_PROVIDER: "mock" },
  ]) {
    await assert.rejects(
      () => loadConfig(env),
      (error) => error?.code === "PRODUCTION_DATA_PROVIDER_REQUIRED",
    );
  }
});

test("Lingxing provider requires both application credentials", async () => {
  await assert.rejects(
    () => loadConfig({ NODE_ENV: "production", DATA_PROVIDER: "lingxing", LINGXING_APP_KEY: "app-key" }),
    (error) => error?.code === "LINGXING_CREDENTIALS_REQUIRED",
  );
});

test("test and development runtimes may explicitly use mock data", async () => {
  const implicitTest = await loadConfig({ NODE_ENV: "test" });
  const explicitDevelopment = await loadConfig({ NODE_ENV: "development", DATA_PROVIDER: "mock" });

  assert.equal(implicitTest.dataProvider, "mock");
  assert.equal(implicitTest.runtime.dataProviderExplicit, false);
  assert.equal(explicitDevelopment.dataProvider, "mock");
  assert.equal(explicitDevelopment.runtime.dataProviderExplicit, true);
});

test("valid production Lingxing configuration is explicit and fail-closed", async () => {
  const config = await loadConfig({
    NODE_ENV: "production",
    DATA_PROVIDER: "lingxing",
    LINGXING_APP_KEY: "app-key",
    LINGXING_APP_SECRET: "app-secret",
  });

  assert.equal(config.dataProvider, "lingxing");
  assert.equal(config.runtime.production, true);
  assert.equal(config.runtime.dataProviderExplicit, true);
  assert.equal(config.auth.enabled, true);
  assert.equal(config.debug.lingxingFinancialEnabled, false);
});

test("Lingxing financial diagnostics require an explicit feature flag", async () => {
  const config = await loadConfig({
    NODE_ENV: "development",
    DATA_PROVIDER: "mock",
    LINGXING_FINANCE_DEBUG_ENABLED: "true",
  });

  assert.equal(config.debug.lingxingFinancialEnabled, true);
});

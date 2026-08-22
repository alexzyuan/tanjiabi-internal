import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const serviceUrl = path.join(process.cwd(), "src/services/storeInspectionService.js");

async function runServiceScript(directory, body, { captureLogs = false } = {}) {
  const logSetup = captureLogs
    ? ["const logs = [];", "console.error = (...args) => logs.push(args);"]
    : [];
  const logField = captureLogs ? ", logs" : "";
  const script = [
    ...logSetup,
    "try {",
    body,
    "} catch (error) {",
    `  console.log(JSON.stringify({ ok: false, name: error.name, code: error.code, filePath: error.filePath, message: error.message${logField} }));`,
    "}",
  ].join("\n");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { ...process.env, DATA_PROVIDER: "mock" },
  });
  return JSON.parse(stdout.trim());
}

async function readDashboardFromDirectory(directory) {
  return runServiceScript(directory, [
    `const { getStoreInspectionDashboard } = await import(${JSON.stringify(serviceUrl)});`,
    "const dashboard = await getStoreInspectionDashboard();",
    "console.log(JSON.stringify({ ok: true, dashboard, logs }));",
  ].join("\n"), { captureLogs: true });
}

async function updateManualStatusFromDirectory(directory) {
  return runServiceScript(directory, [
    `const { updateErpBuyerMessageManualStatus } = await import(${JSON.stringify(serviceUrl)});`,
    "const result = await updateErpBuyerMessageManualStatus('message-1', 'replied');",
    "console.log(JSON.stringify({ ok: true, result }));",
  ].join("\n"));
}

async function updateSettingsFromDirectory(directory) {
  return runServiceScript(directory, [
    `const { updateStoreInspectionSettings } = await import(${JSON.stringify(serviceUrl)});`,
    "const result = await updateStoreInspectionSettings({ enabled: true, sendTime: '09:00' });",
    "console.log(JSON.stringify({ ok: true, result, logs }));",
  ].join("\n"), { captureLogs: true });
}

async function runInspectionFromDirectory(directory, { captureLogs = false } = {}) {
  return runServiceScript(directory, [
    `const { runStoreInspection } = await import(${JSON.stringify(serviceUrl)});`,
    "const result = await runStoreInspection({ notify: false });",
    `console.log(JSON.stringify({ ok: result.ok, error: result.error || ''${captureLogs ? ", logs" : ""} }));`,
  ].join("\n"), { captureLogs });
}

test("store inspection dashboard fails when settings JSON is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-settings.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken", "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_PARSE_FAILED");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-settings.json")));
    assert.ok(result.logs.some(([message, details]) => message === "[store-inspection-persistence]" && details.operation === "read-settings" && details.filePath.endsWith(path.join("data-cache", "store-inspection-settings.json")) && details.code === "JSON_PARSE_FAILED"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store inspection dashboard fails when inspection history JSON is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-history.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken", "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_PARSE_FAILED");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-history.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store inspection dashboard fails when latest inspection JSON is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-latest.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken", "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_PARSE_FAILED");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-latest.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store inspection dashboard fails when the authoritative state JSON is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-state.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken", "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_PARSE_FAILED");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-state.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual ERP buyer message status fails when its JSON is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "erp-buyer-message-status.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken", "utf8");

    const result = await updateManualStatusFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_PARSE_FAILED");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "erp-buyer-message-status.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store inspection dashboard fails when history JSON has the wrong shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-history.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ rows: [] }), "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_SCHEMA_INVALID");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-history.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store inspection dashboard fails when settings JSON has the wrong shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const filePath = path.join(directory, "data-cache", "store-inspection-settings.json");
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(["enabled", true]), "utf8");

    const result = await readDashboardFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.equal(result.code, "JSON_SCHEMA_INVALID");
    assert.ok(result.filePath.endsWith(path.join("data-cache", "store-inspection-settings.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("updating settings reports an atomic write failure with file context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const dataDirectory = path.join(directory, "data-cache");
  const filePath = path.join(dataDirectory, "store-inspection-settings.json");
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(filePath, JSON.stringify({ enabled: true, sendTime: "08:30" }), "utf8");
    await chmod(filePath, 0o444);
    await chmod(dataDirectory, 0o555);

    const result = await updateSettingsFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.ok(["EACCES", "EPERM"].includes(result.code));
    assert.ok(result.logs.some(([message, details]) => message === "[store-inspection-persistence]" && details.operation === "write-settings" && details.filePath.endsWith(path.join("data-cache", "store-inspection-settings.json"))));
  } finally {
    await chmod(dataDirectory, 0o755);
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed inspection save preserves the previous latest result when history is corrupted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const dataDirectory = path.join(directory, "data-cache");
  const latestPath = path.join(dataDirectory, "store-inspection-latest.json");
  const historyPath = path.join(dataDirectory, "store-inspection-history.json");
  const previousLatest = { meta: { updatedAt: "previous" }, marker: "keep-me" };
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(latestPath, `${JSON.stringify(previousLatest)}\n`, "utf8");
    await writeFile(historyPath, "{broken", "utf8");

    const result = await runInspectionFromDirectory(directory);

    assert.equal(result.ok, false);
    assert.match(result.error, /JSON parse failed/);
    assert.deepEqual(JSON.parse(await readFile(latestPath, "utf8")), previousLatest);
    assert.equal(await readFile(historyPath, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("successful inspection save commits latest and history in one authoritative state file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const dataDirectory = path.join(directory, "data-cache");
  const statePath = path.join(dataDirectory, "store-inspection-state.json");
  try {
    await mkdir(dataDirectory, { recursive: true });

    const result = await runInspectionFromDirectory(directory);

    assert.equal(result.ok, true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.version, 1);
    assert.equal(state.latest.provider, "mock");
    assert.ok(Array.isArray(state.history));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed inspection state write reports the state file and preserves the directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "store-inspection-persistence-"));
  const dataDirectory = path.join(directory, "data-cache");
  const statePath = path.join(dataDirectory, "store-inspection-state.json");
  const aftersalesLatestPath = path.join(dataDirectory, "aftersales-mail-latest.json");
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(aftersalesLatestPath, "{}\n", "utf8");
    await chmod(dataDirectory, 0o555);

    const result = await runInspectionFromDirectory(directory, { captureLogs: true });

    assert.equal(result.ok, false);
    const stateLog = result.logs.find(([message, details]) => message === "[store-inspection-persistence]" && details.operation === "write-state");
    assert.ok(stateLog, JSON.stringify(result));
    assert.ok(["EACCES", "EPERM"].includes(stateLog[1].code));
    assert.ok(stateLog[1].filePath.endsWith(path.join("data-cache", "store-inspection-state.json")));
    await assert.rejects(() => readFile(statePath, "utf8"), (error) => error.code === "ENOENT");
  } finally {
    await chmod(dataDirectory, 0o755);
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const serviceUrl = path.join(process.cwd(), "src/services/storeInspectionService.js");

async function readDashboardFromDirectory(directory) {
  const script = [
    `import { getStoreInspectionDashboard } from ${JSON.stringify(serviceUrl)};`,
    "const logs = [];",
    "console.error = (...args) => logs.push(args);",
    "try {",
    "  const dashboard = await getStoreInspectionDashboard();",
    "  console.log(JSON.stringify({ ok: true, dashboard, logs }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ ok: false, name: error.name, code: error.code, filePath: error.filePath, message: error.message, logs }));",
    "}",
  ].join("\n");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { ...process.env, DATA_PROVIDER: "mock" },
  });
  return JSON.parse(stdout.trim());
}

async function updateManualStatusFromDirectory(directory) {
  const script = [
    `import { updateErpBuyerMessageManualStatus } from ${JSON.stringify(serviceUrl)};`,
    "try {",
    "  const result = await updateErpBuyerMessageManualStatus('message-1', 'replied');",
    "  console.log(JSON.stringify({ ok: true, result }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ ok: false, name: error.name, code: error.code, filePath: error.filePath, message: error.message }));",
    "}",
  ].join("\n");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { ...process.env, DATA_PROVIDER: "mock" },
  });
  return JSON.parse(stdout.trim());
}

async function updateSettingsFromDirectory(directory) {
  const script = [
    `import { updateStoreInspectionSettings } from ${JSON.stringify(serviceUrl)};`,
    "const logs = [];",
    "console.error = (...args) => logs.push(args);",
    "try {",
    "  const result = await updateStoreInspectionSettings({ enabled: true, sendTime: '09:00' });",
    "  console.log(JSON.stringify({ ok: true, result, logs }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ ok: false, name: error.name, code: error.code, filePath: error.filePath, message: error.message, logs }));",
    "}",
  ].join("\n");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { ...process.env, DATA_PROVIDER: "mock" },
  });
  return JSON.parse(stdout.trim());
}

async function runInspectionFromDirectory(directory) {
  const script = [
    `import { runStoreInspection } from ${JSON.stringify(serviceUrl)};`,
    "const result = await runStoreInspection({ notify: false });",
    "console.log(JSON.stringify({ ok: result.ok, error: result.error || '' }));",
  ].join("\n");
  const { stdout } = await execFile(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: directory,
    env: { ...process.env, DATA_PROVIDER: "mock" },
  });
  return JSON.parse(stdout.trim());
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

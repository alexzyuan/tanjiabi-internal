import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rootDir = new URL("..", import.meta.url);
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const session = `store-operating-css-${process.pid}`;
const rootPath = fileURLToPath(rootDir);
const browserCliPath = join(rootPath, "node_modules", ".bin", process.platform === "win32" ? "playwright-cli.cmd" : "playwright-cli");
const browserTimeoutMs = 15_000;
const testDeadline = Date.now() + 45_000;
const cleanupTimeoutMs = 5_000;
const browserEnvironment = {
  ...process.env,
  CI: "1",
  NO_UPDATE_NOTIFIER: "1",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  npm_config_update_notifier: "false",
};
const fixtures = new Map();
const execFileAsync = promisify(execFile);
let browserDaemonPid;
const server = createServer((request, response) => {
  if (request.url === "/styles.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(styles);
    return;
  }
  const fixture = fixtures.get(request.url);
  if (fixture) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixture);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverAddress = server.address();
assert.ok(serverAddress && typeof serverAddress !== "string");
const fixtureOrigin = `http://127.0.0.1:${serverAddress.port}`;

async function runBrowser(args, { timeoutMs = browserTimeoutMs, deadline = testDeadline } = {}) {
  const remainingMs = deadline - Date.now();
  assert.ok(remainingMs > 0, "browser computed-style test exceeded its deadline");
  try {
    const cliArgs = args[0] === "open"
      ? ["--browser=chromium", `-s=${session}`, ...args]
      : [`-s=${session}`, ...args];
    const { stdout } = await execFileAsync(browserCliPath, cliArgs, {
      cwd: rootPath,
      encoding: "utf8",
      env: browserEnvironment,
      timeout: Math.min(timeoutMs, remainingMs),
      killSignal: "SIGTERM",
    });
    if (args[0] === "open") {
      const daemonPidMatch = stdout.match(/opened with pid (\d+)/);
      assert.ok(daemonPidMatch, `Playwright did not report a daemon PID:\n${stdout}`);
      browserDaemonPid = Number(daemonPidMatch[1]);
    }
    return stdout;
  } catch (error) {
    const details = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`Playwright CLI ${args[0]} failed:\n${details}`, { cause: error });
  }
}

function parseJsonResult(output) {
  const match = output.match(/### Result\s*\n(\{[\s\S]*?\n\})/);
  assert.ok(match, `Playwright did not return a JSON result:\n${output}`);
  return JSON.parse(match[1]);
}

function fixtureDocument(overrides = "") {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/styles.css">
    <style>${overrides}</style>
  </head>
  <body>
    <div class="app-shell">
      <main class="dashboard">
        <header class="topbar"><div id="world-clock" class="world-clock">北京时间</div></header>
        <section id="view-store-operating-monthly-report" class="view active">
          <div id="module-hero" class="module-hero">
            <div><h2>店铺经营月报</h2><p>等待读取经营数据。</p></div>
            <div class="hero-actions"><button type="button">查看预算目标</button></div>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

async function inspectComputedLayout(filename, overrides = "") {
  fixtures.set(`/${filename}`, fixtureDocument(overrides));
  await runBrowser(["open", `${fixtureOrigin}/${filename}`]);
  await runBrowser(["resize", "390", "844"]);
  const result = await runBrowser([
    "eval",
    "(el) => { const heroStyle = getComputedStyle(document.querySelector('#module-hero')); return { worldClock: getComputedStyle(el).display, heroDisplay: heroStyle.display, heroColumns: heroStyle.gridTemplateColumns, heroFlexDirection: heroStyle.flexDirection }; }",
    "#world-clock",
  ]);
  return parseJsonResult(result);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDaemonRunning() {
  if (!browserDaemonPid) return false;
  try {
    process.kill(browserDaemonPid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForDaemonExit(deadline) {
  while (Date.now() < deadline) {
    if (!isDaemonRunning()) return true;
    await delay(50);
  }
  return !isDaemonRunning();
}

async function closeBrowser(deadline) {
  const errors = [];
  try {
    await runBrowser(["close"], { timeoutMs: cleanupTimeoutMs, deadline });
    return errors;
  } catch (error) {
    errors.push(new Error("Playwright session close failed", { cause: error }));
  }
  if (!browserDaemonPid || !isDaemonRunning()) return errors;
  try {
    process.kill(browserDaemonPid, "SIGTERM");
    if (await waitForDaemonExit(deadline)) return errors;
    process.kill(browserDaemonPid, "SIGKILL");
    if (await waitForDaemonExit(deadline)) return errors;
    errors.push(new Error(`Playwright daemon ${browserDaemonPid} remained running after SIGKILL`));
  } catch (error) {
    errors.push(new Error(`Playwright daemon ${browserDaemonPid} kill fallback failed`, { cause: error }));
  }
  return errors;
}

async function closeFixtureServer(timeoutMs) {
  let timeoutId;
  try {
    await new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error("fixture server cleanup timed out")), timeoutMs);
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

let testError;
try {
  const baseline = await inspectComputedLayout("baseline.html");
  assert.equal(baseline.worldClock, "none");
  assert.equal(baseline.heroDisplay, "grid");
  assert.equal(baseline.heroColumns.trim().split(/\s+/).length, 1);

  const laterOverrides = await inspectComputedLayout(
    "later-overrides.html",
    `
      #world-clock.world-clock { display: block; }
      #view-store-operating-monthly-report.view .module-hero { display: flex; flex-direction: row; }
    `,
  );
  assert.equal(laterOverrides.worldClock, "block");
  assert.equal(laterOverrides.heroDisplay, "flex");
  assert.equal(laterOverrides.heroFlexDirection, "row");
} catch (error) {
  testError = error;
}

const cleanupDeadline = Date.now() + cleanupTimeoutMs;
const cleanupErrors = await closeBrowser(cleanupDeadline);
try {
  await closeFixtureServer(cleanupTimeoutMs);
} catch (error) {
  cleanupErrors.push(new Error("Fixture server close failed", { cause: error }));
}

if (testError && cleanupErrors.length) {
  throw new AggregateError([testError, ...cleanupErrors], "Browser computed-style test and cleanup failed");
}
if (testError) throw testError;
if (cleanupErrors.length) {
  throw new AggregateError(cleanupErrors, "Browser computed-style test cleanup failed");
}

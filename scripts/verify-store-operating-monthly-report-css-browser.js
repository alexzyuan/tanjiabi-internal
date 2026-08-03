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
const fixtures = new Map();
const execFileAsync = promisify(execFile);
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

async function runBrowser(args, timeoutMs = browserTimeoutMs) {
  const remainingMs = testDeadline - Date.now();
  assert.ok(remainingMs > 0, "browser computed-style test exceeded its 45 second deadline");
  try {
    const { stdout } = await execFileAsync(browserCliPath, [`-s=${session}`, ...args], {
      cwd: rootPath,
      encoding: "utf8",
      timeout: Math.min(timeoutMs, remainingMs),
      killSignal: "SIGTERM",
    });
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
} finally {
  try {
    await runBrowser(["close"], 5_000);
  } catch {
    // The assertion failure is more useful than a best-effort browser cleanup failure.
  }
  await Promise.race([
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    new Promise((_, reject) => setTimeout(() => reject(new Error("fixture server cleanup timed out")), 5_000)),
  ]);
}

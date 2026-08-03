import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const rootDir = new URL("..", import.meta.url);
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const session = `store-operating-css-${process.pid}`;
const fixtures = new Map();
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

function runBrowser(args) {
  return execFileSync(
    "npx",
    ["--yes", "--package", "@playwright/cli", "playwright-cli", `-s=${session}`, ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
  runBrowser(["open", `${fixtureOrigin}/${filename}`]);
  runBrowser(["resize", "390", "844"]);
  const result = runBrowser([
    "eval",
    "(el) => ({ worldClock: getComputedStyle(el).display, heroColumns: getComputedStyle(document.querySelector('#module-hero')).gridTemplateColumns })",
    "#world-clock",
  ]);
  return parseJsonResult(result);
}

try {
  const baseline = await inspectComputedLayout("baseline.html");
  assert.equal(baseline.worldClock, "none");
  assert.equal(baseline.heroColumns.trim().split(/\s+/).length, 1);

  const laterOverrides = await inspectComputedLayout(
    "later-overrides.html",
    `
      #world-clock.world-clock { display: block; }
      #view-store-operating-monthly-report.view .module-hero { grid-template-columns: minmax(0, 1fr) auto; }
    `,
  );
  assert.equal(laterOverrides.worldClock, "block");
  assert.equal(laterOverrides.heroColumns.trim().split(/\s+/).length, 2);
} finally {
  try {
    runBrowser(["close"]);
  } catch {
    // The assertion failure is more useful than a best-effort browser cleanup failure.
  }
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

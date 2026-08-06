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

function reportTableFixtureDocument(overrides = "") {
  const tableHeaders = Array.from({ length: 14 }, (_value, index) => `<th>店铺${index + 1}实际完成值</th>`).join("");
  const tableCells = Array.from({ length: 14 }, (_value, index) => `<td>${index + 1},234.56</td>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/styles.css">
    <style>${overrides}</style>
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar"></aside>
      <main class="dashboard">
        <header class="topbar"></header>
        <section id="view-store-operating-monthly-report" class="view active">
          <article class="panel detail-panel">
            <div class="panel-head">
              <h2>经营损益矩阵</h2>
              <p id="store-operating-report-status">未配置预算，办公费用、办公费用-租金、认证检测费、办公用品、软件费用、产品外观设计费、产品平面设计费、服务商费用、办公费用-快递费、办公费用-水电费、信用卡广告费、办公费用-店铺通讯费、样品费、送测佣金（刷单）、差旅费、员工福利费、净毛利率、店铺保险费字段不可用。</p>
            </div>
            <div id="report-table-wrap" class="table-wrap data-table-wrap--detail store-operating-report-table-wrap">
              <table id="store-operating-report-table" class="data-table data-table--detail is-smart-width" style="--tj-table-resolved-width: 2240px">
                <thead><tr>${tableHeaders}</tr></thead>
                <tbody><tr>${tableCells}</tr></tbody>
              </table>
            </div>
          </article>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function stickyReportTableFixtureDocument(overrides = "") {
  const rows = Array.from({ length: 40 }, (_value, index) => `
    <tr><td>科目 ${index + 1}</td><td>${index + 1},234.56</td><td>12.34%</td><td>—</td><td>—</td></tr>
  `).join("");
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
        <section id="view-store-operating-monthly-report" class="view active">
          <div id="sticky-report-table-wrap" class="table-wrap data-table-wrap--detail store-operating-report-table-wrap" style="height: 220px">
            <table id="store-operating-report-table" class="data-table data-table--detail">
              <thead>
                <tr><th colspan="1">店铺信息</th><th colspan="4">全部店铺</th></tr>
                <tr><th>科目</th><th>实际完成值</th><th>占比</th><th>预算值</th><th>达成率</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
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

async function inspectReportTableLayout(filename, overrides = "") {
  fixtures.set(`/${filename}`, reportTableFixtureDocument(overrides));
  await runBrowser(["open", `${fixtureOrigin}/${filename}`]);
  await runBrowser(["resize", "390", "844"]);
  const result = await runBrowser([
    "eval",
    "(el) => { const panel = el.closest('.detail-panel'); const view = el.closest('.view'); const status = document.querySelector('#store-operating-report-status'); const statusStyle = getComputedStyle(status); return { documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, panelWidth: Math.round(panel.getBoundingClientRect().width), viewWidth: Math.round(view.getBoundingClientRect().width), wrapperWidth: Math.round(el.getBoundingClientRect().width), wrapperClientWidth: el.clientWidth, wrapperScrollWidth: el.scrollWidth, tableWidth: Math.round(el.querySelector('table').getBoundingClientRect().width), statusWidth: Math.round(status.getBoundingClientRect().width), statusMinWidth: statusStyle.minWidth, statusWhiteSpace: statusStyle.whiteSpace }; }",
    "#report-table-wrap",
  ]);
  return parseJsonResult(result);
}

async function inspectStickyReportHeader(filename, overrides = "") {
  fixtures.set(`/${filename}`, stickyReportTableFixtureDocument(overrides));
  await runBrowser(["open", `${fixtureOrigin}/${filename}`]);
  await runBrowser(["resize", "1440", "900"]);
  const result = await runBrowser([
    "eval",
    "(el) => { el.scrollTop = 120; const rows = el.querySelectorAll('thead tr'); const wrap = el.getBoundingClientRect(); const first = rows[0].querySelector('th').getBoundingClientRect(); const second = rows[1].querySelector('th').getBoundingClientRect(); return { scrollTop: el.scrollTop, wrapperTop: Math.round(wrap.top), firstTop: Math.round(first.top), firstHeight: Math.round(first.height), secondTop: Math.round(second.top) }; }",
    "#sticky-report-table-wrap",
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

async function stopBrowserDaemon(errors) {
  if (!browserDaemonPid || !isDaemonRunning()) return;
  try {
    process.kill(browserDaemonPid, "SIGTERM");
    if (await waitForDaemonExit(Date.now() + cleanupTimeoutMs)) return;
    process.kill(browserDaemonPid, "SIGKILL");
    if (await waitForDaemonExit(Date.now() + cleanupTimeoutMs)) return;
    errors.push(new Error(`Playwright daemon ${browserDaemonPid} remained running after SIGKILL`));
  } catch (error) {
    errors.push(new Error(`Playwright daemon ${browserDaemonPid} kill fallback failed`, { cause: error }));
  }
}

async function closeBrowser() {
  const errors = [];
  try {
    await runBrowser(["close"], { timeoutMs: cleanupTimeoutMs, deadline: Date.now() + cleanupTimeoutMs });
    if (!await waitForDaemonExit(Date.now() + cleanupTimeoutMs)) {
      errors.push(new Error(`Playwright CLI close reported success but daemon ${browserDaemonPid} remained running`));
      await stopBrowserDaemon(errors);
    }
    return errors;
  } catch (error) {
    errors.push(new Error("Playwright session close failed", { cause: error }));
  }
  await stopBrowserDaemon(errors);
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

  const reportTable = await inspectReportTableLayout("wide-report-table.html");
  assert.ok(
    reportTable.documentWidth <= reportTable.viewportWidth + 2,
    `monthly report table must not expand the document (${reportTable.documentWidth}px > ${reportTable.viewportWidth}px)`,
  );
  assert.ok(reportTable.panelWidth <= reportTable.viewportWidth, "monthly report panel must stay within the viewport");
  assert.ok(reportTable.wrapperWidth <= reportTable.panelWidth, "monthly report table wrapper must stay inside its panel");
  assert.ok(reportTable.wrapperScrollWidth > reportTable.wrapperClientWidth, "monthly report table wrapper must own horizontal scrolling for wide tables");
  assert.ok(reportTable.tableWidth > reportTable.wrapperWidth, "wide monthly report table must remain scrollable inside its wrapper");
  assert.ok(reportTable.statusWidth <= reportTable.panelWidth, "monthly report status text must stay inside its panel");
  assert.equal(reportTable.statusMinWidth, "0px", "monthly report status text must be shrinkable in the panel header");
  assert.equal(reportTable.statusWhiteSpace, "normal", "monthly report status text must wrap instead of widening the page");

  const stickyHeader = await inspectStickyReportHeader("sticky-report-header.html");
  assert.ok(stickyHeader.scrollTop > 0, "monthly report fixture must scroll vertically");
  assert.ok(Math.abs(stickyHeader.firstTop - stickyHeader.wrapperTop) <= 1, "first monthly report header row must stick to the table wrapper top");
  assert.equal(stickyHeader.secondTop, stickyHeader.wrapperTop + stickyHeader.firstHeight, "second monthly report header row must remain directly below the first row");
} catch (error) {
  testError = error;
}

const cleanupErrors = await closeBrowser();
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

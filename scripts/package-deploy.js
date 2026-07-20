#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";

const ROOT = process.cwd();
const OUTPUT = "tanjia-bi-deploy.tar.gz";
const allowCssDeploy = process.env.ALLOW_CSS_DEPLOY === "1";
const args = new Set(process.argv.slice(2));
const includeCss = args.has("--include-css") || args.has("--full");

const explicitFiles = [
  "server.js",
  "app.js",
  "index.html",
  "login.html",
  ".env.example",
  "package.json",
  "package-lock.json",
  "deploy.sh",
  "rollback.sh",
  "scripts/package-deploy.js",
  "assets/favicon.svg",
  "assets/jm-logo.jpg",
  "assets/jm-favicon.png",
  "assets/max-deril-logo.png",
];

const recursiveDirs = [
  "routes",
  "src",
  "assets/js",
  "assets/freight-templates",
];

const cssPaths = [
  "styles.css",
  "assets/css",
];

function fail(message) {
  console.error(`\n打包失败：${message}`);
  process.exit(1);
}

function toPosixPath(path) {
  return path.split("\\").join("/");
}

function isDeployableFile(path) {
  const name = path.split("/").pop();
  if (!name || isRepositoryMetadataPath(path)) {
    return false;
  }
  if (path === OUTPUT || path.startsWith(".git/") || path.startsWith("node_modules/")) {
    return false;
  }
  if (path.startsWith("data-cache/") || path.startsWith("uploads/")) {
    return false;
  }
  if (path === ".env" || path.startsWith("releases/") || path.startsWith(".deploy-tmp-")) {
    return false;
  }
  return true;
}

function collectPath(path, files) {
  if (!existsSync(path)) {
    return;
  }

  const info = statSync(path);
  if (info.isFile()) {
    const relPath = toPosixPath(relative(ROOT, path));
    if (isDeployableFile(relPath)) {
      files.add(relPath);
    }
    return;
  }

  if (!info.isDirectory()) {
    return;
  }

  for (const entry of readdirSync(path)) {
    collectPath(join(path, entry), files);
  }
}

function isCssPath(path) {
  return path === "styles.css" || path.startsWith("assets/css/");
}

function readText(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function requireContains(source, pattern, message) {
  if (pattern instanceof RegExp ? !pattern.test(source) : !source.includes(pattern)) {
    fail(message);
  }
}

function validateApprovedCssBaseline() {
  if (!includeCss) return;

  const indexSource = readText("index.html");
  const tokenSource = readText("assets/css/tokens/00-semantic-foundation.css");
  const filterToolbarSource = readText("assets/css/components/35-filter-toolbar.css");
  const datePickerSource = readText("assets/css/components/36-date-range-picker.css");
  const salesPageSource = readText("assets/css/pages/22-sales-dashboard.css");
  const fbaPageSource = readText("assets/css/pages/35-fba-freight.css");

  requireContains(
    indexSource,
    /id="front-date-range-button" class="date-range-button date-range-picker__trigger"/,
    "CSS 部署前检查失败：销售复盘日期控件未使用共享 date-range-picker。",
  );
  requireContains(
    indexSource,
    /id="fba-freight-date-range-button" class="date-range-button date-range-picker__trigger"/,
    "CSS 部署前检查失败：FBA 货件日期控件未使用共享 date-range-picker。",
  );
  requireContains(
    filterToolbarSource,
    /\.filter-toolbar\s*\{[\s\S]*column-gap:\s*8px;[\s\S]*row-gap:\s*8px;[\s\S]*border:\s*0;/,
    "CSS 部署前检查失败：共享筛选栏 baseline 不是 compact 8px 无边框规则。",
  );
  requireContains(
    tokenSource,
    /--tj-control-height-compact:\s*34px;/,
    "CSS 部署前检查失败：共享筛选栏紧凑控件高度 token 缺失。",
  );
  requireContains(
    tokenSource,
    /--tj-filter-action-min-width:\s*96px;/,
    "CSS 部署前检查失败：共享筛选栏操作按钮最小宽度 token 缺失。",
  );
  requireContains(
    filterToolbarSource,
    /\.filter-toolbar label:has\(\.date-range-control\)\s*\{/,
    "CSS 部署前检查失败：共享筛选栏缺少日期控件列宽规则。",
  );
  requireContains(
    datePickerSource,
    /width:\s*min\(760px,\s*96vw\)/,
    "CSS 部署前检查失败：共享日期弹层宽度规则缺失。",
  );

  const forbiddenRuntimePatterns = [
    ["front-date-apply", "旧销售日期确认按钮仍存在。"],
    ["data-range-preset", "旧销售日期快捷项仍存在。"],
    [".date-range-button::after", "旧日期按钮伪元素仍存在。"],
    [".date-presets", "旧日期快捷项样式仍存在。"],
    [".date-range-fields", "旧日期输入框面板样式仍存在。"],
  ];
  for (const [pattern, message] of forbiddenRuntimePatterns) {
    if ([indexSource, salesPageSource, fbaPageSource, datePickerSource].some((source) => source.includes(pattern))) {
      fail(`CSS 部署前检查失败：${message}`);
    }
  }
}

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage: node scripts/package-deploy.js [--include-css|--full]",
    "",
    "Default mode creates a CSS-free patch deploy package.",
    "Set ALLOW_CSS_DEPLOY=1 with --include-css only for reviewed UI/CSS deploys.",
  ].join("\n"));
  process.exit(0);
}

const files = new Set();

for (const file of explicitFiles) {
  collectPath(join(ROOT, file), files);
}

for (const dir of recursiveDirs) {
  collectPath(join(ROOT, dir), files);
}

if (includeCss) {
  for (const cssPath of cssPaths) {
    collectPath(join(ROOT, cssPath), files);
  }
}

const manifest = [...files].sort();
const cssFiles = manifest.filter(isCssPath);

if (cssFiles.length > 0 && !allowCssDeploy) {
  fail(`部署包包含 CSS：${cssFiles.join(", ")}。如确需部署样式，请设置 ALLOW_CSS_DEPLOY=1。`);
}

validateApprovedCssBaseline();

for (const requiredFile of ["server.js", "app.js", "package.json", "deploy.sh"]) {
  if (!manifest.includes(requiredFile)) {
    fail(`部署包缺少必要文件：${requiredFile}`);
  }
}

console.log(`准备生成 ${OUTPUT}`);
console.log(`模式：${includeCss ? "包含 CSS" : "默认补丁包，不包含 CSS"}`);
console.log(`文件数：${manifest.length}`);
console.log("");
for (const file of manifest) {
  console.log(file);
}

const tmpDir = mkdtempSync(join(tmpdir(), "tanjia-bi-package-"));
const listFile = join(tmpDir, "files.txt");
writeFileSync(listFile, `${manifest.join("\n")}\n`);

const tarResult = spawnSync("tar", ["--no-xattrs", "--no-mac-metadata", "-czf", OUTPUT, "-T", listFile], {
  cwd: ROOT,
  env: {
    ...process.env,
    COPYFILE_DISABLE: "1",
  },
  stdio: "inherit",
});

rmSync(tmpDir, { recursive: true, force: true });

if (tarResult.status !== 0) {
  fail(`tar 命令失败，退出码 ${tarResult.status}`);
}

console.log(`\n已生成：${OUTPUT}`);

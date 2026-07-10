#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildDeployIntegrity } from "./deploy-integrity.js";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";

const ROOT = process.cwd();
const OUTPUT = "tanjia-bi-deploy.tar.gz";
const DEPLOY_MANIFEST = ".deploy-manifest.json";
const allowCssDeploy = process.env.ALLOW_CSS_DEPLOY === "1";
const allowNonProductionDeploy = process.env.ALLOW_NON_PRODUCTION_DEPLOY === "1";
const productionDeployBranch = process.env.PRODUCTION_DEPLOY_BRANCH || "codex/yesterday-plus-webhook";
const confirmedDeployBranch = process.env.DEPLOY_CONFIRM_BRANCH || "";
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
  "scripts/deploy-integrity.js",
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

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`Git 检查失败：git ${args.join(" ")}\n${result.stderr || result.stdout || ""}`.trim());
  }
  return String(result.stdout || "").trim();
}

function resolveDeployMetadata() {
  const branch = runGit(["branch", "--show-current"]);
  const commit = runGit(["rev-parse", "HEAD"]);
  const shortCommit = runGit(["rev-parse", "--short=12", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);

  if (!branch) {
    fail("当前是 detached HEAD。为避免部署来源不可追踪，请切到正式分支后再打包。");
  }
  if (status) {
    fail(`工作区不是干净状态，禁止打包部署。请先提交或清理这些改动：\n${status}`);
  }
  if (branch !== productionDeployBranch && !allowNonProductionDeploy) {
    fail(`当前分支是 ${branch}，正式部署分支应为 ${productionDeployBranch}。如确需临时部署其他分支，请显式设置 ALLOW_NON_PRODUCTION_DEPLOY=1 和 DEPLOY_CONFIRM_BRANCH=${branch}。`);
  }
  if (confirmedDeployBranch !== branch) {
    fail(`缺少二次确认：请设置 DEPLOY_CONFIRM_BRANCH=${branch} 后重新打包。`);
  }

  return {
    app: "tanjia-bi",
    branch,
    commit,
    shortCommit,
    productionDeployBranch,
    confirmedBranch: confirmedDeployBranch,
    clean: true,
    includeCss,
    packagedAt: new Date().toISOString(),
  };
}

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage: node scripts/package-deploy.js [--include-css|--full]",
    "",
    "Default mode creates a CSS-free patch deploy package.",
    "Set ALLOW_CSS_DEPLOY=1 with --include-css only for reviewed UI/CSS deploys.",
    `Set DEPLOY_CONFIRM_BRANCH=<current branch>; default production branch is ${productionDeployBranch}.`,
    "Set ALLOW_NON_PRODUCTION_DEPLOY=1 only for an intentional temporary deploy from another branch.",
  ].join("\n"));
  process.exit(0);
}

const deployMetadata = resolveDeployMetadata();
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
const packageManifest = [DEPLOY_MANIFEST, ...manifest].sort();
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
console.log(`分支：${deployMetadata.branch}`);
console.log(`提交：${deployMetadata.shortCommit}`);
console.log(`文件数：${packageManifest.length}`);
console.log("");
for (const file of packageManifest) {
  console.log(file);
}

const tmpDir = mkdtempSync(join(tmpdir(), "tanjia-bi-package-"));
const listFile = join(tmpDir, "files.txt");
const deployManifestFile = join(ROOT, DEPLOY_MANIFEST);
writeFileSync(listFile, `${packageManifest.join("\n")}\n`);
deployMetadata.integrity = await buildDeployIntegrity(ROOT, manifest);
console.log(`板块完整性清单：${deployMetadata.integrity.navigationModules.length} 个板块`);
writeFileSync(deployManifestFile, `${JSON.stringify(deployMetadata, null, 2)}\n`);

const tarResult = spawnSync("tar", ["--no-xattrs", "--no-mac-metadata", "-czf", OUTPUT, "-T", listFile], {
  cwd: ROOT,
  env: {
    ...process.env,
    COPYFILE_DISABLE: "1",
  },
  stdio: "inherit",
});

rmSync(tmpDir, { recursive: true, force: true });
rmSync(deployManifestFile, { force: true });

if (tarResult.status !== 0) {
  fail(`tar 命令失败，退出码 ${tarResult.status}`);
}

console.log(`\n已生成：${OUTPUT}`);

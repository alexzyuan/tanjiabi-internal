#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEPLOY_INTEGRITY_VERSION = 1;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function readAttribute(source, name) {
  const match = String(source || "").match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

function hasBooleanAttribute(source, name) {
  return new RegExp(`(^|\\s)${name}(\\s|=|$)`, "i").test(String(source || ""));
}

function extractNavGroupRanges(html) {
  const groups = [];
  const groupRegex = /<section\b(?=[^>]*class="[^"]*\bnav-group\b[^"]*")([^>]*)>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = groupRegex.exec(html))) {
    const attrs = match[1] || "";
    groups.push({
      start: match.index,
      end: match.index + match[0].length,
      label: readAttribute(attrs, "aria-label"),
      permission: readAttribute(attrs, "data-permission"),
      hidden: hasBooleanAttribute(attrs, "hidden"),
    });
  }
  return groups;
}

function findGroupForIndex(groups, index) {
  return groups.find((group) => group.start <= index && index < group.end) || null;
}

export function extractNavigationModules(html) {
  const groups = extractNavGroupRanges(html);
  const modules = [];
  const buttonRegex = /<button\b(?=[^>]*class="[^"]*\bnav-item\b[^"]*")(?=[^>]*data-view="([^"]+)")([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;

  while ((match = buttonRegex.exec(html))) {
    const view = decodeHtmlEntities(match[1]).trim();
    const attrs = match[2] || "";
    const body = match[3] || "";
    const group = findGroupForIndex(groups, match.index);
    const labelMatch = body.match(/<span\b(?=[^>]*class="[^"]*\bnav-label\b[^"]*")[^>]*>([\s\S]*?)<\/span>/i);
    const label = normalizeText(labelMatch ? labelMatch[1] : body);
    if (!view || !label) continue;
    modules.push({
      view,
      label,
      group: group?.label || "首页",
      hidden: hasBooleanAttribute(attrs, "hidden") || Boolean(group?.hidden),
      permission: readAttribute(attrs, "data-permission") || group?.permission || "",
    });
  }

  return modules;
}

export function extractViewIds(html) {
  const ids = [];
  const sectionRegex = /<section\b(?=[^>]*class="[^"]*\bview\b[^"]*")(?=[^>]*id="view-([^"]+)")[^>]*>/gi;
  let match;
  while ((match = sectionRegex.exec(html))) {
    ids.push(decodeHtmlEntities(match[1]).trim());
  }
  return ids;
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateFrontendIntegrity(html, expectedModules = []) {
  const actualModules = extractNavigationModules(html);
  const actualViewIds = extractViewIds(html);
  const errors = [];
  const actualByView = new Map(actualModules.map((module) => [module.view, module]));
  const expectedByView = new Map(expectedModules.map((module) => [module.view, module]));
  const actualViewSet = new Set(actualViewIds);

  for (const duplicate of findDuplicates(actualModules.map((module) => module.view))) {
    errors.push(`导航板块重复：${duplicate}`);
  }
  for (const duplicate of findDuplicates(actualViewIds)) {
    errors.push(`页面容器重复：view-${duplicate}`);
  }

  for (const expected of expectedModules) {
    const actual = actualByView.get(expected.view);
    if (!actual) {
      errors.push(`缺少导航板块：${expected.group} / ${expected.label} (${expected.view})`);
    } else if (actual.label !== expected.label) {
      errors.push(`导航板块名称变更：${expected.view} 应为「${expected.label}」，当前为「${actual.label}」`);
    }
    if (actual && actual.group !== expected.group) {
      errors.push(`导航板块分组变更：${expected.view} 应在「${expected.group}」，当前在「${actual.group}」`);
    }
    if (actual && Boolean(actual.hidden) !== Boolean(expected.hidden)) {
      errors.push(`导航板块隐藏状态变更：${expected.view}`);
    }
    if (actual && (actual.permission || "") !== (expected.permission || "")) {
      errors.push(`导航板块权限标记变更：${expected.view}`);
    }
    if (!actualViewSet.has(expected.view)) {
      errors.push(`缺少页面容器：view-${expected.view}`);
    }
  }

  for (const actual of actualModules) {
    if (!expectedByView.has(actual.view)) {
      errors.push(`出现未在部署清单确认的新导航板块：${actual.group} / ${actual.label} (${actual.view})`);
    }
  }

  const expectedOrder = expectedModules.map((module) => module.view).join(",");
  const actualOrder = actualModules.filter((module) => expectedByView.has(module.view)).map((module) => module.view).join(",");
  if (expectedOrder && actualOrder && expectedOrder !== actualOrder) {
    errors.push("导航板块顺序与部署清单不一致。");
  }

  return {
    ok: errors.length === 0,
    errors,
    actualModules,
    actualViewIds,
  };
}

export async function hashFile(root, file) {
  const content = await readFile(join(root, file));
  return createHash("sha256").update(content).digest("hex");
}

export async function buildDeployIntegrity(root, files) {
  const indexHtml = await readFile(join(root, "index.html"), "utf8");
  const navigationModules = extractNavigationModules(indexHtml);
  const frontendCheck = validateFrontendIntegrity(indexHtml, navigationModules);
  if (!frontendCheck.ok) {
    throw new Error(`本地前端结构不完整：${frontendCheck.errors.join("；")}`);
  }

  const fileHashes = {};
  for (const file of [...files].sort()) {
    fileHashes[file] = await hashFile(root, file);
  }

  return {
    version: DEPLOY_INTEGRITY_VERSION,
    navigationModules,
    viewIds: extractViewIds(indexHtml),
    files: [...files].sort(),
    fileHashes,
  };
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} 返回 HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  return text;
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function verifyLocalFiles(root, manifest) {
  const errors = [];
  const expectedFiles = manifest.integrity?.files || [];
  const expectedHashes = manifest.integrity?.fileHashes || {};

  for (const file of expectedFiles) {
    const filePath = join(root, file);
    if (!existsSync(filePath)) {
      errors.push(`线上目录缺少部署文件：${file}`);
      continue;
    }
    const actualHash = await hashFile(root, file);
    if (expectedHashes[file] && actualHash !== expectedHashes[file]) {
      errors.push(`线上文件哈希不一致：${file}`);
    }
  }

  return errors;
}

export async function verifyDeployedApp({ root = process.cwd(), baseUrl }) {
  if (!baseUrl) throw new Error("verifyDeployedApp requires baseUrl.");
  const manifest = JSON.parse(await readFile(join(root, ".deploy-manifest.json"), "utf8"));
  if (!manifest.integrity?.navigationModules?.length) {
    throw new Error("部署 manifest 缺少 integrity.navigationModules，无法确认所有板块。");
  }

  const health = await fetchJson(`${baseUrl}/api/health`);
  const errors = [];
  if (health?.ok !== true) {
    errors.push(`/api/health 返回异常：${JSON.stringify(health).slice(0, 200)}`);
  }

  errors.push(...await verifyLocalFiles(root, manifest));

  const onlineIndexHtml = await fetchText(`${baseUrl}/`);
  const frontendCheck = validateFrontendIntegrity(onlineIndexHtml, manifest.integrity.navigationModules);
  errors.push(...frontendCheck.errors);

  const onlineAppJs = await fetchText(`${baseUrl}/app.js`);
  const onlineAppHash = createHash("sha256").update(onlineAppJs).digest("hex");
  if (manifest.integrity.fileHashes?.["app.js"] && onlineAppHash !== manifest.integrity.fileHashes["app.js"]) {
    errors.push("线上 /app.js 不是当前部署包中的 app.js。");
  }

  return {
    ok: errors.length === 0,
    errors,
    health,
    moduleCount: manifest.integrity.navigationModules.length,
    commit: manifest.commit || "",
    branch: manifest.branch || "",
  };
}

async function main() {
  const command = process.argv[2] || "";
  if (!command || ["-h", "--help"].includes(command)) {
    console.log([
      "Usage:",
      "  node scripts/deploy-integrity.js verify-deployed",
      "",
      "Environment:",
      "  DEPLOY_VERIFY_BASE_URL=http://127.0.0.1:4173",
      "  APP_DIR=/opt/tanjia-bi",
    ].join("\n"));
    return;
  }

  if (command !== "verify-deployed") {
    throw new Error(`Unsupported command: ${command}`);
  }

  const result = await verifyDeployedApp({
    root: process.env.APP_DIR || process.cwd(),
    baseUrl: process.env.DEPLOY_VERIFY_BASE_URL,
  });

  if (!result.ok) {
    console.error("部署完整性检查失败：");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`部署完整性检查通过：${result.moduleCount} 个板块，branch=${result.branch} commit=${String(result.commit).slice(0, 12)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

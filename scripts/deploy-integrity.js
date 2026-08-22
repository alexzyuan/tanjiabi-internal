#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfig, readEnv } from "../src/config/index.js";
import { getDefaultWeekRange } from "../src/utils/dateRange.js";
import { safeQuickCheckDiagnostic } from "../src/utils/safeQuickCheckDiagnostic.js";

export const DEPLOY_INTEGRITY_VERSION = 1;

export function validateProductionProviderHealth(health) {
  const errors = [];
  const provider = String(health?.provider || "missing");
  if (provider !== "lingxing") errors.push(`生产数据源异常：provider=${provider}`);
  if (health?.runtime?.production !== true) {
    errors.push(`生产运行模式异常：production=${String(health?.runtime?.production ?? "missing")}`);
  }
  if (health?.runtime?.dataProviderExplicit !== true) {
    errors.push("生产数据源必须显式配置 DATA_PROVIDER=lingxing");
  }
  return errors;
}

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

function parseJsonResponse(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} 返回了无效 JSON。`);
  }
}

function defaultSalesReviewSmokeCredentials() {
  const localAuth = getConfig().auth.local;
  return {
    username: readEnv("DEPLOY_SALES_REVIEW_SMOKE_USERNAME", localAuth.username),
    password: readEnv("DEPLOY_SALES_REVIEW_SMOKE_PASSWORD", localAuth.password),
  };
}

export async function verifySalesReviewSmoke({
  baseUrl,
  credentials = defaultSalesReviewSmokeCredentials(),
  fetchImpl = globalThis.fetch,
  range = getDefaultWeekRange(getConfig().dashboard),
} = {}) {
  if (!baseUrl) throw new Error("sales-review deployment smoke requires baseUrl.");
  if (!credentials?.username || !credentials?.password) {
    throw new Error("销售复盘部署冒烟缺少本地登录凭据。请设置 DEPLOY_SALES_REVIEW_SMOKE_USERNAME 和 DEPLOY_SALES_REVIEW_SMOKE_PASSWORD，或 AUTH_USERNAME 和 AUTH_PASSWORD。");
  }

  const loginUrl = `${baseUrl}/api/auth/password/login`;
  const loginResponse = await fetchImpl(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const loginPayload = parseJsonResponse(await loginResponse.text(), loginUrl);
  const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0] || "";
  if (!loginResponse.ok || loginPayload?.ok !== true || !sessionCookie) {
    throw new Error(`销售复盘部署冒烟登录失败：HTTP ${loginResponse.status}`);
  }

  const query = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
    currencyCode: "CNY",
  });
  const dashboardUrl = `${baseUrl}/api/dashboard/sales-weekly?${query.toString()}`;
  const dashboardResponse = await fetchImpl(dashboardUrl, {
    headers: { cookie: sessionCookie },
  });
  const dashboard = parseJsonResponse(await dashboardResponse.text(), dashboardUrl);
  if (!dashboardResponse.ok) {
    throw new Error(`销售复盘部署冒烟请求失败：HTTP ${dashboardResponse.status}`);
  }
  if (!Array.isArray(dashboard.detailRows)) {
    throw new Error("销售复盘部署冒烟响应缺少 detailRows 数组。");
  }
  if (!dashboard.detailRows.length) {
    throw new Error("销售复盘部署冒烟响应的 detailRows 不能为空。");
  }

  const missingContractRows = dashboard.detailRows.filter((row) => !Object.hasOwn(row || {}, "refundRate30d"));
  if (missingContractRows.length) {
    throw new Error(`销售复盘部署冒烟发现 ${missingContractRows.length} 条明细缺少 refundRate30d。`);
  }

  return {
    detailRowCount: dashboard.detailRows.length,
    unavailableCount: dashboard.detailRows.filter((row) => row.refundRate30d === null).length,
  };
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

const SAFE_HEALTH_ERROR_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SENSITIVE_HEALTH_ERROR_PATTERN = /(token|secret|password|payload|raw|body|path|stack)/iu;

function redactProductCatalogError(value) {
  const code = String(value ?? "").trim();
  return SAFE_HEALTH_ERROR_PATTERN.test(code) && !SENSITIVE_HEALTH_ERROR_PATTERN.test(code)
    ? code
    : "PRODUCT_CATALOG_HEALTH_ERROR";
}

function redactProductCatalogQuickCheck(value) {
  const quickCheck = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  if (!quickCheck || /(token|secret|password|payload|raw|body|stack)/iu.test(quickCheck)) {
    return "unavailable";
  }
  if (/\b(select|pragma|insert|update|delete|create|drop|alter)\b/iu.test(quickCheck)) {
    return "unavailable";
  }
  if (/(?:^|\s)(?:[A-Za-z]:[\\/]|[\\/]\s*[A-Za-z0-9]|file:)/u.test(quickCheck) || /\.sqlite(?:[-.]|$)/iu.test(quickCheck)) {
    return "unavailable";
  }
  return /^[A-Za-z0-9][A-Za-z0-9_./: -]{0,119}$/u.test(quickCheck) ? quickCheck : "unavailable";
}

export function validateProductCatalogHealth(health) {
  const productCatalog = health?.productCatalog;
  if (!productCatalog || typeof productCatalog !== "object" || Array.isArray(productCatalog)) {
    return ["/api/health 缺少 productCatalog 健康状态"];
  }
  if (productCatalog.ok === true) return [];

  const schemaVersion = Number.isInteger(productCatalog.schemaVersion) && productCatalog.schemaVersion >= 0
    ? String(productCatalog.schemaVersion)
    : "unknown";
  const quickCheck = redactProductCatalogQuickCheck(productCatalog.quickCheck);
  const error = redactProductCatalogError(productCatalog.error);
  return [`商品目录数据库异常：schemaVersion=${schemaVersion} quickCheck=${quickCheck} error=${error}`];
}

function redactSalesFactsError(value) {
  const code = String(value ?? "").trim();
  return SAFE_HEALTH_ERROR_PATTERN.test(code) && !SENSITIVE_HEALTH_ERROR_PATTERN.test(code)
    ? code
    : "SALES_FACTS_HEALTH_ERROR";
}

export function validateSalesFactsHealth(health) {
  const salesFacts = health?.salesFacts;
  if (!salesFacts || typeof salesFacts !== "object" || Array.isArray(salesFacts)) {
    return ["/api/health 缺少 salesFacts 健康状态"];
  }
  if (salesFacts.ok === true) return [];

  const schemaVersion = Number.isInteger(salesFacts.schemaVersion) && salesFacts.schemaVersion >= 0
    ? String(salesFacts.schemaVersion)
    : "unknown";
  const quickCheck = safeQuickCheckDiagnostic(salesFacts.quickCheck);
  const error = redactSalesFactsError(salesFacts.error);
  return [`销售事实数据库异常：schemaVersion=${schemaVersion} quickCheck=${quickCheck} error=${error}`];
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
  errors.push(...validateProductionProviderHealth(health));
  errors.push(...validateProductCatalogHealth(health));
  errors.push(...validateSalesFactsHealth(health));

  let salesReviewSmoke = null;
  try {
    salesReviewSmoke = await verifySalesReviewSmoke({ baseUrl });
  } catch (error) {
    errors.push(error.message);
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
    salesReviewSmoke,
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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssRoot = join(repoRoot, "assets", "css");
const generatedStyles = join(repoRoot, "styles.css");
const baselinePath = join(repoRoot, "scripts", "css-standards-baseline.json");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");

const legacyTokenPattern = /--(?:blue|purple|line|text|muted|bg|panel|surface|shadow|cream|orange|teal|red|green)\b|#6c5cff/i;
const hardcodedColorPattern = /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(/g;
const gradientPattern = /(?:repeating-)?(?:linear|radial)-gradient/i;

function listCssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (isRepositoryMetadataPath(file)) return [];
    if (entry.isDirectory()) return listCssFiles(file);
    return entry.isFile() && entry.name.endsWith(".css") ? [file] : [];
  });
}

function relative(file) {
  return file.replace(`${repoRoot}/`, "");
}

function selectorForLine(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    const openIndex = line.lastIndexOf("{");
    if (openIndex === -1) continue;

    const sameLineSelector = line.slice(0, openIndex).trim();
    if (sameLineSelector) return sameLineSelector;

    const selectorLines = [];
    for (let selectorCursor = cursor - 1; selectorCursor >= 0; selectorCursor -= 1) {
      const selectorLine = lines[selectorCursor].trim();
      if (!selectorLine || selectorLine.startsWith("/*")) continue;
      if (selectorLine.includes("}")) break;
      selectorLines.unshift(selectorLine);
      if (!selectorLine.endsWith(",")) break;
    }
    return selectorLines.join(" ");
  }
  return "";
}

function isAllowedImportant(lines, index) {
  const line = lines[index];
  if (!/display\s*:\s*none\s*!\s*important/i.test(line)) return false;

  const selector = selectorForLine(lines, index);
  return /(\[hidden\]|\.visually-hidden|\.sr-only|\.screen-reader-only|\.sr-only-focusable)\b/.test(selector);
}

function countLegacySelectors(lines) {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.endsWith("{") && !trimmed.startsWith("@") && !trimmed.startsWith("/*");
  }).length;
}

function addIssue(issues, issue) {
  issues.push(issue);
}

function collectIssues() {
  const sourceFiles = [...listCssFiles(cssRoot), generatedStyles];
  const issues = [];

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    const rel = relative(file);
    const isTokenFile = rel.includes("assets/css/tokens/");
    const isGeneratedStyles = rel === "styles.css";
    const lines = source.split("\n");

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (/!\s*important/i.test(line) && !isAllowedImportant(lines, index)) {
        addIssue(issues, {
          category: "important",
          file: rel,
          line: lineNumber,
          message: "remove !important; use layer order or selector ownership instead",
        });
      }

      if (legacyTokenPattern.test(line)) {
        addIssue(issues, {
          category: "legacy-token",
          file: rel,
          line: lineNumber,
          message: "replace legacy visual language tokens with semantic tokens",
        });
      }

      if (!isTokenFile && !isGeneratedStyles && hardcodedColorPattern.test(line)) {
        addIssue(issues, {
          category: "hardcoded-color",
          file: rel,
          line: lineNumber,
          message: "replace hardcoded colors with semantic tokens",
        });
      }

      if (gradientPattern.test(line) && !line.includes("currentColor")) {
        addIssue(issues, {
          category: "gradient",
          file: rel,
          line: lineNumber,
          message: "avoid decorative gradients; use a semantic solid color or tokenized surface",
        });
      }
    });

    if (rel.startsWith("assets/css/legacy/")) {
      const selectorCount = countLegacySelectors(lines);
      for (let count = 0; count < selectorCount; count += 1) {
        addIssue(issues, {
          category: "legacy-selector",
          file: rel,
          line: null,
          message: "move legacy CSS selector ownership into layout, component, or page layers",
        });
      }
    }
  }

  return issues;
}

function summarize(issues) {
  const byKey = new Map();
  const byCategory = {};

  for (const issue of issues) {
    const key = `${issue.category}\t${issue.file}`;
    const summary = byKey.get(key) || {
      category: issue.category,
      file: issue.file,
      count: 0,
      sampleLines: [],
      message: issue.message,
    };
    summary.count += 1;
    if (issue.line && summary.sampleLines.length < 8) summary.sampleLines.push(issue.line);
    byKey.set(key, summary);
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }

  return {
    totals: Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b))),
    entries: [...byKey.values()].sort((a, b) => (
      a.category.localeCompare(b.category)
      || a.file.localeCompare(b.file)
    )),
  };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    return null;
  }
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

function baselineKey(entry) {
  return `${entry.category}\t${entry.file}`;
}

function compareToBaseline(currentSummary, baseline) {
  const baselineEntries = new Map((baseline.entries || []).map((entry) => [baselineKey(entry), entry]));
  const overBaseline = [];
  const reductions = [];

  for (const entry of currentSummary.entries) {
    const baselineEntry = baselineEntries.get(baselineKey(entry));
    const baselineCount = baselineEntry?.count || 0;
    if (entry.count > baselineCount) {
      overBaseline.push({
        ...entry,
        baselineCount,
        added: entry.count - baselineCount,
      });
    } else if (entry.count < baselineCount) {
      reductions.push({
        ...entry,
        baselineCount,
        removed: baselineCount - entry.count,
      });
    }
  }

  for (const [key, baselineEntry] of baselineEntries) {
    if (currentSummary.entries.some((entry) => baselineKey(entry) === key)) continue;
    reductions.push({
      ...baselineEntry,
      removed: baselineEntry.count,
    });
  }

  return { overBaseline, reductions };
}

function formatTotals(totals) {
  return Object.entries(totals)
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");
}

function writeBaseline(summary) {
  const baseline = {
    generatedAt: new Date().toISOString(),
    policy: [
      "This file is a ceiling for known CSS standards debt.",
      "The standards check fails when any category/file count exceeds this baseline.",
      "When debt is intentionally reduced, regenerate this file with node scripts/check-css-standards.js --update-baseline.",
    ],
    allowlist: {
      important: [
        "[hidden] display:none accessibility/visibility utility",
        ".visually-hidden display:none accessibility utility",
        ".sr-only display:none accessibility utility",
        ".screen-reader-only display:none accessibility utility",
        ".sr-only-focusable display:none accessibility utility",
      ],
    },
    totals: summary.totals,
    entries: summary.entries,
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

const currentIssues = collectIssues();
const currentSummary = summarize(currentIssues);

if (shouldUpdateBaseline) {
  writeBaseline(currentSummary);
  console.log(`CSS standards baseline updated: ${relative(baselinePath)}`);
  console.log(`Current debt totals: ${formatTotals(currentSummary.totals) || "none"}`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`Missing CSS standards baseline: ${relative(baselinePath)}`);
  console.error("Run: node scripts/check-css-standards.js --update-baseline");
  process.exit(1);
}

const { overBaseline, reductions } = compareToBaseline(currentSummary, baseline);
console.log(`CSS standards current debt: ${formatTotals(currentSummary.totals) || "none"}`);
console.log(`CSS standards baseline debt: ${formatTotals(baseline.totals || {}) || "none"}`);
if (reductions.length) {
  const removedCount = reductions.reduce((total, entry) => total + entry.removed, 0);
  console.log(`CSS standards debt reductions versus baseline: ${removedCount}`);
}

if (overBaseline.length) {
  console.error("CSS standards debt exceeds baseline:");
  for (const entry of overBaseline) {
    const lines = entry.sampleLines.length ? ` lines ${entry.sampleLines.join(", ")}` : "";
    console.error(`${entry.file}: ${entry.category} +${entry.added} over baseline ${entry.baselineCount}; current ${entry.count}.${lines}`);
  }
  process.exit(1);
}

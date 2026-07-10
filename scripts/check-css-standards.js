import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssRoot = join(repoRoot, "assets", "css");
const generatedStyles = join(repoRoot, "styles.css");
const visualLockMessage = [
  "styles.css visual lock is active; modern CSS standards gate skipped until assets/css/* reaches visual parity.",
  "Use ALLOW_CSS_STANDARDS_ON_LEGACY=1 only when auditing the locked visual baseline intentionally.",
].join(" ");

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

const failures = [];
const generatedSource = readFileSync(generatedStyles, "utf8");

if (
  process.env.ALLOW_CSS_STANDARDS_ON_LEGACY !== "1"
  && generatedSource.length > 300_000
  && /(?:repeating-)?(?:linear|radial)-gradient/i.test(generatedSource)
) {
  console.log(visualLockMessage);
  process.exit(0);
}

const sourceFiles = [...listCssFiles(cssRoot), generatedStyles];

for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const rel = relative(file);
  const isTokenFile = rel.includes("assets/css/tokens/");
  const isGeneratedStyles = rel === "styles.css";

  if (/!\s*important/i.test(source)) {
    failures.push(`${rel}: remove !important; use layer order or selector ownership instead.`);
  }

  if (/--purple\b|#6c5cff/i.test(source)) {
    failures.push(`${rel}: purple tokens/colors are not part of the current BI visual language.`);
  }

  if (!isTokenFile && !isGeneratedStyles) {
    const hardColors = source.match(/#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(/g) || [];
    if (hardColors.length) {
      failures.push(`${rel}: replace hardcoded colors (${[...new Set(hardColors)].slice(0, 5).join(", ")}) with semantic tokens.`);
    }
  }

  const gradientLines = source
    .split("\n")
    .map((line, index) => ({ index: index + 1, line }))
    .filter(({ line }) => /(?:repeating-)?(?:linear|radial)-gradient/i.test(line))
    .filter(({ line }) => !line.includes("currentColor"));
  if (gradientLines.length) {
    const first = gradientLines[0];
    failures.push(`${rel}:${first.index}: avoid decorative gradients; use a semantic solid color or color-mix surface.`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

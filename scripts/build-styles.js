import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";
import { minifyCss } from "./lib/minifyCss.js";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "assets", "css");
const outputFile = path.join(rootDir, "styles.css");
function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

const previewOutput = argValue("--output");
const outputPath = previewOutput ? path.resolve(rootDir, previewOutput) : outputFile;
const layerOrder = ["tokens", "base", "layout", "components", "pages", "legacy"];
const visualLockMessage = [
  "Legacy visual rollback detected: styles.css is oversized and still contains gradient-heavy rollback styles.",
  "The single CSS target is generated styles.css from assets/css/*.",
  "Set ALLOW_CSS_REBUILD=1 only for a reviewed recovery after screenshot parity has been confirmed.",
].join(" ");

async function listCssFiles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = await Promise.all(entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (isRepositoryMetadataPath(entryPath)) return [];
      if (entry.isDirectory()) return listCssFiles(entryPath);
      if (!entry.isFile() || !entry.name.endsWith(".css")) return [];
      return [entryPath];
    }));
  return files.flat();
}

async function buildCss() {
  const layerFiles = await Promise.all(layerOrder.map((layer) => listCssFiles(path.join(sourceDir, layer))));
  const files = layerFiles.flat();
  if (!files.length) {
    throw new Error("No CSS source files found under assets/css.");
  }

  const chunks = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return minifyCss(chunks.join("\n\n"));
}

async function isLegacyVisualRollbackActive() {
  try {
    const current = await readFile(outputFile, "utf8");
    return current.length > 300_000 && /(?:repeating-)?(?:linear|radial)-gradient/i.test(current);
  } catch {
    return false;
  }
}

async function writeIfChanged(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  let current = null;
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return false;
  await writeFile(file, content, "utf8");
  return true;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const legacyRollbackActive = await isLegacyVisualRollbackActive();

  if (legacyRollbackActive && process.env.ALLOW_CSS_REBUILD !== "1") {
    if (checkOnly) {
      console.log(`styles.css legacy rollback safeguard is active; build check skipped. ${visualLockMessage}`);
      return;
    }
    throw new Error(visualLockMessage);
  }

  const css = await buildCss();

  if (checkOnly) {
    const current = await readFile(outputPath, "utf8");
    if (current !== css) {
      throw new Error("styles.css is out of date. Run npm run build:css.");
    }
    await stat(outputPath);
    return;
  }

  const changed = await writeIfChanged(outputPath, css);
  console.log(changed ? "styles.css rebuilt" : "styles.css already up to date");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

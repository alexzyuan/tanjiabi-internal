import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function firstJsonDocument(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const start = source.search(/\S/);
  if (start < 0) return null;
  const first = source[start];
  if (first !== "{" && first !== "[") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          jsonText: source.slice(start, index + 1),
          tailText: source.slice(index + 1),
        };
      }
    }
  }

  return null;
}

async function rewriteRecoveredJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `${filePath}.corrupt-${stamp}.bak`;
  const tempFile = `${filePath}.${process.pid}.recovered.tmp`;
  await copyFile(filePath, backupFile);
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempFile, filePath);
}

export async function readJsonFileWithRecovery(filePath, options = {}) {
  const hasFallback = Object.prototype.hasOwnProperty.call(options, "fallback");
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && hasFallback) return options.fallback;
    throw error;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    const recovered = firstJsonDocument(content);
    if (!recovered || !recovered.tailText.trim()) throw error;

    const value = JSON.parse(recovered.jsonText);
    await rewriteRecoveredJson(filePath, value);
    return value;
  }
}

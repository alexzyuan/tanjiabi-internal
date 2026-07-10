import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFileWithRecovery } from "../utils/jsonFile.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateFile = path.join(appRoot, "data-cache", "fba-box-templates.json");
const legacyTemplateFile = path.join(process.cwd(), "data-cache", "fba-box-templates.json");

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function normalizeBoxSpec(payload = {}) {
  const dimensions = payload.boxDimensions || payload.dimensions || {};
  const weight = payload.boxWeight || payload.weight || {};
  return {
    dimensions: {
      length: positiveNumber(dimensions.length),
      width: positiveNumber(dimensions.width),
      height: positiveNumber(dimensions.height),
      unitOfMeasurement: String(dimensions.unitOfMeasurement || dimensions.unit || "CM").trim().toUpperCase() || "CM",
    },
    weight: {
      value: positiveNumber(weight.value ?? weight.weight),
      unit: String(weight.unit || "KG").trim().toUpperCase() || "KG",
    },
  };
}

export function hasCompleteBoxSpec(spec = {}) {
  return Boolean(
    positiveNumber(spec.dimensions?.length)
    && positiveNumber(spec.dimensions?.width)
    && positiveNumber(spec.dimensions?.height)
    && positiveNumber(spec.weight?.value),
  );
}

function templateKey({ sid, msku } = {}) {
  const normalizedSid = Number(sid || 0);
  const normalizedMsku = String(msku || "").trim().toLowerCase();
  return normalizedSid && normalizedMsku ? `${normalizedSid}:${normalizedMsku}` : "";
}

async function readTemplates() {
  try {
    const parsed = await readJsonFileWithRecovery(templateFile);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT" && legacyTemplateFile !== templateFile) {
      try {
        const parsed = await readJsonFileWithRecovery(legacyTemplateFile);
        await writeTemplates(parsed && typeof parsed === "object" ? parsed : {});
        return readTemplates();
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") throw legacyError;
      }
    }
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeTemplates(templates) {
  await mkdir(path.dirname(templateFile), { recursive: true });
  const tempFile = `${templateFile}.${process.pid}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(templates, null, 2)}\n`, "utf8");
  await rename(tempFile, templateFile);
}

export async function getFbaBoxTemplate({ sid, msku } = {}) {
  const key = templateKey({ sid, msku });
  if (!key) return null;
  const templates = await readTemplates();
  return templates[key] || null;
}

export async function saveFbaBoxTemplate(payload = {}) {
  const key = templateKey(payload);
  if (!key) throw new Error("保存箱规模板失败：缺少店铺或 MSKU。");
  const spec = normalizeBoxSpec(payload);
  if (!hasCompleteBoxSpec(spec)) throw new Error("保存箱规模板失败：箱长、箱宽、箱高、箱重必须大于 0。");
  const templates = await readTemplates();
  const now = new Date().toISOString();
  templates[key] = {
    sid: Number(payload.sid),
    msku: String(payload.msku || "").trim(),
    dimensions: spec.dimensions,
    weight: spec.weight,
    source: payload.source || "manual",
    updatedAt: now,
  };
  await writeTemplates(templates);
  return templates[key];
}

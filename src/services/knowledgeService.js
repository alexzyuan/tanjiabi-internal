import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const storeDir = path.join(process.cwd(), "data-cache");
const storeFile = path.join(storeDir, "knowledge-documents.json");

export const knowledgeCategories = [
  { id: "operations", name: "运营" },
  { id: "product", name: "产品" },
  { id: "enterprise", name: "企业内部" },
];

const categoryIds = new Set(knowledgeCategories.map((item) => item.id));

function normalizeText(value) {
  return String(value || "").trim();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) throw new Error("外部文档链接不能为空。");
  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("外部文档链接格式不正确。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("外部文档链接只支持 http/https。");
  return parsed.href;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storeFile, "utf8"));
    return Array.isArray(parsed.documents) ? parsed.documents : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeStore(documents) {
  await mkdir(storeDir, { recursive: true });
  const tempFile = `${storeFile}.${process.pid}.tmp`;
  await writeFile(tempFile, `${JSON.stringify({ documents }, null, 2)}\n`, "utf8");
  await rename(tempFile, storeFile);
}

function normalizeDocument(payload = {}, existing = {}) {
  const title = normalizeText(payload.title ?? existing.title);
  const category = normalizeText(payload.category ?? existing.category);
  const folder = normalizeText(payload.folder ?? existing.folder) || "未分组";
  if (!title) throw new Error("文章标题不能为空。");
  if (!categoryIds.has(category)) throw new Error("请选择有效目录。");
  return {
    id: existing.id || normalizeText(payload.id) || makeId(),
    title,
    category,
    folder,
    url: normalizeUrl(payload.url ?? existing.url),
    createdBy: normalizeText(payload.createdBy ?? existing.createdBy),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listKnowledgeDocuments() {
  const documents = await readStore();
  return {
    categories: knowledgeCategories,
    documents: documents.sort((a, b) => {
      const categoryOrder = knowledgeCategories.findIndex((item) => item.id === a.category) - knowledgeCategories.findIndex((item) => item.id === b.category);
      if (categoryOrder) return categoryOrder;
      const folderOrder = String(a.folder || "").localeCompare(String(b.folder || ""), "zh-Hans-CN");
      if (folderOrder) return folderOrder;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    }),
  };
}

export async function createKnowledgeDocument(payload = {}) {
  const documents = await readStore();
  const document = normalizeDocument(payload);
  documents.push(document);
  await writeStore(documents);
  return document;
}

export async function deleteKnowledgeDocument(id) {
  const documents = await readStore();
  const nextDocuments = documents.filter((item) => item.id !== id);
  if (nextDocuments.length === documents.length) throw new Error("文档不存在。");
  await writeStore(nextDocuments);
  return { id };
}

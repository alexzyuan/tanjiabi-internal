#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSalesFactsRepository } from "../src/services/salesFactsRepository.js";

export function validateSalesFactsDatabase({
  repositoryFactory = createSalesFactsRepository,
  databasePath,
  logger = console,
} = {}) {
  const repository = repositoryFactory({ ...(databasePath ? { databasePath } : {}), logger });
  try {
    const schema = repository.getSchemaInfo();
    const health = repository.getHealth({ requestId: "deploy-sales-facts-schema" });
    if (!schema || schema.version !== 1 || health?.ok !== true || health?.quickCheck !== "ok") {
      throw new Error("销售事实 schema/quick_check 校验失败。");
    }
    return {
      ok: true,
      schemaVersion: schema.version,
      quickCheck: health.quickCheck,
      salesFactsRevision: health.salesFactsRevision,
      ownerRevision: health.ownerRevision,
      dailyFactCount: health.dailyFactCount,
      factCoverageCount: health.factCoverageCount,
    };
  } finally {
    repository.close();
  }
}

async function main() {
  try {
    const result = validateSalesFactsDatabase({
      databasePath: process.env.SALES_FACTS_DATABASE_PATH || undefined,
      logger: console,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[validate-sales-facts-schema] failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath && scriptPath === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}

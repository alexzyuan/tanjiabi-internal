import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function importSalesForecastService(projectRoot) {
  const serviceUrl = pathToFileURL(path.join(projectRoot, "src/services/salesForecastService.js"));
  serviceUrl.searchParams.set("testRun", `${Date.now()}-${Math.random()}`);
  return import(serviceUrl.href);
}

test("sales forecast manual daily store fails fast on corrupted JSON", async () => {
  const projectRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sales-forecast-store-"));
  try {
    process.chdir(tempRoot);
    await mkdir("data-cache", { recursive: true });
    await writeFile(path.join("data-cache", "sales-forecast-manual-daily.json"), "{broken", "utf8");

    const { getSalesForecastManualDaily } = await importSalesForecastService(projectRoot);

    await assert.rejects(
      getSalesForecastManualDaily(),
      /JSON parse failed|Unexpected token/,
    );
  } finally {
    process.chdir(projectRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

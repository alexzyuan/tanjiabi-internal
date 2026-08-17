import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInventoryLedgerRawReportStore } from "../src/services/inventoryLedgerRawReportStore.js";

async function withTempDataDir(run) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "inventory-ledger-raw-report-store-"));
  try {
    return await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("raw report store verifies saved bytes against the manifest SHA-256", async () => {
  await withTempDataDir(async (dataDir) => {
    const store = createInventoryLedgerRawReportStore({ dataDir });
    const manifest = await store.saveReport({
      month: "2025-10",
      scopeKey: "seller-A|na|ATVPD",
      extension: "json",
      bytes: Buffer.from('[{"event":"receipt"}]'),
    });

    const verified = await store.verifyReport({
      month: "2025-10",
      scopeKey: "seller-A|na|ATVPD",
      extension: manifest.extension,
      expectedSha256: manifest.sha256,
    });

    assert.deepEqual(verified.bytes, Buffer.from('[{"event":"receipt"}]'));
    assert.equal(verified.sha256, manifest.sha256);
  });
});

test("raw report store rejects a saved report modified after its manifest was written", async () => {
  await withTempDataDir(async (dataDir) => {
    const store = createInventoryLedgerRawReportStore({ dataDir });
    const manifest = await store.saveReport({
      month: "2025-10",
      scopeKey: "seller-A|na|ATVPD",
      extension: "json",
      bytes: Buffer.from('[{"event":"receipt"}]'),
    });
    await writeFile(path.join(dataDir, manifest.rawFile), '[{"event":"altered"}]');

    await assert.rejects(
      () => store.verifyReport({
        month: "2025-10",
        scopeKey: "seller-A|na|ATVPD",
        extension: manifest.extension,
        expectedSha256: manifest.sha256,
      }),
      /SHA-256 不匹配/u,
    );
  });
});

test("raw report store rejects a manifest whose archived report is missing", async () => {
  await withTempDataDir(async (dataDir) => {
    const store = createInventoryLedgerRawReportStore({ dataDir });

    await assert.rejects(
      () => store.verifyReport({
        month: "2025-10",
        scopeKey: "seller-A|na|ATVPD",
        extension: "json",
        expectedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      }),
      /原始文件缺失/u,
    );
  });
});

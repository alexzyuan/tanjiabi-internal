import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInventoryLedgerRawReportStore } from "../src/services/inventoryLedgerRawReportStore.js";
import { writeJsonAtomic } from "../src/utils/jsonStore.js";

async function withTempDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inventory-ledger-store-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function historyFile(dataDir, month) {
  const name = crypto.createHash("sha1").update(month).digest("hex");
  return path.join(dataDir, "inventory-provision-history", `${name}.json`);
}

async function writeHistoryCache(dataDir, month, data) {
  return writeJsonAtomic(historyFile(dataDir, month), {
    updatedAt: "2026/8/17 02:00:00",
    updatedAtMs: 1,
    data,
  });
}

test("raw report store saves a hashed file and safe manifest", async () => {
  await withTempDataDir(async (dataDir) => {
    const store = createInventoryLedgerRawReportStore({ dataDir });
    const manifest = await store.saveReport({
      month: "2025-10",
      scopeKey: "seller-A|na|ATVPD",
      extension: "tsv.gz",
      bytes: Buffer.from("ledger"),
      manifest: {
        sellerId: "seller-A",
        reportType: "GET_LEDGER_DETAIL_VIEW_DATA",
        taskId: "task-1",
        reportDocumentId: "doc-1",
        compressionAlgorithm: "GZIP",
        fetchedAt: "2026-08-17T02:00:00.000Z",
        parsedRowCount: 3,
      },
    });

    assert.equal(manifest.month, "2025-10");
    assert.equal(manifest.byteCount, 6);
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(manifest.rawFile.startsWith("inventory-ledger-raw/2025-10/"), true);
    assert.equal(Object.hasOwn(manifest, "accessToken"), false);
    assert.deepEqual(await store.readReport({ month: "2025-10", scopeKey: "seller-A|na|ATVPD", extension: "tsv.gz" }), Buffer.from("ledger"));
    assert.equal((await store.readManifest("2025-10", "seller-A|na|ATVPD")).taskId, "task-1");
    assert.equal((await store.listManifests(["2025-10"])).length, 1);
  });
});

test("history batch commit preserves old directory when staging validation fails", async () => {
  await withTempDataDir(async (dataDir) => {
    await writeHistoryCache(dataDir, "2025-10", { rows: [{ marker: "old" }] });
    const originalFile = historyFile(dataDir, "2025-10");
    const beforeFiles = await readdir(path.join(dataDir, "inventory-provision-history"));
    const beforeContent = await readFile(originalFile, "utf8");
    const store = createInventoryLedgerRawReportStore({ dataDir });
    await assert.rejects(
      () => store.commitInventoryProvisionHistoryBatch({
        targetMonths: ["2025-10", "2025-11"],
        entries: [{ month: "2025-10", data: { rows: [{ marker: "new" }] } }],
      }),
      /缺少月份 2025-11/u,
    );
    assert.deepEqual(await readdir(path.join(dataDir, "inventory-provision-history")), beforeFiles);
    assert.equal(await readFile(originalFile, "utf8"), beforeContent);
  });
});

test("history batch commit replaces target months and preserves non-target cache", async () => {
  await withTempDataDir(async (dataDir) => {
    await writeHistoryCache(dataDir, "2025-09", { rows: [{ marker: "keep" }] });
    await writeHistoryCache(dataDir, "2025-10", { rows: [{ marker: "old" }] });
    const store = createInventoryLedgerRawReportStore({ dataDir });
    const result = await store.commitInventoryProvisionHistoryBatch({
      targetMonths: ["2025-10", "2025-11"],
      entries: [
        { month: "2025-10", data: { rows: [{ marker: "new-10" }] } },
        { month: "2025-11", data: { rows: [{ marker: "new-11" }] } },
      ],
    });
    assert.deepEqual(result.committedMonths, ["2025-10", "2025-11"]);
    const updated = JSON.parse(await readFile(historyFile(dataDir, "2025-10"), "utf8"));
    const next = JSON.parse(await readFile(historyFile(dataDir, "2025-11"), "utf8"));
    const kept = JSON.parse(await readFile(historyFile(dataDir, "2025-09"), "utf8"));
    assert.equal(updated.data.rows[0].marker, "new-10");
    assert.equal(next.data.rows[0].marker, "new-11");
    assert.equal(kept.data.rows[0].marker, "keep");
  });
});

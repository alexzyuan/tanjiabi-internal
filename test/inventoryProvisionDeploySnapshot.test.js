import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createInventoryProvisionDeploySnapshot,
  restoreInventoryProvisionDeploySnapshot,
  verifyInventoryProvisionDeploySnapshot,
} from "../scripts/inventory-provision-deploy-snapshot.js";

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-provision-deploy-snapshot-"));
  const dataDir = path.join(root, "data-cache");
  await mkdir(path.join(dataDir, "inventory-provision-history"), { recursive: true });
  await mkdir(path.join(dataDir, "inventory-ledger-raw", "2026-07"), { recursive: true });
  await writeFile(path.join(dataDir, "inventory-provision-history", "history.json"), "old-history");
  await writeFile(path.join(dataDir, "inventory-ledger-raw", "2026-07", "report.tsv"), "old-report");
  return { root, dataDir, snapshotDir: path.join(root, "snapshot", "data-cache") };
}

test("inventory provision deploy snapshot preserves and verifies history plus raw reports", async () => {
  const fixture = await createFixture();
  try {
    const snapshot = await createInventoryProvisionDeploySnapshot({ sourceDataDir: fixture.dataDir, snapshotDataDir: fixture.snapshotDir });
    assert.equal(snapshot.entries.length, 2);
    assert.equal((await verifyInventoryProvisionDeploySnapshot({ snapshotDataDir: fixture.snapshotDir })).entries.length, 2);
    assert.equal(await readFile(path.join(fixture.snapshotDir, "inventory-provision-history", "history.json"), "utf8"), "old-history");
    assert.equal(await readFile(path.join(fixture.snapshotDir, "inventory-ledger-raw", "2026-07", "report.tsv"), "utf8"), "old-report");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory provision snapshot restore is explicit, verified, and replaces only protected directories", async () => {
  const fixture = await createFixture();
  try {
    await createInventoryProvisionDeploySnapshot({ sourceDataDir: fixture.dataDir, snapshotDataDir: fixture.snapshotDir });
    await writeFile(path.join(fixture.dataDir, "inventory-provision-history", "history.json"), "new-history");
    await writeFile(path.join(fixture.dataDir, "inventory-ledger-raw", "2026-07", "report.tsv"), "new-report");
    await writeFile(path.join(fixture.dataDir, "unrelated.json"), "keep-me");

    await restoreInventoryProvisionDeploySnapshot({ snapshotDataDir: fixture.snapshotDir, targetDataDir: fixture.dataDir });

    assert.equal(await readFile(path.join(fixture.dataDir, "inventory-provision-history", "history.json"), "utf8"), "old-history");
    assert.equal(await readFile(path.join(fixture.dataDir, "inventory-ledger-raw", "2026-07", "report.tsv"), "utf8"), "old-report");
    assert.equal(await readFile(path.join(fixture.dataDir, "unrelated.json"), "utf8"), "keep-me");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory provision deploy snapshot fails before deployment when history cache is absent or snapshot bytes change", async () => {
  const fixture = await createFixture();
  try {
    await createInventoryProvisionDeploySnapshot({ sourceDataDir: fixture.dataDir, snapshotDataDir: fixture.snapshotDir });
    await writeFile(path.join(fixture.snapshotDir, "inventory-provision-history", "history.json"), "tampered");
    await assert.rejects(
      () => verifyInventoryProvisionDeploySnapshot({ snapshotDataDir: fixture.snapshotDir }),
      /SHA-256 不匹配/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

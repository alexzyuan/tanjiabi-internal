import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SlowMovingRiskSnapshotConflictError,
  createSlowMovingRiskSnapshotStore,
} from "../src/services/slowMovingRiskSnapshotStore.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bi-slow-moving-risk-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("snapshot store retains six months and refuses to overwrite a successful report", async () => {
  await withTempDir(async (dataDir) => {
    const store = createSlowMovingRiskSnapshotStore({
      dataDir,
      now: () => new Date("2026-07-31T01:00:00.000Z"),
    });
    await store.saveSuccess({
      reportKey: "2026-07-26",
      dashboard: { rows: [{ msku: "ACTIVE" }], parameters: { annualCapitalCostRate: 0.12 } },
    });
    await store.saveSuccess({
      reportKey: "2026-01-25",
      dashboard: { rows: [{ msku: "EXPIRED" }] },
    });

    assert.deepEqual((await store.list()).map((report) => report.reportKey), ["2026-07-26"]);
    assert.equal((await store.read("2026-07-26")).dashboard.rows[0].msku, "ACTIVE");
    await assert.rejects(
      () => store.saveSuccess({ reportKey: "2026-07-26", dashboard: { rows: [{ msku: "REPLACED" }] } }),
      SlowMovingRiskSnapshotConflictError,
    );
  });
});

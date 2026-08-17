import { withJobLock } from "../src/jobs/jobLock.js";
import { runInventoryLedgerRawRebuild } from "../src/services/inventoryLedgerRawReportService.js";

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

try {
  const result = await withJobLock("inventory-ledger-raw-rebuild", () => runInventoryLedgerRawRebuild({ force, dryRun }), {
    ttlMs: 6 * 60 * 60 * 1000,
    metadata: { trigger: "maintenance-command", force, dryRun },
  });
  if (!result?.acquired && result?.reason) throw new Error(result.reason);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`库存分类账全量重建失败：${error.message || String(error)}\n`);
  process.exitCode = 1;
}

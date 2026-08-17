import { withJobLock } from "../src/jobs/jobLock.js";
import { runInventoryLedgerRawRebuild } from "../src/services/inventoryLedgerRawReportService.js";
import { parseInventoryLedgerRebuildCliOptions } from "../src/utils/inventoryLedgerRebuildCliOptions.js";

try {
  const options = parseInventoryLedgerRebuildCliOptions(process.argv.slice(2));
  const result = await withJobLock("inventory-ledger-raw-rebuild", () => runInventoryLedgerRawRebuild(options), {
    ttlMs: 6 * 60 * 60 * 1000,
    metadata: { trigger: "maintenance-command", ...options },
  });
  if (!result?.acquired && result?.reason) throw new Error(result.reason);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`库存分类账全量重建失败：${error.message || String(error)}\n`);
  process.exitCode = 1;
}

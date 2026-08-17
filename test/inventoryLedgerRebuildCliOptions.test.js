import assert from "node:assert/strict";
import test from "node:test";
import { parseInventoryLedgerRebuildCliOptions } from "../src/utils/inventoryLedgerRebuildCliOptions.js";

test("ledger rebuild CLI options accept one-store one-month dry-run", () => {
  assert.deepEqual(parseInventoryLedgerRebuildCliOptions([
    "--dry-run", "--start-month", "2026-07", "--ledger-seed-month", "2026-07", "--seller-id", "A-SELLER",
  ]), {
    dryRun: true,
    force: false,
    startMonth: "2026-07",
    ledgerSeedMonth: "2026-07",
    sellerIds: ["A-SELLER"],
  });
});

test("ledger rebuild CLI options reject a scoped cache-writing run", () => {
  assert.throws(
    () => parseInventoryLedgerRebuildCliOptions(["--seller-id", "A-SELLER"]),
    /仅允许用于 --dry-run/u,
  );
});

test("ledger rebuild CLI options reject invalid or incomplete flags", () => {
  assert.throws(() => parseInventoryLedgerRebuildCliOptions(["--start-month"]), /缺少月份/u);
  assert.throws(() => parseInventoryLedgerRebuildCliOptions(["--start-month", "2026-7"]), /月份格式/u);
  assert.throws(() => parseInventoryLedgerRebuildCliOptions(["--unknown"]), /不支持的参数/u);
});

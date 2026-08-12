import assert from "node:assert/strict";
import test from "node:test";

import { safeQuickCheckDiagnostic } from "../src/utils/safeQuickCheckDiagnostic.js";

test("safe quick-check diagnostics allow only known bounded messages", () => {
  assert.equal(safeQuickCheckDiagnostic("ok"), "ok");
  assert.equal(safeQuickCheckDiagnostic("disk I/O error"), "disk I/O error");
  assert.equal(safeQuickCheckDiagnostic("database disk image is malformed"), "database disk image is malformed");
  assert.equal(safeQuickCheckDiagnostic("database is locked"), "database is locked");
  for (const unsafe of [
    "/srv/app/product-catalog.sqlite",
    "/etc/passwd",
    "file:///srv/app/product-catalog.sqlite",
    "disk I/O error\n    at /srv/app/service.js:1:2",
    "SELECT * FROM catalog_metadata",
    "DROP TABLE product_master",
    "UPDATE catalog_metadata SET value = 'secret'",
    "INSERT INTO product_master VALUES ('raw')",
    "DELETE FROM product_master",
    "ALTER TABLE product_master ADD COLUMN secret TEXT",
    "CREATE TABLE leaked (token TEXT)",
    "disk\u0000error",
    "x".repeat(121),
  ]) {
    assert.equal(safeQuickCheckDiagnostic(unsafe), "unavailable", unsafe);
  }
});

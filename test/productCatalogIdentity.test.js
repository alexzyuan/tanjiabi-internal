import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProductCatalogScope,
} from "../src/services/productCatalogIdentity.js";

test("normalizes and deduplicates SID + MSKU without using store aliases", () => {
  assert.deepEqual(normalizeProductCatalogScope([
    { sid: 8708, msku: " JM-DGC-BLUE ", storeName: "探嘉美国" },
    { sid: 8708, msku: "jm-dgc-blue", storeName: "xiamentanjia-US" },
  ]), [{ sid: 8708, msku: "JM-DGC-BLUE", mskuKey: "jm-dgc-blue", key: "8708:jm-dgc-blue" }]);
});

test("rejects empty, invalid, and over-500 refresh scopes with status 400", () => {
  assert.throws(() => normalizeProductCatalogScope([]), (error) => error.statusCode === 400);
  assert.throws(() => normalizeProductCatalogScope([{ sid: 0, msku: "A" }]), /SID/);
  assert.throws(() => normalizeProductCatalogScope(
    Array.from({ length: 501 }, (_, index) => ({ sid: 8708, msku: `M-${index}` })),
  ), /500/);
});

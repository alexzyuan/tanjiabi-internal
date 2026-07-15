import assert from "node:assert/strict";
import test from "node:test";

import { withEnv } from "./helpers/env.js";
import { jsonResponse } from "./helpers/http.js";
import { importFresh } from "./helpers/moduleImport.js";
import { normalizeRecordList, readFirst, toNumber } from "../src/utils/recordAccess.js";

test("shared test helpers preserve environment values and JSON response shape", async () => {
  process.env.REDUNDANCY_HELPER_EXISTING = "before";
  delete process.env.REDUNDANCY_HELPER_TEMP;

  await withEnv({
    REDUNDANCY_HELPER_EXISTING: "during",
    REDUNDANCY_HELPER_TEMP: "created",
  }, async () => {
    assert.equal(process.env.REDUNDANCY_HELPER_EXISTING, "during");
    assert.equal(process.env.REDUNDANCY_HELPER_TEMP, "created");
  });

  assert.equal(process.env.REDUNDANCY_HELPER_EXISTING, "before");
  assert.equal(process.env.REDUNDANCY_HELPER_TEMP, undefined);
  delete process.env.REDUNDANCY_HELPER_EXISTING;

  const response = jsonResponse({ ok: true }, { status: 202, statusText: "Accepted" });
  assert.equal(response.ok, true);
  assert.equal(response.status, 202);
  assert.equal(response.statusText, "Accepted");
  assert.deepEqual(await response.json(), { ok: true });

  const imported = await importFresh(process.cwd(), "src/utils/lingxingDateRange.js");
  assert.equal(typeof imported.buildLingxingDateRangeParams, "function");
});

test("record access helpers keep shared coercion semantics explicit", () => {
  assert.equal(readFirst({ a: "", b: null, c: "value" }, ["a", "b", "c"]), "value");
  assert.equal(readFirst({ a: "   ", b: "fallback" }, ["a", "b"]), "fallback");
  assert.equal(readFirst({ a: 0, b: "fallback" }, ["a", "b"]), 0);

  assert.equal(toNumber("12.5"), 12.5);
  assert.equal(toNumber("1,234.50"), 1234.5);
  assert.equal(toNumber("$12.30"), 12.3);
  assert.equal(toNumber("not-a-number"), 0);
  assert.equal(toNumber(""), 0);

  assert.deepEqual(normalizeRecordList([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(normalizeRecordList({ data: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(normalizeRecordList({ data: { list: [{ id: 3 }] } }), [{ id: 3 }]);
  assert.deepEqual(normalizeRecordList({ data: { rows: [{ id: 4 }] } }), [{ id: 4 }]);
  assert.deepEqual(normalizeRecordList({ list: [{ id: 5 }] }), [{ id: 5 }]);
  assert.deepEqual(normalizeRecordList({ data: { records: [{ id: 6 }] } }), [{ id: 6 }]);
  assert.deepEqual(normalizeRecordList({ data: { items: [{ id: 7 }] } }), [{ id: 7 }]);
  assert.deepEqual(normalizeRecordList({ data: { result: [{ id: 8 }] } }), [{ id: 8 }]);
  assert.deepEqual(normalizeRecordList({}), []);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ListingOwnerAuditError,
  auditAllListingOwners,
  parseListingOwnerRecord,
  scanAllListingOwners,
  syncListingOwnerHistory,
} from "../src/services/listingOwnerHistoryService.js";

function listingAdapter(rows) {
  return {
    async fetchListings() {
      return { data: { total: rows.length, list: rows } };
    },
  };
}

const silentLogger = { info() {}, error() {} };

test("classifies one owner, explicit empty, malformed, and multiple owners", () => {
  const assigned = parseListingOwnerRecord({
    sid: 8708,
    seller_sku: "MSKU-A",
    asin_principal_list: [{ principal_id: 101, principal_name: "Alice" }],
  });
  assert.deepEqual(assigned, {
    sid: 8708,
    msku: "MSKU-A",
    status: "assigned",
    ownerIdentity: "id:101",
    ownerPersonId: "101",
    ownerNameSnapshot: "Alice",
    identitySource: "lingxing-person-id",
    ownerCount: 1,
  });

  const unassigned = parseListingOwnerRecord({
    sid: 8708,
    seller_sku: "MSKU-B",
    asin_principal_list: [],
  });
  assert.equal(unassigned.status, "unassigned");
  assert.equal(unassigned.ownerIdentity, null);
  assert.equal(unassigned.ownerNameSnapshot, null);
  assert.equal(unassigned.ownerCount, 0);

  assert.throws(
    () => parseListingOwnerRecord({ sid: 8708, seller_sku: "MSKU-C" }),
    (error) => error instanceof ListingOwnerAuditError
      && error.code === "LISTING_OWNER_FIELD_MISSING"
      && /负责人字段缺失/.test(error.message),
  );

  assert.throws(
    () => parseListingOwnerRecord({
      sid: 8708,
      seller_sku: "MSKU-D",
      asin_principal_list: [
        { principal_id: 101, principal_name: "Alice" },
        { principal_id: 102, principal_name: "Bob" },
      ],
    }),
    (error) => error instanceof ListingOwnerAuditError
      && error.code === "LISTING_MULTIPLE_OWNERS"
      && error.details?.ownerCount === 2,
  );
});

test("deduplicates repeated representations of one owner and falls back to normalized name", () => {
  const repeated = parseListingOwnerRecord({
    seller_id: 8708,
    seller_sku: "MSKU-A",
    listing_principal_list: [
      { user_id: "101", user_name: "Alice" },
      { principal_id: 101, principal_name: "Alice Renamed" },
    ],
  });
  assert.equal(repeated.ownerCount, 1);
  assert.equal(repeated.ownerIdentity, "id:101");

  const nameOnly = parseListingOwnerRecord({
    seller_id: 8708,
    seller_sku: "MSKU-B",
    principal_list: [{ principal_name: "  Alice   Smith " }],
  });
  assert.equal(nameOnly.ownerIdentity, "name:alice smith");
  assert.equal(nameOnly.identitySource, "name-fallback");
  assert.equal(nameOnly.ownerNameSnapshot, "Alice Smith");
});

test("full scan rejects a truncated Listing total", async () => {
  const adapter = {
    async fetchListings({ offset }) {
      return {
        data: {
          total: 3,
          list: [{
            sid: 8708,
            seller_sku: `MSKU-${offset}`,
            asin_principal_list: [],
          }],
        },
      };
    },
  };

  await assert.rejects(
    scanAllListingOwners({
      sellers: [{ sid: 8708, status: 1 }],
      adapter,
      pageSize: 1,
      maxOffset: 2,
      requestId: "owners-truncated-test",
    }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE"
      && error.details?.sid === 8708
      && error.details?.declaredTotal === 3
      && error.details?.rowCount === 2,
  );
});

test("full scan rejects a full Listing page without a reliable total", async () => {
  const adapter = {
    async fetchListings() {
      return {
        data: {
          list: [{ sid: 8708, seller_sku: "MSKU-A", asin_principal_list: [] }],
        },
      };
    },
  };

  await assert.rejects(
    scanAllListingOwners({
      sellers: [{ sid: 8708, status: 1 }],
      adapter,
      pageSize: 1,
      requestId: "owners-missing-total-test",
    }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE"
      && error.details?.sid === 8708
      && error.details?.reason === "total-missing",
  );
});

test("full scan rejects an empty Listing page before the declared total", async () => {
  const adapter = {
    async fetchListings({ offset }) {
      return {
        data: {
          total: 2,
          list: offset === 0
            ? [{ sid: 8708, seller_sku: "MSKU-A", asin_principal_list: [] }]
            : [],
        },
      };
    },
  };

  await assert.rejects(
    scanAllListingOwners({
      sellers: [{ sid: 8708, status: 1 }],
      adapter,
      pageSize: 1,
      requestId: "owners-empty-page-test",
    }),
    (error) => error.code === "LISTING_PAGINATION_INCOMPLETE"
      && error.details?.sid === 8708
      && error.details?.reason === "empty-before-total"
      && error.details?.declaredTotal === 2
      && error.details?.rowCount === 1,
  );
});

test("audit scans every active SID and returns only redacted anomaly identities", async () => {
  const calls = [];
  const adapter = {
    async fetchListings({ sid }) {
      calls.push(sid);
      if (sid === 8709) {
        return {
          data: {
            total: 1,
            list: [{
              sid,
              seller_sku: "MSKU-SECRET",
              asin_principal_list: [
                { principal_id: "owner-secret-a", principal_name: "Secret Alice" },
                { principal_id: "owner-secret-b", principal_name: "Secret Bob" },
              ],
            }],
          },
        };
      }
      return {
        data: {
          total: 1,
          list: [{ sid, seller_sku: "MSKU-OK", asin_principal_list: [] }],
        },
      };
    },
  };

  const result = await auditAllListingOwners({
    sellers: [
      { sid: 8708, status: 1 },
      { sid: 8709, status: "active" },
      { sid: 8710, status: 0 },
    ],
    adapter,
    requestId: "owners-redaction-test",
  });

  assert.deepEqual(calls, [8708, 8709]);
  assert.equal(result.counts.multiple, 1);
  assert.equal(result.counts.unassigned, 1);
  assert.equal(result.counts.failedSidCount, 0);
  assert.equal(result.anomalies.length, 1);
  assert.deepEqual(Object.keys(result.anomalies[0]).sort(), [
    "code",
    "identityHashPrefixes",
    "msku",
    "ownerCount",
    "sid",
  ]);
  assert.equal(result.anomalies[0].identityHashPrefixes.length, 2);
  assert.ok(result.anomalies[0].identityHashPrefixes.every((value) => /^[a-f0-9]{12}$/.test(value)));
  assert.doesNotMatch(JSON.stringify(result), /owner-secret|Secret Alice|Secret Bob/);
});

test("first owner cutover creates historical unknown and trusted snapshot periods atomically", async () => {
  const applied = [];
  const repository = {
    readOwnerState: () => ({ periods: [], ownerRevision: 0 }),
    applyOwnerSnapshot(input) {
      applied.push(input);
      return { changed: true, ownerRevision: 1 };
    },
  };
  const result = await syncListingOwnerHistory({
    repository,
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{
      sid: 8708,
      seller_sku: "MSKU-A",
      asin_principal_list: [{ principal_id: 101, principal_name: "Alice" }],
    }]),
    detectedDate: "2026-08-13",
    requestId: "owner-cutover",
    logger: silentLogger,
  });

  assert.equal(applied.length, 1);
  assert.equal(applied[0].expectedOwnerRevision, 0);
  assert.deepEqual(applied[0].periods.map(({ updatedAtMs, ...period }) => period), [
    {
      sid: 8708, msku: "MSKU-A", mskuKey: "msku-a",
      effectiveFrom: "0001-01-01", effectiveTo: "2026-08-12",
      ownerIdentity: null, ownerPersonId: null, ownerNameSnapshot: null,
      identitySource: "cutover-historical-unknown", status: "historical-unknown",
    },
    {
      sid: 8708, msku: "MSKU-A", mskuKey: "msku-a",
      effectiveFrom: "2026-08-13", effectiveTo: null,
      ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice",
      identitySource: "lingxing-person-id", status: "assigned",
    },
  ]);
  assert.deepEqual(result, {
    changed: true, ownerRevision: 1, scannedListingCount: 1,
    periodCount: 2, changedListingCount: 1, transferCount: 0,
    counts: { assigned: 1, unassigned: 0, multiple: 0, malformed: 0 },
  });
  assert.doesNotMatch(JSON.stringify(result), /Alice|id:101|MSKU-A/);
});

test("owner sync logs only safe lifecycle fields on success and failure", async () => {
  const logs = [];
  const logger = {
    info(message, details) { logs.push({ level: "info", message, details }); },
    error(message, details) { logs.push({ level: "error", message, details }); },
  };
  const repository = {
    readOwnerState: () => ({ periods: [], ownerRevision: 0 }),
    applyOwnerSnapshot: () => ({ changed: true, ownerRevision: 1 }),
  };
  await syncListingOwnerHistory({
    repository,
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{
      sid: 8708, seller_sku: "SECRET-MSKU",
      asin_principal_list: [{ principal_id: "SECRET-ID", principal_name: "SECRET-NAME" }],
    }]),
    detectedDate: "2026-08-13",
    requestId: "owner-observable",
    logger,
    now: () => 1000,
  });
  await assert.rejects(syncListingOwnerHistory({
    repository,
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{ sid: 8708, seller_sku: "FAIL-MSKU" }]),
    detectedDate: "2026-08-13",
    requestId: "owner-failure",
    logger,
    now: () => 1000,
  }));

  assert.deepEqual(logs.map(({ level, message }) => ({ level, message })), [
    { level: "info", message: "[sales-facts-owner-sync] start" },
    { level: "info", message: "[sales-facts-owner-sync] success" },
    { level: "info", message: "[sales-facts-owner-sync] start" },
    { level: "error", message: "[sales-facts-owner-sync] failure" },
  ]);
  assert.deepEqual(logs[1].details, {
    requestId: "owner-observable", sidCount: 1, rowCount: 1, pageCount: 1,
    assignedCount: 1, unassignedCount: 0, changedListingCount: 1,
    periodCount: 2, transferCount: 0, ownerRevision: 1, elapsedMs: 0,
  });
  assert.equal(logs[3].details.errorCode, "LISTING_OWNER_FIELD_MISSING");
  assert.equal(logs[3].details.errorName, "ListingOwnerAuditError");
  assert.doesNotMatch(JSON.stringify(logs), /SECRET-MSKU|SECRET-ID|SECRET-NAME|FAIL-MSKU/);
});

test("owner sync preserves the owner date error and sanitizes untrusted failure codes", async () => {
  const invalidDateLogs = [];
  await assert.rejects(
    syncListingOwnerHistory({
      repository: {
        readOwnerState: () => ({ periods: [], ownerRevision: 0 }),
        applyOwnerSnapshot: () => ({ changed: false, ownerRevision: 0 }),
      },
      sellers: [{ sid: 8708, status: 1 }],
      adapter: listingAdapter([]),
      detectedDate: "2026-02-29",
      logger: { info() {}, error(message, details) { invalidDateLogs.push({ message, details }); } },
      now: () => 1000,
    }),
    (error) => error.code === "SALES_FACTS_OWNER_DATE_INVALID",
  );
  assert.equal(invalidDateLogs[0].details.errorCode, "SALES_FACTS_OWNER_DATE_INVALID");

  const upstreamLogs = [];
  const upstreamError = new Error("SECRET-UPSTREAM-MESSAGE");
  upstreamError.code = "token-secret-code";
  upstreamError.name = "SecretCredentialError";
  await assert.rejects(syncListingOwnerHistory({
    repository: {
      readOwnerState: () => ({ periods: [], ownerRevision: 0 }),
      applyOwnerSnapshot: () => ({ changed: false, ownerRevision: 0 }),
    },
    sellers: [{ sid: 8708, status: 1 }],
    adapter: { async fetchListings() { throw upstreamError; } },
    detectedDate: "2026-08-13",
    logger: { info() {}, error(message, details) { upstreamLogs.push({ message, details }); } },
    now: () => 1000,
  }));
  assert.deepEqual(upstreamLogs[0].details, {
    requestId: "", sidCount: 1, elapsedMs: 0,
    errorCode: "LISTING_OWNER_SYNC_FAILED", errorName: "Error",
  });
  assert.doesNotMatch(JSON.stringify(upstreamLogs), /secret|token|credential|upstream-message/i);
});

test("owner changes close on detection day and start on the next day without rewriting history", async () => {
  const existing = [
    {
      sid: 8708, msku: "MSKU-A", mskuKey: "msku-a",
      effectiveFrom: "0001-01-01", effectiveTo: "2026-07-31",
      ownerIdentity: null, ownerPersonId: null, ownerNameSnapshot: null,
      identitySource: "cutover-historical-unknown", status: "historical-unknown", updatedAtMs: 1,
    },
    {
      sid: 8708, msku: "MSKU-A", mskuKey: "msku-a",
      effectiveFrom: "2026-08-01", effectiveTo: null,
      ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice",
      identitySource: "lingxing-person-id", status: "assigned", updatedAtMs: 2,
    },
  ];
  let applied;
  const repository = {
    readOwnerState: () => ({ periods: structuredClone(existing), ownerRevision: 1 }),
    applyOwnerSnapshot(input) {
      applied = input.periods;
      return { changed: true, ownerRevision: 2 };
    },
  };
  const result = await syncListingOwnerHistory({
    repository,
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{
      sid: 8708, seller_sku: "MSKU-A",
      asin_principal_list: [{ principal_id: 102, principal_name: "Bob" }],
    }]),
    detectedDate: "2026-08-13",
    logger: silentLogger,
  });

  assert.deepEqual(applied.slice(0, 2), [existing[0], { ...existing[1], effectiveTo: "2026-08-13" }]);
  assert.equal(applied[2].effectiveFrom, "2026-08-14");
  assert.equal(applied[2].ownerIdentity, "id:102");
  assert.equal(result.transferCount, 1);
});

test("owner status and name snapshot changes create only the required effective periods", async () => {
  const cases = [
    { current: { status: "assigned", ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice", identitySource: "lingxing-person-id" }, next: [], transferCount: 0 },
    { current: { status: "unassigned", ownerIdentity: null, ownerPersonId: null, ownerNameSnapshot: null, identitySource: "lingxing-explicit-empty" }, next: [{ principal_id: 101, principal_name: "Alice" }], transferCount: 0 },
    { current: { status: "assigned", ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice", identitySource: "lingxing-person-id" }, next: [{ principal_id: 101, principal_name: "Alice Renamed" }], transferCount: 0 },
  ];
  for (const scenario of cases) {
    let applied;
    const repository = {
      readOwnerState: () => ({
        periods: [{
          sid: 8708, msku: "MSKU-A", mskuKey: "msku-a", effectiveFrom: "2026-08-01", effectiveTo: null,
          ...scenario.current, updatedAtMs: 1,
        }],
        ownerRevision: 1,
      }),
      applyOwnerSnapshot(input) {
        applied = input.periods;
        return { changed: true, ownerRevision: 2 };
      },
    };
    const result = await syncListingOwnerHistory({
      repository,
      sellers: [{ sid: 8708, status: 1 }],
      adapter: listingAdapter([{ sid: 8708, seller_sku: "MSKU-A", asin_principal_list: scenario.next }]),
      detectedDate: "2026-08-13",
      logger: silentLogger,
    });
    assert.equal(applied.length, 2);
    assert.equal(applied[0].effectiveTo, "2026-08-13");
    assert.equal(applied[1].effectiveFrom, "2026-08-14");
    assert.equal(result.transferCount, scenario.transferCount);
  }
});

test("unchanged owner snapshot does not add a period or increment revision", async () => {
  const existing = [{
    sid: 8708, msku: "MSKU-A", mskuKey: "msku-a", effectiveFrom: "2026-08-01", effectiveTo: null,
    ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice",
    identitySource: "lingxing-person-id", status: "assigned", updatedAtMs: 1,
  }];
  let applied;
  const result = await syncListingOwnerHistory({
    repository: {
      readOwnerState: () => ({ periods: structuredClone(existing), ownerRevision: 1 }),
      applyOwnerSnapshot(input) {
        applied = input.periods;
        return { changed: false, ownerRevision: 1 };
      },
    },
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{
      sid: 8708, seller_sku: " msku-a ",
      asin_principal_list: [{ principal_id: 101, principal_name: "Alice" }],
    }]),
    detectedDate: "2026-08-13",
    logger: silentLogger,
  });
  assert.deepEqual(applied, existing);
  assert.equal(result.changed, false);
  assert.equal(result.ownerRevision, 1);
  assert.equal(result.changedListingCount, 0);
});

test("owner sync fails closed when a complete snapshot omits an open Listing identity", async () => {
  let applies = 0;
  await assert.rejects(
    syncListingOwnerHistory({
      repository: {
        readOwnerState: () => ({
          periods: [{
            sid: 8708, msku: "MSKU-MISSING", mskuKey: "msku-missing",
            effectiveFrom: "2026-08-01", effectiveTo: null,
            ownerIdentity: "id:101", ownerPersonId: "101", ownerNameSnapshot: "Alice",
            identitySource: "lingxing-person-id", status: "assigned", updatedAtMs: 1,
          }],
          ownerRevision: 1,
        }),
        applyOwnerSnapshot() { applies += 1; },
      },
      sellers: [{ sid: 8708, status: 1 }],
      adapter: listingAdapter([{
        sid: 8708, seller_sku: "MSKU-PRESENT", asin_principal_list: [],
      }]),
      detectedDate: "2026-08-13",
      logger: silentLogger,
    }),
    (error) => error.code === "LISTING_OWNER_SNAPSHOT_MISSING_OPEN_IDENTITY"
      && error.details?.missingOpenIdentityCount === 1,
  );
  assert.equal(applies, 0);
});

test("owner sync uses the injected clock for new effective periods", async () => {
  let applied;
  await syncListingOwnerHistory({
    repository: {
      readOwnerState: () => ({ periods: [], ownerRevision: 0 }),
      applyOwnerSnapshot(input) {
        applied = input.periods;
        return { changed: true, ownerRevision: 1 };
      },
    },
    sellers: [{ sid: 8708, status: 1 }],
    adapter: listingAdapter([{
      sid: 8708, seller_sku: "MSKU-A", asin_principal_list: [],
    }]),
    detectedDate: "2026-08-13",
    now: () => 123456789,
    logger: silentLogger,
  });
  assert.deepEqual(applied.map((period) => period.updatedAtMs), [123456789, 123456789]);
});

test("owner sync applies nothing when the full scan fails", async () => {
  let reads = 0;
  let applies = 0;
  await assert.rejects(
    syncListingOwnerHistory({
      repository: {
        readOwnerState() { reads += 1; return { periods: [], ownerRevision: 0 }; },
        applyOwnerSnapshot() { applies += 1; },
      },
      sellers: [{ sid: 8708, status: 1 }],
      adapter: listingAdapter([{ sid: 8708, seller_sku: "MSKU-A" }]),
      detectedDate: "2026-08-13",
      logger: silentLogger,
    }),
    (error) => error.code === "LISTING_OWNER_FIELD_MISSING",
  );
  assert.equal(reads, 0);
  assert.equal(applies, 0);
});

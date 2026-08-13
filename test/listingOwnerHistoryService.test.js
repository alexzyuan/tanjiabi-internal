import assert from "node:assert/strict";
import test from "node:test";

import {
  ListingOwnerAuditError,
  auditAllListingOwners,
  parseListingOwnerRecord,
  scanAllListingOwners,
} from "../src/services/listingOwnerHistoryService.js";

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

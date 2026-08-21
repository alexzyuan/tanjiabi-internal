import assert from "node:assert/strict";
import test from "node:test";

import {
  SharedFilterStateError,
  createSharedFilterStateStore,
  decodeSharedFilterState,
  encodeSharedFilterState,
  normalizeSharedFilterState,
} from "../assets/js/shared-filter-state.js";

test("shared filter state normalizes aliases, lists, and currency into one canonical shape", () => {
  const state = normalizeSharedFilterState({
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    countries: [" 美国 ", "美国", "加拿大"],
    sids: [8709, "8708", 8708],
    stores: [" B ", "A", "B"],
    listingOwner: " 运营A ",
    currencyCode: "original",
    msku: " M-1 ",
    asin: ["B-2", "B-2"],
    sku: ["SKU-1"],
  });

  assert.deepEqual(state, {
    date: { start: "2026-08-01", end: "2026-08-07" },
    country: ["加拿大", "美国"],
    sid: ["8708", "8709"],
    store: ["A", "B"],
    owner: ["运营A"],
    currency: "ORIGINAL",
    msku: ["M-1"],
    asin: ["B-2"],
    sku: ["SKU-1"],
  });
});

test("shared filter state rejects malformed recognized values instead of hiding them", () => {
  assert.throws(
    () => normalizeSharedFilterState({ startDate: "2026/08/01" }),
    (error) => error instanceof SharedFilterStateError && /startDate/.test(error.message),
  );
  assert.throws(
    () => normalizeSharedFilterState({ sids: ["not-a-sid"] }),
    (error) => error instanceof SharedFilterStateError && /SID/.test(error.message),
  );
  assert.throws(
    () => normalizeSharedFilterState({ currencyCode: "CNY RMB" }),
    (error) => error instanceof SharedFilterStateError && /currency/.test(error.message),
  );
});

test("shared filter state encodes and decodes the stable URL contract", () => {
  const state = normalizeSharedFilterState({
    date: { start: "2026-08-01", end: "2026-08-07" },
    country: ["美国", "加拿大"],
    sid: ["8709", "8708"],
    store: ["B", "A"],
    owner: ["运营A"],
    currency: "CNY",
    msku: ["M-1"],
    asin: ["B-2"],
    sku: ["SKU-1"],
  });
  const search = encodeSharedFilterState(state).toString();
  assert.equal(
    search,
    "startDate=2026-08-01&endDate=2026-08-07&currencyCode=CNY&countries=%E5%8A%A0%E6%8B%BF%E5%A4%A7&countries=%E7%BE%8E%E5%9B%BD&sids=8708%2C8709&stores=A&stores=B&listingOwner=%E8%BF%90%E8%90%A5A&msku=M-1&asin=B-2&sku=SKU-1",
  );

  assert.deepEqual(decodeSharedFilterState(`?${search}`), state);
  assert.deepEqual(
    decodeSharedFilterState("?startDate=2026-08-01&endDate=2026-08-07&countries=美国&countries=加拿大&sids=8709,8708&stores=B&stores=A&listingOwner=运营A&currency=CNY&msku=M-1&asin=B-2&sku=SKU-1"),
    state,
  );
});

test("shared state store preserves unrelated URL params while replacing canonical filter keys", () => {
  const location = { pathname: "/dashboard", search: "?view=sales&keep=1&startDate=2026-07-01&sids=1" };
  const historyCalls = [];
  const history = {
    replaceState(_state, _title, url) {
      historyCalls.push(url);
      location.search = String(url).slice(location.pathname.length);
    },
  };
  const changes = [];
  const store = createSharedFilterStateStore({
    locationRef: location,
    historyRef: history,
    onChange(nextState, meta) {
      changes.push({ nextState, meta });
    },
  });

  assert.deepEqual(store.get().date, { start: "2026-07-01", end: "" });
  store.patch({
    date: { start: "2026-08-01", end: "2026-08-07" },
    sid: [2, 1],
    currency: "ORIGINAL",
  });

  assert.equal(historyCalls.length, 1);
  assert.equal(
    location.search,
    "?view=sales&keep=1&startDate=2026-08-01&endDate=2026-08-07&currencyCode=ORIGINAL&sids=1%2C2",
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].meta.changedKeys.includes("date"), true);
  assert.equal(changes[0].meta.changedKeys.includes("sid"), true);
});

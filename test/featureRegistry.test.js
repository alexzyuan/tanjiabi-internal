import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FEATURE_DEFINITIONS,
  FeatureRegistryError,
  UnsupportedFeatureFilterError,
  createFeatureRegistry,
} from "../assets/js/feature-registry.js";

const sampleState = {
  date: { start: "2026-08-01", end: "2026-08-07" },
  country: ["美国"],
  sid: ["8708"],
  store: ["xiamentanjia-US"],
  owner: ["运营A"],
  currency: "CNY",
  msku: ["M-1"],
  asin: ["B-1"],
  sku: ["SKU-1"],
};

test("feature registry validates definitions and rejects duplicates or unknown filters", () => {
  assert.throws(
    () => createFeatureRegistry([{ id: "bad", supportedFilters: ["not-a-filter"], queryFilters: [] }]),
    (error) => error instanceof FeatureRegistryError && /unknown filter/.test(error.message),
  );
  assert.throws(
    () => createFeatureRegistry([
      { id: "same", supportedFilters: ["date"], queryFilters: ["date"] },
      { id: "same", supportedFilters: ["date"], queryFilters: ["date"] },
    ]),
    (error) => error instanceof FeatureRegistryError && /Duplicate/.test(error.message),
  );
  assert.throws(
    () => createFeatureRegistry([{ id: "bad-query", supportedFilters: ["date"], queryFilters: ["currency"] }]),
    (error) => error instanceof FeatureRegistryError && /queryFilters/.test(error.message),
  );
});

test("feature registry exposes supported context fields and strict validation", () => {
  const registry = createFeatureRegistry(DEFAULT_FEATURE_DEFINITIONS);
  assert.equal(registry.supports("sales-dashboard", "msku"), true);
  assert.equal(registry.supports("store-operating-monthly-report", "msku"), false);
  assert.deepEqual(registry.getUnsupportedFilterKeys("store-operating-monthly-report", sampleState), ["owner", "msku", "asin", "sku"]);
  assert.throws(
    () => registry.assertSupports("store-operating-monthly-report", sampleState),
    (error) => error instanceof UnsupportedFeatureFilterError
      && error.featureId === "store-operating-monthly-report"
      && error.unsupportedKeys.join(",") === "owner,msku,asin,sku",
  );
});

test("feature registry projects API query fields and reports intentionally omitted context", () => {
  const registry = createFeatureRegistry(DEFAULT_FEATURE_DEFINITIONS);
  const projection = registry.projectState("sales-dashboard", sampleState, { purpose: "query" });
  assert.deepEqual(projection.state, {
    date: { start: "2026-08-01", end: "2026-08-07" },
    country: [],
    sid: ["8708"],
    store: [],
    owner: ["运营A"],
    currency: "CNY",
    msku: [],
    asin: [],
    sku: [],
  });
  assert.deepEqual(projection.omittedKeys, ["country", "store", "msku", "asin", "sku"]);
  assert.deepEqual(projection.unsupportedKeys, []);
});

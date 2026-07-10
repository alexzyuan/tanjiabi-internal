import assert from "node:assert/strict";
import test from "node:test";

import { createAdPerformanceReviewFeature } from "../assets/js/features/ad-performance-review.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createAdPerformanceReviewFeature({
    root,
    loadDashboardSection: async () => {},
    addDays: (date) => date,
    bind: (...args) => bindCalls.push(args),
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatDate: () => "2026-07-07",
    formatMetricNumber: (value) => String(value),
    formatRateNullable: (value) => String(value),
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, feature };
}

test("ad performance review owns refresh and date bindings", () => {
  const { bindCalls, feature } = createFeature();

  feature.setupAdPerformanceReview();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#ads-review-refresh", "click", bindCalls[0][3]],
      ["#ads-review-start-date", "change", feature.setDefaultAdReviewDates],
      ["#ads-review-end-date", "change", feature.setDefaultAdReviewDates],
      ["#ads-review-compare-start-date", "change", feature.setDefaultAdReviewDates],
      ["#ads-review-compare-end-date", "change", feature.setDefaultAdReviewDates],
    ],
  );
});

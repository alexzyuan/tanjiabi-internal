import assert from "node:assert/strict";
import test from "node:test";

import { createAdPortfolioFeature } from "../assets/js/features/ad-portfolios.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const debouncedActions = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createAdPortfolioFeature({
    root,
    loadDashboardSection: async () => {},
    addDays: (date) => date,
    bind: (...args) => bindCalls.push(args),
    closestTarget: () => null,
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatDate: () => "2026-07-07",
    formatMetricNumber: (value) => String(value),
    formatMoney: (value) => String(value),
    formatRateNullable: (value) => String(value),
    setText: () => {},
    storage: { getItem: () => null, setItem: () => {} },
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, debouncedActions, feature };
}

test("ad portfolio feature owns refresh, filter, search, and column bindings", () => {
  const { bindCalls, debouncedActions, feature } = createFeature();

  feature.setupAdPortfolios();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 350);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#ads-portfolio-refresh", "click", feature.loadAdPortfolios],
      ["#ads-portfolio-state", "change", feature.loadAdPortfolios],
      ["#ads-portfolio-report-date", "change", feature.loadAdPortfolios],
      ["#ads-portfolio-keyword", "input", debouncedActions[0].debounced],
      ["#ads-portfolio-columns", "change", feature.handleAdPortfolioColumnsChange],
      ["#ads-portfolio-columns", "click", feature.handleAdPortfolioColumnGroupClick],
    ],
  );
});

test("ad portfolio renders stable semantic metadata for configured columns", () => {
  const header = { innerHTML: "" };
  const body = { innerHTML: "" };
  const picker = { innerHTML: "" };
  const { feature } = createFeature({
    root: {
      querySelector(selector) {
        if (selector === "#ads-portfolio-table thead tr") return header;
        if (selector === "#ads-portfolio-table tbody") return body;
        if (selector === "#ads-portfolio-columns") return picker;
        return null;
      },
    },
    storage: { getItem: () => JSON.stringify(["name", "budget"]), setItem: () => {} },
  });

  feature.renderAdPortfolios({ rows: [], summary: {} });

  assert.match(header.innerHTML, /data-column-key="name"/);
  assert.match(header.innerHTML, /data-column-profile="name"/);
  assert.match(header.innerHTML, /data-column-key="budget"/);
  assert.match(header.innerHTML, /data-column-kind="money"/);
});

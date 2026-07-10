import assert from "node:assert/strict";
import test from "node:test";

import { createAftersalesMailFeature } from "../assets/js/features/aftersales-mail.js";

function createFeature(overrides = {}) {
  const bindCalls = [];
  const debouncedActions = [];
  const root = {
    querySelector() {
      return null;
    },
  };
  const feature = createAftersalesMailFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    closestTarget: () => null,
    createDebouncedAction: (action, delay) => {
      const debounced = () => action();
      debouncedActions.push({ action, delay, debounced });
      return debounced;
    },
    escapeHtml: (value) => String(value ?? ""),
    fieldValue: () => "",
    formatNumber: (value) => String(value),
    setButtonBusy: () => () => {},
    setElementsDisabled: () => [],
    setText: () => {},
    trimmedFieldValue: () => "",
    ...overrides,
  });
  return { bindCalls, debouncedActions, feature };
}

test("aftersales mail feature owns refresh, filter, detail, ai, reply, and status bindings", () => {
  const { bindCalls, debouncedActions, feature } = createFeature();

  feature.setupAftersalesMail();

  assert.equal(debouncedActions.length, 1);
  assert.equal(debouncedActions[0].delay, 200);
  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#aftersales-mail-refresh", "click", bindCalls[0][3]],
      ["#aftersales-mail-sync", "click", bindCalls[1][3]],
      ["#aftersales-mail-status-filter", "change", debouncedActions[0].debounced],
      ["#aftersales-mail-keyword", "input", debouncedActions[0].debounced],
      ["#aftersales-mail-table", "click", feature.handleAftersalesMailTableClick],
      ["#aftersales-mail-ai-refresh", "click", feature.generateAftersalesMailAiSuggestion],
      ["#aftersales-mail-use-ai", "click", feature.useAftersalesMailAiSuggestion],
      ["#aftersales-mail-send-reply", "click", feature.sendAftersalesMailReply],
      ["#aftersales-mail-mark-pending", "click", feature.markAftersalesMailPending],
      ["#aftersales-mail-mark-replied", "click", feature.markAftersalesMailReplied],
    ],
  );
});

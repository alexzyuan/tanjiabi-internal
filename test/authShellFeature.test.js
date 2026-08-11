import assert from "node:assert/strict";
import test from "node:test";

import { createAuthShellFeature } from "../assets/js/features/auth-shell.js";

function createElement({ active = false } = {}) {
  return {
    active,
    clickCount: 0,
    hidden: false,
    click() {
      this.clickCount += 1;
    },
  };
}

function createAuthShell({ activeSync = false } = {}) {
  const settingsGroup = createElement();
  const syncView = createElement();
  const syncButton = createElement({ active: activeSync });
  const homeButton = createElement();
  const selectors = new Map([
    ['.nav-item[data-view="admin"].active, .nav-item[data-view="sync"].active, .nav-item[data-permission="admin"].active', activeSync ? syncButton : null],
    ['.nav-item[data-view="home"]', homeButton],
  ]);
  const collections = new Map([
    ['.nav-item[data-view="admin"], .nav-item[data-permission="admin"]', []],
    ['.nav-group[data-permission="admin"], .view[data-permission="admin"]', [settingsGroup, syncView]],
    ['.nav-group[data-permission="finance"]', []],
    ['[data-permission-card="finance"]', []],
  ]);
  const root = {
    querySelector(selector) {
      return selectors.get(selector) || null;
    },
    querySelectorAll(selector) {
      return collections.get(selector) || [];
    },
  };
  const setElementsHidden = (elements, hidden) => {
    for (const element of elements) element.hidden = hidden;
    return elements;
  };
  const feature = createAuthShellFeature({
    root,
    bind: () => {},
    bindClickOutside: () => {},
    escapeHtml: (value) => value,
    fetchImpl: async () => ({ json: async () => ({}) }),
    setElementsHidden,
    setExpandedClassState: () => {},
  });
  return { feature, homeButton, settingsGroup, syncView };
}

test("applyAuthVisibility hides Settings and redirects a subaccount away from Sync", () => {
  const { feature, homeButton, settingsGroup, syncView } = createAuthShell({ activeSync: true });

  const result = feature.applyAuthVisibility({ role: "子账号" });

  assert.equal(result.canEnterAdmin, false);
  assert.equal(settingsGroup.hidden, true);
  assert.equal(syncView.hidden, true);
  assert.equal(homeButton.clickCount, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createSyncCenterFeature } from "../assets/js/features/sync-center.js";

function createElement({ checked = false, value = "" } = {}) {
  return {
    checked,
    innerHTML: "",
    value,
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function createFeatureWithMailboxElements({ fetchImpl } = {}) {
  const elements = new Map([
    ["#aftersales-mail-account", createElement()],
    ["#aftersales-mail-enabled", createElement()],
    ["#aftersales-mail-password", createElement()],
    ["#aftersales-mail-status", createElement()],
    ["#aftersales-mail-summary", createElement()],
  ]);
  const bindCalls = [];
  const statusMessages = [];
  const requests = [];
  const root = {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
  };
  const feature = createSyncCenterFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    fetchImpl: async (path, options = {}) => {
      requests.push({
        path,
        method: options.method || "GET",
        body: options.body ? JSON.parse(options.body) : undefined,
      });
      return fetchImpl(path, options);
    },
    getDisplayShopName: () => "",
    normalizeCountryName: (value) => value,
    pickSellerCountry: () => "",
    pickSellerName: () => "",
    populateFbaShopSelect: () => {},
    populateFrontShopFilters: () => {},
    redirectToLogin: () => {},
    renderTableMessage: () => {},
    renderTopbarSyncStatus: () => {},
    setButtonBusy: () => () => {},
    setExclusiveClassState: () => {},
    setStatusMessage: (selector, message, tone, targetRoot) => statusMessages.push({ selector, message, tone, targetRoot }),
    setText: () => {},
  });
  return { bindCalls, elements, feature, requests, statusMessages };
}

test("sync center masks the stored authorization code and escapes mailbox status messages", async () => {
  const { elements, feature } = createFeatureWithMailboxElements({
    fetchImpl: async () => jsonResponse({
      account: "jmcustomer@163.com",
      enabled: true,
      passwordConfigured: true,
      lastTest: { checkedAt: "2026-08-11T10:00:00.000Z", message: "<img src=x>" },
      lastChange: { at: "2026-08-11T09:00:00.000Z", actor: "系统管理员" },
    }),
  });
  elements.get("#aftersales-mail-password").value = "discard-me";

  await feature.loadAftersalesMailSettings();

  assert.equal(elements.get("#aftersales-mail-account").value, "jmcustomer@163.com");
  assert.equal(elements.get("#aftersales-mail-enabled").checked, true);
  assert.equal(elements.get("#aftersales-mail-password").value, "");
  assert.match(elements.get("#aftersales-mail-summary").innerHTML, /授权码已配置/);
  assert.match(elements.get("#aftersales-mail-summary").innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(elements.get("#aftersales-mail-summary").innerHTML, /<img src=x>/);
});

test("sync center sends a test code once, clears it, and reloads masked status", async () => {
  const responses = [
    jsonResponse({ ok: true, checkedAt: "2026-08-11T10:00:00.000Z", message: "连接成功" }),
    jsonResponse({ account: "jmcustomer@163.com", enabled: true, passwordConfigured: true, lastTest: null, lastChange: null }),
  ];
  const { elements, feature, requests } = createFeatureWithMailboxElements({
    fetchImpl: async () => responses.shift(),
  });
  elements.get("#aftersales-mail-password").value = "candidate-code";

  await feature.testAftersalesMailSettings();

  assert.deepEqual(requests, [
    { path: "/api/admin/aftersales-mail-config/test", method: "POST", body: { password: "candidate-code" } },
    { path: "/api/admin/aftersales-mail-config", method: "GET", body: undefined },
  ]);
  assert.equal(elements.get("#aftersales-mail-password").value, "");
});

test("sync center saves only a currently entered authorization code", async () => {
  const responses = [
    jsonResponse({ ok: true, enabled: true }),
    jsonResponse({ account: "jmcustomer@163.com", enabled: true, passwordConfigured: true, lastTest: null, lastChange: null }),
    jsonResponse({ ok: true, enabled: false }),
    jsonResponse({ account: "jmcustomer@163.com", enabled: false, passwordConfigured: true, lastTest: null, lastChange: null }),
  ];
  const { elements, feature, requests } = createFeatureWithMailboxElements({
    fetchImpl: async () => responses.shift(),
  });
  elements.get("#aftersales-mail-enabled").checked = true;
  elements.get("#aftersales-mail-password").value = "replacement-code";

  await feature.saveAftersalesMailSettings({ preventDefault() {} });
  elements.get("#aftersales-mail-enabled").checked = false;
  await feature.saveAftersalesMailSettings({ preventDefault() {} });

  assert.deepEqual(requests, [
    { path: "/api/admin/aftersales-mail-config", method: "PUT", body: { enabled: true, password: "replacement-code" } },
    { path: "/api/admin/aftersales-mail-config", method: "GET", body: undefined },
    { path: "/api/admin/aftersales-mail-config", method: "PUT", body: { enabled: false } },
    { path: "/api/admin/aftersales-mail-config", method: "GET", body: undefined },
  ]);
  assert.equal(elements.get("#aftersales-mail-password").value, "");
});

test("sync center reports JSON errors and clears the authorization field", async () => {
  const { elements, feature, statusMessages } = createFeatureWithMailboxElements({
    fetchImpl: async () => jsonResponse({ error: "授权码无效" }, { ok: false, status: 400 }),
  });
  elements.get("#aftersales-mail-password").value = "invalid-code";

  await feature.testAftersalesMailSettings();

  assert.equal(statusMessages.length, 1);
  assert.deepEqual(statusMessages[0], {
    selector: "#aftersales-mail-status",
    message: "授权码无效",
    tone: "danger",
    targetRoot: statusMessages[0].targetRoot,
  });
  assert.equal(elements.get("#aftersales-mail-password").value, "");
});

test("sync center owns mailbox control bindings", () => {
  const { bindCalls, feature } = createFeatureWithMailboxElements({
    fetchImpl: async () => jsonResponse({}),
  });

  feature.setupSyncCenter();

  assert.deepEqual(
    bindCalls.map(([, selector, eventName, handler]) => [selector, eventName, handler]),
    [
      ["#manual-sync-button", "click", feature.triggerManualSync],
      ["#aftersales-mail-test", "click", feature.testAftersalesMailSettings],
      ["#aftersales-mail-settings-form", "submit", feature.saveAftersalesMailSettings],
    ],
  );
});

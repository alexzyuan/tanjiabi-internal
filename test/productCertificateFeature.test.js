import assert from "node:assert/strict";
import test from "node:test";

import { createProductCertificatesFeature } from "../assets/js/features/product-certificates.js";

function jsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function createHarness({ fetchImpl } = {}) {
  const values = {
    "#certificate-editor-id": "",
    "#certificate-editor-country": "美国",
    "#certificate-editor-product-sku": "",
    "#certificate-editor-type": "CPC全套",
    "#certificate-editor-number": "CPC-001",
    "#certificate-editor-issued-date": "2026-08-01",
    "#certificate-editor-expiry-date": "2027-08-01",
  };
  const elements = Object.fromEntries(Object.keys(values).map((selector) => [selector, {
    value: values[selector],
    setAttribute() {},
    focus() {},
  }]));
  elements["#certificate-editor-form"] = { reset() {} };
  elements["#certificate-editor-dialog"] = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  elements["#certificate-editor-type-options"] = { innerHTML: "" };
  elements["#certificate-editor-product-sku-options"] = {
    hidden: true,
    innerHTML: "",
    querySelector() { return this.innerHTML ? {} : null; },
  };
  elements["#certificate-editor-product-sku-selected"] = { innerHTML: "" };
  elements["#certificate-editor-save"] = { textContent: "保存", disabled: false };
  elements["#certificate-editor-status"] = { textContent: "" };
  elements["#certificate-table-body"] = { innerHTML: "" };
  elements["#certificate-table"] = {};
  elements["#certificate-table-count"] = { textContent: "" };
  elements["#certificate-status"] = { textContent: "" };
  elements["#certificate-country-filter"] = { value: "", innerHTML: "" };
  elements["#certificate-type-filter"] = { value: "", innerHTML: "" };
  elements["#certificate-status-filter"] = { value: "" };
  elements["#certificate-keyword-filter"] = { value: "" };
  for (const selector of ["#certificate-valid-count", "#certificate-warning-count", "#certificate-attention-count", "#certificate-expired-count"]) {
    elements[selector] = { textContent: "" };
  }
  elements["#certificate-add-button"] = {};
  elements["#certificate-import-button"] = {};
  elements["#certificate-import-form"] = { reset() {} };
  elements["#certificate-import-dialog"] = { showModal() {}, close() {} };
  elements["#certificate-import-file"] = { files: [] };
  elements["#certificate-import-submit"] = { textContent: "确认导入", disabled: false };
  elements["#certificate-import-status"] = { textContent: "" };

  const root = {
    querySelector(selector) {
      if (selector.startsWith("#certificate-editor-product-sku-options ")) return elements["#certificate-editor-product-sku-options"].querySelector();
      return elements[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const bindCalls = [];
  const busyCalls = [];
  const requests = [];
  const feature = createProductCertificatesFeature({
    root,
    bind: (...args) => { bindCalls.push(args); },
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    fetchImpl: fetchImpl || (async (url) => {
      requests.push({ url });
      if (String(url).includes("/options")) return jsonResponse({ countries: ["美国"], certificateTypes: ["CPC全套"], productSkus: [{ sku: "TJ001" }, { sku: "TJ002" }] });
      if (String(url).includes("/api/product-certificates")) return jsonResponse({ ok: true, rows: [], summary: {}, filters: {} });
      return jsonResponse({ ok: true });
    }),
    readFileAsBase64: async () => "",
    refreshTable() {},
    setButtonBusy: (button, busyText, restoreText = button?.textContent || "") => {
      busyCalls.push({ button, busyText, restoreText });
      button.disabled = true;
      button.textContent = busyText;
      return () => {
        button.disabled = false;
        button.textContent = restoreText;
      };
    },
    setStatusMessage(selector, message) {
      if (elements[selector]) elements[selector].textContent = message;
    },
  });
  return { bindCalls, busyCalls, elements, feature, requests };
}

function handler(bindCalls, selector, eventName) {
  return bindCalls.find(([, boundSelector, boundEventName]) => boundSelector === selector && boundEventName === eventName)?.[3];
}

test("certificate editor accepts an exact catalog SKU typed without a second click and restores the save button", async () => {
  const posts = [];
  const { bindCalls, busyCalls, elements, feature } = createHarness({
    fetchImpl: async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body));
        return jsonResponse({ ok: true, certificate: { id: "certificate-1" } });
      }
      if (String(url).includes("/options")) return jsonResponse({ countries: ["美国"], certificateTypes: ["CPC全套"], productSkus: [{ sku: "TJ001" }] });
      return jsonResponse({ ok: true, rows: [], summary: {}, filters: {} });
    },
  });
  feature.setupProductCertificates();
  handler(bindCalls, "#certificate-add-button", "click")();
  await new Promise((resolve) => setImmediate(resolve));
  elements["#certificate-editor-country"].value = "美国";
  elements["#certificate-editor-product-sku"].value = "TJ001";
  elements["#certificate-editor-type"].value = "CPC全套";
  elements["#certificate-editor-number"].value = "CPC-001";
  elements["#certificate-editor-issued-date"].value = "2026-08-01";
  elements["#certificate-editor-expiry-date"].value = "2027-08-01";

  await handler(bindCalls, "#certificate-editor-form", "submit")({ preventDefault() {} });

  assert.deepEqual(posts, [{ country: "美国", productSkus: ["TJ001"], certificateType: "CPC全套", certificateNumber: "CPC-001", issuedDate: "2026-08-01", expiryDate: "2027-08-01" }]);
  assert.equal(elements["#certificate-editor-save"].textContent, "保存");
  assert.equal(elements["#certificate-editor-save"].disabled, false);
  assert.equal(busyCalls[0].busyText, "保存中…");
  assert.equal(busyCalls[0].restoreText, "保存");
});

test("certificate SKU option selection keeps the dropdown closed and supports multiple selected SKUs", async () => {
  const { bindCalls, elements, feature, requests } = createHarness();
  feature.setupProductCertificates();
  const input = elements["#certificate-editor-product-sku"];
  const optionClick = handler(bindCalls, "#certificate-editor-product-sku-options", "click");
  const inputHandler = handler(bindCalls, "#certificate-editor-product-sku", "input");
  const focusHandler = handler(bindCalls, "#certificate-editor-product-sku", "focus");

  input.value = "TJ";
  inputHandler();
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.equal(requests.filter(({ url }) => String(url).includes("/options")).length, 1);

  optionClick({ target: { closest: () => ({ dataset: { certificateSkuOption: "TJ001" } }) } });
  optionClick({ target: { closest: () => ({ dataset: { certificateSkuOption: "TJ002" } }) } });
  assert.equal(input.value, "");
  assert.match(elements["#certificate-editor-product-sku-selected"].innerHTML, /TJ001/u);
  assert.match(elements["#certificate-editor-product-sku-selected"].innerHTML, /TJ002/u);
  assert.equal(elements["#certificate-editor-product-sku-options"].hidden, true);

  focusHandler();
  await new Promise((resolve) => setTimeout(resolve, 240));
  assert.equal(requests.filter(({ url }) => String(url).includes("/options")).length, 1);
});

test("certificate ledger renders catalog product names for every selected SKU", async () => {
  const { elements, feature } = createHarness({
    fetchImpl: async (url) => {
      if (String(url).includes("/api/product-certificates")) {
        return jsonResponse({
          ok: true,
          rows: [{
            id: "certificate-1",
            country: "美国",
            productSku: "TJ001、TJ002",
            productSkus: ["TJ001", "TJ002"],
            productNames: [
              { sku: "TJ001", productName: "蓝色商品" },
              { sku: "TJ002", productName: "红色商品" },
            ],
            certificateType: "CPC全套",
            certificateNumber: "CPC-001",
            issuedDate: "2026-08-01",
            expiryDate: "2027-08-01",
            status: "有效",
          }],
          summary: { valid: 1 },
          filters: { countries: ["美国"], certificateTypes: ["CPC全套"] },
        });
      }
      return jsonResponse({ ok: true, countries: [], certificateTypes: [], productSkus: [] });
    },
  });
  await feature.loadProductCertificates();
  assert.match(elements["#certificate-table-body"].innerHTML, /TJ001：蓝色商品/u);
  assert.match(elements["#certificate-table-body"].innerHTML, /TJ002：红色商品/u);
});

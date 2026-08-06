import assert from "node:assert/strict";
import test from "node:test";

import { createFbaMskuFeature } from "../assets/js/features/fba-msku.js";

function createFeature({ fetchImpl } = {}) {
  const elements = {
    "#fba-msku": { value: "MD-889-382", id: "fba-msku" },
    "#fba-msku-match": { value: "exact" },
    "#fba-msku-results": { innerHTML: "", textContent: "" },
    "#fba-msku-suggest": { innerHTML: "", hidden: true },
    "#fba-load-mskus-button": { disabled: false, textContent: "刷新MSKU" },
    "#fba-box-count": { value: "" },
    "#fba-pack-quantity": { value: "", placeholder: "" },
    "#fba-quantity": { value: "", placeholder: "" },
    "#fba-box-length": { value: "" },
    "#fba-box-width": { value: "" },
    "#fba-box-height": { value: "" },
    "#fba-box-weight": { value: "" },
    "#fba-box-spec-status": { textContent: "" },
  };
  const bindCalls = [];
  const root = {
    activeElement: elements["#fba-msku"],
    querySelector(selector) {
      return elements[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const feature = createFbaMskuFeature({
    root,
    bind: (...args) => bindCalls.push(args),
    bindClickOutside: () => {},
    closestTarget: () => null,
    escapeHtml: (value) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;"),
    fbaValue: (selector) => elements[selector]?.value || "",
    fetchImpl,
    formatNumber: (value) => String(value),
    getSelectedFbaShops: () => [{ sid: 11500, name: "tandanbo-US", displayName: "坦蛋伯美国" }],
    setButtonBusy: () => () => {},
    setElementsHidden: (selector, hidden) => {
      if (elements[selector]) elements[selector].hidden = hidden;
      return [elements[selector]];
    },
    setFbaShopMenuOpen: () => {},
    setText: () => {},
  });
  return { bindCalls, elements, feature };
}

test("FBA MSKU search shows unpaired Listing diagnostics when local candidates do not match", async () => {
  const requestedUrls = [];
  const { bindCalls, elements, feature } = createFeature({
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          items: [],
          diagnostics: {
            message: "领星 Listing 中存在 MD-889-382（坦蛋伯美国），但未配对 ERP 产品资料。",
            unpairedListings: [{
              sid: 11500,
              shopName: "tandanbo-US",
              displayName: "坦蛋伯美国",
              msku: "MD-889-382",
              asin: "B0H7JGYKK3",
            }],
          },
        }),
      };
    },
  });
  feature.setupFbaMskuPicker();
  const inputHandler = bindCalls.find(([, selector, eventName]) => selector === "#fba-msku" && eventName === "input")[3];

  inputHandler();
  await new Promise((resolve) => {
    setTimeout(resolve, 320);
  });

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /q=MD-889-382/);
  assert.match(requestedUrls[0], /match=exact/);
  assert.match(elements["#fba-msku-results"].innerHTML, /未配对 ERP 产品资料/);
  assert.match(elements["#fba-msku-results"].innerHTML, /MD-889-382/);
});

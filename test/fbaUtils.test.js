import assert from "node:assert/strict";
import test from "node:test";

import { createFbaUtils } from "../assets/js/fba-utils.js";

test("fba utils read trimmed field values from the provided root", () => {
  const calls = [];
  const root = { id: "fba-root" };
  const { fbaValue } = createFbaUtils({
    root,
    trimmedFieldValue: (selector, fallback, currentRoot) => {
      calls.push({ selector, fallback, root: currentRoot });
      return selector === "#fba-msku" ? "MSKU-1" : fallback;
    },
  });

  assert.equal(fbaValue("#fba-msku"), "MSKU-1");
  assert.equal(fbaValue("#missing"), "");
  assert.deepEqual(calls, [
    { selector: "#fba-msku", fallback: "", root },
    { selector: "#missing", fallback: "", root },
  ]);
});

test("fba utils require a trimmed field reader", () => {
  assert.throws(() => createFbaUtils(), /requires trimmedFieldValue/);
});

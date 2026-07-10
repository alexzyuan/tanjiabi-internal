import assert from "node:assert/strict";
import test from "node:test";

async function loadUiComponents() {
  const moduleUrl = new URL("../assets/js/ui-components.js", import.meta.url);
  moduleUrl.search = `?test=${Date.now()}-${Math.random()}`;
  return import(moduleUrl.href);
}

test("ui components clamp and expose accessible progress props", async () => {
  const components = await loadUiComponents();
  const html = components.renderKpiProgress({
    value: 155.4,
    tone: "green",
    label: "销售达成率 155%",
  });

  assert.match(html, /class="kpi-progress kpi-progress--green"/);
  assert.match(html, /style="--progress:100\.00%"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-label="销售达成率 155%"/);
  assert.match(html, /aria-valuenow="100"/);
});

test("ui components render meter bars with tone class and escaped labels", async () => {
  const components = await loadUiComponents();
  const html = components.renderMeterBar({
    value: 25,
    max: 100,
    tone: "danger",
    label: "未付 <金额>",
  });

  assert.match(html, /class="ui-meter ui-meter--danger"/);
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-label="未付 &lt;金额&gt;"/);
  assert.match(html, /style="--ui-meter-value:25\.00%"/);
});

test("ui components map chart buckets to reusable classes", async () => {
  const components = await loadUiComponents();

  assert.equal(
    components.chartBucketClass("91_180", 1),
    "chart-bucket chart-bucket--91-180 chart-bucket--2",
  );
  assert.match(
    components.renderChartSwatch({ key: "271_plus", index: 3, label: "271天以上" }),
    /class="bucket-dot chart-bucket chart-bucket--271-plus chart-bucket--4"/,
  );
});

test("ui components configure modal dialog semantics", async () => {
  const components = await loadUiComponents();
  const attrs = [];
  const dialog = {
    setAttribute(name, value) {
      attrs.push([name, value]);
    },
  };
  const modal = {
    querySelector(selector) {
      return selector === "article" ? dialog : null;
    },
  };

  const result = components.configureModalElement(modal, { labelledBy: "modal-title", describedBy: "modal-note" });

  assert.equal(result.modal, modal);
  assert.equal(result.dialog, dialog);
  assert.deepEqual(attrs, [
    ["role", "dialog"],
    ["aria-modal", "true"],
    ["aria-labelledby", "modal-title"],
    ["aria-describedby", "modal-note"],
  ]);
});

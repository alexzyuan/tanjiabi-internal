import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractNavigationModules,
  extractViewIds,
  validateFrontendIntegrity,
} from "../scripts/deploy-integrity.js";

test("deploy integrity extracts every sidebar module from index.html", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const modules = extractNavigationModules(html);
  const views = extractViewIds(html);

  assert.ok(modules.length >= 25, "expected all sidebar modules, not a short smoke-test subset");
  assert.equal(modules[0].view, "home");
  assert.equal(modules[0].label, "首页");
  assert.equal(modules.find((module) => module.view === "fba-freight")?.group, "物流");
  assert.equal(modules.find((module) => module.view === "webhook-assistant")?.permission, "admin");
  assert.equal(modules.find((module) => module.view === "webhook-assistant")?.hidden, true);

  for (const module of modules) {
    assert.ok(views.includes(module.view), `missing view container for ${module.view}`);
  }
});

test("deploy integrity rejects missing sidebar modules and missing view containers", () => {
  const expected = [
    { view: "home", label: "首页", group: "首页", hidden: false, permission: "" },
    { view: "fba-freight", label: "FBA货件处理", group: "物流", hidden: false, permission: "" },
  ];
  const brokenHtml = `
    <nav class="nav">
      <button class="nav-item" data-view="home"><span class="nav-label">首页</span></button>
    </nav>
    <section class="view" id="view-home"></section>
  `;

  const result = validateFrontendIntegrity(brokenHtml, expected);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("缺少导航板块：物流 / FBA货件处理")));
  assert.ok(result.errors.some((error) => error.includes("缺少页面容器：view-fba-freight")));
});

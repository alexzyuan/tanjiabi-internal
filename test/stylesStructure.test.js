import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import nodeTest from "node:test";
import { inferTableColumnKind } from "../assets/js/data-table-manager.js";
import { isRepositoryMetadataPath } from "../src/utils/pathFilters.js";
import { minifyCss } from "../scripts/lib/minifyCss.js";

const cssLayerOrder = ["tokens", "base", "layout", "components", "pages", "legacy", "final"];

async function listCssFiles(dirUrl) {
  let entries = [];
  try {
    entries = await readdir(dirUrl, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = await Promise.all(entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => {
      const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
      if (isRepositoryMetadataPath(childUrl.pathname)) return [];
      if (entry.isDirectory()) return listCssFiles(childUrl);
      return entry.isFile() && entry.name.endsWith(".css") ? [childUrl] : [];
    }));
  return files.flat();
}

const test = nodeTest;

function countMinifyCssDefinitions(source) {
  return (source.match(new RegExp("function\\s+minifyCss", "g")) || []).length;
}

function plainTextFromHtml(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableHeadersById(indexSource) {
  const tables = new Map();
  for (const match of indexSource.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const id = match[1].match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const headers = Array.from(match[2].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi), (headerMatch) => plainTextFromHtml(headerMatch[1]));
    if (headers.length) tables.set(id, headers);
  }
  return tables;
}

function leftAlignedDataColumnSelectors(cssSource) {
  const selectors = [];
  for (const match of cssSource.matchAll(/([^{}]+)\{([^{}]*text-align\s*:\s*left[^{}]*)\}/g)) {
    for (const selector of match[1].split(",")) {
      const normalized = selector.trim().replace(/\s+/g, " ");
      const selectorMatch = normalized.match(/#([A-Za-z][\w-]*)[\s\S]*\btd:nth-child\((\d+)\)/);
      if (!selectorMatch || normalized.includes(":not(.table-cell--number)")) continue;
      selectors.push({
        id: selectorMatch[1],
        columnIndex: Number(selectorMatch[2]),
        selector: normalized,
      });
    }
  }
  return selectors;
}

function pageTableBaselineAlignmentSelectors(cssSource) {
  const selectors = [];
  for (const match of cssSource.matchAll(/([^{}]+)\{([^{}]*text-align\s*:\s*(?:left|right)[^{}]*)\}/g)) {
    for (const selector of match[1].split(",")) {
      const normalized = selector.trim().replace(/\s+/g, " ");
      if (!/\b[td]h\b/.test(normalized)) continue;
      if (normalized.includes(".review-rating-table")) continue;
      selectors.push(normalized);
    }
  }
  return selectors;
}

function pageFilterBaselineOverrides(cssSource) {
  const overrides = [];
  const source = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");
  const filterSelectorPattern = /(?:^|[\s.#])(?:[A-Za-z0-9_-]+-)?filters\b|filter-toolbar|budget-toolbar|fba-freight-toolbar|date-range-control|date-range-button/;
  const forbiddenDeclarationPattern = /\b(?:display|grid-template(?:-columns|-rows)?|gap|column-gap|row-gap|padding|border|border-color|border-radius|min-height|height|width|flex|align-items|box-shadow|outline|font)\s*:/;

  for (const match of source.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const body = match[2].trim().replace(/\s+/g, " ");
    if (!forbiddenDeclarationPattern.test(body)) continue;

    for (const selector of match[1].split(",")) {
      const normalized = selector.trim().replace(/\s+/g, " ");
      if (!filterSelectorPattern.test(normalized)) continue;
      if (normalized === "#sales-global-filters[hidden]" && /display\s*:\s*none\s*!important/.test(body)) continue;
      if (normalized === "body:not(.sales-view) #sales-global-filters" && /display\s*:\s*none\s*!important/.test(body)) continue;
      overrides.push(`${normalized} { ${body} }`);
    }
  }
  return overrides;
}

test("styles.css keeps semantic token roots consolidated", async () => {
  const source = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const tokenSource = await readFile(new URL("../assets/css/tokens/00-semantic-foundation.css", import.meta.url), "utf8");
  const compatibilitySource = await readFile(new URL("../assets/css/tokens/10-legacy-compatibility.css", import.meta.url), "utf8");
  const baseSource = await readFile(new URL("../assets/css/base/00-reset.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");
  assert.match(tokenSource, /^\/\* Adobe Spectrum semantic foundation for the current native UI\. \*\//m);
  assert.equal((source.match(/:root\{/g) || []).length, 2);
  assert.ok(
    source.indexOf("--spectrum-background-base") < source.indexOf("--blue-950"),
    "semantic tokens should precede legacy compatibility aliases",
  );
  assert.match(tokenSource, /--tj-action-blue:\s*var\(--spectrum-accent-background\)/);
  assert.match(compatibilitySource, /--tj-brand:\s*var\(--tj-action-blue\)/);
  assert.match(baseSource, /^\*\s*\{\s*box-sizing:\s*border-box;/m);
  assert.match(baseSource, /^\[hidden\]\s*\{/m);
  assert.match(baseSource, /^body\s*\{/m);
  assert.equal(legacySource.includes("Adobe Spectrum semantic foundation"), false);
  assert.equal(/^:root\s*\{/m.test(legacySource), false);
  assert.equal(/^\*\s*\{/m.test(legacySource), false);
  assert.equal(/^\[hidden\]\s*\{/m.test(legacySource), false);
});

test("styles.css does not add account trigger background patches after shell lock", async () => {
  const source = await readFile(new URL("../assets/css/layout/10-shell.css", import.meta.url), "utf8");
  const shellLockIndex = source.indexOf("20260522 EOF shell interaction lock");
  assert.notEqual(shellLockIndex, -1, "missing shell interaction lock marker");
  const tail = source.slice(shellLockIndex);

  assert.equal(
    /account-trigger[\s\S]*account-menu\.is-open \.account-trigger[\s\S]*background:\s*var\(--tj-user-blue-bg\)/.test(tail),
    false,
    "account trigger final background should live in the main topbar rule, not a later patch block",
  );
});

test("styles.css keeps brand blue behind semantic tokens", async () => {
  const source = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const normalizedSource = source.replace("--spectrum-accent-background:#1677ff;", "");

  assert.equal(
    /#(?:1677ff|2563eb|0b66d8|168bff|31e3fd)\b/i.test(normalizedSource),
    false,
    "brand blue values should use --tj-action-blue or Spectrum semantic tokens",
  );
});

test("styles.css is generated from layered CSS sources", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["build:css"], "node scripts/build-styles.js");
  assert.match(packageJson.scripts.check, /npm run build:css -- --check/);

  const buildScript = await readFile(new URL("../scripts/build-styles.js", import.meta.url), "utf8");
  for (const layer of cssLayerOrder) {
    assert.match(buildScript, new RegExp(`"${layer}"`));
    await readdir(new URL(`../assets/css/${layer}/`, import.meta.url));
  }

  const sourceFiles = (await Promise.all(cssLayerOrder.map((layer) => (
    listCssFiles(new URL(`../assets/css/${layer}/`, import.meta.url))
  )))).flat();
  assert.ok(sourceFiles.length > 0, "missing layered CSS source files");

  const generated = minifyCss((await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n\n"));
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.equal(styles, generated, "styles.css must match npm run build:css output");
});

test("build-styles supports non-destructive preview output", async () => {
  const source = await readFile(new URL("../scripts/build-styles.js", import.meta.url), "utf8");
  assert.match(source, /--output/);
  assert.match(source, /outputPath/);
});

test("CSS minifier has a single shared implementation", async () => {
  const buildScript = await readFile(new URL("../scripts/build-styles.js", import.meta.url), "utf8");
  const structureTest = await readFile(new URL("./stylesStructure.test.js", import.meta.url), "utf8");
  const minifier = await readFile(new URL("../scripts/lib/minifyCss.js", import.meta.url), "utf8");

  assert.match(buildScript, /scripts\/lib\/minifyCss\.js|\.\/lib\/minifyCss\.js/);
  assert.match(structureTest, /scripts\/lib\/minifyCss\.js|\.\.\/scripts\/lib\/minifyCss\.js/);
  assert.equal(countMinifyCssDefinitions(buildScript), 0);
  assert.equal(countMinifyCssDefinitions(structureTest), 0);
  assert.equal(countMinifyCssDefinitions(minifier), 1);
});

test("styles.css stays within the raw size budget", async () => {
  const { size } = await stat(new URL("../styles.css", import.meta.url));
  assert.ok(size <= 256_000, `styles.css should be <= 256KB raw, got ${size} bytes`);
});

test("CSS standards gate is part of the default check command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const gateSource = await readFile(new URL("../scripts/check-css-standards.js", import.meta.url), "utf8");

  assert.match(packageJson.scripts.check, /node scripts\/check-css-standards\.js/);
  assert.match(gateSource, /remove !important/);
  assert.match(gateSource, /replace hardcoded colors/);
  assert.match(gateSource, /avoid decorative gradients/);
});

test("shared module primitives live outside legacy css", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/20-module-primitives.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\.module-hero\s*\{/m);
  assert.match(componentSource, /^\.module-grid\s*\{/m);
  assert.match(componentSource, /^\.metric-tile\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-text-muted\)/);
  assert.equal(componentSource.includes("#526176"), false);
  assert.equal(componentSource.includes("#d8e4f0"), false);

  assert.equal(legacySource.includes(".module-hero {\n  display: flex;"), false);
  assert.equal(legacySource.includes(".module-grid {\n  display: grid;"), false);
  assert.equal(legacySource.includes(".metric-tile {\n  min-height: 96px;"), false);
});

test("shared filters and panel surfaces live outside legacy css", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/30-surfaces-and-filters.css", import.meta.url), "utf8");
  const layoutSource = await readFile(new URL("../assets/css/layout/10-shell.css", import.meta.url), "utf8");
  const applicationOverrideSource = await readFile(new URL("../assets/css/components/48-application-ui-overrides.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\.filters\s*\{/m);
  assert.match(componentSource, /display:\s*flex/);
  assert.match(componentSource, /^\.filters\s*\{[\s\S]*column-gap:\s*8px;[\s\S]*row-gap:\s*8px;[\s\S]*border:\s*0;[\s\S]*\}/m);
  assert.match(componentSource, /^\.filters label:has\(\.date-range-control\)\s*\{/m);
  assert.match(componentSource, /^\.filters \.checkbox-label\s*\{/m);
  assert.match(componentSource, /^\.filters \.filter-dropdown-menu\s*\{/m);
  assert.match(componentSource, /^\.filters select\.enhanced-filter-select\s*\{/m);
  assert.match(componentSource, /^\.panel\s*\{/m);
  assert.match(componentSource, /^\.panel-head\s*\{/m);
  assert.match(componentSource, /^\.form-span-2\s*\{/m);
  assert.match(componentSource, /^\.table-wrap\s*\{/m);
  assert.match(componentSource, /^\.table-scroll\s*\{/m);
  assert.match(componentSource, /^\.upload-status\s*\{/m);
  assert.match(componentSource, /^\.empty-state\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-border-subtle\)/);
  assert.match(componentSource, /var\(--tj-text-muted\)/);
  assert.equal(componentSource.includes("#d8e4f0"), false);
  assert.equal(componentSource.includes("#fbfdff"), false);
  assert.equal(componentSource.includes("background: white"), false);
  assert.equal(layoutSource.includes("filters"), false);
  assert.equal(applicationOverrideSource.includes("body:not(.login-body) .filters"), false);

  assert.equal(/^\.filters\s*\{/m.test(legacySource), false);
  assert.equal(/^\.filters,/m.test(legacySource), false);
  assert.equal(/^\.filters label,/m.test(legacySource), false);
  assert.equal(legacySource.includes(".filters {\n  display: grid;"), false);
  assert.equal(legacySource.includes(".panel {\n  padding: 18px;"), false);
  assert.equal(legacySource.includes(".panel-head {\n  display: flex;"), false);
  assert.equal(legacySource.includes(".form-span-2 {"), false);
  assert.equal(legacySource.includes(".table-wrap {\n  overflow: auto;"), false);
  assert.equal(legacySource.includes(".table-scroll {"), false);
  assert.equal(legacySource.includes(".table-scroll table"), false);
  assert.equal(legacySource.includes(".upload-status {"), false);
  assert.equal(legacySource.includes(".empty-state {\n  min-height:"), false);
});

test("shared visual component tokens normalize controls, tables, and modals", async () => {
  const tokenSource = await readFile(new URL("../assets/css/tokens/00-semantic-foundation.css", import.meta.url), "utf8");
  const surfacesSource = await readFile(new URL("../assets/css/components/30-surfaces-and-filters.css", import.meta.url), "utf8");
  const formSource = await readFile(new URL("../assets/css/components/32-form-controls.css", import.meta.url), "utf8");
  const tableSource = await readFile(new URL("../assets/css/components/45-table-controls.css", import.meta.url), "utf8");
  const modalSource = await readFile(new URL("../assets/css/components/55-modal-shell.css", import.meta.url), "utf8");

  [
    "--tj-control-height",
    "--tj-control-height-compact",
    "--tj-control-radius",
    "--tj-control-padding-x",
    "--tj-panel-radius",
    "--tj-table-row-hover-bg",
    "--tj-modal-radius",
    "--tj-focus-ring",
  ].forEach((token) => {
    assert.match(tokenSource, new RegExp(`${token}:`));
  });

  assert.match(surfacesSource, /height:\s*var\(--tj-control-height-compact\)/);
  assert.match(surfacesSource, /border-radius:\s*var\(--tj-control-radius\)/);
  assert.match(formSource, /height:\s*var\(--tj-control-height\)/);
  assert.match(formSource, /box-shadow:\s*var\(--tj-focus-ring\)/);
  assert.match(tableSource, /height:\s*var\(--tj-control-height-compact\)/);
  assert.match(tableSource, /background:\s*var\(--tj-table-row-hover-bg\)/);
  assert.match(modalSource, /border-radius:\s*var\(--tj-modal-radius\)/);
  assert.match(modalSource, /\.modal-close-button:focus-visible/);
});

test("shared filter toolbar styles live outside page css and use semantic tokens", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/35-filter-toolbar.css", import.meta.url), "utf8");
  const budgetPageSource = await readFile(new URL("../assets/css/pages/30-budget-targets.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(indexSource, /class="filter-toolbar budget-toolbar"/);
  assert.match(indexSource, /class="filter-toolbar fba-freight-toolbar"/);
  assert.match(componentSource, /^\/\* Shared compact filter toolbar\. \*\//m);
  assert.match(componentSource, /^\.filter-toolbar\s*\{/m);
  assert.match(componentSource, /^\.filter-toolbar\s*\{[\s\S]*column-gap:\s*8px;[\s\S]*row-gap:\s*8px;[\s\S]*border:\s*0;[\s\S]*\}/m);
  assert.match(componentSource, /^\.filter-toolbar label\s*\{/m);
  assert.match(componentSource, /^\.filter-toolbar label:has\(\.date-range-control\)\s*\{/m);
  assert.match(componentSource, /^\.filter-toolbar \.date-range-control\s*\{/m);
  assert.match(componentSource, /^\.filter-toolbar input,/m);
  assert.match(componentSource, /^\.filter-toolbar > :where\(input, select\)\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-text-body\)/);
  assert.equal(/^\.budget-toolbar\s*\{/m.test(budgetPageSource), false);
  assert.equal(legacySource.includes(".budget-toolbar {"), false);
});

test("banner-adjacent filters use shared sticky positioning below the topbar", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/30-surfaces-and-filters.css", import.meta.url), "utf8");
  const salesPageSource = await readFile(new URL("../assets/css/pages/22-sales-dashboard.css", import.meta.url), "utf8");
  const designSource = await readFile(new URL("../design.md", import.meta.url), "utf8");
  const agentsSource = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");

  assert.match(componentSource, /^body:not\(\.login-body\) \.view > \.module-hero \+ :is\(\.filters, \.filter-toolbar\)\s*\{/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.view > \.module-hero \+ :is\(\.filters, \.filter-toolbar\)\s*\{[\s\S]*?position:\s*sticky/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.view > \.module-hero \+ :is\(\.filters, \.filter-toolbar\)\s*\{[\s\S]*?top:\s*var\(--tj-topbar-fixed-height\)/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.view > \.module-hero \+ :is\(\.filters, \.filter-toolbar\)\s*\{[\s\S]*?z-index:\s*900/m);
  assert.equal(/body\.sales-view #sales-global-filters\s*\{[\s\S]*?position:\s*sticky/m.test(salesPageSource), false);
  assert.match(designSource, /当 \.filters 或 \.filter-toolbar 紧跟 \.module-hero 后面时/);
  assert.match(agentsSource, /banner 后紧跟 \.filters 或 \.filter-toolbar/);
});

test("page css does not override shared filter toolbar baseline", async () => {
  const pageFiles = await listCssFiles(new URL("../assets/css/pages/", import.meta.url));
  const violations = [];
  for (const fileUrl of pageFiles) {
    const source = await readFile(fileUrl, "utf8");
    const relativePath = fileUrl.pathname.replace(/^.*\/assets\/css\//, "assets/css/");
    for (const override of pageFilterBaselineOverrides(source)) {
      violations.push(`${relativePath}: ${override}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("shared date range picker styles live outside page css and use semantic tokens", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/36-date-range-picker.css", import.meta.url), "utf8");
  const salesPageSource = await readFile(new URL("../assets/css/pages/22-sales-dashboard.css", import.meta.url), "utf8");
  const fbaPageSource = await readFile(new URL("../assets/css/pages/35-fba-freight.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(indexSource, /id="front-date-range-button" class="date-range-button date-range-picker__trigger"/);
  assert.match(indexSource, /id="fba-freight-date-range-button" class="date-range-button date-range-picker__trigger"/);
  assert.match(componentSource, /^\.date-range-control\s*\{/m);
  assert.match(componentSource, /^\.date-range-button\s*\{/m);
  assert.equal(componentSource.includes(".date-range-button::after"), false);
  assert.match(componentSource, /^\.date-range-picker__popover\s*\{/m);
  assert.match(componentSource, /width:\s*min\(760px,\s*96vw\)/);
  assert.match(componentSource, /grid-template-columns:\s*112px minmax\(0,\s*1fr\)/);
  assert.match(componentSource, /\.date-range-picker__popover\s*\{[\s\S]*font-size:\s*13px;[\s\S]*\}/);
  assert.match(componentSource, /^\.date-range-picker__shortcuts\s*\{/m);
  assert.match(componentSource, /^\.date-range-picker__shortcuts button:is\(:hover, :focus-visible\)\s*\{/m);
  assert.match(componentSource, /^\.date-range-picker__months\s*\{/m);
  assert.match(componentSource, /^\.date-range-picker__day\.is-selected,/m);
  assert.match(componentSource, /\.date-range-picker__day\.is-preview-end/);
  assert.match(componentSource, /^\.date-range-picker__day:is\(\.is-today, \.is-selected, \.is-preview-end\)\s*\{/m);
  assert.match(componentSource, /^\.date-range-picker__day\.is-today:not\(\.is-selected\)\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-action-blue\)/);
  assert.match(componentSource, /var\(--tj-focus-ring\)/);

  [
    /^\.date-range-control\s*\{/m,
    /^\.date-range-button\s*\{/m,
    /^\.date-range-popover\s*\{/m,
    /^\.date-presets\s*\{/m,
    /^\.date-range-fields\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(salesPageSource), false, `${selectorPattern} should be owned by shared date range picker CSS`);
    assert.equal(selectorPattern.test(fbaPageSource), false, `${selectorPattern} should be owned by shared date range picker CSS`);
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should stay out of legacy css`);
  });
});

test("shared status pill styles live outside legacy css and use semantic tokens", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/40-status-pill.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\/\* Shared status badges\./m);
  assert.match(componentSource, /^\.status-pill\s*\{/m);
  assert.match(componentSource, /^\.status-pill\.active,/m);
  assert.match(componentSource, /^\.status-pill\.pending,/m);
  assert.match(componentSource, /^\.status-pill\.disabled,/m);
  assert.match(componentSource, /^\.status-pill\.rejected,/m);
  assert.match(componentSource, /^\.status-pill\.info,/m);
  assert.match(componentSource, /^\.risk-badge\s*\{/m);
  assert.match(componentSource, /^\.risk-high\s*\{/m);
  assert.match(componentSource, /^\.risk-mid\s*\{/m);
  assert.match(componentSource, /^\.risk-low\s*\{/m);
  assert.match(componentSource, /var\(--tj-tone-success-bg\)/);
  assert.match(componentSource, /var\(--tj-tone-warning-bg\)/);
  assert.match(componentSource, /var\(--tj-tone-danger-bg\)/);
  assert.match(componentSource, /var\(--tj-tone-neutral-bg\)/);
  assert.match(componentSource, /var\(--tj-tone-info-bg\)/);
  assert.equal(/#(?:087443|e7f8ef|9a5b00|fff4d6|667085|eef2f6|b42318|fee4e2|344054|eef2f7|c8f1fb|ffe6c2|d7e4ff|ffe0e0|edf0f4|7c8ca3|d92d20|f28c28|fff1a8|7a4b00|ffd166|ffe9e7|fff1df|d96b00|eaf4ff|1262bd)\b/i.test(componentSource), false);

  assert.equal(legacySource.includes(".status-pill {"), false);
  assert.equal(legacySource.includes(".status-pill.active"), false);
  assert.equal(legacySource.includes(".status-pill.info"), false);
  assert.equal(legacySource.includes(".risk-badge {"), false);
  assert.equal(legacySource.includes(".risk-high {"), false);
  assert.equal(legacySource.includes(".risk-mid {"), false);
  assert.equal(legacySource.includes(".risk-low {"), false);
  assert.equal((generatedSource.match(/^\.status-pill\s*\{/gm) || []).length, 1);
  assert.equal((generatedSource.match(/^\.risk-badge\s*\{/gm) || []).length, 1);
});

test("shared table controls live outside legacy css and use semantic tokens", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/45-table-controls.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\/\* Shared table baseline, states, and row controls\. \*\//m);
  assert.match(componentSource, /^\.data-table-wrap\s*\{/m);
  assert.match(componentSource, /^table\.data-table\s*\{/m);
  assert.match(componentSource, /^table\.data-table--matrix\s*\{/m);
  assert.match(componentSource, /^table\.data-table\.is-smart-width\s*\{/m);
  assert.match(componentSource, /table\.data-table :is\(th, td\)\s*\{[\s\S]*?border:\s*1px solid var\(--tj-border-subtle\)/);
  assert.match(componentSource, /width:\s*max\(100%,\s*var\(--tj-table-resolved-width/);
  assert.match(componentSource, /\[data-width-align="right"\]/);
  assert.match(componentSource, /\[data-width-align="center"\]/);
  assert.match(componentSource, /\[data-width-profile="identifier"\]/);
  assert.match(componentSource, /\[data-width-profile="narrative"\]/);
  assert.match(componentSource, /^\.table-resize-handle\s*\{/m);
  assert.match(componentSource, /^\.table-width-reset\s*\{/m);
  assert.match(componentSource, /^\.table-width-reset:hover\s*\{/m);
  assert.match(componentSource, /^\.table-width-reset:focus-visible\s*\{/m);
  assert.match(componentSource, /^\.table-width-reset\[hidden\]\s*\{/m);
  assert.match(componentSource, /^\.table-state-cell--error\s*\{/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.table-select\s*\{/m);
  assert.match(componentSource, /^\.table-action\s*\{/m);
  assert.match(componentSource, /^\.table-action\.danger\s*\{/m);
  assert.match(componentSource, /^\.table-actions\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-action-blue\)/);
  assert.match(componentSource, /var\(--tj-tone-danger-strong\)/);
  assert.equal(/#(?:fff|ffffff|142033|1d6ff2|d92d20|e6edf7)\b/i.test(componentSource), false);

  assert.equal(legacySource.includes(".table-select {"), false);
  assert.equal(legacySource.includes(".table-action {"), false);
  assert.equal(legacySource.includes(".table-action.danger"), false);
  assert.equal(legacySource.includes(".table-actions {"), false);
  assert.equal(legacySource.includes("body:not(.login-body) .table-action"), false);
  assert.equal(/^table\s*\{/m.test(legacySource), false, "legacy must not own the global table baseline");
  assert.equal(/^th\s*\{/m.test(legacySource), false, "legacy must not own global table headers");
  assert.equal(
    /body:not\(\.login-body\)\s+\.sales-review-detail-table-wrap\s+td\s*\{[\s\S]*?text-align:\s*left\s*!important/.test(legacySource),
    false,
    "sales review detail cells must not force every td left; numeric cells need to inherit shared right alignment",
  );
  assert.equal((generatedSource.match(/body:not\(\.login-body\) \.table-select\{/g) || []).length, 1);
  assert.equal((generatedSource.match(/\.table-action\{/g) || []).length, 1);
});

test("page styles do not override shared smart table widths", async () => {
  const pageFiles = await listCssFiles(new URL("../assets/css/pages/", import.meta.url));
  const violations = [];

  for (const file of pageFiles) {
    const source = await readFile(file, "utf8");
    if (source.includes("--tj-table-min-width")) violations.push(file.pathname);
  }

  assert.deepEqual(violations, [], `page table min-width overrides must move to the shared manager: ${violations.join(", ")}`);

  const salesForecastSource = await readFile(new URL("../assets/css/pages/25-sales-forecast.css", import.meta.url), "utf8");
  const fbaFreightSource = await readFile(new URL("../assets/css/pages/35-fba-freight.css", import.meta.url), "utf8");
  assert.equal(/\.sales-forecast-table \.sticky-(?:focus|hide|image|store|country|product|msku)\s*\{[^}]*\b(?:min-)?width:/s.test(salesForecastSource), false);
  assert.equal(/\.sales-forecast-table \.(?:compact-number-col|compact-date-col|month-daily-col|month-sales-col)\s*\{[^}]*\b(?:min-)?width:/s.test(salesForecastSource), false);
  assert.equal(/\.fba-freight-table th:nth-child\([^)]*\)[^{]*\{[^}]*\b(?:min-)?width:/s.test(fbaFreightSource), false);
});

test("shared table variants replace responsive page and legacy table patches", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/45-table-controls.css", import.meta.url), "utf8");
  const factorySource = await readFile(new URL("../assets/css/pages/52-factory-inventory.css", import.meta.url), "utf8");
  const salesForecastSource = await readFile(new URL("../assets/css/pages/25-sales-forecast.css", import.meta.url), "utf8");
  const supplierBoardSource = await readFile(new URL("../assets/css/pages/53-supplier-board.css", import.meta.url), "utf8");
  const supplierDetailSource = await readFile(new URL("../assets/css/pages/54-supplier-detail.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^table\.data-table--middle :is\(th, td\)\s*\{/m);
  assert.match(componentSource, /^\.data-table-wrap--detail\s*\{/m);
  assert.match(componentSource, /^table\.data-table--detail th\s*\{/m);
  assert.match(indexSource, /class="table-wrap data-table-wrap--detail"/);
  assert.match(indexSource, /class="data-table data-table--detail"/);
  assert.equal((indexSource.match(/class="[^"]*data-table--middle[^"]*"/g) || []).length, 4);
  assert.equal(/\.app-shell\s*\{[\s\S]*?min-width:\s*1180px/s.test(factorySource), false);
  assert.equal(/\.dashboard\s*\{[\s\S]*?min-width:\s*1000px/s.test(factorySource), false);
  assert.equal(/\.sales-forecast-table \.sticky-(?:focus|hide|image)\s*\{[\s\S]*?text-align:/s.test(salesForecastSource), false);
  assert.equal(/#supplier-board-table th,[\s\S]*?#supplier-board-table td\s*\{[\s\S]*?vertical-align:/s.test(supplierBoardSource), false);
  assert.equal(/#supplier-detail-table th,[\s\S]*?#supplier-detail-table td\s*\{[\s\S]*?vertical-align:/s.test(supplierDetailSource), false);
  assert.equal(/#factory-inventory-table th,[\s\S]*?#factory-inventory-table td\s*\{[\s\S]*?vertical-align:/s.test(factorySource), false);
  assert.equal(legacySource.includes("sales-review-detail-table-wrap"), false);
});

test("final table invariants layer locks product table alignment after page css", async () => {
  const buildScript = await readFile(new URL("../scripts/build-styles.js", import.meta.url), "utf8");
  const finalSource = await readFile(new URL("../assets/css/final/90-table-invariants.css", import.meta.url), "utf8");

  assert.match(buildScript, /"legacy",\s*"final"/);
  assert.match(finalSource, /^\/\* Final product table invariants\./m);
  assert.match(finalSource, /^table\.data-table td\.table-cell--number\s*\{/m);
  assert.match(finalSource, /text-align:\s*right/);
  assert.match(finalSource, /font-variant-numeric:\s*tabular-nums/);
  assert.match(finalSource, /^\.table-state-row td,/m);
  assert.match(finalSource, /^\.table-resize-handle\s*\{/m);
});

test("page table alignment overrides do not target numeric data columns", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const headersById = tableHeadersById(indexSource);
  const sourceFiles = (await Promise.all(cssLayerOrder.map((layer) => (
    listCssFiles(new URL(`../assets/css/${layer}/`, import.meta.url))
  )))).flat();
  const violations = [];

  for (const file of sourceFiles) {
    const cssSource = await readFile(file, "utf8");
    for (const entry of leftAlignedDataColumnSelectors(cssSource)) {
      const headers = headersById.get(entry.id);
      const label = headers?.[entry.columnIndex - 1];
      if (!label || inferTableColumnKind(label) !== "number") continue;
      violations.push(`${file.pathname}:${entry.selector} targets numeric column ${entry.columnIndex} (${label})`);
    }
  }

  assert.deepEqual(violations, []);
});

test("page css does not redeclare shared table baseline alignment", async () => {
  const sourceFiles = [
    ...(await listCssFiles(new URL("../assets/css/pages/", import.meta.url))),
    new URL("../assets/css/legacy/current.css", import.meta.url),
  ];
  const violations = [];

  for (const file of sourceFiles) {
    const cssSource = await readFile(file, "utf8");
    for (const selector of pageTableBaselineAlignmentSelectors(cssSource)) {
      violations.push(`${file.pathname}:${selector}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("shared dashboard data primitives live outside legacy css and use semantic tokens", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/34-dashboard-data-primitives.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\/\* Shared dashboard grids, lists, chart labels, and table affordances\. \*\//m);
  assert.match(componentSource, /^\.metric-grid\s*\{/m);
  assert.match(componentSource, /^\.summary-strip\s*\{/m);
  assert.match(componentSource, /^\.action-list,/m);
  assert.match(componentSource, /^\.anomaly-list div\s*\{/m);
  assert.match(componentSource, /^\.sort-button\s*\{/m);
  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-subtle\)/);
  assert.match(componentSource, /var\(--tj-text-muted\)/);
  assert.equal(/#(?:526176|d8e4f0|f8fbff|9aa6b5)\b/i.test(componentSource), false);

  [
    ".metric-grid {",
    ".summary-strip {",
    ".action-list,",
    ".anomaly-list {",
    ".sort-button {",
    ".image-placeholder {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/components/34-dashboard-data-primitives.css`);
  });
});

test("application-wide UI overrides live in components, not shell or legacy css", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/48-application-ui-overrides.css", import.meta.url), "utf8");
  const layoutSource = await readFile(new URL("../assets/css/layout/10-shell.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  [
    "Application-wide component density and surface overrides",
    "body:not(.login-body) table",
    "body:not(.login-body) table.data-table th.table-sort-active",
    "body:not(.login-body) .table-wrap",
    "body:not(.login-body) .module-grid",
    "body:not(.login-body) .payable-dashboard-grid",
  ].forEach((snippet) => {
    assert.ok(componentSource.includes(snippet), `${snippet} should be owned by assets/css/components/48-application-ui-overrides.css`);
  });

  assert.match(componentSource, /var\(--tj-content-bg\)/);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-action-blue\)/);
  assert.equal(/#(?:102039|d8e8f6|ecf7ff|dff0ff|0d213b|1d5cff|e1ebf5)\b/i.test(componentSource), false);
  assert.equal(/rgba\(255,\s*255,\s*255,\s*0\.96\)/i.test(componentSource), false);

  [
    "body:not(.login-body) table {",
    "body:not(.login-body) th.table-sort-active",
    "body:not(.login-body) .table-wrap",
    "body:not(.login-body) .module-grid",
    "body:not(.login-body) .payable-dashboard-grid",
  ].forEach((snippet) => {
    assert.equal(layoutSource.includes(snippet), false, `${snippet} should stay out of assets/css/layout/10-shell.css`);
    assert.equal(legacySource.includes(snippet), false, `${snippet} should stay out of assets/css/legacy/current.css`);
  });
});

test("shared dashboard loading overlay lives outside page css and legacy css", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/48-application-ui-overrides.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");
  const pageSources = await Promise.all(
    (await listCssFiles(new URL("../assets/css/pages/", import.meta.url))).map((fileUrl) => readFile(fileUrl, "utf8")),
  );

  assert.match(componentSource, /^\.dashboard-loading-overlay\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-spinner\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-target\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-copy\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-progress\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-progress-bar\s*\{/m);
  assert.match(componentSource, /^\.dashboard-loading-percent\s*\{/m);
  assert.match(componentSource, /^@keyframes dashboard-loading-spin\s*\{/m);
  assert.match(componentSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.dashboard-loading-spinner\s*\{[\s\S]*?animation:\s*none/);
  assert.doesNotMatch(componentSource.match(/^\.dashboard-loading-overlay\s*\{([\s\S]*?)\n\}/m)?.[1] || "", /position:\s*fixed/);
  assert.equal(legacySource.includes("dashboard-loading-overlay"), false);
  assert.equal(pageSources.some((source) => source.includes("dashboard-loading-overlay")), false);
});

test("shared form and multi-select controls live outside legacy css", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/32-form-controls.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\/\* Shared native form layouts, secondary actions, and multi-select controls\. \*\//m);
  assert.match(componentSource, /^\.form-grid\s*\{/m);
  assert.match(componentSource, /^\.multi-select\s*\{/m);
  assert.match(componentSource, /^\.multi-select-button\s*\{/m);
  assert.match(componentSource, /^\.multi-select-option\s*\{/m);
  assert.match(componentSource, /^\.secondary-button\s*\{/m);
  assert.match(componentSource, /var\(--tj-border-control\)/);
  assert.match(componentSource, /var\(--tj-control-radius\)/);
  assert.match(componentSource, /var\(--tj-focus-ring\)/);
  assert.equal(/#(?:d8e4f0|ffffff|f8fbff)\b/i.test(componentSource), false);

  [
    ".form-grid {",
    ".multi-select {",
    ".multi-select-button {",
    ".multi-select-option {",
    ".secondary-button {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/components/32-form-controls.css`);
  });
});

test("shared modal backdrop lives outside legacy css", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/50-modal-backdrop.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\.modal-backdrop\s*\{/m);
  assert.match(componentSource, /^\.modal-backdrop\[hidden\]\s*\{/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.modal-backdrop\s*\{/m);
  assert.match(componentSource, /@media \(max-width: 720px\)/);
  assert.match(componentSource, /z-index:\s*10000/);
  assert.equal(componentSource.includes("!important"), false);
  assert.equal(legacySource.includes(".modal-backdrop {"), false);
  assert.equal(legacySource.includes(".modal-backdrop[hidden]"), false);
  assert.equal(legacySource.includes("body:not(.login-body) .modal-backdrop"), false);
  assert.equal((generatedSource.match(/\.modal-backdrop\{/g) || []).length, 3);
  assert.equal((generatedSource.match(/body:not\(\.login-body\) \.modal-backdrop\{/g) || []).length, 1);
});

test("shared modal shell styles live outside legacy css and use semantic tokens", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../assets/css/components/55-modal-shell.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\.modal-head\s*\{/m);
  assert.match(componentSource, /^\.modal-close-button\s*\{/m);
  assert.match(componentSource, /^\.modal-body\s*\{/m);
  assert.match(componentSource, /^\.modal-tip\s*\{/m);
  assert.match(componentSource, /^\.modal-foot\s*\{/m);
  assert.match(componentSource, /^body\.modal-open\s*\{/m);
  assert.match(componentSource, /var\(--tj-border-subtle\)/);
  assert.match(componentSource, /var\(--tj-text-muted\)/);
  assert.match(componentSource, /var\(--tj-text-body\)/);
  assert.match(componentSource, /var\(--tj-action-blue-soft\)/);
  assert.equal(/#(?:98a2b3|edf5ff|344054)\b/i.test(componentSource), false);

  assert.equal(/^\.modal-head\s*\{/m.test(legacySource), false);
  assert.equal(/^\.modal-close-button\s*\{/m.test(legacySource), false);
  assert.equal(/^\.modal-body\s*\{/m.test(legacySource), false);
  assert.equal(/^\.modal-tip\s*\{/m.test(legacySource), false);
  assert.equal(/^\.modal-foot\s*\{/m.test(legacySource), false);
  assert.equal(/^body\.modal-open\s*\{/m.test(legacySource), false);
  assert.equal(legacySource.includes("body:not(.login-body) .knowledge-document-modal .modal-foot"), false);
  assert.equal((generatedSource.match(/^\.modal-foot\s*\{/gm) || []).length, 1);
});

test("obsolete FBA result log styles are removed", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");
  const fbaAutomationSource = await readFile(new URL("../assets/js/features/fba-automation.js", import.meta.url), "utf8");

  assert.equal(generatedSource.includes(".result-log"), false);
  assert.equal(legacySource.includes(".result-log"), false);
  assert.equal(fbaAutomationSource.includes("#fba-result-log"), false);
});

test("main application shell styles live in the layout layer", async () => {
  const layoutSource = await readFile(new URL("../assets/css/layout/10-shell.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(layoutSource, /^\/\* Main application shell, sidebar, topbar, and shared chrome\. \*\//m);
  assert.match(layoutSource, /body:not\(\.login-body\) \.app-shell/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.app-shell,[\s\S]*display:\s*grid/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.sidebar/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.topbar/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.topbar-breadcrumb\.module-breadcrumb/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.account-trigger/);
  assert.match(layoutSource, /body:not\(\.login-body\) \.nav-group/);
  assert.match(layoutSource, /var\(--tj-shell-bg\)/);
  assert.match(layoutSource, /var\(--tj-action-blue\)/);
  assert.match(layoutSource, /var\(--tj-text-inverse\)/);
  assert.equal(layoutSource.includes("!important"), false);
  assert.equal(layoutSource.includes("#refresh-button"), false);
  assert.equal(/#(?:ffffff|111827|1f2937|eaf4ff)\b/i.test(layoutSource), false);

  [
    /^\.app-shell\s*\{/m,
    /^\.app-shell\.sidebar-collapsed\s*\{/m,
    /^\.sidebar\s*\{/m,
    /^\.brand\s*\{/m,
    /^\.brand-mark\s*\{/m,
    /^\.brand-logo-card\s*\{/m,
    /^\.nav\s*\{/m,
    /^\.nav-group\s*\{/m,
    /^\.nav-group-title\s*\{/m,
    /^\.nav-item\s*\{/m,
    /^\.nav-icon\s*\{/m,
    /^\.topbar\s*\{/m,
    /^\.top-actions\s*\{/m,
    /^\.status-chip\s*\{/m,
    /^\.dashboard\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should be owned by assets/css/layout/10-shell.css`);
  });

  [
    "body:not(.login-body) .app-shell",
    "body:not(.login-body) .sidebar",
    "body:not(.login-body) .topbar",
    "body:not(.login-body) .world-clock",
    "body:not(.login-body) .account-trigger",
    "body:not(.login-body) .brand",
    "body:not(.login-body) .nav-group",
    "body:not(.login-body) .dashboard",
    "body:not(.login-body) .environment-warning",
    "html.os-windows body:not(.login-body) .app-shell",
    ".sidebar-flyout",
  ].forEach((selector) => {
    assert.equal(legacySource.includes(selector), false, `${selector} should be owned by assets/css/layout/10-shell.css`);
  });
});

test("login page styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/20-login.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Login page \*\//m);
  assert.match(pageSource, /^\.login-body\s*\{/m);
  assert.match(pageSource, /^\.login-switch-card\s*\{/m);
  assert.match(pageSource, /^\.login-body\.safari-dingtalk-login \.login-switch-card \.dingtalk-qr-frame\s*\{/m);
  assert.match(pageSource, /var\(--tj-text-strong\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--spectrum-accent-visual\)/);
  assert.equal(/#(?:06142e|2086ff|465368|55708d|60738d|8092ad|d7e3ef|d92d20)\b/i.test(pageSource), false);

  assert.equal(legacySource.includes(".login-body {"), false);
  assert.equal(legacySource.includes(".login-switch-card {"), false);
  assert.equal(legacySource.includes(".dingtalk-qr-frame {"), false);
  assert.equal(legacySource.includes("@keyframes login"), false);
  assert.equal(legacySource.includes("@keyframes sloganFlash"), false);
  assert.equal(legacySource.includes("safari-dingtalk-login"), false);
});

test("shared section titles live outside legacy css and use semantic tokens", async () => {
  const componentSource = await readFile(new URL("../assets/css/components/25-section-title.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(componentSource, /^\/\* Shared compact section heading\. \*\//m);
  assert.match(componentSource, /^\.section-title\s*\{/m);
  assert.match(componentSource, /^body:not\(\.login-body\) \.section-title\s*\{/m);
  assert.match(componentSource, /^\.section-title::before\s*\{/m);
  assert.match(componentSource, /var\(--tj-text-strong\)/);
  assert.match(componentSource, /var\(--tj-action-blue\)/);
  assert.equal(componentSource.includes("var(--spectrum-accent-visual)"), false);
  assert.equal(componentSource.includes("var(--blue-950)"), false);
  assert.equal(componentSource.includes("var(--blue-800)"), false);
  assert.equal(componentSource.includes("var(--teal)"), false);

  assert.equal(/^\.section-title\s*\{/m.test(legacySource), false);
  assert.equal(/^\.section-title::before\s*\{/m.test(legacySource), false);
  assert.equal(/^body:not\(\.login-body\) \.section-title\s*\{/m.test(legacySource), false);
});

test("sales dashboard overview styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/22-sales-dashboard.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Sales dashboard filter controls and overview metrics\. \*\//m);
  assert.match(pageSource, /^#sales-global-filters\[hidden\]\s*\{/m);
  assert.match(pageSource, /^\.insight-row\s*\{/m);
  assert.match(pageSource, /^\.insight-card\s*\{/m);
  assert.match(pageSource, /^\.overview-grid\s*\{/m);
  assert.match(pageSource, /^\.kpi-stack\s*\{/m);
  assert.match(pageSource, /^\.kpi-card\s*\{/m);
  assert.match(pageSource, /^\.mini-card\s*\{/m);
  assert.match(pageSource, /^@media \(max-width: 1180px\)/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--spectrum-accent-visual\)/);
  assert.equal(/#(?:d8e4f0|526176|24a148|f28c28|df3b3b|16833a|d36b08|c22929|eef3f9|42be65|ffb057|ff7b72|f7fbff|2f3c50|ff4545|67c4ff|edf3fb|e54848)\b/i.test(pageSource), false);

  [
    /^#sales-global-filters\[hidden\]\s*\{/m,
    /^\.insight-row\s*\{/m,
    /^\.insight-card\s*\{/m,
    /^\.card-title\s*\{/m,
    /^\.overview-grid\s*\{/m,
    /^\.sales-overview-grid\s*\{/m,
    /^\.kpi-stack\s*\{/m,
    /^\.kpi-card\s*\{/m,
    /^\.kpi-progress\s*\{/m,
    /^\.target-line\s*\{/m,
    /^\.mini-card\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should be owned by assets/css/pages/22-sales-dashboard.css`);
  });
});

test("sales review detail table declares stable table and column semantics", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const tableMatch = indexSource.match(/<table\b[^>]*id="sales-review-detail-table"[^>]*>([\s\S]*?)<\/table>/);
  assert.ok(tableMatch, "sales review detail table should have a stable id");
  assert.match(tableMatch[0], /\bdata-table-key="sales-review-detail"/);
  assert.match(indexSource, /id="sales-dashboard-content"/);

  const headers = Array.from(tableMatch[1].matchAll(/<th\b([^>]*)>/g), (match) => match[1]);
  assert.equal(headers.length, 18);
  headers.forEach((attributes, index) => {
    assert.match(attributes, /\bdata-column-key="/, `header ${index + 1} should declare data-column-key`);
    assert.match(attributes, /\bdata-column-kind="/, `header ${index + 1} should declare data-column-kind`);
  });
  assert.match(headers[0], /\bdata-column-profile="short-name"/);
  assert.match(headers[1], /\bdata-column-profile="identifier"/);
  assert.match(headers[2], /\bdata-column-profile="name"/);
  assert.match(tableMatch[0], /\bdata-column-key="averageProfit"[\s\S]*?平均利润/);
  assert.match(tableMatch[0], /\bdata-column-key="fbaDeliveryFeeRate"[\s\S]*?FBA占比/);
  assert.doesNotMatch(tableMatch[0], /FBA发货费占比/);
  headers.slice(3).forEach((attributes, index) => {
    assert.match(attributes, /\bdata-column-kind="number"/, `numeric header ${index + 4} should be marked as number`);
  });
});

test("store inspection dashboard styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/23-store-inspection.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Store inspection dashboard page\. \*\//m);
  assert.match(pageSource, /^\.store-inspection-actions\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-status,/m);
  assert.match(pageSource, /^\.inspection-badge-high\s*\{/m);
  assert.match(pageSource, /^\.inspection-badge-mid\s*\{/m);
  assert.match(pageSource, /^\.inspection-badge-low\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-kpis\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-workspace\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-schedule-form\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-focus\s*\{/m);
  assert.match(pageSource, /^\.inspection-focus-card\s*\{/m);
  assert.match(pageSource, /^\.store-inspection-report-output\s*\{/m);
  assert.match(pageSource, /^@media \(max-width: 1180px\)/m);
  assert.match(pageSource, /^@media \(max-width: 760px\)/m);
  assert.match(pageSource, /^@media \(max-width: 720px\)/m);
  assert.match(pageSource, /var\(--tj-text-inverse\)/);
  assert.match(pageSource, /var\(--tj-danger\)/);
  assert.match(pageSource, /var\(--tj-tone-warning-bg\)/);
  assert.match(pageSource, /var\(--tj-tone-success-bg\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-strong\)/);
  assert.match(pageSource, /var\(--spectrum-focus-ring-color\)/);
  assert.equal(/#(?:fff|ffffff|5c3600|fff4df|f5c26b|0f6b45|e4f6ed|a9dec2)\b/i.test(pageSource), false);
  assert.equal(/rgba\(38,\s*128,\s*235/.test(pageSource), false);

  [
    /^\.store-inspection-actions\s*\{/m,
    /^\.store-inspection-status,/m,
    /^\.inspection-badge-high\s*\{/m,
    /^\.inspection-badge-mid\s*\{/m,
    /^\.inspection-badge-low\s*\{/m,
    /^\.store-inspection-kpis\s*\{/m,
    /^\.store-inspection-workspace\s*\{/m,
    /^\.store-inspection-schedule-form\s*\{/m,
    /^\.store-inspection-time-field\s*\{/m,
    /^\.store-inspection-form\s*\{/m,
    /^\.store-inspection-priority\s*\{/m,
    /^\.store-inspection-checklist\s*\{/m,
    /^\.store-inspection-focus\s*\{/m,
    /^\.inspection-focus-card\s*\{/m,
    /^\.store-inspection-check-summary\s*\{/m,
    /^\.store-inspection-report-output\s*\{/m,
    /^\.inspection-check-pill\s*\{/m,
    /^\.store-inspection-filters\s*\{/m,
    /^\.inspection-delete-button\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should be owned by assets/css/pages/23-store-inspection.css`);
  });
});

test("sales forecast styles live in the page layer and use design tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/25-sales-forecast.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Sales forecast table and controls \*\//m);
  assert.match(pageSource, /^\.sales-forecast-table-wrap\s*\{/m);
  assert.match(pageSource, /^\.sales-forecast-view-toggle\s*\{/m);
  assert.match(pageSource, /^\.sales-daily-input\s*\{/m);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-control\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.equal(/#(?:c8dcf1|eaf1df|f3ead7|e5edf7|d7e4f1|fbfdff|f8fbff|f2f9ff|fff3df|dbe6f2|f7fbff|526176|aebbd0|a97900|f1b800|fff3bf|d5e0ed|9a4a00|f0bb83|fff2df|e4edf6|cfddea|fffdf5)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".sales-forecast-filters {"), false);
  assert.equal(legacySource.includes(".sales-forecast-filters {"), false);
  assert.equal(legacySource.includes(".sales-forecast-table-wrap {"), false);
  assert.equal(legacySource.includes(".sales-forecast-view-toggle {"), false);
  assert.equal(legacySource.includes(".sales-daily-input {"), false);
});

test("AI image workflow styles live in the page layer and use design tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/40-ai-image-workflow.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* AI image workflow \*\//m);
  assert.match(pageSource, /^#view-ai-image-workflow\s*\{/m);
  assert.match(pageSource, /^\.ai-copy-workspace\s*\{/m);
  assert.match(pageSource, /^\.ai-product-image-upload\s*\{/m);
  assert.match(pageSource, /--ai-copy-accent:\s*var\(--tj-action-blue\)/);
  assert.match(pageSource, /--ai-copy-surface:\s*var\(--tj-content-bg\)/);
  assert.match(pageSource, /--ai-copy-control-border:\s*var\(--tj-border-control\)/);
  assert.match(pageSource, /var\(--tj-text-strong\)/);
  assert.match(pageSource, /var\(--tj-action-blue-soft\)/);
  assert.equal(/#(?:1677ff|2563eb|0b66d8|2457d5)\b/i.test(pageSource), false);

  assert.equal(legacySource.includes("/* AI image workflow */"), false);
  assert.equal(legacySource.includes("#view-ai-image-workflow {"), false);
  assert.equal(legacySource.includes(".ai-copy-workspace {"), false);
  assert.equal(legacySource.includes(".ai-product-image-upload {"), false);
});

test("budget target table width rules live in the page layer", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/30-budget-targets.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^#view-budget\s*\{/m);
  assert.match(pageSource, /^#view-budget \.budget-target-table-wrap\s*\{/m);
  assert.match(pageSource, /^\.month-chip\s*\{/m);
  assert.match(pageSource, /^\.budget-upload-box\s*\{/m);
  assert.match(pageSource, /^\.file-picker\s*\{/m);
  assert.match(pageSource, /^\.file-picker\.is-dragging\s*\{/m);
  assert.match(pageSource, /overflow-x:\s*auto/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-control\)/);
  assert.equal(/#(?:9cc5f6|d8e4f0|c6e4fb|cbd8e6|e24a4a|fff8ed|ffe0bd)\b/i.test(pageSource), false);
  assert.equal(legacySource.includes(".budget-target-table-wrap"), false);
  assert.equal(/^\.budget-toolbar\s*\{/m.test(pageSource), false);
  assert.equal(legacySource.includes(".budget-toolbar {"), false);
  assert.equal(legacySource.includes(".month-chip {"), false);
  assert.equal(legacySource.includes(".budget-upload-box {"), false);
  assert.equal(legacySource.includes(".file-picker {"), false);
  assert.equal(legacySource.includes(".file-picker.is-dragging"), false);
  assert.equal(pageSource.includes(".upload-status {"), false);
  assert.equal(pageSource.includes(".template-map"), false);
  assert.equal(legacySource.includes(".template-map"), false);
});

test("FBA freight page styles avoid overriding shared filter toolbar", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/35-fba-freight.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.equal(pageSource.includes(".fba-freight-toolbar"), false);
  assert.match(pageSource, /^#view-fba-freight \.fba-freight-summary\s*\{/m);
  assert.match(pageSource, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--tj-kpi-card-min-width\),\s*var\(--tj-kpi-card-width\)\)\)/);
  assert.match(pageSource, /box-shadow:\s*var\(--tj-shadow-modal\)/);
  assert.match(pageSource, /^#view-fba-freight \.panel-head\s*\{/m);
  assert.match(pageSource, /^#fba-freight-status\s*\{/m);
  assert.match(pageSource, /overflow-wrap:\s*anywhere/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.equal(/#(?:1677ff|2563eb|0b66d8|2457d5)\b/i.test(pageSource), false);
  assert.equal(legacySource.includes(".fba-freight-table"), false);
  assert.equal(legacySource.includes(".fba-freight-toolbar"), false);
});

test("FBA automation board styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/36-fba-automation.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* FBA automation board and task rows\. \*\//m);
  assert.match(pageSource, /^\.fba-grid\s*\{/m);
  assert.match(pageSource, /^#view-fba\s*\{/m);
  assert.match(pageSource, /^\.fba-board-head,/m);
  assert.match(pageSource, /^\.fba-status-tabs\s*\{/m);
  assert.match(pageSource, /^\.status-tab\s*\{/m);
  assert.match(pageSource, /^\.fba-queue-panel\s*\{/m);
  assert.match(pageSource, /^\.queue-spinner\s*\{/m);
  assert.match(pageSource, /^\.task-group\s*\{/m);
  assert.match(pageSource, /^\.fba-task-row\s*\{/m);
  assert.match(pageSource, /^\.fba-task-skeleton > \*\s*\{/m);
  assert.match(pageSource, /^\.fba-result-pagination\s*\{/m);
  assert.match(pageSource, /^\.fba-task-modal\s*\{/m);
  assert.match(pageSource, /^@media \(max-width:\s*1200px\)/m);
  assert.match(pageSource, /^@media \(max-width:\s*720px\)/m);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-action-blue-soft\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.equal(/#(?:2f6df6|1d56d9|eaf2ff|b8d4ff|f4f8ff|ffffff|f8fbff|eef4fb|dbeafe|fed7aa|f59e0b)\b/i.test(pageSource), false);

  [
    /^#view-fba\s*\{/m,
    /^\.fba-grid\s*\{/m,
    /^\.fba-automation-panel\s*\{/m,
    /^\.fba-result-panel\s*\{/m,
    /^\.fba-task-board-panel\s*\{/m,
    /^\.fba-board-head,/m,
    /^\.fba-status-tabs\s*\{/m,
    /^\.status-tab\s*\{/m,
    /^\.fba-board-groups\s*\{/m,
    /^\.fba-queue-panel\s*\{/m,
    /^\.queue-head,/m,
    /^\.queue-spinner\s*\{/m,
    /^\.queue-pulse\s*\{/m,
    /^\.task-group\s*\{/m,
    /^\.fba-task-row\s*\{/m,
    /^\.fba-loading-state\s*\{/m,
    /^\.fba-task-skeleton\s*\{/m,
    /^\.row-index\s*\{/m,
    /^\.task-main,/m,
    /^\.task-actions\s*\{/m,
    /^\.fba-result-pagination\s*\{/m,
    /^\.fba-task-modal\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should be owned by assets/css/pages/36-fba-automation.css`);
  });
});

test("FBA task form schedule and MSKU search styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/37-fba-task-form.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* FBA task form schedule controls and MSKU search\. \*\//m);
  assert.match(pageSource, /^\.fba-schedule-bar\s*\{/m);
  assert.match(pageSource, /^\.task-schedule-options\s*\{/m);
  assert.match(pageSource, /^\.notification-policy-group\s*\{/m);
  assert.match(pageSource, /^\.schedule-effective-row,/m);
  assert.match(pageSource, /^\.schedule-time-row\s*\{/m);
  assert.match(pageSource, /^\.search-row\s*\{/m);
  assert.match(pageSource, /^\.msku-search\s*\{/m);
  assert.match(pageSource, /^\.msku-suggest-panel\s*\{/m);
  assert.match(pageSource, /^\.search-results\s*\{/m);
  assert.match(pageSource, /^\.search-result-item\s*\{/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--tj-border-control\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-action-blue-soft\)/);
  assert.equal(/#(?:ffffff|f8fbff|eaf4ff|1f6fff|cbd5e1)\b/i.test(pageSource), false);

  assert.equal(legacySource.includes(".fba-schedule-bar {"), false);
  assert.equal(legacySource.includes(".task-schedule-options {"), false);
  assert.equal(legacySource.includes(".notification-policy-group {"), false);
  assert.equal(legacySource.includes(".schedule-effective-row"), false);
  assert.equal(legacySource.includes(".schedule-time-row {"), false);
  assert.equal(legacySource.includes(".search-row {"), false);
  assert.equal(legacySource.includes(".msku-search {"), false);
  assert.equal(legacySource.includes(".msku-suggest-panel {"), false);
  assert.equal(legacySource.includes(".search-results {"), false);
  assert.equal(legacySource.includes(".search-result-item {"), false);
});

test("home quick link styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/21-home-quick-links.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Home quick links and sync summary\. \*\//m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.home-sync-pill\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.home-quick-grid\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.home-quick-config-toggle\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.home-quick-config\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.home-quick-empty\s*\{/m);
  assert.match(pageSource, /var\(--spectrum-control-radius\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.equal(/#(?:13243c|6d7f98|1682ff|f8fbff|eef7ff)\b/i.test(pageSource), false);

  [
    "home-sync-pill",
    "home-quick-grid",
    "home-quick-config",
    "home-quick-empty",
  ].forEach((className) => {
    assert.equal(legacySource.includes(className), false, `${className} should be owned by assets/css/pages/21-home-quick-links.css`);
  });
});

test("admin settings base layout lives in the page layer", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/45-admin-settings.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Admin settings page \*\//m);
  assert.match(pageSource, /^\.admin-grid\s*\{/m);
  assert.match(pageSource, /^\.admin-account-panel\s*\{/m);
  assert.match(pageSource, /^\.admin-account-form\s*\{/m);
  assert.match(pageSource, /^\.admin-account-actions\s*\{/m);
  assert.match(pageSource, /^\.admin-account-table-wrap\s*\{/m);
  assert.equal(legacySource.includes(".admin-grid {\n  display: grid;"), false);
  assert.equal(legacySource.includes(".admin-account-panel {\n  grid-column:"), false);
  assert.equal(legacySource.includes(".admin-account-form {\n  align-items:"), false);
  assert.equal(legacySource.includes(".admin-account-actions {\n  display: flex;"), false);
  assert.equal(legacySource.includes(".admin-account-table-wrap {\n  max-height:"), false);
});

test("cashflow table stack layout lives in the page layer", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/50-cashflow.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Cashflow dashboard page \*\//m);
  assert.match(pageSource, /^#view-cashflow \.cashflow-stack\s*\{/m);
  assert.match(pageSource, /^#view-cashflow \.cashflow-stack \.table-wrap\s*\{/m);
  assert.equal(legacySource.includes(".cashflow-stack {\n  grid-template-columns:"), false);
  assert.equal(legacySource.includes(".cashflow-stack .table-wrap {\n  overflow-x:"), false);
  assert.equal(legacySource.includes(".cashflow-stack table {\n  min-width:"), false);
});

test("payables dashboard styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/51-payables.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Payables dashboard page\. \*\//m);
  assert.match(pageSource, /^\.payable-hero\s*\{/m);
  assert.match(pageSource, /^\.payable-kpi-grid\s*\{/m);
  assert.match(pageSource, /^\.payable-visual-grid\s*\{/m);
  assert.match(pageSource, /^\.payable-status-row\s*\{/m);
  assert.match(pageSource, /^\.payable-flow-card\s*\{/m);
  assert.equal(pageSource.includes("#payables-detail-table th:first-child"), false);
  assert.match(pageSource, /^@media \(max-width:1180px\)/m);
  assert.match(pageSource, /^@media \(max-width:720px\)/m);
  assert.match(pageSource, /\.payable-kpi-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--tj-kpi-card-min-width\),\s*var\(--tj-kpi-card-width\)\)\)/);
  assert.match(pageSource, /#view-payables \.payable-kpi-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-surface-muted\)/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-tone-danger-strong\)/);
  assert.equal(/#(?:d92d20|d96b00|5f7089|0b3768|ffb057|e54835|9fb2c8|edf4fb|f8fbff|ffffff|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".payable-filters {"), false);
  [
    ".payable-hero {",
    ".payable-update {",
    ".payable-filters {",
    ".payable-kpi-grid {",
    ".payable-visual-grid {",
    ".payable-status-row {",
    ".payable-stack {",
    ".payable-flow-card {",
    ".payable-tabs {",
    ".payable-table-wrap table {",
    "#view-payables .section-title {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/51-payables.css`);
  });
});

test("factory inventory styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/52-factory-inventory.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Factory inventory page\. \*\//m);
  assert.match(pageSource, /^\.factory-inventory-hero\s*\{/m);
  assert.match(pageSource, /^#view-factory-inventory\.active\s*\{/m);
  assert.match(pageSource, /^\.factory-inventory-sticky\s*\{/m);
  assert.match(pageSource, /^\.factory-inventory-kpi-grid\s*\{/m);
  assert.match(pageSource, /^#factory-inventory-table \.factory-order-row td\s*\{/m);
  assert.match(pageSource, /^\.factory-order-strip\s*\{/m);
  assert.match(pageSource, /^\.factory-inventory-image\s*\{/m);
  assert.match(pageSource, /^\.factory-shipped-input:focus-visible\s*\{/m);
  assert.equal(/\.app-shell\s*\{[\s\S]*?min-width:\s*1180px/s.test(pageSource), false);
  assert.equal(/\.dashboard\s*\{[\s\S]*?min-width:\s*1000px/s.test(pageSource), false);
  assert.match(pageSource, /@media \(max-width:\s*720px\)[\s\S]*?#view-factory-inventory \.factory-inventory-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(pageSource, /#view-factory-inventory \.factory-inventory-hero \.hero-actions\s*\{[\s\S]*?width:\s*100%/);
  assert.match(pageSource, /var\(--tj-page-bg\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-border-strong\)/);
  assert.match(pageSource, /var\(--spectrum-focus-ring-color\)/);
  assert.equal(pageSource.includes("var(--spectrum-accent-background-color-default)"), false);
  assert.equal(pageSource.includes("var(--spectrum-accent-color-900)"), false);
  assert.equal(
    /#factory-inventory-table\s+td:nth-child\(9\)[\s\S]*?text-align:\s*left/.test(pageSource),
    false,
    "factory inventory shipped quantity cells must inherit numeric right alignment",
  );
  assert.equal(/#(?:d3e4f7|edf4fb|1f6fff|ffffff|f8fbff|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".factory-inventory-filters {"), false);
  [
    ".factory-inventory-hero {",
    "#view-factory-inventory.active {",
    ".factory-inventory-sticky {",
    ".factory-inventory-filters {",
    ".factory-inventory-kpi-grid {",
    ".factory-inventory-table-wrap {",
    ".factory-order-strip {",
    ".factory-inventory-image {",
    ".factory-image-placeholder {",
    ".factory-row-muted {",
    ".factory-shipped-input {",
    "body.factory-inventory-view:not(.login-body)",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/52-factory-inventory.css`);
  });
});

test("supplier board styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/53-supplier-board.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Supplier board page\. \*\//m);
  assert.match(pageSource, /^\.supplier-board-hero\s*\{/m);
  assert.match(pageSource, /^#view-supplier-board\.active\s*\{/m);
  assert.match(pageSource, /^\.supplier-board-sticky\s*\{/m);
  assert.match(pageSource, /^\.supplier-board-kpi-grid\s*\{/m);
  assert.match(pageSource, /^#supplier-board-table td small\s*\{/m);
  assert.match(pageSource, /^\.supplier-board-image\s*\{/m);
  assert.match(pageSource, /^@media \(max-width:\s*1180px\)/m);
  assert.match(pageSource, /^@media \(max-width:\s*720px\)/m);
  assert.match(pageSource, /#view-supplier-board \.supplier-board-kpi-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--tj-kpi-card-min-width\),\s*var\(--tj-kpi-card-width\)\)\)/);
  assert.match(pageSource, /#view-supplier-board \.supplier-board-kpi-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(pageSource, /var\(--tj-page-bg\)/);
  assert.match(pageSource, /var\(--tj-surface-muted\)/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.equal(/#(?:f5faff|dbe8f8|f6f9fd|ffffff|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".supplier-board-filters {"), false);
  [
    ".supplier-board-hero {",
    "#view-supplier-board.active {",
    ".supplier-board-sticky {",
    ".supplier-board-filters {",
    ".supplier-board-kpi-grid {",
    ".supplier-board-panel {",
    ".supplier-board-table-wrap {",
    ".supplier-board-image {",
    "body.supplier-board-view:not(.login-body)",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/53-supplier-board.css`);
  });
});

test("supplier detail styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/54-supplier-detail.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Supplier detail page\. \*\//m);
  assert.match(pageSource, /^\.supplier-detail-hero\s*\{/m);
  assert.match(pageSource, /^\.supplier-detail-actions\s*\{/m);
  assert.match(pageSource, /^\.supplier-detail-kpi-grid\s*\{/m);
  assert.match(pageSource, /^\.supplier-detail-modal\s*\{/m);
  assert.match(pageSource, /^@media \(max-width:720px\)/m);
  assert.match(pageSource, /#view-supplier-detail \.supplier-detail-kpi-grid\s*\{/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.equal(/#(?:d3e4f7|ffffff|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".supplier-detail-filters {"), false);
  [
    ".supplier-detail-hero {",
    ".supplier-detail-actions {",
    ".supplier-detail-filters {",
    ".supplier-detail-kpi-grid {",
    ".supplier-detail-table-wrap table {",
    ".supplier-detail-modal {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/54-supplier-detail.css`);
  });
});

test("inventory provision table stack layout lives in the page layer", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../assets/css/pages/55-inventory-provision.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Inventory provision page \*\//m);
  assert.match(pageSource, /^#view-provision \.inventory-table-stack\s*\{/m);
  assert.match(pageSource, /^#view-provision \.inventory-table-stack \.table-wrap\s*\{/m);
  assert.match(pageSource, /^#view-provision \.inventory-chart-grid\s*\{/m);
  assert.match(pageSource, /^#view-provision \.inventory-chart-grid svg\s*\{/m);
  assert.match(pageSource, /^#view-provision \.bucket-dot\s*\{/m);
  assert.match(pageSource, /^#view-provision \.provision-risk-row\s*\{/m);
  assert.match(pageSource, /grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(0, 0\.9fr\) minmax\(0, 1fr\)/);
  assert.match(pageSource, /min-height:\s*300px/);
  assert.match(pageSource, /var\(--tj-tone-warning-row-bg\)/);
  assert.equal(legacySource.includes(".inventory-table-stack {\n  grid-template-columns:"), false);
  assert.equal(legacySource.includes(".inventory-table-stack .table-wrap {\n  overflow-x:"), false);
  assert.equal(legacySource.includes(".inventory-table-stack table {\n  min-width:"), false);
  assert.equal(legacySource.includes(".inventory-chart-grid {\n  display: grid;"), false);
  assert.equal(legacySource.includes(".inventory-chart-grid svg {\n  width:"), false);
  assert.equal(legacySource.includes(".bucket-dot {\n  display: inline-block;"), false);
  assert.equal(legacySource.includes(".provision-risk-row {\n  background:"), false);
  assert.equal(/^\.inventory-chart-grid\s*\{/m.test(generatedSource), false);
  assert.equal(/^\.bucket-dot\s*\{/m.test(generatedSource), false);
});

test("low inventory fee warning row colors live in the page layer", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const tokenSource = await readFile(new URL("../assets/css/tokens/00-semantic-foundation.css", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../assets/css/pages/60-low-inventory-fee.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(tokenSource, /--tj-tone-danger-row-bg:\s*#fff1f0/);
  assert.match(tokenSource, /--tj-tone-warning-row-bg:\s*#fff7ed/);
  assert.match(tokenSource, /--tj-tone-caution-row-bg:\s*#fffbe6/);
  assert.match(pageSource, /^\/\* Low inventory fee page \*\//m);
  assert.match(pageSource, /^#view-lowfee \.lowfee-warning-row\.risk-high\s*\{/m);
  assert.match(pageSource, /^#view-lowfee \.lowfee-warning-row\.risk-mid\s*\{/m);
  assert.match(pageSource, /^#view-lowfee \.lowfee-warning-row\.risk-low\s*\{/m);
  assert.match(pageSource, /var\(--tj-tone-danger-row-bg\)/);
  assert.match(pageSource, /var\(--tj-tone-warning-row-bg\)/);
  assert.match(pageSource, /var\(--tj-tone-caution-row-bg\)/);
  assert.equal(legacySource.includes(".lowfee-warning-row.risk-high {\n  background:"), false);
  assert.equal(legacySource.includes(".lowfee-warning-row.risk-mid {\n  background:"), false);
  assert.equal(legacySource.includes(".lowfee-warning-row.risk-low {\n  background:"), false);
  assert.equal(/^\.provision-risk-row\s*\{/m.test(generatedSource), false);
  assert.equal(/^\.lowfee-warning-row\.risk-/m.test(generatedSource), false);
});

test("review rating styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/24-review-rating.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Review rating calculator page\. \*\//m);
  assert.match(pageSource, /^#view-review-rating \.review-rating-layout\s*\{/m);
  assert.match(pageSource, /^#view-review-rating \.review-percent-status\s*\{/m);
  assert.match(pageSource, /^#view-review-rating \.review-primary-result\s*\{/m);
  assert.match(pageSource, /^#view-review-rating \.review-support-metrics\s*\{/m);
  assert.match(pageSource, /^#view-review-rating \.review-rating-table\s*\{/m);
  assert.match(pageSource, /^#view-review-rating \.review-formula-note\s*\{/m);
  assert.match(pageSource, /^@media \(max-width:\s*1200px\)/m);
  assert.match(pageSource, /^@media \(max-width:\s*720px\)/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-surface-muted\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-tone-success-bg\)/);
  assert.match(pageSource, /var\(--spectrum-focus-ring-color\)/);
  assert.equal(pageSource.includes("var(--blue-900)"), false);
  assert.equal(pageSource.includes("var(--purple)"), false);
  assert.equal(/#(?:8ac2ff|174d8f|35658f|0b5fd7|d8e6f4|ffd18a|ffb4ad|a8e1bf|f8fbff|ffffff)\b/i.test(pageSource), false);

  [
    ".review-rating-layout {",
    ".review-percent-status {",
    ".review-primary-result {",
    ".review-primary-number {",
    ".review-support-metrics {",
    ".review-rating-table {",
    ".review-result-list {",
    ".review-formula-note {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/24-review-rating.css`);
  });
});

test("slow-moving risk styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/26-slow-moving-risk.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Slow-moving risk page\. \*\//m);
  assert.match(pageSource, /^#view-clearance \.slow-moving-risk-tabs\s*\{/m);
  assert.match(pageSource, /^#view-clearance \.slow-moving-risk-kpis\s*\{/m);
  assert.match(pageSource, /^#view-clearance \.slow-moving-risk-table-wrap\s*\{/m);
  assert.match(pageSource, /^@media \(max-width:\s*720px\)/m);
  assert.match(pageSource, /#view-clearance > \.module-hero\s*\{/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-surface-muted\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-border-strong\)/);
  assert.match(pageSource, /var\(--spectrum-negative\)/);
  assert.equal(/#(?:f8fbff|ffffff|d8e4f0|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  [
    ".slow-moving-risk-tabs {",
    ".slow-moving-risk-panel {",
    ".slow-moving-risk-kpis {",
    ".slow-moving-risk-table-wrap {",
    ".slow-moving-risk-row--强制处置 {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/26-slow-moving-risk.css`);
  });
});

test("aftersales mail styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/67-aftersales-mail.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Aftersales mail dashboard page\. \*\//m);
  assert.match(pageSource, /^\.aftersales-mail-workspace\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-list-panel,/m);
  assert.match(pageSource, /^\.aftersales-mail-kpis\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-item\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-avatar\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-message-panel,/m);
  assert.match(pageSource, /^\.aftersales-mail-body pre\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-attachment-grid\s*\{/m);
  assert.match(pageSource, /^\.aftersales-mail-reply textarea,/m);
  assert.match(pageSource, /^\.aftersales-mail-replies\s*\{/m);
  assert.match(pageSource, /^@media \(max-width: 1180px\)/m);
  assert.match(pageSource, /^@media \(max-width: 760px\)/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-page-bg\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-text-strong\)/);
  assert.equal(pageSource.includes("--spectrum-accent-color"), false);
  assert.equal(/#(?:ffffff|f8fbff|eef4fb|eaf2ff|1677ff|2563eb|0b66d8)\b/i.test(pageSource), false);

  assert.equal(pageSource.includes(".aftersales-mail-filters {"), false);
  [
    /^\.aftersales-mail-workspace\s*\{/m,
    /^\.aftersales-mail-list-panel,/m,
    /^\.aftersales-mail-filters\s*\{/m,
    /^\.aftersales-mail-kpis\s*\{/m,
    /^\.aftersales-mail-list\s*\{/m,
    /^\.aftersales-mail-item\s*\{/m,
    /^\.aftersales-mail-avatar\s*\{/m,
    /^\.aftersales-mail-item-main,/m,
    /^\.aftersales-mail-item-top\s*\{/m,
    /^\.aftersales-mail-item-subject\s*\{/m,
    /^\.aftersales-mail-item-snippet\s*\{/m,
    /^\.aftersales-mail-empty\s*\{/m,
    /^\.aftersales-mail-message-panel,/m,
    /^\.aftersales-mail-body\s*\{/m,
    /^\.aftersales-mail-meta\s*\{/m,
    /^\.aftersales-mail-attachments\s*\{/m,
    /^\.aftersales-mail-ai-head,/m,
    /^\.aftersales-mail-reply\s*\{/m,
    /^\.aftersales-mail-replies\s*\{/m,
  ].forEach((selectorPattern) => {
    assert.equal(selectorPattern.test(legacySource), false, `${selectorPattern} should be owned by assets/css/pages/67-aftersales-mail.css`);
  });
});

test("knowledge library styles live in the page layer and use semantic tokens", async () => {
  const pageSource = await readFile(new URL("../assets/css/pages/68-knowledge-library.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(pageSource, /^\/\* Knowledge library workspace\. \*\//m);
  assert.match(pageSource, /^body:not\(\.login-body\) #view-guide\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-doc-shell\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-doc-sidebar\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-doc-toolbar\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-search-box:focus-within\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-file-board,/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-file-row\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-document-modal\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-embed-panel > header\s*\{/m);
  assert.match(pageSource, /^body:not\(\.login-body\) \.knowledge-section-grid\s*\{/m);
  assert.match(pageSource, /^@media \(max-width: 1100px\)/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-page-bg\)/);
  assert.match(pageSource, /var\(--tj-action-blue\)/);
  assert.match(pageSource, /var\(--tj-action-blue-soft\)/);
  assert.match(pageSource, /var\(--tj-text-muted\)/);
  assert.match(pageSource, /var\(--tj-border-subtle\)/);
  assert.match(pageSource, /var\(--spectrum-focus-ring-color\)/);
  assert.equal(pageSource.includes("var(--blue-800)"), false);
  assert.equal(pageSource.includes("var(--purple)"), false);
  assert.equal(/#(?:1677ff|2563eb|0b66d8|1d6ff2|6c5cff|4aa3ff|eaf3ff|f8fbff|ffffff)\b/i.test(pageSource), false);

  [
    "body:not(.login-body) #view-guide {",
    "body:not(.login-body) .knowledge-doc-shell {",
    "body:not(.login-body) .knowledge-doc-sidebar {",
    "body:not(.login-body) .knowledge-doc-toolbar {",
    "body:not(.login-body) .knowledge-search-box {",
    "body:not(.login-body) .knowledge-file-board",
    "body:not(.login-body) .knowledge-file-row {",
    "body:not(.login-body) .knowledge-document-modal {",
    "body:not(.login-body) .knowledge-embed-panel",
    "body:not(.login-body) .knowledge-section-grid",
    "body:not(.login-body) .knowledge-library-tree",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/68-knowledge-library.css`);
  });
});

test("obsolete guide course styles are removed from legacy css", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const knowledgeFeatureSource = await readFile(new URL("../assets/js/features/knowledge-library.js", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../assets/css/pages/68-knowledge-library.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  [
    "guide-hero",
    "guide-hero-status",
    "guide-kpi-grid",
    "guide-layout",
    "guide-step-list",
    "guide-topic-grid",
    "operations-course-panel",
    "operations-course-list",
    "course-card",
    "course-detail",
    "course-full-text",
  ].forEach((className) => {
    assert.equal(legacySource.includes(className), false, `${className} should not remain in legacy css`);
    assert.equal(pageSource.includes(className), false, `${className} is obsolete and should not move into page css`);
    assert.equal(indexSource.includes(className), false, `${className} should not be referenced by index.html`);
    assert.equal(knowledgeFeatureSource.includes(className), false, `${className} should not be referenced by knowledge-library.js`);
  });
});

test("advertising review styles live in the page layer and use semantic tokens", async () => {
  const generatedSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const tokenSource = await readFile(new URL("../assets/css/tokens/00-semantic-foundation.css", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../assets/css/pages/65-advertising-review.css", import.meta.url), "utf8");
  const legacySource = await readFile(new URL("../assets/css/legacy/current.css", import.meta.url), "utf8");

  assert.match(tokenSource, /--tj-tone-info-text:\s*#3156a3/);
  assert.match(tokenSource, /--tj-tone-neutral-bg:\s*#eef2f6/);
  assert.match(tokenSource, /--tj-surface-muted:\s*#f4f7fb/);
  assert.match(pageSource, /^\/\* Advertising review page \*\//m);
  assert.match(pageSource, /^\.ads-analysis-panel\s*\{/m);
  assert.match(pageSource, /^\.ads-analysis-card\s*\{/m);
  assert.match(pageSource, /^\.column-picker\s*\{/m);
  assert.match(pageSource, /var\(--tj-content-bg\)/);
  assert.match(pageSource, /var\(--tj-border-control\)/);
  assert.match(pageSource, /var\(--tj-tone-info-text\)/);
  assert.match(pageSource, /var\(--tj-tone-neutral-bg\)/);
  assert.equal(/#(?:d9e1ec|b42318|087443|3156a3|667085|eef2f6|475467|40546d|1f3d63|f4f7fb|243a58|a15c00|6a7b91|fff4d6|9a5b00|e7f8ef|fdecec|e9f0ff)\b/i.test(pageSource), false);

  [
    ".ads-portfolio-filters {",
    ".ads-analysis-panel {",
    ".ads-analysis-card {",
    ".ads-keyword-panel {",
    ".ads-keyword-table-wrap table {",
    ".ads-portfolio-table-wrap table {",
    ".ads-column-panel {",
    ".column-picker {",
    ".column-group-head {",
    ".column-options {",
  ].forEach((snippet) => {
    assert.equal(legacySource.includes(snippet), false, `${snippet} should be owned by assets/css/pages/65-advertising-review.css`);
  });

  assert.equal((generatedSource.match(/^\.ads-analysis-panel\s*\{/gm) || []).length, 1);
  assert.equal((generatedSource.match(/^\.ads-keyword-panel\s*\{/gm) || []).length, 1);
  assert.equal((generatedSource.match(/^\.column-picker\s*\{/gm) || []).length, 1);
});

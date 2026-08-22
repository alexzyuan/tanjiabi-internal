import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractNavigationModules,
  extractViewIds,
  validateProductCatalogHealth,
  validateSalesFactsHealth,
  validateFrontendIntegrity,
  verifySalesReviewSmoke,
} from "../scripts/deploy-integrity.js";
import * as deployIntegrity from "../scripts/deploy-integrity.js";

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

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

test("sales-review deployment smoke rejects detail rows without the 30d refund contract", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/auth/password/login")) {
      return jsonResponse({ ok: true }, { headers: { "set-cookie": "tanjia_session=test; Path=/; HttpOnly" } });
    }
    return jsonResponse({ detailRows: [{ msku: "MSKU-1" }] });
  };

  await assert.rejects(
    verifySalesReviewSmoke({
      baseUrl: "http://127.0.0.1:4173",
      credentials: { username: "deploy-smoke", password: "secret" },
      fetchImpl,
    }),
    /refundRate30d/,
  );
});

test("sales-review deployment smoke accepts unavailable and numeric 30d refund values", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/auth/password/login")) {
      return jsonResponse({ ok: true }, { headers: { "set-cookie": "tanjia_session=test; Path=/; HttpOnly" } });
    }
    return jsonResponse({ detailRows: [{ msku: "MSKU-1", refundRate30d: null }, { msku: "MSKU-2", refundRate30d: 3.5 }] });
  };

  const result = await verifySalesReviewSmoke({
    baseUrl: "http://127.0.0.1:4173",
    credentials: { username: "deploy-smoke", password: "secret" },
    fetchImpl,
  });

  assert.deepEqual(result, { detailRowCount: 2, unavailableCount: 1 });
});

test("sales-review deployment smoke rejects an empty detail response", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/auth/password/login")) {
      return jsonResponse({ ok: true }, { headers: { "set-cookie": "tanjia_session=test; Path=/; HttpOnly" } });
    }
    return jsonResponse({ detailRows: [] });
  };

  await assert.rejects(
    verifySalesReviewSmoke({
      baseUrl: "http://127.0.0.1:4173",
      credentials: { username: "deploy-smoke", password: "secret" },
      fetchImpl,
    }),
    /detailRows 不能为空/,
  );
});

test("deploy integrity requires healthy nested product catalog diagnostics", () => {
  assert.deepEqual(validateProductCatalogHealth({ ok: true }), ["/api/health 缺少 productCatalog 健康状态"]);
  assert.deepEqual(
    validateProductCatalogHealth({
      ok: true,
      productCatalog: {
        ok: false,
        schemaVersion: 1,
        quickCheck: "disk I/O error",
        error: "SQLITE_IOERR",
      },
    }),
    ["商品目录数据库异常：schemaVersion=1 quickCheck=disk I/O error error=SQLITE_IOERR"],
  );
  assert.deepEqual(validateProductCatalogHealth({ ok: true, productCatalog: { ok: true } }), []);
});

test("nested product catalog health diagnostics do not echo sensitive text", () => {
  const errors = validateProductCatalogHealth({
    ok: true,
    productCatalog: {
      ok: false,
      schemaVersion: 1,
      quickCheck: "/opt/tanjia-bi/data-cache/product-catalog/product-catalog-v1.sqlite token",
      error: "token raw-secret",
    },
  });
  assert.equal(JSON.stringify(errors).includes("/opt/tanjia-bi"), false);
  assert.equal(JSON.stringify(errors).includes("raw-secret"), false);
  assert.equal(JSON.stringify(errors).includes("token"), false);
  assert.deepEqual(errors, ["商品目录数据库异常：schemaVersion=1 quickCheck=unavailable error=PRODUCT_CATALOG_HEALTH_ERROR"]);
});

test("deploy integrity requires healthy nested sales facts diagnostics", () => {
  assert.deepEqual(validateSalesFactsHealth({ ok: true }), ["/api/health 缺少 salesFacts 健康状态"]);
  assert.deepEqual(validateSalesFactsHealth({
    ok: true,
    salesFacts: {
      ok: false,
      schemaVersion: 1,
      quickCheck: "disk I/O error",
      error: "SALES_FACTS_DATABASE_ERROR",
    },
  }), ["销售事实数据库异常：schemaVersion=1 quickCheck=disk I/O error error=SALES_FACTS_DATABASE_ERROR"]);
  assert.deepEqual(validateSalesFactsHealth({ ok: true, salesFacts: { ok: true } }), []);
});

test("nested sales facts diagnostics do not echo sensitive text", () => {
  const errors = validateSalesFactsHealth({
    ok: true,
    salesFacts: {
      ok: false,
      schemaVersion: 1,
      quickCheck: "/opt/tanjia-bi/data-cache/sales-facts/sales-facts-v1.sqlite token",
      error: "token raw-secret",
    },
  });
  assert.equal(JSON.stringify(errors).includes("/opt/tanjia-bi"), false);
  assert.equal(JSON.stringify(errors).includes("raw-secret"), false);
  assert.equal(JSON.stringify(errors).includes("token"), false);
  assert.deepEqual(errors, ["销售事实数据库异常：schemaVersion=1 quickCheck=unavailable error=SALES_FACTS_HEALTH_ERROR"]);
});

test("healthy sales facts diagnostics retain schema, revision, and count fields", () => {
  assert.deepEqual(validateSalesFactsHealth({
    ok: true,
    salesFacts: {
      ok: true,
      schemaVersion: 1,
      quickCheck: "ok",
      salesFactsRevision: 4,
      dailyFactCount: 12,
      factCoverageCount: 3,
    },
  }), []);
});

test("deployment integrity rejects non-production or implicit data providers", () => {
  assert.deepEqual(deployIntegrity.validateProductionProviderHealth({
    provider: "lingxing",
    runtime: { production: true, dataProviderExplicit: true },
  }), []);
  assert.deepEqual(deployIntegrity.validateProductionProviderHealth({
    provider: "mock",
    runtime: { production: true, dataProviderExplicit: true },
  }), ["生产数据源异常：provider=mock"]);
  assert.deepEqual(deployIntegrity.validateProductionProviderHealth({
    provider: "lingxing",
    runtime: { production: false, dataProviderExplicit: true },
  }), ["生产运行模式异常：production=false"]);
  assert.deepEqual(deployIntegrity.validateProductionProviderHealth({
    provider: "lingxing",
    runtime: { production: true, dataProviderExplicit: false },
  }), ["生产数据源必须显式配置 DATA_PROVIDER=lingxing"]);
});

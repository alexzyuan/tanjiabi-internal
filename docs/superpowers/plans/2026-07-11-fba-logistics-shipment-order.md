# FBA Logistics Shipment Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Logistics section where FBA freight-sheet conversion and FBA shipment-order creation share the same cached FBA shipment candidates.

**Architecture:** Add a shared backend candidate service that normalizes and caches Lingxing FBA shipment rows, then route both the existing freight-sheet workflow and the new shipment-order workflow through it. Add a dedicated shipment-order service for validation, duplicate checks, serial Lingxing creation calls, and observable per-shipment results. Keep frontend feature logic in focused native JS modules and keep `app.js` as composition only.

**Tech Stack:** Node.js ESM, native HTML/CSS/JS, Node test runner, existing Lingxing adapter, existing `routes/fba.js`, layered CSS under `assets/css/*`.

---

## File Structure

- Create `src/services/fbaShipmentCandidateService.js`: shared FBA shipment normalization, seller enrichment, product catalog enrichment, in-memory cache, and candidate filtering.
- Create `src/services/fbaShipmentOrderService.js`: warehouse listing, payload building, validation, duplicate checks, serial create-ready-send-order execution, and result summarization.
- Modify `src/services/fbaFreightSheetService.js`: delegate candidate loading to the new shared candidate service while preserving existing public exports.
- Modify `src/adapters/lingxingAdapter.js`: add Lingxing methods for warehouses, inbound shipment-order lookup, ready-send creation, and normal box info.
- Modify `routes/fba.js`: add candidate, warehouse, and shipment-order routes.
- Modify `server.js`: import and inject new service functions into `createFbaRoutes`.
- Create `test/fbaShipmentCandidateService.test.js`: cache, filter, seller mapping, and force refresh coverage.
- Create `test/fbaShipmentOrderService.test.js`: validation, duplicate skip, serial creation, and partial failure coverage.
- Modify `test/fbaFreightSheetService.test.js`: assert existing freight service still works through the shared candidate service.
- Modify `index.html`: add Logistics navigation group, move freight nav item into it, add shipment-order view markup.
- Create `assets/js/features/fba-shipment-order.js`: new frontend feature module.
- Modify `app.js`: import, instantiate, initialize, and syntax-check the new feature module.
- Create `assets/css/pages/36-fba-shipment-order.css`: feature-specific CSS source only.
- Modify `package.json`: add new files to `check:js` and `check` explicit syntax-check lists.

## Task 1: Shared FBA Shipment Candidate Service

**Files:**
- Create: `src/services/fbaShipmentCandidateService.js`
- Test: `test/fbaShipmentCandidateService.test.js`
- Modify: `src/services/fbaFreightSheetService.js`

- [ ] **Step 1: Write failing cache and mapping tests**

Create `test/fbaShipmentCandidateService.test.js` with these tests:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFbaShipmentCandidateCache,
  getFbaShipmentCandidates,
  normalizeFbaShipmentCandidateFilters,
} from "../src/services/fbaShipmentCandidateService.js";

const payload = {
  data: {
    list: [{
      sid: 8708,
      seller: "xiamentanjia-US",
      shipment_id: "FBA18QJFDCWJ",
      shipment_name: "FBA STA",
      shipment_status: "SHIPPED",
      destination_fulfillment_center_id: "TEB9",
      gmt_create: "2026-07-04 09:15",
      item_list: [{
        msku: "JM-DGC-BLUE",
        fnsku: "X004BLUE",
        sku: "TJ-DGC-BLUE",
        quantity_shipped: 18,
        quantity_in_case: 6,
      }],
    }],
  },
  total: 1,
  request_id: "shipment-request-1",
};

function makeAdapter() {
  const calls = [];
  return {
    calls,
    async fetchFbaCargoShipments(params) {
      calls.push(params);
      return payload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };
}

test("normalizeFbaShipmentCandidateFilters keeps existing freight filter names compatible", () => {
  const filters = normalizeFbaShipmentCandidateFilters({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
    shipmentId: "FBA18QJFDCWJ",
    shipmentStatus: "SHIPPED",
  });

  assert.equal(filters.startDate, "2026-07-01");
  assert.equal(filters.endDate, "2026-07-11");
  assert.deepEqual(filters.sids, [8708]);
  assert.equal(filters.shipmentId, "FBA18QJFDCWJ");
  assert.equal(filters.shipmentStatus, "SHIPPED");
});

test("getFbaShipmentCandidates caches identical Lingxing shipment queries", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const sellers = [{
    sid: 8708,
    name: "xiamentanjia-US",
    seller_id: "A1SELLERUS",
    marketplace_id: "ATVPDKIKX0DER",
    country: "美国",
  }];

  const first = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
  }, { adapter, sellers });
  const second = await getFbaShipmentCandidates({
    startDate: "2026-07-01",
    endDate: "2026-07-11",
    sid: "8708",
  }, { adapter, sellers });

  assert.equal(adapter.calls.length, 1);
  assert.equal(second.cache.hit, true);
  assert.equal(first.rows[0].sellerId, "A1SELLERUS");
  assert.equal(first.rows[0].marketplaceId, "ATVPDKIKX0DER");
  assert.equal(first.rows[0].items[0].fnsku, "X004BLUE");
});

test("getFbaShipmentCandidates forceRefresh bypasses cache", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = makeAdapter();
  const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }];

  await getFbaShipmentCandidates({ startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" }, { adapter, sellers });
  await getFbaShipmentCandidates({ startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708", forceRefresh: true }, { adapter, sellers });

  assert.equal(adapter.calls.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/fbaShipmentCandidateService.test.js
```

Expected: FAIL with module-not-found for `src/services/fbaShipmentCandidateService.js`.

- [ ] **Step 3: Implement `fbaShipmentCandidateService.js`**

Create `src/services/fbaShipmentCandidateService.js`:

```js
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { lingxingShopMap } from "../data/lingxingShopMap.js";
import {
  applyProductCatalogToFbaFreightShipments,
  fbaFreightSheetTestUtils,
  normalizeFbaFreightShipments,
} from "./fbaFreightSheetService.js";
import { getSharedProductCatalogMap } from "./sharedDataService.js";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const candidateCache = new Map();

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function uniqueNumbers(values) {
  return [...new Set((values || []).map(Number).filter(Boolean))];
}

function sellerSid(seller = {}) {
  return Number(seller.sid || seller.id || seller.seller_id_local || seller.store_id || seller.storeId || 0);
}

function buildSellerMap(sellers = []) {
  const map = new Map();
  for (const shop of lingxingShopMap) {
    if (Number(shop.sid)) map.set(Number(shop.sid), shop);
  }
  for (const seller of sellers || []) {
    const sid = sellerSid(seller);
    if (!sid) continue;
    map.set(sid, {
      ...map.get(sid),
      ...seller,
      sid,
      seller_id: firstText(seller.seller_id, seller.sellerId),
      marketplace_id: firstText(seller.marketplace_id, seller.marketplaceId),
    });
  }
  return map;
}

export function normalizeFbaShipmentCandidateFilters(filters = {}) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const startDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(filters.startDate || filters.start_date || "")
    ? firstText(filters.startDate, filters.start_date)
    : `${yyyy}-${mm}-01`;
  const endDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(filters.endDate || filters.end_date || "")
    ? firstText(filters.endDate, filters.end_date)
    : today;
  const sids = uniqueNumbers(String(filters.sids || filters.sid || "")
    .split(",")
    .map((value) => value.trim()));
  return {
    startDate,
    endDate,
    sids: sids.length ? sids : lingxingShopMap.map((shop) => Number(shop.sid)).filter(Boolean),
    shipmentId: firstText(filters.shipmentId, filters.shipment_id),
    shipmentStatus: firstText(filters.shipmentStatus, filters.shipment_status),
    offset: Math.max(0, Number(filters.offset || 0) || 0),
    length: Math.min(500, Math.max(1, Number(filters.length || 100) || 100)),
    forceRefresh: String(filters.forceRefresh || "").toLowerCase() === "true" || filters.forceRefresh === true,
  };
}

export function buildFbaShipmentCandidateCacheKey(filters = {}) {
  return JSON.stringify({
    sid: [...filters.sids].sort((a, b) => a - b),
    start_date: filters.startDate,
    end_date: filters.endDate,
    shipment_id: filters.shipmentId,
    shipment_status: filters.shipmentStatus,
    offset: filters.offset,
    length: filters.length,
  });
}

export function clearFbaShipmentCandidateCache() {
  candidateCache.clear();
}

function enrichShipmentWithSeller(row = {}, sellerMap = new Map()) {
  const seller = sellerMap.get(Number(row.sid)) || {};
  return {
    ...row,
    sellerId: firstText(seller.seller_id, seller.sellerId, row.raw?.seller_id),
    marketplaceId: firstText(seller.marketplace_id, seller.marketplaceId, row.raw?.marketplace_id),
    mid: Number(seller.mid || row.raw?.mid || 0),
  };
}

async function enrichProductCatalog(adapter, shipments, { productCatalogRequired = false, forceProductCatalogRefresh = false } = {}) {
  const seedRows = shipments.flatMap((shipment) =>
    (shipment.items || []).map((item) => ({
      sid: shipment.sid,
      msku: item.msku,
      sku: item.sku,
      productName: item.productName || item.title,
      imageUrl: item.imageUrl,
    })),
  );
  if (!seedRows.length) return { rows: shipments, status: "" };
  try {
    const catalogResult = await getSharedProductCatalogMap(adapter, seedRows, {
      forceRefresh: forceProductCatalogRefresh,
      strict: productCatalogRequired,
    });
    return {
      rows: applyProductCatalogToFbaFreightShipments(shipments, catalogResult.map),
      status: catalogResult.status || "",
    };
  } catch (error) {
    console.error("[fba-shipment-candidates] product catalog lookup failed", {
      shipmentCount: shipments.length,
      itemCount: seedRows.length,
      required: productCatalogRequired,
      error: error.message,
    });
    if (productCatalogRequired) throw error;
    return { rows: shipments, status: "failed" };
  }
}

export async function getFbaShipmentCandidates(filters = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  now = Date.now(),
  ttlMs = DEFAULT_CACHE_TTL_MS,
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
} = {}) {
  const normalizedFilters = normalizeFbaShipmentCandidateFilters(filters);
  const cacheKey = buildFbaShipmentCandidateCacheKey(normalizedFilters);
  const cached = candidateCache.get(cacheKey);
  if (!normalizedFilters.forceRefresh && cached && now - cached.fetchedAtMs < ttlMs) {
    return {
      ...cached.result,
      cache: { hit: true, key: cacheKey, fetchedAt: cached.result.fetchedAt },
    };
  }

  const params = fbaFreightSheetTestUtils.buildLingxingShipmentParams(normalizedFilters);
  const payload = await adapter.fetchFbaCargoShipments(params);
  const sellerMap = buildSellerMap(sellers);
  const baseRows = normalizeFbaFreightShipments(payload, { sellersBySid: sellerMap })
    .map((row) => enrichShipmentWithSeller(row, sellerMap));
  const catalog = await enrichProductCatalog(adapter, baseRows, { productCatalogRequired, forceProductCatalogRefresh });
  const fetchedAt = new Date(now).toISOString();
  const result = {
    ok: true,
    filters: normalizedFilters,
    total: Number(payload?.total || payload?.data?.total || catalog.rows.length || 0),
    rows: catalog.rows,
    imageCatalogStatus: catalog.status || "",
    sourceRequestId: firstText(payload?.request_id, payload?.requestId),
    fetchedAt,
    raw: payload,
  };
  candidateCache.set(cacheKey, { fetchedAtMs: now, result });
  console.info("[fba-shipment-candidates] fetched shipments", {
    shipmentCount: result.rows.length,
    itemCount: result.rows.reduce((sum, row) => sum + (row.items || []).length, 0),
    cacheKey,
    requestId: result.sourceRequestId,
  });
  return { ...result, cache: { hit: false, key: cacheKey, fetchedAt } };
}
```

- [ ] **Step 4: Run the candidate tests**

Run:

```bash
npm test -- test/fbaShipmentCandidateService.test.js
```

Expected: PASS for all tests in `fbaShipmentCandidateService.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/services/fbaShipmentCandidateService.js test/fbaShipmentCandidateService.test.js
git commit -m "feat: add shared fba shipment candidate cache"
```

## Task 2: Route Existing Freight Workflow Through Candidates

**Files:**
- Modify: `src/services/fbaFreightSheetService.js`
- Modify: `test/fbaFreightSheetService.test.js`

- [ ] **Step 1: Add failing regression test for cached freight calls**

Append this test to `test/fbaFreightSheetService.test.js`:

```js
test("getFbaFreightShipments uses shared candidate cache for identical filters", async () => {
  const { clearFbaShipmentCandidateCache } = await import("../src/services/fbaShipmentCandidateService.js");
  const { getFbaFreightShipments } = await import("../src/services/fbaFreightSheetService.js");
  clearFbaShipmentCandidateCache();
  let shipmentCalls = 0;
  const adapter = {
    async fetchFbaCargoShipments() {
      shipmentCalls += 1;
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };

  await getFbaFreightShipments({ startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
  });
  await getFbaFreightShipments({ startDate: "2026-07-01", endDate: "2026-07-10", sid: "8708" }, {
    adapter,
    sellers: [{ sid: 8708, name: "xiamentanjia-US", country: "美国", seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER" }],
  });

  assert.equal(shipmentCalls, 1);
});
```

- [ ] **Step 2: Run regression test to verify it fails**

Run:

```bash
npm test -- test/fbaFreightSheetService.test.js
```

Expected: FAIL because `getFbaFreightShipments` still calls `fetchFbaCargoShipments` directly.

- [ ] **Step 3: Modify `getFbaFreightShipments` to delegate to candidate service**

In `src/services/fbaFreightSheetService.js`, add the import:

```js
import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";
```

Replace the body of `getFbaFreightShipments` with:

```js
export async function getFbaFreightShipments(filters = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  productCatalogRequired = false,
  forceProductCatalogRefresh = false,
} = {}) {
  const result = await getFbaShipmentCandidates(filters, {
    adapter,
    sellers,
    productCatalogRequired,
    forceProductCatalogRefresh,
  });
  console.info("[fba-freight] normalized shipments", {
    shipmentCount: result.rows.length,
    itemCount: result.rows.reduce((total, shipment) => total + (shipment.items || []).length, 0),
    imageCatalogStatus: result.imageCatalogStatus || "",
    cacheHit: Boolean(result.cache?.hit),
  });
  return result;
}
```

Keep `normalizeFbaFreightFilters` and `buildLingxingShipmentParams` in the file for compatibility and tests. Do not delete workbook or template logic.

- [ ] **Step 4: Run freight and candidate tests**

Run:

```bash
npm test -- test/fbaShipmentCandidateService.test.js test/fbaFreightSheetService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/fbaFreightSheetService.js test/fbaFreightSheetService.test.js
git commit -m "refactor: share fba shipment candidates with freight sheets"
```

## Task 3: Lingxing Adapter Methods

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`

- [ ] **Step 1: Add adapter methods near existing FBA methods**

In `src/adapters/lingxingAdapter.js`, add these methods after `fetchFbaCargoShipmentBoxes`:

```js
  fetchFbaShipmentBoxInfo(params = {}) {
    return this.signedRequest("/erp/sc/routing/fba/shipment/boxInfo", {
      method: "POST",
      params,
    });
  }

  fetchLocalWarehouses(params = {}) {
    return this.signedRequest("/erp/sc/data/local_inventory/warehouse", {
      method: "POST",
      params: {
        type: 1,
        is_delete: 0,
        offset: 0,
        length: 1000,
        ...params,
      },
    });
  }

  fetchFbaInboundShipmentOrders(params = {}) {
    return this.signedRequest("/erp/sc/routing/storage/shipment/getInboundShipmentList", {
      method: "POST",
      params: {
        offset: 0,
        length: 20,
        is_delete: 0,
        ...params,
      },
    });
  }

  createReadySendFbaShipmentOrder(params = {}) {
    return this.signedRequest("/erp/sc/routing/storage/shipment/createReadySendOrder", {
      method: "POST",
      params,
    });
  }
```

- [ ] **Step 2: Syntax-check adapter**

Run:

```bash
node --check src/adapters/lingxingAdapter.js
```

Expected: no output and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/lingxingAdapter.js
git commit -m "feat: add lingxing fba shipment order endpoints"
```

## Task 4: FBA Shipment Order Service

**Files:**
- Create: `src/services/fbaShipmentOrderService.js`
- Test: `test/fbaShipmentOrderService.test.js`

- [ ] **Step 1: Write failing service tests**

Create `test/fbaShipmentOrderService.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadySendOrderPayload,
  createReadySendFbaShipmentOrders,
  listFbaShipmentOrderWarehouses,
} from "../src/services/fbaShipmentOrderService.js";
import { clearFbaShipmentCandidateCache } from "../src/services/fbaShipmentCandidateService.js";

const shipmentPayload = {
  data: {
    list: [{
      sid: 8708,
      shipment_id: "FBA18QJFDCWJ",
      shipment_name: "FBA STA",
      shipment_status: "SHIPPED",
      item_list: [
        { msku: "MSKU-BLUE", fnsku: "X004BLUE", sku: "TJ-DGC-BLUE", quantity_shipped: 18, quantity_in_case: 6 },
      ],
    }],
  },
};

const sellers = [{ sid: 8708, seller_id: "A1SELLERUS", marketplace_id: "ATVPDKIKX0DER", name: "US Store" }];

test("listFbaShipmentOrderWarehouses normalizes Lingxing local warehouse rows", async () => {
  const adapter = {
    async fetchLocalWarehouses() {
      return { data: [{ wid: 1, name: "深圳仓", type: 1, is_delete: 0 }, { wid: 2, name: "", type: 1, is_delete: 0 }] };
    },
  };

  const result = await listFbaShipmentOrderWarehouses({ adapter });

  assert.deepEqual(result.warehouses, [{ wid: 1, name: "深圳仓", type: 1, countryCode: "" }]);
});

test("buildReadySendOrderPayload maps shipment items to Lingxing required fields", () => {
  const payload = buildReadySendOrderPayload({
    warehouse: { sysWid: 1 },
    shipment: {
      shipmentId: "FBA18QJFDCWJ",
      sellerId: "A1SELLERUS",
      marketplaceId: "ATVPDKIKX0DER",
      items: [{ fnsku: "X004BLUE", sku: "TJ-DGC-BLUE", shippedQuantity: 18, quantityInCase: 6 }],
    },
    nowText: "2026-07-11T12:00:00.000Z",
  });

  assert.equal(payload.sys_wid, 1);
  assert.equal(payload.head_fee_type, 0);
  assert.equal(payload.tax_fee_type, 0);
  assert.equal(payload.list[0].seller_id, "A1SELLERUS");
  assert.equal(payload.list[0].marketplace_id, "ATVPDKIKX0DER");
  assert.equal(payload.list[0].shipment_id, "FBA18QJFDCWJ");
  assert.equal(payload.list[0].fulfillment_network_sku, "X004BLUE");
  assert.equal(payload.list[0].num, 18);
  assert.equal(payload.list[0].sku, "TJ-DGC-BLUE");
  assert.equal(payload.list[0].quantity_in_case, 6);
});

test("createReadySendFbaShipmentOrders skips existing shipment orders and creates missing ones serially", async () => {
  clearFbaShipmentCandidateCache();
  const events = [];
  const adapter = {
    async fetchFbaCargoShipments() {
      events.push("fetch-shipments");
      return shipmentPayload;
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
    async fetchFbaInboundShipmentOrders(params) {
      events.push(`lookup:${params.senior_search_list[0].search_value[0]}`);
      return { data: { list: [] } };
    },
    async createReadySendFbaShipmentOrder(params) {
      events.push(`create:${params.list[0].shipment_id}`);
      return { code: 0, message: "success", request_id: "create-request-1", data: { order_sn: "SP260711001" } };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA18QJFDCWJ"],
    warehouse: { sysWid: 1 },
  }, { adapter, sellers, now: () => new Date("2026-07-11T12:00:00.000Z") });

  assert.equal(result.createdCount, 1);
  assert.equal(result.results[0].status, "created");
  assert.equal(result.results[0].orderSn, "SP260711001");
  assert.deepEqual(events, ["fetch-shipments", "lookup:FBA18QJFDCWJ", "create:FBA18QJFDCWJ"]);
});

test("createReadySendFbaShipmentOrders returns per-shipment failure when required fields are missing", async () => {
  clearFbaShipmentCandidateCache();
  const adapter = {
    async fetchFbaCargoShipments() {
      return { data: { list: [{ sid: 8708, shipment_id: "FBA-MISSING", item_list: [{ sku: "", fnsku: "", quantity_shipped: 0 }] }] } };
    },
    async fetchListings() {
      return { data: { list: [] } };
    },
    async fetchLocalProductInfos() {
      return { data: [] };
    },
  };

  const result = await createReadySendFbaShipmentOrders({
    filters: { startDate: "2026-07-01", endDate: "2026-07-11", sid: "8708" },
    shipmentIds: ["FBA-MISSING"],
    warehouse: { sysWid: 1 },
  }, { adapter, sellers: [] });

  assert.equal(result.failedCount, 1);
  assert.equal(result.results[0].status, "failed");
  assert.match(result.results[0].error, /缺少店铺映射|缺少 FNSKU|缺少 SKU|发货数量/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/fbaShipmentOrderService.test.js
```

Expected: FAIL with module-not-found for `src/services/fbaShipmentOrderService.js`.

- [ ] **Step 3: Implement service**

Create `src/services/fbaShipmentOrderService.js`:

```js
import { getLingxingAdapter } from "../adapters/lingxingAdapter.js";
import { getFbaShipmentCandidates } from "./fbaShipmentCandidateService.js";

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function records(payload) {
  const data = payload?.data !== undefined ? payload.data : (payload || {});
  if (Array.isArray(data)) return data;
  return data.list || data.records || data.rows || [];
}

function selectedSet(values = []) {
  return new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean));
}

function normalizeWarehouse(input = {}) {
  const sysWidValue = input.sysWid !== undefined ? input.sysWid : input.sys_wid;
  return {
    wid: numberValue(input.wid),
    sysWid: numberValue(sysWidValue),
  };
}

function assertWarehouse(warehouse = {}) {
  if (!warehouse.wid && !warehouse.sysWid) throw new Error("请选择发货仓库后再创建发货单。");
}

function resultSummary(results = []) {
  const createdCount = results.filter((item) => item.status === "created").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  return {
    ok: failedCount === 0,
    partial: failedCount > 0 && createdCount + skippedCount > 0,
    createdCount,
    skippedCount,
    failedCount,
    results,
  };
}

function shipmentRowId(row = {}) {
  return firstText(row.shipmentId, row.staShipmentId, row.id);
}

export async function listFbaShipmentOrderWarehouses({ adapter = getLingxingAdapter() } = {}) {
  const payload = await adapter.fetchLocalWarehouses({ type: 1, is_delete: 0, offset: 0, length: 1000 });
  const warehouses = records(payload)
    .map((row) => ({
      wid: numberValue(row.wid),
      name: firstText(row.name),
      type: numberValue(row.type),
      countryCode: firstText(row.country_code, row.countryCode),
    }))
    .filter((row) => row.wid && row.name);
  return { ok: true, warehouses };
}

export function validateShipmentForReadySendOrder(shipment = {}) {
  const errors = [];
  if (!firstText(shipment.shipmentId)) errors.push("缺少货件单号");
  if (!firstText(shipment.sellerId)) errors.push("缺少店铺映射 seller_id");
  if (!firstText(shipment.marketplaceId)) errors.push("缺少店铺映射 marketplace_id");
  const validItems = [];
  for (const item of shipment.items || []) {
    const sku = firstText(item.sku);
    const fnsku = firstText(item.fnsku);
    const num = numberValue(item.shippedQuantity);
    if (!sku) errors.push(`${item.msku || shipment.shipmentId} 缺少 SKU`);
    if (!fnsku) errors.push(`${item.msku || sku || shipment.shipmentId} 缺少 FNSKU`);
    if (num <= 0) errors.push(`${item.msku || sku || shipment.shipmentId} 发货数量必须大于 0`);
    if (sku && fnsku && num > 0) validItems.push(item);
  }
  if (!validItems.length) errors.push("货件没有可创建发货单的商品明细");
  return errors;
}

export function buildReadySendOrderPayload({ warehouse, shipment, nowText = new Date().toISOString() } = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  assertWarehouse(normalizedWarehouse);
  const payload = {
    head_fee_type: 0,
    tax_fee_type: 0,
    is_pick: 0,
    remark: `探嘉BI自动创建: ${shipment.shipmentId} ${nowText}`,
    list: (shipment.items || [])
      .filter((item) => firstText(item.sku) && firstText(item.fnsku) && numberValue(item.shippedQuantity) > 0)
      .map((item) => ({
        seller_id: shipment.sellerId,
        marketplace_id: shipment.marketplaceId,
        shipment_id: shipment.shipmentId,
        fulfillment_network_sku: item.fnsku,
        fnsku: "",
        num: numberValue(item.shippedQuantity),
        box_num: numberValue(item.boxCount),
        sku: item.sku,
        quantity_in_case: numberValue(item.quantityInCase),
        remark: `探嘉BI自动创建: ${shipment.shipmentId}`,
      })),
  };
  if (normalizedWarehouse.wid) payload.wid = normalizedWarehouse.wid;
  else payload.sys_wid = normalizedWarehouse.sysWid;
  return payload;
}

async function findExistingShipmentOrder(adapter, shipmentId) {
  const payload = await adapter.fetchFbaInboundShipmentOrders({
    offset: 0,
    length: 20,
    is_delete: 0,
    senior_search_list: [{ search_field: "shipment_id", search_value: [shipmentId] }],
  });
  return records(payload)[0] || null;
}

function existingOrderResult(shipment, existing) {
  return {
    shipmentId: shipment.shipmentId,
    sid: shipment.sid,
    status: "skipped",
    reason: "已存在发货单",
    orderSn: firstText(existing.shipment_sn),
    orderStatus: existing.status,
    warehouseName: firstText(existing.wname),
  };
}

export async function createReadySendFbaShipmentOrders({
  filters = {},
  shipmentIds = [],
  warehouse = {},
} = {}, {
  adapter = getLingxingAdapter(),
  sellers = [],
  now = () => new Date(),
} = {}) {
  const normalizedWarehouse = normalizeWarehouse(warehouse);
  assertWarehouse(normalizedWarehouse);
  const selected = selectedSet(shipmentIds);
  if (!selected.size) throw new Error("请选择要创建发货单的 FBA 货件。");
  const candidates = await getFbaShipmentCandidates(filters, { adapter, sellers });
  const rows = candidates.rows.filter((row) => selected.has(shipmentRowId(row)));
  if (!rows.length) throw new Error("当前筛选结果中没有找到选中的 FBA 货件。");

  const results = [];
  for (const shipment of rows) {
    const shipmentId = shipment.shipmentId;
    try {
      const errors = validateShipmentForReadySendOrder(shipment);
      if (errors.length) throw new Error(errors.join("；"));
      const existing = await findExistingShipmentOrder(adapter, shipmentId);
      if (existing) {
        results.push(existingOrderResult(shipment, existing));
        console.info("[fba-shipment-order] skipped existing order", { shipmentId, sid: shipment.sid, orderSn: existing.shipment_sn });
        continue;
      }
      const createPayload = buildReadySendOrderPayload({
        warehouse: normalizedWarehouse,
        shipment,
        nowText: now().toISOString(),
      });
      const response = await adapter.createReadySendFbaShipmentOrder(createPayload);
      const orderSn = firstText(response?.data?.order_sn, response?.order_sn);
      results.push({
        shipmentId,
        sid: shipment.sid,
        status: "created",
        orderSn,
        requestId: firstText(response?.request_id, response?.requestId),
      });
      console.info("[fba-shipment-order] created ready-send order", {
        shipmentId,
        sid: shipment.sid,
        orderSn,
        requestId: firstText(response?.request_id, response?.requestId),
      });
    } catch (error) {
      results.push({
        shipmentId,
        sid: shipment.sid,
        status: "failed",
        error: error.message || String(error),
      });
      console.error("[fba-shipment-order] create ready-send order failed", {
        shipmentId,
        sid: shipment.sid,
        error: error.message,
      });
    }
  }

  return resultSummary(results);
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test -- test/fbaShipmentOrderService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/fbaShipmentOrderService.js test/fbaShipmentOrderService.test.js
git commit -m "feat: create fba ready-send shipment order service"
```

## Task 5: FBA Routes and Server Wiring

**Files:**
- Modify: `routes/fba.js`
- Modify: `server.js`

- [ ] **Step 1: Update route dependency destructuring**

In `routes/fba.js`, add these dependencies to the destructuring list in `createFbaRoutes`:

```js
    getFbaShipmentCandidates,
    listFbaShipmentOrderWarehouses,
    createReadySendFbaShipmentOrders,
```

- [ ] **Step 2: Add routes after `/api/fba/freight/shipments`**

Insert:

```js
    {
      method: "GET",
      path: "/api/fba/shipment-candidates",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res, url }) => sendJson(res, 200, await getFbaShipmentCandidates(readFbaFreightFilters(url))),
    },
    {
      method: "GET",
      path: "/api/fba/warehouses",
      auth: "session",
      errorStatusCode: 502,
      handler: async ({ res }) => sendJson(res, 200, await listFbaShipmentOrderWarehouses()),
    },
    {
      method: "POST",
      path: "/api/fba/shipment-orders/create",
      auth: "session",
      errorStatusCode: 400,
      handler: async ({ req, res }) => {
        const body = await readJsonBody(req);
        const result = await createReadySendFbaShipmentOrders({
          filters: body.filters || {},
          shipmentIds: Array.isArray(body.shipmentIds) ? body.shipmentIds : [],
          warehouse: body.warehouse || {},
        });
        sendJson(res, result.ok ? 200 : 207, result);
      },
    },
```

- [ ] **Step 3: Import services in `server.js`**

Add:

```js
import { getFbaShipmentCandidates } from "./src/services/fbaShipmentCandidateService.js";
import {
  createReadySendFbaShipmentOrders,
  listFbaShipmentOrderWarehouses,
} from "./src/services/fbaShipmentOrderService.js";
```

Add these to the `createFbaRoutes` dependency object:

```js
  getFbaShipmentCandidates,
  listFbaShipmentOrderWarehouses,
  createReadySendFbaShipmentOrders,
```

- [ ] **Step 4: Syntax-check route and server**

Run:

```bash
node --check routes/fba.js
node --check server.js
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add routes/fba.js server.js
git commit -m "feat: expose fba shipment order api routes"
```

## Task 6: Logistics Navigation and Shipment Order Markup

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Move freight nav item and add shipment-order nav item**

In `index.html`, remove the `fba-freight` nav item from the “工具” group. Add this new group after the “工具” group:

```html
          <section class="nav-group" aria-label="物流">
            <button class="nav-group-title" type="button" aria-expanded="false">
              <span class="nav-group-icon inventory-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 7h10v10H4z"/><path d="M14 10h4l2 3v4h-6z"/><path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
              </span>
              <span>物流</span>
              <span class="nav-group-caret" aria-hidden="true">⌄</span>
            </button>
            <button class="nav-item" data-view="fba-freight"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="M7 10h10"/><path d="M7 14h6"/><path d="M17 18l3 3"/><path d="M20 18l-3 3"/></svg></span><span class="nav-label">FBA转货代表格</span></button>
            <button class="nav-item" data-view="fba-shipment-order"><span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><path d="M8 7V5h8v2"/><path d="M8 12h5"/><path d="M15 12l2 2 4-5"/></svg></span><span class="nav-label">FBA转发货单</span></button>
          </section>
```

- [ ] **Step 2: Add shipment-order view after `view-fba-freight`**

Add:

```html
        <section class="view" id="view-fba-shipment-order">
          <section class="module-hero">
            <div>
              <span>FBA发货单</span>
              <h2>FBA货件转发货单</h2>
              <p>读取领星 FBA 货件，批量创建领星待发货发货单；第一版不扣减本地仓库存。</p>
            </div>
          </section>
          <article class="panel fba-shipment-order-panel">
            <div class="panel-head">
              <h2>货件筛选</h2>
              <span id="fba-shipment-order-status">等待读取货件</span>
            </div>
            <section class="filter-toolbar fba-shipment-order-toolbar">
              <label>开始日期<input id="fba-shipment-order-start-date" type="date" /></label>
              <label>结束日期<input id="fba-shipment-order-end-date" type="date" /></label>
              <label>店铺<select id="fba-shipment-order-sid"><option value="">全部核心店铺</option></select></label>
              <label>货件单号<input id="fba-shipment-order-shipment-id" placeholder="支持精确搜索" /></label>
              <label>货件状态<select id="fba-shipment-order-status-filter">
                <option value="">全部状态</option>
                <option value="WORKING">WORKING</option>
                <option value="READY_TO_SHIP">READY_TO_SHIP</option>
                <option value="SHIPPED">SHIPPED</option>
                <option value="IN_TRANSIT">IN_TRANSIT</option>
                <option value="DELIVERED">DELIVERED</option>
                <option value="RECEIVING">RECEIVING</option>
                <option value="CLOSED">CLOSED</option>
              </select></label>
              <label>发货仓库<select id="fba-shipment-order-warehouse"><option value="">请选择发货仓库</option></select></label>
              <button class="secondary-button" id="fba-shipment-order-refresh" type="button">读取货件</button>
              <button class="primary-button" id="fba-shipment-order-create" type="button" disabled>批量创建待发货单</button>
            </section>
            <section class="metric-grid fba-shipment-order-summary">
              <article class="metric-tile"><span>货件数</span><strong id="fba-shipment-order-count">0</strong><small>当前筛选</small></article>
              <article class="metric-tile"><span>已选择</span><strong id="fba-shipment-order-selected-count">0</strong><small>准备创建</small></article>
              <article class="metric-tile"><span>发货数量</span><strong id="fba-shipment-order-quantity">0</strong><small>按商品明细汇总</small></article>
            </section>
            <div class="table-shell fba-shipment-order-table-shell">
              <table class="data-table fba-shipment-order-table">
                <thead>
                  <tr>
                    <th><input id="fba-shipment-order-select-all" type="checkbox" aria-label="全选货件" /></th>
                    <th>店铺</th>
                    <th>货件单号</th>
                    <th>货件名称</th>
                    <th>状态</th>
                    <th>SKU数</th>
                    <th>发货数量</th>
                    <th>映射</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody id="fba-shipment-order-table"><tr><td colspan="9">请选择条件后读取货件。</td></tr></tbody>
              </table>
            </div>
          </article>
        </section>
```

- [ ] **Step 3: Syntax-check HTML by starting server in a later verification task**

No separate HTML parser exists in this repo. The browser verification task covers markup errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add logistics navigation and fba shipment order view"
```

## Task 7: FBA Shipment Order Frontend Module

**Files:**
- Create: `assets/js/features/fba-shipment-order.js`
- Modify: `app.js`

- [ ] **Step 1: Create frontend feature module**

Create `assets/js/features/fba-shipment-order.js`:

```js
export function createFbaShipmentOrderFeature({
  root,
  bind,
  closestTarget,
  escapeHtml,
  fallbackFbaShops = [],
  fbaValue,
  fetchImpl,
  formatNumber,
  getFbaShops,
  loadFbaShops,
  renderTableMessage,
  setText,
  confirmImpl,
} = {}) {
  if (!root) throw new Error("createFbaShipmentOrderFeature requires root.");
  if (typeof bind !== "function") throw new Error("createFbaShipmentOrderFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaShipmentOrderFeature requires fetch.");

  let rows = [];
  let warehouses = [];
  let loaded = false;
  let selectedShipmentIds = new Set();
  const statusOptions = ["WORKING", "READY_TO_SHIP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "RECEIVING", "CLOSED"];

  function todayDateText() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function monthStartText() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function setDefaultDates() {
    const start = root.querySelector("#fba-shipment-order-start-date");
    const end = root.querySelector("#fba-shipment-order-end-date");
    if (start && !start.value) start.value = monthStartText();
    if (end && !end.value) end.value = todayDateText();
  }

  function setStatus(message) {
    setText("#fba-shipment-order-status", message, root);
  }

  function rowId(row = {}) {
    return String(row.shipmentId || row.staShipmentId || row.id || "").trim();
  }

  function buildQuery(forceRefresh = false) {
    const params = new URLSearchParams();
    const startDate = fbaValue("#fba-shipment-order-start-date");
    const endDate = fbaValue("#fba-shipment-order-end-date");
    const sid = fbaValue("#fba-shipment-order-sid");
    const shipmentId = fbaValue("#fba-shipment-order-shipment-id");
    const status = fbaValue("#fba-shipment-order-status-filter");
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (sid) params.set("sid", sid);
    if (shipmentId) params.set("shipmentId", shipmentId);
    if (status) params.set("shipmentStatus", status);
    if (forceRefresh) params.set("forceRefresh", "true");
    return params;
  }

  function filtersObject() {
    return Object.fromEntries(buildQuery(false).entries());
  }

  function selectedWarehouse() {
    const value = fbaValue("#fba-shipment-order-warehouse");
    return value ? { sysWid: Number(value) } : {};
  }

  function renderShopOptions() {
    const select = root.querySelector("#fba-shipment-order-sid");
    if (!select) return;
    const shops = typeof getFbaShops === "function" ? getFbaShops() : fallbackFbaShops;
    const current = select.value;
    select.innerHTML = `<option value="">全部核心店铺</option>${shops.map((shop) => {
      const sid = shop.sid || shop.id || "";
      const label = shop.displayName || shop.name || shop.seller || sid;
      return `<option value="${escapeHtml(sid)}">${escapeHtml(label)}</option>`;
    }).join("")}`;
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderWarehouses() {
    const select = root.querySelector("#fba-shipment-order-warehouse");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">请选择发货仓库</option>${warehouses.map((warehouse) =>
      `<option value="${escapeHtml(warehouse.wid)}">${escapeHtml(warehouse.name)}</option>`,
    ).join("")}`;
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
  }

  async function loadWarehouses() {
    const response = await fetchImpl("/api/fba/warehouses");
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "读取仓库失败");
    warehouses = data.warehouses || [];
    renderWarehouses();
  }

  function updateSelectionState() {
    const ids = rows.map(rowId).filter(Boolean);
    const selectedCount = ids.filter((id) => selectedShipmentIds.has(id)).length;
    setText("#fba-shipment-order-count", formatNumber(rows.length), root);
    setText("#fba-shipment-order-selected-count", formatNumber(selectedCount), root);
    setText("#fba-shipment-order-quantity", formatNumber(rows.reduce((sum, row) => sum + Number(row.shippedQuantity || 0), 0)), root);
    const all = root.querySelector("#fba-shipment-order-select-all");
    if (all) {
      all.checked = Boolean(ids.length && selectedCount === ids.length);
      all.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    }
    const createButton = root.querySelector("#fba-shipment-order-create");
    if (createButton) createButton.disabled = selectedCount === 0 || !fbaValue("#fba-shipment-order-warehouse");
  }

  function mappingLabel(row = {}) {
    const missing = [];
    if (!row.sellerId) missing.push("seller_id");
    if (!row.marketplaceId) missing.push("marketplace_id");
    const items = row.items || [];
    if (items.some((item) => !item.sku)) missing.push("SKU");
    if (items.some((item) => !item.fnsku)) missing.push("FNSKU");
    if (items.some((item) => Number(item.shippedQuantity || 0) <= 0)) missing.push("数量");
    return missing.length ? `缺少 ${missing.join("、")}` : "完整";
  }

  function renderRows() {
    const tbody = root.querySelector("#fba-shipment-order-table");
    if (!tbody) return;
    if (!rows.length) {
      renderTableMessage(tbody, 9, "没有匹配的 FBA 货件。");
      updateSelectionState();
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const id = rowId(row);
      const itemCount = (row.items || []).length;
      return `
        <tr>
          <td><input class="fba-shipment-order-row-check" type="checkbox" data-fba-shipment-order-select="${escapeHtml(id)}" ${selectedShipmentIds.has(id) ? "checked" : ""} aria-label="选择货件 ${escapeHtml(row.shipmentId || "")}" /></td>
          <td>${escapeHtml(row.storeName || row.sid || "-")}</td>
          <td><strong>${escapeHtml(row.shipmentId || row.staShipmentId || "-")}</strong></td>
          <td>${escapeHtml(row.shipmentName || "-")}</td>
          <td><span class="risk-badge">${escapeHtml(row.shipmentStatus || "-")}</span></td>
          <td>${formatNumber(itemCount)}</td>
          <td>${formatNumber(row.shippedQuantity || 0)}</td>
          <td>${escapeHtml(mappingLabel(row))}</td>
          <td data-fba-shipment-order-result="${escapeHtml(id)}">-</td>
        </tr>`;
    }).join("");
    updateSelectionState();
  }

  async function loadShipmentOrders(forceRefresh = false) {
    setDefaultDates();
    setStatus("正在读取 FBA 货件...");
    try {
      const response = await fetchImpl(`/api/fba/shipment-candidates?${buildQuery(forceRefresh).toString()}`);
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "读取 FBA 货件失败");
      rows = data.rows || [];
      selectedShipmentIds = new Set();
      loaded = true;
      renderRows();
      setStatus(`已读取 ${formatNumber(rows.length)} 个货件${data.cache?.hit ? "（缓存）" : ""}`);
    } catch (error) {
      rows = [];
      selectedShipmentIds = new Set();
      renderRows();
      setStatus(`读取失败：${error.message || error}`);
    }
  }

  function setResultCell(result = {}) {
    const id = result.shipmentId;
    const cell = root.querySelector(`[data-fba-shipment-order-result="${CSS.escape(id)}"]`);
    if (!cell) return;
    if (result.status === "created") cell.textContent = `已创建 ${result.orderSn || ""}`.trim();
    else if (result.status === "skipped") cell.textContent = `已跳过：${result.reason || ""} ${result.orderSn || ""}`.trim();
    else cell.textContent = `失败：${result.error || "未知错误"}`;
  }

  async function createOrders() {
    const ids = [...selectedShipmentIds];
    if (!ids.length) {
      setStatus("请先勾选要创建发货单的货件。");
      return;
    }
    const warehouse = selectedWarehouse();
    if (!warehouse.sysWid && !warehouse.wid) {
      setStatus("请先选择发货仓库。");
      updateSelectionState();
      return;
    }
    const confirmed = confirmImpl(`确认创建 ${ids.length} 个待发货发货单？第一版只创建待发货单，不扣减库存。`);
    if (!confirmed) return;
    setStatus("正在串行创建待发货单...");
    try {
      const response = await fetchImpl("/api/fba/shipment-orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: filtersObject(), shipmentIds: ids, warehouse }),
      });
      const data = await response.json();
      if (!response.ok && !data.results) throw new Error(data.error || "创建发货单失败");
      (data.results || []).forEach(setResultCell);
      setStatus(`创建完成：成功 ${formatNumber(data.createdCount || 0)}，跳过 ${formatNumber(data.skippedCount || 0)}，失败 ${formatNumber(data.failedCount || 0)}`);
    } catch (error) {
      setStatus(`创建失败：${error.message || error}`);
    }
  }

  async function loadInitial() {
    setDefaultDates();
    await Promise.allSettled([loadFbaShops(), loadWarehouses()]);
    renderShopOptions();
    if (!loaded) await loadShipmentOrders(false);
    else renderRows();
  }

  function setupFbaShipmentOrder() {
    bind(root, "#fba-shipment-order-refresh", "click", () => loadShipmentOrders(true));
    bind(root, "#fba-shipment-order-create", "click", createOrders);
    bind(root, "#fba-shipment-order-warehouse", "change", updateSelectionState);
    bind(root, "#fba-shipment-order-select-all", "change", (event) => {
      const ids = rows.map(rowId).filter(Boolean);
      selectedShipmentIds = event.target.checked ? new Set(ids) : new Set();
      renderRows();
    });
    bind(root, "#fba-shipment-order-table", "change", (event) => {
      const checkbox = closestTarget(event, "[data-fba-shipment-order-select]");
      if (!checkbox) return;
      const id = checkbox.dataset.fbaShipmentOrderSelect;
      if (checkbox.checked) selectedShipmentIds.add(id);
      else selectedShipmentIds.delete(id);
      updateSelectionState();
    });
  }

  return {
    loadFbaShipmentOrderInitial: loadInitial,
    renderFbaShipmentOrderShopOptions: renderShopOptions,
    setupFbaShipmentOrder,
  };
}
```

- [ ] **Step 2: Wire module in `app.js`**

Add import near FBA imports:

```js
import { createFbaShipmentOrderFeature } from "./assets/js/features/fba-shipment-order.js?v=20260711-fba-logistics-v1";
```

Add variable declarations near existing FBA freight declarations:

```js
let loadFbaShipmentOrderInitial = async () => {};
let renderFbaShipmentOrderShopOptions = () => {};
let setupFbaShipmentOrder = () => {};
```

Update the `createFbaShopsFeature` `onShopListChange` callback to call both renderers:

```js
  onShopListChange: () => {
    renderFbaFreightShopOptions();
    renderFbaShipmentOrderShopOptions();
  },
```

Instantiate after freight feature:

```js
({ loadFbaShipmentOrderInitial, renderFbaShipmentOrderShopOptions, setupFbaShipmentOrder } = createFbaShipmentOrderFeature({
  root: document,
  bind,
  closestTarget,
  escapeHtml,
  fallbackFbaShops: getFallbackFbaShops(),
  fbaValue,
  fetchImpl: fetch.bind(window),
  formatNumber,
  getFbaShops,
  loadFbaShops,
  renderTableMessage,
  setText,
  confirmImpl: confirm.bind(window),
}));
```

Add navigation load case:

```js
    if (view === "fba-shipment-order") {
      await loadFbaShipmentOrderInitial();
    }
```

Add setup call near `setupFbaFreight()`:

```js
  setupFbaShipmentOrder();
```

- [ ] **Step 3: Syntax-check frontend files**

Run:

```bash
node --check assets/js/features/fba-shipment-order.js
node --check app.js
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add assets/js/features/fba-shipment-order.js app.js
git commit -m "feat: add fba shipment order frontend module"
```

## Task 8: CSS Source and Check Script Coverage

**Files:**
- Create: `assets/css/pages/36-fba-shipment-order.css`
- Modify: `package.json`

- [ ] **Step 1: Add page CSS source**

Create `assets/css/pages/36-fba-shipment-order.css`:

```css
.fba-shipment-order-panel {
  display: grid;
  gap: var(--space-4);
}

.fba-shipment-order-toolbar {
  align-items: end;
}

.fba-shipment-order-toolbar label {
  min-width: 150px;
}

.fba-shipment-order-toolbar select,
.fba-shipment-order-toolbar input {
  min-width: 0;
}

.fba-shipment-order-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fba-shipment-order-table-shell {
  overflow-x: auto;
}

.fba-shipment-order-table {
  min-width: 980px;
}

.fba-shipment-order-table th:first-child,
.fba-shipment-order-table td:first-child {
  width: 44px;
  text-align: center;
}

.fba-shipment-order-table td[data-fba-shipment-order-result] {
  min-width: 180px;
  white-space: normal;
}

@media (max-width: 760px) {
  .fba-shipment-order-summary {
    grid-template-columns: 1fr;
  }

  .fba-shipment-order-toolbar label {
    min-width: 100%;
  }
}
```

- [ ] **Step 2: Add new JS files to package checks**

In `package.json`, add `node --check assets/js/features/fba-shipment-order.js` to both `check:js` and `check` next to `fba-freight.js`.

Also add:

```bash
node --check src/services/fbaShipmentCandidateService.js
node --check src/services/fbaShipmentOrderService.js
```

to both `check:js` and `check` before the `src/adapters/lingxing/*.js` loop.

- [ ] **Step 3: Run syntax and CSS checks**

Run:

```bash
npm run check:js
npm run build:css -- --check
```

Expected:

- `npm run check:js` exits 0.
- `npm run build:css -- --check` exits 0 or prints the existing visual lock skip message.

- [ ] **Step 4: Commit**

```bash
git add assets/css/pages/36-fba-shipment-order.css package.json
git commit -m "chore: cover fba shipment order assets in checks"
```

## Task 9: Full Test and Browser Verification

**Files:**
- No planned source edits unless verification finds a concrete issue.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
npm run check:js
npm run build:css -- --check
```

Expected: all tests pass, syntax check exits 0, CSS check exits 0 or prints the existing visual lock skip message.

- [ ] **Step 2: Start local server**

Run:

```bash
npm run dev
```

Expected: server starts without import errors. Keep the session running for browser checks.

- [ ] **Step 3: Browser verification**

Use the in-app browser or Playwright against the local server URL.

Verify:

1. Sidebar has a “物流” group.
2. “物流” group contains “FBA转货代表格” and “FBA转发货单”.
3. Existing freight page opens and still shows its filters/table.
4. New shipment-order page opens.
5. Warehouse dropdown is present.
6. Create button is disabled before selecting rows and warehouse.
7. Desktop viewport has no obvious overlapping text.
8. Narrow viewport keeps controls readable and table scrolls horizontally.

- [ ] **Step 4: Stop local server**

Stop the dev server session cleanly with Ctrl-C.

- [ ] **Step 5: Commit verification fixes if any**

If browser verification required source fixes:

```bash
git add index.html app.js assets/js/features/fba-shipment-order.js assets/css/pages/36-fba-shipment-order.css
git commit -m "fix: polish fba logistics shipment order ui"
```

If no fixes were required, do not create an empty commit.

## Self-Review

Spec coverage:

- “物流”一级板块 is covered by Task 6.
- Existing freight page migration is covered by Tasks 2 and 6.
- New FBA shipment-order page is covered by Tasks 4, 5, 7, and 8.
- Shared FBA shipment cache is covered by Tasks 1 and 2.
- First version creates only ready-send orders and does not deduct inventory is covered by Tasks 4 and 7.
- Duplicate checking by `shipment_id` is covered by Task 4.
- Serial batch behavior is covered by Task 4.
- Observability is covered by Task 4 service logs.
- Syntax, automated tests, and browser verification are covered by Tasks 8 and 9.

Placeholder scan:

- This plan intentionally contains no placeholder tokens or unspecified implementation steps.

Type consistency:

- Frontend view id is `fba-shipment-order`.
- Backend route prefix is `/api/fba/shipment-orders`.
- Warehouse payload uses `{ sysWid }` from frontend and maps to `sys_wid` in service.
- Shipment candidate fields `sellerId` and `marketplaceId` are produced in Task 1 and consumed in Task 4.

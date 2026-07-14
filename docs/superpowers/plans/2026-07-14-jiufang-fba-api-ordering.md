# Jiufang FBA API Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BI FBA freight shipments submit a selected shipment to Jiufang Logistics API and persist the returned Jiufang order number back into the BI workflow.

**Architecture:** Reuse the existing FBA freight candidate pipeline, box-detail lookup, SKU catalog enrichment, and frontend selection state. Add a Jiufang adapter plus a shipment-order composition service that builds an observable dry-run payload, validates all required fields, calls Jiufang only after explicit confirmation, and records the result per shipment. Credentials stay in environment variables and are never hard-coded.

**Tech Stack:** Node.js ESM, native HTML/CSS/JS, existing Lingxing adapter, Jiufang REST API, Node test runner, existing `routes/fba.js` and `assets/js/features/fba-freight.js`.

---

## Current System

- Existing FBA freight view: `assets/js/features/fba-freight.js`
- Existing FBA route group: `routes/fba.js`
- Existing candidate/normalization service: `src/services/fbaShipmentCandidateService.js`
- Existing freight template and box normalization service: `src/services/fbaFreightSheetService.js`
- Existing Lingxing ready-send order service: `src/services/fbaShipmentOrderService.js`
- Existing Jiufang Excel template: `assets/freight-templates/jiufang.xlsx`
- Do not modify unrelated dashboard, sales, inventory, CSS migration, or existing dirty worktree changes unless the implementation requires a direct integration point.

## Jiufang API Decisions

- Base URL: `https://cgi.jiufanglogistics.cn/api/`
- Authentication: `Authorization: Bearer <token>` header plus request-body `Security`.
- Password handling: Jiufang docs require `Security.Password` as MD5 32-bit lowercase for rate/order endpoints. Store only `JIUFANG_PASSWORD_MD5`; do not store raw passwords in the repository.
- MVP endpoint candidate: `POST /v3/shipment?lang=zh_CN`, because it maps directly to FBA shipment fields: `ShipmentRequest.ReferenceNumber`, `Service.Code`, `ShipFrom`, `ShipTo`, `Packages`, `Invoices`, `ShipmentServiceOptions`.
- Discovery endpoint: `POST /v3/product?lang=zh_CN` for channels and `POST /v3/product/rate?lang=zh_CN` for quotation.
- HD/清提派 endpoint: `POST /v3/saveDeQingtiPaiWaybillHdV2?lang=zh_CN` is a second phase only if Jiufang confirms this account must create HD orders. It needs extra master-order fields such as `palceOrderWay`, ports, cabinet type, and delivery method.

## Data Mapping

- `ShipmentRequest.ReferenceNumber.Value`: BI shipment ID, normally `shipment.shipmentId`.
- `ShipmentRequest.Qty`: total box count from normalized box payloads, not SKU line count.
- `ShipmentRequest.Service.Code`: selected Jiufang channel code, not a hard-coded value.
- `ShipmentRequest.ShipFrom`: configured sender profile from env/config UI.
- `ShipmentRequest.ShipTo`: Amazon warehouse address from Lingxing shipment address plus `DestinationFulfillmentCenterId`.
- `ShipmentRequest.Packages[]`: one row per box; weight and dimensions in KG/CM.
- `Packages[].BoxMark.FbaBoxNumber`: FBA box number when available, otherwise a deterministic generated box mark.
- `Packages[].PackageDetails[]`: SKU and quantity per box from normal box info.
- `ShipmentRequest.Invoices[]`: one row per SKU, enriched from product catalog and freight lines.
- `InvoiceLineTotal`: sum of declaration value times quantity.
- `ShipmentServiceOptions`: defaults configurable; initial values `PickUp=false`, `Dropoff=true`, `DeliveryTerms=DDP`, `Fba=true`, `Tax=true`, `AmazonWarehouseCode=<FC code>`.

## Task 1: Safety Branch And Secret Configuration

**Files:**
- Modify: `.env.example`
- Modify: `src/config/index.js`
- Test: `test/jiufangAdapter.test.js`

- [x] Create/switch to `codex/jiufang-fba-api-ordering`.
- [x] Add env keys: `JIUFANG_API_BASE_URL`, `JIUFANG_USERNAME`, `JIUFANG_PASSWORD_MD5`, `JIUFANG_TOKEN`, `JIUFANG_DEFAULT_DEPARTURE_CODE`, `JIUFANG_DEFAULT_SERVICE_CODE`.
- [x] Add `getConfig().jiufang` with required config validation.
- [x] Add tests that config exposes no raw password field.

## Task 2: Jiufang Adapter

**Files:**
- Create: `src/adapters/jiufangAdapter.js`
- Test: `test/jiufangAdapter.test.js`

- [x] Implement `JiufangApiError` carrying `endpoint`, `status`, `code`, `description`, and a redacted payload summary.
- [x] Implement `requestJiufang(endpoint, body, options)` with timeout, JSON parsing, `Authorization: Bearer`, and no silent fallback.
- [x] Treat Jiufang `ResponseStatus.Description !== "Success"` or returned `Error` as failure.
- [x] Add methods: `listProducts`, `rateProduct`, `createShipment`, and later optional `initHdOrder`, `createHdOrder`.
- [x] Log request ID/correlation ID, endpoint, shipment ID, channel code, response status, and Jiufang order number; never log token or password hash.

## Task 3: Payload Builder And Validation

**Files:**
- Create: `src/services/jiufangFbaOrderService.js`
- Test: `test/jiufangFbaOrderService.test.js`

- [x] Build `validateJiufangOrderInput(shipment, boxes, config)` and fail fast on missing channel, warehouse, sender, SKU declaration fields, box weight/dimensions, or destination address.
- [x] Build `buildJiufangShipmentPayload({ shipment, boxes, channelCode, senderProfile, options })`.
- [x] Reuse `normalizeForwarderLines`/box data from `fbaFreightSheetService` rather than re-parsing Lingxing data.
- [x] Produce a dry-run summary with box count, SKU count, invoice total, total KG, total CBM, channel code, warehouse code, and missing-field list.
- [x] Add idempotency guard: do not call Jiufang if the shipment already has a stored Jiufang order number unless user explicitly forces retry.

## Task 4: Backend Routes

**Files:**
- Modify: `routes/fba.js`
- Modify: `server.js`
- Test: `test/serverRoutesStructure.test.js`
- Test: `test/jiufangFbaOrderService.test.js`

- [x] Add `POST /api/fba/jiufang/orders/dry-run`.
- [x] Add `POST /api/fba/jiufang/orders/create`.
- [x] Add `GET /api/fba/jiufang/channels`.
- [x] Route body must include selected shipment IDs, current filters, channel code, and explicit confirmation flag for create.
- [x] Return per-shipment results: `ready`, `created`, `skipped`, or `failed`, with clear error messages and no partial hiding.

## Task 5: Persist Jiufang Order State

**Files:**
- Create or modify a focused JSON store under `src/utils/jsonStore.js` usage
- Create: `src/services/jiufangOrderStore.js`
- Test: `test/jiufangOrderStore.test.js`

- [x] Store by shipment ID: Jiufang order number, channel code, request summary, response charge summary, operator, createdAt, and lastError.
- [x] Store only redacted payloads.
- [x] Add lookup helper used by the idempotency guard and frontend display.

## Task 6: Frontend Integration

**Files:**
- Modify: `assets/js/features/fba-freight.js`
- Modify: `index.html`
- Modify: `assets/css/pages/35-fba-freight.css`
- Test: `test/fbaFreightFeature.test.js`

- [x] Add channel selector loaded from `/api/fba/jiufang/channels`.
- [x] Add `九方下单预检` button that calls dry-run and opens a confirmation modal.
- [x] Add `确认提交九方` button inside the modal; it must be disabled if dry-run has missing required fields.
- [x] Render per-row Jiufang status beside existing “转发货单” result.
- [x] Keep existing “转表格”和“转发货单” flows unchanged.

## Task 7: Observability And Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `.env.example`
- Create or modify: `docs/jiufang-fba-api-ordering.md`

- [x] Document Jiufang API direction, env vars, endpoint choice, and dry-run/create workflow.
- [x] Update `AGENTS.md` because the BI product direction changes from internal Lingxing-only workflow to external logistics API ordering.
- [x] Add operator-facing troubleshooting: missing SKU declaration, missing box dimensions, Jiufang validation error, duplicate order, and timeout.

## Task 8: Verification

**Commands:**
- `npm test -- test/jiufangAdapter.test.js test/jiufangFbaOrderService.test.js test/fbaFreightFeature.test.js`
- `npm run check:js`
- Browser verification on the FBA freight view.

- [ ] Unit tests cover successful payload build, missing required fields, Jiufang error response, duplicate shipment guard, and redacted logs.
- [ ] Manual dry-run with one real FBA shipment.
- [ ] Only after dry-run is correct, submit one low-risk real shipment to Jiufang.
- [ ] Verify returned Jiufang order number appears in BI and in Jiufang website.
- [ ] If successful, optionally call Lingxing update logistics to write Jiufang order/tracking info back to the existing Lingxing shipment order.

## Open Questions Before Implementation

1. Which Jiufang channel code should be the default for US/CA/AU FBA orders?
2. Is the business flow ordinary Jiufang `/v3/shipment`, or does this customer account require 清提派 HD `/v3/saveDeQingtiPaiWaybillHdV2`?
3. What sender profile should be used: company CN/EN name, contact, phone, address, enterprise credit code, departure code?
4. Which SKU declaration fields are mandatory for current products: Chinese name, English name, HS code, customs clearance code, brand, material, purpose, unit, declared value?
5. Should successful Jiufang order creation also immediately update Lingxing head logistics, or only store the Jiufang order number in BI first?

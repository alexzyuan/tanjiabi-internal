# Shipment Variance Follow-up Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add default `RECEIVING`/`CLOSED` filtering and a persisted, status-based follow-up dialog to the FBA shipment variance board.

**Architecture:** Keep the existing shipment variance service as the source of ERP status filtering and variance computation. Extend the dedicated JSON follow-up store with an explicit `followupStatus`, then have the existing FBA routes persist it using the authenticated operator. The frontend feature owns the multi-select state, follow-up modal and table rendering; `app.js` only supplies the current authenticated user.

**Tech Stack:** Native HTML/CSS/ES modules, Node.js services and `node:test`.

---

### Task 1: Persist an explicit follow-up status

**Files:**
- Modify: `src/services/fbaShipmentVarianceFollowupStore.js`
- Modify: `src/services/fbaShipmentVarianceService.js`
- Modify: `test/fbaShipmentVarianceFollowupStore.test.js`
- Modify: `test/fbaShipmentVarianceService.test.js`

- [ ] **Step 1: Write failing tests** that mark a shipment as `调查中`, verify its status and operator are retained, and verify a status filter returns that row.
- [ ] **Step 2: Run** `node --test test/fbaShipmentVarianceFollowupStore.test.js test/fbaShipmentVarianceService.test.js` and confirm the new assertions fail.
- [ ] **Step 3: Implement** the four valid values (`已跟进`, `调查中`, `已理赔`, `无需处理`), reject any other value, save `followupStatus`, and surface it as `row.followup.status`.
- [ ] **Step 4: Implement** default shipment statuses `RECEIVING,CLOSED` in the variance filter normalizer and filter the ERP rows before summary calculation.
- [ ] **Step 5: Re-run** the two tests and commit `feat: persist shipment variance follow-up statuses`.

### Task 2: Expose status through the authenticated API

**Files:**
- Modify: `routes/fba.js`
- Modify: `test/fbaShipmentVarianceRoutes.test.js`

- [ ] **Step 1: Write a failing route test** for a `PUT` request body `{ "followupStatus": "调查中" }` and assert the server supplies the authenticated display name.
- [ ] **Step 2: Run** `node --test test/fbaShipmentVarianceRoutes.test.js` and confirm failure.
- [ ] **Step 3: Implement** body parsing in the follow-up route and pass `followupStatus` to `markFbaShipmentVarianceFollowup`; retain DELETE as the explicit removal operation.
- [ ] **Step 4: Re-run** the route test and commit `feat: accept shipment variance follow-up status`.

### Task 3: Replace table actions with a status follow-up dialog

**Files:**
- Modify: `index.html`
- Modify: `assets/js/features/fba-shipment-variance.js`
- Modify: `app.js`
- Modify: `assets/css/pages/38-fba-shipment-variance.css`
- Modify: `test/fbaShipmentVarianceFeature.test.js`

- [ ] **Step 1: Write a failing feature test** that verifies the default query includes both statuses, a row has only a `跟进` action, and saving the dialog sends its selected status.
- [ ] **Step 2: Run** `node --test test/fbaShipmentVarianceFeature.test.js` and confirm failure.
- [ ] **Step 3: Implement** a visible state filter whose initial value is `RECEIVING,CLOSED`; include it as `shipmentStatus` in the list request.
- [ ] **Step 4: Implement** a modal with a read-only current user name and a native status `<select>` initialized to the saved value or `已跟进`; remove the SKU-detail action and modal.
- [ ] **Step 5: Pass** `getCurrentAuthUser` from `app.js`, save only after modal confirmation, then refresh the table.
- [ ] **Step 6: Rebuild** CSS with `npm run build:css`, re-run the feature test, and commit `feat: add shipment variance follow-up dialog`.

### Task 4: Verify integration

**Files:**
- Modify: `test/frontendStructure.test.js` only if the durable view metadata contract needs an assertion.

- [ ] **Step 1: Run** `node --test test/fbaShipmentVariance*.test.js test/frontendStructure.test.js test/stylesStructure.test.js`.
- [ ] **Step 2: Run** `npm test`; record any pre-existing failures separately from this feature.
- [ ] **Step 3: Start the local server and use the browser** to verify the default status filter, dialog keyboard focus, operator display, saving, and a narrow viewport table scroll.
- [ ] **Step 4: Commit** any verification-only test update with `test: cover shipment variance follow-up status UI`.

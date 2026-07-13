# 运费看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logistics `运费看板` view where the team can maintain weekly freight rates for later FBA shipment order cost matching.

**Architecture:** Backend owns validation and local JSON persistence in a focused service. FBA routes expose CRUD endpoints. Frontend owns table rendering and row actions in a focused feature module; app.js only wires the module and navigation.

**Tech Stack:** Node.js native test runner, native HTML/CSS/JS modules, local JSON persistence through `src/utils/jsonStore.js`.

---

### Task 1: Backend Service

**Files:**
- Create: `src/services/freightRateService.js`
- Test: `test/freightRateService.test.js`

- [ ] Write failing tests for ISO week generation, duplicate key rejection, validation, and sorted listing.
- [ ] Implement `normalizeFreightRateRow`, `listFreightRates`, `saveFreightRate`, and `deleteFreightRate`.
- [ ] Run `node --test test/freightRateService.test.js`.

### Task 2: API Routes

**Files:**
- Modify: `routes/fba.js`
- Modify: `server.js`

- [ ] Add `/api/fba/freight-rates` GET and POST routes.
- [ ] Add `/api/fba/freight-rates/:id` PUT and DELETE routes.
- [ ] Wire service functions through `server.js` route dependencies.

### Task 3: Frontend View

**Files:**
- Create: `assets/js/features/freight-rates.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `assets/js/features/breadcrumb-shell.js`
- Modify: `assets/js/features/home-quick-links.js`
- Test: `test/frontendStructure.test.js`

- [ ] Add the logistics nav item and `view-freight-rates` markup.
- [ ] Add a feature module that loads rates, renders week divider rows, and supports add/edit/delete/save.
- [ ] Wire app navigation to load the view.
- [ ] Add frontend structure assertions.

### Task 4: Verification

**Files:**
- Existing test and app files.

- [ ] Run targeted tests.
- [ ] Run `npm run check:js`.
- [ ] Start the local server and verify the new view renders without console errors.

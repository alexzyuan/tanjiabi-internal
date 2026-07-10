# 站外售后邮箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `售后 > 站外售后邮箱` with IMAP inbox sync, SMTP replies, Gemini AI reply suggestions, and daily inspection reminders.

**Architecture:** Add focused backend services for Gemini and mailbox operations, then expose small JSON APIs through `server.js`. The native HTML/CSS/JS frontend gets a first-class view wired into the existing sidebar, breadcrumbs, and lazy-load routing. Store inspection imports the mailbox summary and reports new/pending email risk without sending replies automatically.

**Tech Stack:** Node.js ESM, native `http` server, native HTML/CSS/JS, `node:test`, `imapflow`, `mailparser`, `nodemailer`, Google Gemini REST API, existing `data-cache` JSON files.

---

## File Structure

- Create `src/services/geminiService.js`: shared Gemini text generation and售后 reply suggestion logic.
- Create `src/services/aftersalesMailService.js`: IMAP sync, SMTP reply, local cache, status updates, and inspection summary.
- Create `test/geminiService.test.js`: validates Gemini request shaping and disabled behavior.
- Create `test/aftersalesMailService.test.js`: validates mail normalization, status summaries, and reply payload construction without network.
- Modify `src/config/index.js`: add `ai.gemini` and `aftersalesMail`; stop using `ai.mimo`.
- Modify `src/services/aiListingService.js`: move existing AI Listing generation from MiMo config shape to Gemini service.
- Modify `server.js`: add aftersales mail APIs and route AI Listing through Gemini config.
- Modify `src/services/storeInspectionService.js`: add `站外售后邮箱` check to run result, markdown, and DingTalk content.
- Modify `index.html`: add sidebar entry and `view-aftersales-mail`.
- Modify `app.js`: add catalog entry, breadcrumbs, view loading, API calls, table/detail rendering, AI suggestion and reply handlers.
- Modify `styles.css`: add responsive mailbox page styles using existing Spectrum tokens.
- Modify `package.json`: add `imapflow`, `mailparser`, and `nodemailer`.

## Task 1: Gemini Service

**Files:**
- Create: `test/geminiService.test.js`
- Create: `src/services/geminiService.js`
- Modify: `src/config/index.js`
- Modify: `src/services/aiListingService.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing Gemini tests**

Create `test/geminiService.test.js` with tests for disabled config, request URL/header/body, and JSON output extraction.

- [ ] **Step 2: Run failing test**

Run: `node --test test/geminiService.test.js`

Expected: FAIL because `src/services/geminiService.js` does not exist.

- [ ] **Step 3: Implement Gemini service**

Add `generateGeminiText`, `generateAftersalesReplySuggestion`, and `generateGeminiListingCopy`. Use `fetch` injection for tests, `x-goog-api-key`, and a default model from config.

- [ ] **Step 4: Wire config and AI Listing**

Add `config.ai.gemini` in `src/config/index.js`. Update `server.js` and `src/services/aiListingService.js` so AI Listing uses Gemini and no longer references `config.ai.mimo`.

- [ ] **Step 5: Verify**

Run:

```bash
node --test test/geminiService.test.js
npm run check
```

Expected: tests pass and syntax check exits 0.

## Task 2: Mail Service

**Files:**
- Create: `test/aftersalesMailService.test.js`
- Create: `src/services/aftersalesMailService.js`
- Modify: `src/config/index.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing mail service tests**

Create tests for `normalizeMailRecord`, `summarizeMailRows`, and `buildReplyMessage`.

- [ ] **Step 2: Run failing test**

Run: `node --test test/aftersalesMailService.test.js`

Expected: FAIL because the service exports are missing.

- [ ] **Step 3: Add dependencies**

Run:

```bash
npm install imapflow mailparser nodemailer
```

- [ ] **Step 4: Implement mail service**

Implement data-cache reads/writes, IMAP sync, SMTP reply, dashboard loading, detail loading, status updates, and inspection summary. Keep network operations behind config checks so unconfigured environments remain usable.

- [ ] **Step 5: Verify**

Run:

```bash
node --test test/aftersalesMailService.test.js
npm run check
```

Expected: tests pass and syntax check exits 0.

## Task 3: APIs

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add API routes**

Add routes for dashboard, sync, message detail, AI suggestion, reply, and status update under `/api/aftersales-mail`.

- [ ] **Step 2: Verify route syntax**

Run: `node --check server.js`

Expected: exit 0.

## Task 4: Store Inspection Integration

**Files:**
- Modify: `src/services/storeInspectionService.js`

- [ ] **Step 1: Add failing inspection behavior test if practical**

If the service can be imported without external config side effects, add a focused test for mailbox inspection summary formatting. If not practical in this repo structure, verify through `npm run check` and local API response.

- [ ] **Step 2: Add mailbox check**

Import `getAftersalesMailInspectionSummary`, include it in `runStoreInspection`, `runMockInspection`, `buildChecks`, Markdown output, table rows, and DingTalk summary.

- [ ] **Step 3: Verify**

Run:

```bash
node --check src/services/storeInspectionService.js
npm run check
```

Expected: exit 0.

## Task 5: Frontend Page

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

- [ ] **Step 1: Add page shell**

Add sidebar entry under new `售后` group and a `view-aftersales-mail` section with hero, filters, KPI tiles, mail list, detail panel, AI suggestion, and reply composer.

- [ ] **Step 2: Add app logic**

Add catalog/breadcrumb entries, load-on-view routing, dashboard fetch, sync, row selection, detail fetch, AI suggestion generation, reply submit, and status update handlers.

- [ ] **Step 3: Add styles**

Use existing `--spectrum-*` tokens and current panel/table density. Make detail layout responsive.

- [ ] **Step 4: Verify**

Run:

```bash
node --check app.js
npm run check
```

Expected: exit 0.

## Task 6: End-to-End Verification

**Files:**
- All modified files

- [ ] **Step 1: Full automated verification**

Run:

```bash
npm test
npm run check
```

Expected: all tests pass and syntax check exits 0.

- [ ] **Step 2: Local server smoke test**

Run `npm run dev`, open the app, and verify the `售后 > 站外售后邮箱` page renders without console errors. In an unconfigured environment, verify it shows a clear mailbox-not-configured state and manual reply controls remain disabled until a message exists.

- [ ] **Step 3: Deployment note**

Document required `.env` keys in final response. Because this checkout is not a Git repository, skip commit steps and report that commits were not possible.

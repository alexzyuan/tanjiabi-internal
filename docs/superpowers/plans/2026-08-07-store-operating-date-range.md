# 店铺经营月报日期范围 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace monthly report month inputs with a precise cross-month date range, capped at 12 calendar months and aligned with Lingxing's date scope.

**Architecture:** Reuse the shared dual-month date picker with a configurable calendar-month span. The report feature stores `startDate/endDate`, while the service derives affected months and requests each month's exact first/last boundaries.

**Tech Stack:** Native HTML, ES modules, Node.js HTTP service, Node test runner, existing CSS token sources.

---

### Task 1: Date range contract

**Files:** `assets/js/date-range-picker.js`, `test/dateRangePicker.test.js`

- [ ] Add a configurable `maxCalendarMonths` option, defaulting to existing 30-day behavior for other consumers.
- [ ] Add tests proving a 12-calendar-month range is selectable and a 13-calendar-month range is disabled.
- [ ] Run the focused picker tests and confirm the new tests fail before implementation, then pass.

### Task 2: Backend exact-date monthly aggregation

**Files:** `src/services/storeOperatingMonthlyReportService.js`, `routes/finance-purchase.js`, `test/storeOperatingMonthlyReportService.test.js`

- [ ] Accept and validate `startDate/endDate`, including today upper bound and a maximum 12-calendar-month span.
- [ ] Keep derived `months` for budget lookup and split each OrderProfit/custom-fee request into exact partial-month boundaries.
- [ ] Preserve legacy month filters only where existing callers/tests still require them, with an explicit normalized date range.
- [ ] Add failing tests for an August 1-7 request and a cross-month request, then implement and run focused tests.

### Task 3: Frontend date range integration

**Files:** `index.html`, `assets/js/features/store-operating-monthly-report.js`, `app.js`, `assets/css/pages/56-store-operating-monthly-report.css`, `test/storeOperatingMonthlyReportFeature.test.js`

- [ ] Replace month inputs with the shared date-range control and hidden date inputs.
- [ ] Initialize current month 1st through today, read/write `startDate/endDate` URL params, and send exact dates to report/export APIs.
- [ ] Configure picker with 12 calendar months and bind its completion event to automatic query; validate manual harness changes.
- [ ] Update headings, budget deep links, reset behavior, and tests to use date ranges.

### Task 4: Verification

**Files:** generated `styles.css` only through `npm run build:css`

- [ ] Run `npm test`, `npm run check`, and the browser CSS verification.
- [ ] Start the local server, verify the report page, date picker interaction, exact request parameters, and desktop/narrow viewport screenshots.
- [ ] Review the diff for unrelated changes and commit the feature branch.

# 店铺经营月报店铺维度利润报表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将店铺经营月报实际值切换到领星店铺维度利润报表，并接入官方费用字段与自定义费用明细。

**Architecture:** 适配器负责店铺利润和费用明细的分页、缓存与字段翻译；月报服务按月加载两类来源并按店铺/国家作用域合并；现有 mapper 继续负责科目计算和可用性。店铺利润接口使用双闭区间月份参数，不复用 MSKU 的结束日期加一天逻辑。

**Tech Stack:** Node.js ES modules, node:test, 现有 Lingxing signed adapter/cache/service 层。

---

### Task 1: Lock the store-profit contract with failing tests

**Files:**
- Modify: `test/lingxingAdapter.test.js`
- Modify: `test/storeOperatingMonthlyReportMapper.test.js`
- Modify: `test/storeOperatingMonthlyReportService.test.js`

- [ ] **Step 1: Add a failing adapter test**

Assert that `fetchSellerProfitReport` sends `monthlyQuery: true`, `summaryEnabled: true`, `sids`, `currencyCode`, and does not change an inclusive month end date.

- [ ] **Step 2: Add a failing mapper test**

Pass one normalized store record with `totalAdsCost`, `promotionFee`, `sharedFbaIntegerernationalInboundFee`, `sharedFbaInboundConvenienceFee`, `adjustments`, and `totalPlatformOtherFee`; assert the six monthly rows contain positive expense magnitudes and the platform subtotal includes them.

- [ ] **Step 3: Add a failing service test**

Provide an adapter with `fetchSellerProfitReport` returning one row per store and assert the monthly report calls it once per selected month and does not call `fetchMskuOrderProfitCached`.

- [ ] **Step 4: Run focused tests and verify the failures are contract failures**

Run `node --test test/lingxingAdapter.test.js test/storeOperatingMonthlyReportMapper.test.js test/storeOperatingMonthlyReportService.test.js`. Expected: failures for missing request flags, missing official field mapping, and the service still selecting MSKU.

### Task 2: Implement store-profit adapter and mapper normalization

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Modify: `src/services/storeOperatingMonthlyReportMapper.js`

- [ ] **Step 1: Add a dedicated inclusive-date seller request helper**

Build seller-profit params with `startDate` and `endDate` unchanged, `monthlyQuery: true`, `summaryEnabled: true`, and explicit `orderStatus: "All"` unless the service overrides it. Keep the existing generic exclusive-end helper for APIs whose docs require it.

- [ ] **Step 2: Normalize official store fields**

Map official camelCase fields to the normalized monthly record names, preserving raw fields for traceability. Use `totalAdsCost` for 广告费 and `promotionFee` for 推广费. Include the documented international-field spelling and the corrected spelling as compatibility candidates.

- [ ] **Step 3: Update mapper definitions**

Replace the current guessed `adFee`/`ad-spend` split with official store fields; add all five missing platform-expense field candidates and the official custom-order fee fields. Keep explicit missing values unavailable.

- [ ] **Step 4: Run focused tests and verify green**

Run the three focused test files; expected: all new and existing tests pass.

### Task 3: Switch monthly report service to store-profit data

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Modify: `test/storeOperatingMonthlyReportService.test.js`

- [ ] **Step 1: Replace the MSKU load branch**

For each selected month, call the seller-profit adapter with selected seller IDs and the selected currency. Normalize the returned records with store metadata and keep month metadata for cross-month aggregation.

- [ ] **Step 2: Preserve scope and currency grouping**

Filter returned store rows by scope seller IDs, group CNY into one group for multi-country reports, and retain original currency groups for a single country. Do not re-sum MSKU records.

- [ ] **Step 3: Add observable source metadata**

Return/log `source: "/bd/profit/report/open/report/seller/list"`, monthly call count, record count, and unavailable official fields.

- [ ] **Step 4: Run monthly report tests**

Run `node --test test/storeOperatingMonthlyReportService.test.js test/storeOperatingMonthlyReportMapper.test.js`.

### Task 4: Add fee-management detail integration for custom expenses

**Files:**
- Modify: `src/adapters/lingxingAdapter.js`
- Modify: `src/services/storeOperatingMonthlyReportService.js`
- Modify: `src/services/storeOperatingMonthlyReportMapper.js`
- Modify: `test/lingxingAdapter.test.js`
- Modify: `test/storeOperatingMonthlyReportService.test.js`

- [ ] **Step 1: Add a failing fee-detail test**

Assert that the fee-management request sends `date_type: "date"`, month bounds, selected `sids`, and a bounded page size; assert that a returned fee type is mapped to the configured custom-expense row.

- [ ] **Step 2: Implement paginated fee-detail loading**

Call `/bd/fee/management/open/feeManagement/otherFee/list`, preserve `fee`, `other_fee_type`, `other_fee_type_id`, and detail rows, and fail when pagination declares more data but returns an empty page.

- [ ] **Step 3: Merge only known custom expenses**

Add recognized fee-type mappings and expose unmapped fee types in `unavailableMetricDetails`; never allocate an unknown amount to a known row.

- [ ] **Step 4: Run focused integration tests**

Run `node --test test/lingxingAdapter.test.js test/storeOperatingMonthlyReportService.test.js test/storeOperatingMonthlyReportMapper.test.js`.

### Task 5: Full verification and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-store-operating-seller-profit-design.md` only if implementation changes the contract.

- [ ] **Step 1: Run syntax and focused tests**

Run `node --check src/adapters/lingxingAdapter.js`, `node --check src/services/storeOperatingMonthlyReportService.js`, and the focused test command.

- [ ] **Step 2: Run the complete test suite**

Run `npm test`; record the exact pass/fail count.

- [ ] **Step 3: Inspect the diff and branch state**

Run `git diff --check`, `git status --short --branch`, and confirm no generated CSS or unrelated files changed.

- [ ] **Step 4: Commit the implementation**

Commit the reviewed changes on `codex/store-operating-seller-profit` with message `feat: use seller profit report for monthly report`.

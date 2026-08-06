# 店铺经营月报自定义费用取值 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将领星店铺维度自定义费用明细正确映射到店铺经营月报。

**Architecture:** 在 `storeOperatingMonthlyReportMapper.js` 的费用合并边界展开领星 `details[]`，把嵌套店铺费用转换为现有扁平记录格式；月报 service 和前端无需改变。保留扁平数据兼容路径和未映射诊断。

**Tech Stack:** Native Node.js ES modules、Node test runner、现有 mapper/service 测试。

## Global Constraints

- 不把缺失数据转换成 0；未知费用类型、店铺或金额必须进入诊断。
- 不修改用户已有的 FBA 未提交修改。
- 不修改日期契约、预算联动和订单利润数据源。

---

### Task 1: 店铺自定义费用明细展开

**Files:**
- Modify: `src/services/storeOperatingMonthlyReportMapper.js`
- Test: `test/storeOperatingMonthlyReportMapper.test.js`

**Interfaces:**
- `mergeStoreOperatingCustomFeeRecords(records, feeRecords, sellers)` 继续返回 `{ records, applied, unmapped }`。
- 新增的内部展开逻辑把一个含 `details[]` 的领星费用记录转换为多条 `{ sid, storeName, fee, other_fee_type, currency_code }` 记录。

- [ ] **Step 1: Write the failing test**

新增测试覆盖一笔费用包含英国和德国两个店铺明细：顶层 `fee` 为合计，但结果必须分别写入两个店铺的明细金额；同时保留币种和费用类型。

- [ ] **Step 2: Run the focused mapper test and verify it fails**

Run: `node --test test/storeOperatingMonthlyReportMapper.test.js`

Expected: the new multi-store detail assertion fails because the current mapper cannot match a fee row without顶层 sid/storeName。

- [ ] **Step 3: Implement the minimal mapper fix**

展开 `details[]` 时：

1. 使用 `details[].dimension_value`、`details[].store_infos[].id`、`details[].sid` 读取 sid；
2. 使用 `details[].store_infos[].name` 读取店铺名；
3. 使用 `details[].fee` 作为明细金额；
4. 继承顶层费用类型和币种；
5. 无明细时继续走原有扁平记录逻辑；
6. 展开后仍由现有 `metricForOtherFeeType`、`feeAmount` 和店铺匹配逻辑处理，错误信息保持可观测。

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/storeOperatingMonthlyReportMapper.test.js`

Expected: all mapper tests pass, including the new multi-store detail case and existing flat-record case。

- [ ] **Step 5: Run the complete verification**

Run: `npm run check && npm test`

Expected: exit code 0，全部测试通过。

- [ ] **Step 6: Commit only the custom-fee files**

```bash
git add src/services/storeOperatingMonthlyReportMapper.js test/storeOperatingMonthlyReportMapper.test.js docs/superpowers/specs/2026-08-06-store-operating-custom-fee-design.md docs/superpowers/plans/2026-08-06-store-operating-custom-fee.md
git commit -m "fix: map store-level custom fee details"
```

不要暂存或提交 `src/services/fbaShipmentCandidateService.js` 和 `test/fbaShipmentCandidateService.test.js`。

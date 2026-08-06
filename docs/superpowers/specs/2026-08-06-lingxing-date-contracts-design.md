# 领星 API 日期契约设计

## 目标

建立 BI 唯一的领星日期共享规则：只有官方文档明确写明“左闭右开”的接口，才把用户界面的结束日期转换为接口的下一天；官方明确闭区间，或官方没有写明右开规则的接口，一律不加一天。用户选择的日期、缓存键、日志和页面元数据始终保留真实结束日期。

## 范围

范围是当前 BI 代码实际调用的领星接口，不尝试覆盖未接入项目的全部领星 API。每个已接入的日期型接口都要在共享契约表中登记；无法从官方文档确认边界的接口必须标记为 `undocumented`，并按“不加一天”处理。

## 官方核对结果

### 左闭右开：接口结束日期加一天

- `/erp/sc/data/mws/orders`：订单列表，官方文档明确“左闭右开”，日期参数 `start_date`/`end_date`。
- `/erp/sc/data/fba_report/shipmentList`：FBA 货件列表，官方文档明确“左闭右开”，日期参数 `start_date`/`end_date`；修改日期筛选的 `start_extra_date`/`end_extra_date` 也明确左闭右开。

### 闭区间或双闭区间：接口结束日期不加一天

- `/bd/profit/statistics/open/seller/list`：店铺利润统计，`startDate`/`endDate` 双闭区间。
- `/bd/profit/report/open/report/seller/list`：店铺利润报表，`startDate`/`endDate` 双闭区间；月度查询使用 `Y-m`，不能把月份改成下一月。
- `/bd/productPerformance/openApi/asinList`：产品表现，`start_date`/`end_date` 双闭区间。
- `/erp/sc/routing/data/local_inventory/purchaseOrderList`：采购单，`start_date`/`end_date` 双闭区间。
- `/cost/center/ods/summary/query`：库存分类账，日/月查询的 `startDate`/`endDate` 为闭区间。
- `/basicOpen/finance/requestFundsPool/purchase/list`：请款池货款现结，请使用 `start_time`/`end_time`，闭区间。
- `/basicOpen/finance/requestFundsPool/logistics/list`：物流请款，请使用 `start_time`/`end_time`，闭区间。
- `/basicOpen/finance/requestFundsPool/customFee/list`：其他应付款，请使用 `start_time`/`end_time`，闭区间。
- `/basicOpen/finance/mreport/OrderProfit`：订单利润-MSKU，官方文档明确 `startDate`/`endDate` 双闭区间；这是当前店铺经营月报的主数据源。

### 官方未说明边界：不加一天

- `/erp/sc/data/mws/listing`：Listing。
- `/pb/openapi/newad/portfolios`：广告 Portfolio。
- `/bd/profit/report/open/report/order/list`：订单利润订单维度旧接口，官方文档未写左右边界且已标记即将下线。
- `/basicOpen/salesAnalysis/returnOrder/analysisLists`：退货分析，文档只说明格式和最大范围。
- `/basicOpen/openapi/service/v3/data/mws/reviews`：Review，文档只说明格式。
- `/bd/sp/api/open/settlement/summary/list`：结算汇总，文档只说明日期字段和最长范围。

## 架构

### 1. 共享契约表

在 `src/utils/lingxingDateRange.js` 中维护不可变的 endpoint 契约表。每项至少包含：

- `boundary`: `exclusive`、`inclusive` 或 `undocumented`；
- `dateKeys`: 需要转换的结束日期参数名；
- `docsUrl`: 官方文档链接；
- `dateFormat`: `Y-m-d`、`Y-m` 或接口文档标明的格式；
- `notes`: 事实依据、限制或未说明原因。

共享函数按 endpoint 查询契约。只有 `boundary === "exclusive"` 时转换结束日期；其他状态原样保留。未知 endpoint 必须按 `undocumented` 处理，并通过日志保留 endpoint、输入日期和规则状态，不能静默套用右开逻辑。

### 2. 适配器调用

`src/adapters/lingxingAdapter.js` 的每个日期型方法显式传入 endpoint 契约，不再通过无 endpoint 的全局 `withLingxingExclusiveEndDate`。不需要日期转换的方法继续原样传参。请款池方法同时改成官方字段 `start_time`/`end_time` 及对应的 `time_field`/`search_field_time`，避免把日期边界问题和参数名错误混在一起。

### 3. 文档与项目规则

新增 `docs/lingxing-date-rules.md` 作为面向维护者的完整清单，包含官方链接、边界、参数名和当前适配器方法。同步更新 `AGENTS.md` 的 `Lingxing Date Ranges`，明确“默认不加一天，只有已登记的官方左闭右开接口加一天”。

## 错误处理与可观测性

- 日期格式错误继续直接抛错，不做兜底或静默修正。
- 共享函数不得修改调用方传入的筛选对象。
- 每次转换在调试日志中记录 endpoint、boundary、visibleEndDate 和 apiEndDate；日志不记录凭证。
- `undocumented` 接口的日志要明确标识“官方未说明，未追加一天”，方便后续拿到新文档时审计。

## 测试策略

- 共享工具：左闭右开转换、闭区间原样、未说明原样、跨年转换、非法日期失败、输入对象不变。
- 适配器：订单和 FBA 货件结束日加一天；利润统计、月度利润、产品表现、采购单、库存分类账和请款池结束日不加一天；OrderProfit 月报结束日保持月末。
- 请款池：断言发送官方参数名，而不是旧的 `created_start_time`/`created_end_time`。
- 全量 `npm test`、`npm run check`，并检查工作区无未预期改动后再决定是否部署。

## 不在本次范围

- 不改变前端日期控件展示规则。
- 不修改与领星 API 日期参数无关的业务日期计算，例如预测日期、排期日期和本地报表分组。
- 不在没有用户明确部署指令时发布生产环境。

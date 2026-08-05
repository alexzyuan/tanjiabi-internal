# 店铺经营月报切换店铺维度利润报表设计

> 当前实现覆盖说明（2026-08-05）：月报已按最新业务口径改回领星 `OrderProfit`（`/basicOpen/finance/mreport/OrderProfit`）。本文件下方的店铺维度接口内容保留为历史设计记录，不代表当前运行时数据源。OrderProfit 的月末 `endDate` 直接传给上游，不再走通用日期加一天逻辑。

## 目标

店铺经营月报的实际值唯一使用领星“利润报表-店铺”接口，不再使用 MSKU 订单利润明细自行汇总。每个自然月按店铺查询，跨月由月报服务累计；预算、店铺/国家筛选、币种展示规则保持现有行为。

## 数据源与字段

主接口：`POST /bd/profit/report/open/report/seller/list`。

每月请求传入 `sids`、`monthlyQuery: true`、`summaryEnabled: true`、`currencyCode` 和同一个 `startDate/endDate` 月份。领星文档声明店铺利润接口的日期为双闭区间，因此不对该接口的结束日期追加一天。

官方店铺字段映射：

| 月报科目 | 字段 |
| --- | --- |
| 广告费 | `totalAdsCost` |
| 推广费 | `promotionFee` |
| FBA 国际物流运费 | `sharedFbaIntegerernationalInboundFee` |
| 入库配置费 | `sharedFbaInboundConvenienceFee` |
| 调整费 | `adjustments` |
| 平台其它费 | `totalPlatformOtherFee` |
| 站外推广费 | `customOrderFeePrincipal` + `customOrderFeeCommission`，若接口提供合计字段则优先合计字段 |

已有平台收入、平台费、FBA 发货费、仓储费、采购成本、头程成本和利润字段继续沿用店铺利润报表中的对应字段。领星明确返回 `null` 或缺失的字段保持不可用，不静默转为 0。

## 自定义费用

非订单类自定义费用使用领星费用明细接口：`POST /bd/fee/management/open/feeManagement/otherFee/list`。按月份和 `sids` 查询，使用费用类型名称/ID映射到月报自定义费用细项；无法识别的费用类型进入“未映射费用”状态并记录日志，不计入已确认科目。费用明细接口失败时月报请求失败，不用空结果掩盖错误。

## 文件归属

- `src/adapters/lingxingAdapter.js`：新增店铺利润分页/缓存方法、费用明细方法和官方字段归一化。
- `src/services/storeOperatingMonthlyReportService.js`：每月调用店铺利润接口，按店铺/国家作用域过滤并合并费用明细。
- `src/services/storeOperatingMonthlyReportMapper.js`：改用官方店铺字段名，修正广告费与推广费口径。
- `test/lingxingAdapter.test.js`、`test/storeOperatingMonthlyReportService.test.js`、`test/storeOperatingMonthlyReportMapper.test.js`：覆盖请求参数、字段映射和缺失字段行为。

## 错误与可观测性

日志记录请求 ID、月份、店铺数量、店铺利润记录数、费用明细记录数、未映射费用类型和缺失科目；不记录令牌、完整订单或费用原始明细。上游错误继续抛出，接口返回空列表但声明有数据时视为错误。

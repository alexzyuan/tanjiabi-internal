# BI 领星日期共享规则

这份文档是 BI 调用领星日期参数的唯一维护清单。页面、缓存、日志和报表元数据保存用户实际选择的结束日期；只有发送给领星的请求参数，才可能按接口契约转换。

## 统一规则

1. 官方文档明确“左闭右开”时，用户选择的结束日是包含当天的，发送给领星的结束日加一天。
2. 官方文档明确“闭区间”或“双闭区间”时，结束日原样发送，不加一天。
3. 官方文档没有明确边界时，按 `undocumented` 处理，结束日原样发送，不加一天。
4. 未登记的 endpoint 也按 `undocumented` 处理，不允许因为参数名叫 `end_date`/`endDate` 就推断需要加一天。
5. 所有转换必须经过 `src/utils/lingxingDateRange.js` 的 endpoint 契约入口；适配器、服务和前端不得手写 `+1`。

## 明确左闭右开：结束日 +1

| Endpoint | BI 适配器方法 | 日期参数 | 官方文档 |
| --- | --- | --- | --- |
| `/erp/sc/data/mws/orders` | `fetchOrders` | `start_date` / `end_date` | [查询亚马逊订单列表](https://apidoc.lingxing.com/docs/Sale/Orderlists) |
| `/erp/sc/data/fba_report/shipmentList` | `fetchFbaCargoShipments` | `start_date` / `end_date`；`start_extra_date` / `end_extra_date` | [查询货件列表](https://apidoc.lingxing.com/docs/FBA/FBAShipmentList) |

这类接口的日期语义是：

```text
[用户开始日 00:00:00, 用户结束日 + 1 天 00:00:00)
```

例如用户选择 `2026-07-01` 至 `2026-07-31`，请求结束日应为 `2026-08-01`。

## 明确闭区间/双闭区间：结束日不加 1

| Endpoint | BI 适配器方法 | 日期参数 | 官方文档 |
| --- | --- | --- | --- |
| `/bd/profit/statistics/open/seller/list` | `fetchSellerProfitStatistics` | `startDate` / `endDate` | [查询利润统计-店铺](https://apidoc.lingxing.com/docs/Statistics/statisticsOpenSeller) |
| `/bd/profit/report/open/report/seller/list` | `fetchSellerProfitReport` | `startDate` / `endDate`；月度为 `Y-m` | [查询利润报表-店铺](https://apidoc.lingxing.com/docs/Finance/bdSeller) |
| `/basicOpen/finance/mreport/OrderProfit` | `fetchMskuOrderProfit` | `startDate` / `endDate` | [查询订单利润-MSKU](https://apidoc.lingxing.com/docs/Finance/OrderProfitListMSKU) |
| `/bd/productPerformance/openApi/asinList` | `fetchProductPerformance` | `start_date` / `end_date` | [产品表现](https://apidoc.lingxing.com/docs/Statistics/AsinListNew) |
| `/erp/sc/routing/data/local_inventory/purchaseOrderList` | `fetchPurchaseOrders` | `start_date` / `end_date` | [查询采购单列表](https://apidoc.lingxing.com/docs/Purchase/PurchaseOrderList) |
| `/cost/center/ods/summary/query` | `fetchInventoryLedgerSummary` | 日度 `startDate` / `endDate`；月度同样原样传递 | [库存分类账 summary](https://apidoc.lingxing.com/docs/Finance/summaryQuery) |
| `/cost/center/ods/detail/query` | `fetchInventoryLedgerDetailPage` | `startDate` / `endDate` 为闭区间；仅用于库存分类账的诊断或核对，不是正式历史重建输入 | [库存分类账 detail](https://apidoc.lingxing.com/docs/Finance/centerOdsDetailQuery) |
| `/basicOpen/finance/requestFundsPool/purchase/list` | `fetchPayablePurchasePool` | `start_time` / `end_time` / `time_field` | [请款池-货款现结](https://apidoc.lingxing.com/docs/Finance/requestFundsPoolPurchaseList) |
| `/basicOpen/finance/requestFundsPool/logistics/list` | `fetchPayableFreightPool` | `start_time` / `end_time` / `search_field_time` | [请款池-物流请款](https://apidoc.lingxing.com/docs/Finance/requestFundsPoolLogisticsList) |
| `/basicOpen/finance/requestFundsPool/customFee/list` | `fetchPayableOtherPool` | `start_time` / `end_time` / `search_field_time` | [请款池-其他应付款](https://apidoc.lingxing.com/docs/Finance/requestFundsPoolCustomFeeList) |
| `/erp/sc/data/sales_report/sales` | 其他销售统计调用 | `start_date` / `end_date` | [查询店铺汇总销量](https://apidoc.lingxing.com/docs/Statistics/StoreSales) |

## 官方未明确边界：默认不加 1

以下接口的公开文档只写了日期格式、日期范围或字段名称，没有写“左闭右开”。BI 不根据参数名称猜测右开，统一原样发送结束日：

| Endpoint | BI 适配器方法 | 官方文档/备注 |
| --- | --- | --- |
| `/erp/sc/data/mws/listing` | `fetchListings` | [查询亚马逊 Listing](https://apidoc.lingxing.com/docs/Sale/Listing)；未明确边界 |
| `/pb/openapi/newad/portfolios` | `fetchAdPortfolios` | [广告组合](https://apidoc.lingxing.com/docs/newAd/baseData/portfolios)；未明确边界 |
| `/basicOpen/platformStatisticsV2/saleStat/pageList` | `fetchSalesStat` | [多平台销量统计](https://apidoc.lingxing.com/docs/Statistics/PlatformStatisticsSaleStatPageListV2)；只说明格式和最长范围 |
| `/bd/profit/report/open/report/order/list` | `fetchOrderProfitReport` | [查询利润报表-订单](https://apidoc.lingxing.com/docs/Finance/bdOrder)；旧接口且未明确边界 |
| `/bd/fee/management/open/feeManagement/otherFee/list` | `fetchOtherFeeList` | 当前公开文档未提供该路径的边界说明 |
| `/basicOpen/salesAnalysis/returnOrder/analysisLists` | `fetchReturnAnalysis` | [退货分析](https://apidoc.lingxing.com/docs/Statistics/ReturnOrderAnalysisLists)；只说明格式和范围 |
| `/basicOpen/openapi/service/v3/data/mws/reviews` | `fetchReviewV2` | [Review 新接口](https://apidoc.lingxing.com/docs/Service/reviewV2)；只说明格式 |
| `/bd/sp/api/open/settlement/summary/list` | `fetchSettlementSummary` | [结算汇总](https://apidoc.lingxing.com/docs/Finance/settlementSummaryList)；只说明字段和最长范围 |
| `/basicOpen/report/create/reportExportTask` | `createReportExportTask` | 库存分类账原始报告导出任务；正式重建使用 `GET_LEDGER_DETAIL_VIEW_DATA` 导出的报告文件，日期按任务协议传递，不以本表的日粒度端点规则推断 |

## 代码约束

- 共享实现：`src/utils/lingxingDateRange.js`。
- endpoint 契约表：`LINGXING_DATE_CONTRACTS`。
- 未登记 endpoint 使用 `undocumented` 默认契约。
- `start_time`/`end_time` 是请款池官方字段，禁止恢复成 `created_start_time`/`created_end_time` 或混用 `start_date`/`end_date`。
- 如果领星官方文档新增或修订边界，先更新本表和契约注册表，再修改调用方测试；不要在业务服务里添加局部补丁。
- 排查日期问题时设置 `LINGXING_DATE_DEBUG=1`，共享入口会记录 endpoint、边界类型、可见结束日和实际 API 结束日；默认不输出逐请求调试日志。

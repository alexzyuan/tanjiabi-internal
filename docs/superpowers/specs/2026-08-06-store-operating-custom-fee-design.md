# 店铺经营月报自定义费用取值设计

## 问题

领星 ERP 店铺利润页面展示的自定义费用来自 `POST /bd/profit/report/open/report/seller/list` 的 `otherFeeStr[]`。每项含有 `otherFeeName`、`otherFeeTypeId` 和 `feeAllocation`，归属该店铺利润行的 `sid`。真实 API 验证表明 `/bd/fee/management/open/feeManagement/otherFee/list` 在相同月报口径下只返回部分费用，不能作为月报汇总来源。

## 方案

在领星适配器边界展开店铺利润的 `otherFeeStr[]`：每项生成一条扁平费用记录，读取 `otherFeeName` 作为费用类型、`otherFeeTypeId` 作为类型 ID、`feeAllocation` 作为金额，并继承该店铺利润行的 sid、店铺、国家、币种和月份。月报继续以 OrderProfit 作为主数据源，只将这些扁平记录合并到自定义费用科目。无法识别费用类型或金额时保留未映射诊断，不合成零值。

## 验证

- 各店铺利润行的 `otherFeeStr[]` 仅写入自身店铺的费用科目。
- 月报的自定义费用小计和对应科目出现实际值，未知科目仍进入未映射诊断。
- OrderProfit 保持主数据源，店铺利润报表不覆盖销售、平台费用、成本或利润字段。
- 订单利润、预算、日期和 FBA 相关测试保持通过。

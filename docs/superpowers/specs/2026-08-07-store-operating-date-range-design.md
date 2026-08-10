# 店铺经营月报日期范围设计

## 目标

将店铺经营月报的月份筛选替换为与领星一致的起止日期范围选择。范围允许跨月，最多覆盖 12 个自然月，结束日期不能晚于今天；当前月默认从月初到今天。

## 结构

- `index.html` 提供共享双月日期控件、隐藏起止日期字段和已有店铺/国家/币种筛选。
- `assets/js/date-range-picker.js` 保持共享日历交互，新增可配置最大跨度；月报传入 12 个自然月的配置。
- `assets/js/features/store-operating-monthly-report.js` 管理日期范围、URL、自动查询、导出和预算跳转。
- `src/services/storeOperatingMonthlyReportService.js` 校验日期、按涉及自然月拆分请求；首月和末月使用实际边界，中间月份使用完整自然月。
- `routes/finance-purchase.js` 透传 `startDate/endDate`。

预算仍按涉及自然月读取，OrderProfit 和店铺利润自定义费用请求使用同一月内日期范围，前端不自行累计明细。

## 验证

- 日期控件允许跨月但拒绝超过 12 个自然月、结束晚于今天的选择。
- 月报请求携带精确日期，跨月时首末月边界正确。
- URL、表头、导出和预算跳转保留精确日期范围。
- 单元测试、JS/CSS 检查和浏览器桌面/窄视口验证通过。

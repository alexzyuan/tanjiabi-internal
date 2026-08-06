# 店铺经营月报订单利润缓存设计

## 目标

店铺经营月报与销售复盘共用同一份订单利润文件缓存，减少相同日期、店铺和币种组合对 Lingxing OrderProfit API 的重复请求，降低 `new requests too frequently` 风险。

## 范围与约束

- 复用现有 `data-cache/order-profit` 缓存格式和 30 分钟 TTL。
- 缓存键继续由接口来源、日期范围、币种和排序后的 seller IDs 组成，月报按自然月分别命中。
- 同一进程内对相同缓存键增加 in-flight Promise 去重，避免并发 miss 重复打 API。
- seller 列表本次不新增缓存；先保持现有 seller 获取行为，避免改变店铺权限/状态刷新语义。
- 缓存内容保持销售复盘当前使用的规范化 `orderProfitRecords`，不直接缓存原始 API payload。
- 缓存读取失败或写入失败不吞错；上游请求失败继续抛出，并记录可定位的 cache key、日期、币种、sid 数和耗时。

## 结构

- `src/adapters/lingxingAdapter.js`：新增共享 `fetchMskuOrderProfitCached`，集中负责 key、读写、规范化和 in-flight 去重。
- `fetchSalesWeeklyData`：改为调用共享方法，保持返回结构和现有 30 分钟缓存行为。
- `src/services/storeOperatingMonthlyReportService.js`：优先调用共享缓存方法；测试 fake adapter 仍可通过 `fetchMskuOrderProfit` 兼容运行。
- 不修改 `app.js`、生成的 `styles.css` 或其他无关模块。

## 可观测性

共享方法返回 `records`、`cacheState`（`hit`、`miss` 或 `inflight`）和 `cacheUpdatedAt`。销售复盘和月报在已有日志中记录缓存状态、日期范围、币种、seller 数与耗时，便于确认是否仍在重复请求。

## 验证

- 适配器测试覆盖缓存命中不调用 API、miss 写入规范化 records、并发 miss 只调用一次 API。
- 月报服务测试覆盖优先使用共享缓存方法，以及旧 fake adapter 的兼容 fallback。
- 运行聚焦测试、`npm run check` 和 `npm test`。

# S0 shipping_cost 历史缓存审计

审计时间：2026-08-22 14:58:22（Asia/Shanghai）
生产提交：`deae2b9bf6f45484c9e53854bb861ed8851c5d57`
审计方式：只读解析生产 `/opt/tanjia-bi/data-cache` JSON，不修改或删除任何运行时文件。

## 代码路径结论

- `e2c4da5` 已从 `LingxingAdapter.normalizeMskuOrderProfitRecords` 和预算 MSKU mapper 的头程字段别名中移除 `shipping_cost`/`shippingCost`。
- `shipping_cost` 仍只映射为买家运费。
- `inventory-provision-history` 的历史头程成本来自 FBA 月末库存物流金额或产品管理成本字段，不从 OrderProfit 的 `shipping_cost` 读取。
- 清货看板的近 30 天头程聚合来自修复后的 OrderProfit normalizer；生产 `msku-detail` 目录没有命中该类旧聚合字段。

## 生产缓存结果

| 缓存范围 | 文件数 | 行数 | `shipping_cost`/`shippingCost` | 头程字段 | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| `inventory-provision-history` | 8 | 1211 | 0 | `firstLegCost` 1211 | 未发现买家运费污染 |
| `msku-detail` | 17 | 1398 | 0 | 0 个 `recent30FirstLegCost`/`averageFirstLegCost`/`landedUnitCost` | 未发现旧清货聚合缓存 |

历史缓存的成本来源计数：

- `lingxing-product-management`：749 行
- 未带成本来源的旧行：462 行

## 决策

`rebuildRequired=false`。当前没有证据表明历史库存计提或清货缓存把 `shipping_cost` 当作头程成本，因此不执行强制全量分类账重建，也不覆盖现有生产缓存。强制重建会重新检索无关历史报表，不能修复一个不存在的污染，并会增加生产数据变更风险。

后续若发现具体缓存包含买家运费字段，必须使用 `inventoryLedgerRawReportService` 的官方导出链路做 dry-run，审阅完整 FIFO 与差异后，才能备份并原子替换。

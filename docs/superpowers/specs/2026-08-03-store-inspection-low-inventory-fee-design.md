# 店铺巡检低库存费汇总设计

## 目标

将已实际进入低库存费区间的 FBA MSKU 纳入每日店铺巡检。店铺巡检是各业务板块的风险汇总器：它复用低库存费板块的口径和数据，不重复实现库存读取或费用判定。

每日巡检日报按店铺列出当周需要收取低库存费的 MSKU，方便店铺负责人查看；不发送针对这些 MSKU 的钉钉 `@` 提醒。

## 已确认的业务口径

- 数据和判定口径唯一来源是 `src/services/lowInventoryFeeService.js`。
- 已进入实际低库存费区间的条件为 `amazonFeeEligible === true`，即领星 FBA 库存明细的 `Historical days of supply` 大于 0 且小于 28 天。
- 28–42 天是提前预警区间，不进入店铺巡检日报的低库存费清单。
- 领星字段 `low_inventory_level_fee_applied`（现有页面的“领星低库存费标记”）仅作展示，不能作为日报筛选条件；它的值可表示“本周未收”或“可能产生”，不等价于已进入收费区间。
- 日报只列店铺和 MSKU，不显示风险等级、供货天数、库存数量或商品名称。

## 方案与边界

`src/services/storeInspectionService.js` 在执行巡检时直接调用现有的 `getLowInventoryFeeDashboard({ onlyRisk: "0" })`，然后仅筛选 `amazonFeeEligible === true` 的行，形成巡检内的 `lowInventoryFee` 检查结果。

不新增低库存费摘要服务、不重发库存 API 请求、不复制低库存费缓存或判定逻辑。低库存费服务仍是唯一数据服务；巡检服务只消费其输出并按店铺汇总、持久化、生成日报和渲染用数据。

巡检执行时，低库存费读取与 feedback、review、买家之声、Account Health、ERP 站内信及站外售后邮箱并行进行。低库存费调用失败必须作为状态为 `error` 的检查项出现在结果中，错误原因应可见；不能静默返回空清单。

## 巡检结果与日报

巡检结果新增 `lowInventoryFee`：

- `key`：`lowInventoryFee`
- `label`：`低库存费 MSKU`
- `status`：存在收费区间 MSKU 时为 `risk`；成功且为空时为 `ok`；读取失败时为 `error`
- `count`：当前收费区间 MSKU 数量
- `rows`：精简保留 `storeName`、`country`、`msku`
- `detail`：成功时说明当前收费区间 MSKU 数量；失败时保留原始错误消息

日报沿用每店铺一个章节。在有收费区间 MSKU 的店铺章节中追加一行：

```text
- 本周低库存费 MSKU：xiamentanjia-US · JM-ABC，xiamentanjia-US · JM-DEF。
```

为了保持日报店铺章节的独立性，实现可以在店铺章节内省略重复店铺名，显示为 `- 本周低库存费 MSKU：JM-ABC、JM-DEF。`；但每条项目在巡检待处理明细中必须保留店铺和 MSKU 两个字段。

无收费区间 MSKU 的店铺不显示这行。日报标题、既有风险内容和其他模块的呈现不变。

低库存费会计入巡检的总体“需处理”结论和每日 Markdown 日报推送条件。但是低库存费不参与 `storeInspectionMentionTargets`、`storeInspectionMentionUserIds` 或 `buildStoreInspectionMentionText`，不得新增钉钉 `@` 提醒。

## 页面呈现

店铺巡检页面展示低库存费汇总，帮助人工巡检和已发送日报交叉核对：

- 新增“低库存费 MSKU”核心指标，显示当前收费区间数量。
- “巡检概览”和“模块状态”包含低库存费检查项。
- “待处理明细”增加该模块的行，店铺列显示店铺，对象列显示 MSKU，状态显示“本周低库存费”。
- 历史表增加低库存费 MSKU 数量列。

UI 结构仍由 `index.html` 持有；状态和渲染由 `assets/js/features/store-inspection.js` 持有；样式仅在 `assets/css/pages/23-store-inspection.css` 中扩展。生成后的 `styles.css` 只能通过 `npm run build:css` 更新。`app.js` 只保持现有特征模块装配，不增加低库存费业务状态或事件绑定。

## 测试与验证

后端测试必须先验证失败，再实现：

1. 低库存费巡检摘要只包含 `amazonFeeEligible === true` 的行，并只输出店铺、国家和 MSKU。
2. 低库存费读取失败生成可见的 `error` 检查项，而不是空结果。
3. 日报按店铺列出当前收费区间 MSKU，且不会列出提前预警 MSKU。
4. 低库存费使总体巡检结论为“需处理”，但不产生负责人 `@` 目标。
5. 已有巡检日报与提醒行为在没有低库存费数据时保持兼容。

完成后运行相关 Node 测试和全量测试。重建 CSS。通过浏览器验证店铺巡检页无控制台错误，低库存费 KPI、概览、模块状态、待处理明细和历史列在桌面及窄视口均正常；验证巡检调用包含低库存费数据且 Markdown 日报只列 `<28 天` 的 MSKU。

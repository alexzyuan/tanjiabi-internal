# Sales Facts SQLite 交接文档

更新时间：2026-08-21（Asia/Shanghai）

当前里程碑状态：`OPEN`（当前月月报验收已通过；自动同步观察和 legacy 对账证据仍未满足关闭条件）

## 当前生产状态

- 生产分支：`main`
- 已部署提交：`01f28be8a96d3acfbbc8daee8e266bd6a7910e9e`
- 服务器：`47.107.92.14`
- 应用目录：`/opt/tanjia-bi`
- PM2 应用：`tanjia-bi`，当前状态 `online`
- 生产数据库：`/opt/tanjia-bi/data-cache/sales-facts/sales-facts-v1.sqlite`
- 商品目录数据库：`/opt/tanjia-bi/data-cache/product-catalog/product-catalog-v1.sqlite`
- 当前项目约定：不做窄屏测试；本阶段无 CSS 部署。

最近一次生产基线（2026-08-21）：

- `/api/health.ok = true`
- `sync.lastSuccessAt = 2026/8/21 16:12:32`，`lastError = null`，最近一次自动同步覆盖 18 个店铺、3316 条销售事实
- `salesFactsRevision = 35`
- `ownerRevision = 1`
- `dailyFactCount = 5491`
- `factCoverageCount = 782`
- `ownerPeriodCount = 820`
- `customFeeCount = 184`、`customFeeCoverageCount = 25`
- schema `version=1`，`quick_check=ok`

当前月经营月报 + Custom Fee 生产验收：

- 请求范围：`2026-08-01` 至 `2026-08-21`、CNY、18 个 active SID
- 请求 ID：`production-monthly-acceptance-20260821`
- 同一事务提交到 `salesFactsRevision=34`；OrderProfit 事实 2337 条、coverage 378 条、自定义费用 86 条、费用 coverage 18 条
- 月报读取复核：`source=sales-facts-sqlite`、`customFeeSource=sales-facts-sqlite.custom_fee_monthly`、`customFeeRecordCount=86`、`unmappedCustomFeeCount=0`

2026-07 legacy 对账证据：

- 为补齐 SQLite 侧完整自然月，已显式强刷旧 JSON 共同可见的 7 个 SID、31 天；请求 ID：`production-reconcile-refresh-202607`，提交到 `salesFactsRevision=35`
- SQLite 侧 coverage 已达到 `7 × 31 = 217`；旧 CNY OrderProfit JSON 只有 40 个 SID/日期组合，且只覆盖 7/18 active SID
- 旧 JSON 没有 2026-07 可比的 seller-profit 自定义费用快照，因此该对账 artifact 为 `blocked`，不得据此关闭里程碑
- artifact：`/opt/tanjia-bi-approvals/sales-facts-reconciliation-2026-07.json`
- artifact SHA-256：`2c2460a8acf793216e7b9d2a631877fb8639cafbee85eccf0058f9dd0fbe09ae`

负责人历史初始化实测：

- 扫描 18 个 active SID，410 个 Listing，18 页
- 143 个 Listing 已分配负责人
- 267 个 Listing 明确未分配
- `multiple=0`、`malformed=0`，分页完整
- 首次初始化创建历史未知期和当前快照期，共 820 个有效期行
- 负责人变更从检测日次日生效；负责人不进入事实主键或刷新 single-flight key

## 事实与缓存口径

- OrderProfit 事实粒度：Pacific 自然日 + SID + 标准化 MSKU + `CNY|ORIGINAL`
- CNY 与 ORIGINAL 隔离；ORIGINAL 只接受单一国家范围
- 当前月 coverage TTL：12 小时
- 上月 coverage TTL：24 小时
- 更早月份冻结；冻结月份缺失必须显式 `forceRefresh: true`
- 销售周报和店铺经营月报从 sales facts 服务读取，旧 JSON 只用于只读对账和退役检查，不作为错误兜底
- 月报自定义费用来自 seller-profit `otherFeeStr[]`，月报 OrderProfit 与费用必须原子提交
- 旧销售 JSON、旧商品 JSON 和 SQLite 数据均不得在普通部署中删除或覆盖

## 日常检查

```bash
ssh root@47.107.92.14
cd /opt/tanjia-bi
curl -fsS http://127.0.0.1:4173/api/health
pm2 status tanjia-bi
node scripts/validate-sales-facts-schema.js
```

健康检查重点：

- `sync.lastSuccessAt` 持续更新，`sync.lastError` 为空，`sync.running` 最终回到 `false`
- `salesFacts.ok=true`、`quickCheck=ok`
- `salesFactsRevision` 在实际事实刷新后递增
- `ownerRevision` 只在负责人有效期实际变化时递增
- `factCoverageCount` 不应在空销售日被误解为销售额为零；覆盖存在才表示已确认空结果

## 受控运维操作

负责人手动同步应使用管理员权限接口：

```http
POST /api/sales-facts/owners/sync
Content-Type: application/json

{}
```

销售事实范围刷新必须显式传 `startDate`、`endDate`、`sids`、`currencyMode`；只有确实要重刷时才传 `forceRefresh: true`。负责人字段不进入请求范围。

生产部署必须使用 clean `main` 打包，并设置 `DEPLOY_CONFIRM_BRANCH=main`。普通改动使用默认 `standard` scope，不需要 OrderProfit 对账门禁：

```bash
DEPLOY_CONFIRM_BRANCH=main npm run package:deploy
```

只有改动 Sales Facts/OrderProfit 数据契约时，才显式设置 `DEPLOY_SCOPE=sales-facts`，并在部署前运行只读 OrderProfit 预检：

```bash
node scripts/audit-sales-facts-preflight.js > /opt/tanjia-bi-approvals/sales-facts-preflight.json
sha256sum /opt/tanjia-bi-approvals/sales-facts-preflight.json
```

不要使用 `npm run sales-facts:preflight > file`，因为 npm 会把脚本标题写入 stdout，破坏 JSON artifact。部署时必须提供：

```bash
export DEPLOY_SCOPE=sales-facts
export DEPLOY_CONFIRM_BRANCH=main
export SALES_FACTS_PREFLIGHT_ARTIFACT=/opt/tanjia-bi-approvals/sales-facts-preflight.json
export SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256=<sha256>
DEPLOY_CONFIRM_BRANCH=main DEPLOY_SCOPE=sales-facts npm run package:deploy
```

如销售事实 scope 的本次发布已明确批准跳过业务预检，可在服务器执行 `SKIP_SALES_FACTS_PREFLIGHT=1 bash deploy.sh /opt/tanjia-bi/tanjia-bi-deploy.tar.gz`。该开关只跳过预检 artifact 校验，不跳过部署包来源、分支确认、SQLite smoke/schema、迁移、PM2、健康检查和部署完整性门禁。

部署门禁会验证 branch/commit/manifest、scope、两套 SQLite smoke、schema；sales-facts scope 还会验证 artifact 的 daily 模式、分页完整、请求计数和零差异字段，然后才迁移商品目录和重启 PM2。

## 当前已知事项

- 领星会对短时间内重复的旧销售周报请求返回 `new requests too frequently`。这不影响 sales facts 自动同步；发现该日志时先等待限流窗口，不要连续强刷。
- 当前月 Custom Fee 链路已完成真实生产验收；后续仍需观察晚到费用的 12 小时刷新行为。
- 2026-07 legacy 对账不能宣称完整通过：旧 CNY JSON 缺少 177 个 SID/日期组合，并无可比 custom fee 快照。
- 生产 seller directory 已恢复 18 个 SID；对账 artifact 的 7 SID 是旧 JSON 的可比交集，不是新的生产口径。

## 当前收尾与下一阶段计划

1. 继续观察 24–48 小时自动同步：确认 18 个 SID、`lastSuccessAt`、无错误、revision 和 coverage 正常变化；本次基线起点为 `2026/8/21 16:12:32`。
2. 补齐可比的 2026-07 legacy 日级 OrderProfit 与 seller-profit custom fee 快照；在此之前保持 `Sales Facts Milestone = OPEN`，不把旧 JSON 差异静默解释为新事实错误。
3. 收尾通过后，再单独设计 G4A `Frontend Shared Filter State + Feature Registry`，不得与库存 SQLite 混做。
4. G4A 稳定后做 G4B MSKU 跨看板联动，再进入独立设计的 `inventory-snapshots.sqlite`。
5. 旧缓存删除机制最后执行：先生成 manifest/归档并完成稳定期审批，再进行独立 retirement 变更。

## 回滚边界

代码回滚使用：

```bash
cd /opt/tanjia-bi
bash rollback.sh list
bash rollback.sh
```

回滚不会删除 `.env`、`data-cache/`、SQLite、WAL/SHM 或旧 JSON。若 schema、健康检查、预检 artifact 或 PM2 启动失败，`deploy.sh` 会在重启前停止并保留备份。

## 交接原则

- 任何上游错误必须显式失败并保留安全日志，不增加旧 JSON 静默兜底。
- 任何生产事实写入都必须经过 scope 校验、完整分页证据和原子事务。
- 任何国家/SID 范围变化都必须先重新执行全量 seller directory 审计，不得硬编码六国或静默缩小到 7 个店铺。
- 生产操作优先使用现有脚本和已批准 artifact；不要手工复制运行时数据库文件。

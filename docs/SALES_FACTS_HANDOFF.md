# Sales Facts SQLite 交接文档

更新时间：2026-08-13（Asia/Shanghai）

## 当前生产状态

- 生产分支：`main`
- 已部署提交：`285e87121984adb7c6ca295c9b154749a9e27d0c`
- 服务器：`47.107.92.14`
- 应用目录：`/opt/tanjia-bi`
- PM2 应用：`tanjia-bi`，当前状态 `online`
- 生产数据库：`/opt/tanjia-bi/data-cache/sales-facts/sales-facts-v1.sqlite`
- 商品目录数据库：`/opt/tanjia-bi/data-cache/product-catalog/product-catalog-v1.sqlite`
- 当前项目约定：不做窄屏测试；本阶段无 CSS 部署。

最近一次生产验收结果：

- `/api/health.ok = true`
- `sync.lastSuccessAt` 有值，`lastError = null`，最近一次同步覆盖 18 个店铺、3199 条销售事实
- `salesFactsRevision = 2`
- `ownerRevision = 1`
- `dailyFactCount = 3199`
- `factCoverageCount = 540`
- `ownerPeriodCount = 820`
- `customFeeCount = 0`、`customFeeCoverageCount = 0`：尚未用月报刷新写入自定义费用，不代表费用接口已完成验收
- schema `version=1`，`quick_check=ok`

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
- `customFeeCount=0` 尚未完成当前月月报费用链路验收。
- 生产 seller directory 之前曾因旧缓存只有 7 个店铺；已在 `5cea872`/`285e871` 修复为强制刷新并转发 `forceRefresh`，当前缓存已恢复 18 个 SID。

## 交接后的下一阶段计划

1. 观察 24–48 小时自动同步：确认 18 个 SID、`lastSuccessAt`、无错误、revision 和 coverage 正常变化。
2. 手动刷新一个当前月店铺经营月报：确认 OrderProfit 与自定义费用同一事务提交，检查 `customFeeCount`、`customFeeCoverageCount` 和未映射费用元数据。
3. 使用旧 JSON 做一个完整月份只读对账：销售额、净销售额、平台费、毛利润、自定义费用；只记录差异，不导入旧事实。
4. 稳定观察至少 7 天后，再单独设计 `inventory-snapshots.sqlite`；库存快照、工厂库存和旧缓存清理不与销售事实继续混改。
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

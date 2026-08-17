# 探嘉数据分析系统

这是探嘉 BI 的前后端项目骨架，已接入领星 ERP 数据源，并包含销售周会、即时表现、AI 图片工作流、低库存费、预算目标、FBA 刷仓、平台回款、采购汇总、库存计提、后台管理、同步中心等页面。

## 系统操作守则

- 所有同时包含国家和店铺筛选的 ERP 板块，必须使用下拉框，并支持国家、店铺单选和多选。
- 国家筛选优先约束店铺筛选；例如选中“美国”后，店铺列表只能显示美国店铺，已选中的非美国店铺必须自动清除。
- 店铺选项必须按国家/区域分组展示，避免跨区域误选。
- 多国家筛选时，店铺列表只显示所选国家集合内的店铺；未选择国家时显示全部国家店铺。
- 服务端 API 必须接受逗号分隔的 `country`、`storeName`/`store` 参数并按集合过滤；前端不能只做视觉过滤。

## 运行环境

请使用 Node.js `>=22.19.0 <25`。当前依赖中的 `undici@8.x` 对 Node 小版本敏感，低于 `22.19.0` 的 Node 22 会导致 `npm ci` 或运行时行为不一致。首次安装依赖请使用：

```bash
npm ci
```

商品目录第一阶段使用 `better-sqlite3@13.0.3`。安装完成后可运行一次可丢弃的原生模块与事务 smoke（不会写入项目 `data-cache/`）：

```bash
node scripts/product-catalog-sqlite-smoke.js
```

## 怎么打开

当前已经升级为前后端骨架，推荐用本地服务打开：

```bash
node server.js
```

然后访问：

```text
http://localhost:4173
```

如果只是看静态页面，仍然可以直接打开 `index.html`，但本地 `file://` 页面无法连接服务器和领星 ERP；真实使用请访问服务器地址。

## 当前已包含

- 账号密码登录、后台账号管理，预留钉钉扫码登录
- 顶部筛选条件：日期、店铺、币种、运营、品类、SKU/MSKU/ASIN
- 销售周会：时间进度、销售收入、店铺利润、广告费、ACOS、广告费率
- 站点达成表
- 近 30 天销售额、广告花费、ACOS、退货率趋势
- 店铺销售额与净利达成图
- 即时表现、低库存费预警、广告周会、采购汇总、平台回款预测、FBA 刷仓、后台管理、同步中心
- AI 图片工作流第一步支持产品信息、最多 3 张产品图片与 Listing 文案优化：右侧同时保留现行 200 字符旧标题，并按 2026 年 7 月 27 日新规生成 75 字符新标题和 125 字符商品亮点；另包含五点描述、产品描述和后台搜索关键词
- 库存计提支持 FBA 库存明细库龄分布、按店铺堆叠图、资产减值计提汇总和 MSKU 明细，成本计算可切换 `采购成本` 或 `采购成本 + 单位头程费用`。当前月份读取实时库存；历史月份以领星可导出的、亚马逊 `GET_LEDGER_DETAIL_VIEW_DATA` 库存分类账完整原始报告文件按 FIFO 全量重建，自 `2025-10` 至上月。每个卖家范围按月份创建导出任务、轮询完成、下载并校验原始二进制文件的 SHA-256 后才解析；导出失败不会回退到 `/cost/center/ods/detail/query` 或其他库存 JSON API，也不会覆盖历史缓存。该明细 API 仅用于诊断或核对。重建从 `2024-10` 起的导出分类账报告开始，报告必须提供建立 FIFO 所需的开账流水；开账缺失或任何出库超出可用数量都会使整次重建失败，绝不从旧缓存或其他 API 补数。服务器每月 10 日北京时间 `02:00` 自动补拉上月报告并重建。原始报告二进制及含任务标识、下载时间和 SHA-256 的 manifest 留存在 `data-cache/inventory-ledger-raw/`，可由受控运维命令 `node scripts/rebuild-inventory-ledger.js` 进行首次或审核后的强制重建，先用 `--dry-run` 做不写入的完整校验；不提供前端下载按钮。财务可一键“刷新当年成本”：读取当年所有已结束月份的现有历史库存缓存（包含 `tanjia-eu-DE` / SID `17307`），以库存明细中实际出现的 SID + MSKU 精确查询 Listing，再批量查询领星产品管理当前采购成本和对应国家的单位头程成本，并只覆盖缓存中的成本字段，不重新请求或重建历史库存、库存分类账和库龄。若当前店铺没有返回 Listing，则按 MSKU 国家前缀回查同品牌国家店铺，并使用该国家的头程成本；若 Listing 存在但已删除且 `local_sku` 为空，则保留原成本、跳过该行并提示对应店铺 MSKU 需要配对；其他无法匹配或成本缺失仍会失败且不覆盖任何月份。页面会显示成本缓存刷新时间和配对提醒。2026-03 期末库存作为起始余额，2026-04 的 `本月计提金额` = 2026-03 期末库存计提余额 + `本月增加计提（当月）` - `已计提冲回`，后续月份按 `本月增加计提（当月）` - `已计提冲回` 生成，运营利润使用 `本月计提金额`。
- 预算目标支持上传 Excel 模板，并按店铺维度解析销售目标、广告预算、退款目标、利润目标
- 全站受管表格使用共享智能列宽：按列名语义和前 30 行内容的 90 分位自动计算，用户手动调整后保存在当前浏览器，并可按表恢复智能列宽
- 部署脚本支持发布前自动备份、健康检查、一键回退

## 配套文档

- `design.md`：唯一主设计规范，覆盖产品定位、设计系统、UI 视觉、前后端模块、数据同步、权限、部署和域名。
- `SALES_DASHBOARD_SPEC.md`：销售周会看板指标口径、字段和后台配置清单。
- `DATA_MODEL.sql`：后续接领星 ERP 时可参考的数据库表结构草案。
- `PROJECT_STRUCTURE.md`：当前前后端骨架、API、同步任务说明。
- `LINGXING_INTEGRATION.md`：领星接口域名、待补充接口信息和接入步骤。
- `SERVER_DEPLOYMENT.md`：按当前阿里云服务器 IP 编写的部署清单。
- `BUDGET_TARGET_IMPORT.md`：预算目标模板识别和导入说明。
- `AI_IMAGE_WORKFLOW.md`：公众号文章内容整理、自有工作流定义和当前模块实现说明。

## 同步策略

当前后端的同步任务以销售事实 SQLite 为唯一运行时写入目标：

- 线上数据源：领星 ERP；旧销售 JSON 不再写入，也不作为成功兜底。
- 自动同步范围：Pacific 最近 30 天、运行时目录中的全部 active SID、`CNY`，由事实同步服务按 coverage TTL 决定实际需要刷新的分区。
- coverage 策略：当前月 12 小时、上月 24 小时，更早月份冻结；冻结月份缺失只能显式 `forceRefresh`。
- 手动同步接口：`POST /api/sync/lingxing/manual`，内部调用同一事实刷新服务并返回 `cacheState`、`revision`、`updatedAt`、`ageSeconds`。

## 商品目录 SQLite 缓存

领星仍是商品资料的唯一来源，SQLite 只是本机派生缓存。第一阶段数据库固定为：

```text
data-cache/product-catalog/product-catalog-v1.sqlite
```

Listing 以 `SID + 标准化 MSKU` 为身份，商品主数据以标准化内部 SKU 为身份。已存在的商品不会因年龄自动刷新；新身份可以首次查询时补录，已有资料必须通过当前页面的“刷新商品资料”显式更新。刷新会先校验运行时店铺 SID，并在全部领星请求成功后一次性提交；数据库不保存原始上游 payload、凭据或 token。

销售事实 SQLite（`data-cache/sales-facts/sales-facts-v1.sqlite`）第二阶段已实施并与商品目录独立：OrderProfit 采用 Pacific 自然日级 `SID + 标准化 MSKU + CNY|ORIGINAL` 事实，自定义费用按自然月保存，Listing 负责人按有效期关联；销售周报和店铺经营月报均从事实服务读取，失败不回退旧 JSON。当前月 coverage TTL 为 12 小时，上月为 24 小时，更早月份冻结；历史冻结 coverage 缺失必须显式强刷。完整契约见 `docs/superpowers/specs/2026-08-13-sales-facts-sqlite-design.md`。库存快照 SQLite（`inventory-snapshots.sqlite`）仍属于后续阶段，必须先完成独立设计。

销售事实运维入口：`POST /api/sales-facts/order-profit/refresh`（会话权限）和 `POST /api/sales-facts/monthly-report/refresh`（财务权限）接受明确的 `startDate`、`endDate`、`sids`、`currencyMode`；只有在需要时传 `forceRefresh: true`，请求体不接受负责人字段。Listing 负责人同步为管理员接口 `POST /api/sales-facts/owners/sync`。运行时同步中心通过同一事实服务刷新最近 30 天、全部 active SID 的 CNY 范围，并返回 `cacheState`、`revision`、`updatedAt`、`ageSeconds`。

旧的 `shared-product-catalog` 与 `supplier-board-product-map` JSON 在观察期内只读，用于迁移、回退和对账；未经单独清理批准不得删除或继续写入。

旧商品 JSON 的第一阶段退役工具只提供检查和外部归档，不会移动或删除源目录：

```bash
PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS=<首次上线毫秒时间戳> \
npm run catalog:legacy:dry-run

PRODUCT_CATALOG_SQLITE_FIRST_LIVE_AT_MS=<首次上线毫秒时间戳> \
PRODUCT_CATALOG_LEGACY_ARCHIVE_ROOT=/opt/tanjia-bi-archives/product-catalog \
npm run catalog:legacy:archive
```

执行前还必须满足 30 天稳定观察期，并保留至少三个带 `product-catalog-sqlite-v1` capability 的新版 release。归档目录必须位于应用目录之外。当前工具没有 quarantine、purge 或自动删除功能；这些不可逆能力需要生产归档验证后的独立批准。

## 安全部署与回退

每次上传新版 `tanjia-bi-deploy.tar.gz` 后，在服务器执行：

```bash
cd /opt/tanjia-bi
bash deploy.sh
```

正式部署包必须从当前生产分支打包，并显式确认分支：

```bash
DEPLOY_CONFIRM_BRANCH=main npm run package:deploy
```

部署脚本在服务器上的固定顺序是：`npm ci` → 商品目录 SQLite smoke → 销售事实 SQLite smoke → `node scripts/validate-sales-facts-schema.js` → 默认校验 `SALES_FACTS_PREFLIGHT_ARTIFACT` 与 `SALES_FACTS_PREFLIGHT_ARTIFACT_SHA256` → `node scripts/migrate-product-catalog.js` → PM2 重启 → `/api/health` 与部署完整性检查。部署不会自动调用领星预检；artifact 必须由运维直接运行 `node scripts/audit-sales-facts-preflight.js` 生成并人工批准（避免 `npm run` 的标题混入 JSON），且报告要求 `ok=true`、`exitCode=0`、daily 模式、分页完整和差异计数为零。若本次发布明确要求跳过销售事实业务预检，可设置 `SKIP_SALES_FACTS_PREFLIGHT=1`；该开关只跳过 artifact 门禁，不跳过部署包、分支、SQLite、schema、迁移、PM2、健康检查和部署完整性检查。迁移或任一 SQLite/预检门禁失败时不会重启应用；`/api/health` 会保留根级 `ok`，并在 `productCatalog`、`salesFacts` 字段报告受控的 schema、quick-check、revision、coverage/事实/费用/负责人/派生缓存行数和 SQLite/WAL 大小诊断。

打包前必须保证工作树 clean。非生产分支的临时验证需要同时设置 `ALLOW_NON_PRODUCTION_DEPLOY=1` 和 `DEPLOY_CONFIRM_BRANCH=<当前分支>`；这不会改变服务器正式分支规则。

服务器会校验部署包内的 `.deploy-manifest.json`，确认分支、提交、干净工作区状态、部署文件哈希，并逐项核对首页侧边栏全部板块和对应页面容器，避免从错误分支或不完整部署包覆盖线上版本。

如果新版异常，执行：

```bash
cd /opt/tanjia-bi
bash rollback.sh
```

查看可回退版本：

```bash
bash rollback.sh list
```

部署包和部署/回退脚本都不会携带或覆盖 `.env`、`data-cache/`（包括 SQLite、WAL、SHM）、`uploads/`、`node_modules/`，所以密钥、账号、预算记录和缓存数据会保留。SQLite 迁移写入失败时部署会在 PM2 重启前停止；回退旧代码时旧 JSON 与 SQLite 数据仍保留，旧版本会忽略新数据库文件。

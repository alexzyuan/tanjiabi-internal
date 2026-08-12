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
- 库存计提支持 FBA 库存明细库龄分布、按店铺堆叠图、资产减值计提汇总和 MSKU 明细，成本计算可切换 `采购成本` 或 `采购成本 + 单位头程费用`。当前月份读取实时库存；历史月份读取领星 FBA 月末库存报表，并按库存分类账 FIFO 重建历史库龄后计算期末计提余额；2026-03 期末库存作为起始余额，2026-04 的 `本月计提金额` = 2026-03 期末库存计提余额 + `本月增加计提（当月）` - `已计提冲回`，后续月份按 `本月增加计提（当月）` - `已计提冲回` 生成，运营利润使用 `本月计提金额`。
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

当前后端已经预留 12 小时自动同步任务：

- 线上数据源：领星 ERP。
- 默认同步频率：每 12 小时一次。
- 手动同步接口：`POST /api/sync/lingxing/manual`。

## 商品目录 SQLite 缓存

领星仍是商品资料的唯一来源，SQLite 只是本机派生缓存。第一阶段数据库固定为：

```text
data-cache/product-catalog/product-catalog-v1.sqlite
```

Listing 以 `SID + 标准化 MSKU` 为身份，商品主数据以标准化内部 SKU 为身份。已存在的商品不会因年龄自动刷新；新身份可以首次查询时补录，已有资料必须通过当前页面的“刷新商品资料”显式更新。刷新会先校验运行时店铺 SID，并在全部领星请求成功后一次性提交；数据库不保存原始上游 payload、凭据或 token。

销售事实 SQLite（`sales-facts.sqlite`）和库存快照 SQLite（`inventory-snapshots.sqlite`）属于后续阶段，目前尚未实现，必须先完成独立设计。

旧的 `shared-product-catalog` 与 `supplier-board-product-map` JSON 在观察期内只读，用于迁移、回退和对账；未经单独清理批准不得删除或继续写入。

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

部署脚本在服务器上的固定顺序是：`npm ci` → `node scripts/product-catalog-sqlite-smoke.js` → `node scripts/migrate-product-catalog.js` → PM2 重启 → `/api/health` 与部署完整性检查。迁移失败时不会重启应用；`/api/health` 会保留根级 `ok`，并在 `productCatalog` 字段报告 schema、quick-check、revision 和行数等受控诊断。

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

# 销售事实 SQLite 第二阶段设计

## 背景与结论

商品目录 SQLite 第一阶段已经稳定运行，销售与利润缓存必须作为独立项目继续演进，不能进入商品目录分支或数据库。商品目录是缓慢变化的维度数据；OrderProfit、自定义费用和销售周报具有日期、币种、晚到退款与费用修正等独立时效风险。

当前实现同时存在以下缓存语义：

- `OrderProfit` 适配器按完整请求范围保存 JSON，TTL 为 30 分钟；
- 销售周报源缓存默认约 6 小时，并保留旧 dashboard 兼容路径；
- 店铺经营月报复用 OrderProfit 缓存，但自定义费用另行实时请求；
- 负责人来自当前 Listing 查询或当前响应，无法可靠回答历史销售发生时的负责人；
- 旧范围缓存相互重叠，不能相加，也不能反推出可信日事实。

第二阶段采用独立的 `sales-facts.sqlite`。OrderProfit 的目标事实粒度固定为“自然日 + SID + MSKU + 币种模式”，自定义费用按自然月保存，Listing 负责人以独立有效期历史关联。销售周报和月报是派生结果，不是第二份事实源。

旧销售 JSON 只用于上线前后对账，不导入、不累加、不作为错误兜底。实施前必须先只读验证领星 OrderProfit 的整月响应能否可靠拆成日事实；验证不通过时使用逐日请求。

## 目标

1. 为 OrderProfit 建立唯一、可验证、可增量覆盖的日级事实。
2. 隔离 `CNY` 与 `ORIGINAL`，禁止跨币种或跨国家原币混算。
3. 为 Listing 负责人建立不重写历史的有效期记录。
4. 统一销售周报与月报的底层事实、刷新状态、TTL 和强制刷新语义。
5. 消除 OrderProfit 30 分钟与销售周报 6 小时两层缓存的不一致。
6. 将月报自定义费用接入同一事务与 revision 体系，但保持其月级粒度。
7. 通过 coverage 区分“已完整同步且为零”与“尚未同步”。
8. 保持失败显式、写入原子、日志脱敏且全链路可追踪。

## 非目标与项目边界

- 不修改 `product-catalog.sqlite` 的 schema、刷新规则或旧商品目录清理机制。
- 不将商品目录、销售事实和库存快照放进同一个 SQLite 文件。
- 不迁移 FBA 库存或工厂库存；它们属于后续 `inventory-snapshots.sqlite` 项目。
- 不把现有约 148 MB 的 OrderProfit JSON 直接搬入新库。
- 不保存领星原始响应、令牌、请求签名或未白名单字段。
- 不实现 stale-if-error、负缓存或无限期旧结果兜底。
- 首版不合并部分重叠但不完全相同的 in-flight 范围。
- 本阶段不做窄屏测试；若后续改动前端，只执行桌面交互与数据契约验证。

## 已确认的产品决策

1. OrderProfit 事实粒度为 `factDate + SID + normalized MSKU + currencyMode`。
2. Listing 负责人不进入事实主键；负责人是独立的有效期维度。
3. 历史销售保留销售发生日期对应的负责人，不按当前负责人重写。
4. 上线前无法可靠还原的负责人统一标记为“历史负责人未知”，不得用当前负责人倒填。
5. 负责人变更从检测日的次日生效；检测当天仍归旧负责人。
6. 领星 Listing 接口是负责人的唯一权威来源。
7. Listing 任意日期只能有一个负责人；多个不同负责人是上游契约错误，不选择第一个。
8. 负责人字段明确存在但为空表示“未分配”；字段缺失、结构异常或请求失败表示同步失败。
9. 人员身份优先使用领星人员 ID；缺少 ID 时才使用规范化姓名并标记 name fallback。
10. 当前自然月 OrderProfit coverage 与销售周报派生缓存的 TTL 均为 12 小时；上一自然月事实使用第 11 条的 24 小时修正窗口。
11. 当前自然月超过 12 小时自动同步；上一自然月超过 24 小时自动同步；更早月份默认冻结，只允许手动强制刷新。
12. `CNY` 与 `ORIGINAL` 完全隔离；`ORIGINAL` 仍只允许单一国家范围。
13. 强制刷新采用整范围原子替换，任一必要来源失败则零写入。
14. 缓存过期后同步刷新；刷新失败明确报错，不返回旧数据伪装成功。
15. 自定义费用保持自然月粒度，不人工拆成日费用。
16. 销售周报强刷只更新 OrderProfit；月报强刷原子更新 OrderProfit 与相应自然月自定义费用。

## 时间口径

- `fact_date`、自然月边界、当前月/上月判断和负责人次日生效统一使用项目现有业务时区 `America/Los_Angeles`；
- SQLite 的 `*_at_ms` 时间戳统一保存 UTC epoch milliseconds；
- API 可展示 ISO 时间，但不得用服务器本地时区重新解释事实日期；
- OrderProfit 的 `startDate`/`endDate` 继续遵循现有双闭区间契约，禁止追加一天。

## 领域模型

### OrderProfitDailyFact

表示领星 OrderProfit 在一个自然日内，对一个运行时店铺和一个 MSKU 的规范化经营事实。

- 身份：`fact_date + sid + msku_key + currency_mode`；
- `sid` 必须存在于运行时 seller directory；
- `msku_key` 复用统一的 trim/lowercase 规则，原始 MSKU 只作展示和上游请求；
- 负责人不是事实字段，也不参与事实唯一性；
- 数字 `0`、`null` 和字段缺失必须严格区分；缺失字段不得补零；
- 金额和比率禁止直接以 SQLite `REAL` 作为事实真值；canonical metric registry 为每个字段声明固定精度，repository 以定点整数保存并在边界转换，避免二进制浮点累计误差；`otherIncome`（`total_other_granted`）按生产契约使用 6 位小数，其他金额默认 4 位，超出已声明精度必须失败，禁止静默舍入；
- 同一身份返回多个实际币种时，本次刷新失败；
- 不保存上游 raw payload。

### CurrencyMode 与 ActualCurrency

`currency_mode` 只有两个值：

- `CNY`：金额按人民币聚合，`actual_currency_code` 必须为 `CNY`；
- `ORIGINAL`：金额保持领星返回的实际币种，查询范围必须属于单一国家。

`actual_currency_code` 是必填事实属性，不进入主键。对同一事实身份观察到多个实际币种，说明上游聚合范围或数据结构不可信，必须整次失败，禁止混合求和。

### FactCoverage

事实行为空不能证明已同步完成，因此 coverage 是独立业务证据：

- 身份：`fact_date + sid + currency_mode`；
- 记录完整分页成功后的抓取时间、上游行数、页数、刷新批次和 revision；
- 上游真实返回零行时仍写 coverage；
- 只有 coverage 完整且符合月份 TTL/冻结策略，该日才可视为可用。

### CustomFeeMonthlyFact

表示店铺利润报表 `otherFeeStr[]` 中一个自然月的费用分摊。

- 身份：`natural_month + sid + fee_type_id + currency_mode`；
- 保存 `fee_name`、`fee_amount`、`actual_currency_code`、`recognized` 和来源更新时间；
- 未识别费用类型必须保留并进入日志及 API meta；
- 不按天平均或按销量拆分；
- 同一身份出现多个实际币种时整次刷新失败。

### CustomFeeCoverage

- 身份：`natural_month + sid + currency_mode`；
- 即使 `otherFeeStr` 为空也记录完整同步；
- TTL 与月份刷新策略和该月 OrderProfit 保持一致。

### ListingOwnerPeriod

表示一个 `SID + MSKU` 在一段自然日区间内唯一有效的 Listing 负责人状态。

- 身份：`sid + msku_key + effective_from`；
- `effective_to` 为包含式结束日期，开放记录使用 `NULL`；
- 同一 Listing 的有效期不得重叠，同一天最多一个有效记录；
- 状态只有 `assigned`、`unassigned`、`historical-unknown`；
- `assigned` 优先保存稳定人员 ID 和姓名快照；无 ID 时以规范化姓名为临时身份并标记 `identity_source=name-fallback`；
- 初次上线在 cutover date 前建立 `historical-unknown`，cutover date 起使用首次可信扫描结果；
- 后续检测日 D 发现变更时，旧记录截止 D，新记录从 D+1 开始；
- 漏同步后不猜测真实变更时间，仍从重新检测日的次日生效；
- 同一人员 ID 仅姓名变化时，不重写旧姓名快照；从检测日次日建立同一 owner identity 的新展示期间。它不计为人员转移，但由于派生展示会变化，仍递增 `owner_revision`。

### SalesFactsRevision、OwnerRevision 与 DerivedSalesCache

- `sales_facts_revision` 是数据库级单调递增版本，只在事实或 coverage 的原子替换实际提交后递增；首版接受任一范围刷新使所有派生缓存失效，以正确性优先，不实现易错的范围 revision；
- `owner_revision` 只在负责人有效期数据实际变化后递增；
- 派生缓存不是事实，其身份包含基础筛选范围、事实 revision、负责人 revision 和 mapper version；
- 派生缓存 TTL 固定 12 小时；任一 revision 或 mapper version 不一致时立即失效；
- `listingOwner` 只作为关联后的结果筛选，不进入基础事实或周报源范围键。

## SQLite Schema

数据库文件固定为 `data-cache/sales-facts/sales-facts-v1.sqlite`，采用 WAL、`foreign_keys=ON`、`synchronous=FULL` 和 schema checksum 迁移。表名与职责如下。

### `order_profit_daily`

核心列：

- 身份：`fact_date`、`sid`、`msku_key`、`currency_mode`；
- 展示：`msku`、`actual_currency_code`；
- 收入：销量、广告销量、广告销售额、销售额、净销售额、买家运费、促销折扣、退款金额、退货量、退款量、FBA 库存赔偿、其他收入；
- 支出：平台费、FBA 发货费、其他订单费用、仓储费、广告费、推广费、FBA 国际物流运费、入库配置费、调整费、平台其他费；
- 成本与利润：采购成本、头程成本、其他成本、毛利润，以及当前已批准 mapper 所需的单位成本/比例字段；
- 追踪：`source_updated_at_ms`、`refreshed_at_ms`、`refresh_batch_id`。

具体数据库列由一个后端 canonical metric registry 统一定义；适配器、repository、周报 mapper 和月报 mapper 不得各维护不同别名。registry 必须声明字段来源、nullable 规则、存储尺度和输出尺度；`otherIncome` 使用 scale 6，其他金额默认使用 scale 4，比率按 registry 使用 scale 6；金额/比率以受控定点整数存储，数量字段按接口契约使用整数或已声明尺度。任何输入超过对应尺度都视为数据契约错误，不得静默舍入。只允许已批准指标列，禁止 `raw_json` 或任意 payload JSON 列。主键为四个身份列。

### `fact_coverage_daily`

主键：`fact_date + sid + currency_mode`。保存 `refreshed_at_ms`、`source_updated_at_ms`、`row_count`、`page_count`、`refresh_batch_id` 和提交 revision。

### `custom_fee_monthly`

主键：`natural_month + sid + fee_type_id + currency_mode`。保存费用名称、金额、实际币种、recognized 状态、来源与刷新时间、批次 ID。

### `custom_fee_coverage_monthly`

主键：`natural_month + sid + currency_mode`。保存完整抓取证据、行数、刷新时间、批次 ID 和 revision。

### `listing_owner_period`

主键：`sid + msku_key + effective_from`。保存原始 MSKU、owner identity、人员 ID、姓名快照、identity source、状态和 inclusive `effective_to`。唯一/触发器约束必须拒绝重叠区间和同一 Listing 的多个开放记录。

### `sales_derived_cache`

保存安全、规范化的派生结果及其范围键、事实 revision、负责人 revision、mapper version、生成时间与过期时间。派生 payload 必须通过显式白名单序列化；不得保存上游 raw。

### `sales_facts_metadata` 与 `schema_migrations`

metadata 仅保存受控键，包括两个 revision、最近成功同步、owner cutover date 和必要 manifest/version。schema migrations 记录版本、checksum 与 applied time，checksum 不匹配必须 fail fast。

## 服务和模块边界

### 新增后端模块

- `salesFactsSchema`：schema SQL、checksum、连接 pragma 和 migration。
- `salesFactsRepository`：只负责 SQLite 读写、coverage 查询、短事务与 health；不调用领星。
- `salesFactsNormalization`：事实身份、币种和 canonical metric registry；不执行 I/O。
- `salesFactsSyncService`：决定刷新范围，调用适配器，验证分页/日期/币种并提交原子替换。
- `salesFactsQueryService`：读取 coverage 与事实，按销售日期关联负责人，并返回统一 meta。
- `listingOwnerHistoryService`：全量 Listing 预检、唯一负责人验证和有效期更新。
- `salesDerivedCacheService`：按 revisions、mapper version 和 TTL 管理周报派生缓存。
- `salesFactsHealthService` 或现有 core health composition：暴露受控数据库诊断。

### 现有模块的职责变化

- `src/adapters/lingxingAdapter.js` 继续负责领星 HTTP、分页和规范化入口，但不再拥有 OrderProfit JSON TTL/缓存写入策略。
- 销售周报 service 改为调用事实查询与派生缓存，不读取旧 sales-weekly JSON。
- 店铺经营月报 service 从事实查询读取 OrderProfit，并通过同一同步事务获取月度 custom fees。
- `server.js` 只做通用路由 composition；销售事实 feature 路由、输入验证和安全错误序列化放在 focused route/service 模块。
- `app.js` 不新增销售事实状态机。若后续增加刷新 UI，归对应 feature 模块。

### 不应修改的范围

- 商品目录 schema/repository/migration/service；
- FBA 物流、Jiufang、库存与工厂库存业务；
- 生成式 `styles.css`；
- 与销售事实无关的页面状态机和 mapper。

## 负责人完整扫描与历史同步

### 上线前强制只读预检

1. 从运行时 seller directory 读取全部有效 SID，不使用静态店铺补全。
2. 分页读取每个 SID 的全部 Listing，不限已有销售记录的 MSKU。
3. 统一解析负责人列表，以人员 ID 去重；无 ID 时以规范化姓名去重。
4. 统计单负责人、字段明确为空和多负责人异常。
5. 多个重复条目若解析为同一身份，计为一个负责人；多个不同身份则失败。
6. 输出只包含 SID、MSKU、负责人数量、脱敏身份摘要、requestId 和分页计数，不输出 raw payload 或凭据。
7. 任一 SID 请求失败、分页不完整、负责人字段缺失或结构异常时，预检整体失败。
8. 多负责人数量必须为 0，否则不允许进入影子双读或建库切换。

### 上线后同步

- 每天执行一次完整负责人同步；也允许有审计信息的显式手动同步。
- 完整扫描成功后统一比较现有开放有效期；任一 Listing 异常则整批不提交。
- 负责人变更从次日生效，检测日仍属于旧负责人。
- 明确空负责人写 `unassigned`；请求或结构失败不更改旧记录。
- 负责人实际数据无变化时不增加 `owner_revision`。

## OrderProfit 日粒度验证门

当前适配器在返回行没有可靠日期时可使用调用方 `reportDate`，因此禁止直接把现有月范围规范化结果写成日事实。实施前必须新增只读验证工具，验证后才决定正式抓取模式。

### 样本与请求

- 选择一个数据完整的历史自然月和若干有效 SID；
- `CNY` 与合法的单国家 `ORIGINAL` 分别验证；
- 对同一范围执行一次整月完整分页请求，以及该月每一天的完整分页请求；
- 验证工具只能读取上游并生成脱敏报告，不写新事实库或旧 JSON。

### 通过条件

1. 每条整月返回行都携带真实、可解析、位于请求月内的事实日期；不得由请求结束日或调用方参数代填。
2. 以 `date + SID + MSKU + currencyMode` 聚合后无身份冲突或多实际币种。
3. 数量类指标逐日合计与整月请求完全一致。
4. 金额类指标按各自 registry 尺度比较，每个事实身份最多允许一个存储单位差异：`otherIncome` 为 `0.000001`，其他金额默认为 `0.0001`；不先舍入到统一小数位，所有超限差异必须在报告中列出。
5. 分页 total/hasNext/空页契约全部完整，整月和逐日均未触及安全上限。

全部通过时采用“整月请求后按真实日期拆分”；任一条件失败则正式同步采用逐日请求。逐日模式默认串行，只有压测和限流日志证明安全后才允许配置为最大并发 2，不得一次并发整月。仅对网络超时、HTTP 429 或领星明确的临时限流错误重试，每页最多 3 次总尝试；优先遵守上游 `Retry-After`，否则使用有抖动的指数退避。数据契约、身份、日期或分页完整性错误不重试。每次重试记录 requestId、endpoint、attempt、delay 和安全错误码。模式与并发选择写入 metadata 和部署审计，不能运行时静默切换。

## 刷新、TTL 与覆盖策略

### 自动读取

- 当前自然月：coverage 缺失或超过 12 小时，读取请求必须先同步刷新。
- 上一自然月：coverage 缺失或超过 24 小时，读取请求必须先同步刷新，以接收晚到退款和费用。
- 更早月份：已有 coverage 时以 `cacheState=frozen` 返回；coverage 缺失时明确要求手动强刷，不自动访问领星。
- 缓存未过期：直接读取 SQLite。
- 过期刷新失败：旧事实保留但本次请求失败，不返回旧事实伪装成功。

这里的 12/24 小时决定底层事实 coverage 是否需要重新向领星同步。销售周报派生缓存自己的 TTL 始终是 12 小时；即使底层上一自然月事实仍处于 24 小时有效期，派生结果超过 12 小时也必须从现有事实重新计算，但不因此强制访问领星。

### 手动强制刷新

基础范围固定为：`startDate + endDate + sorted unique SID set + currencyMode`。

- 销售周报强刷只刷新范围内 OrderProfit。
- 店铺经营月报强刷同时刷新范围内 OrderProfit 和所有涉及自然月的 custom fees。
- 所有上游分页和数据验证先在事务外完成。
- 成功后在一个短事务中删除目标范围旧事实/coverage、写入新事实/coverage，并递增 revision。
- 月报任一 OrderProfit 或 custom fee 来源失败，整个事务不开始。
- 真实零销售/零费用通过 coverage 提交，不制造伪事实行。
- 完全相同的范围键使用 single-flight；owner 过滤不进入该键。
- 首版不合并部分重叠范围；记录重叠请求指标，只有出现实际压力后再设计实体级协调。

### 自动刷新事务

自动读取只刷新缺失或过期的日期/月分区。一个请求需要的全部分区先完整获取，再在一次事务中提交，防止同一响应混用新旧分区。历史冻结分区不在自动刷新集合中。

## 负责人关联与报表语义

- 事实查询按 `fact_date` 连接该日期有效的 `listing_owner_period`；
- 找不到可信有效期时返回 `historical-unknown`，不得使用当前负责人；
- `listingOwner` 过滤发生在事实读取和负责人关联之后；
- 不同负责人筛选复用同一基础事实和源范围；
- 负责人有效期变化通过 `owner_revision` 使派生结果失效；
- 销售总计不因负责人筛选模型重复或拆分。

## 自定义费用与月报事务

- 自定义费用只来自 `/bd/profit/report/open/report/seller/list` 的 `otherFeeStr[]`；
- 不使用不完整的 fee management endpoint；
- 当前月 12 小时、上月 24 小时、更早月份冻结；
- custom fee coverage 为空仍代表完整成功；
- 月报查询把日级 OrderProfit 聚合到自然月，再合并该月 custom fee facts；
- 未识别 `fee_type_id` 保留在 facts 和 meta，不能静默丢弃；
- 月报强刷时 OrderProfit 与费用必须同批成功并在同一 transaction 提交，避免来源版本错位。

## 派生销售周报缓存

基础范围键只包含 `startDate + endDate + sorted SID set + currencyMode`。派生缓存额外记录：

- `sales_facts_revision`；
- `owner_revision`；
- `mapper_version`；
- `generated_at` 与 12 小时 `expires_at`。

只有四项全部匹配才可命中。负责人筛选在复用基础派生或事实关联后执行，不生成另一份底层 OrderProfit 请求缓存。旧 `sales-weekly-dashboard.json` 和 keyed source JSON 在切换后不得作为失败兜底。

## API 契约

所有销售事实支持的读/刷新响应至少包含：

- `source`：`sales-facts-sqlite`、`lingxing-order-profit` 或明确派生来源；
- `cacheState`：`hit`、`refreshed`、`inflight`、`frozen`；
- `updatedAt`；
- `ageSeconds`；
- `revision`；
- `ownerRevision`（使用负责人关联时）；
- `requestId`；
- `scopeCount`、日期范围、currency mode，以及不含业务明细值的计数。

强刷 API 必须显式 `forceRefresh=true` 或专用 POST route。普通 GET 不得隐式把历史冻结月份改写。错误响应只返回受控 operation、code、requestId 和范围计数，不返回上游正文、SQL、路径或 raw payload。

## 错误语义与可观测性

### 错误分类

- 输入、日期、币种或单国家约束错误：400/422；
- SQLite 打开、schema、checksum、锁、事务和 quick check 错误：503；
- 领星限流、请求失败、分页不完整：502/503，保留受控 endpoint/operation；
- 日期缺失、多实际币种、多负责人、负责人结构异常、身份冲突：数据契约错误并阻止提交；
- mapper/schema registry 不一致：启动或请求时 fail fast，不能忽略字段。

### 日志与指标

每次读取或刷新记录受控字段：

- requestId、operation、feature；
- start/end、SID count、currency mode；
- fetch mode（monthly/daily）、day/month count、page count、row count；
- cache state、coverage state、single-flight owner/joiner；
- network、normalization、validation、transaction、query、owner join 和 derived map 耗时；
- facts revision、owner revision、mapper version；
- 安全 error name/code/status。

不得记录 token、签名、完整业务行、人员原始列表、上游 body、SQL 或本地绝对路径。

## 健康检查

`/api/health` 增加脱敏的 sales facts 节点：

- status/ok；
- schema version 与 migration count；
- SQLite quick check；
- daily fact、fact coverage、custom fee、fee coverage、owner period 和 derived cache 计数；
- sales facts revision 与 owner revision；
- 最近成功 OrderProfit、custom fee 和 owner 同步时间；
- database/WAL bytes；
- 已批准 fetch mode。

健康检查失败不改变根 health 的既有可用性契约，但必须写安全日志并显示 degraded。诊断只允许受控枚举，不返回 SQL、stack、路径或上游消息。

## 影子双读、切换与旧缓存

### 影子阶段

1. 新库只写入并从事实生成对账结果，现有页面仍使用旧路径。
2. 对相同日期、SID 和币种比较销量、销售额、退款、费用、利润及负责人归属。
3. 输出差异计数和安全摘要，不自动用旧 JSON 修补新库。
4. 差异必须定位到来源、日期或 mapper 后修复根因。

### 消费者切换顺序

1. 销售周报和 MSKU 明细；
2. 店铺经营月报 OrderProfit；
3. 店铺经营月报 custom fees；
4. 依赖 OrderProfit 的其他服务按独立回归逐个切换。

每一步都有独立 feature flag/回退发布能力，但运行时失败不得静默回旧 JSON。回滚只能显式切回完整旧版本。

### 旧文件生命周期

- 旧 OrderProfit、sales-weekly 和月报 JSON 在双读期保持只读；
- 不导入、不删除、不追加；
- 稳定期后另立 retirement 设计，沿用 manifest、归档、quarantine 和最终删除门；
- 不与本阶段事实实现放在同一个删除提交中。

## 部署与运行

- 新数据库目录不进入部署包，由运行时创建并持久化；
- PM2 重启前运行独立 SQLite smoke：WAL、sqlite version、写/读、UPDATE、DELETE、commit、rollback、quick check、integrity check 和清理；
- schema migration、负责人预检或 OrderProfit 粒度验证门失败时，不重启 PM2；
- 部署包必须从独立销售事实分支合并后的 clean `main` 生成；
- 不绕过现有 branch/manifest/CSS guards；
- 本阶段默认不涉及 CSS，也不运行窄屏测试。

## 测试与验证

### 单元与 repository

- 身份、日期、币种、metric registry 和 null/zero；
- schema checksum、WAL、metadata、revisions；
- coverage 零行与缺失区分；
- 范围替换与事务回滚；
- custom fee unknown type 保留；
- owner period 不重叠、次日生效和 historical unknown；
- quick check 与日志脱敏。

### service 与 adapter

- 月/日粒度验证器；
- 分页完整、安全上限和限流；
- CNY/ORIGINAL 隔离、单国家 ORIGINAL、多实际币种拒绝；
- 当前月 12h、上月 24h、历史冻结；
- 手动全范围强刷、月报双来源原子提交；
- 完全同范围 single-flight success/failure cleanup；
- 过期刷新失败不返回 stale；
- 负责人全量扫描、多负责人阻断、明确空值和结构错误；
- revision/mapper version 失效。

### 消费者与 API

- 销售周报不同负责人筛选复用同一事实；
- 历史负责人按销售日期关联；
- 月报字段树和 custom fee 合并保持已批准口径；
- API meta 完整且 records/错误白名单安全；
- health 正常、degraded 和异常路径；
- 旧 JSON 写入调用从运行时路径移除。

### 验收

- 聚焦测试和全量纯 Node 测试；
- `npm run check`、`npm run check:js`、`git diff --check`；
- 桌面浏览器验证受影响页面的请求、交互、错误态和 console；
- 明确不执行窄屏测试；
- package 内容、SQLite smoke、migration order 和部署 health/integrity 验证。

## 实施阶段建议

1. **只读预检工具**：负责人全量扫描和 OrderProfit 月/日粒度验证。
2. **Schema/repository**：事实、coverage、费用、负责人、metadata、health。
3. **同步与查询服务**：日/月模式、TTL、原子替换、single-flight、owner join。
4. **影子双读**：对账但不改变页面数据源。
5. **销售周报切换**：统一事实与12小时派生缓存，删除无 TTL 运行时兜底。
6. **经营月报切换**：OrderProfit 与 custom fees 同事务刷新。
7. **部署守卫**：smoke、preflight、health 和 package 验证。
8. **稳定期审计**：另立旧销售 JSON retirement 项目。

每一步必须遵循 RED → GREEN → cleanup → focused verification → review；不得在同一提交中改商品目录或库存快照领域。

## 成功标准

1. 相同日、SID、MSKU 和币种模式只有一份规范事实。
2. 零销售与未同步可以通过 coverage 明确区分。
3. 当前月、上月和冻结历史月严格执行已批准刷新策略。
4. 销售周报与月报不再各自请求/缓存另一份 OrderProfit。
5. 负责人变更不重写历史，负责人筛选不造成重复事实请求。
6. CNY 与 ORIGINAL 永不混合，跨国家 ORIGINAL 明确拒绝。
7. 任一部分失败时范围事实、coverage、费用与 revisions 全部不变。
8. 旧 JSON 仅用于对账，运行时错误不静默回退。
9. 每次读取/刷新都可从 requestId、operation、范围、状态、revision 和分阶段耗时追踪。
10. 生产部署通过 schema、SQLite smoke、health 和 integrity guard，且不影响商品目录健康。

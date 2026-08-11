# BI 缓存 SQLite 分阶段迁移与商品目录第一阶段设计

## 背景与结论

当前共享商品目录以“整次请求包含的商品集合”为缓存身份。日期范围、筛选子集、店铺展示别名或来源行形状发生变化时，即使实际涉及同一批商品，也会生成另一份完整 JSON。供应商看板又把共享目录复制到独立的 `supplier-board-product-map`，FBA 商品目录则维护另一套 30 分钟进程内缓存并独立请求领星。

2026-08-11 对生产服务器 `/opt/tanjia-bi/data-cache/shared-product-catalog` 的只读审计结果为：

- 91 个 JSON 文件，共 114,628,328 bytes；
- 7,648 条缓存索引记录，但只有 103 个唯一 `SID + MSKU` 和 54 个唯一内部 SKU；
- 6,489 条记录重复保存了上游 `raw` 对象；
- 单个商品最多重复 497 次，80/103 个 Listing 身份存在多个店铺展示别名；
- 旧缓存中有 28 个内部 SKU 出现多个采购价、7 个出现多个供应商、1 个出现多个商品名称；
- `supplier-board-product-map` 另有约 20 MB 与共享目录内容相同的重复序列化。

因此第一性目标不是“把 JSON 搬进数据库”，而是先按数据领域建立规范身份、刷新契约和持久化粒度。总体方案是保留现有 Node.js、PM2、领星适配器和业务服务结构，按阶段建立三个相互隔离的本地 SQLite 数据库：商品目录、销售事实和库存快照。领星仍是最终业务数据源，SQLite 只是服务器本地的统一复用层。

本设计同时记录总体迁移方向和第一阶段的完整可实施契约。当前设计批准后生成的实施计划只执行商品目录第一阶段；销售事实与库存快照必须分别完成独立的来源、粒度、刷新和对账设计后才能实施。

## 总体目标架构

SQLite 统一的是 repository 契约、迁移方式、错误语义和可观测性，不是把所有数据塞进同一个文件。三个领域使用独立数据库，避免不同刷新频率争抢同一 writer，并缩小 schema 迁移、文件损坏和回滚的影响范围。

| 领域数据库（逻辑名） | 数据性质 | 规范身份/粒度 | 更新方式 | 当前阶段 |
| --- | --- | --- | --- | --- |
| `product-catalog.sqlite` | 缓慢变化的维度数据 | `SID + MSKU` Listing 身份、内部 SKU 商品主数据 | 首次缺失补录；当前页面显式手动刷新 | 第一阶段实施 |
| `sales-facts.sqlite` | 按时间和币种变化的经营事实 | 由第二阶段设计确认的日期、SID、商品和币种粒度 | 第二阶段确认定时、手动和历史修正规则 | 第二阶段独立设计与实施 |
| `inventory-snapshots.sqlite` | 随时间变化的库存快照 | 快照时间、SID、MSKU/内部 SKU | 第三阶段确认同步频率、显式刷新和保留周期 | 第三阶段独立设计与实施 |

销售周报、店铺经营月报和工厂库存是上述规范数据的派生结果，不默认成为第四个事实源。页面确有性能压力时可以保存短时物化结果，但必须声明来源、生成时间、失效依赖和刷新状态，不能继续无界保存完整请求快照。

这种分库仍适合当前单机 PM2 架构：所有文件位于同一服务器的 `data-cache`，无需 MySQL/PostgreSQL 守护进程；服务层继续在内存中组合跨领域结果，不使用跨主机共享文件或网络文件系统。未来只有在出现多台应用服务器、高并发写入或独立数据消费者时，才重新评估 PostgreSQL 等客户端/服务器数据库。

## 已确认的产品决策

1. Listing 身份以 `SID + 标准化 MSKU` 唯一，店铺名称、国家和页面筛选范围不参与主键。
2. 商品主数据以标准化内部 SKU 唯一；产品 ID、SKU identifier 等只是别名。
3. 普通页面查询复用 SQLite 中已经存在的商品，不按时间自动刷新。
4. SQLite 和旧 JSON 都没有的新 `SID + MSKU` 可以在首次查询时按需向领星补录，避免新商品永久空缺。
5. 已存在商品的数据变化只能通过独立的“刷新商品资料”动作更新；普通“查询”不能隐式强刷。
6. 手动刷新范围是当前页面筛选结果包含的唯一 `SID + MSKU`，不是全部店铺商品。
7. 手动刷新必须在本次响应中立即返回已提交的新数据。任一必要的领星请求失败或身份无法解析时，本次刷新整体失败，已有数据库内容不变。
8. 采用旧 JSON 双读迁移：新目录优先，旧缓存次之，只有双方都缺失的身份才首次请求领星。第一阶段不删除旧文件。

## 第一阶段目标

1. 建立跨供应商看板、工厂库存、FBA 发货候选、FBA 商品目录和物流导出的统一商品目录。
2. 消除请求集合、日期范围和店铺展示别名导致的重复持久化与重复领星请求。
3. 为 Listing 身份、商品主数据和别名建立明确唯一性约束、事务更新与可追踪来源。
4. 兼容现有 `getSharedProductCatalogMap()` 调用契约，分阶段迁移调用方，避免大爆炸式重写。
5. 为当前页面范围提供显式、原子、可观察的手动刷新。
6. 将旧缓存确定性迁移到 SQLite，并显式记录历史字段冲突。
7. 保持 FBA 所需的装箱数量、箱规、内部 SKU、带电属性和申报字段完整。

## 第一阶段非目标与阶段边界

- 本阶段不把 OrderProfit、销售周报、店铺利润、FBA 库存、工厂库存结果迁入商品目录数据库。它们属于已经确认的第二、第三阶段，不是永久排除项。
- 本阶段不修改销售/订单利润现有的 30 分钟、6 小时或 12 小时缓存策略，避免在商品身份迁移中同时改变经营数据时效。第二阶段必须统一这些策略和显式刷新协议。
- 不安装或运行 MySQL、PostgreSQL、Redis 等独立服务。
- 不将任一 SQLite 缓存作为领星之外的最终业务数据源，也不允许在 SQLite 中人工编辑业务字段。
- 不改变领星 API 日期范围、币种、店铺身份或物流法人主体规则。
- 不删除旧 `shared-product-catalog`、`supplier-board-product-map` 或 Listing 共享 XLSX；清理是稳定运行后的独立任务。
- 不在 `app.js` 增加商品目录状态机，不手改生成式 `styles.css`，不为刷新按钮增加一次性 CSS。

## 后续阶段的数据边界

### 第二阶段：销售事实

第二阶段建立 `sales-facts.sqlite`，覆盖 OrderProfit、店铺利润及自定义费用等可复用事实来源，再由服务层生成销售周报和店铺经营月报。它不能直接复制当前请求快照缓存，原因是现有 OrderProfit 文件只保存聚合结果和文件时间，原始 `startDate`、`endDate`、SID 范围和币种只进入哈希键，没有以可恢复请求元数据持久化。

2026-08-11 生产只读统计显示：`order-profit` 有 282 个文件、约 148 MB、21,825 条记录；没有文件仍在 30 分钟 TTL 内，280 个已超过 12 小时。不同文件可能覆盖重叠日期范围，同一记录也是所选范围的聚合值，不能相加、不能反推出每天事实。旧文件只能作为第二阶段上线对账样本，不能直接 upsert 为规范日/月事实，否则会造成重复销售额或利润。

第二阶段实施前必须完成独立设计并明确：

1. 领星 OrderProfit 能稳定提供的最细可信粒度，以及是否需要改用更细的订单利润来源；
2. `date/range + sid + msku + currencyCode` 的唯一性和 CNY/ORIGINAL 隔离；
3. 当前周期自动同步、当前筛选范围手动强刷、历史退款/费用晚到后的修正窗口；
4. 店铺利润自定义费用的自然月粒度与未知费用类型保留；
5. 销售周报、MSKU 明细和经营月报物化结果的依赖失效；
6. 旧 JSON 的保留、对账和最终清理，而不是无依据的数据迁移。

这六项未形成独立批准设计前，不得在第一阶段顺带创建销售事实表或改变 TTL。

### 第三阶段：库存快照与派生结果

第三阶段建立 `inventory-snapshots.sqlite`，以明确快照时间保存 FBA 库存，并为最新库存和受控历史分别建立查询。FBA 库存不是商品主数据：同一 `SID + MSKU` 的库存随时间快速变化，不能使用商品目录“只手动刷新且永久复用”的规则。

工厂库存由采购单、商品目录、库存快照和销售预估组合而成；销售周报也由销售事实、预算、商品目录和库存派生。第三阶段应优先从规范底层数据重算，只在有性能证据时保存短时物化结果，并记录依赖版本。当前49个工厂库存文件中48个已超过12小时，它们应在第三阶段作为结果对账样本和清理对象，不应原样迁入长期事实表。

## 领域模型与身份规则

### ListingIdentity

`ListingIdentity` 表示某个领星运行时店铺中的一个 Amazon Listing 商品身份。

- 主键：`sid + msku_key`；
- `sid` 必须存在于运行时 seller directory；
- `msku_key` 是经过统一 `trim + lower-case` 的 MSKU；
- 原始 `msku` 保留用于展示和向领星请求；
- `storeName` 和 `country` 只从运行时 seller directory 补充，不从旧缓存别名决定身份；
- `internalSku` 来自领星 Listing API；当 API 缺失内部 SKU 时，允许按现有规则使用服务器 Listing 共享 XLSX 作为显式备份来源；
- 不允许仅用普通 MSKU 跨 SID 唯一化。

### ProductMaster

`ProductMaster` 表示领星产品管理中的内部商品。

- 主键：`internal_sku_key`；
- 原始内部 SKU 保留用于展示和上游请求；
- 保存共享消费者实际需要的白名单字段，不保存完整上游 `raw`；
- 产品资料来源是领星产品管理 API，旧 JSON 只用于迁移种子；
- 实时刷新结果优先于任何迁移结果。

### ProductAlias

`ProductAlias` 将稳定别名解析到内部 SKU。

- 支持的首版别名类型：`sku_identifier`、`product_id`、`listing_sku`；其中 `listing_sku` 只表示 Listing 返回的 ERP `local_sku`，Amazon `seller_sku`/MSKU 不得进入别名表；
- 唯一键是 `alias_type + alias_key`；
- 同一别名解析到两个内部 SKU 时不得静默覆盖，必须记录冲突并使相关写入失败；
- MSKU 不进入此表，因为 MSKU 必须与 SID 联合使用。

### CacheScope

页面范围不是持久化身份。服务端把当前页面已加载结果提取为去重、排序后的 `[{ sid, msku }]`，只用于一次查询或刷新请求。范围指纹仅用于并发请求 single-flight 和日志关联，不能作为商品缓存主键。

## SQLite 文件与表结构

第一阶段数据库文件固定为：

```text
data-cache/product-catalog/product-catalog-v1.sqlite
```

同目录可能出现 SQLite 自身的 `-wal` 和 `-shm` 文件。部署脚本已经保留整个 `data-cache/`，因此数据库跨部署保留；回滚到旧代码时旧 JSON 仍在，旧版本会忽略 SQLite 文件。

### `schema_migrations`

| 字段 | 规则 |
| --- | --- |
| `version` | 整数主键 |
| `name` | 唯一迁移名称 |
| `checksum` | 迁移内容校验值 |
| `applied_at_ms` | 应用时间 |

启动时发现同版本 checksum 不一致、未知更高版本或迁移失败时必须使商品目录不可用并记录错误，不能继续猜测兼容。

### `catalog_metadata`

| 字段 | 规则 |
| --- | --- |
| `key` | 文本主键 |
| `value` | 文本值 |
| `updated_at_ms` | 更新时间 |

首版固定维护 `catalog_revision`、`legacy_manifest_hash` 和 `legacy_migrated_at_ms`。每次成功写入 Listing/商品/别名的事务同时递增 `catalog_revision`；派生页面缓存保存该 revision，发现不一致时只从 SQLite 重新装配商品字段，不重请求其销售或库存来源。`legacy_manifest_hash` 由旧缓存文件名、大小和修改时间的稳定清单生成，确保回滚到旧版本期间新增的 JSON 会在下次部署重新纳入迁移。

### `listing_identity`

| 字段 | 规则 |
| --- | --- |
| `sid` | 正整数，联合主键 |
| `msku_key` | 标准化 MSKU，联合主键 |
| `msku` | 原始展示值，非空 |
| `internal_sku_key` | 可空；有值时索引 |
| `internal_sku` | 原始内部 SKU |
| `listing_sku` | Listing 返回的本地 SKU/商品 SKU |
| `asin` | 可空 |
| `store_name` | 运行时目录规范名称 |
| `country` | 运行时目录规范国家 |
| `source` | `lingxing-listing`、`legacy-json` 或 `listing-shared-xlsx` |
| `source_updated_at_ms` | 来源数据时间；旧缓存使用原文件时间 |
| `refreshed_at_ms` | 本地完成补录/刷新的时间 |

主键为 `(sid, msku_key)`，另建 `internal_sku_key` 索引。不为 `store_name + msku`、`country + msku` 或普通 `msku` 建立可绕过 SID 的唯一身份。

领星响应没有可靠的上游更新时间时，实时补录/刷新使用成功读取响应的时间同时填充 `source_updated_at_ms` 和 `refreshed_at_ms`，不能伪造更早的业务时间。

### `product_master`

| 字段组 | 字段 |
| --- | --- |
| 身份 | `internal_sku_key` 主键、`internal_sku` |
| 基础资料 | `product_name`、`image_url`、`supplier`、`purchase_price`、`model`、`brand` |
| 申报资料 | `material`、`purpose`、`customs_code`、`is_battery`、`unit`、`declared_value` |
| FBA 包装 | `pack_quantity`、外箱长宽高与单位、外箱重量与单位 |
| 上游标识 | `product_id`、`sku_identifier` |
| 追踪字段 | `source`、`source_updated_at_ms`、`refreshed_at_ms`、`data_hash` |

数值字段不得用 `0` 同时表达“真实为零”和“上游缺失”；SQLite 内用 `NULL` 表达缺失，兼容门面再按现有消费者契约转换。箱规使用独立数值列而不是不透明 JSON，便于验证完整性和后续查询。完整上游 payload、token、请求签名和凭据不得入库。

### `product_alias`

| 字段 | 规则 |
| --- | --- |
| `alias_type` | 联合主键 |
| `alias_key` | 标准化别名，联合主键 |
| `alias_value` | 原始展示值 |
| `internal_sku_key` | 指向 `product_master` |
| `source` | 别名来源 |
| `updated_at_ms` | 更新时间 |

启用外键，并在产品主数据事务内先 upsert `product_master`、再 upsert `product_alias` 和 `listing_identity`。

## 数据库运行参数

打开数据库时统一设置并验证：

- `journal_mode = WAL`；
- `foreign_keys = ON`；
- `busy_timeout = 5000` 毫秒，超时后明确失败并记录操作名和耗时；
- `synchronous = FULL`，不以缓存可重建为理由降低提交完整性；
- 默认安全同步级别，不启用 `unsafeMode`；
- 所有批量写入使用短事务；
- 领星网络请求必须在事务外完成，不能持有数据库写锁等待网络。

数据库连接由 repository 单例持有并显式关闭。测试使用临时目录中的独立数据库，不能接触真实 `data-cache`。

## 组件与所有权

### `src/services/productCatalogRepository.js`

只负责本地持久化：

- 打开数据库和应用 schema migrations；
- 按一批 `SID + MSKU` 查询 Listing 身份和关联商品；
- 按内部 SKU 或受支持别名查询商品；
- 在事务中 upsert 一批 Listing、商品和别名；
- 返回结构化冲突、完整性和性能信息；
- 提供数据库健康、表计数和文件大小诊断。

repository 不调用领星、不读取 seller directory、不解释页面筛选，也不返回旧式多键 `Map`。

### `src/services/productCatalogService.js`

负责业务编排：

- 从页面/服务行中提取并验证规范范围；
- 通过 seller directory 校验 SID 并补规范店铺名称和国家；
- 先查 SQLite，再进行旧缓存迁移或首次缺失补录；
- 调用 `lingxingCatalogLookupService` 批量读取 Listing 和产品资料；
- 编排手动强制刷新和范围 single-flight；
- 将 repository 结果转换为兼容消费者需要的规范商品对象；
- 生成不含敏感数据的 cache meta 和日志。

### `src/services/sharedDataService.js`

首阶段保留 `getSharedProductCatalogMap()` 和现有 apply helper，内部改为调用 `productCatalogService`，再按当前 lookup keys 构建一次请求级内存 `Map`。持久层不再保存这些重复 lookup key。这样工厂库存、FBA 发货候选和现有测试可以逐步迁移。

旧 `buildSharedProductCatalogMap()`、`productCatalogMapToRecords()` 和 JSON cache helpers 在双读阶段仅保留迁移/兼容用途；新路径不得继续写 row-set JSON。

### `src/adapters/*`

外部领星 API 细节继续由 adapter 与 `lingxingCatalogLookupService` 持有。repository 和前端不得直接签名或调用领星。

### 路由与前端

新增聚焦的商品目录路由模块，`server.js` 只负责依赖注入和接线。刷新接口固定为：

```http
POST /api/product-catalog/refresh
Content-Type: application/json

{
  "feature": "supplier-board",
  "items": [
    { "sid": 8708, "msku": "JM-DGC-BLUE" }
  ]
}
```

服务端每次最多接受 500 个去重后的 `SID + MSKU`，超出时返回 400；服务端排序并验证每个 SID，忽略客户端店铺名称和国家，防止身份拼接。成功响应包含已提交的规范商品、刷新元数据和 request ID；失败使用明确 4xx/5xx，不返回 `ok: true` 的旧数据。

各页面的既有 feature 模块拥有按钮状态、当前范围收集、请求和成功后的页面重载。`app.js` 只接线。按钮使用现有 Spectrum 语义按钮类和 loading/disabled 状态；无新视觉概念时不增加 CSS。普通查询按钮不得传递 `forceRefresh`。

## 读取与首次补录流程

普通业务调用按以下顺序处理：

1. 从当前业务行提取唯一 `SID + MSKU`，空 SID/MSKU 进入可见诊断；严格消费者直接失败。
2. 用 seller directory 校验 SID，并用规范 seller 覆盖旧别名店铺名称和国家。
3. repository 确认当前旧缓存 manifest hash 已完成迁移；正式部署通常在 PM2 重启前已完成，开发环境可在第一次调用时通过 single-flight 只执行一次迁移。
4. 批量读取 SQLite。迁移命中的记录已经位于 SQLite，并保留 `source=legacy-json`，运行时不能为每个请求重新扫描旧目录。
5. 已存在的身份直接返回，不按年龄自动刷新。
6. 迁移后仍未命中的全新身份，按 SID 批量请求领星 Listing，再按唯一内部 SKU 批量请求产品管理，事务提交后返回。
7. 无法解析的身份或上游失败按调用方严格性传播；不得生成虚假内部 SKU 或空商品成功结果。

首次补录只针对“从未存在”的身份。数据库中已有记录即使很旧，普通查询也不会请求领星；用户必须手动刷新才能更新。

## 当前页面手动刷新流程

1. 前端从当前成功加载、且符合当前筛选条件的结果中收集 `SID + MSKU`，不包含隐藏在其他筛选范围的商品。
2. 后端验证非空范围、批量上限、SID 目录成员和 MSKU 格式，生成排序后的范围指纹与 request ID。
3. 完全相同的并发刷新范围加入同一个 in-flight；不同范围独立获取上游数据，最终由 SQLite 短事务串行提交。
4. 对范围内全部身份强制请求领星 Listing；缺内部 SKU 时只允许现有 Listing 共享 XLSX 备份规则，并在 meta 中标记来源。
5. 对解析出的全部内部 SKU 强制请求领星产品资料。
6. 任一请求失败、任一 Listing 无法解析内部 SKU、任一必要产品记录缺失或别名冲突时，数据库事务不得开始，响应整体失败。
7. 全部上游数据验证成功后，在一个事务中写产品主数据、别名和 Listing 身份。
8. 提交成功后重新从 SQLite 读取同一范围，并在本次响应中返回；前端随即重载当前页面，使新值立即可见。

刷新不删除本次范围外的数据，也不清空旧表后重建。若领星实时记录明确返回空的可选字段，规范化结果可将对应旧值更新为 `NULL`；不能用“保留旧非空值”的合并逻辑伪装成最新资料。

## 旧 JSON 双读迁移

### 部署期迁移

新增显式迁移命令，在服务器 `npm ci` 和语法检查成功后、PM2 重启前运行。迁移命令：

- 创建/升级 SQLite schema；
- 扫描 `shared-product-catalog` JSON；
- 仅当共享目录缺失相应身份时，再读取 `supplier-board-product-map` 作为补充；
- 存在旧商品记录时使用已有 canonical seller cache 校正 SID 对应的店铺名称和国家；旧记录包含 seller cache 未知 SID 时迁移失败，不调用领星 seller API 猜测；
- 在一个受控迁移过程中批量 upsert；
- 写入迁移版本、文件数量、成功/失败记录数、冲突计数和耗时；
- 任一 JSON 损坏、schema 错误或数据库写入失败时退出非零，部署不得继续重启。

迁移开始和结束时都要记录旧缓存文件名、大小和修改时间清单。若旧 PM2 进程在迁移期间新增或替换文件，迁移命令重新扫描；连续三次仍无法得到稳定清单则失败并停止部署。这样避免在旧进程尚未重启时遗漏最后一次 JSON 原子写入。

没有旧缓存的开发/测试环境允许创建空数据库并成功结束。运行时仍保留 lazy `ensureSchema`，但不能在每次请求重新扫描 114 MB 旧文件。部署迁移即使已有完成记录，也必须比较当前 manifest hash；hash 变化时重新执行确定性 upsert，成功后才更新 `legacy_manifest_hash` 和 `legacy_migrated_at_ms`。

### 冲突优先级

旧缓存只有文件级 `updatedAtMs`，迁移采用确定性规则：

1. 实时领星刷新记录最高；
2. 同一旧来源中，每个字段选择文件时间最新的非空值；
3. 最新记录缺字段时，允许用更早记录的非空值补齐，但记录补齐来源；
4. 同一字段存在多个不同非空值时增加 conflict count，并记录实体键、字段名、候选数量、选中来源时间，不记录完整 raw；
5. `store_name` 和 `country` 不参与旧缓存冲突选择，统一由 seller directory 按 SID 校正；
6. 同时间冲突使用稳定文件名和规范值排序决胜，保证重复执行得到相同结果。

迁移得到的记录没有自动 TTL。其来源和原始更新时间必须保留，用户可看到它来自旧缓存，并通过当前页面手动刷新替换为实时领星资料。

### 旧缓存退出

首个生产版本：

- 旧 JSON 保持只读；
- 新请求不再写 `shared-product-catalog` row-set JSON；
- 供应商看板不再写 `supplier-board-product-map`；
- 回滚旧版本仍可使用原文件。

只有在生产指标证明所有消费者稳定使用 SQLite、迁移计数符合预期并完成一次受控备份后，才在独立任务中删除旧文件和兼容代码。本次实现不得自动删除生产缓存。

## 消费者迁移顺序

1. **供应商看板**：停止读取和写入第二份商品 map，直接通过兼容门面使用统一目录。保持税率和报表计算逻辑不变。
2. **工厂库存、FBA 发货候选和货代表格**：这些路径已经使用 `getSharedProductCatalogMap()`，先通过门面无感切换并增加严格缺失测试。
3. **FBA 商品目录**：移除独立 30 分钟 `mskuCache` 的商品资料职责，统一复用 SQLite 中的 Listing 和产品字段；人工箱规模板仍按现有优先级在商品目录结果之后应用。
4. **Jiufang/STA 等严格物流消费者**：继续要求内部 SKU、带电属性、申报与法人字段完整。商品目录缺失必须在 payload 生成前失败。
5. **页面手动刷新**：先在供应商看板实现独立按钮和端到端协议，再复用到其他确实展示商品资料的页面，不能复制不同刷新实现。

每一步均应形成可独立验证的垂直切片；不在同一提交中顺带重构销售利润缓存。

## 返回契约与可观测性

商品目录读取和刷新至少返回：

```json
{
  "source": "sqlite",
  "requestId": "...",
  "scopeCount": 12,
  "dbHitCount": 10,
  "legacyMigratedCount": 1,
  "listingFetchedCount": 1,
  "productFetchedCount": 1,
  "missingCount": 0,
  "conflictCount": 0,
  "cacheUpdatedAt": "...",
  "elapsedMs": 42
}
```

手动刷新另返回 `refreshRequestedCount`、`refreshCommittedCount`、`joinedInFlight` 和 `transactionDurationMs`。性能指标必须区分数据库查询、旧缓存迁移、Listing 请求、产品请求、事务提交和兼容 Map 构建耗时。

日志允许包含：request ID、feature、SID、MSKU、内部 SKU、记录数、来源、操作名、SQLite error code、HTTP 状态和耗时。日志不得包含领星 app secret、token、签名、完整上游 payload 或数据库中的全部商品记录。

数据库健康诊断至少提供：schema version、数据库可打开状态、`quick_check` 结果、各表行数、主文件/WAL 大小和最近迁移时间。运行时数据库损坏或 schema 不兼容时，相关商品目录接口显式失败，并在健康信息中标记 degraded；不能静默删除数据库或偷偷退回旧 JSON 继续返回成功。

## 错误语义

错误边界固定为：

- 无效或超出上限的刷新范围：400；
- SID 不在运行时 seller directory：400；
- 商品别名或数据库身份冲突：409；
- 领星 Listing 或产品接口失败：502；
- 请求身份在成功响应中仍无法解析：422；
- SQLite 打开、迁移、锁超时、完整性或事务失败：503；
- 严格消费者缺少物流必需字段：保持对应业务错误，不由商品目录补默认值。

错误响应包含 request ID、operation 和脱敏诊断。旧数据可以继续保存在数据库中，但失败的刷新响应不能返回 `ok: true` 或声称已经更新。

## 第一阶段依赖与部署

首版依赖固定为 `better-sqlite3@13.0.3` 并提交 `package-lock.json`；它与生产 Node `v22.22.2` 的 engine 契约兼容。不使用 Node 22 仍处于实验状态的 `node:sqlite`。部署继续在阿里云 Linux 服务器执行 `npm ci`，由服务器安装对应平台的原生模块，本地 Mac 二进制不进入部署包。

部署增加以下守卫：

1. `npm ci` 后执行 SQLite 临时数据库建表、事务写入、查询和关闭 smoke；
2. 执行商品目录 schema/旧缓存迁移命令；
3. 迁移失败不重启 PM2；
4. 重启后 deploy integrity 检查商品目录健康和一个只读查询；
5. 不把数据库文件、WAL、旧 JSON 或任何 `.env` 内容打进部署包。

新增迁移和 smoke 脚本必须加入 `scripts/package-deploy.js` 的部署清单，否则打包完整性检查应失败。

由于数据库是可从领星重建的缓存，不将其升级为业务备份源。需要迁移或清理时使用 SQLite backup/VACUUM INTO 或受控文件快照，不能在 PM2 写入期间直接复制主文件并忽略 WAL。

技术栈发生变化时，实施提交必须同步更新 `AGENTS.md` 和相关部署/运行文档，记录分领域 SQLite 总体方向、第一阶段文件位置、身份主键、手动刷新规则、迁移与禁止保存 raw 的约束。后续数据库不得复用商品目录表或刷新规则来绕过各自的独立设计。

## 测试策略

### Repository 单元测试

- schema 首次创建、重复打开、按版本升级和 checksum 不一致失败；
- `catalog_revision` 随成功事务递增、失败事务不变，legacy manifest 元数据可重复读取；
- `SID + MSKU`、内部 SKU 和别名唯一性；
- 批量 upsert 原子性与冲突回滚；
- `NULL` 与真实数值 `0` 的区分；
- WAL/busy timeout/foreign key 配置；
- 临时数据库隔离和关闭；
- 不存在 `raw`、token、secret 等持久字段。

### 迁移测试

- 91 文件等价的小型 fixture 能折叠成唯一 Listing 和商品记录；
- 店铺别名不产生新身份；
- 文件时间最新的非空字段获胜；
- 采购价、供应商、名称冲突有确定结果和脱敏日志；
- 共享目录优先，supplier map 只补缺；
- JSON 损坏、未知 schema 和事务错误失败；
- 重复执行幂等；
- manifest 未变化时不重复导入，回滚期间新增旧 JSON 后 hash 变化并重新迁移；
- 迁移不删除或修改旧文件。

### Service 单元测试

- SQLite 完整命中时领星请求为零；
- 新身份在 SQLite/旧缓存均缺失时只获取缺失范围；
- 相同范围并发请求 single-flight；
- seller directory 校正规范店铺名称和国家；
- 跨 SID 相同 MSKU 不串数据；
- 普通查询不会因记录年龄自动请求领星；
- 手动刷新只请求当前范围并立即返回新值；
- 手动刷新部分失败、未解析内部 SKU、缺产品和别名冲突均不提交；
- 实时空字段可清除旧字段，不能继续合并旧值伪装最新；
- 日志和响应不泄露 raw/token。

### 消费者与路由测试

- 供应商看板不再调用 supplier product map read/save；
- 工厂库存、FBA candidate/freight 复用同一商品只触发一次初次补录；
- FBA catalog 获得 pack quantity/box spec 且不再独立读取产品资料；
- 严格物流缺字段时继续 fail fast；
- refresh route 验证范围、SID、批量上限、错误状态和 request ID；
- 普通查询按钮不触发 refresh，独立按钮具有 loading/disabled、成功重载和可见失败状态。

### 部署与生产验证

- `npm run check:js`、相关定向测试、全量 `npm test`、`git diff --check`；
- Linux 环境 `better-sqlite3` smoke；
- 用生产旧缓存副本执行迁移演练，核对 103 个唯一 `SID + MSKU`、54 个内部 SKU以及冲突统计；
- 首次部署后确认普通查询的 `dbHitCount` 和领星请求数；
- 选择单一页面小范围刷新，核对只请求该范围、事务提交和本次响应即时更新；
- 监控数据库/WAL 大小、错误、miss 和 API 请求量；
- 旧 JSON 至少保留一个稳定观察期，再另行评审清理。

## 验收标准

1. 生产旧缓存迁移后，同一 `SID + MSKU` 只有一个 Listing 身份，店铺展示别名不产生重复记录。
2. 同一内部 SKU 的商品资料只持久化一次；请求级多键 `Map` 只在内存临时构建。
3. SQLite 命中的普通查询不调用领星 Listing/产品接口，记录年龄不会触发自动刷新。
4. 全新身份仅补录缺失范围，不重刷当前请求中的已有商品。
5. 独立手动刷新只覆盖当前页面筛选范围；成功后本次响应和随后页面重载立即显示新值。
6. 刷新任一必要步骤失败时数据库零部分提交、旧数据保持、用户收到可见错误。
7. 供应商看板停止生成第二份商品目录，FBA 商品资料不再维护独立上游缓存。
8. FBA 包装、内部 SKU、带电和申报字段完整，严格物流路径不增加 fallback。
9. 迁移、读取、刷新、冲突和数据库健康都有脱敏指标与日志。
10. 首阶段不删除旧缓存，不修改销售/订单利润缓存，不触碰无关 UI/CSS；设计与文档明确它们将在第二、第三阶段迁移，而不是永久保留 JSON 架构。

## 分阶段交付门

1. **第一阶段交付门**：商品目录迁移、消费者收敛、当前范围刷新、生产指标和旧 JSON 观察期全部通过；当前实施计划仅覆盖此门。
2. **第二阶段设计门**：单独审计领星销售/利润接口粒度，批准 `sales-facts.sqlite` schema、自动/手动刷新、历史修正和对账方案后，才能编写实施计划。该阶段统一 `cacheState`、`updatedAt`、`ageSeconds`、`source`，移除无 TTL 的旧销售看板兜底，并解决底层 30 分钟与页面外层 6 小时不一致。
3. **第三阶段设计门**：批准 FBA 库存快照粒度、保留周期以及工厂库存/销售周报派生结果失效规则后，再实施 `inventory-snapshots.sqlite` 和旧派生 JSON 清理。

任一阶段都必须独立建分支、测试、迁移演练、部署和回滚，不能以“总体架构已批准”为理由跳过后续领域的详细设计审批。

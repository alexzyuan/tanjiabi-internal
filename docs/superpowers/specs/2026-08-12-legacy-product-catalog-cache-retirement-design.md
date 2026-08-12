# 旧商品目录缓存退役设计

## 背景与目标

共享商品目录已经从按请求范围生成的 JSON 缓存迁移到 SQLite。新请求不再写入以下旧目录：

- `data-cache/shared-product-catalog`
- `data-cache/supplier-board-product-map`

旧目录目前仍用于 SQLite 首次迁移，以及回滚到 SQLite 改造前版本时的兼容读取。生产部署和回滚脚本都不会备份或覆盖整个 `data-cache`，因此不能将旧目录当作普通临时文件按年龄直接删除。

本任务建立一个独立、可审计、默认只读的退役工具，在确认 SQLite 稳定、回滚版本均已支持 SQLite 且旧 manifest 未再变化后，分阶段归档并清除这两类旧 JSON。工具不得修改 SQLite、Listing 共享 XLSX 或其他业务缓存。

## 方案选择

### 方案 A：定时按文件年龄直接删除

不采用。文件修改时间不能证明已经迁移，也不能证明当前保留的旧版本不再依赖这些文件。无人值守删除还会绕过健康检查、备份和人工确认。

### 方案 B：预检、外部归档、隔离、显式清除

采用。该方案先证明可退役，再生成独立归档及校验清单，把原目录移入同文件系统隔离区，经过观察窗口后才允许显式清除。每一步都可停止、审计和恢复。

### 方案 C：永久保留

不采用。它最安全但会永久保留约 139 MB 重复数据，并让已经退役的兼容路径长期存在。受控归档已足以满足历史追溯和短期恢复需要。

## 所有权与文件边界

新增后端运维脚本：

- `scripts/retire-product-catalog-legacy-cache.js`：命令行入口、参数校验、受控输出和退出码。
- `src/services/productCatalogLegacyRetirementService.js`：目录发现、manifest、资格校验、归档、隔离与清除状态机。
- `test/productCatalogLegacyRetirement.test.js`：使用临时目录和注入式健康/时钟边界验证全部行为。

复用现有边界：

- `src/utils/cacheStore.js#getLegacyProductCatalogDirectories()` 提供唯一旧目录列表。
- `src/services/productCatalogLegacyMigrationService.js` 的稳定 manifest 算法继续作为迁移一致性的来源；应抽取或导出可复用 helper，不能另写一套不同 hash 算法。
- `src/services/productCatalogRepository.js` 提供只读 metadata、revision、计数与健康状态。

不应修改：

- 商品目录 schema、实时刷新语义或 Lingxing adapter。
- `data-cache/product-catalog/*.sqlite*`。
- `data-cache/listing-shared-catalog/*.xlsx`。
- Supplier、FBA、销售、库存、认证等其他 `data-cache` 数据。
- 前端、CSS、API 路由。

部署脚本首版不自动调用退役命令。退役属于独立运维操作，不能因为普通部署成功就隐式执行。

## 目录与状态文件

默认应用目录仍为 `/opt/tanjia-bi`。归档必须位于应用运行目录之外，避免被部署或回滚脚本误处理：

```text
/opt/tanjia-bi-archives/product-catalog/<retirement-id>/
  legacy-product-catalog.tar.gz
  retirement-manifest.json
```

隔离区位于与源目录相同的文件系统，以便通过原子 rename 移动：

```text
/opt/tanjia-bi/data-cache/product-catalog-legacy-quarantine/<retirement-id>/
  shared-product-catalog/
  supplier-board-product-map/
  retirement-state.json
```

`retirement-id` 使用 UTC 时间和当前 legacy manifest hash 前缀组成，不接受调用者传入任意路径。

## 资格条件

只有全部条件满足时，`archive` 或 `quarantine` 才能继续：

1. 当前生产代码已连续稳定运行至少 30 天；起点使用受控配置或部署 manifest 中可验证的首次 SQLite 上线时间，不从文件 mtime 猜测。
2. 至少连续 3 个当前保留的生产 release manifest 都声明支持 SQLite 商品目录；不能仅按目录数量判断。
3. SQLite 健康状态为 `healthy`，`quickCheck=ok`，schema version、revision、Listing/Product/Alias 计数均可读。
4. `legacy_manifest_hash` 和 `legacy_migrated_at_ms` metadata 存在。
5. 重新扫描得到的旧目录 manifest hash 与 SQLite metadata 完全一致。
6. 旧文件的最大修改时间不晚于 `legacy_migrated_at_ms`。
7. 扫描开始和结束的 manifest 完全一致；最多重试三次，仍不稳定则失败。
8. 没有已存在但状态不明的隔离任务、损坏归档或部分完成状态。

首版允许通过显式参数提供 release manifest 目录和 SQLite 首次上线时间，但参数必须可验证；不允许使用 `--force` 绕过任何资格条件。

## 命令与状态机

### `--dry-run`

默认模式，仅执行读取：

- 解析并验证固定目录；
- 读取 SQLite 健康、metadata 和计数；
- 稳定扫描旧 JSON；
- 验证资格条件；
- 输出文件数、总字节数、manifest hash、最大 mtime、SQLite revision、迁移时间、release 数量及每个检查结果。

任何检查失败时退出非零，并列出受控的失败代码。不得把“不合格”当作成功跳过。

### `--archive`

先完整执行 `--dry-run`，再：

1. 在归档目录内创建临时归档和临时 manifest；
2. 仅加入两个白名单旧目录，归档路径使用固定相对名；
3. 记录每个文件的相对路径、大小、mtime 和内容 SHA-256；
4. 记录整体 legacy manifest、SQLite revision、迁移时间、创建时间和工具版本；
5. 重新读取归档并验证文件列表、单文件 hash 和归档 SHA-256；
6. 通过原子 rename 发布最终归档和 manifest。

归档阶段不移动或删除源目录。已存在相同 retirement ID 的有效归档时必须返回幂等结果；内容冲突则失败。

### `--quarantine --confirm-manifest=<full-hash>`

要求已有验证成功的归档，并再次执行全部资格检查。确认参数必须是完整 manifest hash，不接受前缀。

移动顺序：

1. 写入 `prepared` 状态文件；
2. 逐个将白名单目录原子 rename 到隔离区；
3. 每次移动后更新状态文件并 fsync；
4. 验证运行目录下两个旧目录均不存在，隔离目录文件 manifest 与归档一致；
5. 执行 SQLite 健康检查和商品目录读取 smoke；
6. 标记 `quarantined` 并记录观察开始时间。

任一步骤失败都必须停止。若只移动了一个目录，状态文件必须明确记录部分状态，恢复命令按 manifest 把已移动目录原子移回；不能吞掉异常或继续清理。

### `--restore --retirement-id=<id>`

仅从隔离区恢复，不从任意外部路径解包。恢复前确认目标目录不存在或为空，恢复后重新计算 manifest。恢复成功才标记 `restored`。

### `--purge --retirement-id=<id> --confirm-archive-sha256=<hash>`

仅删除隔离区，不删除外部归档。必须满足：

- 状态为 `quarantined`；
- 隔离观察已满 30 天；
- 当前 SQLite 健康和 manifest metadata 仍正常；
- PM2 当前代码版本及所有保留 release 都支持 SQLite；
- 归档重新验证成功，确认参数与归档 SHA-256 完全一致；
- 隔离区内容 manifest 未变化。

清除完成后保留不含业务数据的墓碑记录，包括 retirement ID、manifest hash、归档 hash、文件数、字节数、隔离和清除时间。

外部归档默认再保留 90 天。归档删除不纳入首版工具，避免把两个不可逆操作放在同一个实现中；后续需要独立审批和独立命令。

## 错误处理与可观测性

所有命令使用结构化日志，至少包含：

- `operation`
- `retirementId`
- `status`
- `checkCode`
- `manifestHash` 或安全前缀
- `fileCount`
- `totalBytes`
- `sqliteRevision`
- `elapsedMs`

日志不记录 JSON 内容、商品身份列表、token、凭据或绝对业务文件路径。对外错误使用固定错误代码；底层 cause 保留在进程内供测试和运维堆栈诊断，但公开摘要必须脱敏。

任何文件系统、归档、SQLite、manifest、状态写入、fsync 或健康检查错误都退出非零。清理步骤使用 `finally` 和 `Promise.allSettled` 尝试清除所有临时文件；操作失败与清理失败同时发生时用 `AggregateError` 保留二者，不能让清理错误覆盖主错误，也不能静默忽略清理失败。

## 并发与锁

退役工具在 `data-cache/product-catalog` 下使用独占锁文件，记录 PID、主机、启动时间和 operation。锁创建使用排他模式；已有活动锁时失败。陈旧锁不能按时间自动删除，必须先证明对应 PID/主机不再运行，并通过独立的受控恢复命令处理。

普通应用进程不会再写旧目录，但 stable-scan 和 quarantine 前的最终复核仍是必需条件，用于检测回滚进程或未发现的兼容写入。

## 测试与验证

测试必须全部使用临时目录和临时 SQLite，不读取工作区或生产 `data-cache`。

最低覆盖：

1. dry-run 合格与每一个资格条件失败。
2. manifest 扫描期间变化，重试后成功以及三次不稳定失败。
3. 只归档两个白名单目录，拒绝符号链接、路径穿越和非 JSON 文件策略偏差。
4. 归档内容、单文件 hash、归档 hash 和幂等执行。
5. archive 失败不移动源目录。
6. quarantine 两目录成功、第二个移动失败、状态写入失败及完整恢复。
7. quarantine 后 SQLite health/read smoke 失败时保持可恢复状态。
8. purge 未满 30 天、确认 hash 错误、归档损坏、隔离内容变化时拒绝。
9. purge 成功只删除隔离目录，外部归档和 SQLite 保留。
10. 操作失败与 cleanup 失败同时完整可观察。
11. 并发锁和陈旧锁的 fail-fast 行为。
12. CLI 成功 JSON、失败非零退出码和日志脱敏。

实现完成后还需运行商品目录迁移、repository、service、部署 smoke 相关测试，以及完整 `npm test` 和 `npm run check`。不需要窄屏或浏览器布局测试，因为该任务无前端改动。

## 运维执行顺序

1. 上线只包含 dry-run/archive 能力的版本。
2. 生产执行 dry-run，人工复核报告。
3. 执行 archive，下载或复制第二份异机备份并验证 SHA-256。
4. 再次人工批准后执行 quarantine。
5. 观察至少 30 天，期间正常部署、健康监控和商品刷新继续运行。
6. 确认所有保留 release 均支持 SQLite 后执行 purge。
7. 外部归档至少保留 90 天；归档最终删除另开任务审批。

首个实现任务默认只交付 dry-run、archive 和验证测试。`quarantine`、`restore`、`purge` 在 dry-run/archive 经生产验证后再作为第二个实施阶段，避免一次上线同时引入归档和不可逆删除能力。

# 库存分类账可导出原报表重建设计

## 目标

库存计提历史批次重建改为只使用领星可导出的 Amazon 库存分类账原报表文件（`GET_LEDGER_DETAIL_VIEW_DATA`）。每个店铺、每个自然月必须先创建导出任务、取得完成文件并归档，随后从归档文件解析库存事件并做 FIFO 重建。领星明细 API 不得再作为正式重建输入或失败时的隐式回退。

## 已知事实与根因

此前代码曾接入导出任务、轮询与下载，但生产导出任务返回 `UNKNOWN`，没有获得可解析的文件；之后为了绕开该阻塞，正式路径被改为 `/cost/center/ods/detail/query` 的 JSON。因而当前生产缓存的正式来源是明细 API JSON，不是已下载的报表文件。

这次修改不把旧导出逻辑直接“打开”。`UNKNOWN` 必须被保留为明确失败，并记录脱敏的任务状态和范围；只有先以可下载、可解析、校验通过的真实文件验证导出契约，才能写入任何历史缓存。

## 采用方案

### 方案 A：导出文件是唯一正式输入（采用）

1. `LingxingAdapter` 负责创建导出任务、轮询状态、续期下载地址及二进制下载。
2. `inventoryLedgerRawReportService` 逐店铺/月执行任务，只有 `DONE` 且得到非空文件才进入解析。
3. `inventoryLedgerRawReportStore` 原子归档原文件与 manifest；manifest 记录报告类型、任务号、文档号、压缩方式、文件 SHA-256、字节数、时间范围、解析行数和获取时间。
4. `inventoryLedgerReportParser` 只解析归档的原报表文件，输出 FIFO 重建所需的标准事件；API JSON parser 从正式重建路径移除。
5. 全部范围的文件、解析和 FIFO 校验通过后，才原子替换 `inventory-provision-history`。任一失败保留旧缓存。

### 方案 B：文件优先、API 自动回退（拒绝）

这会再次把两种口径混在同一份库存计提缓存中，且导出任务失败会被隐藏，不能满足可审计性。

### 方案 C：继续只用明细 API（拒绝）

虽然速度较快，但没有可下载的原报告文件，不符合本次确认的数据源要求。

## 模块边界

- `src/adapters/lingxingAdapter.js`：领星导出任务协议和二进制下载；不处理文件命名、FIFO 或缓存。
- `src/services/inventoryLedgerRawReportService.js`：任务生命周期、范围编排、受控轮询、归档、解析、重建与结构化日志。
- `src/services/inventoryLedgerRawReportStore.js`：原文件、manifest、job state 和历史缓存批次的原子读写。
- `src/services/inventoryLedgerReportParser.js`：GZIP/TSV 原文件解析与严格字段校验；不再提供正式使用的 API JSON parser。
- `src/services/inventoryProvisionLedgerRebuilder.js`：纯 FIFO 重建；不接触 API 和文件系统。
- `src/jobs/inventoryLedgerRawRebuildJob.js`：每月 10 日执行上个月，不新增前端下载按钮。

不会改动：成本刷新、Listing/产品管理匹配、页面交互、CSS、普通库存计提查询接口。

## 导出与失败语义

报表范围固定为自然月 `00:00:00Z` 到该月末 `23:59:59Z`，报告类型为 `GET_LEDGER_DETAIL_VIEW_DATA`；店铺、区域和 marketplace 均使用店铺目录中的真实值。

- `IN_QUEUE`、`IN_PROGRESS`：按受限次数和间隔轮询；每一次记录 `runId`、月份、卖家及状态。
- `DONE`：读取任务返回的 URL；若无 URL，以 `report_document_id` 请求续期 URL；下载非空文件，解析并归档。
- `FATAL`、`CANCELLED`、`UNKNOWN`、空状态、轮询超时、无文件 URL、下载非 2xx、空文件、压缩方式/字段/日期不正确：立即失败。
- 报表失败时不调用 detail API，不写成功 manifest，不覆盖任何月份缓存；失败状态可在运维状态中追溯。

## 可追溯性

每个成功 manifest 至少包含：`source=lingxing-exported-inventory-ledger-report`、`reportType`、`sellerId`、`marketplaceId`、`region`、时间范围、`taskId`、`reportDocumentId`、`compressionAlgorithm`、`rawFile`、`sha256`、`byteCount`、`fetchedAt`、`parsedRowCount`、`runId`。不得写入 URL 查询参数、令牌或完整外部响应。

`force` 会重新导出并重新归档；非 force 只复用符合上述 source、文件存在且 SHA-256 仍一致的成功 manifest。旧 JSON-API manifest 不能作为可复用输入，且必须明确提示需要导出文件后才能全量重建。

## 验证与启用顺序

1. 使用 fixture 覆盖任务创建、轮询、URL 续期、下载、文件解析、归档和“API 不得回退”。
2. 以 `dryRun` 实际请求一个小范围的领星导出任务，确认得到真实可解析文件；dry-run 不归档、不更新历史缓存。
3. 验证文件 manifest 和解析元数据后，打包部署。
4. 部署后运行一次受控全量重建；这一步会写历史计提缓存，须在当次获得明确授权，且不触发成本刷新。


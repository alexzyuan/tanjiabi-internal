# 三轮基础工程改动整理

日期：2026-07-10

本文档整理本次按阶段执行的前三轮基础工程工作：

1. 仓库卫生 + 测试基线
2. 领星 API client 抽象 + 同步 job history
3. JSON store / repository + job lock

说明：当前工作目录不是 Git 仓库，没有 `.git` 元数据，因此本次无法按轮创建分支、提交 commit 或生成 Git diff。所有改动均在当前工作区内完成。

## 第 1 轮：仓库卫生 + 测试基线

### 目标

清理 macOS 元数据污染，稳定文件遍历逻辑，明确 Node 版本要求，并建立可复现的测试基线。

### 已完成改动

- 删除工作区内发现的 `.DS_Store`、`._*`、`.AppleDouble`、`.LSOverride` 元数据文件。
- 新增 `.gitignore`，忽略：
  - `.DS_Store`
  - `._*`
  - `.AppleDouble`
  - `.LSOverride`
  - `__MACOSX/`
  - `.env`
  - `node_modules/`
  - `data-cache/`
  - `uploads/`
  - `output/`
  - `releases/`
  - `.deploy-tmp-*`
  - `.playwright-cli/`
  - `*.log`
  - `tanjia-bi-deploy.tar.gz`
- 新增 `src/utils/pathFilters.js`，统一判断仓库元数据文件和非源码路径。
- 文件遍历逻辑接入元数据过滤：
  - `scripts/build-styles.js`
  - `scripts/check-css-standards.js`
  - `scripts/package-deploy.js`
  - `test/stylesStructure.test.js`
- 新增 `test/pathFilters.test.js`，覆盖跨平台路径过滤、元数据排除、本地缓存/部署产物排除。
- 在 `package.json` / `package-lock.json` 中明确 Node 版本：
  - `>=22.19.0 <25`
- 更新运行与部署文档：
  - `README.md`
  - `SERVER_DEPLOYMENT.md`
- 更新 `deploy.sh` / `rollback.sh`：
  - 部署/回滚前检查 Node 版本
  - 使用 `npm ci` 保持依赖安装稳定
- 将新工具加入 `npm run check:js` 覆盖范围。

### 验证结果

已执行：

```bash
find . \( -name '._*' -o -name '.DS_Store' -o -name '.AppleDouble' -o -name '.LSOverride' \) -print | wc -l
npm ci
npm run check:js
node scripts/build-styles.js --check
node --test test/pathFilters.test.js
npm test
```

结果：

- 元数据文件数量为 `0`。
- `npm ci` 通过；npm audit 报告仍有 `1 high severity vulnerability`，未在本轮处理。
- `npm run check:js` 通过。
- `node scripts/build-styles.js --check` 通过。
- `test/pathFilters.test.js` 通过。
- `npm test` 仍有 CSS 结构测试失败，属于既有 CSS 分层/迁移债务，不是本轮元数据清理引入。

## 第 2 轮：领星 API client 抽象 + 同步 job history

### 目标

将 `lingxingAdapter.js` 中的通用请求、认证、签名、分页、错误处理能力拆出，降低后续维护领星接口的风险；同时为同步任务增加可追踪 job history。

### 已完成改动

新增目录：

```text
src/adapters/lingxing/
```

新增模块：

- `src/adapters/lingxing/index.js`
- `src/adapters/lingxing/client.js`
- `src/adapters/lingxing/auth.js`
- `src/adapters/lingxing/sign.js`
- `src/adapters/lingxing/pagination.js`
- `src/adapters/lingxing/errors.js`

模块职责：

- `client.js`
  - 统一执行 Lingxing signed request
  - 支持 timeout
  - 支持 retry
  - 统一 JSON parse
  - 统一 HTTP/API 错误处理
- `auth.js`
  - token state
  - token 获取
  - token refresh
  - token 过期判断
- `sign.js`
  - 复用现有 `createLingxingSign`
  - 生成 signed params / query params
- `pagination.js`
  - 通用分页记录收集
  - 保留 `offset/length/total/hasNext` 模式
- `errors.js`
  - 统一错误结构
  - 敏感信息脱敏
  - timeout / retryable / tokenExpired 识别

兼容性改动：

- `src/adapters/lingxingAdapter.js` 保留原有业务 facade 和现有 endpoint 方法。
- 将 token、sign、request 相关能力委托给新模块。
- 保持现有 service 层调用方式不变。

新增测试：

- `test/lingxingClient.test.js`
  - 敏感信息脱敏
  - Lingxing API 错误归一化
  - retry 行为
  - timeout 分类
  - 通用分页 helper
- 原有 `test/lingxingAdapter.test.js` 继续通过，验证 facade 兼容性。

同步 job history：

- 新增 `src/repositories/syncJobRepository.js`
- 支持记录：
  - `jobId`
  - `jobName`
  - `triggerType`
  - `triggeredBy`
  - `startedAt`
  - `finishedAt`
  - `status`
  - `fetchedCount`
  - `processedCount`
  - `failedCount`
  - `errorSummary`
  - `durationMs`
  - `metadata`
- `src/services/syncService.js` 已接入：
  - success
  - failed
  - skipped
  - manual
  - scheduled
  - startup
- `/api/sync/status` 通过 `routes/core.js` 支持返回 recent history，同时保留原有顶层 sync status 字段。

### 验证结果

已执行：

```bash
node --test test/lingxingClient.test.js test/lingxingAdapter.test.js
node --test test/syncJobRepository.test.js test/syncService.test.js
```

结果：

- Lingxing client / adapter 相关测试通过。
- sync job history 相关测试通过。
- 现有 adapter 对 service 层 API 保持兼容。

## 第 3 轮：JSON store / repository + job lock

### 目标

在不迁移数据库的前提下，先建立统一 JSON 文件读写能力、repository 边界，并为同步任务增加 job lock，避免重复并发执行。

### 已完成改动

新增 `src/utils/jsonStore.js`：

- `readJson(filePath, fallback)`
- `writeJsonAtomic(filePath, data)`
- `updateJsonAtomic(filePath, updater, fallback)`
- `backupJson(filePath)`
- `readJsonWithRecovery(filePath, fallback)`

能力：

- 自动创建父目录
- temp file + fsync + rename 原子写
- 写入失败不替换旧文件
- JSON parse 失败抛出明确 `JSON_PARSE_FAILED`
- 支持 `.bak` 备份恢复

新增测试：

- `test/jsonStore.test.js`
  - missing file fallback
  - 原子写入
  - 序列化失败不破坏旧文件
  - JSON parse 失败分类
  - backup/recovery
  - sequential update

新增 repository：

- `src/repositories/syncJobRepository.js`

说明：

- 本轮优先覆盖同步任务关键路径。
- 供应商、预算、FBA task、用户配置等其他高价值状态文件尚未批量迁移，已记录为后续分阶段工作，避免一次性扩大 service 改动面。

新增 job lock：

- `src/jobs/jobLock.js`

能力：

- `acquireJobLock(jobName, options)`
- `releaseJobLock(lock, options)`
- `withJobLock(jobName, fn, options)`

lock 字段：

- `jobName`
- `lockId`
- `acquiredAt`
- `expiresAt`
- `owner`
- `metadata`

行为：

- 同一个 `jobName` 同一时间只允许一个未过期 lock。
- 支持 TTL，过期 lock 可被新任务接管。
- 获取失败返回 skipped 语义，不继续执行同步。
- release 失败会记录日志，但不会掩盖原始同步错误。

新增测试：

- `test/jobLock.test.js`
  - 获取成功
  - 重复获取失败
  - 过期锁可重新获取
  - `withJobLock` 成功后释放
  - `withJobLock` 异常后释放

同步流程接入：

- `src/services/syncService.js`
  - `runSync({ triggerType, triggeredBy, executeSync })`
  - `runManualSync()` 保持兼容
  - scheduler startup 触发记录为 `startup`
  - scheduler interval 触发记录为 `scheduled`
  - 重复触发记录 `skipped`
  - 成功记录 `success`
  - 失败记录 `failed`

文档更新：

- `PROJECT_STRUCTURE.md`
  - 补充 `src/adapters/lingxing/*`
  - 补充 `src/utils/jsonStore.js`
  - 补充 `src/repositories/*`
  - 补充 `src/jobs/*`
  - 说明当前 JSON 文件锁只适合同服务器/共享文件系统，不保证跨机器强一致
  - 说明 repository / lock 是后续迁移 SQLite/PostgreSQL 的边界

### 验证结果

已执行：

```bash
node --test test/jsonStore.test.js
node --test test/jobLock.test.js
node --test test/syncJobRepository.test.js
node --test test/syncService.test.js
node --test test/lingxingClient.test.js test/lingxingAdapter.test.js test/jsonStore.test.js test/syncJobRepository.test.js test/jobLock.test.js test/syncService.test.js test/serverRoutesStructure.test.js
npm run check:js
node scripts/build-styles.js --check
npm test
```

结果：

- 聚焦后端测试：`30` 个通过。
- `npm run check:js` 通过。
- `node scripts/build-styles.js --check` 通过。
- `npm test` 结果：
  - `252` pass
  - `14` fail
  - `1` skipped

失败项均来自既有 `test/stylesStructure.test.js` CSS 分层/迁移债务：

- `styles.css` token root 数量仍不符合预期
- brand blue 仍有硬编码值
- `styles.css` 大小超过测试预算
- 若干期望拆出的 CSS 文件仍不存在
- 部分 legacy CSS selector 仍未迁出

这些失败在第 1 轮已分类为旧有 CSS 技术债，不是第 2/3 轮 backend 改动引入。

## 当前未完成项与边界

### 未完成

- 未批量迁移以下 service 的 JSON 状态写入到 repository：
  - supplier detail
  - budget target
  - FBA task
  - auth user
  - store inspection settings
  - AI provider settings
  - platform cashflow cache
- 未将 `lingxingAdapter.js` 所有业务 endpoint 进一步拆成更细业务 API 文件。
- 未解决既有 CSS structure 测试失败。
- 未处理 `npm audit` 报告的 `1 high severity vulnerability`。

### 当前边界

- 本次没有引入 React/Vue。
- 没有改 UI 视觉。
- 没有改业务指标口径。
- 没有改现有前端 API 返回结构的核心字段。
- 没有迁移数据库。
- 没有引入 Redis、BullMQ、PostgreSQL 等新基础设施。
- 同步 job lock 是本地 JSON 文件锁，适合同一服务实例或共享文件系统，不保证跨机器强一致。

## 建议后续顺序

1. 先独立处理 CSS structure 旧债，恢复 `npm test` 全绿基线。
2. 继续把高价值 JSON 状态文件按 service 分批迁移到 repository。
3. 进一步拆分 `lingxingAdapter.js` 中的业务 endpoint 组，例如 sales、inventory、ads、purchase、finance、fba。
4. 为 `/api/sync/status` 的 history 展示补前端 UI，但保持轻量，不做同步中心大改版。
5. 根据线上部署形态决定是否把 job lock 升级为 SQLite/PostgreSQL advisory lock 或其他跨进程强一致方案。

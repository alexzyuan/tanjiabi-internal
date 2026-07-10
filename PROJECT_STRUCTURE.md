# 探嘉 BI 项目结构

当前项目是原生 HTML/CSS/JS 前端 + Node 后端 API + 定时同步任务的单体应用。前端已经从早期 `app.js` 单体逐步拆分为 `assets/js/*` 通用工具和 `assets/js/features/*` 功能模块；后续开发应继续沿用这个分层，不要把新功能重新堆回 `app.js`。

## 顶层文件

| 路径 | 作用 |
| --- | --- |
| `index.html` | 主应用 DOM 结构入口。视图 markup 暂时仍集中在这里，直到批准进一步拆分。 |
| `login.html` | 登录页入口。 |
| `app.js` | 前端启动和功能组合层。负责组装 shared utilities、feature factories 和全局初始化；不承载新功能的业务渲染、状态机或事件绑定大块逻辑。 |
| `styles.css` | 生成产物，由 `assets/css/*` 分层源文件构建而来。不要手改。 |
| `server.js` | Node 后端服务、API 路由、鉴权、静态资源分发和调度器启动入口。 |
| `.env.example` | 环境变量模板，应随代码一起交付；真实 `.env` 不应提交或打包。 |
| `package.json` / `package-lock.json` | Node 依赖和脚本定义。 |
| `AGENTS.md` | AI 协作和架构边界规则。新会话应优先遵守这里的模块归属说明。 |
| `design.md` | 当前产品设计规则、语义 token 和 UI 决策来源。 |

## 前端结构

| 路径 | 作用 |
| --- | --- |
| `assets/js/ui-utils.js` | DOM、事件、可见性、modal、状态文案、下载等通用 UI 工具。 |
| `assets/js/dashboard-loader.js` | 通用 dashboard 加载、loading/error/cleanup 流程。 |
| `assets/js/filter-controls.js` | 多选筛选、分组下拉、筛选选项渲染。 |
| `assets/js/navigation-utils.js` | 导航点击、分组状态、折叠侧栏 flyout 相关工具。 |
| `assets/js/sales-shell.js` | 销售视图外壳、日期弹层、全局销售筛选可见性。 |
| `assets/js/table-sorter.js` | 通用表格排序桥接。 |
| `assets/js/date-utils.js` | 日期格式化和 dashboard 日期范围工具。 |
| `assets/js/file-utils.js` | 文件读取和 base64 工具。 |
| `assets/js/image-url.js` | 图片 URL 归一化和缓存路由封装。 |
| `assets/js/fba-utils.js` | FBA 表单和字段读取工具。 |
| `assets/js/features/*` | 具体业务功能模块。功能自己的 API 请求、状态、事件绑定和 DOM 渲染默认放这里。 |

功能模块示例：

- `assets/js/features/payables-dashboard.js`
- `assets/js/features/supplier-detail.js`
- `assets/js/features/supplier-board.js`
- `assets/js/features/sales-forecast.js`
- `assets/js/features/knowledge-library.js`
- `assets/js/features/fba-automation.js`
- `assets/js/features/sidebar-shell.js`
- `assets/js/features/auth-shell.js`

## CSS 结构

`styles.css` 由 `scripts/build-styles.js` 按以下顺序生成：

| 路径 | 作用 |
| --- | --- |
| `assets/css/tokens/*` | Spectrum 语义 token、项目语义别名和兼容变量。 |
| `assets/css/base/*` | reset、基础元素规则。 |
| `assets/css/layout/*` | 应用 shell、sidebar、topbar、dashboard chrome 等布局层。 |
| `assets/css/components/*` | 复用组件和跨页面 UI 模式，如 filters、panel、table controls、status pill、modal。 |
| `assets/css/pages/*` | 页面级样式，只放该页面独有布局和状态。 |
| `assets/css/legacy/current.css` | legacy 退休标记；新规则不要放这里。 |

修改样式时应编辑 `assets/css/*` 源文件，然后运行：

```bash
npm run build:css
npm run build:css -- --check
```

## 后端结构

| 路径 | 作用 |
| --- | --- |
| `src/config/index.js` | 环境变量配置读取和默认值。 |
| `src/adapters/*` | 外部系统适配器，例如领星 ERP。 |
| `src/adapters/lingxing/*` | 领星通用 client/auth/sign/pagination/error 分层；`lingxingAdapter.js` 保持业务 facade 兼容。 |
| `src/repositories/*` | 本地持久化 repository，负责具体 JSON 文件路径、默认值和基础读写边界。 |
| `src/jobs/*` | 后端任务辅助能力，例如同步任务文件锁。 |
| `src/services/*` | 业务组合、数据归一化、导出、同步和领域逻辑。 |
| `src/data/*` | mock 数据、静态映射和内置配置数据。 |
| `src/utils/jsonStore.js` | 统一 JSON store，提供 fallback 读取、原子写、原子更新、备份和备份恢复。 |
| `src/services/lingxingDashboardMapper.js` | 领星字段翻译和 dashboard 指标映射。 |

默认归属：

- API 路由和鉴权在 `server.js`。
- 外部 API 调用在 `src/adapters/*`。
- 领星 token、签名、通用请求、错误归一化和分页能力在 `src/adapters/lingxing/*`，业务 endpoint 方法仍由 `src/adapters/lingxingAdapter.js` 兼容导出。
- 业务聚合、导出和数据计算在 `src/services/*`。
- JSON 状态文件的新增写入必须走 `src/utils/jsonStore.js` 或 repository，不要在 service 中新增裸 `writeFile(JSON.stringify(...))`。
- 同步任务历史由 `src/repositories/syncJobRepository.js` 负责存储；同步流程只调用 repository API。
- 同步任务并发保护由 `src/jobs/jobLock.js` 负责。当前是本机 JSON 文件锁，支持 TTL 防止进程崩溃后永久锁死；它适合同一服务器/同一共享文件系统，不保证跨机器强一致。后续迁移 SQLite/PostgreSQL 时，repository 和 lock 模块是替换边界。
- 字段名翻译和指标映射在 mapper 文件中。

## 测试与验证

| 路径 | 作用 |
| --- | --- |
| `test/*.test.js` | Node test runner 测试。 |
| `test/frontendStructure.test.js` | 前端模块边界和结构回归测试。 |
| `test/stylesStructure.test.js` | CSS 分层和生成产物结构测试。 |
| `test/serverSecurity.test.js` | 登录、权限、session、SSRF、静态资源缓存等服务端安全回归测试。 |

常用命令：

```bash
npm run build:css -- --check
npm run check
npm test
```

涉及渲染布局、交互或数据请求的前端改动，还需要做浏览器验证。

## 打包与部署

| 路径 | 作用 |
| --- | --- |
| `scripts/package-deploy.js` | 生成部署包。默认不包含 CSS；需要部署样式时使用 `ALLOW_CSS_DEPLOY=1` 和 `--include-css`。 |
| `deploy.sh` | 部署脚本。 |
| `rollback.sh` | 回滚脚本。 |

打包规则：

- 真实 `.env`、`data-cache/`、`uploads/`、`node_modules/` 不应进入部署包。
- `.env.example` 是模板文件，应随代码包交付。
- 需要完整源码归档时，可以额外生成 zip，但同样应排除真实 `.env`、缓存数据、上传文件和依赖目录。

## 已知技术债提醒

- API 路由仍未完全迁入强制 `auth` 字段路由表，当前只有部分接口完成。
- 多个高风险 service 仍缺测试覆盖，需要后续按业务优先级补齐。
- 持久化仍主要依赖 JSON 文件。`jsonStore`、repository 和 job lock 已先覆盖同步任务关键路径；供应商、预算、FBA task、用户配置等其他高价值状态文件仍需继续逐步迁移到 repository。

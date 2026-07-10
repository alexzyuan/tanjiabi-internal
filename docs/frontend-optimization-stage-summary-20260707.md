# 探嘉 BI 前端冗余治理阶段说明

日期：2026-07-07

## 阶段结论

本阶段完成的是“结构性冗余治理”的阶段性交付，覆盖 G1.1、G2.1、G2.2、G2.3 的第一轮收敛。

当前实现遵守新版 `design.md` 和 `AGENTS.md`：

- 继续保持原生 HTML/CSS/JavaScript。
- 不引入 React island、React 包、Vite、Webpack 或其他打包工具。
- 新迁移样式使用项目语义 token，并按 Adobe React Spectrum 的可访问交互、焦点态、间距和状态原则收敛。
- 不做移动端重设计，只保持既有响应式正确性。
- 不改变用户确认过的默认开放权限策略。

## 已优化到哪个阶段

### G1.1 LingxingAdapter 单例与 token 复用

已完成并有测试覆盖。

- 新增进程级 `getLingxingAdapter()` 单例入口。
- 多个领星相关接口复用同一个 OAuth token 请求。
- token 失效时自动刷新并重试一次。
- 测试覆盖单例、token 复用和失效刷新。

### G2.1 server.js 路由表与权限边界

已完成阶段性结构收敛。

- 路由改为显式 auth 分类，新增接口需要明确声明权限策略。
- public、session、admin、finance、default-open 路由均有测试覆盖。
- 采购、供应商、预算等默认开放接口按用户确认保持开放。
- 财务和后台管理相关路由继续保留角色检查。

### G2.2 app.js 原生 ES module 拆分

已完成阶段性拆分。

- `index.html` 使用原生 module script 加载前端入口。
- `app.js` 收敛为启动和协调层。
- 通用工具拆到 `assets/js/*`，例如 UI 工具、表格排序、日期、文件、图片 URL、导航、筛选和销售 shell。
- 业务功能拆到 `assets/js/features/*`，例如销售、广告、售后、库存、采购、财务、FBA 和后台设置。
- `ui-utils.js` 保留 ES module exports 和 legacy global，降低迁移风险。

当前规模：

| 文件/目录 | 当前规模 |
| --- | ---: |
| `app.js` | 1,238 行 / 34,727 bytes |
| `assets/js` | 44 个 JS 文件 |
| `assets/js/features` | 33 个功能模块 |

### G2.3 styles.css 分层、去重与 token 化

已完成本阶段迁移，后续仍可继续削减 legacy。

- `styles.css` 已变为生成产物，由 `npm run build:css` 从 `assets/css/*` 拼接生成。
- 源 CSS 分层为 `tokens/`、`base/`、`layout/`、`components/`、`pages/`、`legacy/`。
- `npm run check` 会执行 `npm run build:css -- --check`，防止手改生成文件。
- `test/stylesStructure.test.js` 固化 CSS 分层规则、体积预算和页面归属。
- 本阶段迁移并测试了：
  - `assets/css/pages/24-review-rating.css`
  - `assets/css/pages/26-clearance-calculator.css`
  - `assets/css/pages/52-factory-inventory.css`
  - `assets/css/pages/53-supplier-board.css`
  - `assets/css/pages/68-knowledge-library.css`
- 从 `assets/css/legacy/current.css` 移除了 supplier-board、factory-inventory、review-rating、clearance、knowledge-library 等页面样式残留。
- 移除了 legacy 中残留的通用 `.filters` 覆盖，让共享筛选栏回到 `assets/css/components/30-surfaces-and-filters.css` 统一维护。
- 修正 supplier-board 在 900px 宽度下被全局 `.module-grid` 历史媒体查询压成 1 列的问题，页面作用域规则现在能稳定覆盖为 2 列。

当前规模：

| 文件/目录 | 当前规模 |
| --- | ---: |
| `styles.css` | 12,182 行 / 279,004 bytes |
| `assets/css/legacy/current.css` | 2,068 行 / 37,731 bytes |
| `assets/css` | 33 个 CSS 源文件 |
| `assets/css/pages/24-review-rating.css` | 257 行 / 6,869 bytes |
| `assets/css/pages/26-clearance-calculator.css` | 103 行 / 2,629 bytes |
| `assets/css/pages/52-factory-inventory.css` | 142 行 / 4,051 bytes |
| `assets/css/pages/53-supplier-board.css` | 75 行 / 2,353 bytes |
| `assets/css/pages/68-knowledge-library.css` | 820 行 / 20,889 bytes |

说明：`styles.css` 仍然较大，但已经不是主要维护入口。后续优化重点应继续缩小 `assets/css/legacy/current.css`，而不是直接编辑 `styles.css`。

## 本阶段没有做的事

- 没有引入 React、React Spectrum 包、Vite、Webpack 或其他框架/打包工具。
- 没有做移动端重设计。
- 没有改变用户确认过的默认开放权限策略。
- 没有把 `index.html` 拆成模板系统或组件系统。
- 没有把全部 legacy CSS 一次性清零。
- 没有把 JSON 文件存储迁移到数据库。

## 验证结果

最终验证时间：2026-07-07

| 验证项 | 结果 |
| --- | --- |
| `npm run build:css -- --check` | 通过 |
| `node --test test/stylesStructure.test.js` | 35/35 通过 |
| `npm run check` | 通过 |
| `npm test` | 209/209 通过 |
| supplier-board Playwright smoke | 通过 |
| factory-inventory Playwright smoke | 通过 |
| review-rating / clearance Playwright smoke | 通过 |
| knowledge-library Playwright smoke | 通过 |

最终 supplier-board smoke 详情：

- 本地服务：`PORT=4188 NODE_ENV=test DATA_PROVIDER=mock AUTH_ENABLED=false node server.js`
- URL：`http://localhost:4188/`
- Browser plugin 状态：可打开页面，但 DOM snapshot API 报 `incrementalAriaSnapshot is not a function`，因此使用 Codex 运行时 Playwright + 本机 Chrome fallback。
- 验证方式：对 `/api/dashboard/supplier-board` 提供最小 mock 数据，只验证前端渲染、CSS 和交互。
- 桌面 1365x768：
  - `#view-supplier-board.active` 可见。
  - `.supplier-board-sticky` 可见。
  - filter 为 5 列，KPI 为 6 列。
  - `#supplier-board-table` min-width 为 `1680px`。
  - `#supplier-board-supplier` 可键盘聚焦。
  - 页面无水平溢出，控制台 error/warn 为 0。
- 窄宽 900x720：
  - filter 为 2 列，KPI 为 2 列。
  - 页面无水平溢出。
- 截图临时文件：`/tmp/bi-erp-supplier-board-css-smoke-20260707.png`

## 后续建议

下一阶段建议继续做 G2.3 的剩余 CSS 收敛，优先处理仍留在 `assets/css/legacy/current.css` 的高复用或高重复区域。

推荐顺序：

1. 抽离剩余 guide/operations course 相关页面样式。
2. 继续合并表格、空态、加载态、状态提示和全局响应式历史规则。
3. 对每次迁移补结构测试，防止样式回流到 legacy。
4. 等 legacy CSS 缩小到可控规模后，再评估是否拆 `index.html` 的重复 markup。

## 交付物

- 项目内文档：`docs/frontend-optimization-stage-summary-20260707.md`
- 下载目录文档副本：`/Users/maclex/Downloads/bi-erp-frontend-optimization-stage-summary-20260707.md`
- 下载目录项目压缩包：`/Users/maclex/Downloads/bi-erp-frontend-optimized-20260707.tar.gz`

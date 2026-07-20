# 探嘉 BI 视觉组件基线 V1

更新时间：2026-07-20

本文档补充 `design.md` 的组件级执行标准。`design.md` 仍是唯一主规范；本文档负责把高频 BI 组件拆成可落地、可验收的实现口径。

## 1. 表格

表格是探嘉 BI 的核心信息载体。表格标准优先保证扫描效率、数字可比性、状态可追溯和大数据量下的稳定渲染。

### 1.1 标准结构

新表格默认使用以下结构：

```html
<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th class="table-col-text" scope="col">产品</th>
        <th class="table-col-number" scope="col">销量</th>
        <th class="table-col-money" scope="col">销售额</th>
        <th class="table-col-percent" scope="col">利润率</th>
        <th class="table-col-date" scope="col">更新时间</th>
        <th class="table-col-status" scope="col">状态</th>
        <th class="table-col-actions" scope="col">操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>
```

执行规则：

- `.data-table` 是新表格唯一基类；旧表格可继续被全局兼容样式覆盖，但新增表格不能只依赖 `body:not(.login-body) table`。
- 外层容器默认用 `.table-wrap`；需要可见边框滚动框时叠加 `.table-scroll`。
- 表头单元格必须使用 `scope="col"`；分组表头使用 `scope="colgroup"`。
- 可排序表头继续复用 `assets/js/table-sorter.js`，排序态必须写入 `aria-sort`。
- 表格内按钮使用 `.table-action` 或现有按钮层级类；危险操作必须显式使用危险样式并二次确认。

### 1.2 列类型

| 列类型 | 类名 | 对齐 | 数字等宽 | 最小宽度 | 内容策略 |
| --- | --- | --- | --- | --- | --- |
| 文本 | `.table-col-text` | 左对齐 | 否 | 140px | 默认允许省略，关键名称可配 `title` |
| 数字 | `.table-col-number` | 右对齐 | 是 | 96px | 不混入单位解释，单位放表头 |
| 金额 | `.table-col-money` | 右对齐 | 是 | 112px | 保留币种符号或在表头标币种 |
| 百分比 | `.table-col-percent` | 右对齐 | 是 | 88px | 使用 `%`，空值显示 `-` |
| 日期 | `.table-col-date` | 左对齐 | 是 | 112px | 使用固定格式，避免同列混用日期和说明 |
| 状态 | `.table-col-status` | 居中 | 否 | 96px | 使用 `.status-pill` 或 `.risk-badge` |
| 操作 | `.table-col-actions` | 右对齐 | 否 | 112px | 按钮不换行，最多 2 个常显操作 |

补充规则：

- 金额、百分比、库存数量、销量、天数等可比较数字必须使用右对齐和 `tabular-nums`。
- 长文本默认不撑开表格；需要展示完整内容时使用 tooltip、弹层或详情页。
- 不允许同一列同时出现“数字 + 长业务解释”；解释应拆到相邻说明列或详情区域。

### 1.3 Sticky 列

Sticky 列只用于横向字段很多、首列或操作列必须持续可见的表格。

标准类：

- `.table-sticky-start`：固定左侧列。
- `.table-sticky-end`：固定右侧列。
- `--table-sticky-left` / `--table-sticky-right`：声明该 sticky 单元格的偏移量。

执行规则：

- 复杂多 sticky 列允许页面级 CSS 设置偏移量，但命名必须围绕 `.table-sticky-start` / `.table-sticky-end` 扩展。
- sticky 表头和 sticky 单元格必须保持背景不透明，避免滚动时文字重叠。
- sticky 列不能用于隐藏信息架构问题；如果字段过多，优先评估列分组、默认列集或详情抽屉。
- 销售预估、供应商看板、库存相关表格后续逐页迁移，迁移前保留现有页面级规则。

### 1.4 表格状态

表格状态必须在表格区域内表达，不让用户误以为数据已经成功加载。

标准状态：

| 状态 | 类名 | 文案要求 |
| --- | --- | --- |
| 加载中 | `.table-state.is-loading` | 说明正在加载的数据范围 |
| 空数据 | `.table-state.is-empty` | 说明当前筛选没有结果，并提示可调整筛选 |
| 错误 | `.table-state.is-error` | 说明失败原因或可追踪的错误状态 |
| 无权限 | `.table-state.is-denied` | 说明权限不足，不伪装成空数据 |

推荐结构：

```html
<tr class="table-state-row">
  <td class="table-state is-empty" colspan="7">当前筛选没有数据，请调整时间或店铺后重试。</td>
</tr>
```

执行规则：

- 错误状态不能静默降级为空态。
- loading、empty、error、denied 必须互斥。
- 表格状态文案必须具体，不能只写“暂无”或“失败”。

### 1.5 大数据量性能

表格性能按可见行数分级：

| 可见行数 | 标准 |
| --- | --- |
| 0-100 行 | 可客户端完整渲染和排序 |
| 101-500 行 | 必须评估分页、默认排序、筛选收窄和渲染耗时 |
| 501-2000 行 | 默认分页或服务端分页；避免一次性重建整表 |
| 2000 行以上 | 必须服务端分页、虚拟滚动或导出处理，不能默认完整渲染 |

执行规则：

- 高频刷新表格不能每次重建整页，只更新表格区域和关联指标。
- 可排序表格必须保留合计行位置，不能把合计行混入普通排序。
- 导出不能替代表格性能治理；导出是补充工作流。

### 1.6 验收矩阵

表格视觉统一按页面分批验收，不一次性重写所有表格。

| 页面 | 关键表格 | 必查项 | 优先级 |
| --- | --- | --- | --- |
| 销售预估 | 月销量、库存、补货建议宽表 | sticky 列、数字列、横向滚动、长文本 | P0 |
| 供应商看板 | 供应商 / MSKU 汇总表 | 数字列、金额列、排序、合计行 | P0 |
| 库存计提 | 库龄计提表、汇总表 | 金额列、风险状态、图表联动空态 | P0 |
| 应付账款 | 供应商/承运商应付表 | 金额列、状态列、操作列 | P1 |
| 预算目标 | 店铺预算表、导入结果表 | 编辑控件、错误态、导入空态 | P1 |

每个页面验收必须覆盖：

- 正常数据、空数据、接口错误、长文本、极值数字。
- 桌面宽度下横向滚动和 sticky 表头/列表现。
- 鼠标点击排序、键盘焦点、操作按钮可达性。
- 控制台无应用自身错误。


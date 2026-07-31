# FBA 货件收发差异设计

## 目标

在“物流”一级导航下新增“货件收发差异”子板块，用于让运营人员查看 FBA 货件申报量与亚马逊实收量的差异，并对 `CLOSED` 且短收的货件进行内部调查跟进。

本功能的七天倒计时是 BI 的内部处理 SLA，目的是提醒尽快进行调查/理赔；它不是亚马逊官方理赔时效，也不应表示为官方时效。

## 范围

### 包含

- 默认最近 30 天的 FBA 货件查询，复用项目日期范围控件并允许筛选日期。
- 默认显示全部店铺，并允许按店铺筛选。
- 货件状态、发货数量、实收数量、差异数量、关闭时间、内部 SLA 倒计时和跟进状态。
- `RECEIVING` 与 `CLOSED` 的差异状态判定。
- 已跟进状态的持久化、筛选和撤销。

### 不包含

- 自动向亚马逊创建调查、理赔或 Seller Central 工单。
- 把七天倒计时当作亚马逊官方申请窗口。
- 修改现有“FBA货件处理”、FBA 转表格、发货单或九方下单流程。
- 用货件创建时间、修改时间或其他推测时间代替内部 SLA 起算时间。

## 数据与业务规则

### 货件来源

复用领星 FBA 货件列表 `POST /erp/sc/data/fba_report/shipmentList` 及现有 `getFbaShipmentCandidates` 缓存服务。该来源已提供：

- `shipment_id`、`sid`、店铺、状态、商品明细；
- `item_list[].quantity_shipped` 和 `item_list[].quantity_received`；
- `closed_time`。

新服务按货件维度汇总商品明细。货件的发货数和实收数分别是所有商品明细的数量求和，差异数为 `shippedQuantity - receivedQuantity`。明细数据仍保留，以便后续显示 SKU 级差异。

### 状态与 SLA

| 条件 | 展示/计算 |
| --- | --- |
| `RECEIVING` | 显示“收货中”；展示当前发货、实收和差异，不计为待调查，不启动倒计时。 |
| `CLOSED` 且 `differenceQuantity > 0` | 显示“待调查”；内部截止时间为 `closed_time + 7 * 24 小时`，按当前时间显示“还剩 X 天 X 小时”或“已超时 X 天 X 小时”。 |
| `CLOSED` 且 `differenceQuantity <= 0` | 显示收发一致或多收；不进入待调查。 |
| 短收但缺失有效 `closed_time` | 明确显示“缺少关闭时间，无法计算内部 SLA”，不推测或静默降级。 |

状态字符串先规范化为大写后判断。`CLOSED` 与 `RECEIVING` 是本版明确处理的状态；其他状态可以返回但不进入待调查统计。

### 跟进记录

跟进状态与领星货件数据分离保存，唯一业务键是 `sid + shipmentId`。每条记录包括：

- `sid`、`shipmentId`；
- `followedUp`；
- `followedUpAt`；
- `followedUpBy`；
- `updatedAt`。

点击“已跟进”会创建或更新记录，操作人取当前认证用户。点击“撤销跟进”会将记录恢复为未跟进并更新审计时间。重新读取领星数据时，服务按业务键合并最新记录；跟进状态不改变差异计算、待调查资格或内部 SLA。

## 页面与交互

页面标题为“货件收发差异”，归属“物流”。说明文本必须明确七天倒计时是内部调查提醒。

筛选栏：

- 日期：默认最近 30 天，使用共享 `date-range-picker`；
- 店铺：默认全部，使用店铺选项；
- 跟进状态：全部、待跟进、已跟进、已超期；
- 读取/刷新按钮。

指标卡：收货中、已关闭短收、七天内到期、已超内部 SLA。

主表以货件为行，至少显示店铺、货件单号、状态、发货数量、实收数量、差异数量、关闭时间、剩余调查申请窗口、跟进状态和操作。表格继续由 `data-table-manager` 管理，使用稳定 `data-table-key` 与列语义，不添加页面固定业务列宽。

操作：

- “查看明细”：显示该货件的 SKU/MSKU 发货、实收、差异。
- “已跟进”：仅在短收且未跟进时启用。
- “撤销跟进”：仅在已跟进时启用。

所有按钮是语义 `button`，有可见文字和键盘焦点状态。窄视口时页面保持视口宽度，只有表格容器横向滚动。

## 模块边界

| 所有者 | 职责 |
| --- | --- |
| `src/services/fbaShipmentVarianceService.js` | 规范化筛选、复用候选货件、汇总收发差异、计算内部 SLA、合并跟进记录。 |
| `src/services/fbaShipmentVarianceFollowupStore.js` | 管理持久化跟进记录和审计字段。 |
| `routes/fba.js` | 提供差异列表、标记跟进与撤销跟进的会话认证路由。 |
| `assets/js/features/fba-shipment-variance.js` | 页面状态、加载、筛选、表格/明细渲染及事件绑定。 |
| `app.js` | 仅导入、实例化和调用 feature 的初始化入口。 |
| `index.html` | 新导航项与视图标记。 |
| `assets/css/pages/` | 页面专属布局；必须复用现有 semantic tokens、筛选栏、指标卡与表格组件。 |

不修改 `fbaFreightSheetService` 的业务职责，也不将差异状态机或渲染逻辑加回 `app.js`。

## API 设计

- `GET /api/fba/shipment-variances`：接受与现有 FBA 货件相同的日期、店铺筛选，以及 `followupStatus`；返回货件差异行、汇总指标和筛选元数据。
- `PUT /api/fba/shipment-variances/:sid/:shipmentId/followup`：标记已跟进。
- `DELETE /api/fba/shipment-variances/:sid/:shipmentId/followup`：撤销跟进。

路由必须将上游错误传给调用方，不能把领星读取失败包装为空列表。服务日志记录货件数量、短收数量、状态分布、超期数量、跟进操作的货件键与操作人；不得记录认证令牌或敏感凭据。

## 验证

### 自动化测试

- `RECEIVING` 不启动 SLA；
- `CLOSED` 短收的七天倒计时、到期和超期计算；
- 收发一致与多收不进入待调查；
- 缺少 `closed_time` 时显式不可计算；
- 商品明细到货件汇总；
- 跟进记录创建、读取、筛选、撤销和操作人审计；
- 路由认证、请求参数与错误传播；
- 前端加载、筛选、标记和撤销的交互结构测试。

### 浏览器验证

- 目标视图无控制台错误；
- 日期和店铺筛选可鼠标及键盘操作；
- 标记、刷新后保留、筛选与撤销均生效；
- 桌面及窄视口截图确认文字不重叠，表格在容器内横向滚动；
- 请求带有正确日期、店铺和跟进状态参数。

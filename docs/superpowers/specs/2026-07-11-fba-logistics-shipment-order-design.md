# FBA 物流板块与发货单转换设计

## 背景

BI 现有 `工具 > 货代表格` 页面已经可以从领星 FBA 货件接口读取货件，并生成货代表格。新需求是在 BI 内直接通过领星 OpenAPI 把 FBA 货件转换为领星 FBA 发货单，并支持批量操作。

这两个能力都属于 FBA 头程/物流作业，不适合继续放在“工具”。本设计新增一个“物流”一级板块，并把现有 FBA 货代表格与新 FBA 发货单能力统一到该板块下。

## 目标

1. 新增“物流”一级导航。
2. 将现有 `FBA货代发货表格` 从“工具”迁移到“物流”下，功能保持不变。
3. 新增 `FBA货件转发货单` 子板块。
4. 两个子板块共用同一份 FBA 货件候选数据服务和缓存，避免相同筛选条件重复请求领星 `shipmentList`。
5. 第一版只自动创建“待发货”的 FBA 发货单，不自动扣库存。
6. 批量操作必须串行执行，逐票返回 `created`、`skipped`、`failed` 等结果。
7. 创建前必须按 `shipment_id` 查询是否已有发货单，避免重复创建。

## 非目标

1. 第一版不调用“生成已发货的发货单”接口。
2. 第一版不调用“FBA 发货单发货”接口。
3. 第一版不自动扣减本地仓库存。
4. 第一版不实现多仓发货。
5. 第一版不强制同步完整装箱 `box_list`。若领星创建接口实际要求装箱信息，接口错误要暴露给用户和日志，不做静默兜底。

## 信息架构

新增一级导航：

- 物流
  - FBA转货代表格
  - FBA转发货单

现有 `fba-freight` view 继续保留 view id，降低迁移风险。只移动导航入口和页面标题文案。新增发货单页面建议使用 view id `fba-shipment-order`。

## 领星接口

### 货件来源

`POST /erp/sc/data/fba_report/shipmentList`

用于查询 FBA 货件列表。该接口令牌桶容量为 1，不能并发刷接口。返回的关键字段包括：

- `sid`
- `shipment_id`
- `shipment_name`
- `shipment_status`
- `destination_fulfillment_center_id`
- `sta_shipment_id`
- `sta_inbound_plan_id`
- `item_list[].fnsku`
- `item_list[].sku`
- `item_list[].quantity_shipped`
- `item_list[].quantity_in_case`

### 店铺映射

`GET /erp/sc/data/seller/lists`

创建发货单需要 `seller_id` 和 `marketplace_id`，不能直接使用 `sid`。服务层必须建立 `sid -> seller_id / marketplace_id / mid / name` 映射。若映射缺失，要 fail fast，让该货件失败并显示明确原因。

### 仓库来源

`POST /erp/sc/data/local_inventory/warehouse`

创建发货单顶层必须传 `wid` 或 `sys_wid`。FBA 货件无法推断本地出库仓，所以页面必须让用户选择发货仓。第一版只支持单仓创建。

### 查重

`POST /erp/sc/routing/storage/shipment/getInboundShipmentList`

使用 `senior_search_list` 按 `shipment_id` 查重。若已存在发货单，跳过创建并返回已有发货单号、状态和仓库信息。

### 创建待发货单

`POST /erp/sc/routing/storage/shipment/createReadySendOrder`

第一版使用该接口创建待发货单。最低必要请求字段：

- 顶层 `wid` 或 `sys_wid`
- 顶层 `list`
- `list[].seller_id`
- `list[].marketplace_id`
- `list[].shipment_id`
- `list[].fulfillment_network_sku`
- `list[].num`
- `list[].sku`

建议同时传：

- `head_fee_type: 0`
- `tax_fee_type: 0`
- `is_pick: 0`
- `remark: 探嘉BI自动创建: <shipment_id> <timestamp>`
- `list[].box_num`，如果可可靠计算
- `list[].quantity_in_case`，如果货件明细有值
- `list[].remark`，写入 BI 来源标记

## 共用 FBA 货件缓存

新增后端候选货件服务，供两个页面共用：

- `src/services/fbaShipmentCandidateService.js`

职责：

1. 规范化筛选条件。
2. 调用领星 `shipmentList`。
3. 使用现有 FBA 货件规范化逻辑生成统一候选货件模型。
4. 补充店铺映射字段。
5. 可选补充商品目录图片和名称。
6. 根据筛选条件缓存结果。

缓存 key 必须包含：

- `sid`
- `start_date`
- `end_date`
- `shipment_id`
- `shipment_status`
- 分页参数

缓存内容：

- normalized shipments
- source request id
- fetchedAt
- filter hash

缓存策略：

- 默认 TTL：5 分钟。
- 页面“读取货件”使用缓存。
- 页面“刷新”或带 `forceRefresh=true` 时绕过缓存并替换缓存。
- 缓存只存在服务进程内，不作为长期业务状态。
- 创建发货单时必须基于前端提交的 `shipmentIds` 再从候选服务读取当前筛选结果；若缓存失效则重新拉取，不信任前端传完整货件数据。

## 后端结构

### Adapter

在 `src/adapters/lingxingAdapter.js` 增加方法：

- `fetchFbaInboundShipmentOrders(params)`
- `createReadySendFbaShipmentOrder(params)`
- `fetchLocalWarehouses(params)`
- `fetchFbaShipmentBoxInfo(params)`，用于普通货件装箱信息，第一版可先不接入创建流程
- 已有 `fetchFbaCargoShipments(params)` 继续复用
- 已有 `fetchFbaCargoShipmentBoxes(params)` 继续复用 STA 装箱查询

### Service

新增：

- `src/services/fbaShipmentCandidateService.js`
- `src/services/fbaShipmentOrderService.js`

`fbaShipmentOrderService` 职责：

1. 读取候选货件。
2. 校验仓库参数。
3. 校验每个货件的店铺映射和商品明细。
4. 按 `shipment_id` 查重。
5. 串行调用 `createReadySendOrder`。
6. 返回逐票结果。
7. 记录关键节点日志。

### Routes

在 `routes/fba.js` 增加：

- `GET /api/fba/shipment-candidates`
- `GET /api/fba/warehouses`
- `POST /api/fba/shipment-orders/create`

现有 `GET /api/fba/freight/shipments` 可以逐步改为调用候选货件服务，但保持接口兼容。

## 前端结构

现有货代表格：

- 保留 `assets/js/features/fba-freight.js`
- 保持现有 `/api/fba/freight/shipments` 前端接口兼容，后端内部改为调用共用候选货件服务

新增发货单页面：

- `assets/js/features/fba-shipment-order.js`
- `assets/css/pages/36-fba-shipment-order.css`
- `index.html` 新增 `view-fba-shipment-order`
- `app.js` 只负责 import 和初始化，不放业务逻辑

页面能力：

1. 货件筛选：日期、店铺、货件单号、货件状态。
2. 仓库选择：读取领星本地仓库列表。
3. 货件列表：显示店铺、货件号、状态、SKU 数、发货数量、是否已有发货单。
4. 选择货件：支持单选、全选当前页。
5. 批量创建：弹窗二次确认，显示仓库、数量和“只创建待发货单，不扣库存”。
6. 结果展示：逐票展示创建、跳过、失败原因和领星返回 request id。

## 错误处理与可观测性

遵循 fail fast，不吞错误。

后端日志统一使用 `[fba-shipment-order]` 前缀，记录：

- `shipmentId`
- `sid`
- `sellerId`
- `marketplaceId`
- `warehouseId`
- `requestId`
- `orderSn`
- `status`
- `error.message`

禁止记录：

- access token
- app secret
- sign

每个失败货件必须返回明确原因：

- 缺少仓库
- 缺少店铺映射
- 缺少 SKU
- 缺少 FNSKU
- 发货数量小于等于 0
- 已存在发货单
- 领星接口返回错误

批量中某票失败，不影响后续货件继续处理，但最终接口返回 `ok: false` 或 `partial: true`，并带完整明细。不能把部分失败伪装成成功。

## 测试计划

后端单元测试：

1. FBA 候选货件缓存 key 包含关键筛选条件。
2. 相同筛选条件命中缓存，不重复调用 adapter。
3. `forceRefresh=true` 绕过缓存。
4. `sid` 正确映射到 `seller_id` 和 `marketplace_id`。
5. 缺少仓库时 fail fast。
6. 缺少 `seller_id`、`marketplace_id`、`sku`、`fnsku`、`num` 时返回逐票失败。
7. 已存在发货单时跳过创建。
8. 批量创建串行执行。

前端验证：

1. 物流导航展示两个子板块。
2. 原 FBA 货代表格仍可读取货件、导出、批量转表格。
3. FBA 转发货单页面可读取仓库和货件。
4. 未选择仓库时不能创建。
5. 批量创建确认弹窗文案明确“不扣库存”。
6. 创建结果逐票展示。
7. 桌面和窄屏无文本重叠。

## 后续扩展

第二阶段可以评估：

1. 完整同步普通货件和 STA 货件装箱信息。
2. 已有待发货单一键发货并扣库存。
3. 支持多仓发货。
4. 支持物流轨迹、头程预估费用、实际费用写入。
5. 本地持久化创建尝试日志，用于审计和重试。
